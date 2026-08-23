/**
 * Verifies the round-2 code-gen consolidation (2.4): one shared
 * oversampledWaveshape() helper (dspPrimitives.ts) replacing 7 drifting
 * copies of the "2x oversampled nonlinearity" idiom, two of which
 * (dist_dynamic_sat, the `drive` primitive) had regressed to a plain 2-tap
 * box average despite dist_fuzz's own comment documenting why that was
 * abandoned for a triangular [0.25, 0.5, 0.25] halfband decimator.
 *
 * Decisive-gap standard (CLAUDE.md): measure honest vs. broken, assert a
 * real gap -- not just "the code runs".
 *
 *  1. oversampledWaveshape()'s generated code matches a hand-written TS
 *     reference of the triangular halfband math EXACTLY (bit-for-bit,
 *     since both are the identical arithmetic), for several shaper curves
 *     (plain tanh, biased/asymmetric tanh, softsign) -- proves the helper
 *     itself is correct, not just "produces a string".
 *  2. The SAME helper output DIFFERS decisively from a hand-written
 *     reference of the old regressed 2-tap box average, on a signal with
 *     real high-frequency content (a fast sine sweep) where the two
 *     decimators' unequal alias rejection actually shows up numerically --
 *     proving the fix is not a no-op.
 *  3. Static source checks: none of the 7 former call sites still contain
 *     the regressed box-average pattern; all 7 now route through the
 *     shared helper; both previously-regressed sites now declare
 *     state.prevShaped in their init guard (they didn't before).
 */
import { oversampledWaveshape } from "../src/utils/dspPrimitives";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { DSP_PRIMITIVES } from "../src/utils/dspPrimitives";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- synthetic test signal: a fast sine sweep, the kind of high-frequency
   content where a shallow 2-tap box average and a real triangular halfband
   decimator actually diverge (a slow sine or DC would not expose the gap) ---- */
const N = 2000;
const sweep: number[] = [];
for (let i = 0; i < N; i++) {
  const freq = 200 + (i / N) * 15000; // 200 Hz -> 15.2 kHz sweep
  sweep.push(0.8 * Math.sin((2 * Math.PI * freq * i) / 44100));
}

/* TS reference of the shared triangular formula (ground truth for #1) */
function referenceTriangular(samples: number[], shape: (x: number) => number, gainComp: number): number[] {
  let prevIn = 0, prevShaped = 0;
  const out: number[] = [];
  for (const s of samples) {
    const midRaw = 0.5 * (prevIn + s);
    const shapedMid = shape(midRaw);
    const shapedCur = shape(s);
    const wet = (0.25 * prevShaped + 0.5 * shapedMid + 0.25 * shapedCur) / gainComp;
    prevShaped = shapedCur;
    prevIn = s;
    out.push(wet);
  }
  return out;
}

/* TS reference of the OLD regressed 2-tap box average (ground truth for #2) */
function referenceBoxAverage(samples: number[], shape: (x: number) => number, gainComp: number): number[] {
  let prevIn = 0;
  const out: number[] = [];
  for (const s of samples) {
    const midIn = 0.5 * (prevIn + s);
    const wet = 0.5 * (shape(midIn) + shape(s)) / gainComp;
    prevIn = s;
    out.push(wet);
  }
  return out;
}

/* Compiles the exact string oversampledWaveshape() emits into a runnable
   per-sample function, with a trivial harness matching the helper's own
   state contract (prevIn/prevShaped, declared output var). */
function compileHelperOutput(shapeExpr: (x: string) => string, gainCompensation: string): (samples: number[]) => number[] {
  const body = `${oversampledWaveshape({ shape: shapeExpr, gainCompensation })}
return wet;`;
  const fn = new Function("inputSample", "state", body) as (i: number, s: any) => number;
  return (samples: number[]) => {
    const state: any = { prevIn: 0, prevShaped: 0 };
    return samples.map((s) => fn(s, state));
  };
}

/* ---- 1 & 2: three representative shaper curves ---- */
const curves: Array<{ name: string; tsShape: (x: number) => number; codeShape: (x: string) => string; gainComp: number; gainCompCode: string }> = [
  { name: "plain tanh", tsShape: (x) => Math.tanh(x * 6), codeShape: (x) => `Math.tanh(${x} * 6)`, gainComp: Math.pow(6, 0.65), gainCompCode: "Math.pow(6, 0.65)" },
  {
    name: "biased/asymmetric tanh",
    tsShape: (x) => Math.tanh(x * 6 + 0.22) - Math.tanh(0.22),
    codeShape: (x) => `Math.tanh(${x} * 6 + 0.22) - Math.tanh(0.22)`,
    gainComp: Math.pow(6, 0.65),
    gainCompCode: "Math.pow(6, 0.65)",
  },
  {
    name: "softsign fold-back",
    tsShape: (x) => (x * 6) / (1 + Math.abs(x * 6)),
    codeShape: (x) => `(${x} * 6) / (1 + Math.abs(${x} * 6))`,
    gainComp: Math.pow(6, 0.7),
    gainCompCode: "Math.pow(6, 0.7)",
  },
];

