/**
 * Calibration repair — turning a functional-fitness GRADIENT into a FIX.
 *
 * fitnessDelay/fitnessFilter/fitnessModulation/fitnessSynth already compute
 * an exact, signed error against a knob's own label. These tests prove the
 * repair pipeline (calibrateParamScaling + scaleParamReads) turns that error
 * into a mechanical correction, applies it, RE-MEASURES, and keeps it only
 * when fitness measurably improved — never assumed. Per project convention:
 * measure the honest implementation AND a deliberately miscalibrated
 * counterpart, assert a DECISIVE gap; relationships and gaps, never brittle
 * absolute constants (another agent is concurrently reworking the DSP bodies
 * these numbers come from).
 */
import {
  measureFunctionalFitness,
  runQualityGate,
  calibrateParamScaling,
  scaleParamReads,
  verifyParamSemantics,
  FunctionalFitness,
  MusicalityMeasurement,
} from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, min: number, max: number, def: number, unit = ""): PluginParameter =>
  ({ id, name: id, min, max, defaultValue: def, value: def, unit } as PluginParameter);

/* ------------------------------------------------------------------ */
/* 1. scaleParamReads — the textual rewrite, in isolation               */
/* ------------------------------------------------------------------ */
{
  const body = `let time = params.time !== undefined ? params.time : 350;
return Math.tanh(inputSample * time * 0.001);`;
  const scaled = scaleParamReads(body, "time", 2);
  check("scaleParamReads: rewrites the value read", !!scaled && scaled.includes("(params.time * 2)"), scaled || "null");
  check("scaleParamReads: leaves the undefined-guard comparison untouched", !!scaled && scaled.includes("params.time !== undefined"), scaled || "null");

  const noMatch = scaleParamReads(body, "notInBody", 2);
  check("scaleParamReads: null when the id never appears", noMatch === null);

  // "time2" must never be mistaken for "time" -- word-boundary guard.
  const collision = scaleParamReads("let x = params.time2;", "time", 2);
  check("scaleParamReads: does not match a longer identifier sharing a prefix", collision === null, String(collision));

  // A body that WRITES to the parameter must be refused, not silently mis-rewritten.
  const writes = scaleParamReads("params.time = 5; return params.time;", "time", 2);
  check("scaleParamReads: refuses a body that assigns to the parameter", writes === null, String(writes));

  // Bracket notation must be recognized too.
  const bracket = scaleParamReads(`let t = params['time'] !== undefined ? params["time"] : 1; return t;`, "time", 3);
  check("scaleParamReads: rewrites bracket-notation reads", !!bracket && bracket.includes("* 3"), bracket || "null");
}

/* ------------------------------------------------------------------ */
/* 2. Delay: a knob claiming 2x its real delay time gets fixed          */
/* ------------------------------------------------------------------ */
{
  const params = [P("time", 20, 1500, 350, "ms"), P("feedback", 0, 0.9, 0.45), P("mix", 0, 1, 0.5)];
  const honestBody = `if (!state.init) { state.buf = new Float32Array(96000); state.p = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 350;
let fb = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.45);
let mix = params.mix !== undefined ? params.mix : 0.5;
let d = Math.max(1, Math.min(95999, Math.floor(time * 44.1)));
let wet = state.buf[(state.p - d + 96000) % 96000];
state.buf[state.p] = inputSample + wet * fb;
state.p = (state.p + 1) % 96000;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`;
  // Same code, but the delay line is only HALF the requested time -- the
  // exact bug functionalFitnessTest already proves the SCORE catches; here we
  // prove the gate REPAIRS it.
  const lyingBody = honestBody.replace("Math.floor(time * 44.1)", "Math.floor(time * 22.05)");

  const before = measureFunctionalFitness(lyingBody, params, "delay");
  check("delay: the miscalibrated build carries a calibration gradient", !!before?.calibration && before.calibration.paramId === "time", before ? JSON.stringify(before.calibration) : "none");
  check("delay: the gradient factor is close to the true 2x error", !!before?.calibration && Math.abs(before.calibration.factor - 2) < 0.15, before ? String(before.calibration?.factor) : "none");

  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: params.map((p) => p.id), unstableParams: [], silentOnSignals: [], evidence: "" };
  const repaired = calibrateParamScaling(lyingBody, params, "delay", baseMus, before);
  check("delay: the repair is applied", repaired.repairs.length === 1, JSON.stringify(repaired.repairs));
  check("delay: fitness improves decisively after repair", !!repaired.fitness && !!before && repaired.fitness.score > before.score + 40, `before=${before?.score} after=${repaired.fitness?.score}`);
  check("delay: the repaired code compiles and still renders", !repaired.musicality.fatal && !repaired.musicality.isSilent);

  // Full gate: the repair must show up in the build report and the shipped
  // dspFunction must be the REPAIRED code (not just a note about it).
  const plugin: AudioPlugin = { id: "t", name: "t", category: "delay", description: "", parameters: params.map((p) => ({ ...p, value: p.defaultValue })), dspFunction: lyingBody, faustCode: "", cppJuceCode: "", createdAt: "" };
  const gate = runQualityGate(plugin, { family: "delay", prompt: "test delay" });
  check("delay: full gate records the calibration repair", (gate.report.calibrationRepairs?.length ?? 0) === 1, JSON.stringify(gate.report.calibrationRepairs));
  check("delay: full gate's shipped functionalFitness reflects the repaired score", !!gate.report.functionalFitness && !!before && gate.report.functionalFitness.score > before.score + 40, `before=${before?.score} shipped=${gate.report.functionalFitness?.score}`);
  check("delay: shipped dspFunction is the rewritten code, not the original", gate.plugin.dspFunction !== lyingBody && gate.plugin.dspFunction.includes("params.time * "));
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  check("delay: headline floor still >= 97 after repair (informational only)", min >= 97, `min=${min}`);
}

