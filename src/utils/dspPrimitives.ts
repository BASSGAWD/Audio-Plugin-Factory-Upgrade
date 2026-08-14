/**
 * DSP primitive library + graph composer — the answer to "no recipe".
 *
 * Whole-plugin recipes cover known families; NOVEL prompts are served by
 * composing small verified primitive stages into an N-stage chain. The unit
 * of reuse is a 1-2 knob stage (drive, modulated delay, pitch grains, ring
 * mod, ...), so ~10 primitives × chains of 2-4 = thousands of distinct,
 * fully-deterministic plugins. Keyword inference picks the stages (an LLM
 * can also propose the same tiny graph spec later — it's a menu choice, not
 * code generation); the composer assembles block-scoped stage bodies exactly
 * like composeRecipes, and the quality gate verifies the result as always.
 */

import { PluginParameter } from "../types";

/**
 * What JOB a stage does. Two primitives sharing a role are interchangeable
 * siblings — same job, different character — which is what makes a
 * substitution a meaningful structural variant rather than a random edit.
 */
export type PrimitiveRole = "pitch" | "shaper" | "resonator" | "modulator" | "filter" | "time";

export interface DspPrimitive {
  id: string;
  title: string;
  /** Prompt keywords that vote for this stage. */
  match: RegExp;
  /** Fixed chain position priority (lower = earlier). */
  order: number;
  /** Interchangeability class — see PrimitiveRole. */
  role: PrimitiveRole;
  parameters: Array<Pick<PluginParameter, "id" | "name" | "min" | "max" | "defaultValue" | "unit">>;
  /** Stage body: reads inputSample, ends in `return <expr>;` (composer rewires both). */
  body: string;
}

