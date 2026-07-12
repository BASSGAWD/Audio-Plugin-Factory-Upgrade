/**
 * Build planner: the "compiler architecture" stage of the factory.
 *
 * Treats every build request as a software build with an explicit job graph
 * instead of one giant model call:
 *
 *   intent -> dsp_plan -> parameters -> dsp_code -> ui_spec -> validate
 *
 * Each job has a named worker, inputs, deterministic ACCEPTANCE TESTS, a
 * retry limit, and a recorded confidence — and every LLM-backed job has a
 * deterministic fallback (the verified recipe compiler), so a failed worker
 * degrades to a proven build, never to a broken plugin. The LLM decides WHAT
 * to build; deterministic code decides HOW, and validates everything.
 *
 * The full job trace lands in the BuildReport ("repair history"), so success
 * is always shown as evidence, never claimed.
 */

import { AudioPlugin, PluginParameter } from "../types";
import { AudioPluginSpec, classifyPluginIntent, familyToCategory, formatSpecContext, generatePluginSpec } from "./pluginSpec";
import { buildRecipeContext, scoreRecipes } from "./dspRecipes";
import { buildOfflinePlugin } from "./offlineBuilder";
import { DSP_PRIMITIVES, composePrimitiveGraph } from "./dspPrimitives";
import { LLMConfig, callLocalLLM, isLocalProvider } from "./llmGateway";
import { DSP_CODING_RULES, PARAMETER_DESIGN_RULES, RESPONSE_STYLE_RULES, SOUND_QUALITY_RULES } from "./dspPromptKit";
import { verifyAndRepairDsp } from "./pluginVerifier";
import { normalizeModelDspCode } from "./healthcheckRunner";
import { QualityGateResult, runQualityGate } from "./qualityGate";

/* ------------------------------------------------------------------ */
/* Job trace                                                           */
/* ------------------------------------------------------------------ */

export type JobStatus = "passed" | "repaired" | "fallback" | "failed";

export interface JobTrace {
  id: string;
  title: string;
  worker: string;
  status: JobStatus;
  attempts: number;
  ms: number;
  /** 0..1 — how much to trust this job's output. */
  confidence: number;
  /** Failure/repair evidence; "" when clean. */
  evidence: string;
}

/* ------------------------------------------------------------------ */
/* Injectable workers (LLM-backed; absent = deterministic build)       */
/* ------------------------------------------------------------------ */

export interface PluginMeta {
  pluginName: string;
  description: string;
  /** Conversational reply for the chat transcript. */
  text: string;
  parameters: PluginParameter[];
}

export interface PlannerWorkers {
  /** Parameter Agent: name/description/reply + parameter schema ONLY. */
  generatePluginMeta?: (input: { prompt: string; spec: AudioPluginSpec; recipeContext: string }) => Promise<any>;
  /** DSP Generator: dspFunction body ONLY, against a FIXED schema. */
  generateDspBody?: (input: { prompt: string; spec: AudioPluginSpec; recipeContext: string; parameters: PluginParameter[] }) => Promise<string>;
  /**
   * Graph Architect: for prompts matching NO verified recipe, choose 2-4
   * stages from the fixed DSP_PRIMITIVES menu instead of inventing DSP code
   * from scratch. Picking from a menu is a classification task weak models
   * handle far more reliably than freehand generation of novel algorithms —
   * this is what makes "no recipe" build something genuinely shaped by the
   * request instead of always landing on the same keyword-inferred chain.
   */
  selectPrimitiveStages?: (input: { prompt: string; spec: AudioPluginSpec }) => Promise<any>;
}

const META_WORKER_PROMPT = `You are the Parameter Architect of an audio plugin factory. You design the plugin's identity and control schema ONLY — another worker writes the DSP against your schema, so it must be final and complete.
Return ONLY JSON:
{
  "pluginName": "Creative Title",
  "description": "2-sentence honest description of what it does to the audio",
  "text": "conversational reply for the musician",
  "parameters": [ { "id": "drive", "name": "Drive", "min": 0, "max": 24, "defaultValue": 6, "unit": "dB" } ]
}
${PARAMETER_DESIGN_RULES}
${RESPONSE_STYLE_RULES}`;