/* ------------------------------------------------------------------ */
/* 3. Filter: a Cutoff knob that is silently scaled 0.4x gets fixed     */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "filter")!;
  const params = golden.parameters as PluginParameter[];
  const honestBody = golden.body;
  const lyingBody = honestBody.replace(
    "let cutoff = params.cutoff !== undefined ? params.cutoff : 1400;",
    "let cutoff = (params.cutoff !== undefined ? params.cutoff : 1400) * 0.4;"
  );
  check("filter: the mutation actually changed the body", lyingBody !== honestBody);

  const honestFit = measureFunctionalFitness(honestBody, params, "filter");
  check("filter: the honest golden recipe carries no calibration gradient", !honestFit?.calibration, honestFit ? JSON.stringify(honestFit.calibration) : "none");

  const before = measureFunctionalFitness(lyingBody, params, "filter");
  check("filter: the scaled-cutoff build carries a calibration gradient", !!before?.calibration && before.calibration.paramId === "cutoff", before ? JSON.stringify(before.calibration) : "none");

  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: params.map((p) => p.id), unstableParams: [], silentOnSignals: [], evidence: "" };
  const repaired = calibrateParamScaling(lyingBody, params, "filter", baseMus, before);
  check("filter: the repair is applied", repaired.repairs.length >= 1, JSON.stringify(repaired.repairs));
  check("filter: fitness improves decisively after repair", !!repaired.fitness && !!before && repaired.fitness.score > before.score + 25, `before=${before?.score} after=${repaired.fitness?.score}`);

  const plugin: AudioPlugin = { id: "t", name: "t", category: "filter", description: "", parameters: params.map((p) => ({ ...p, value: p.defaultValue })), dspFunction: lyingBody, faustCode: "", cppJuceCode: "", createdAt: "" };
  const gate = runQualityGate(plugin, { family: "filter", prompt: "test filter" });
  check("filter: full gate records the calibration repair", (gate.report.calibrationRepairs?.length ?? 0) >= 1, JSON.stringify(gate.report.calibrationRepairs));
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  check("filter: headline floor still >= 97 after repair", min >= 97, `min=${min}`);
}

/* ------------------------------------------------------------------ */
/* 4. Modulation: a Rate knob whose LFO actually runs at half speed     */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "modulation")!;
  const params = golden.parameters as PluginParameter[];
  const honestBody = golden.body;
  const lyingBody = honestBody.replace(
    "let rate = params.rate !== undefined ? params.rate : 0.8;",
    "let rate = (params.rate !== undefined ? params.rate : 0.8) * 0.5;"
  );
  check("modulation: the mutation actually changed the body", lyingBody !== honestBody);

  const honestFit = measureFunctionalFitness(honestBody, params, "modulation");
  check("modulation: the honest golden recipe carries no calibration gradient", !honestFit?.calibration, honestFit ? JSON.stringify(honestFit.calibration) : "none");

  const before = measureFunctionalFitness(lyingBody, params, "modulation");
  check("modulation: the half-rate build carries a calibration gradient", !!before?.calibration && before.calibration.paramId === "rate", before ? JSON.stringify(before.calibration) : "none");
  check("modulation: the gradient factor is close to the true 2x error", !!before?.calibration && Math.abs(before.calibration.factor - 2) < 0.3, before ? String(before.calibration?.factor) : "none");

  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: params.map((p) => p.id), unstableParams: [], silentOnSignals: [], evidence: "" };
  const repaired = calibrateParamScaling(lyingBody, params, "modulation", baseMus, before);
  check("modulation: the repair is applied", repaired.repairs.length === 1, JSON.stringify(repaired.repairs));
  check("modulation: fitness improves after repair", !!repaired.fitness && !!before && repaired.fitness.score > before.score + 10, `before=${before?.score} after=${repaired.fitness?.score}`);

  const plugin: AudioPlugin = { id: "t", name: "t", category: "modulation", description: "", parameters: params.map((p) => ({ ...p, value: p.defaultValue })), dspFunction: lyingBody, faustCode: "", cppJuceCode: "", createdAt: "" };
  const gate = runQualityGate(plugin, { family: "modulation", prompt: "test chorus" });
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  check("modulation: headline floor still >= 97 after repair", min >= 97, `min=${min}`);
}

