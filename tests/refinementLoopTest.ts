/**
 * Perfecting-loop tests: monotonic by construction — a rework can only
 * replace the build when it passes acceptance AND scores strictly higher.
 */
import { runRefinementLoop, refinementScore, voicingVariant, isNearTie, NEAR_TIE_MARGIN, MAX_REFINE_LOOPS } from "../src/utils/refinementLoop";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate, formatBuildReport, measureCharacterIndex } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function gatedBuild(prompt: string, dspOverride?: string): { plugin: AudioPlugin; gate: ReturnType<typeof runQualityGate> } {
  const b = buildOfflinePlugin(prompt);
  const plugin: AudioPlugin = {
    id: "t", name: b.name, category: b.category, description: b.description,
    parameters: b.parameters, dspFunction: dspOverride ?? b.dspFunction,
    faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const gate = runQualityGate(plugin, { family: b.family, prompt });
  return { plugin: gate.plugin, gate };
}

(async () => {
  /* 1. Deterministic loop: never regresses, full honest trace */
  const initial = gatedBuild("make a warm tape delay");
  const s0 = refinementScore(initial.gate);
  const det = await runRefinementLoop(initial, { prompt: "make a warm tape delay", iterations: 3, refiner: null });
  check("deterministic: 3 iterations traced", det.iterations.length === 3);
  check("deterministic: never regresses", det.bestScore >= s0, `s0=${s0} best=${det.bestScore}`);
  check("deterministic: final gate >= 97", Math.min(det.gate.scores.looks, det.gate.scores.performance, det.gate.scores.latency, det.gate.scores.musicality) >= 97);
  check("deterministic: trace lands in the report", (det.gate.report.refinement || []).length === 3);
  check("deterministic: report renders the loop", /Perfecting loop: 3 rework passes/.test(formatBuildReport(det.gate.report)));

  /* 2. Improving refiner: quiet initial build -> proper recipe body accepted */
  const quiet = gatedBuild("make a warm tape delay", "return inputSample * 0.06;"); // ~-24 dB, needs a big trim (score penalty)
  const quietScore = refinementScore(quiet.gate);
  const improved = await runRefinementLoop(quiet, {
    prompt: "make a warm tape delay",
    iterations: 2,
    refiner: async () => ({ dspFunction: DSP_RECIPES.find((r) => r.id === "delay")!.body, notes: "restored full delay algorithm" }),
  });
  check("improving refiner: accepted a higher-scoring rework", improved.bestScore > quietScore && improved.iterations.some((i) => i.accepted), `before=${quietScore} after=${improved.bestScore}`);
  check("improving refiner: kept the reworked DSP", /state\.buf/.test(improved.plugin.dspFunction));

  /* 3. Hostile refiner: broken code is rejected by acceptance, build preserved */
  const hostile = await runRefinementLoop(initial, {
    prompt: "make a warm tape delay",
    iterations: 2,
    refiner: async () => ({ dspFunction: "let mix = 1;\nlet mix = 2;\nreturn inputSample;", notes: "trust me" }),
  });
  check("hostile refiner: rejected by acceptance check", hostile.iterations.every((i) => /rejected|voicing variant/.test(i.action)));
  check("hostile refiner: original DSP untouched", hostile.plugin.dspFunction === initial.plugin.dspFunction || hostile.bestScore > s0);
  check("hostile refiner: still >= 97", Math.min(hostile.gate.scores.musicality, hostile.gate.scores.looks) >= 97);

  /* 4. Voicing variant + clamping */
  const v = voicingVariant(initial.plugin, 1);
  const mix0 = initial.plugin.parameters.find((p) => p.id === "mix")!;
  const mix1 = v.parameters.find((p) => p.id === "mix")!;
  check("voicing variant nudges intensity params in range", mix1.defaultValue !== mix0.defaultValue && mix1.defaultValue >= mix1.min && mix1.defaultValue <= mix1.max, `${mix0.defaultValue}->${mix1.defaultValue}`);
  check("voicing variant never touches code", v.dspFunction === initial.plugin.dspFunction);
  const clamped = await runRefinementLoop(initial, { prompt: "make a warm tape delay", iterations: 99, refiner: null });
  check(`iterations clamp to ${MAX_REFINE_LOOPS}`, clamped.iterations.length === MAX_REFINE_LOOPS);

  /* 5. Character index: silence ~0, distortion clearly reshapes the spectrum */
  const silentIdx = measureCharacterIndex("return 0;", [{ id: "x", name: "X", min: 0, max: 1, defaultValue: 0, value: 0, unit: "" }]);
  check("character index: silence is near zero", silentIdx < 0.05, `silentIdx=${silentIdx}`);

  const passthroughIdx = measureCharacterIndex("return inputSample;", [{ id: "x", name: "X", min: 0, max: 1, defaultValue: 0, value: 0, unit: "" }]);
  check("character index: exact passthrough is near zero", passthroughIdx < 0.05, `passthroughIdx=${passthroughIdx}`);

  const heavyDistortIdx = measureCharacterIndex(
    "return Math.tanh(inputSample * 40);",
    [{ id: "x", name: "X", min: 0, max: 1, defaultValue: 0, value: 0, unit: "" }]
  );
  check("character index: heavy distortion clearly reshapes the spectrum", heavyDistortIdx > passthroughIdx + 0.1, `passthrough=${passthroughIdx} distort=${heavyDistortIdx}`);

  const brokenIdx = measureCharacterIndex("let a = ;", []);
  check("character index: uncompilable code is zero, not a crash", brokenIdx === 0);

  // Confirms the tie-breaker is real but bounded: two candidates with
  // identical gate scores but different characterIndex must rank by it,
  // and the gap it can create is small relative to the correctness terms.
  const lowChar = { ...initial.gate, report: { ...initial.gate.report, characterIndex: 0 } };
  const highChar = { ...initial.gate, report: { ...initial.gate.report, characterIndex: 1 } };
  check("character index: breaks ties between equal-score candidates", refinementScore(highChar) > refinementScore(lowChar));
  check("character index: bonus stays small relative to correctness terms", refinementScore(highChar) - refinementScore(lowChar) <= 3);

  /* 6. Ranked candidates: distinct, described, and ordered — the leaderboard +
        blind-test payload. Even on an already-maxed build the loop must surface
        >=2 audibly-distinct versions to rank and audition. */
  const ranked = await runRefinementLoop(initial, { prompt: "make a warm tape delay", iterations: 4, refiner: null });
  check("candidates: >=2 distinct versions retained", ranked.candidates.length >= 2, `n=${ranked.candidates.length}`);
  check("candidates: every version has a change summary", ranked.candidates.every((c) => !!c.changeSummary && c.changeSummary.length > 0));
  check("candidates: ranked by score descending", ranked.candidates.every((c, i) => i === 0 || ranked.candidates[i - 1].score >= c.score));
  check("candidates: rank field matches order", ranked.candidates.every((c, i) => c.rank === i + 1));
  check("candidates: initial v1 is included", ranked.candidates.some((c) => c.label === "v1"));
  const sigs = ranked.candidates.map((c) => c.plugin.dspFunction + "|" + c.plugin.parameters.map((p) => Math.round(p.defaultValue * 1000)).join(","));
  check("candidates: no duplicate versions", new Set(sigs).size === sigs.length);
  check("candidates: top-ranked is the loaded best", ranked.candidates[0].score === ranked.bestScore, `top=${ranked.candidates[0].score} best=${ranked.bestScore}`);

  /* 7. Near-tie boundary drives the human-override rule */
  check("isNearTie: within margin is a tie", isNearTie(800, 800 + NEAR_TIE_MARGIN));
  check("isNearTie: beyond margin is not", !isNearTie(800, 800 + NEAR_TIE_MARGIN + 0.1));

  console.log(failures === 0 ? "\nREFINEMENT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
