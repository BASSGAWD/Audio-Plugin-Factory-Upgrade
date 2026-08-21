/**
 * Regression-suite runner: executes every assertion-based test file in this
 * directory as its own process (each exits nonzero on failure) and reports a
 * summary. Run with `npm test`.
 *
 * These tests are the project's quality contract: recipe verification through
 * the quality gate, intent classification (including hybrid splitting),
 * family coverage, model-output normalization, and control-visual math.
 * Every recipe added to dspRecipes.ts must pass allRecipesTest at >= 97
 * before it ships.
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));

const TEST_FILES = [
  "recipeTest.ts",
  "allRecipesTest.ts",
  "specTest.ts",
  "specCoverageAudit.ts",
  "newFamilyDetectTest.ts",
  "ampSamplerTest.ts",
  "hardeningTest.ts",
  "knobMathTest.ts",
  "offlineBuilderTest.ts",
  "plannerTest.ts",
  "nativeBuildTest.ts",
  "nativeBuildEditorTest.ts",
  "refinementLoopTest.ts",
  "uiRenderTest.tsx",
  "uiRenderPatternsTest.ts",
  "signalBankTest.ts",
  "oneShotQualityTest.ts",
  "editPassTest.ts",
  "canvasFactoryTest.ts",
  "topologyTest.ts",
  "knowledgeAuditTest.ts",
  "researchEngineTest.ts",
  "stereoEngineTest.ts",
  "blockProcessingTest.ts",
  "codeAuditTest.ts",
  "cppAuditTest.ts",
  "cppKnowledgeTest.ts",
  "cppIdiomAuditTest.ts",
  "researchWebTest.ts",
  "researchIndexTest.ts",
  "fusionTest.ts",
  "functionalFitnessTest.ts",
  "calibrationRepairTest.ts",
  "cpuCostTest.ts",
  "referenceDeviationTest.ts",
  "guiArchetypeTest.ts",
  "eqCurveTest.ts",
  "featureDepthTest.ts",
  "antiAliasingTest.ts",
  "cppSafetyNetTest.ts",
  "safetyNetTest.ts",
  "controlInteractionTest.ts",
  "accentNormalizationTest.ts",
  "liveBuildDiscoveryTest.ts",
  "sidechainEngineTest.ts",
];

let failed = 0;
const results: string[] = [];

for (const file of TEST_FILES) {
  const start = Date.now();
  const run = spawnSync("npx", ["tsx", path.join(here, file)], {
    shell: true,
    encoding: "utf8",
  });
  const ms = Date.now() - start;
  const ok = run.status === 0;
  if (!ok) failed++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${file.padEnd(26)} ${ms}ms`);
  if (!ok) {
    console.log(`\n----- ${file} output -----`);
    console.log(run.stdout || "");
    console.log(run.stderr || "");
  }
}

console.log("\n=== Regression suite ===");
results.forEach((r) => console.log(r));
console.log(failed === 0 ? `\nALL ${TEST_FILES.length} SUITES PASS` : `\n${failed} SUITE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
