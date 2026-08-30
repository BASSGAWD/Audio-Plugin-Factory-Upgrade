/**
 * Safety net + fail-fast pre-check.
 *
 * There was previously ZERO NaN/Inf/denormal protection anywhere in the JS
 * render/playback path. Any unstable DSP -- a feedback delay/reverb, a
 * resonant filter pushed past stability, a divide landing on zero, or a
 * structural-search combination of primitives never individually tested
 * together -- could produce NaN/Inf output that, in the live preview path,
 * reaches a real user's speakers as full-scale noise. This is a safety
 * issue, not a quality one.
 *
 * This suite proves two separate things, each per CLAUDE.md's verification
 * standard (measure the honest path AND a deliberately broken counterpart,
 * assert a DECISIVE gap -- a measurement that scores both the same is not
 * measuring anything):
 *
 *  1. sanitizeSample() -- the mandatory final safety net applied to every
 *     per-sample DSP output, in both the offline gate's renderPass() and
 *     (mirrored by hand into the AudioWorkletGlobalScope, and imported
 *     directly into the ScriptProcessor fallback) the live playback path
 *     in App.tsx -- turns NaN/Infinity/denormals/insane-but-finite values
 *     into finite, bounded audio, and NEVER fires on any of the 10 golden
 *     recipes or their topology variants at default settings.
 *
 *  2. quickHealthCheck() -- the fail-fast pre-check in runQualityGate --
 *     recognizes a broken candidate (doesn't compile, throws/NaNs, or is
 *     silent at defaults) from a cheap probe and skips the expensive
 *     measurement suite entirely, with a MEASURED, decisive time saving,
 *     while NEVER firing on any golden recipe or topology variant.
 */
import {
  sanitizeSample,
  quickHealthCheck,
  measureMusicality,
  measureTruePeak,
  runQualityGate,
} from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, min: number, max: number, def: number, unit = ""): PluginParameter =>
  ({ id, name: id, min, max, defaultValue: def, value: def, unit } as PluginParameter);

const pluginOf = (dspFunction: string, parameters: PluginParameter[] = []): AudioPlugin => ({
  id: "safety-net-test", name: "Safety Net Test", category: "filter", description: "",
  parameters, dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
});

/* ==================================================================== */
/* 1. sanitizeSample -- unit-level proof of the guard itself             */
/* ==================================================================== */

check("sanitizeSample: NaN -> 0", sanitizeSample(NaN) === 0);
check("sanitizeSample: +Infinity -> 0", sanitizeSample(Infinity) === 0);
check("sanitizeSample: -Infinity -> 0", sanitizeSample(-Infinity) === 0);
check("sanitizeSample: exact 0 stays 0", sanitizeSample(0) === 0);
check("sanitizeSample: denormal-magnitude positive value flushed to 0", sanitizeSample(1e-300) === 0);
check("sanitizeSample: denormal-magnitude negative value flushed to 0", sanitizeSample(-1e-300) === 0);
check("sanitizeSample: right at the ~1e-15 floor is flushed", sanitizeSample(1e-16) === 0);
check("sanitizeSample: a legitimately quiet (non-denormal) value passes through unchanged", sanitizeSample(1e-10) === 1e-10, `got ${sanitizeSample(1e-10)}`);
check("sanitizeSample: an insane finite positive value clips to +4.0", sanitizeSample(1e20) === 4, `got ${sanitizeSample(1e20)}`);
check("sanitizeSample: an insane finite negative value clips to -4.0", sanitizeSample(-1e20) === -4, `got ${sanitizeSample(-1e20)}`);
check("sanitizeSample: exactly +4.0 is untouched", sanitizeSample(4) === 4);
check("sanitizeSample: just past +4.0 clips", sanitizeSample(4.0001) === 4);
check("sanitizeSample: ordinary unity-range signal is untouched", sanitizeSample(0.42) === 0.42);
check("sanitizeSample: ordinary negative unity-range signal is untouched", sanitizeSample(-0.73) === -0.73);

/* ==================================================================== */
/* 2. Offline gate render path -- proof the guard is actually wired in   */
/* ==================================================================== */

