/**
 * Proves the multi-signal quality gate catches what the single-signal arp
 * test missed. Each case is a synthetic DSP that isolates one behavior the
 * signal bank (arp + pluck + sustain + burst) adds over the old arp-only
 * measurement -- plus a calibration sweep confirming the richer measurement
 * produces NO false positives on the verified golden recipes.
 */
import { measureMusicality, measureCharacterIndex, measureAliasing, runQualityGate } from "../src/utils/qualityGate";
import { refinementScore } from "../src/utils/refinementLoop";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}
const P = (id: string, min: number, max: number, dv: number): PluginParameter => ({ id, name: id, min, max, defaultValue: dv, value: dv, unit: "" });

/* A) RESCUE: a knob that only acts during the silence gaps of the burst is
 *    dead on the continuous arp, alive on transient material. The old
 *    arp-only test would call it dead; measuring across the bank rescues it. */
const rescueDsp = `if (!state.init){state.env=0;state.init=true;}
let fill = params.fill !== undefined ? params.fill : 0;
let x = Math.abs(inputSample);
state.env = x > state.env ? x : state.env*0.999;   // env only decays below 0.05 during gaps
let quiet = state.env < 0.05 ? 1 : 0;               // continuous arp: always 0 -> fill is dead
return inputSample + quiet * fill * 0.4;`;
const rescue = measureMusicality(rescueDsp, [P("fill", 0, 1, 0.5)]);
check("rescue: transient-only knob is AUDIBLE (not falsely dead)", rescue.audibleParams.includes("fill") && !rescue.deadParams.includes("fill"), `audible=${rescue.audibleParams} dead=${rescue.deadParams}`);

/* B) UNSTABLE-ON-BURST: a divide-by-(|input|+k) that NaNs only when input is
 *    exactly 0 (k=0). The arp never hits exactly 0, so the single-signal test
 *    passed this as stable -- a real divide-by-zero bug it silently missed.
 *    The burst's silence gaps expose it. */
const nanDsp = `let k = params.k !== undefined ? params.k : 0.5;
return inputSample / (Math.abs(inputSample) + k) * 0.5;`;
const nan = measureMusicality(nanDsp, [P("k", 0, 1, 0.5), P("g", 0, 1, 0.5)]);
check("unstable-on-burst: divide-by-zero in silence gaps is CAUGHT", nan.unstableParams.includes("k"), `unstable=${nan.unstableParams}`);

/* C) SILENT-ON-SIGNAL: a slow-attack gate whose envelope never charges on
 *    gappy/transient material -> audible on the arp, silent on plucks and
 *    bursts. A real dead spot the arp alone can't see. */
const gateDsp = `if(!state.init){state.env=0;state.init=true;}
let x=Math.abs(inputSample);
state.env += 0.00005*(x-state.env);
let g = state.env > 0.08 ? 1 : 0;
return inputSample*g;`;
const gate = measureMusicality(gateDsp, [P("dummy", 0, 1, 0.5)]);
check("silent-on-signal: dead spot on transient material is flagged", !gate.isSilent && gate.silentOnSignals.includes("burst"), `isSilent(arp)=${gate.isSilent} silentOn=${gate.silentOnSignals}`);

/* D) CALIBRATION: the richer measurement must not FALSE-flag the verified
 *    golden recipes -- no phantom dead/unstable params, no phantom dead
 *    spots, and every recipe still meaningfully reshapes the signal. */
let anyFalse = false;
for (const r of DSP_RECIPES) {
  const params = r.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
  const m = measureMusicality(r.body, params);
  const clean = m.deadParams.length === 0 && m.unstableParams.length === 0 && m.silentOnSignals.length === 0 && !m.isSilent;
  if (!clean) {
    anyFalse = true;
    console.log(`  FALSE FLAG ${r.id}: dead=${m.deadParams} unstable=${m.unstableParams} silentOn=${m.silentOnSignals} isSilent=${m.isSilent}`);
  }
}
check("calibration: no false positives across all 10 golden recipes", !anyFalse);

/* E) CHARACTER INDEX averages across the bank: passthrough ~0, a real
 *    transform clearly higher, silence 0. */
check("character: passthrough is ~0", measureCharacterIndex("return inputSample;", [P("x", 0, 1, 0)]) < 0.05);
check("character: silence is 0", measureCharacterIndex("return 0;", [P("x", 0, 1, 0)]) === 0);
check("character: heavy reshaping scores clearly higher than passthrough", measureCharacterIndex("return Math.tanh(inputSample*40);", [P("x", 0, 1, 0)]) > 0.1);