export const DSP_PRIMITIVES: DspPrimitive[] = [
  {
    id: "pitch_grain",
    title: "granular pitch shifter",
    match: /granular|grain|texture|shimmer|pitch|alien|crystal|sparkle|space|cosmic|dream/i,
    order: 10,
    role: "pitch",
    parameters: [{ id: "shift", name: "Shift", min: -12, max: 12, defaultValue: 5, unit: "st" }],
    body: `if (!state.init) { state.buf = new Float32Array(4096); state.wp = 0; state.rp1 = 0; state.rp2 = 1024; state.init = true; }
let shift = params.shift !== undefined ? params.shift : 5;
let ratio = Math.pow(2, shift / 12);
state.buf[state.wp] = inputSample;
state.wp = (state.wp + 1) % 4096;
let i0a = Math.floor(state.rp1) % 4096; if (i0a < 0) i0a += 4096;
let sA = state.buf[i0a];
let i0b = Math.floor(state.rp2) % 4096; if (i0b < 0) i0b += 4096;
let sB = state.buf[i0b];
let posA = state.rp1 % 2048; if (posA < 0) posA += 2048;
let posB = state.rp2 % 2048; if (posB < 0) posB += 2048;
let wA = 0.5 - 0.5 * Math.cos((2 * Math.PI * posA) / 2048);
let wB = 0.5 - 0.5 * Math.cos((2 * Math.PI * posB) / 2048);
state.rp1 += ratio; if (state.rp1 >= 4096) state.rp1 -= 4096; if (state.rp1 < 0) state.rp1 += 4096;
state.rp2 += ratio; if (state.rp2 >= 4096) state.rp2 -= 4096; if (state.rp2 < 0) state.rp2 += 4096;
return inputSample * 0.4 + (sA * wA + sB * wB) * 0.8;`,
  },
  {
    id: "ring_mod",
    title: "ring modulator",
    match: /ring|robot|metallic|bell|alien|weird|mangle|inharmonic/i,
    order: 12,
    role: "modulator",
    parameters: [{ id: "ringfreq", name: "Ring Freq", min: 20, max: 2000, defaultValue: 180, unit: "Hz" }],
    body: `if (!state.init) { state.ph = 0; state.sm = 180; state.init = true; }
let ringfreq = params.ringfreq !== undefined ? params.ringfreq : 180;
state.sm += 0.002 * (ringfreq - state.sm);
state.ph += 2 * Math.PI * state.sm / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
return inputSample * (0.45 + 0.55 * Math.sin(state.ph));`,
  },
  {
    id: "bitcrush",
    title: "bit crusher",
    match: /crush|bit|glitch|digital|8.?bit|chip|destroy|mangle|broken|lo.?fi/i,
    order: 14,
    role: "shaper",
    parameters: [{ id: "crush", name: "Crush", min: 2, max: 16, defaultValue: 7, unit: "bits" }],
    body: `if (!state.init) { state.held = 0; state.n = 0; state.init = true; }
let crush = params.crush !== undefined ? params.crush : 7;
let levels = Math.pow(2, crush);
let hold = Math.max(1, Math.round((17 - crush) * 0.9));
state.n++;
if (state.n >= hold) { state.n = 0; state.held = Math.round(inputSample * levels) / levels; }
return state.held;`,
  },
  {
    id: "wavefold",
    title: "wavefolder",
    match: /fold|warp|bend|twist|gnarl|west.?coast|harmonic/i,
    order: 16,
    role: "shaper",
    parameters: [{ id: "fold", name: "Fold", min: 1, max: 8, defaultValue: 3, unit: "x" }],
    body: `if (!state.init) { state.smF = 3; state.init = true; }
let fold = params.fold !== undefined ? params.fold : 3;
state.smF += 0.002 * (fold - state.smF);
let y = Math.sin(inputSample * state.smF * 1.7);
return y / Math.pow(state.smF, 0.4);`,
  },
  {
    id: "drive",
    title: "soft-clip drive",
    match: /drive|warm|dirt|grit|saturat|expensive|thick|fat|analog/i,
    order: 20,
    role: "shaper",
    parameters: [{ id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 8, unit: "dB" }],
    body: `if (!state.init) { state.smD = 8; state.pv = 0; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 8;
state.smD += 0.002 * (drive - state.smD);
let g = Math.pow(10, state.smD / 20);
let mid = 0.5 * (state.pv + inputSample);
state.pv = inputSample;
return 0.5 * (Math.tanh(mid * g) + Math.tanh(inputSample * g)) / Math.pow(g, 0.65);`,
  },
  {
    id: "comb_resonator",
    title: "comb resonator",
    match: /comb|resonat|metallic|tube\b|pipe|tunnel|robot/i,
    order: 24,
    role: "resonator",
    parameters: [{ id: "combfreq", name: "Resonance Pitch", min: 60, max: 880, defaultValue: 220, unit: "Hz" }],
    body: `if (!state.init) { state.buf = new Float32Array(1024); state.ptr = 0; state.init = true; }
let combfreq = params.combfreq !== undefined ? params.combfreq : 220;
let d = Math.max(2, Math.min(1023, Math.round(44100 / combfreq)));
let read = (state.ptr - d + 1024) % 1024;
let fb = state.buf[read];
state.buf[state.ptr] = inputSample + fb * 0.72;
state.ptr = (state.ptr + 1) % 1024;
return inputSample * 0.5 + fb * 0.6;`,
  },
  {
    id: "wobble_filter",
    title: "wobble filter (LFO-swept lowpass)",
    match: /wobble|wah|sweep|underwater|seasick|liquid|dub\b|drunk|lava/i,
    order: 30,
    role: "filter",
    parameters: [{ id: "wrate", name: "Wobble Rate", min: 0.1, max: 6, defaultValue: 0.9, unit: "Hz" }],
    body: `if (!state.init) { state.low = 0; state.band = 0; state.ph = 0; state.init = true; }
let wrate = params.wrate !== undefined ? params.wrate : 0.9;
state.ph += 2 * Math.PI * wrate / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
let cutoff = 900 + Math.sin(state.ph) * 750;
let f = 2 * Math.sin(Math.PI * Math.min(0.2, cutoff / 44100));
state.low += f * state.band;
let high = inputSample - state.low - 0.7 * state.band;
state.band += f * high;
return state.low * 1.25;`,
  },
  {
    id: "tone_lp",
    title: "tone lowpass",
    match: /dark|muffl|soft|underwater|deep|dream|smooth|warm/i,
    order: 34,
    role: "filter",
    parameters: [{ id: "tone", name: "Tone", min: 400, max: 12000, defaultValue: 4200, unit: "Hz" }],
    body: `if (!state.init) { state.lp = 0; state.init = true; }
let tone = params.tone !== undefined ? params.tone : 4200;
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (inputSample - state.lp);
return state.lp;`,
  },
  {
    id: "chopper",
    title: "rhythmic chopper",
    match: /chop|stutter|gate\b|rhythm|pulse|helicopter|strobe/i,
    order: 40,
    role: "modulator",
    parameters: [{ id: "chop", name: "Chop Rate", min: 0.5, max: 14, defaultValue: 5, unit: "Hz" }],
    body: `if (!state.init) { state.ph = 0; state.init = true; }
let chop = params.chop !== undefined ? params.chop : 5;
state.ph += chop / 44100;
if (state.ph > 1) state.ph -= 1;
let g = state.ph < 0.5 ? 1 : 0.12;
if (!state.g) state.g = g;
state.g += 0.008 * (g - state.g);
return inputSample * state.g;`,
  },
  {
    id: "echo",
    title: "damped echo",
    match: /echo|space|cosmic|trail|dream|cave|distant|repeat|bounce/i,
    order: 50,
    role: "time",
    parameters: [{ id: "time", name: "Echo Time", min: 60, max: 700, defaultValue: 240, unit: "ms" }, { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.45, unit: "ratio" }],
    body: `if (!state.init) { state.buf = new Float32Array(44100); state.ptr = 0; state.dm = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 240;
let feedback = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.45);
let d = Math.max(1, Math.min(44099, Math.floor(time * 44.1)));
let read = (state.ptr - d + 44100) % 44100;
let wet = state.buf[read];
state.dm += 0.4 * (wet - state.dm);
state.buf[state.ptr] = inputSample + state.dm * feedback;
state.ptr = (state.ptr + 1) % 44100;
return inputSample * 0.7 + wet * 0.65;`,
  },
];

