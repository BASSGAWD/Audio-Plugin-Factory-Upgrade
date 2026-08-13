/**
 * One-shot quality upgrades: parameter SEMANTICS verification, range
 * auto-CALIBRATION, best-of-N alternate builds, 2x OVERSAMPLED nonlinearities,
 * exact loudness matching for blind auditions, and failure-driven pitfall
 * memory. Every claim here is a measured assertion, per the project rule.
 */
import {
  runQualityGate,
  verifyParamSemantics,
  calibrateUnstableParams,
  measurePreviewTrim,
  measureAliasing,
  formatBuildReport,
} from "../src/utils/qualityGate";
import { runRefinementLoop, refinementScore } from "../src/utils/refinementLoop";
import { buildOfflinePlugin, buildOfflineCandidates } from "../src/utils/offlineBuilder";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { distillLessons, learnedPitfallsFor, recordLessons } from "../src/utils/learnedPitfalls";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function pluginOf(name: string, parameters: PluginParameter[], dspFunction: string): AudioPlugin {
  return {
    id: "t", name, category: "filter", description: "",
    parameters, dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
  };
}

function param(id: string, name: string, min: number, max: number, def: number): PluginParameter {
  return { id, name, min, max, defaultValue: def, value: def, unit: "" };
}

function gatedBuild(prompt: string) {
  const b = buildOfflinePlugin(prompt);
  const plugin = pluginOf(b.name, b.parameters, b.dspFunction);
  const gate = runQualityGate(plugin, { family: b.family, prompt });
  return { plugin: gate.plugin, gate };
}