const DSP_WORKER_PROMPT = `You are the DSP Generator of an audio plugin factory. You receive a FIXED parameter schema — you must read EVERY parameter id exactly as given (params.<id>), and you may not add, remove, or rename parameters. Adapt the verified reference implementation to the request.
Return ONLY JSON: { "dspFunction": "<JS body per the contract>" }
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}`;

const PRIMITIVE_MENU = DSP_PRIMITIVES.map((p) => `- "${p.id}": ${p.title}`).join("\n");

const GRAPH_WORKER_PROMPT = `You are the Graph Architect of an audio plugin factory. The request doesn't match any known effect family, so instead of writing DSP code, you pick 2 to 4 stages from this FIXED menu of verified building blocks to chain together:
${PRIMITIVE_MENU}
Return ONLY JSON: { "stageIds": ["stage_id_1", "stage_id_2"], "reasoning": "one short sentence" }
Pick stages whose character matches the request. Use ONLY the exact ids shown above — never invent a new id. Order does not matter; the compiler sequences the chain.`;

/** Default LLM-backed workers for whichever local provider is configured. */
export function buildLocalWorkers(llmConfig: LLMConfig, signal?: AbortSignal): PlannerWorkers {
  if (!isLocalProvider(llmConfig)) return {};
  return {
    generatePluginMeta: (input) =>
      callLocalLLM({
        config: llmConfig,
        systemPrompt: META_WORKER_PROMPT,
        userText: `${input.prompt}\n\n${formatSpecContext(input.spec)}${input.recipeContext ? `\n\nReference parameters from a verified build of this family:\n${input.recipeContext.slice(0, 1600)}` : ""}`,
        temperature: 0.3,
        signal,
      }),
    generateDspBody: async (input) => {
      const paramList = input.parameters
        .map((p) => `{ "id": "${p.id}", "min": ${p.min}, "max": ${p.max}, "defaultValue": ${p.defaultValue}, "unit": "${p.unit}" }`)
        .join(",\n");
      const payload = await callLocalLLM({
        config: llmConfig,
        systemPrompt: DSP_WORKER_PROMPT,
        userText: `${input.prompt}\n\n${formatSpecContext(input.spec)}\n\nFIXED parameter schema (read every one of these):\n[${paramList}]\n\n${input.recipeContext}`,
        temperature: 0.25,
        signal,
      });
      return typeof payload?.dspFunction === "string" ? payload.dspFunction : "";
    },
    selectPrimitiveStages: (input) =>
      callLocalLLM({
        config: llmConfig,
        systemPrompt: GRAPH_WORKER_PROMPT,
        userText: `${input.prompt}\n\n${formatSpecContext(input.spec)}`,
        temperature: 0.3,
        signal,
      }),
  };
}

/* ------------------------------------------------------------------ */
/* Acceptance tests (deterministic, per the architecture doc)          */
/* ------------------------------------------------------------------ */

/** Parameter-schema acceptance: returns error list ([] = accepted). */
export function validateParameterSchema(params: any): string[] {
  const errors: string[] = [];
  if (!Array.isArray(params)) return ["parameters is not an array"];
  if (params.length < 2 || params.length > 14) errors.push(`parameter count ${params.length} outside 2..14`);
  const ids = new Set<string>();
  for (const p of params) {
    if (!p || typeof p.id !== "string" || !/^[a-z][a-z0-9_]*$/i.test(p.id)) {
      errors.push(`invalid parameter id: ${JSON.stringify(p?.id)}`);
      continue;
    }
    if (ids.has(p.id)) errors.push(`duplicate parameter id: ${p.id}`);
    ids.add(p.id);
    if (typeof p.min !== "number" || typeof p.max !== "number" || !Number.isFinite(p.min) || !Number.isFinite(p.max) || p.min >= p.max) {
      errors.push(`${p.id}: min/max invalid (min ${p.min}, max ${p.max})`);
    }
    const dv = p.defaultValue;
    if (typeof dv !== "number" || !Number.isFinite(dv) || dv < p.min || dv > p.max) {
      errors.push(`${p.id}: defaultValue ${dv} outside [${p.min}, ${p.max}]`);
    }
  }
  return errors;
}