/** Default chain when nothing votes: still characterful, never a shrug. */
const DEFAULT_STAGE_IDS = ["drive", "wobble_filter", "echo"];

/** Pick 2-4 stages by keyword votes, chain-ordered. Deterministic. */
export function inferStages(prompt: string): DspPrimitive[] {
  const voted = DSP_PRIMITIVES.filter((p) => p.match.test(prompt));
  const chosen = (voted.length >= 2 ? voted : DSP_PRIMITIVES.filter((p) => DEFAULT_STAGE_IDS.includes(p.id)))
    .sort((a, b) => a.order - b.order)
    .slice(0, 4);
  return chosen;
}

/**
 * The FULL voted pool (not capped to 4, threshold >=1 not >=2) for callers
 * that want to explore several relevant stages across repeated calls -- e.g.
 * the refinement loop cycling through candidates iteration by iteration.
 * Never mutates inferStages' own threshold/cap, which the deterministic
 * no-recipe BUILD path depends on for its exact chosen chain.
 */
export function promptRelevantPrimitives(prompt: string): DspPrimitive[] {
  const voted = DSP_PRIMITIVES.filter((p) => p.match.test(prompt));
  const pool = voted.length > 0 ? voted : DSP_PRIMITIVES.filter((p) => DEFAULT_STAGE_IDS.includes(p.id));
  return pool.slice().sort((a, b) => a.order - b.order);
}

/** Other primitives that do the SAME job (role) as `id` -- same-role siblings
 *  are interchangeable structural substitutes: same slot in the chain,
 *  different character. Empty when the primitive's role has no other member. */
export function siblingsOf(id: string): DspPrimitive[] {
  const stage = DSP_PRIMITIVES.find((p) => p.id === id);
  if (!stage) return [];
  return DSP_PRIMITIVES.filter((p) => p.id !== id && p.role === stage.role);
}

/** Replace the stage at `stageIndex` with a same-role sibling -- a genuine
 *  structural substitution (different DSP, same job in the chain), not a
 *  parameter nudge. Deterministic: `variantIndex` selects which sibling.
 *  Returns the SAME array reference when no sibling exists, so callers can
 *  detect a no-op with `!==`. */
export function swapSiblingInChain(stages: DspPrimitive[], stageIndex: number, variantIndex: number): DspPrimitive[] {
  const target = stages[stageIndex];
  if (!target) return stages;
  const siblings = siblingsOf(target.id);
  if (siblings.length === 0) return stages;
  const replacement = siblings[((variantIndex % siblings.length) + siblings.length) % siblings.length];
  return stages.map((s, i) => (i === stageIndex ? replacement : s));
}

/** Reverse a stage chain's order -- feeding the SAME set of primitives
 *  through in the opposite sequence is a genuinely different signal path
 *  (tone shaping before drive reaches different harmonic content than tone
 *  shaping after drive). No-op for chains of length <= 1. */
export function reverseChain(stages: DspPrimitive[]): DspPrimitive[] {
  return stages.length > 1 ? [...stages].reverse() : stages;
}

/* ------------------------------------------------------------------ */
/* Attaching a primitive stage to an ALREADY-BUILT plugin               */
/* (used by the refinement loop's structural search -- unlike            */
/* composePrimitiveGraph above, which composes from a fresh stage list,  */
/* these operate on an arbitrary EXISTING dspFunction of unknown          */
/* provenance: a golden recipe, a hybrid composition, or model output.)  */
/* ------------------------------------------------------------------ */