/* ------------------------------------------------------------------ */
/* 5. Synth: a Pitch knob whose oscillator actually runs at 0.8x        */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "synth")!;
  const params = golden.parameters as PluginParameter[];
  const honestBody = golden.body;
  const lyingBody = honestBody.replace(
    "let freq = params.freq !== undefined ? params.freq : 220;",
    "let freq = (params.freq !== undefined ? params.freq : 220) * 0.8;"
  );
  check("synth: the mutation actually changed the body", lyingBody !== honestBody);

  const before = measureFunctionalFitness(lyingBody, params, "synthesizer");
  check("synth: the scaled-pitch build carries a calibration gradient", !!before?.calibration && before.calibration.paramId === "freq", before ? JSON.stringify(before.calibration) : "none");

  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: params.map((p) => p.id), unstableParams: [], silentOnSignals: [], evidence: "" };
  const repaired = calibrateParamScaling(lyingBody, params, "synthesizer", baseMus, before);
  check("synth: the repair is applied", repaired.repairs.length === 1, JSON.stringify(repaired.repairs));
  check("synth: fitness improves decisively after repair", !!repaired.fitness && !!before && repaired.fitness.score > before.score + 20, `before=${before?.score} after=${repaired.fitness?.score}`);

  // Headline-floor comparison here is against the UNREPAIRED mutant, not a
  // bare >= 97 -- this particular hand-crafted mutation (a scaled Root
  // Frequency) also happens to perturb the synth's Cutoff-brightness
  // semantic check (a pre-existing near-noise-floor measurement on this
  // GENERATOR recipe, present identically with calibration disabled; see
  // 5b below). The claim a calibration repair must actually satisfy is
  // narrower and exact: it must never leave the shipped build WORSE than
  // the unrepaired original, on every headline dimension.
  const plugin: AudioPlugin = { id: "t", name: "t", category: "synthesizer" as any, description: "", parameters: params.map((p) => ({ ...p, value: p.defaultValue })), dspFunction: lyingBody, faustCode: "", cppJuceCode: "", createdAt: "" };
  const unrepairedGate = runQualityGate(plugin, { family: null, prompt: "test synth" }); // no family -> fitness never measured -> no repair
  const gate = runQualityGate(plugin, { family: "synthesizer", prompt: "test synth" });
  const dims: (keyof typeof gate.scores)[] = ["looks", "performance", "latency", "musicality"];
  const anyRegressed = dims.some((d) => gate.scores[d] < unrepairedGate.scores[d]);
  check(
    "synth: the repair never leaves the build worse than the unrepaired mutant on any headline dimension",
    !anyRegressed,
    `unrepaired=${JSON.stringify(unrepairedGate.scores)} repaired=${JSON.stringify(gate.scores)}`
  );
}

/* ------------------------------------------------------------------ */
/* 5b. The repair must never buy fitness by regressing semantics.       */
/* At a 0.75x pitch mutation the pitch DETECTOR's own imprecision (it   */
/* reports a corrective factor slightly short of the exact 1/0.75) is   */
/* just large enough that "correcting" it shifts the harmonic content   */
/* fed to the SVF and flips an already-marginal Cutoff brightness check */
/* (5.7e-5 vs 4.9e-5 on the UNMODIFIED golden recipe -- both essentially */
/* at the measurement noise floor). This is exactly the class of        */
/* trade-off calibrateParamScaling must refuse: it must not repair one  */
/* form of correctness by breaking another. This was discovered while   */
/* building this suite, not invented for it -- it is the regression     */
/* test for that discovery. ---------------------------------------- */
{
  const golden = DSP_RECIPES.find((r) => r.id === "synth")!;
  const params = golden.parameters as PluginParameter[];
  const marginalBody = golden.body.replace(
    "let freq = params.freq !== undefined ? params.freq : 220;",
    "let freq = (params.freq !== undefined ? params.freq : 220) * 0.75;"
  );
  const skipIds = new Set<string>();
  const baselineViolations = verifyParamSemantics(golden.body, params, skipIds).violations.length;

  const before = measureFunctionalFitness(marginalBody, params, "synthesizer");
  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: params.map((p) => p.id), unstableParams: [], silentOnSignals: [], evidence: "" };
  const result = calibrateParamScaling(marginalBody, params, "synthesizer", baseMus, before);
  const finalViolations = verifyParamSemantics(result.dspFunction, params, skipIds).violations.length;
  check(
    "synth: whatever the repair pass ships never carries MORE semantic violations than the untouched golden recipe",
    finalViolations <= baselineViolations,
    `baseline=${baselineViolations} final=${finalViolations} repairsApplied=${result.repairs.length}`
  );
}

