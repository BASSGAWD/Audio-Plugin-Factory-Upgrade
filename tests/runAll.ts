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

import { spawn } from "child_process";
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
  "serverSecurityTest.ts",
  "knobMathTest.ts",
  "offlineBuilderTest.ts",
  "composeReindentTest.ts",
  "plannerTest.ts",
  "audioProjectHarnessTest.ts",
  "audioProjectEndpointTest.ts",
  "audioProjectRuntimeTest.ts",
  "audioProjectDispatchTest.ts",
  "audioProjectEffectSequenceTest.ts",
  "audioProjectPreviewSecurityTest.ts",
  "nativeBuildTest.ts",
  "nativeProjectTargetTest.ts",
  "nativeBuildEditorTest.ts",
  "nativeUiSecurityTest.ts",
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
  "roamingResearchTest.ts",
  "pluginPersistenceTest.ts",
  "buildCrewTest.ts",
  "teamCollaborationTest.ts",
  "beatLockedAutotuneTest.ts",
  "architectSyncTest.ts",
  "stereoEngineTest.ts",
  "blockProcessingTest.ts",
  "codeAuditTest.ts",
  "oversampledWaveshapeTest.ts",
  "cppAuditTest.ts",
  "cppKnowledgeTest.ts",
  "cppIdiomAuditTest.ts",
  "researchWebTest.ts",
  "researchIndexTest.ts",
  "fusionTest.ts",
  "providerGatewayTest.ts",
  "functionalFitnessTest.ts",
  "calibrationRepairTest.ts",
  "cpuCostTest.ts",
  "referenceDeviationTest.ts",
  "guiArchetypeTest.ts",
  "resolvedUiContractTest.ts",
  "visualIdentityTest.tsx",
  "uiSemanticPipelineTest.ts",
  "eqCurveTest.ts",
  "featureDepthTest.ts",
  "antiAliasingTest.ts",
  "cppSafetyNetTest.ts",
  "safetyNetTest.ts",
  "controlInteractionTest.ts",
  "accentNormalizationTest.ts",
  "liveBuildDiscoveryTest.ts",
  "sidechainEngineTest.ts",
  "ampVoicingTest.ts",
  "dawCoreTest.ts",
  "dawContractTest.ts",
  "dawHydrationTest.ts",
  "desktopGoldenTest.ts",
  "desktopScaffoldContractTest.ts",
  "desktopLatencyEvidenceTest.ts",
  "desktopReleaseContractTest.ts",
  "audioProjectTruthfulnessTest.ts",
  "audioProjectLegacyPluginSanitizeTest.ts",
];

let failed = 0;
const results: string[] = new Array(TEST_FILES.length);
const failureOutput: string[] = new Array(TEST_FILES.length).fill("");
let nextFile = 0;

async function runFile(file: string, index: number) {
  const start = Date.now();
  // shell: true is required for `npx` to resolve at all on Windows (it's a
  // .cmd wrapper there, and spawn() with shell:false can't exec it directly
  // -- ENOENT). A shell is available on every platform this runs on, so
  // there's no cross-platform reason to prefer shell:false here.
  const run = spawn("npx", ["tsx", path.join(here, file)], {
    shell: true,
  });
  let stdout = "";
  let stderr = "";
  run.stdout?.setEncoding("utf8");
  run.stderr?.setEncoding("utf8");
  run.stdout?.on("data", chunk => { stdout += chunk; });
  run.stderr?.on("data", chunk => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => {
    run.once("error", reject);
    run.once("close", resolve);
  });
  const ms = Date.now() - start;
  const ok = status === 0;
  if (!ok) failed++;
  results[index] = `${ok ? "PASS" : "FAIL"}  ${file.padEnd(26)} ${ms}ms`;
  if (!ok) {
    failureOutput[index] = `\n----- ${file} output -----\n${stdout}\n${stderr}`;
  }
}

async function worker() {
  while (nextFile < TEST_FILES.length) {
    const index = nextFile++;
    await runFile(TEST_FILES[index], index);
  }
}

await Promise.all(Array.from({ length: Math.min(2, TEST_FILES.length) }, () => worker()));

failureOutput.filter(Boolean).forEach(output => console.log(output));
console.log("\n=== Regression suite ===");
results.forEach((r) => console.log(r));
console.log(failed === 0 ? `\nALL ${TEST_FILES.length} SUITES PASS` : `\n${failed} SUITE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
