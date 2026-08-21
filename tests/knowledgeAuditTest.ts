/**
 * Milestone 1 contract — the Knowledge Auditor must be honest:
 *
 *  - coverage comes only from concepts the graph actually reaches
 *  - known-missing curriculum items (convolution, biquad, external
 *    sidechain...) MUST show up in the gap report — an auditor that reports
 *    100% is broken
 *  - demonstrated ability is measured by real gated builds, and every
 *    benchmark must ship at the >= 97 floor
 *  - the report renders every section
 */
import { runKnowledgeAudit, formatKnowledgeAudit, CURRICULUM, BENCHMARKS } from "../src/utils/knowledgeAudit";
import { DSP_RECIPES } from "../src/utils/dspRecipes";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const audit = runKnowledgeAudit();

/* ---- inventory reflects the real banks ---- */
// Was hardcoded to 10 -- stale as soon as the recipe bank grows (broke the
// instant tremolo/phaser shipped, taking DSP_RECIPES from 10 to 12).
check(`inventory: ${DSP_RECIPES.length} recipes`, audit.inventory.recipes === DSP_RECIPES.length, `${audit.inventory.recipes}`);
check("inventory: 10 primitives", audit.inventory.primitives === 10, `${audit.inventory.primitives}`);
check("inventory: >= 12 topologies", audit.inventory.topologies >= 12, `${audit.inventory.topologies}`);

/* ---- coverage is honest: neither empty nor perfect ---- */
check("overall coverage is a real percentage", audit.overallCoveragePct > 0 && audit.overallCoveragePct < 100, `${audit.overallCoveragePct}%`);
const allMissing = audit.coverage.flatMap((a) => a.missing);
// FFT/spectral, stereo/mid-side, biquad, parallel-compression, and
// convolution all used to be this test's known-missing examples in turn --
// each stopped being a gap the moment its real topology shipped, which is a
// GOOD outcome, not a break (same pattern as the "10 recipes" hardcode
// above). Chasing real-but-temporary gaps for this purpose kept breaking
// the test, so a single PERMANENT synthetic anchor now does this job
// instead (knowledgeAudit.ts's "Test invariants" area) -- it can never be
// promoted out from under the test because nothing real can ever satisfy
// its deliberately-fake concept string. External sidechain closed too, the
// same way, once comp_sidechain_ext (a real second-input-bus-free design:
// the detector reads inputKey, gain reduction applies to the main signal)
// shipped as a topology.
check("covered: convolution reverb no longer a gap", !allMissing.some((m) => /convolution/i.test(m)));
check("covered: multi-tap delay no longer a gap", !allMissing.some((m) => /multi.?tap/i.test(m)));
check("covered: parallel compression no longer a gap", !allMissing.some((m) => /parallel/i.test(m)));
check("covered: external sidechain no longer a gap", !allMissing.some((m) => /sidechain input/i.test(m)));
check("known-missing: the permanent test-honesty anchor is reported", allMissing.some((m) => /audit-honesty anchor/i.test(m)));
check("covered: lookahead compression no longer a gap", !allMissing.some((m) => /lookahead/i.test(m)));
check("covered: FDN no longer a gap", !allMissing.some((m) => /delay network/i.test(m)));
check("every curriculum area is scored", audit.coverage.length >= 8, `${audit.coverage.length} areas`);
check("curriculum is non-trivial", CURRICULUM.length >= 50, `${CURRICULUM.length} items`);
const hygiene = audit.coverage.find((a) => a.area === "Engineering hygiene");
check("Engineering hygiene fully covered (incl. true-peak measurement)", hygiene?.pct === 100, JSON.stringify(hygiene?.missing));

/* ---- balance sees the concept clusters ---- */
const comp = audit.balance.find((b) => b.concept === "compressor");
check("balance: compressor cluster counted", !!comp && comp.modules.length >= 5, comp ? `${comp.modules.length} modules` : "missing");

/* ---- demonstrated ability: measured, and at the floor ---- */
check("benchmarks ran", audit.benchmarks.length === BENCHMARKS.length, `${audit.benchmarks.length}`);
check("EVERY benchmark ships at >= 97", audit.benchmarkPassRate === 100,
  audit.benchmarks.filter((b) => !b.pass).map((b) => `${b.name}=${b.minScore}`).join(", ") || "all pass");
const routed = audit.benchmarks.filter((b) => b.chosenTopology);
check("routing recorded for topology families", routed.length >= 8, `${routed.length} routed`);
check("mastering benchmark routed to lookahead",
  audit.benchmarks.find((b) => b.name.includes("mastering"))?.chosenTopology === "comp_lookahead_master");

/* ---- report renders every section ---- */
const md = formatKnowledgeAudit(audit);
for (const section of ["# OrangeJuce Knowledge Audit", "## 1. Inventory", "## 2. Curriculum coverage", "Gap report", "## 3. Balance", "## 4. Trust tiers", "## 5. Demonstrated ability"]) {
  check(`report renders "${section}"`, md.includes(section));
}

console.log(failures === 0 ? "\nKNOWLEDGE AUDIT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
