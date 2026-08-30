/**
 * Multi-band EQ curve -- the upgrade from a single frequency-only marker
 * (computeFilterCurve) to a real multi-node curve with one draggable point
 * per band, on BOTH axes (frequency and gain). These checks prove: band
 * discovery finds the real low/mid/high (+ midFreq) parameters by name, the
 * composite curve responds correctly to each band's gain, node positions
 * track their parameter values, the drag math (xPixelToHz / yPixelToDb)
 * round-trips, and a single-band plugin correctly falls back to the
 * original (unchanged) single-marker shape instead of the multi-node one.
 */
import { computeEqCurve, computeFilterCurve, findEqBands, xPixelToHz, yPixelToDb } from "../src/utils/controlVisuals";
import { PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, min: number, max: number, value: number, controlType?: PluginParameter["controlType"]): PluginParameter =>
  ({ id, name: id, min, max, defaultValue: value, value, unit: "dB", controlType } as PluginParameter);

const eqMarker = P("eq_curve_auto", 0, 1, 0, "eq");

/* ---- 1. Band discovery: the shipped 3-band recipe's naming ---- */
{
  const params = [P("low", -12, 12, 3), P("mid", -12, 12, 4), P("midFreq", 250, 5000, 1200, "knob" as any), P("high", -12, 12, 3), eqMarker];
  const bands = findEqBands(params, "eq_curve_auto");
  check("finds all 3 bands", bands.length === 3, `found ${bands.length}`);
  const low = bands.find((b) => b.gainParamId === "low")!;
  const mid = bands.find((b) => b.gainParamId === "mid")!;
  const high = bands.find((b) => b.gainParamId === "high")!;
  check("low band is a shelf, fixed corner", !!low && low.shape === "shelf" && low.hz === 120);
  check("high band is a shelf, fixed corner", !!high && high.shape === "shelf" && high.hz === 6000);
  check("mid band is a peak, tracks midFreq", !!mid && mid.shape === "peak" && mid.hz === 1200, `hz=${mid?.hz}`);
  check("mid band is paired with the midFreq param for horizontal drag", mid.freqParamId === "midFreq");
  check("low/high shelves have no freq param (vertical-only drag)", low.freqParamId === undefined && high.freqParamId === undefined);
}

/* ---- 2. Generic fallback naming (a future recipe with different names) ---- */
{
  const params = [P("lowShelfGain", -12, 12, 5), P("presenceGain", -12, 12, -3), P("presenceFreq", 500, 8000, 3000, "knob" as any), eqMarker];
  const bands = findEqBands(params, "eq_curve_auto");
  check("generic *Gain naming discovered", bands.length === 2, `found ${bands.length}`);
  const presence = bands.find((b) => b.gainParamId === "presenceGain");
  check("generic band pairs with its *Freq sibling", presence?.freqParamId === "presenceFreq");
  check("a bare 'gain' trim is NOT mistaken for an eq band", !bands.some((b) => b.gainParamId === "gain"));
}

/* ---- 3. Fewer than 2 bands -> explicit fallback signal, single band alone
   isn't enough for a "multi-band" curve. ---- */
{
  const params = [P("low", -12, 12, 3), eqMarker];
  const bands = findEqBands(params, "eq_curve_auto");
  check("a single band does not count as multi-band", bands.length < 2, `found ${bands.length}`);
  const curve = computeEqCurve(params, eqMarker, 260, 90);
  check("computeEqCurve reports isFallback for <2 bands", curve.isFallback === true);
  check("computeEqCurve returns no nodes for <2 bands", curve.nodes.length === 0);
}

/* ---- 4. Node positions track real parameter values ---- */
{
  const params = [P("low", -12, 12, 6), P("mid", -12, 12, -6), P("midFreq", 250, 5000, 1000, "knob" as any), P("high", -12, 12, 0), eqMarker];
  const width = 560, height = 180;
  const curve = computeEqCurve(params, eqMarker, width, height);
  check("3 nodes for 3 bands", curve.nodes.length === 3, `${curve.nodes.length}`);
  const lowNode = curve.nodes.find((n) => n.gainParamId === "low")!;
  const midNode = curve.nodes.find((n) => n.gainParamId === "mid")!;
  const highNode = curve.nodes.find((n) => n.gainParamId === "high")!;
  check("boosted band's node sits above center (lower Y)", lowNode.y < height / 2, `y=${lowNode.y} center=${height / 2}`);
  check("cut band's node sits below center (higher Y)", midNode.y > height / 2, `y=${midNode.y} center=${height / 2}`);
  check("flat (0 dB) band's node sits at center", Math.abs(highNode.y - height / 2) < 1, `y=${highNode.y}`);
  check("mid node's X reflects its midFreq (not a fixed corner)", midNode.x > 0 && midNode.x < width, `x=${midNode.x}`);
  check("path has real geometry", curve.pathD.startsWith("M") && curve.pathD.includes("L"));
}

/* ---- 5. Drag math round-trips (mirrors xPixelToHz's existing contract) ---- */
{
  check("yPixelToDb: top of widget = +max dB", Math.abs(yPixelToDb(0, 180) - 18) < 0.01, `${yPixelToDb(0, 180)}`);
  check("yPixelToDb: bottom of widget = -max dB", Math.abs(yPixelToDb(180, 180) - -18) < 0.01, `${yPixelToDb(180, 180)}`);
  check("yPixelToDb: center = 0 dB", Math.abs(yPixelToDb(90, 180)) < 0.01, `${yPixelToDb(90, 180)}`);
  check("yPixelToDb: out-of-bounds Y clamps, doesn't extrapolate", yPixelToDb(-50, 180) === 18 && yPixelToDb(500, 180) === -18);

  // Round-trip: a node placed at gain G should, when dragged back to its
  // OWN y position, report back very close to G.
  const width = 560, height = 180;
  const params = [P("low", -12, 12, 7.3), P("mid", -12, 12, -4.1), P("midFreq", 250, 5000, 1000, "knob" as any), eqMarker];
  const curve = computeEqCurve(params, eqMarker, width, height);
  const low = curve.nodes.find((n) => n.gainParamId === "low")!;
  const roundTripped = yPixelToDb(low.y, height);
  check("node Y -> dB round-trips close to the source gain", Math.abs(roundTripped - 7.3) < 1.5, `roundTripped=${roundTripped.toFixed(2)} source=7.3`);
}

/* ---- 6. Single-cutoff filter still uses the ORIGINAL, unchanged fallback
   shape -- multi-band support must not disturb the existing filter family. ---- */
{
  const cutoffMarker = P("filter_curve_auto", 0, 1, 0, "eq");
  const params = [P("cutoff", 60, 12000, 1400, "knob" as any), P("resonance", 0, 0.9, 0.4, "knob" as any), cutoffMarker];
  const bands = findEqBands(params, "filter_curve_auto");
  check("a plain cutoff+resonance filter has no eq bands", bands.length === 0);
  const filterCurve = computeFilterCurve(params, cutoffMarker, 260, 90);
  check("computeFilterCurve still works exactly as before", !filterCurve.isPlaceholder && filterCurve.cutoffParamId === "cutoff", filterCurve.cutoffParamId);
}

console.log(failures === 0 ? "\nEQ CURVE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
