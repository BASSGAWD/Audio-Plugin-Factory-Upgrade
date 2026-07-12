/**
 * Proves the multi-signal quality gate catches what the single-signal arp
 * test missed. Each case is a synthetic DSP that isolates one behavior the
 * signal bank (arp + pluck + sustain + burst) adds over the old arp-only
 * measurement -- plus a calibration sweep confirming the richer measurement
 * produces NO false positives on the verified golden recipes.
 */
import { measureMusicality, measureCharacterIndex } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { PluginParameter } from "../src/types";

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

console.log(failures === 0 ? "\nSIGNAL BANK: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
