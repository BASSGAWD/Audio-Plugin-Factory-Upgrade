/**
 * Build-planner tests: the job graph must produce a gate-passing plugin for
 * every worker behavior — perfect workers, flaky workers (bad then good),
 * and hostile workers (always broken) — with an honest trace every time.
 * Mock workers stand in for LLMs so this runs deterministically in CI.
 */

import { runPlannedBuild, validateParameterSchema, validateStageSelection, PlannerWorkers } from "../src/utils/buildPlanner";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { formatBuildReport } from "../src/utils/qualityGate";
import { parseModelJson } from "../src/utils/llmGateway";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const minScore = (g: any) => Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);

const GOOD_PARAMS = [
  { id: "time", name: "Time", min: 20, max: 1500, defaultValue: 350, unit: "ms" },
  { id: "feedback", name: "Feedback", min: 0, max: 0.95, defaultValue: 0.45, unit: "ratio" },
  { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
];
const GOOD_DSP = DSP_RECIPES.find((r) => r.id === "delay")!.body;

(async () => {
  /* 0. JSON salvage: local models without JSON mode append chatter */
  check("parseModelJson: trailing text after object", parseModelJson('{"a":1}\nHope that helps!').a === 1);
  check("parseModelJson: leading chatter before object", parseModelJson('Sure! Here you go:\n{"a":2}').a === 2);
  check("parseModelJson: two objects takes the first", parseModelJson('{"a":3}\n{"a":99}').a === 3);
  check("parseModelJson: raw newlines inside strings repaired", parseModelJson(String.fromCharCode(123)+String.fromCharCode(34)+"dspFunction"+String.fromCharCode(34)+":"+String.fromCharCode(34)+"let a=1;"+String.fromCharCode(10)+"return a;"+String.fromCharCode(34)+String.fromCharCode(125)).dspFunction.includes("return a"));
check("parseModelJson: braces inside strings survive", parseModelJson('{"code":"if (x) { y(); }"} trailing').code === "if (x) { y(); }");

  /* 1. Schema acceptance tests */
  check("schema: accepts a valid schema", validateParameterSchema(GOOD_PARAMS).length === 0);
  check("schema: rejects non-array", validateParameterSchema("nope").length > 0);
  check("schema: rejects duplicate ids", validateParameterSchema([...GOOD_PARAMS, { ...GOOD_PARAMS[0] }]).length > 0);
  check("schema: rejects default outside range", validateParameterSchema([{ id: "a", min: 0, max: 1, defaultValue: 5, unit: "" }, GOOD_PARAMS[0]]).length > 0);
  check("schema: rejects min >= max", validateParameterSchema([{ id: "a", min: 2, max: 1, defaultValue: 1.5, unit: "" }, GOOD_PARAMS[0]]).length > 0);

  /* 2. No workers at all -> pure deterministic plan, still gate-passing */
  const det = await runPlannedBuild("make a warm tape delay");
  check("deterministic plan: gate >= 97", minScore(det.gate) >= 97, `min=${minScore(det.gate)}`);
  check("deterministic plan: full 5-job trace", det.trace.length === 5 && det.trace.map((j) => j.id).join(",") === "intent,dsp_plan,parameters,dsp_code,validate", det.trace.map((j) => j.id).join(","));
  check("deterministic plan: report carries the trace", (det.gate.report.jobs || []).length === 5);
  check("deterministic plan: no job failed", det.trace.every((j) => j.status !== "failed"));

  /* 3. Perfect workers -> passes with no fallback */
  const perfect: PlannerWorkers = {
    generatePluginMeta: async () => ({ pluginName: "Golden Echo", description: "A warm tape delay.", text: "Built you a warm tape delay — Time sets the echo, Feedback the repeats.", parameters: GOOD_PARAMS }),
    generateDspBody: async () => GOOD_DSP,
  };
  const good = await runPlannedBuild("make a warm tape delay", { workers: perfect });
  check("perfect workers: gate >= 97", minScore(good.gate) >= 97, `min=${minScore(good.gate)}`);
  check("perfect workers: no fallback used", !good.usedFallback);
  check("perfect workers: worker reply used as chat text", good.text.startsWith("Built you a warm tape delay"));
  check("perfect workers: plugin named by the worker", good.plugin.name === "Golden Echo");
  check("perfect workers: dsp job passed first try", good.trace.find((j) => j.id === "dsp_code")!.status === "passed");

  /* 4. Flaky schema worker: invalid once, valid on retry -> repaired */
  let metaCalls = 0;
  const flaky: PlannerWorkers = {
    generatePluginMeta: async () => {
      metaCalls++;
      if (metaCalls === 1) return { pluginName: "Bad", description: "", text: "", parameters: [{ id: "x", min: 5, max: 1, defaultValue: 9, unit: "" }] };
      return { pluginName: "Golden Echo II", description: "d", text: "t", parameters: GOOD_PARAMS };
    },
    generateDspBody: async () => GOOD_DSP,
  };
  const repaired = await runPlannedBuild("make a warm tape delay", { workers: flaky });
  const metaJob = repaired.trace.find((j) => j.id === "parameters")!;
  check("flaky schema: repaired on retry with evidence fed back", metaJob.status === "repaired" && metaJob.attempts === 2, `status=${metaJob.status} attempts=${metaJob.attempts}`);
  check("flaky schema: final build still >= 97", minScore(repaired.gate) >= 97);

  /* 5. Hostile DSP worker: always-broken code -> deterministic fallback, honest trace */
  const hostile: PlannerWorkers = {
    generatePluginMeta: async () => ({ pluginName: "Trap", description: "d", text: "t", parameters: GOOD_PARAMS }),
    generateDspBody: async () => "let mix = 1;\nlet mix = 2;\nreturn inputSample;",
  };
  const rescued = await runPlannedBuild("make a warm tape delay", { workers: hostile });
  const dspJob = rescued.trace.find((j) => j.id === "dsp_code")!;
  check("hostile dsp: falls back to the verified compiler", dspJob.status === "fallback", `status=${dspJob.status}`);
  check("hostile dsp: final build still >= 97", minScore(rescued.gate) >= 97, `min=${minScore(rescued.gate)}`);
  check("hostile dsp: fallback flagged to the user", rescued.usedFallback && /deterministic compiler/i.test(rescued.text));
  check("hostile dsp: params re-paired with fallback dsp", rescued.plugin.parameters.some((p) => p.id === "time" || p.id === "mix"));

  /* 6. Silent-but-valid DSP (compiles, no sound) -> QA gate substitutes */
  const silent: PlannerWorkers = {
    generatePluginMeta: async () => ({ pluginName: "Mute", description: "d", text: "t", parameters: GOOD_PARAMS }),
    generateDspBody: async () => "return 0;",
  };
  const unmuted = await runPlannedBuild("make a warm tape delay", { workers: silent });
  check("silent dsp: final build still >= 97", minScore(unmuted.gate) >= 97, `min=${minScore(unmuted.gate)}`);
  check("silent dsp: trace shows the rescue", unmuted.trace.some((j) => j.status === "fallback" || j.status === "repaired"));

  /* 7. Report rendering includes the pipeline */
  const rendered = formatBuildReport(rescued.gate.report);
  check("report renders pipeline line", /Pipeline: intent .* → dsp_plan .* → parameters .* → dsp_code .* → validate/.test(rendered));
  check("report surfaces fallback evidence", /Deterministic Compiler|verified recipe compiler/i.test(rendered));

  /* 8. Graph Architect stage-selection acceptance tests */
  check("stage selection: accepts a valid pair", validateStageSelection(["ring_mod", "bitcrush"]).length === 0);
  check("stage selection: rejects non-array", validateStageSelection("nope").length > 0);
  check("stage selection: rejects unknown ids", validateStageSelection(["not_a_real_stage", "drive"]).length > 0);
  check("stage selection: rejects duplicates", validateStageSelection(["drive", "drive"]).length > 0);
  check("stage selection: rejects too few", validateStageSelection(["drive"]).length > 0);
  check("stage selection: rejects too many", validateStageSelection(["drive", "echo", "bitcrush", "ring_mod", "wavefold"]).length > 0);

  /* 9. No-recipe prompts: the Graph Architect job (replaces freehand DSP
   *    generation for prompts with no verified recipe reference at all) */
  const noRecipePrompt = "granular texture mangler";

  // 9a. No worker at all -> keyword-inferred chain, matches the offline
  //     compiler exactly, no usedFallback flip (no worker was ever attempted).
  const noRecipeDet = await runPlannedBuild(noRecipePrompt);
  const detPlanJob = noRecipeDet.trace.find((j) => j.id === "dsp_plan")!;
  const detDspJob = noRecipeDet.trace.find((j) => j.id === "dsp_code")!;
  check("no-recipe (no worker): gate >= 97", minScore(noRecipeDet.gate) >= 97, `min=${minScore(noRecipeDet.gate)}`);
  check("no-recipe (no worker): dsp_plan labeled Graph Architect", detPlanJob.worker === "Graph Architect", detPlanJob.worker);
  check("no-recipe (no worker): dsp_plan/dsp_code both fallback", detPlanJob.status === "fallback" && detDspJob.status === "fallback");
  check("no-recipe (no worker): no usedFallback flip (nothing was attempted)", !noRecipeDet.usedFallback);
  check("no-recipe (no worker): dsp_code worker is the Deterministic Compiler", detDspJob.worker === "Deterministic Compiler");

  // 9b. LLM picks a VALID stage selection -> composed from those exact stages.
  const graphWorkers: PlannerWorkers = {
    selectPrimitiveStages: async () => ({ stageIds: ["ring_mod", "bitcrush"], reasoning: "metallic and glitchy" }),
  };
  const noRecipeGood = await runPlannedBuild(noRecipePrompt, { workers: graphWorkers });
  const goodPlanJob = noRecipeGood.trace.find((j) => j.id === "dsp_plan")!;
  const goodDspJob = noRecipeGood.trace.find((j) => j.id === "dsp_code")!;
  check("no-recipe (LLM picks stages): dsp_plan passed with evidence naming the stages", goodPlanJob.status === "passed" && /ring_mod/.test(goodPlanJob.evidence) && /bitcrush/.test(goodPlanJob.evidence), goodPlanJob.evidence);
  check("no-recipe (LLM picks stages): dsp_code composed by the Graph Composer", goodDspJob.status === "passed" && goodDspJob.worker === "Graph Composer");
  check("no-recipe (LLM picks stages): chosen stages' params present", noRecipeGood.plugin.parameters.some((p) => p.id === "ringfreq") && noRecipeGood.plugin.parameters.some((p) => p.id === "crush"), noRecipeGood.plugin.parameters.map((p) => p.id).join(","));
  check("no-recipe (LLM picks stages): gate >= 97", minScore(noRecipeGood.gate) >= 97, `min=${minScore(noRecipeGood.gate)}`);
  check("no-recipe (LLM picks stages): no fallback needed", !noRecipeGood.usedFallback);

  // 9c. LLM picks an INVALID selection -> rejected, keyword-inferred chain used.
  const graphBadWorkers: PlannerWorkers = {
    selectPrimitiveStages: async () => ({ stageIds: ["not_a_real_stage", "also_fake"] }),
  };
  const noRecipeBad = await runPlannedBuild(noRecipePrompt, { workers: graphBadWorkers });
  const badPlanJob = noRecipeBad.trace.find((j) => j.id === "dsp_plan")!;
  check("no-recipe (bad selection): dsp_plan falls back with rejection evidence", badPlanJob.status === "fallback" && /rejected/.test(badPlanJob.evidence), badPlanJob.evidence);
  check("no-recipe (bad selection): usedFallback flagged (a worker attempt genuinely failed)", noRecipeBad.usedFallback);
  check("no-recipe (bad selection): gate >= 97", minScore(noRecipeBad.gate) >= 97, `min=${minScore(noRecipeBad.gate)}`);

  // 9d. LLM call throws -> same graceful fallback.
  const graphThrowWorkers: PlannerWorkers = {
    selectPrimitiveStages: async () => { throw new Error("LM Studio returned status 500"); },
  };
  const noRecipeThrow = await runPlannedBuild(noRecipePrompt, { workers: graphThrowWorkers });
  const throwPlanJob = noRecipeThrow.trace.find((j) => j.id === "dsp_plan")!;
  check("no-recipe (worker throws): dsp_plan falls back with the error evidence", throwPlanJob.status === "fallback" && /worker call failed/.test(throwPlanJob.evidence), throwPlanJob.evidence);
  check("no-recipe (worker throws): usedFallback flagged", noRecipeThrow.usedFallback);
  check("no-recipe (worker throws): gate >= 97", minScore(noRecipeThrow.gate) >= 97, `min=${minScore(noRecipeThrow.gate)}`);

  // 9e. Regression safety: a RECIPE-MATCHED prompt must ignore selectPrimitiveStages
  //     entirely and keep behaving exactly like the original recipe path.
  const recipeWithGraphWorker = await runPlannedBuild("make a warm tape delay", { workers: graphWorkers });
  const recipePlanJob = recipeWithGraphWorker.trace.find((j) => j.id === "dsp_plan")!;
  check("recipe-matched prompt: dsp_plan stays DSP Architect even with a Graph worker present", recipePlanJob.worker === "DSP Architect", recipePlanJob.worker);
  check("recipe-matched prompt: still gate >= 97", minScore(recipeWithGraphWorker.gate) >= 97);

  console.log(failures === 0 ? "\nPLANNER: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