(async () => {
  /* 1. Semantics: every golden recipe's knobs do what their names claim */
  for (const recipe of DSP_RECIPES) {
    const params = recipe.parameters.map((p) => ({ ...p, value: p.defaultValue }));
    const { checks, violations } = verifyParamSemantics(recipe.body, params);
    check(
      `semantics: recipe "${recipe.id}" has zero violations (${checks.length} checks ran)`,
      violations.length === 0,
      violations.join(", ")
    );
  }

  /* 2. Semantics: clearly-reversed knobs are caught */
  const reversedCutoff = pluginOf("Reversed", [param("cutoff", "Cutoff", 200, 8000, 2000), param("mix", "Mix", 0, 1, 1)],
    // cutoff knob is wired BACKWARDS: opening it closes the filter
    `if (!state.init) { state.lp = 0; state.init = true; }
let cutoff = params.cutoff !== undefined ? params.cutoff : 2000;
let mix = params.mix !== undefined ? params.mix : 1;
let inverted = 8200 - cutoff;
let a = 1 - Math.exp(-2 * Math.PI * inverted / 44100);
state.lp += a * (inputSample - state.lp);
return inputSample * (1 - mix) + state.lp * mix;`);
  const rev = verifyParamSemantics(reversedCutoff.dspFunction, reversedCutoff.parameters);
  check("semantics: reversed cutoff is flagged", rev.violations.includes("cutoff"), JSON.stringify(rev.checks));

  const reversedFeedback = pluginOf("RevFb", [param("feedback", "Feedback", 0, 0.9, 0.4)],
    `if (!state.init) { state.buf = new Float32Array(8820); state.p = 0; state.init = true; }
let feedback = params.feedback !== undefined ? params.feedback : 0.4;
let fbInv = 0.9 - feedback; // wired backwards
let read = (state.p + 1) % 8820;
let wet = state.buf[read];
state.buf[state.p] = inputSample + wet * fbInv;
state.p = (state.p + 1) % 8820;
return inputSample * 0.5 + wet * 0.6;`);
  const revFb = verifyParamSemantics(reversedFeedback.dspFunction, reversedFeedback.parameters);
  check("semantics: reversed feedback is flagged", revFb.violations.includes("feedback"), JSON.stringify(revFb.checks));

  /* 3. Semantics violations cost musicality + show in the report */
  const revGate = runQualityGate(reversedCutoff, { family: "filter", prompt: "lowpass filter" });
  check("semantics: violation penalizes musicality", revGate.scores.musicality <= 94, `musicality=${revGate.scores.musicality}`);
  check("semantics: violation named in the build report", /don't do what their name claims:.*cutoff/.test(formatBuildReport(revGate.report)));

  /* 4. Calibration: an unstable range extreme becomes a FIXED range */
  const unstable = pluginOf("Unstable", [param("res", "Resonance", 0, 1, 0.3), param("mix", "Mix", 0, 1, 1)],
    // res > 0.8 divides by ~zero -> NaN. The gate should pull max in, not just warn.
    `let res = params.res !== undefined ? params.res : 0.3;
let mix = params.mix !== undefined ? params.mix : 1;
let denom = 0.85 - res;
let wet = inputSample / (denom > 0 ? denom + 0.2 : 0);
return inputSample * (1 - mix) + wet * mix * 0.3;`);
  const calGate = runQualityGate(unstable, { family: "filter", prompt: "resonant filter" });
  const calRes = calGate.plugin.parameters.find((p) => p.id === "res")!;
  check("calibration: unstable max pulled inside the stable region", calRes.max < 0.85, `max=${calRes.max}`);
  check("calibration: no unstable params remain after calibration", calGate.report.unstableParams.length === 0, calGate.report.unstableParams.join(", "));
  check("calibration: fix recorded as evidence", calGate.report.fixes.some((f) => /Calibrated: Resonance max/.test(f)));
  check("calibration: direct call reports the calibrated id", calibrateUnstableParams(unstable.dspFunction, unstable.parameters, ["res"]).calibrated.includes("res"));

  /* 5. Oversampling: the drive recipe aliases measurably less than a raw tanh */
  const distortion = DSP_RECIPES.find((r) => r.id === "distortion")!;
  const distParams = distortion.parameters.map((p) => ({ ...p, value: p.defaultValue }));
  const maxed = distParams.map((p) => (p.id === "drive" ? { ...p, defaultValue: p.max, value: p.max } : p));
  const recipeAlias = measureAliasing(distortion.body, maxed);
  const rawBody = `let g = Math.pow(10, 24 / 20);\nreturn Math.tanh(inputSample * g) / Math.pow(g, 0.65);`;
  const rawAlias = measureAliasing(rawBody, []);
  check("oversampling: recipe at max drive aliases less than raw tanh at the same gain", recipeAlias < rawAlias, `recipe=${recipeAlias.toFixed(4)} raw=${rawAlias.toFixed(4)}`);
  const defaultGate = runQualityGate(pluginOf("Drive", distParams, distortion.body), { family: "distortion", prompt: "warm drive" });
  check("oversampling: distortion recipe is not harsh at defaults", !defaultGate.report.harsh, `aliasingIndex=${defaultGate.report.aliasingIndex}`);

  /* 6. Loudness matching: preview trim restores unity exactly (no deadband) */
  const quietTrim = measurePreviewTrim("return inputSample * 0.25;", []);
  check("loudness: quiet candidate trims up ~4x", Math.abs(quietTrim - 4) < 0.2, `trim=${quietTrim.toFixed(3)}`);
  const loudTrim = measurePreviewTrim("return inputSample * 2;", []);
  check("loudness: hot candidate trims down ~0.5x", Math.abs(loudTrim - 0.5) < 0.05, `trim=${loudTrim.toFixed(3)}`);
  check("loudness: silent/broken candidates trim to 1 (no blowup)", measurePreviewTrim("return 0;", []) === 1 && measurePreviewTrim("let a = ;", []) === 1);

  /* 7. Best-of-N: distinct alternate builds exist and seed the loop */
  const candidates = buildOfflineCandidates("make a warm tape delay");
  check("best-of-N: >=2 distinct builds for a hybrid-capable prompt", candidates.length >= 2, `n=${candidates.length}`);
  const dsps = new Set(candidates.map((c) => c.dspFunction));
  check("best-of-N: all candidates have distinct DSP", dsps.size === candidates.length);

  const base = gatedBuild("make a warm tape delay");
  const altBuild = candidates[1];
  const altPlugin = pluginOf(altBuild.name, altBuild.parameters, altBuild.dspFunction);
  const altGate = runQualityGate(altPlugin, { family: altBuild.family, prompt: "make a warm tape delay" });
  const seeded = await runRefinementLoop(base, {
    prompt: "make a warm tape delay",
    iterations: 2,
    refiner: null,
    seedCandidates: [{ plugin: altGate.plugin, gate: altGate, changeSummary: "alternate hybrid take" }],
  });
  // `candidates` is a top-3 LEADERBOARD (slice(0,3) by score), so a seed
  // that genuinely scores below three other builds legitimately misses it —
  // that is ranking working, not the seeding mechanism failing. The
  // unconditional record is the refinement trace, where every seed is
  // logged as iteration 0 whether or not it won. Assert on that, plus the
  // fact that the seed was really scored.
  const seedTraceEntries = (seeded.gate.report.refinement ?? []).filter((r) => r.iteration === 0);
  check("best-of-N: seed is scored and recorded in the refinement trace", seedTraceEntries.length === 1 && seedTraceEntries[0].score > 0, JSON.stringify(seedTraceEntries));
  check("best-of-N: leaderboard is ranked by score, best first", seeded.candidates.every((c, i, a) => i === 0 || a[i - 1].score >= c.score), seeded.candidates.map((c) => `${c.label}:${c.score.toFixed(0)}`).join(","));
  check("best-of-N: seed appears in the report as iteration 0", (seeded.gate.report.refinement || []).some((i) => i.iteration === 0 && /alternate/.test(i.action)));
  check("best-of-N: iterations trace stays rework-only", seeded.iterations.length === 2);
  check("best-of-N: report still counts only rework passes", /Perfecting loop: 2 rework passes/.test(formatBuildReport(seeded.gate.report)));
  check("best-of-N: winner is still the top score", seeded.candidates[0].score === seeded.bestScore);

  // A seed that scores higher MUST take over as best (strictly-higher rule).
  const weak = gatedBuild("make a warm tape delay");
  const weakPlugin = { ...weak.plugin, dspFunction: "return inputSample * 0.06;" };
  const weakGate = runQualityGate(weakPlugin, { family: "delay", prompt: "make a warm tape delay" });
  const rescued = await runRefinementLoop({ plugin: weakGate.plugin, gate: weakGate }, {
    prompt: "make a warm tape delay",
    iterations: 1,
    refiner: null,
    seedCandidates: [{ plugin: base.plugin, gate: base.gate, changeSummary: "verified recipe build" }],
  });
  check("best-of-N: a stronger seed replaces a weak base build", rescued.bestScore >= refinementScore(base.gate) && /state\.buf/.test(rescued.plugin.dspFunction), `best=${rescued.bestScore}`);

  /* 8. Failure memory: lessons distill deterministically and never crash headless */
  const lessons = distillLessons(revGate.report);
  check("failure memory: semantic violation distills into a lesson", lessons.some((l) => /OPPOSITE of their name/.test(l)), lessons.join(" | "));
  recordLessons("filter", revGate.report); // node has no localStorage: must be a safe no-op
  check("failure memory: headless recordLessons/learnedPitfallsFor are safe no-ops", learnedPitfallsFor("filter") === "");
  check("failure memory: clean report distills nothing", distillLessons(base.gate.report).length === 0, distillLessons(base.gate.report).join(" | "));

  console.log(failures === 0 ? "\nONE-SHOT QUALITY: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