/* F) ALIASING: an FFT-based inharmonic-energy ratio catches digital fizz
 *    (sample-rate/bit reduction, cheap pitch tricks) that a clean linear
 *    process never produces -- and that the old gate couldn't see at all. */
const p1 = [P("x", 0, 1, 0)];
check("aliasing: clean passthrough is ~0", measureAliasing("return inputSample;", p1) < 0.02);
check("aliasing: a lowpass filter stays clean", measureAliasing("if(!state.i){state.lp=0;state.i=1;}state.lp+=0.2*(inputSample-state.lp);return state.lp;", p1) < 0.02);
const shReduce = "if(!state.n){state.n=0;state.h=0;}state.n++;if(state.n>=6){state.n=0;state.h=inputSample;}return state.h;";
check("aliasing: sample-rate reduction reads HIGH (fizz the old gate missed)", measureAliasing(shReduce, p1) > 0.3, `idx=${measureAliasing(shReduce, p1).toFixed(3)}`);

/* G) HARSHNESS is family-gated: the SAME aliasing is a defect for a filter
 *    (should stay clean) but intended character for an inharmonic-by-design
 *    family -- and it NEVER touches the >=97 headline scores. Uses a bitcrush
 *    that aliases yet reads both knobs, so the ONLY blemish is harshness. */
// The rate knob is deliberately NOT named "cutoff": a decimator gets darker
// as it crushes harder, so a brightness-family name would be a genuine
// semantic violation -- a second blemish that would defeat this test's
// "the ONLY blemish is harshness" premise.
const crushDsp = `if(!state.i){state.n=0;state.h=0;state.i=1;}
let rate = params.crush !== undefined ? params.crush : 0.6;
let mix = params.mix !== undefined ? params.mix : 1;
let hold = Math.max(1, Math.round(2 + rate * 10));
state.n++;
if(state.n >= hold){state.n=0;state.h=inputSample;}
return inputSample * (1 - mix) + state.h * mix;`;
const mkPlugin = (category: AudioPlugin["category"]): AudioPlugin => ({
  id: "t", name: "T", category, description: "",
  parameters: [P("crush", 0, 1, 0.6), P("mix", 0, 1, 1)], dspFunction: crushDsp,
  faustCode: "", cppJuceCode: "", createdAt: "",
});
const asFilter = runQualityGate(mkPlugin("filter"), { family: "filter" });
const asHybrid = runQualityGate(mkPlugin("synthesizer"), { family: "hybrid_other" });
check("harshness: aliasing flagged harsh for a clean-family (filter)", asFilter.report.harsh === true, `harsh=${asFilter.report.harsh} idx=${asFilter.report.aliasingIndex?.toFixed(2)}`);
check("harshness: same aliasing NOT harsh for an inharmonic-by-design family", asHybrid.report.harsh === false);
check("harshness: never drops the headline floor below 97 (decoupled from scores)", Math.min(asFilter.scores.looks, asFilter.scores.performance, asFilter.scores.latency, asFilter.scores.musicality) >= 97, `scores=${JSON.stringify(asFilter.scores)}`);
check("harshness: refinement scores the harsh build strictly below the identical non-harsh one", refinementScore(asFilter) < refinementScore(asHybrid));

/* H) CALIBRATION: no golden recipe in a clean family is falsely flagged harsh. */
let falseHarsh = false;
const catFor: Record<string, AudioPlugin["category"]> = { reverb: "reverb", delay: "delay", modulation: "modulation", dynamics: "dynamics", eq: "filter", filter: "filter", distortion: "distortion", sampler: "synthesizer", pitch: "synthesizer", synth: "synthesizer" };
const famFor: Record<string, any> = { reverb: "reverb", delay: "delay", dynamics: "dynamics", eq: "eq", filter: "filter", distortion: "distortion" };
for (const r of DSP_RECIPES) {
  if (!famFor[r.id]) continue; // only clean families
  const plugin: AudioPlugin = { id: r.id, name: r.id, category: catFor[r.id], description: "", parameters: r.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[], dspFunction: r.body, faustCode: "", cppJuceCode: "", createdAt: "" };
  const g = runQualityGate(plugin, { family: famFor[r.id] });
  if (g.report.harsh) { falseHarsh = true; console.log(`  FALSE HARSH ${r.id}: idx=${g.report.aliasingIndex?.toFixed(3)}`); }
}
check("harshness calibration: no clean-family golden recipe falsely flagged", !falseHarsh);

console.log(failures === 0 ? "\nSIGNAL BANK: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