/** Convert a single-trailing-return body into a block that assigns `outVar`
 *  instead of returning. Null when the body doesn't have EXACTLY one
 *  top-level `return` -- early-return bodies (e.g. the pitch/autotune
 *  recipe) can't be safely block-scoped this way, so the caller must fall
 *  back to a different strategy rather than risk a broken chain. */
function toAssignedBlock(body: string, outVar: string): string | null {
  if ((body.match(/\breturn\b/g) || []).length !== 1) return null;
  const idx = body.lastIndexOf("return ");
  if (idx < 0) return null;
  const expr = body.slice(idx + "return ".length).replace(/;\s*$/, "");
  return `${body.slice(0, idx)}${outVar} = ${expr};`;
}

/** First unused id: `base`, then `base_2`, `base_3`, ... -- safe even when
 *  applied repeatedly across several structural passes in one loop run. */
function uniqueId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Pick a pair of scaffold variable names that do NOT appear anywhere in
 * `body`, textually. append/prependPrimitiveStage capture the wrapped base
 * body's own trailing `return` into one of these via toAssignedBlock -- if
 * `body` is itself the output of a PRIOR structural pass, it already
 * declares its own `let __struct0_0 = 0;` / `let __struct1_0 = 0;` at what
 * becomes (after this pass wraps it in a fresh `{ ... }`) a NESTED, more
 * deeply block-scoped position. Reusing the SAME fixed name for the new
 * pass's own scaffold would make the new pass's capture assignment land
 * INSIDE that nested block and silently target the prior pass's shadowed,
 * inner declaration instead of the new pass's outer one -- the outer
 * variable then stays permanently 0, and the whole base body it was
 * supposed to feed forward goes dark (this was caught empirically: nesting
 * a second structural pass produced deadParams covering nearly every
 * control and musicality 0 -- always REJECTED by the gate before it could
 * ship, but a real correctness bug all the same, not just noise). Picking
 * names proven absent from `body` makes shadowing impossible regardless of
 * how many prior passes are already nested inside it.
 */
function freshScaffoldNames(body: string): [outVar: string, stageVar: string] {
  let n = 0;
  while (new RegExp(`__struct0_${n}\\b`).test(body) || new RegExp(`__struct1_${n}\\b`).test(body)) n++;
  return [`__struct0_${n}`, `__struct1_${n}`];
}

export interface StageAttachResult {
  body: string;
  parameters: PluginParameter[];
}

/** Append a verified primitive stage AFTER an existing plugin's dspFunction
 *  -- the existing algorithm's output feeds the new stage, exactly like a
 *  finishing/character stage bolted onto the end of a signal chain. The
 *  existing body is preserved verbatim (only its `state.` references get a
 *  namespace prefix so declarations never collide). Null when the base body
 *  can't be safely wrapped (multiple/early returns) -- same contract as
 *  voicingVariant's "safe on ANY plugin", just for structure instead of
 *  parameters: the caller falls back when this returns null. */
export function appendPrimitiveStage(
  baseBody: string,
  baseParams: PluginParameter[],
  stage: DspPrimitive
): StageAttachResult | null {
  const [OUT0, OUT1] = freshScaffoldNames(baseBody);
  const namespacedBase = baseBody.replace(/\bstate\./g, "state.b0_");
  const baseBlock = toAssignedBlock(namespacedBase, OUT0);
  if (!baseBlock) return null;

  const existingIds = new Set(baseParams.map((p) => p.id));
  let stageBody = stage.body.replace(/\bstate\./g, "state.a1_").replace(/\binputSample\b/g, OUT0);
  const parameters: PluginParameter[] = baseParams.map((p) => ({ ...p }));
  for (const sp of stage.parameters) {
    const id = uniqueId(sp.id, existingIds);
    if (id !== sp.id) stageBody = stageBody.replace(new RegExp(`\\bparams\\.${sp.id}\\b`, "g"), `params.${id}`);
    parameters.push({ ...sp, id, value: sp.defaultValue });
    existingIds.add(id);
  }
  const stageBlock = toAssignedBlock(stageBody, OUT1);
  if (!stageBlock) return null;

  const body = [
    `let ${OUT0} = 0;`,
    `// --- EXISTING SIGNAL PATH (unchanged, state namespaced) ---`,
    `{\n${baseBlock}\n}`,
    `let ${OUT1} = 0;`,
    `// --- APPENDED STAGE: ${stage.title} ---`,
    `{\n${stageBlock}\n}`,
    `return ${OUT1};`,
  ].join("\n");

  return { body, parameters };
}

