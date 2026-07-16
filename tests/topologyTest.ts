/**
 * The engineering-brain contract:
 *
 *  1. Every topology variant in the bank ships at >= 97 through the real
 *     gate with zero dead/unstable/semantically-dishonest controls.
 *  2. Requirements inference reads source material, character, and latency
 *     budget out of real-world wording.
 *  3. The knowledge graph routes requirements to the right topology — and
 *     NEVER changes what a neutral prompt builds (the golden default wins).
 *  4. Runner-up topologies enter the best-of-N candidate pool.
 *  5. Prompts the banks can't confidently serve get logged as gaps.
 */
import { DSP_TOPOLOGIES, topologiesForFamily } from "../src/utils/dspTopologies";
import { rankTopologies, KNOWLEDGE_GRAPH, logPromptGap, readPromptGaps } from "../src/utils/knowledgeGraph";
import { inferRequirements } from "../src/utils/requirements";
import { buildOfflinePlugin, buildOfflineCandidates } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { classifyPluginIntent, familyToCategory } from "../src/utils/pluginSpec";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- 1. Every topology gates >= 97, no defects ---- */
for (const t of DSP_TOPOLOGIES) {
  const plugin: AudioPlugin = {
    id: t.id, name: t.id, category: familyToCategory(t.family), description: "",
    parameters: t.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: t.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const g = runQualityGate(plugin, { family: t.family, prompt: t.title });
  const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
  const defects =
    g.report.deadParams.length + g.report.unstableParams.length + (g.report.semanticViolations?.length || 0) + (g.report.harsh ? 1 : 0);
  check(`topology ${t.id} ships at floor`, min >= 97 && defects === 0, `min=${min} defects=${defects}`);
}

/* ---- exactly one default per family with topologies ---- */
for (const family of ["dynamics", "reverb", "delay", "distortion"] as const) {
  const variants = topologiesForFamily(family);
  check(`${family} has one default and >= 2 variants`, variants.filter((v) => v.isDefault).length === 1 && variants.length >= 2, `${variants.length} variants`);
}

/* ---- 2. Requirements inference ---- */
const reqMaster = inferRequirements("a transparent compressor for the master bus");
check("infers master + transparent", reqMaster.source === "master" && reqMaster.character === "transparent", JSON.stringify(reqMaster));
const reqDrums = inferRequirements("an aggressive punchy drum compressor");
check("infers drums + aggressive", reqDrums.source === "drums" && reqDrums.character === "aggressive", JSON.stringify(reqDrums));
const reqLive = inferRequirements("a compressor for live vocals on stage");
check("infers vocals + live", reqLive.source === "vocals" && reqLive.latency === "live", JSON.stringify(reqLive));
const reqNone = inferRequirements("make a compressor");
check("neutral prompt has no requirements", reqNone.source === "any" && reqNone.character === "any" && reqNone.latency === "any");
check("evidence trail records the wording", reqDrums.evidence.length >= 1 && /drum|punch/i.test(reqDrums.evidence.join(" ")));

/* ---- 3. Topology routing ---- */
check("mastering -> lookahead soft-knee", rankTopologies("dynamics", reqMaster)[0].id === "comp_lookahead_master");
check("drums -> peak punch", rankTopologies("dynamics", reqDrums)[0].id === "comp_peak_punch");
check(
  "live budget EXCLUDES lookahead entirely",
  rankTopologies("dynamics", reqLive).every((t) => t.tags.latency !== "lookahead")
);
check("neutral -> golden default first", rankTopologies("dynamics", reqNone)[0].id === "comp_ff_rms");
check("warm vintage vocals -> feedback glue", rankTopologies("dynamics", inferRequirements("a warm vintage compressor for vocals"))[0].id === "comp_feedback_glue");
check("vocal plate -> FDN plate", rankTopologies("reverb", inferRequirements("a plate reverb for vocals"))[0].id === "reverb_fdn_plate");
check("drum room -> early reflections", rankTopologies("reverb", inferRequirements("a tight room reverb for drums"))[0].id === "reverb_room_er");
check("clean delay -> pristine digital", rankTopologies("delay", inferRequirements("a clean transparent digital delay"))[0].id === "delay_digital");
check("brutal fuzz -> softsign fuzz", rankTopologies("distortion", inferRequirements("a brutal fuzz pedal"))[0].id === "dist_fuzz");

/* ---- builder integration: neutral prompt is byte-identical to golden ---- */
const goldenComp = DSP_RECIPES.find((r) => r.id === "dynamics")!;
const neutralBuild = buildOfflinePlugin("make a compressor");
check("neutral compressor builds the golden body unchanged", neutralBuild.dspFunction === goldenComp.body);

const masterBuild = buildOfflinePlugin("a transparent compressor for the master bus");
check("mastering prompt builds the lookahead body", /state\.buf = new Float32Array\(64\)/.test(masterBuild.dspFunction));
check("engineering choice is explained to the user", /Engineering choice/i.test(masterBuild.description) && /Engineering choice/.test(masterBuild.summary));
check("neutral build does NOT claim an engineering choice", !/Engineering choice/i.test(neutralBuild.description));

/* ---- 4. Candidates: competing designs enter the pool ---- */
const cands = buildOfflineCandidates("an aggressive punchy drum compressor");
const distinct = new Set(cands.map((c) => c.dspFunction));
check("drum compressor candidate pool holds >= 3 distinct designs", cands.length >= 3 && distinct.size === cands.length, `${cands.length} candidates`);

/* ---- every routed build still ships at the floor through the gate ---- */
for (const prompt of [
  "a transparent compressor for the master bus",
  "an aggressive punchy drum compressor",
  "a warm vintage compressor for vocals",
  "a plate reverb for vocals",
  "a tight room reverb for drums",
  "a clean transparent digital delay",
  "a brutal fuzz pedal",
  "warm tube saturation for bass",
]) {
  const spec = classifyPluginIntent(prompt);
  const b = buildOfflinePlugin(prompt, spec);
  const plugin: AudioPlugin = {
    id: "t", name: b.name, category: b.category, description: b.description,
    parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const g = runQualityGate(plugin, { family: b.family, prompt });
  const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
  check(`routed build ships: "${prompt}"`, min >= 97, `min=${min}`);
}

/* ---- 5. Gap logging (localStorage stub) ---- */
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

buildOfflinePlugin("quantum yodel translator");
const gaps = readPromptGaps();
check("unserved novel prompt is logged as a gap", gaps.some((g) => g.prompt.includes("quantum yodel")), JSON.stringify(gaps));
logPromptGap("quantum yodel translator", "hybrid_other", "dup");
check("gap log dedupes by prompt", readPromptGaps().filter((g) => g.prompt.includes("quantum yodel")).length === 1);

buildOfflinePlugin("an underwater dream machine");
check("well-served novel prompt is NOT a gap", !readPromptGaps().some((g) => g.prompt.includes("underwater")));

/* ---- graph sanity ---- */
check("graph covers every bank module", KNOWLEDGE_GRAPH.length === 10 + 10 + DSP_TOPOLOGIES.length, `${KNOWLEDGE_GRAPH.length} nodes`);
check("all graph nodes are tier-1 verified", KNOWLEDGE_GRAPH.every((n) => n.trust === 1));

console.log(failures === 0 ? "\nTOPOLOGY/ENGINEERING-BRAIN: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
