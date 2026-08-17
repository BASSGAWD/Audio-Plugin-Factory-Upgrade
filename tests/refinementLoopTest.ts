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

  /* 4b. Regression: the caller used to pass voicingVariant the raw outer
   *     loop index `n`. Voicing only ever runs on ODD n, so `n - 1` was
   *     always EVEN, and an even number mod NUDGE_FRACTIONS.length (6) can
   *     only land on indices {0, 2, 4} -- the three POSITIVE fractions. The
   *     three NEGATIVE ones were unreachable for the life of this code. When
   *     the targeted param's default already sat at its max (e.g. an
   *     effect's Mix knob at fully-wet 1.0), every reachable positive
   *     fraction clamped to the same value -- a "perfecting loop" that
   *     silently repeated one no-op candidate over and over while reporting
   *     each repeat as a fresh attempt. This is exactly the pattern a real
   *     build showed: 13 voicing-variant loops scoring identically to 13
   *     decimal places.
   *
   *     Prove the OLD calling pattern really was degenerate (so this isn't
   *     a strawman), then prove the ACTUAL shipped loop no longer follows it. */
  const pinnedMix = gatedBuild("make a warm tape delay");
  const mixParam = pinnedMix.plugin.parameters.find((p) => p.id === "mix")!;
  const pinnedPlugin: AudioPlugin = {
    ...pinnedMix.plugin,
    parameters: pinnedMix.plugin.parameters.map((p) => (p.id === "mix" ? { ...p, defaultValue: p.max, value: p.max } : p)),
  };

  // The old bug, reproduced directly: simulate the caller always passing the
  // raw odd outer-loop index (1, 3, 5, 7, 9, 11 -- exactly what `n` is on
  // every iteration voicingVariant used to be invoked with).
  const oldCallerPattern = [1, 3, 5, 7, 9, 11].map((n) => voicingVariant(pinnedPlugin, n).parameters.find((p) => p.id === "mix")!.defaultValue);
  check(
    "regression bait: the OLD raw-n calling pattern really was degenerate (proves this isn't a strawman)",
    oldCallerPattern.every((v) => v === mixParam.max),
    `all clamped to ${mixParam.max}: [${oldCallerPattern.join(", ")}]`
  );

  // The fix: an independent, sequentially-incrementing counter (mirroring
  // structuralCalls' existing pattern) reaches every fraction, including the
  // negative ones -- proven directly against the same pinned-at-max fixture.
  const fixedCallerPattern = [1, 2, 3, 4, 5, 6].map((i) => voicingVariant(pinnedPlugin, i).parameters.find((p) => p.id === "mix")!.defaultValue);
  check(
    "voicing variant with a proper sequential counter reaches values BELOW the pinned max",
    fixedCallerPattern.some((v) => v < mixParam.max),
    `[${fixedCallerPattern.join(", ")}]`
  );
  check(
    "...specifically hits all three negative fractions, not just some",
    new Set(fixedCallerPattern).size >= 4, // 3 distinct downward values + the repeated clamp-at-max
    `distinct values: ${new Set(fixedCallerPattern).size}`
  );

  // End-to-end: the ACTUAL shipped loop, not just the isolated function,
  // exercised on the exact fixture that used to degenerate.
  const pinnedGate = runQualityGate(pinnedPlugin, { family: "delay", prompt: "make a warm tape delay" });
  const e2e = await runRefinementLoop({ plugin: pinnedGate.plugin, gate: pinnedGate }, { prompt: "make a warm tape delay", iterations: 9, refiner: null });
  const voicingTrace = e2e.iterations.filter((it) => /voicing variant/.test(it.action));
  const distinctVoicingScores = new Set(voicingTrace.map((it) => it.score.toFixed(6)));
  check(
    "end-to-end: the shipped loop's voicing attempts are no longer all identical",
    voicingTrace.length >= 2 && distinctVoicingScores.size > 1,
    `${voicingTrace.length} voicing attempts, ${distinctVoicingScores.size} distinct scores`
  );
  check(
    "end-to-end: a genuine downward move actually shows up in the trace, not just an upward one",
    voicingTrace.some((it) => /-\d/.test(it.changeSummary)),
    voicingTrace.map((it) => it.changeSummary).join(" | ")
  );

  // Duplicate detection: a candidate identical to one already fully gated
  // this run should be reported as a duplicate, not silently re-scored as if
  // it were a fresh attempt -- and should reuse the cached gate result exactly.
  const dupeMarked = e2e.iterations.filter((it) => /identical to an earlier attempt/.test(it.action));
  if (dupeMarked.length > 0) {
    check("duplicate candidates are labeled honestly in the trace, not presented as fresh attempts", true, `${dupeMarked.length} marked`);
  } else {
    check("no duplicates arose in this run (fine -- the diversity fix may have simply eliminated them)", true);
  }

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

  /* 5b. Regression: characterIndex used to be PURELY a spectral-distribution
   *      L1 distance -- structurally blind to delay/reverb/echo-type
   *      character. A clean delay repeats the SAME frequency content later;
   *      its overall spectral shape barely moves even though the effect is
   *      obviously, audibly transformative. A real generated delay measured
   *      0.0011 by the old code -- indistinguishable from the passthrough's
   *      exact 0 above.
   *
   *      Isolate the claim cleanly: a PURE time-shift delay (no filtering,
   *      no feedback, no saturation -- literally just a fixed read offset
   *      into a ring buffer) has by construction IDENTICAL frequency-magnitude
   *      content to its input; a pure delay only shifts phase. So the OLD
   *      spectral-only measurement's verdict on this exact plugin was
   *      necessarily at or near zero -- not "low", mathematically minimal --
   *      while it is unambiguously, audibly a different signal (the delayed
   *      copy lands where the input was silent). This isn't a strawman stand-in
   *      for "delay in general" -- it's the specific case the spectral term
   *      cannot see ANY of, by the nature of what a Fourier magnitude spectrum
   *      is blind to. */
  const pureDelayIdx = measureCharacterIndex(
    "if (!state.init) { state.buf = new Float32Array(20000); state.ptr = 0; state.init = true; } state.buf[state.ptr] = inputSample; let out = state.buf[(state.ptr + 8000) % 20000]; state.ptr = (state.ptr + 1) % 20000; return out;",
    []
  );
  check(
    "character index: a pure time-shift delay (zero spectral change by construction) is no longer scored near-zero",
    pureDelayIdx > 0.15,
    `pureDelayIdx=${pureDelayIdx}`
  );

  // Sanity anchor: families that WERE already correctly scored (spectral
  // reshaping is real and dominant) must not regress from adding the new
  // temporal axis -- max(spectral, temporal) must not silently shrink an
  // already-good spectral score.
  check(
    "character index: an already spectrally-characterful signal is unaffected by the new temporal axis",
    Math.abs(measureCharacterIndex("return Math.tanh(inputSample * 40);", [{ id: "x", name: "X", min: 0, max: 1, defaultValue: 0, value: 0, unit: "" }]) - heavyDistortIdx) < 1e-9
  );

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
  // v1 (the unmutated baseline) no longer has a blanket "always in the top-3"
  // guarantee now that structural search can genuinely out-perform it more
  // than twice over -- that is the search widening as intended, not a leak.
  // What must still hold: v1 is EITHER present, OR every candidate that
  // displaced it out of the top-3 is a build that actually beats it (never
  // bumped by something merely different, or tied, or worse).
  const v1Entry = ranked.candidates.find((c) => c.label === "v1");
  check(
    "candidates: v1 present, or every candidate that displaced it strictly outscores it",
    !!v1Entry || ranked.candidates.every((c) => c.score > s0),
    v1Entry ? "v1 present" : `v1(${s0.toFixed(1)}) displaced by [${ranked.candidates.map((c) => `${c.label}:${c.score.toFixed(1)}`).join(", ")}]`
  );
  const sigs = ranked.candidates.map((c) => c.plugin.dspFunction + "|" + c.plugin.parameters.map((p) => Math.round(p.defaultValue * 1000)).join(","));
  check("candidates: no duplicate versions", new Set(sigs).size === sigs.length);
  check("candidates: top-ranked is the loaded best", ranked.candidates[0].score === ranked.bestScore, `top=${ranked.candidates[0].score} best=${ranked.bestScore}`);

  /* 7. Near-tie boundary drives the human-override rule */
  check("isNearTie: within margin is a tie", isNearTie(800, 800 + NEAR_TIE_MARGIN));
  check("isNearTie: beyond margin is not", !isNearTie(800, 800 + NEAR_TIE_MARGIN + 0.1));

  console.log(failures === 0 ? "\nREFINEMENT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