/** Prepend a verified primitive stage BEFORE an existing plugin's
 *  dspFunction -- the new stage conditions the raw input before the existing
 *  algorithm ever sees it, a different structural role than appending
 *  (pre-shaping the source vs. finishing the processed output). Same safety
 *  contract as appendPrimitiveStage: null when the base can't be wrapped. */
export function prependPrimitiveStage(
  baseBody: string,
  baseParams: PluginParameter[],
  stage: DspPrimitive
): StageAttachResult | null {
  const [OUT0, OUT1] = freshScaffoldNames(baseBody);
  const existingIds = new Set(baseParams.map((p) => p.id));
  let stageBody = stage.body.replace(/\bstate\./g, "state.a0_");
  const parameters: PluginParameter[] = [];
  for (const sp of stage.parameters) {
    const id = uniqueId(sp.id, existingIds);
    if (id !== sp.id) stageBody = stageBody.replace(new RegExp(`\\bparams\\.${sp.id}\\b`, "g"), `params.${id}`);
    parameters.push({ ...sp, id, value: sp.defaultValue });
    existingIds.add(id);
  }
  const stageBlock = toAssignedBlock(stageBody, OUT0);
  if (!stageBlock) return null;

  const namespacedBase = baseBody.replace(/\bstate\./g, "state.b1_").replace(/\binputSample\b/g, OUT0);
  const baseBlock = toAssignedBlock(namespacedBase, OUT1);
  if (!baseBlock) return null;

  parameters.push(...baseParams.map((p) => ({ ...p })));

  const body = [
    `let ${OUT0} = 0;`,
    `// --- PREPENDED STAGE: ${stage.title} ---`,
    `{\n${stageBlock}\n}`,
    `let ${OUT1} = 0;`,
    `// --- EXISTING SIGNAL PATH (unchanged, state namespaced) ---`,
    `{\n${baseBlock}\n}`,
    `return ${OUT1};`,
  ].join("\n");

  return { body, parameters };
}

export interface ComposedGraph {
  title: string;
  stageIds: string[];
  parameters: Array<Pick<PluginParameter, "id" | "name" | "min" | "max" | "defaultValue" | "unit">>;
  body: string;
}

/**
 * Assemble N stages into one dspFunction: each stage runs in its own block
 * scope with namespaced state; stage i consumes stage i-1's output; a global
 * Mix blends the chain against the dry input. Same invariants as
 * composeRecipes (single trailing return per stage body).
 */
export function composePrimitiveGraph(stages: DspPrimitive[]): ComposedGraph {
  const params: ComposedGraph["parameters"] = [];
  const seen = new Set<string>();
  const parts: string[] = [`let __x0 = inputSample;`];

  stages.forEach((stage, i) => {
    let body = stage.body.replace(/\bstate\./g, `state.s${i}_`).replace(/\binputSample\b/g, `__x${i}`);
    for (const p of stage.parameters) {
      let id = p.id;
      if (seen.has(id)) {
        id = `${p.id}_${i + 1}`;
        body = body.replace(new RegExp(`\\bparams\\.${p.id}\\b`, "g"), `params.${id}`);
        params.push({ ...p, id, name: `${p.name} ${i + 1}` });
      } else {
        params.push({ ...p });
      }
      seen.add(id);
    }
    const idx = body.lastIndexOf("return ");
    const expr = body.slice(idx + "return ".length).replace(/;\s*$/, "");
    body = `${body.slice(0, idx)}__x${i + 1} = ${expr};`;
    parts.push(`let __x${i + 1} = 0;\n// --- STAGE ${i + 1}: ${stage.title} ---\n{\n${body}\n}`);
  });

  params.push({ id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.85, unit: "ratio" });
  parts.push(`let mix = params.mix !== undefined ? params.mix : 0.85;
return Math.tanh(inputSample * (1 - mix) + __x${stages.length} * mix);`);

  return {
    title: stages.map((s) => s.title).join(" → "),
    stageIds: stages.map((s) => s.id),
    parameters: params,
    body: parts.join("\n\n"),
  };
}

/** One-call entry: infer stages from the prompt and compose the graph. */
export function buildPrimitiveGraph(prompt: string): ComposedGraph {
  return composePrimitiveGraph(inferStages(prompt));
}
