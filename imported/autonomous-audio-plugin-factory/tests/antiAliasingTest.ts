/**
 * Proof suite for oversampled nonlinear stages: the honest, oversampled
 * implementation must fold DECISIVELY less energy above Nyquist than a
 * deliberately non-oversampled (1x, shape-the-raw-sample) counterpart of the
 * exact same transfer curve and gain compensation -- the project's standard
 * pattern (see CLAUDE.md "Verifying a change to DSP or the gate").
 *
 * Every stage below is measured with the real `measureAliasing` export from
 * qualityGate.ts (imported, never reimplemented) so this suite tracks
 * whatever that measurement currently does, rather than asserting fixed
 * constants that could drift out of sync with a concurrent change to the
 * gate. The assertion is always a RELATIONSHIP: honest < naive by a wide,
 * decisive margin, at parameter settings that actually engage the
 * nonlinearity (default-only checks would hide most of this -- several of
 * these knobs are transparent at their default value by design).
 */
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { measureAliasing } from "../src/utils/qualityGate";
import { runQualityGate } from "../src/utils/qualityGate";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

type P = { id: string; name: string; min: number; max: number; defaultValue: number; unit: string };
function paramsAt(base: readonly P[], overrides: Record<string, number>): any {
  return base.map((p) => ({
    ...p,
    defaultValue: overrides[p.id] !== undefined ? overrides[p.id] : p.defaultValue,
    value: 0,
  }));
}

/** Deliberately non-oversampled counterpart: same nonlinearity and gain
 *  compensation, but shaping the RAW sample once instead of oversampling.
 *  Built mechanically from the honest body by stripping the shared
 *  oversampledWaveshape() output (dspPrimitives.ts) back down to a single
 *  1x shape of the current sample -- not hand-tuned to look bad. Every
 *  oversampled stage now emits this exact same structural shape (only the
 *  shaper expression and gain-compensation/output-var differ), so one
 *  generic regex covers all of them instead of a bespoke one per site. */
function naiveCounterpart(body: string): string {
  return body.replace(
    /let midRaw = 0\.5 \* \(state\.prevIn \+ inputSample\);\nlet shapedMid = .+?;\nlet shapedCur = (.+?);\nlet (\w+) = \(0\.25 \* state\.prevShaped \+ 0\.5 \* shapedMid \+ 0\.25 \* shapedCur\) \/ (.+?);\nstate\.prevShaped = shapedCur;\nstate\.prevIn = inputSample;/,
    "let $2 = ($1) / $3;"
  );
}

/** filter recipe: bespoke naive counterpart (drive stage has its own
 *  if/else oversampling shape -- oversampledWaveshape() called with
 *  declareOutput:false/outputVar:"xin" inside a conditional branch, not
 *  the plain always-declared "let wet = ..." shape naiveCounterpart
 *  above handles). */
function naiveFilterBody(honestBody: string): string {
  return honestBody.replace(
    /let xin;\nif \(drive > 0\.01\) \{\n\s*let midRaw = 0\.5 \* \(state\.prevIn \+ inputSample\);\n\s*let shapedMid = .+?;\n\s*let shapedCur = (.+?);\n\s*xin = \(0\.25 \* state\.prevShaped \+ 0\.5 \* shapedMid \+ 0\.25 \* shapedCur\) \/ (.+?);\n\s*state\.prevShaped = shapedCur;\n\s*state\.prevIn = inputSample;\n\} else \{\n\s*xin = inputSample;\n\s*state\.prevShaped = 0;\n\}\nstate\.prevIn = inputSample;/,
    "let xin = drive > 0.01 ? ($1) / ($2) : inputSample;\nstate.prevIn = inputSample;"
  );
}

const R = (id: string) => DSP_RECIPES.find((r) => r.id === id)!;
const T = (id: string) => DSP_TOPOLOGIES.find((t) => t.id === id)!;

/** Each case: [label, recipe/topology, param overrides that engage the
 *  nonlinearity hard, naive-body builder, minimum decisive-gap ratio]. */