// A DSP body that returns a huge but FINITE value on every sample -- this
// does NOT trip the pre-existing !Number.isFinite(y) failure check (that
// only ever caught NaN/Infinity), so before this change it flowed straight
// into RMS/true-peak measurement completely unclamped. 1000x gain on an
// ~0.18-amplitude arp signal is ~180 in amplitude, ~45 dBTP unclamped --
// decisively past the +/-4.0 (~12 dBTP) safety ceiling.
const hugeButFinite = "return inputSample * 1000;";
const unclampedEstimateDb = 20 * Math.log10(1000 * 0.18);
const clampedTruePeakDb = measureTruePeak(hugeButFinite, []);
check(
  // Margin (not +1) accounts for legitimate inter-sample reconstruction
  // overshoot: true peak is measured via 4x oversampled Catmull-Rom
  // interpolation, which can read a few tenths of a dB above a signal
  // that is hard-clamped at exactly +/-4.0 in the sample domain -- that is
  // expected true-peak behavior, not a hole in the clamp. What matters is
  // the DECISIVE gap versus the ~45 dB the raw 1000x-gain signal would
  // measure with no clamp at all.
  "offline gate: an insanely hot but finite DSP body is clamped to the +/-4.0 ceiling, not left to blow past it",
  Number.isFinite(clampedTruePeakDb) && clampedTruePeakDb < 20 * Math.log10(4) + 3,
  `measured=${clampedTruePeakDb.toFixed(2)} dBTP; unclamped would be ~${unclampedEstimateDb.toFixed(1)} dBTP -- decisive gap of ~${(unclampedEstimateDb - clampedTruePeakDb).toFixed(1)} dB`
);

// A DSP body whose default settings are perfectly stable (proving the
// safety net does not mask genuine instability detection): NaN/Infinity is
// still treated as a FAILED render (not silently zeroed-and-continued), so
// calibrateUnstableParams and the unstableParams audit keep working exactly
// as before this change.
const divByZeroAtExtreme = `
let d = params.drive !== undefined ? params.drive : 0.3;
let denom = 1 - d;
if (denom < 0.01) denom = 0.01;
return inputSample / denom;
`;
const driveParam = [P("drive", 0, 1, 0.3)];
const mDivByZero = measureMusicality(divByZeroAtExtreme, driveParam);
check(
  // At drive=1 this body would literally divide by zero without the guard;
  // the guard keeps it fully stable AND still clearly audible (unity gain
  // at min vs ~100x at max) -- proving a well-written defensive guard
  // against divide-by-zero is recognized as genuinely stable, not
  // incorrectly still flagged unstable now that sanitizeSample exists.
  "offline gate: a properly-guarded divide-by-zero stays fully stable and audible, not masked or misreported",
  mDivByZero.ok && mDivByZero.unstableParams.length === 0 && mDivByZero.audibleParams.includes("drive"),
  `ok=${mDivByZero.ok} unstable=[${mDivByZero.unstableParams}] audible=[${mDivByZero.audibleParams}] evidence="${mDivByZero.evidence}"`
);
// A genuinely unguarded divide-by-zero at an extreme IS still caught as
// unstable (this is the pre-existing, UNCHANGED behavior this change must
// not regress -- see hardeningTest.ts's "extremes: unstable knob detected"
// for the canonical version of this proof).
const trueDivByZero = `
let fb = params.feedback !== undefined ? params.feedback : 0.4;
state.y = inputSample + (state.y || 0) * (0.6 + fb * 0.5);
return state.y;
`;
const mTrueDivByZero = measureMusicality(trueDivByZero, [P("feedback", 0, 1.0, 0.4)]);
check(
  "offline gate: an unstable feedback coefficient is still flagged unstable, not silently sanitized away",
  mTrueDivByZero.unstableParams.includes("feedback") && !mTrueDivByZero.ok,
  `unstable=[${mTrueDivByZero.unstableParams}]`
);

