/**
 * Surgical edit pass: modify the LOADED plugin without regenerating it.
 *
 * This is the enforcement of "additive refinement, not regeneration": once a
 * build exists, follow-up requests are compiled into the smallest change that
 * satisfies them --
 *
 *   1. element NOTES (from the annotation canvas): rename / widen / narrow /
 *      raise / lower, applied per pointed-at control
 *   2. relative TWEAKS in the prompt ("brighter", "more feedback") via the
 *      existing tweak rules
 *   3. additive CHAINING ("add a ring mod"): the current dspFunction becomes
 *      stage 1 (state namespaced, untouched) and a verified primitive is
 *      appended after it -- rolled back unless the result still clears the
 *      >= 97 gate with no new dead controls
 *   4. optional local-model EDIT AGENT for requests the deterministic rules
 *      can't map -- accepted only under the same evidence rules
 *
 * The original algorithm is never discarded; every original parameter id
 * must survive every path. Full regeneration is a routing decision made
 * upstream (editIntent.ts), never a side effect here.
 */

import { AudioPlugin, PluginParameter } from "../types";
import { DSP_PRIMITIVES, DspPrimitive } from "./dspPrimitives";
import { PITCH_SHIFT_RECIPE } from "./dspRecipes";
import { applyRelativeTweaks } from "./offlineBuilder";
import { QualityGateResult, runQualityGate } from "./qualityGate";
import { checkDsp } from "./pluginVerifier";
import { normalizeModelDspCode } from "./healthcheckRunner";
import { LLMConfig, callLocalLLM, isLocalProvider } from "./llmGateway";
import { DSP_CODING_RULES, SOUND_QUALITY_RULES } from "./dspPromptKit";
import { PluginFamily } from "./pluginSpec";
import { learnedPitfallsFor } from "./learnedPitfalls";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One canvas annotation: a note pinned to a specific control. */
export interface ElementNote {
  paramId: string;
  paramName: string;
  note: string;
}

export interface EditPassResult {
  plugin: AudioPlugin;
  gate: QualityGateResult;
  /** Human-readable list of edits that were actually applied. */
  changes: string[];
  /** Requests/notes that could not be mapped or were rolled back (honesty). */
  unhandled: string[];
  usedModel: boolean;
}

export type EditWorker = (input: {
  prompt: string;
  plugin: AudioPlugin;
  notes: ElementNote[];
}) => Promise<{ dspFunction: string; newParameters?: PluginParameter[]; notes: string }>;

export interface EditPassOptions {
  prompt: string;
  notes?: ElementNote[];
  llmConfig?: LLMConfig;
  /** Injectable worker (tests); null disables model edits; undefined derives from llmConfig. */
  editWorker?: EditWorker | null;
  signal?: AbortSignal;
}

/* ------------------------------------------------------------------ */
/* Gate family: derived from the PLUGIN, never re-classified from the  */
/* edit prompt ("add grit to my amp" must not bolt an amp head onto a  */
/* delay via family-mandatory UI enforcement).                         */
/* ------------------------------------------------------------------ */

const CATEGORY_TO_FAMILY: Record<AudioPlugin["category"], PluginFamily> = {
  distortion: "distortion",
  delay: "delay",
  filter: "filter",
  synthesizer: "synthesizer",
  dynamics: "dynamics",
  modulation: "modulation",
  reverb: "reverb",
};