for (const c of curves) {
  const helperOut = compileHelperOutput(c.codeShape, c.gainCompCode)(sweep);
  const refTriangular = referenceTriangular(sweep, c.tsShape, c.gainComp);
  const refBoxAvg = referenceBoxAverage(sweep, c.tsShape, c.gainComp);

  const maxDiffVsTriangular = Math.max(...helperOut.map((v, i) => Math.abs(v - refTriangular[i])));
  check(
    `oversampledWaveshape (${c.name}): matches the hand-written triangular reference exactly`,
    maxDiffVsTriangular < 1e-12,
    `maxDiff=${maxDiffVsTriangular}`
  );

  const maxDiffVsBoxAvg = Math.max(...helperOut.map((v, i) => Math.abs(v - refBoxAvg[i])));
  const rmsHelper = Math.sqrt(helperOut.reduce((a, v) => a + v * v, 0) / helperOut.length);
  check(
    `oversampledWaveshape (${c.name}): decisive gap vs. the old regressed box average on a fast sweep`,
    maxDiffVsBoxAvg > rmsHelper * 0.02,
    `maxDiff=${maxDiffVsBoxAvg} rms=${rmsHelper}`
  );
}

/* ---- declareOutput: false / custom outputVar (the filter recipe's
   conditional-branch usage) produces a plain assignment, not a `let` ---- */
{
  const snippet = oversampledWaveshape({ shape: (x) => `Math.tanh(${x} * dg)`, gainCompensation: "Math.pow(dg, 0.6)", outputVar: "xin", declareOutput: false });
  check("declareOutput:false emits a plain assignment, not `let xin =`", /(^|\n)xin = /.test(snippet) && !/let xin/.test(snippet), snippet);
}

/* ---- 3. Static source checks across all 7 former call sites ---- */
const boxAveragePattern = /0\.5\s*\*\s*\(\s*Math\.tanh\([^)]*\)\s*\+\s*Math\.tanh\([^)]*\)\s*\)/;

const recipeSites = ["filter", "distortion"].map((id) => {
  const r = DSP_RECIPES.find((x) => x.id === id)!;
  return { id: `recipe:${id}`, body: r.body };
});
const topologySites = ["dist_tube_asym", "dist_fuzz", "dist_dynamic_sat"].map((id) => {
  const t = DSP_TOPOLOGIES.find((x) => x.id === id)!;
  return { id: `topology:${id}`, body: t.body };
});
// the glue-compressor "compressor" topology's Warmth saturator (also
// oversampled) -- find it by its distinguishing state field.
const glueCompressor = DSP_TOPOLOGIES.find((t) => /state\.prevOut = 0/.test(t.body));
if (glueCompressor) topologySites.push({ id: `topology:${glueCompressor.id}(glue-warmth)`, body: glueCompressor.body });
const primitiveSites = ["drive"].map((id) => {
  const p = DSP_PRIMITIVES.find((x) => x.id === id)!;
  return { id: `primitive:${id}`, body: p.body };
});

const allSites = [...recipeSites, ...topologySites, ...primitiveSites];
check(
  "found all 7 former oversampling call sites (2 recipes, 4 topologies incl. glue-warmth, 1 primitive)",
  allSites.length === 7 && !!glueCompressor,
  `found=${allSites.length} sites=${allSites.map((s) => s.id).join(",")}`
);

for (const site of allSites) {
  check(`${site.id}: no regressed 2-tap box average left`, !boxAveragePattern.test(site.body));
  check(`${site.id}: routes through the shared triangular decimator (state.prevShaped tracked)`, /state\.prevShaped/.test(site.body));
}

/* ---- the two specifically-regressed sites now track prevShaped in their
   init guard, which they didn't before this fix ---- */
const dynSat = DSP_TOPOLOGIES.find((t) => t.id === "dist_dynamic_sat")!;
check("dist_dynamic_sat init guard now zeroes state.prevShaped", /if \(!state\.init\).*state\.prevShaped = 0/.test(dynSat.body.split("\n")[0]), dynSat.body.split("\n")[0]);
const drivePrimitive = DSP_PRIMITIVES.find((p) => p.id === "drive")!;
check("drive primitive init guard now zeroes state.prevShaped", /if \(!state\.init\).*state\.prevShaped = 0/.test(drivePrimitive.body.split("\n")[0]), drivePrimitive.body.split("\n")[0]);
check("drive primitive no longer uses the old state.pv field name", !/state\.pv\b/.test(drivePrimitive.body));

console.log(failures === 0 ? "\nOVERSAMPLED WAVESHAPE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