/* ==================================================================== */
/* 3. The safety net NEVER fires on any golden recipe or topology        */
/*    variant at default settings -- prove it, don't assume it.         */
/* ==================================================================== */
{
  let worstDb = -Infinity;
  let worstId = "";
  for (const r of DSP_RECIPES) {
    const params = r.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
    const db = measureTruePeak(r.body, params);
    if (Number.isFinite(db) && db > worstDb) { worstDb = db; worstId = r.id; }
    check(`safety net never engages: golden recipe "${r.id}" stays comfortably under the +/-4.0 ceiling`, !Number.isFinite(db) || db < 20 * Math.log10(4) - 3, `truePeakDb=${db.toFixed(2)}`);
  }
  check("no golden recipe comes anywhere close to tripping the safety ceiling", worstDb < 20 * Math.log10(4) - 3, `worst=${worstId} (${worstDb.toFixed(2)} dBTP, ceiling is ${(20 * Math.log10(4)).toFixed(2)} dBTP)`);
}
{
  let worstDb = -Infinity;
  let worstId = "";
  for (const t of DSP_TOPOLOGIES) {
    const params = t.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
    const db = measureTruePeak(t.body, params);
    if (Number.isFinite(db) && db > worstDb) { worstDb = db; worstId = t.id; }
  }
  check("no topology variant comes anywhere close to tripping the safety ceiling", worstDb < 20 * Math.log10(4) - 3, `worst=${worstId} (${worstDb.toFixed(2)} dBTP)`);
}

/* ==================================================================== */
/* 4. Live-playback DC-blocker recursion: the actual bug the safety net  */
/*    closes -- a single out-of-band sample poisons the STATE of a       */
/*    recursive filter, not just that one output sample.                */
/* ==================================================================== */
{
  // Mirrors the DC-blocker recursion shipped in App.tsx's live-preview path
  // (the AudioWorklet's process() around src/App.tsx:1204-1213 and the
  // ScriptProcessor fallback around src/App.tsx:1348-1355): y = x - x1 +
  // 0.995*y1, followed by the SAME final Math.max(-1, Math.min(1, ...))
  // output clip both call sites already applied before this change.
  function runDcBlockerChain(rawSamples: number[], sanitize: (x: number) => number): number[] {
    let x1 = 0;
    let y1 = 0;
    const out: number[] = [];
    for (const raw of rawSamples) {
      const res = sanitize(raw) * 1.0; // outputTrim = 1.0
      const blocked = res - x1 + 0.995 * y1;
      x1 = res;
      y1 = blocked;
      out.push(Math.max(-1.0, Math.min(1.0, blocked)));
    }
    return out;
  }

  // One Infinity sample (e.g. a divide-by-zero that briefly resolves to
  // Infinity), then five perfectly ordinary samples.
  const rawSamples = [0.2, 0.3, Infinity, 0.25, 0.2, 0.3, 0.1];

  // "Legacy" behavior: no sanitizeSample guard at all -- the raw DSP return
  // reaches outputTrim math and the DC-blocker state directly (this is
  // EXACTLY what src/App.tsx did before this change, modulo the `|| 0` that
  // only ever caught literal NaN, never Infinity).
  const legacyOut = runDcBlockerChain(rawSamples, (x) => x);
  const guardedOut = runDcBlockerChain(rawSamples, sanitizeSample);

  const legacyGoesNaNForever = legacyOut.slice(3).every((v) => Number.isNaN(v));
  check(
    "live-path bug reproduced: WITHOUT the guard, one Infinity sample poisons the DC-blocker state and NaN reaches every subsequent output sample",
    legacyGoesNaNForever,
    `legacy output = [${legacyOut.map((v) => (Number.isNaN(v) ? "NaN" : v.toFixed(3))).join(", ")}]`
  );
  const guardedAllFiniteAndBounded = guardedOut.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.0001);
  check(
    "safety net fixes it: WITH sanitizeSample applied before the DC-blocker, every sample -- including the ones after the bad one -- stays finite and bounded",
    guardedAllFiniteAndBounded,
    `guarded output = [${guardedOut.map((v) => v.toFixed(3)).join(", ")}]`
  );
}

/* ==================================================================== */
/* 5. quickHealthCheck -- fail-fast pre-check correctness                 */
/* ==================================================================== */