/** Stage-selection acceptance: returns error list ([] = accepted). Every id
 *  must be a real primitive, 2-4 stages, no duplicates. */
export function validateStageSelection(stageIds: any): string[] {
  const errors: string[] = [];
  if (!Array.isArray(stageIds)) return ["stageIds is not an array"];
  if (stageIds.length < 2 || stageIds.length > 4) errors.push(`stage count ${stageIds.length} outside 2..4`);
  const validIds = new Set(DSP_PRIMITIVES.map((p) => p.id));
  const seen = new Set<string>();
  for (const id of stageIds) {
    if (typeof id !== "string" || !validIds.has(id)) {
      errors.push(`unknown stage id: ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate stage id: ${id}`);
    seen.add(id);
  }
  return errors;
}

function toLiveParams(raw: any[]): PluginParameter[] {
  return raw.map((p: any) => ({
    unit: "",
    name: p.id,
    ...p,
    value: p.value !== undefined ? p.value : p.defaultValue,
  }));
}

/* ------------------------------------------------------------------ */
/* The planner                                                         */
/* ------------------------------------------------------------------ */

export interface PlannedBuild {
  plugin: AudioPlugin;
  gate: QualityGateResult;
  trace: JobTrace[];
  /** Chat reply: worker-written when available, honest fallback otherwise. */
  text: string;
  /** True when any LLM job was replaced by the deterministic compiler. */
  usedFallback: boolean;
}

export interface PlannerOptions {
  spec?: AudioPluginSpec | null;
  llmConfig?: LLMConfig;
  workers?: PlannerWorkers;
  signal?: AbortSignal;
  /** Called as each pipeline job starts (drives the UI status bar). */
  onStage?: (stageId: string) => void;
  /** Wall-clock start (performance.now()) for the latency score. */
  generationStart?: number;
}

/**
 * Run the full build plan. Never throws for worker failures — every job
 * degrades to the deterministic compiler, so the result always exists and
 * always went through the quality gate.
 */
export async function runPlannedBuild(prompt: string, opts: PlannerOptions = {}): Promise<PlannedBuild> {
  const trace: JobTrace[] = [];
  const t0 = opts.generationStart ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const job = (partial: Omit<JobTrace, "ms"> & { started: number }): void => {
    const { started, ...rest } = partial;
    trace.push({ ...rest, ms: Math.round(now() - started) });
  };

  const workers: PlannerWorkers =
    opts.workers ?? (opts.llmConfig ? buildLocalWorkers(opts.llmConfig, opts.signal) : {});

  // The deterministic compiler is both the fallback for every LLM job and
  // the whole implementation when no workers exist.
  const fallbackBuild = buildOfflinePlugin(prompt, opts.spec);
  let usedFallback = false;

  // ---- Job 1: intent (Intent Architect) ----
  opts.onStage?.("intent");
  let started = now();
  let spec = opts.spec ?? classifyPluginIntent(prompt);
  let intentStatus: JobStatus = "passed";
  let intentEvidence = "";
  if (!opts.spec && opts.llmConfig && isLocalProvider(opts.llmConfig) && (spec.hybrid || spec.family === "hybrid_other")) {
    try {
      spec = await generatePluginSpec(prompt, opts.llmConfig);
    } catch (err: any) {
      intentStatus = "fallback";
      intentEvidence = `LLM refinement failed (${err.message}); heuristic classification used`;
    }
  }
  job({ id: "intent", title: "Classify intent & DSP identity", worker: "Intent Architect", status: intentStatus, attempts: 1, confidence: spec.source === "llm" ? 0.9 : 0.8, evidence: intentEvidence, started });

  // ---- Job 2: dsp_plan (DSP Architect, or Graph Architect for no-recipe prompts) ----
  opts.onStage?.("plan");
  started = now();
  const scored = scoreRecipes(prompt, spec);
  const recipeContext = buildRecipeContext(prompt, spec);
  // No verified recipe matches at all -- offlineBuilder's own fallback path
  // (buildOfflinePlugin -> buildPrimitiveGraph) is exactly this condition
  // (amp_sim is handled separately upstream regardless of scored). Mirror it
  // here so the SAME prompt gets the SAME kind of build whether the offline
  // compiler or this planner produces it.
  const isNoRecipe = scored.length === 0 && spec.family !== "amp_sim";

  let graphStatus: JobStatus = "passed";
  let graphEvidence = "";
  let graphBuild: { parameters: PluginParameter[]; dspFunction: string; title: string } | null = null;

  if (isNoRecipe) {
    if (workers.selectPrimitiveStages) {
      try {
        const raw = await workers.selectPrimitiveStages({ prompt, spec });
        const errors = validateStageSelection(raw?.stageIds);
        if (errors.length === 0) {
          const chosen = raw.stageIds
            .map((id: string) => DSP_PRIMITIVES.find((p) => p.id === id)!)
            .sort((a: any, b: any) => a.order - b.order);
          const composed = composePrimitiveGraph(chosen);
          graphBuild = { parameters: toLiveParams(composed.parameters), dspFunction: composed.body, title: composed.title };
          graphEvidence = `chose stages: ${chosen.map((c: any) => c.id).join(" + ")}`;
        } else {
          graphStatus = "fallback";
          graphEvidence = `stage selection rejected (${errors.join("; ")}); keyword-inferred chain used`;
          usedFallback = true;
        }
      } catch (err: any) {
        graphStatus = "fallback";
        graphEvidence = `worker call failed (${err.message}); keyword-inferred chain used`;
        usedFallback = true;
      }
    } else {
      graphStatus = "fallback";
      graphEvidence = "no LLM worker; keyword-inferred chain used";
    }
    // Deterministic fallback == exactly what fallbackBuild already computed
    // (same buildPrimitiveGraph, same keyword inference, same prompt).
    if (!graphBuild) {
      graphBuild = { parameters: fallbackBuild.parameters, dspFunction: fallbackBuild.dspFunction, title: fallbackBuild.description };
    }
  }

  job({
    id: "dsp_plan", title: "Select DSP topology & references",
    worker: isNoRecipe ? "Graph Architect" : "DSP Architect",
    status: isNoRecipe ? graphStatus : "passed",
    attempts: 1,
    confidence: isNoRecipe ? (graphStatus === "passed" ? 0.75 : 0.6) : scored.length > 0 ? scored[0].confidence : 0.5,
    evidence: isNoRecipe ? graphEvidence : scored.length > 0 ? `references: ${scored.map((s) => s.recipe.id).join(" + ")}` : "no family reference",
    started,
  });

  // ---- Job 3: parameters (Parameter Agent; acceptance-tested, 1 retry) ----
  opts.onStage?.("parameters");
  started = now();
  let meta: PluginMeta = {
    pluginName: fallbackBuild.name,
    description: fallbackBuild.description,
    text: "",
    parameters: fallbackBuild.parameters,
  };
  let metaStatus: JobStatus = workers.generatePluginMeta ? "passed" : "fallback";
  let metaAttempts = 0;
  let metaEvidence = workers.generatePluginMeta ? "" : "no LLM worker; deterministic schema used";

  if (isNoRecipe) {
    // The parameter SCHEMA is authoritative from the composed graph (it must
    // match the DSP exactly) -- an LLM worker, if available, only supplies
    // creative naming/description here, never its own parameter list.
    meta.parameters = graphBuild!.parameters;
    metaAttempts = 1;
    if (workers.generatePluginMeta) {
      try {
        const raw = await workers.generatePluginMeta({
          prompt,
          spec,
          recipeContext: `[Composed primitive chain: ${graphBuild!.title} -- name and describe this build; your "parameters" field is ignored, the schema is fixed by the composed chain]`,
        });
        const name = typeof raw?.pluginName === "string" ? raw.pluginName.trim() : "";
        if (name) {
          meta.pluginName = name;
          meta.description = typeof raw.description === "string" && raw.description ? raw.description : fallbackBuild.description;
          meta.text = typeof raw.text === "string" ? raw.text : "";
          metaStatus = "passed";
        } else {
          metaStatus = "fallback";
          metaEvidence = "worker returned no usable name; deterministic naming used";
          usedFallback = true;
        }
      } catch (err: any) {
        metaStatus = "fallback";
        metaEvidence = `worker call failed (${err.message}); deterministic naming used`;
        usedFallback = true;
      }
    } else {
      metaStatus = "fallback";
      metaEvidence = "no LLM worker; deterministic naming used";
    }
  } else if (workers.generatePluginMeta) {
    let lastErrors: string[] = [];
    for (metaAttempts = 1; metaAttempts <= 2; metaAttempts++) {
      try {
        const raw = await workers.generatePluginMeta({
          prompt: metaAttempts === 1 ? prompt : `${prompt}\n\nYour previous schema FAILED acceptance tests: ${lastErrors.join("; ")}. Fix those exact problems.`,
          spec,
          recipeContext,
        });
        lastErrors = validateParameterSchema(raw?.parameters);
        if (lastErrors.length === 0) {
          meta = {
            pluginName: typeof raw.pluginName === "string" && raw.pluginName ? raw.pluginName : fallbackBuild.name,
            description: typeof raw.description === "string" && raw.description ? raw.description : fallbackBuild.description,
            text: typeof raw.text === "string" ? raw.text : "",
            parameters: toLiveParams(raw.parameters),
          };
          if (metaAttempts > 1) metaStatus = "repaired";
          break;
        }
      } catch (err: any) {
        lastErrors = [`worker call failed: ${err.message}`];
      }
      if (metaAttempts === 2) {
        metaStatus = "fallback";
        metaEvidence = `schema rejected after ${metaAttempts} attempts (${lastErrors.join("; ")}); deterministic schema used`;
        usedFallback = true;
      } else {
        metaEvidence = lastErrors.join("; ");
      }
    }
  }
  job({ id: "parameters", title: "Design parameter schema", worker: isNoRecipe ? "Naming Agent" : "Parameter Agent", status: metaStatus, attempts: Math.max(1, metaAttempts), confidence: metaStatus === "passed" ? 0.9 : metaStatus === "repaired" ? 0.75 : 0.95, evidence: metaEvidence, started });

  // ---- Job 4: dsp_code (DSP Generator + Repair Agent, or Graph Composer for no-recipe prompts) ----
  opts.onStage?.("dsp");
  started = now();
  let dspFunction = fallbackBuild.dspFunction;
  let dspStatus: JobStatus = "fallback";
  let dspAttempts = 1;
  let dspEvidence = workers.generateDspBody ? "" : "no LLM worker; verified recipe compiler used";

  if (isNoRecipe) {
    // The composed graph IS the DSP -- no freehand generation is attempted
    // for prompts with no reference at all; that's the harder task this
    // whole path exists to avoid.
    dspFunction = graphBuild!.dspFunction;
    dspStatus = graphStatus;
    dspAttempts = 1;
    dspEvidence = ""; // the "why" already lives on the dsp_plan job above
  } else if (workers.generateDspBody && metaStatus !== "fallback") {
    try {
      const candidate = normalizeModelDspCode(await workers.generateDspBody({ prompt, spec, recipeContext, parameters: meta.parameters }));
      if (!candidate.trim()) throw new Error("worker returned empty code");
      // Acceptance + bounded evidence-driven repair (Repair Agent)
      const verification = await verifyAndRepairDsp(candidate, meta.parameters, opts.llmConfig ?? ({ provider: "gemini" } as LLMConfig), 2, recipeContext);
      dspAttempts = verification.attempts + 1;
      if (verification.verified) {
        dspFunction = verification.dspFunction;
        dspStatus = verification.attempts > 0 ? "repaired" : "passed";
        dspEvidence = verification.notes.join(" | ");
      } else {
        dspEvidence = `unverified after ${dspAttempts} attempts (${verification.notes.slice(-1)[0] || "no evidence"}); verified recipe compiler used`;
        usedFallback = true;
      }
    } catch (err: any) {
      dspEvidence = `worker call failed (${err.message}); verified recipe compiler used`;
      usedFallback = true;
    }
  } else if (workers.generateDspBody && metaStatus === "fallback") {
    dspEvidence = "schema fell back, so the matching verified recipe DSP is used";
    usedFallback = true;
  }
  // A fallback DSP body only understands the fallback schema — keep them paired.
  if (!isNoRecipe && dspStatus === "fallback" && workers.generateDspBody) {
    meta = { ...meta, parameters: fallbackBuild.parameters, pluginName: meta.pluginName || fallbackBuild.name };
  }
  job({ id: "dsp_code", title: "Generate & verify DSP", worker: isNoRecipe ? (dspStatus === "passed" ? "Graph Composer" : "Deterministic Compiler") : dspStatus === "fallback" ? "Deterministic Compiler" : "DSP Generator", status: dspStatus, attempts: dspAttempts, confidence: dspStatus === "passed" ? 0.9 : dspStatus === "repaired" ? 0.7 : 0.95, evidence: dspEvidence, started });

  // ---- Job 5 + 6: ui_spec & validate (UI Planner + QA Agent — the gate) ----
  opts.onStage?.("validate");
  started = now();
  const candidatePlugin: AudioPlugin = {
    id: `plugin-${Date.now()}`,
    name: meta.pluginName,
    category: familyToCategory(spec.family),
    description: meta.description,
    parameters: meta.parameters,
    dspFunction,
    faustCode: "",
    cppJuceCode: "",
    createdAt: new Date().toLocaleDateString(),
  };
  let gate = runQualityGate(candidatePlugin, { generationMs: now() - t0, family: spec.family, prompt, intent: spec.interpretedGoal });
  let qaStatus: JobStatus = "passed";
  let qaEvidence = "";
  const minScore = (g: QualityGateResult) => Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);

  // QA acceptance: >=97 on every dimension, or swap in the deterministic
  // build and re-validate (the repair job the doc's step 16 describes).
  if (minScore(gate) < 97 && (dspStatus === "passed" || dspStatus === "repaired")) {
    qaEvidence = `LLM build scored ${minScore(gate)} (<97): ${gate.report.deadParams.length > 0 ? `dead controls ${gate.report.deadParams.join(",")}` : "below floor"}; deterministic build substituted`;
    const rebuilt: AudioPlugin = {
      ...candidatePlugin,
      name: fallbackBuild.name,
      description: fallbackBuild.description,
      parameters: fallbackBuild.parameters,
      dspFunction: fallbackBuild.dspFunction,
    };
    gate = runQualityGate(rebuilt, { generationMs: now() - t0, family: spec.family, prompt, intent: spec.interpretedGoal });
    qaStatus = "repaired";
    usedFallback = true;
  }
  job({ id: "validate", title: "UI spec, layout & quality gate", worker: "QA Agent", status: qaStatus, attempts: qaStatus === "repaired" ? 2 : 1, confidence: minScore(gate) / 100, evidence: qaEvidence, started });

  // Attach the trace to the report (the doc's "Repair History").
  gate.report.jobs = trace;
  if (gate.plugin.buildReport) gate.plugin.buildReport.jobs = trace;

  const text =
    meta.text && !usedFallback
      ? meta.text
      : usedFallback
      ? `${fallbackBuild.summary}\n\n_(One or more model workers failed acceptance tests, so the verified deterministic compiler finished the build — details in the report below.)_`
      : fallbackBuild.summary;

  return { plugin: gate.plugin, gate, trace, text, usedFallback };
}
