/**
 * The DSP Code Auditor (Milestone 5): grades the CODE, not the sound.
 *
 *  1. Every shipped module (recipes, topologies, corpus) scores healthy
 *     (>= 95) — the factory's own output passes its own engineering bar.
 *  2. The auditor CATCHES real engineering defects: per-sample allocation,
 *     hot-loop array growth, unguarded log of an amplitude term, runaway
 *     feedback, Math.random in the audio path, console/JSON/timers.
 *  3. It does NOT false-positive on the safe idioms clean DSP uses: setup
 *     inside the init guard, log of a bounded frequency ratio, log of a
 *     literal, guarded log(Math.max(...)), feedback whose range tops < 1.
 *  4. codeHealth reaches the build report and the knowledge audit.
 */
import { auditDspCode } from "../src/utils/codeAudit";
import { DSP_RECIPES, PITCH_SHIFT_RECIPE } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { RESEARCH_CORPUS } from "../src/utils/researchCorpus";
import { runQualityGate } from "../src/utils/qualityGate";
import { runKnowledgeAudit } from "../src/utils/knowledgeAudit";
import { familyToCategory } from "../src/utils/pluginSpec";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- 1. Every shipped module is healthy ---- */
const shipped: Array<{ id: string; body: string; params: any[] }> = [
  ...DSP_RECIPES.map((r) => ({ id: `recipe:${r.id}`, body: r.body, params: r.parameters })),
  { id: "recipe:pitchshift", body: PITCH_SHIFT_RECIPE.body, params: PITCH_SHIFT_RECIPE.parameters },
  ...DSP_TOPOLOGIES.map((t) => ({ id: `topo:${t.id}`, body: t.body, params: t.parameters })),
  ...RESEARCH_CORPUS.filter((e) => e.proposedModule).map((e) => ({ id: `corpus:${e.concept}`, body: e.proposedModule!.body, params: e.proposedModule!.parameters })),
];
let minHealth = 100;
let worstId = "";
for (const s of shipped) {
  const h = auditDspCode(s.body, s.params).codeHealth;
  if (h < minHealth) { minHealth = h; worstId = s.id; }
}
check("every shipped module scores healthy (>= 95)", minHealth >= 95, `worst=${worstId} health=${minHealth}`);

/* ---- 2. Catches real defects ---- */
const defect = (label: string, body: string, dim: string, params: any[] = []) => {
  const r = auditDspCode(body, params);
  const hit = r.findings.some((f) => f.dimension === dim);
  check(`catches ${label}`, hit && r.codeHealth < 100, `health=${r.codeHealth} findings=${r.findings.map((f) => f.dimension).join(",")}`);
};
defect("per-sample allocation", "let b = new Float32Array(1024); return inputSample;", "realtime");
defect("hot-loop array growth", "if(!state.init){state.a=[];state.init=true;} state.a.push(inputSample); return inputSample;", "realtime");
defect("Math.random in audio path", "return Math.random() * inputSample;", "realtime");
defect("console.log in loop", "console.log(inputSample); return inputSample;", "realtime");
defect("unguarded log of an envelope", "state.env += 0.01*(Math.abs(inputSample)-state.env); let db = 20*Math.log10(state.env); return Math.tanh(inputSample*db*0.01);", "numerical");
defect(
  "runaway feedback (range >= 1, unclamped)",
  "if(!state.init){state.z=0;state.init=true;} let fb=params.feedback!==undefined?params.feedback:0.5; state.z = inputSample + state.z*fb; return state.z;",
  "numerical",
  [{ id: "feedback", name: "Feedback", min: 0, max: 1.2, defaultValue: 0.5, value: 0.5 }]
);

/* ---- 3. No false positives on safe idioms ---- */
const clean = (label: string, body: string, params: any[] = []) => {
  const r = auditDspCode(body, params);
  check(`no false positive: ${label}`, r.codeHealth === 100, `health=${r.codeHealth} findings=${r.findings.map((f) => f.message).join(" | ")}`);
};
clean("allocation inside init guard", "if(!state.init){state.buf=new Float32Array(1024);state.init=true;} return inputSample;");
clean("guarded log(Math.max)", "if(!state.init){state.env=0;state.init=true;} state.env+=0.01*(Math.abs(inputSample)-state.env); let db=20*Math.log10(Math.max(1e-6,state.env)); return Math.tanh(inputSample*Math.pow(10,db/20));");
clean("log of a bounded frequency ratio", "if(!state.init){state.f=220;state.init=true;} let midi = 69 + 12*Math.log(state.f/440)/Math.log(2); return Math.tanh(inputSample*midi*0.001);");
clean(
  "feedback whose range tops below 1.0",
  "if(!state.init){state.z=0;state.init=true;} let decay=params.decay!==undefined?params.decay:0.7; state.z = inputSample + state.z*decay; return Math.tanh(state.z);",
  [{ id: "decay", name: "Decay", min: 0, max: 0.95, defaultValue: 0.7, value: 0.7 }]
);

/* ---- 4. codeHealth flows into report + audit ---- */
const rev = DSP_RECIPES.find((r) => r.id === "reverb")!;
const plugin: AudioPlugin = {
  id: "t", name: "t", category: familyToCategory("reverb"), description: "",
  parameters: rev.parameters.map((p) => ({ ...p, value: p.defaultValue })),
  dspFunction: rev.body, faustCode: "", cppJuceCode: "", createdAt: "",
};
const gated = runQualityGate(plugin, { family: "reverb", prompt: "reverb" });
check("build report carries codeHealth", typeof gated.report.codeHealth === "number" && gated.report.codeHealth >= 95, `${gated.report.codeHealth}`);
check("build report lists codeFindings array", Array.isArray(gated.report.codeFindings));

const audit = runKnowledgeAudit();
check("knowledge audit reports code health per benchmark", audit.benchmarks.every((b) => typeof b.codeHealth === "number"));
check("all benchmarks are code-healthy (>= 90)", audit.benchmarks.every((b) => b.codeHealth >= 90), audit.benchmarks.filter((b) => b.codeHealth < 90).map((b) => `${b.name}=${b.codeHealth}`).join(", ") || "all healthy");

/* ---- the sampler hardening actually landed: seeded PRNG, no random in code ---- */
const sampler = DSP_RECIPES.find((r) => r.id === "sampler")!;
const samplerCode = sampler.body.replace(/\/\/[^\n]*/g, ""); // ignore the explanatory comment
check(
  "sampler uses a seeded PRNG, no Math.random in executable code",
  !/Math\.random/.test(samplerCode) && /state\.rng/.test(sampler.body) && auditDspCode(sampler.body, sampler.parameters).codeHealth === 100
);

console.log(failures === 0 ? "\nCODE AUDIT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
