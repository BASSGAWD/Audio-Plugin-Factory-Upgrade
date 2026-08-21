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
  const plan = planResearch("parallel compression");
  check("plan asks the engineering questions", plan.questions.length >= 3 && plan.acceptance.some((a) => /human approval/i.test(a)));

  // "phaser", then "parallel-compression", then "multi-tap" each used to be
  // this test's pending-research gap-example in turn -- each stopped being a
  // gap the moment its real topology shipped (dspTopologies.ts), which is a
  // GOOD outcome, not a break, but it kept breaking the "is a gap before
  // research" / "rejection doesn't extend coverage" assertions below. Those
  // now run against two permanent synthetic fixtures (researchCorpus.ts's
  // TEST-ONLY FIXTURES block) that can never be promoted out from under this
  // test. Parallel compression itself is exercised below as an
  // ALREADY-COVERED concept instead (same pattern as opto-model further
  // down) -- research/approval/build still works on a concept that's
  // already a standing topology, it just doesn't newly unlock anything.
  /* ---- research an already-shipped concept: parallel compression ---- */
  const parallelComp = await runResearch("parallel compression");
  check("parallel-compression research yields cited claims", parallelComp.claims.length >= 2 && parallelComp.claims.every((c) => c.citation.authority > 0));
  check("literature outranks lower tiers (sorted by authority)", parallelComp.claims[0].citation.authority >= parallelComp.claims[parallelComp.claims.length - 1].citation.authority);
  check("parallel-compression is already covered (comp_parallel ships as a topology)", knownConcepts().includes("parallel-compression"));

  approveResearch(parallelComp.id);
  check("approval makes the module explicitly buildable too", approvedModules().some((i) => i.concept === "parallel-compression"));

  const build = buildOfflinePlugin("a parallel compression bus");
  check("builder produces a real parallel-compression build", /blend|parallel/i.test(build.description) || build.dspFunction.includes("state.env"), build.description.slice(0, 90));

  const gatedBuild = runQualityGate(
    {
      id: "t", name: build.name, category: build.category, description: build.description,
      parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
    },
    { family: build.family, prompt: "a parallel compression bus" }
  );
  const gbMin = Math.min(gatedBuild.scores.looks, gatedBuild.scores.performance, gatedBuild.scores.latency, gatedBuild.scores.musicality);
  check("parallel-compression build ships at the floor", gbMin >= 97, `min=${gbMin}`);
  check("gate reports a measured true peak (dBTP)", typeof gatedBuild.report.truePeakDb === "number" && Number.isFinite(gatedBuild.report.truePeakDb), `${gatedBuild.report.truePeakDb}`);

  /* ---- coverage audit reflects reality ---- */
  const audit = runKnowledgeAudit({ withBenchmarks: false });
  const compArea = audit.coverage.find((a) => a.area === "Compressors");
  check("audit: parallel-compression is not missing in Compressors", !!compArea && !compArea.missing.some((m) => /parallel.?comp/i.test(m)), JSON.stringify(compArea?.missing));

  /* ---- the pending -> approved lifecycle boundary (synthetic fixture A) ---- */
  const before = knownConcepts();
  check("test-lifecycle-fixture-a is a gap before research", !before.includes("test-lifecycle-fixture-a"));

  const fixtureA = await runResearch("test-lifecycle-fixture-a");
  check("fixture research yields cited claims", fixtureA.claims.length >= 2 && fixtureA.claims.every((c) => c.citation.authority > 0));
  check("fixture module was gate-verified in the pipeline", fixtureA.proposedModule?.verification.passes === true, `min=${fixtureA.proposedModule?.verification.minScore}`);
  check("fixture is approvable", isApprovable(fixtureA));
  check("pending research does NOT extend coverage", !knownConcepts().includes("test-lifecycle-fixture-a"));
  check("pending research is NOT buildable", findApprovedModuleForPrompt("test-lifecycle-fixture-a") === null);

  /* ---- dedupe while pending ---- */
  const again = await runResearch("test-lifecycle-fixture-a");
  check("re-research while pending dedupes", again.id === fixtureA.id && readResearchQueue().filter((i) => i.concept === "test-lifecycle-fixture-a").length === 1);

  /* ---- the approval boundary ---- */
  approveResearch(fixtureA.id);
  check("approval extends known concepts", knownConcepts().includes("test-lifecycle-fixture-a"));
  check("approval makes the module buildable", approvedModules().some((i) => i.concept === "test-lifecycle-fixture-a"));

  /* ---- rejection changes nothing (synthetic fixture B) ---- */
  const fixtureB = await runResearch("test-lifecycle-fixture-b");
  check("fixture B approvable before decision", isApprovable(fixtureB));
  rejectResearch(fixtureB.id);
  check("rejected research does NOT extend coverage", !knownConcepts().includes("test-lifecycle-fixture-b"));
  check("rejected research is NOT buildable", findApprovedModuleForPrompt("test-lifecycle-fixture-b") === null);

  /* ---- circuit models: opto research is approvable and routes ---- */
  const opto = await runResearch("opto-model");
  check("opto research is approvable with a verified module", isApprovable(opto) && opto.proposedModule?.verification.passes === true);
  approveResearch(opto.id);
  const optoBuild = buildOfflinePlugin("an LA-2A style opto compressor for vocals");
  check("approved opto model is buildable by name", /opto|leveling/i.test(optoBuild.description), optoBuild.description.slice(0, 80));

  const deEss = await runResearch("sidechain-filter");
  check("internal sidechain (de-esser) IS approvable", isApprovable(deEss) && deEss.proposedModule?.verification.passes === true);

  /* ---- formerly blocked, now buildable: stereo (mid-side), block/FFT
   *      (convolution, spectral), and external sidechain (a 5th, opt-in
   *      inputKey argument -- the last concept that used to have no
   *      prerequisite path at all) ---- */
  const midSide = await runResearch("mid-side");
  check("mid-side is no longer blocked (stereo engine landed)", !midSide.conflicts.some((c) => c.severity === "blocking"));
  check("mid-side module was gate-verified stereo", midSide.proposedModule?.verification.passes === true);
  const convolution = await runResearch("convolution");
  check("convolution is no longer blocked (block processing landed)", !convolution.conflicts.some((c) => c.severity === "blocking") && convolution.proposedModule?.verification.passes === true);
  const spectral = await runResearch("spectral-processing");
  check("spectral/FFT is no longer blocked (inline FFT landed)", !spectral.conflicts.some((c) => c.severity === "blocking") && spectral.proposedModule?.verification.passes === true);
  const sidechain = await runResearch("sidechain-input");
  check("external sidechain is no longer blocked (inputKey landed)", !sidechain.conflicts.some((c) => c.severity === "blocking") && sidechain.proposedModule?.verification.passes === true);
  approveResearch(sidechain.id);
  const sidechainBuild = buildOfflinePlugin("a sidechain compressor ducking from an external key");
  check("approved sidechain compressor is buildable by name", /sidechain|duck|key/i.test(sidechainBuild.description) || sidechainBuild.dspFunction.includes("inputKey"), sidechainBuild.description.slice(0, 80));

  /* ---- unknown concept with no model: honest empty result ---- */
  const unknown = await runResearch("quantum yodel translation");
  check("unknown concept blocks with 'no findings'", unknown.conflicts.some((c) => c.severity === "blocking" && /no findings/i.test(c.text)) && !isApprovable(unknown));

  // The "already-covered concept" scenario is now exercised directly at the
  // top of this file (parallel-compression is covered from the start, not
  // partway through), so no separate re-check is needed here.

  console.log(failures === 0 ? "\nRESEARCH ENGINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
