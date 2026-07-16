/**
 * Generates KNOWLEDGE_AUDIT.md — the accreditation report for everything the
 * factory knows. Run with `npm run audit`. Every benchmark row is a real
 * build through the real quality gate, executed right now.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runKnowledgeAudit, formatKnowledgeAudit } from "../src/utils/knowledgeAudit";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, "..", "KNOWLEDGE_AUDIT.md");

console.log("Running knowledge audit (benchmarks build through the real gate — takes a few seconds)...");
const audit = runKnowledgeAudit();
fs.writeFileSync(outPath, formatKnowledgeAudit(audit), "utf8");

console.log(`\nOverall curriculum coverage: ${audit.overallCoveragePct}%`);
for (const area of audit.coverage) {
  console.log(`  ${area.area.padEnd(22)} ${String(area.pct).padStart(3)}%  (${area.covered}/${area.total})`);
}
console.log(`Benchmark pass rate (>= 97 floor): ${audit.benchmarkPassRate}% of ${audit.benchmarks.length}`);
const failed = audit.benchmarks.filter((b) => !b.pass);
if (failed.length > 0) {
  console.log("FAILING BENCHMARKS:");
  failed.forEach((b) => console.log(`  - ${b.name} (min=${b.minScore})`));
}
console.log(`\nReport written to ${outPath}`);
process.exit(0);
