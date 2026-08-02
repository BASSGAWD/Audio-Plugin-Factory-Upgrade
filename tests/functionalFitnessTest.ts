/**
 * Functional fitness — the discriminator among CORRECT builds.
 *
 * The four headline scores saturate (~98% of clean candidates hit a perfect
 * 100), so they cannot rank correct builds. Fitness measures whether a build
 * actually does its family's JOB. These checks prove the measurements are
 * MEANINGFUL, not just noise that happens to spread scores: a real
 * compressor must beat a pass-through, a correctly-timed delay must beat a
 * miscalibrated one, a long tail must beat a blip, and an honest Cutoff must
 * beat a lying one.
 *
 * Also guards the invariant that matters most: fitness is informational, so
 * every shipped build still clears the >= 97 floor exactly as before.
 */
import { measureFunctionalFitness, runQualityGate } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { BENCHMARKS } from "../src/utils/knowledgeAudit";
import { buildOfflineCandidates } from "../src/utils/offlineBuilder";
import { classifyPluginIntent, familyToCategory } from "../src/utils/pluginSpec";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, min: number, max: number, def: number, unit = ""): PluginParameter =>
  ({ id, name: id, min, max, defaultValue: def, value: def, unit } as PluginParameter);

const fit = (body: string, params: PluginParameter[], family: any) =>
  measureFunctionalFitness(body, params, family);

/* ---- 1. Dynamics: a real compressor must beat a pass-through ---- */
{
  const golden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  const real = fit(golden.body, golden.parameters as PluginParameter[], "dynamics");
  const passthrough = fit(
    "let t = params.threshold !== undefined ? params.threshold : -24; let r = params.ratio !== undefined ? params.ratio : 4; let m = params.makeup !== undefined ? params.makeup : 3; return Math.tanh(inputSample * (1 + 0.0001 * (t + r + m)));",
    golden.parameters as PluginParameter[],
    "dynamics"
  );
  check("compressor: measures real gain reduction", !!real && real.score > 40, real ? `${real.score}/100 — ${real.evidence}` : "no measurement");
  check("compressor: a pass-through scores far lower", !!passthrough && !!real && passthrough.score < real.score - 25, `passthrough=${passthrough?.score} vs real=${real?.score}`);
}

/* ---- 2. Delay: correct timing must beat a miscalibrated knob ---- */
{
  const params = [P("time", 20, 1500, 350, "ms"), P("feedback", 0, 0.9, 0.45), P("mix", 0, 1, 0.5)];
  const honest = `if (!state.init) { state.buf = new Float32Array(96000); state.p = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 350;
let fb = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.45);
let mix = params.mix !== undefined ? params.mix : 0.5;
let d = Math.max(1, Math.min(95999, Math.floor(time * 44.1)));
let wet = state.buf[(state.p - d + 96000) % 96000];
state.buf[state.p] = inputSample + wet * fb;
state.p = (state.p + 1) % 96000;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`;
  // Same code, but the delay line is only HALF the requested time.
  const lying = honest.replace("Math.floor(time * 44.1)", "Math.floor(time * 22.05)");
  const a = fit(honest, params, "delay");
  const b = fit(lying, params, "delay");
  check("delay: honest Time knob scores high", !!a && a.score > 80, a ? `${a.score}/100 — ${a.evidence}` : "none");
  check("delay: a 2x-miscalibrated Time knob is caught", !!b && b.score < 30, b ? `${b.score}/100 — ${b.evidence}` : "none");
}