check("quickHealthCheck: a compile error is caught", quickHealthCheck("this is not valid javascript {{{", [])?.fatal === true);
check("quickHealthCheck: a throw/NaN at defaults is caught", quickHealthCheck("return 1 / 0 * Infinity - Infinity;", [])?.fatal === true);
check("quickHealthCheck: silence at defaults is caught", quickHealthCheck("return 0;", [])?.fatal === true);
check("quickHealthCheck: near-silence (far below the 2% ratio) at defaults is caught", quickHealthCheck("return inputSample * 0.0001;", [])?.fatal === true);
check("quickHealthCheck: a healthy passthrough is NOT flagged", quickHealthCheck("return inputSample;", []) === null);
check("quickHealthCheck: a healthy, audible processor is NOT flagged", quickHealthCheck("return Math.tanh(inputSample * 1.5);", []) === null);

// The pre-check must never misfire on a legitimate build -- prove it across
// every golden recipe and every topology variant, exactly like the safety
// ceiling proof above.
{
  let misfires: string[] = [];
  for (const r of DSP_RECIPES) {
    const params = r.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
    if (quickHealthCheck(r.body, params) !== null) misfires.push(r.id);
  }
  check("quickHealthCheck never fires on any of the 10 golden recipes", misfires.length === 0, misfires.join(", "));
}
{
  let misfires: string[] = [];
  for (const t of DSP_TOPOLOGIES) {
    const params = t.parameters.map((p) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
    if (quickHealthCheck(t.body, params) !== null) misfires.push(t.id);
  }
  check("quickHealthCheck never fires on any topology variant", misfires.length === 0, misfires.join(", "));
}

/* ==================================================================== */
/* 6. quickHealthCheck -- measured, decisive time saving                 */
/* ==================================================================== */
{
  // A broken (silent) candidate with a healthy number of real, non-
  // decorative parameters -- the per-parameter audibility sweep
  // measureMusicality runs (every param x every one of the 4 bank signals x
  // 2 renders) is what the fail-fast pre-check exists to avoid paying for
  // on a candidate that is already provably useless.
  const manyParams: PluginParameter[] = Array.from({ length: 18 }, (_, i) => P(`p${i}`, 0, 1, 0.5));
  const brokenSilentDsp = "return 0;"; // compiles, doesn't throw/NaN, but produces nothing
  const brokenPlugin = pluginOf(brokenSilentDsp, manyParams);

  // BEFORE this change, runQualityGate called measureMusicality directly
  // with no pre-check -- so measureMusicality's own wall time on this
  // candidate IS what runQualityGate used to pay for, as just the FIRST of
  // 9 expensive measurement steps it used to run unconditionally. Time it
  // directly (bypassing quickHealthCheck) to measure that old cost.
  const t0 = performance.now();
  const fullSweep = measureMusicality(brokenSilentDsp, manyParams);
  const fullSweepMs = performance.now() - t0;

  // AFTER this change: runQualityGate's own wall time on the SAME
  // candidate, now short-circuited by quickHealthCheck before
  // measureMusicality (and all 8 measurements after it) ever run.
  const t1 = performance.now();
  const gated = runQualityGate(brokenPlugin);
  const gatedMs = performance.now() - t1;

  check("fail-fast: the broken candidate is still recognized as broken (musicality floor)", gated.scores.musicality === 0, `musicality=${gated.scores.musicality}`);
  check("fail-fast: the full per-parameter sweep does still find it silent (proves the sweep isn't just being skipped incorrectly)", fullSweep.isSilent, `isSilent=${fullSweep.isSilent}`);

  const speedup = fullSweepMs > 0 ? fullSweepMs / Math.max(0.001, gatedMs) : 0;
  console.log(`  timing: full per-parameter sweep alone (old first step) = ${fullSweepMs.toFixed(2)}ms; whole gated runQualityGate (new) = ${gatedMs.toFixed(2)}ms (~${speedup.toFixed(1)}x)`);
  check(
    "fail-fast: measured, decisive time saving -- the ENTIRE gated pass (pre-check + skip) is faster than JUST the old first expensive step alone",
    gatedMs < fullSweepMs,
    `gated=${gatedMs.toFixed(2)}ms vs old-first-step-alone=${fullSweepMs.toFixed(2)}ms`
  );
}

console.log(failures === 0 ? "\nALL SAFETY NET TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
