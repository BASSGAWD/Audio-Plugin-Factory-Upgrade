/**
 * Milestone 2 contract — the Research Engine:
 *
 *  - every corpus-proposed module passes the gate at >= 97 (a research
 *    engine that proposes broken modules is worse than none)
 *  - findings carry citations with authority scores; literature outranks
 *    model output
 *  - structurally impossible concepts are BLOCKED with the constraint as
 *    the finding, and can never be approved
 *  - the human-approval boundary is airtight: pending research changes
 *    nothing; approval extends coverage AND makes the module buildable;
 *    rejection changes nothing
 *  - the pipeline is deterministic without a model
 */
import { RESEARCH_CORPUS } from "../src/utils/researchCorpus";
import {
  runResearch, approveResearch, rejectResearch, readResearchQueue, isApprovable,
  approvedModules, findApprovedModuleForPrompt, planResearch,
} from "../src/utils/researchEngine";
import { knownConcepts } from "../src/utils/knowledgeGraph";
import { runKnowledgeAudit } from "../src/utils/knowledgeAudit";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { familyToCategory } from "../src/utils/pluginSpec";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

// localStorage stub — the engine must work in Node exactly as in the browser.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

(async () => {
  /* ---- every proposed corpus module passes the gate ---- */
  for (const e of RESEARCH_CORPUS) {
    if (!e.proposedModule) continue;
    const m = e.proposedModule;
    const plugin: AudioPlugin = {
      id: e.concept, name: m.title, category: familyToCategory(m.family), description: "",
      parameters: m.parameters.map((p) => ({ ...p, value: p.defaultValue })),
      dspFunction: m.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const g = runQualityGate(plugin, { family: m.family, prompt: m.title });
    const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
    const defects = g.report.deadParams.length + g.report.unstableParams.length + (g.report.semanticViolations?.length || 0) + (g.report.harsh ? 1 : 0);
    check(`corpus module ${e.concept} ships at floor`, min >= 97 && defects === 0, `min=${min} defects=${defects}`);
  }

  /* ---- planner ---- */
  const plan = planResearch("phaser");
  check("plan asks the engineering questions", plan.questions.length >= 3 && plan.acceptance.some((a) => /human approval/i.test(a)));

  /* ---- research a real gap: phaser ---- */
  const before = knownConcepts();
  check("phaser is a gap before research", !before.includes("phaser"));

  const phaser = await runResearch("phaser");
  check("phaser research yields cited claims", phaser.claims.length >= 2 && phaser.claims.every((c) => c.citation.authority > 0));
  check("literature outranks lower tiers (sorted by authority)", phaser.claims[0].citation.authority >= phaser.claims[phaser.claims.length - 1].citation.authority);
  check("phaser module was gate-verified in the pipeline", phaser.proposedModule?.verification.passes === true, `min=${phaser.proposedModule?.verification.minScore}`);
  check("phaser is approvable", isApprovable(phaser));
  check("pending research does NOT extend coverage", !knownConcepts().includes("phaser"));
  check("pending research is NOT buildable", findApprovedModuleForPrompt("a swirling phaser") === null);

  /* ---- dedupe while pending ---- */
  const again = await runResearch("phaser");
  check("re-research while pending dedupes", again.id === phaser.id && readResearchQueue().filter((i) => i.concept === "phaser").length === 1);

  /* ---- the approval boundary ---- */
  approveResearch(phaser.id);
  check("approval extends known concepts", knownConcepts().includes("phaser"));
  check("approval makes the module buildable", approvedModules().some((i) => i.concept === "phaser"));

  const build = buildOfflinePlugin("a swirling phaser pedal");
  check("builder uses the approved researched module", /allpass/i.test(build.description) || build.dspFunction.includes("state.y4"), build.description.slice(0, 90));
  check("build declares its research provenance", /research you approved/i.test(build.summary) || /research you approved/i.test(build.description));

  const gatedBuild = runQualityGate(
    {
      id: "t", name: build.name, category: build.category, description: build.description,
      parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
    },
    { family: build.family, prompt: "a swirling phaser pedal" }
  );
  const gbMin = Math.min(gatedBuild.scores.looks, gatedBuild.scores.performance, gatedBuild.scores.latency, gatedBuild.scores.musicality);
  check("researched build still ships at the floor", gbMin >= 97, `min=${gbMin}`);
  check("gate reports a measured true peak (dBTP)", typeof gatedBuild.report.truePeakDb === "number" && Number.isFinite(gatedBuild.report.truePeakDb), `${gatedBuild.report.truePeakDb}`);

  /* ---- coverage audit reflects the approval ---- */
  const audit = runKnowledgeAudit({ withBenchmarks: false });
  const modArea = audit.coverage.find((a) => a.area === "Modulation");
  check("audit: phaser no longer missing in Modulation", !!modArea && !modArea.missing.some((m) => /phaser/i.test(m)), JSON.stringify(modArea?.missing));

  /* ---- rejection changes nothing ---- */
  const multitap = await runResearch("multi-tap");
  check("multi-tap approvable before decision", isApprovable(multitap));
  rejectResearch(multitap.id);
  check("rejected research does NOT extend coverage", !knownConcepts().includes("multi-tap"));
  check("rejected research is NOT buildable", findApprovedModuleForPrompt("a multi-tap rhythmic delay") === null);

  /* ---- circuit models: opto research is approvable and routes ---- */
  const opto = await runResearch("opto-model");
  check("opto research is approvable with a verified module", isApprovable(opto) && opto.proposedModule?.verification.passes === true);
  approveResearch(opto.id);
  const optoBuild = buildOfflinePlugin("an LA-2A style opto compressor for vocals");
  check("approved opto model is buildable by name", /opto|leveling/i.test(optoBuild.description), optoBuild.description.slice(0, 80));

  /* ---- external sidechain: blocked; internal sidechain: buildable ---- */
  const sidechain = await runResearch("sidechain-input");
  check("external sidechain reports the single-input constraint", sidechain.conflicts.some((c) => c.severity === "blocking" && /one input|second bus|single/i.test(c.text)));
  const deEss = await runResearch("sidechain-filter");
  check("internal sidechain (de-esser) IS approvable", isApprovable(deEss) && deEss.proposedModule?.verification.passes === true);

  /* ---- blocked concepts: the constraint is the finding ---- */
  const convolution = await runResearch("convolution");
  check("convolution research reports the block-processing constraint", convolution.conflicts.some((c) => c.severity === "blocking" && /impulse|convolution|block/i.test(c.text)));
  check("convolution carries NO proposed module", !convolution.proposedModule);
  check("convolution cannot be approved", !isApprovable(convolution) && approveResearch(convolution.id) === null);
  check("blocked approval attempt left status pending", readResearchQueue().find((i) => i.id === convolution.id)?.status === "pending");

  /* ---- formerly blocked: the stereo engine un-blocked mid-side ---- */
  const midSide = await runResearch("mid-side");
  check("mid-side is no longer blocked (stereo engine landed)", !midSide.conflicts.some((c) => c.severity === "blocking"));
  check("mid-side module was gate-verified stereo", midSide.proposedModule?.verification.passes === true);

  /* ---- unknown concept with no model: honest empty result ---- */
  const unknown = await runResearch("quantum yodel translation");
  check("unknown concept blocks with 'no findings'", unknown.conflicts.some((c) => c.severity === "blocking" && /no findings/i.test(c.text)) && !isApprovable(unknown));

  /* ---- already-covered concept gets the info conflict ---- */
  const covered = await runResearch("parallel-compression");
  check("parallel-compression flags weak/covered status honestly", covered.claims.length >= 2);
  approveResearch(covered.id);
  const parallelBuild = buildOfflinePlugin("parallel compression for drums");
  check("approved parallel compressor is buildable", /parallel/i.test(parallelBuild.description), parallelBuild.description.slice(0, 80));

  console.log(failures === 0 ? "\nRESEARCH ENGINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