/* ---- 3. Reverb: a real tail must beat an ambience blip ---- */
{
  const golden = DSP_RECIPES.find((r) => r.id === "reverb")!;
  const real = fit(golden.body, golden.parameters as PluginParameter[], "reverb");
  const blip = fit(
    `if (!state.init) { state.b = new Float32Array(400); state.p = 0; state.init = true; }
let decay = params.decay !== undefined ? params.decay : 0.75;
let damp = params.damp !== undefined ? params.damp : 0.4;
let mix = params.mix !== undefined ? params.mix : 0.3;
let wet = state.b[state.p] * (0.2 + decay * 0.1) * (1 - damp * 0.1);
state.b[state.p] = inputSample;
state.p = (state.p + 1) % 400;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    golden.parameters as PluginParameter[],
    "reverb"
  );
  check("reverb: measures a real decay tail", !!real && real.score > 40, real ? `${real.score}/100 — ${real.evidence}` : "none");
  check("reverb: a near-instant blip scores far lower", !!blip && !!real && blip.score < real.score - 25, `blip=${blip?.score} vs real=${real?.score}`);
}

/* ---- 4. Filter: an honest Cutoff must beat a lying one ---- */
{
  const golden = DSP_RECIPES.find((r) => r.id === "filter")!;
  const honest = fit(golden.body, golden.parameters as PluginParameter[], "filter");
  // Same filter, but the coefficient ignores the knob and parks at ~8 kHz.
  const lying = fit(
    golden.body.replace("state.smF += 0.002 * (cutoff - state.smF);", "state.smF += 0.002 * (8000 - state.smF);"),
    golden.parameters as PluginParameter[],
    "filter"
  );
  check("filter: honest Cutoff calibration scores high", !!honest && honest.score > 50, honest ? `${honest.score}/100 — ${honest.evidence}` : "none");
  check("filter: a Cutoff that lies by octaves is caught", !!lying && !!honest && lying.score < honest.score - 25, `lying=${lying?.score} vs honest=${honest?.score}`);
}

/* ---- 5. Distortion: real drive must beat a clean gain stage ---- */
{
  const golden = DSP_RECIPES.find((r) => r.id === "distortion")!;
  const real = fit(golden.body, golden.parameters as PluginParameter[], "distortion");
  const clean = fit(
    "let drive = params.drive !== undefined ? params.drive : 8; let tone = params.tone !== undefined ? params.tone : 4500; let mix = params.mix !== undefined ? params.mix : 1; return inputSample * (0.9 + 0.0001 * (drive + tone * 0 + mix));",
    golden.parameters as PluginParameter[],
    "distortion"
  );
  check("distortion: measures real harmonic generation", !!real && real.score > 30, real ? `${real.score}/100 — ${real.evidence}` : "none");
  check("distortion: a clean gain stage generates none", !!clean && clean.score < 15, clean ? `${clean.score}/100` : "none");
}

/* ---- 6. Families with no meaningful test are honestly skipped ---- */
{
  const synth = DSP_RECIPES.find((r) => r.id === "synth")!;
  check("no false measurement for families without a functional test", fit(synth.body, synth.parameters as PluginParameter[], "synthesizer") === null);
}

/* ---- 7. Every shipped topology stays functional AND at the floor ---- */
for (const t of DSP_TOPOLOGIES) {
  const plugin: AudioPlugin = {
    id: t.id, name: t.id, category: familyToCategory(t.family), description: "",
    parameters: t.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: t.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const g = runQualityGate(plugin, { family: t.family, prompt: t.title });
  const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
  const f = g.report.functionalFitness;
  check(`${t.id}: ships at the floor with real fitness`, min >= 97 && (!f || f.score >= 35), `min=${min} fitness=${f ? f.score : "n/a"}`);
}

/* ---- 8. The invariant: fitness never lowers the shipping floor ---- */
{
  let allShip = true;
  const worst: string[] = [];
  for (const b of BENCHMARKS) {
    const spec = classifyPluginIntent(b.prompt);
    let best = -1;
    for (const c of buildOfflineCandidates(b.prompt, spec)) {
      const p: AudioPlugin = {
        id: "t", name: c.name, category: c.category, description: c.description,
        parameters: c.parameters.map((q) => ({ ...q, value: q.value ?? q.defaultValue })),
        dspFunction: c.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
      };
      const g = runQualityGate(p, { family: c.family, prompt: b.prompt });
      best = Math.max(best, Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality));
    }
    if (best < 97) { allShip = false; worst.push(`${b.name}=${best}`); }
  }
  check("every benchmark still ships at >= 97 (fitness is informational)", allShip, worst.join(", ") || "all ship");
}

console.log(failures === 0 ? "\nFUNCTIONAL FITNESS: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
