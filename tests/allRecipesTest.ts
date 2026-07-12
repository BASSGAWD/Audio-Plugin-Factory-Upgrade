import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { runQualityGate, measureMusicality } from "../src/utils/qualityGate";
import { runPluginDiagnostics } from "../src/utils/healthcheckRunner";
import { AudioPlugin } from "../src/types";

let failures = 0;
const catFor: Record<string, AudioPlugin["category"]> = {
  reverb: "reverb", eq: "filter", delay: "delay", modulation: "modulation", dynamics: "dynamics",
  filter: "filter", distortion: "distortion", sampler: "synthesizer", pitch: "synthesizer", synth: "synthesizer",
};

for (const r of DSP_RECIPES) {
  const plugin: AudioPlugin = {
    id: r.id, name: r.title, category: catFor[r.id] || "filter", description: "",
    parameters: r.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: r.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const diag = runPluginDiagnostics(plugin);
  const m = measureMusicality(r.body, plugin.parameters);
  const gate = runQualityGate(plugin);
  const s = gate.scores;
  const minScore = Math.min(s.looks, s.performance, s.latency, s.musicality);
  const pass = diag.overallHealthStatus !== "CRITICAL" && m.ok && minScore >= 97;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${r.id.padEnd(12)} health=${diag.overallHealthStatus.padEnd(8)} audible=[${m.audibleParams}] dead=[${m.deadParams}] scores L${s.looks}/P${s.performance}/La${s.latency}/M${s.musicality}`);
}
console.log(`\nTotal recipes: ${DSP_RECIPES.length}`);
console.log(failures === 0 ? "ALL RECIPES PASS >=97" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