/* ------------------------------------------------------------------ */
/* 1. Element-note edits                                               */
/* ------------------------------------------------------------------ */

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const RENAME_NOTE = /(?:rename|call|name)(?:\s+(?:it|this|to|as))*\s+["']?([A-Za-z][\w \-]{1,23}?)["']?\s*$/i;
const WIDEN_NOTE = /\b(?:wider|bigger|larger|more)\s+range\b|\bextend(?:\s+the)?\s+range\b/i;
const NARROW_NOTE = /\b(?:narrower|smaller|less)\s+range\b|\btoo\s+wide\b/i;
// Direction words. LOWER is evaluated first so "less aggressive" lowers.
// Bare "more"/"less" only count as a direction when they aren't qualifying an
// UNKNOWN adjective: "give it more" raises, "less aggressive" lowers, but
// "more boutique" is a character request the deterministic rules can't map --
// it must fall through as a leftover so the model edit agent gets a shot.
const INTENSITY_ADJ = "aggressive|intense|extreme|drastic|harsh|strong|loud|hot|powerful|dramatic|pronounced|obvious|noticeable|audible";
const LOWER_NOTE = new RegExp(
  `\\b(?:less\\s+(?:${INTENSITY_ADJ})\\b|less\\b(?!\\s+[a-z])|lower|weaker|softer|gentler|quieter|calmer|too\\s+(?:much|hot|strong|loud|aggressive|harsh|intense|high|fast|long|big))`,
  "i"
);
const RAISE_NOTE = new RegExp(
  `\\b(?:more\\s+(?:${INTENSITY_ADJ})\\b|more\\b(?!\\s+[a-z])|higher|stronger|hotter|louder|aggressive|intense|too\\s+(?:low|weak|quiet|subtle|soft|slow|short|small|little))`,
  "i"
);

/** Apply the mappable notes in place; return what changed and what didn't map. */
export function applyNoteEdits(
  parameters: PluginParameter[],
  notes: ElementNote[]
): { changes: string[]; leftovers: ElementNote[] } {
  const changes: string[] = [];
  const leftovers: ElementNote[] = [];

  for (const n of notes) {
    const p = parameters.find((q) => q.id === n.paramId);
    if (!p) {
      leftovers.push(n);
      continue;
    }
    const range = p.max - p.min;
    const rename = n.note.match(RENAME_NOTE);

    if (rename) {
      const newName = rename[1].trim();
      changes.push(`${p.name} renamed to "${newName}"`);
      p.name = newName;
    } else if (WIDEN_NOTE.test(n.note)) {
      p.max = round3(p.max + 0.25 * range);
      changes.push(`${p.name} range extended (max -> ${p.max})`);
    } else if (NARROW_NOTE.test(n.note)) {
      p.max = round3(Math.max(p.min + 0.05 * range, p.max - 0.25 * range));
      p.defaultValue = Math.min(p.max, p.defaultValue);
      p.value = Math.min(p.max, p.value !== undefined ? p.value : p.defaultValue);
      changes.push(`${p.name} range tightened (max -> ${p.max})`);
    } else if (LOWER_NOTE.test(n.note)) {
      const v = round3(Math.max(p.min, (p.value !== undefined ? p.value : p.defaultValue) - 0.25 * range));
      p.value = v;
      p.defaultValue = v;
      changes.push(`${p.name} lowered (-25% of range)`);
    } else if (RAISE_NOTE.test(n.note)) {
      const v = round3(Math.min(p.max, (p.value !== undefined ? p.value : p.defaultValue) + 0.25 * range));
      p.value = v;
      p.defaultValue = v;
      changes.push(`${p.name} raised (+25% of range)`);
    } else {
      leftovers.push(n);
    }
  }

  return { changes, leftovers };
}

/* ------------------------------------------------------------------ */
/* 2. Additive stage chaining                                          */
/* ------------------------------------------------------------------ */

const ADD_WORDING = /\b(?:add|with\s+(?:a|an|some)|give\s+it\s+(?:a|an|some)|put\s+(?:a|an)|include|layer|stack)\b/i;

/** The stage menu for additions: every primitive plus the fixed pitch shifter. */
const ADDABLE_STAGES: Array<Pick<DspPrimitive, "id" | "title" | "match" | "parameters" | "body">> = [
  ...DSP_PRIMITIVES,
  { id: PITCH_SHIFT_RECIPE.id, title: PITCH_SHIFT_RECIPE.title, match: PITCH_SHIFT_RECIPE.match, parameters: PITCH_SHIFT_RECIPE.parameters, body: PITCH_SHIFT_RECIPE.body },
];

/**
 * Addition-specific matchers: the primitives' own `match` patterns are tuned
 * for BUILD prompts and vote on flavor adjectives ("expensive", "warm",
 * "gritty"). An ADDITION must name the effect itself -- "add a ring mod",
 * "give it some echo" -- or a character request like "give it a more
 * expensive, gritty character" would silently bolt a whole drive stage onto
 * the plugin instead of reaching the edit agent.
 */
const ADDITION_NOUNS: Record<string, RegExp> = {
  pitch_grain: /\b(?:granular|grains?|shimmer)\b/i,
  ring_mod: /\bring\s*(?:mod(?:ulator|ulation)?)\b/i,
  bitcrush: /\b(?:bit\s*crush(?:er)?|bitcrush(?:er)?|decimat(?:or|ion)|lo-?fi)\b/i,
  wavefold: /\b(?:wave\s*fold(?:er|ing)?|wavefold(?:er|ing)?)\b/i,
  drive: /\b(?:drive|overdrive|distortion|saturat(?:or|ion)|fuzz)\b/i,
  comb_resonator: /\b(?:comb|resonator)\b/i,
  wobble_filter: /\b(?:wobble|wah|filter\s*sweep|auto-?filter)\b/i,
  tone_lp: /\b(?:low-?pass|tone\s*(?:filter|control))\b/i,
  chopper: /\b(?:chopper|stutter|gate|strobe)\b/i,
  echo: /\b(?:echo|delay)\b/i,
  pitch_shift: /\b(?:pitch\s*shift(?:er)?|octave\s*(?:up|down)|transpose)\b/i,
};

export function pickAdditionStage(prompt: string): (typeof ADDABLE_STAGES)[number] | null {
  const addMatch = ADD_WORDING.exec(prompt);
  if (!addMatch) return null;
  const stage = ADDABLE_STAGES.find((s) => (ADDITION_NOUNS[s.id] ?? s.match).test(prompt));
  if (!stage) return null;
  // Proximity guard: "add a ring mod" and "give it some echo" say the
  // addition wording and the effect noun close together -- a long
  // descriptive BUILD sentence that merely happens to contain both
  // somewhere ("a vintage amp with drive, tone, and level controls, add
  // some character") reads completely differently, even though it would
  // otherwise match both regexes. Require the effect noun to start within
  // ~40 characters of the addition wording's own match. (classifyEditIntent
  // already keeps most fresh-build descriptions out of the edit pass
  // entirely via looksLikeFreshBuildDescription; this is defense in depth
  // for phrasing that check doesn't catch, e.g. one missing a leading
  // indefinite article.)
  const nounMatch = (ADDITION_NOUNS[stage.id] ?? stage.match).exec(prompt);
  if (!nounMatch || Math.abs(nounMatch.index - addMatch.index) > 40) return null;
  return stage;
}

/* ------------------------------------------------------------------ */
/* 2.5 Additive voicing-option extension                              */
/* ------------------------------------------------------------------ */

/**
 * The "extend a discrete option set" primitive: no earlier tool in this file
 * could do "add another cabinet" as an in-place edit -- chainStage appends a
 * whole new DSP STAGE after the signal path, which is the wrong shape for
 * "give this existing selector one more choice." This is what makes that a
 * true additive edit (same plugin id, existing choices untouched, one new
 * branch appended) instead of forcing a full rebuild for a one-word request,
 * per the standing "additive refinement, not regeneration" rule.
 *
 * Deterministic, not model-authored: each target ships exactly one
 * pre-verified next voicing (matching the project's "adapt a proven
 * template" precedent), the same way a promoted research-corpus module is a
 * fixed, tested body rather than freeform generation.
 */
interface VoicingExtension {
  paramId: string;
  paramName: string;
  choiceLabel: string;
  /** The literal text of the chain's current topmost branch header, used
   *  both to detect eligibility and as the anchor for the text-surgical
   *  insertion below (e.g. "if (headType >= 2.5) {"). */
  topBranchAnchor: (currentMax: number) => string;
  /** The new topmost branch's coefficient-assignment lines (no braces). */
  branchBody: string;
}

const VOICING_EXTENSIONS: Record<"head" | "cab", VoicingExtension> = {
  head: {
    paramId: "headType",
    paramName: "Amp Voicing",
    choiceLabel: "Boost",
    topBranchAnchor: (max) => `if (headType >= ${(max - 1 + 0.5).toFixed(1)}) {`,
    branchBody: `hDriveMul = 1.8; hToneTiltBass = 0.65; hToneTiltTreble = 1.4; hClipHardness = 1.5;`,
  },
  cab: {
    paramId: "cabType",
    paramName: "Cabinet",
    choiceLabel: "8x10",
    topBranchAnchor: (max) => `if (cabType >= ${(max - 1 + 0.5).toFixed(1)}) {`,
    branchBody: `cabLp = 6200.0; cabHp = 110.0; cabRes = 98.0; cabComb = 40;`,
  },
};

const ADD_CAB_OPTION = /\badd(?:s|ing)?\s+(?:another|a\s+new|an?|more)\s*cab(?:inet)?\s*(?:option|size|voicing|choice)?s?\b|\bmore\s+cab(?:inet)?\s+options?\b/i;
const ADD_HEAD_OPTION = /\badd(?:s|ing)?\s+(?:another|a\s+new|an?|more)\s*(?:amp\s+)?(?:head|channel|voicing)\s*(?:option|choice)?s?\b|\bmore\s+(?:amp\s+)?(?:head|channel)\s+options?\b|\badd\s+a\s+boost\s+channel\b/i;

/** Which voicing axis (if any) this prompt is asking to extend, given what
 *  the CURRENTLY LOADED plugin actually has -- family-agnostic on purpose
 *  (checks for the real headType/cabType select param directly, since
 *  category collapses amp_sim to "distortion" and can't distinguish it). */
export function pickVoicingExtension(prompt: string, parameters: PluginParameter[]): "head" | "cab" | null {
  if (ADD_CAB_OPTION.test(prompt) && parameters.some((p) => p.id === "cabType" && p.controlType === "select")) return "cab";
  if (ADD_HEAD_OPTION.test(prompt) && parameters.some((p) => p.id === "headType" && p.controlType === "select")) return "head";
  return null;
}

/** Appends one new topmost choice to a "select" param's discrete option set:
 *  widens `max` by 1, appends the choice label, and inserts one new branch
 *  at the top of the DSP body's existing if/else-if chain (the original
 *  topmost branch becomes the next `else if` down -- every other branch is
 *  untouched since the comparisons are relative, not renumbered). Returns
 *  null if the anchor text isn't found (the body was hand-edited away from
 *  the shape this primitive expects -- fails closed rather than mangling
 *  code it doesn't recognize). */
export function extendVoicingOption(
  dspBody: string,
  parameters: PluginParameter[],
  which: "head" | "cab"
): { body: string; parameters: PluginParameter[]; note: string } | null {
  const ext = VOICING_EXTENSIONS[which];
  const target = parameters.find((p) => p.id === ext.paramId);
  if (!target) return null;
  const anchor = ext.topBranchAnchor(target.max);
  const idx = dspBody.indexOf(anchor);
  if (idx === -1) return null;

  const newThreshold = (target.max + 0.5).toFixed(1);
  const replacement =
    `if (${ext.paramId} >= ${newThreshold}) { // ${ext.choiceLabel}: added voicing\n` +
    `  ${ext.branchBody}\n` +
    `} else ${anchor}`;
  const body = dspBody.slice(0, idx) + replacement + dspBody.slice(idx + anchor.length);

  const newParameters = parameters.map((p) =>
    p.id === ext.paramId
      ? { ...p, max: p.max + 1, choices: p.choices ? [...p.choices, ext.choiceLabel] : p.choices }
      : p
  );
  return { body, parameters: newParameters, note: `added a new "${ext.choiceLabel}" ${ext.paramName} option (${target.max + 1} choices now)` };
}

/** Convert a single-trailing-return body into a block that assigns `outVar`. */
function toAssignedBlock(body: string, outVar: string): string | null {
  if ((body.match(/\breturn\b/g) || []).length !== 1) return null; // early returns can't be block-scoped safely
  const idx = body.lastIndexOf("return ");
  if (idx < 0) return null;
  const expr = body.slice(idx + "return ".length).replace(/;\s*$/, "");
  return `${body.slice(0, idx)}${outVar} = ${expr};`;
}

/**
 * Chain a verified stage AFTER the existing dspFunction. The base body is
 * untouched except for state namespacing; its output feeds the new stage.
 * Returns null when the base can't be safely wrapped (e.g. early returns).
 */
export function chainStage(
  baseBody: string,
  stage: (typeof ADDABLE_STAGES)[number],
  existingIds: Set<string>
): { body: string; addedParams: PluginParameter[]; note: string } | null {
  const namespacedBase = baseBody.replace(/\bstate\./g, "state.b0_");
  const baseBlock = toAssignedBlock(namespacedBase, "__edit0");
  if (!baseBlock) return null;

  let stageBody = stage.body.replace(/\bstate\./g, "state.a1_").replace(/\binputSample\b/g, "__edit0");
  const addedParams: PluginParameter[] = [];
  for (const sp of stage.parameters) {
    let id = sp.id;
    if (existingIds.has(id)) {
      id = `${sp.id}_2`;
      stageBody = stageBody.replace(new RegExp(`\\bparams\\.${sp.id}\\b`, "g"), `params.${id}`);
    }
    addedParams.push({ ...sp, id, value: sp.defaultValue });
  }
  const stageBlock = toAssignedBlock(stageBody, "__edit1");
  if (!stageBlock) return null;

  const body = [
    `let __edit0 = 0;`,
    `// --- EXISTING SIGNAL PATH (unchanged, state namespaced) ---`,
    `{\n${baseBlock}\n}`,
    `let __edit1 = 0;`,
    `// --- ADDED STAGE: ${stage.title} ---`,
    `{\n${stageBlock}\n}`,
    `return __edit1;`,
  ].join("\n");

  return { body, addedParams, note: `added a ${stage.title} stage after the existing signal path` };
}

/* ------------------------------------------------------------------ */
/* 3. Local-model edit agent                                           */
/* ------------------------------------------------------------------ */

const EDIT_AGENT_PROMPT = `You are the Edit Agent of an audio plugin factory. You receive the CURRENT WORKING plugin (parameter schema + dspFunction) and an edit request, possibly with notes pinned to specific controls. Apply the SMALLEST change that satisfies the request: keep the existing algorithm recognizable and keep EVERY existing parameter id working exactly as before. You may add at most 2 new parameters when the request requires them. NEVER rewrite from scratch.
Return ONLY JSON: { "dspFunction": "<updated JS body>", "newParameters": [ { "id": "x", "name": "X", "min": 0, "max": 1, "defaultValue": 0.5, "unit": "" } ], "notes": "<one sentence: what you changed>" }
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}`;

function buildLocalEditWorker(llmConfig: LLMConfig, family: PluginFamily, signal?: AbortSignal): EditWorker | null {
  if (!isLocalProvider(llmConfig)) return null;
  return async ({ prompt, plugin, notes }) => {
    const paramList = plugin.parameters
      .map((p) => `{ "id": "${p.id}", "name": "${p.name}", "min": ${p.min}, "max": ${p.max}, "defaultValue": ${p.defaultValue} }`)
      .join(",\n");
    const noteLines = notes.map((n) => `- on "${n.paramName}" (${n.paramId}): ${n.note}`).join("\n");
    const payload = await callLocalLLM({
      config: llmConfig,
      systemPrompt: EDIT_AGENT_PROMPT,
      userText: `Edit request: ${prompt}${noteLines ? `\n\nElement notes:\n${noteLines}` : ""}\n\nCURRENT parameter schema (keep every id working):\n[${paramList}]\n\nCURRENT dspFunction:\n${plugin.dspFunction}${learnedPitfallsFor(family)}`,
      temperature: 0.3,
      signal,
    });
    const newParameters = Array.isArray(payload?.newParameters)
      ? payload.newParameters
          .filter((p: any) => p && typeof p.id === "string" && typeof p.min === "number" && typeof p.max === "number")
          .slice(0, 2)
          .map((p: any) => ({
            id: p.id, name: String(p.name || p.id), min: p.min, max: p.max,
            defaultValue: typeof p.defaultValue === "number" ? p.defaultValue : (p.min + p.max) / 2,
            value: typeof p.defaultValue === "number" ? p.defaultValue : (p.min + p.max) / 2,
            unit: String(p.unit || ""),
          }))
      : [];
    return {
      dspFunction: typeof payload?.dspFunction === "string" ? payload.dspFunction : "",
      newParameters,
      notes: typeof payload?.notes === "string" ? payload.notes : "",
    };
  };
}

/* ------------------------------------------------------------------ */
/* The pass                                                            */
/* ------------------------------------------------------------------ */

/** A candidate edit is kept only if it still clears the floor with no new
 *  dead controls -- an edit must never cost quality the build already had. */
function acceptableEdit(gate: QualityGateResult, baseline: QualityGateResult): boolean {
  const s = gate.scores;
  const min = Math.min(s.looks, s.performance, s.latency, s.musicality);
  return (
    gate.report.compiled &&
    min >= 97 &&
    gate.report.deadParams.length <= baseline.report.deadParams.length &&
    gate.report.unstableParams.length <= baseline.report.unstableParams.length
  );
}

export async function runEditPass(base: AudioPlugin, opts: EditPassOptions): Promise<EditPassResult> {
  const notes = opts.notes ?? [];
  const family = CATEGORY_TO_FAMILY[base.category] ?? null;
  const gateOf = (p: AudioPlugin) => runQualityGate(p, { family, prompt: opts.prompt });

  const changes: string[] = [];
  const unhandled: string[] = [];
  let usedModel = false;

  // 1 + 2: element notes, then relative tweaks -- pure parameter surgery.
  const parameters = base.parameters.map((p) => ({ ...p }));
  const noteResult = applyNoteEdits(parameters, notes);
  changes.push(...noteResult.changes);
  changes.push(...applyRelativeTweaks(opts.prompt, parameters).map((t) => `voicing: ${t}`));

  let working: AudioPlugin = { ...base, parameters };
  let gate = gateOf(working);

  // 2.5: extend a discrete option set ("add another cabinet"), evidence-
  // gated with rollback -- same contract as chainStage below, just the
  // right shape for widening an existing select param instead of appending
  // a whole new signal-path stage.
  const voicingAxis = pickVoicingExtension(opts.prompt, working.parameters);
  if (voicingAxis) {
    const extended = extendVoicingOption(working.dspFunction, working.parameters, voicingAxis);
    if (extended) {
      const candidate: AudioPlugin = { ...working, parameters: extended.parameters, dspFunction: extended.body };
      const candidateGate = gateOf(candidate);
      if (acceptableEdit(candidateGate, gate)) {
        working = candidateGate.plugin;
        gate = candidateGate;
        changes.push(extended.note);
      } else {
        unhandled.push(`extending the ${voicingAxis === "head" ? "amp voicing" : "cabinet"} options didn't clear the quality gate, so it was rolled back`);
      }
    } else {
      unhandled.push(`the current DSP's ${voicingAxis === "head" ? "headType" : "cabType"} branch chain wasn't in the shape this edit expects, so it was skipped`);
    }
  }

  // 3: additive chaining, evidence-gated with rollback.
  const stage = pickAdditionStage(opts.prompt);
  if (stage) {
    const chained = chainStage(working.dspFunction, stage, new Set(parameters.map((p) => p.id)));
    if (chained) {
      const candidate: AudioPlugin = {
        ...working,
        parameters: [...working.parameters, ...chained.addedParams],
        dspFunction: chained.body,
      };
      const candidateGate = gateOf(candidate);
      if (acceptableEdit(candidateGate, gate)) {
        working = candidateGate.plugin;
        gate = candidateGate;
        changes.push(chained.note);
      } else {
        unhandled.push(`adding a ${stage.title} stage didn't clear the quality gate, so it was rolled back`);
      }
    } else {
      unhandled.push(`the current DSP can't be safely wrapped to append a ${stage.title} stage (early returns)`);
    }
  }

  // 4: model edit agent for whatever the deterministic rules couldn't map.
  const worker =
    opts.editWorker !== undefined
      ? opts.editWorker
      : opts.llmConfig && family
      ? buildLocalEditWorker(opts.llmConfig, family, opts.signal)
      : null;
  const needsModel = noteResult.leftovers.length > 0 || (changes.length === 0 && !stage);
  if (worker && needsModel) {
    try {
      const reworked = await worker({ prompt: opts.prompt, plugin: working, notes: noteResult.leftovers });
      const dsp = normalizeModelDspCode(reworked.dspFunction);
      if (dsp.trim()) {
        const mergedParams = [
          ...working.parameters,
          ...(reworked.newParameters ?? []).filter((np) => !working.parameters.some((p) => p.id === np.id)),
        ];
        const acceptance = checkDsp(dsp, mergedParams);
        if (acceptance.ok) {
          const candidate: AudioPlugin = { ...working, parameters: mergedParams, dspFunction: dsp };
          const candidateGate = gateOf(candidate);
          // The model must also keep every ORIGINAL control alive.
          const originalIds = new Set(base.parameters.map((p) => p.id));
          const keptAll = [...originalIds].every((id) => candidateGate.plugin.parameters.some((p) => p.id === id));
          if (keptAll && acceptableEdit(candidateGate, gate)) {
            working = candidateGate.plugin;
            gate = candidateGate;
            usedModel = true;
            changes.push(reworked.notes ? `model edit: ${reworked.notes.slice(0, 120)}` : "model edit applied");
          } else {
            unhandled.push("the model's edit didn't clear the quality gate (or dropped an existing control), so it was rejected");
          }
        } else {
          unhandled.push(`model edit rejected by acceptance check (${acceptance.evidence.slice(0, 90)})`);
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      unhandled.push(`model edit failed (${String(err?.message || err).slice(0, 80)})`);
    }
  }
  // Whatever notes still couldn't be applied are reported honestly.
  if (!usedModel) {
    for (const n of noteResult.leftovers) {
      unhandled.push(`note on "${n.paramName}" ("${n.note.slice(0, 60)}") had no mappable action`);
    }
  }

  return { plugin: gate.plugin, gate, changes, unhandled, usedModel };
}