/* ------------------------------------------------------------------ */
/* 6. calibrateParamScaling refuses unsafe or meaningless repairs       */
/* ------------------------------------------------------------------ */
{
  const params = [P("time", 20, 1500, 350, "ms")];
  const body = `let time = params.time !== undefined ? params.time : 350; return Math.tanh(inputSample * time * 0.0001);`;
  const baseMus: MusicalityMeasurement = { ok: true, inputRms: 0, outputRms: 0, gainOffsetDb: 0, suggestedTrim: 1, isSilent: false, clippingRatio: 0, dcOffset: 0, deadParams: [], audibleParams: ["time"], unstableParams: [], silentOnSignals: [], evidence: "" };

  // A parameter id that doesn't exist on the plugin must be a safe no-op.
  const ghost: FunctionalFitness = { score: 10, metric: "x", evidence: "x", calibration: { paramId: "doesNotExist", factor: 2 } };
  const r1 = calibrateParamScaling(body, params, "delay", baseMus, ghost);
  check("refuses a calibration targeting a nonexistent parameter", r1.repairs.length === 0 && r1.dspFunction === body);

  // A factor within measurement noise (< 2%) must not trigger a rewrite.
  const tiny: FunctionalFitness = { score: 90, metric: "x", evidence: "x", calibration: { paramId: "time", factor: 1.005 } };
  const r2 = calibrateParamScaling(body, params, "delay", baseMus, tiny);
  check("refuses a factor too small to be a real correction", r2.repairs.length === 0 && r2.dspFunction === body);

  // A wild factor outside the sane band signals a bad MEASUREMENT, not a
  // repairable plugin -- must not be blindly applied.
  const wild: FunctionalFitness = { score: 10, metric: "x", evidence: "x", calibration: { paramId: "time", factor: 500 } };
  const r3 = calibrateParamScaling(body, params, "delay", baseMus, wild);
  check("refuses a factor far outside the sane calibration band", r3.repairs.length === 0 && r3.dspFunction === body);

  // fatal musicality must short-circuit before touching the DSP at all.
  const fatalMus: MusicalityMeasurement = { ...baseMus, fatal: true };
  const r4 = calibrateParamScaling(body, params, "delay", fatalMus, ghost);
  check("never attempts a repair when the base measurement is fatal", r4.repairs.length === 0 && r4.dspFunction === body);
}

/* ------------------------------------------------------------------ */
/* 7. No false positives: every shipped golden recipe stays untouched   */
/* ------------------------------------------------------------------ */
{
  let anyRepaired = false;
  const details: string[] = [];
  for (const r of DSP_RECIPES) {
    const family =
      r.id === "synth" ? "synthesizer" : r.id === "pitch" ? "pitch" : r.id === "sampler" ? "sampler" : (r.id as any);
    const category = r.id === "synth" ? "synthesizer" : r.id === "eq" || r.id === "filter" ? "filter" : r.id === "pitch" || r.id === "sampler" ? "dynamics" : (r.id as any);
    const plugin: AudioPlugin = {
      id: r.id, name: r.id, category, description: "",
      parameters: (r.parameters as PluginParameter[]).map((p) => ({ ...p, value: p.defaultValue })),
      dspFunction: r.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const gate = runQualityGate(plugin, { family, prompt: r.title });
    if (gate.report.calibrationRepairs && gate.report.calibrationRepairs.length > 0) {
      anyRepaired = true;
      details.push(`${r.id}: ${JSON.stringify(gate.report.calibrationRepairs)}`);
    }
  }
  check("no verified golden recipe triggers a spurious calibration repair", !anyRepaired, details.join("; "));
}

console.log(failures === 0 ? "\nCALIBRATION REPAIR: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
