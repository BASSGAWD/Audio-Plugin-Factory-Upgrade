import { DSP_RECIPES, detectRecipe } from "../src/utils/dspRecipes";
import { runQualityGate, measureMusicality } from "../src/utils/qualityGate";
import { runPluginDiagnostics } from "../src/utils/healthcheckRunner";
import { AudioPlugin } from "../src/types";

let failures = 0;

for (const r of DSP_RECIPES) {
  const plugin: AudioPlugin = {
    id: r.id,
    name: r.title,
    category: r.id === "delay" ? "delay" : r.id === "reverb" ? "reverb" : r.id === "filter" ? "filter" : r.id === "dynamics" ? "dynamics" : r.id === "modulation" ? "modulation" : "distortion",
    description: "",
    parameters: r.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: r.body,
    faustCode: "",
    cppJuceCode: "",
    createdAt: "",
  };

  const diag = runPluginDiagnostics(plugin);
  const m = measureMusicality(r.body, plugin.parameters);
  const gate = runQualityGate(plugin);
  const s = gate.scores;
  const minScore = Math.min(s.looks, s.performance, s.latency, s.musicality);
  const pass = diag.overallHealthStatus !== "CRITICAL" && m.ok && minScore >= 97;
  if (!pass) failures++;

  console.log(`${pass ? "PASS" : "FAIL"} ${r.id.padEnd(11)} health=${diag.overallHealthStatus.padEnd(8)} gain=${m.gainOffsetDb.toFixed(1).padStart(6)}dB audible=[${m.audibleParams}] dead=[${m.deadParams}] scores L${s.looks}/P${s.performance}/La${s.latency}/M${s.musicality}${m.evidence ? " EVIDENCE: " + m.evidence : ""}`);
}

// Intent detection sanity
const probes: Array<[string, string | null]> = [
  ["give me a lush hall reverb with shimmer", "reverb"],
  ["warm tape delay with feedback", "delay"],
  ["a screaming fuzz pedal", "distortion"],
  ["classic 80s chorus for clean guitar", "modulation"],
  ["glue compressor for the drum bus", "dynamics"],
  ["acid resonant lowpass filter", "filter"],
  // Now matches the synth recipe (added later) -- previously expected null when no synth recipe existed
  ["a granular texture synthesizer", "synth"],
  // A prompt with no recognizable effect-family keywords should still match nothing
  ["make my computer sound better somehow", null],
];
for (const [prompt, expected] of probes) {
  const got = detectRecipe(prompt)?.id ?? null;
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} detect "${prompt}" -> ${got} (expected ${expected})`);
}

console.log(failures === 0 ? "\nALL RECIPES + DETECTION PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