const cases: Array<{
  label: string;
  obj: { body: string; parameters: readonly P[] };
  overrides: Record<string, number>;
  toNaive: (body: string) => string;
  minRatio: number; // honestAliasing must be at most 1/minRatio of naive
}> = [
  {
    label: "distortion recipe (drive 24dB, tone 12kHz)",
    obj: R("distortion"),
    overrides: { drive: 24, tone: 12000 },
    toNaive: naiveCounterpart,
    minRatio: 1.8,
  },
  {
    label: "filter recipe drive stage (drive 24dB, cutoff 12kHz)",
    obj: R("filter"),
    overrides: { drive: 24, cutoff: 12000 },
    toNaive: naiveFilterBody,
    minRatio: 2.5,
  },
  {
    label: "dist_tube_asym topology (drive 24dB, tone 12kHz)",
    obj: T("dist_tube_asym"),
    overrides: { drive: 24, tone: 12000 },
    toNaive: naiveCounterpart,
    minRatio: 1.8,
  },
  {
    label: "dist_fuzz topology (drive 36dB, tone 12kHz)",
    obj: T("dist_fuzz"),
    overrides: { drive: 36, tone: 12000 },
    toNaive: naiveCounterpart,
    minRatio: 1.6,
  },
];

for (const c of cases) {
  const params = paramsAt(c.obj.parameters, c.overrides);
  const honestAlias = measureAliasing(c.obj.body, params);
  const naiveBody = c.toNaive(c.obj.body);
  check(`${c.label}: naive counterpart differs from honest body (sanity)`, naiveBody !== c.obj.body, "regex must have matched");
  const naiveAlias = measureAliasing(naiveBody, params);
  const ratio = naiveAlias > 1e-9 ? naiveAlias / Math.max(honestAlias, 1e-9) : 0;
  check(
    `${c.label}: oversampled body folds decisively less than 1x`,
    naiveAlias > honestAlias && ratio >= c.minRatio,
    `honest=${honestAlias.toFixed(6)} naive=${naiveAlias.toFixed(6)} ratio=${ratio.toFixed(2)}x (need >=${c.minRatio}x)`
  );
}

/* ---- comp_feedback_glue: its Warmth stage now goes through the SAME
 * shared oversampledWaveshape() shape (outputVar "out", gainComp "norm")
 * as every other site, so the generic naiveCounterpart above covers it
 * too -- no bespoke regex needed anymore. ---- */
{
  const t = T("comp_feedback_glue");
  const overrides = { warmth: 1, makeup: 24, threshold: -48, ratio: 1 };
  const params = paramsAt(t.parameters, overrides);
  const honestAlias = measureAliasing(t.body, params);
  const naiveBody = naiveCounterpart(t.body);
  check("comp_feedback_glue: naive counterpart differs from honest body (sanity)", naiveBody !== t.body);
  const naiveAlias = measureAliasing(naiveBody, params);
  const ratio = naiveAlias > 1e-9 ? naiveAlias / Math.max(honestAlias, 1e-9) : 0;
  check(
    "comp_feedback_glue Warmth stage: oversampled body folds decisively less than 1x",
    naiveAlias > honestAlias && ratio >= 1.5,
    `honest=${honestAlias.toFixed(6)} naive=${naiveAlias.toFixed(6)} ratio=${ratio.toFixed(2)}x (need >=1.5x)`
  );
}

/* ---- Every touched stage still ships at the gate floor with real harmonic
 * character intact (not anti-aliased into transparency) -- guards against
 * over-suppressing the intended distortion/warmth sound while fixing the
 * folded garbage. ---- */
{
  const catFor: Record<string, AudioPlugin["category"]> = { distortion: "distortion", filter: "filter" };
  for (const id of ["distortion", "filter"]) {
    const r = R(id);
    const plugin: AudioPlugin = {
      id: r.id, name: r.title, category: catFor[id], description: "",
      parameters: r.parameters.map((p) => ({ ...p, value: p.defaultValue })),
      dspFunction: r.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const gate = runQualityGate(plugin, { family: id as any, prompt: r.title });
    const s = gate.scores;
    const min = Math.min(s.looks, s.performance, s.latency, s.musicality);
    check(`${id} recipe ships at floor after oversampling`, min >= 97 && gate.report.deadParams.length === 0, `min=${min} dead=[${gate.report.deadParams}]`);
  }
  for (const id of ["dist_tube_asym", "dist_fuzz", "comp_feedback_glue"]) {
    const t = T(id);
    const plugin: AudioPlugin = {
      id: t.id, name: t.id, category: t.family === "dynamics" ? "dynamics" : "distortion", description: "",
      parameters: t.parameters.map((p) => ({ ...p, value: p.defaultValue })),
      dspFunction: t.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const gate = runQualityGate(plugin, { family: t.family, prompt: t.title });
    const s = gate.scores;
    const min = Math.min(s.looks, s.performance, s.latency, s.musicality);
    check(`${id} topology ships at floor after oversampling`, min >= 97 && gate.report.deadParams.length === 0, `min=${min} dead=[${gate.report.deadParams}]`);
  }
}

console.log(failures === 0 ? "\nANTI-ALIASING: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
