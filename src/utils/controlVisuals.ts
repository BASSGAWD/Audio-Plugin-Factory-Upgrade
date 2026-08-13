/**
 * Shared visual math for the "smart" control types (eq curve, waveform
 * display) so the Pro UI Designer and the default Simple Mode player render
 * IDENTICAL, functionally-real visuals instead of each having their own
 * (or no) implementation.
 *
 * The EQ curve in particular used to be pure decoration -- three fixed
 * points driven by the widget's own value, unrelated to the plugin's actual
 * filter knobs. This computes a real frequency-response shape from whichever
 * cutoff/resonance parameters exist elsewhere on the plugin, so the curve
 * genuinely reflects what the DSP is doing.
 */

import { PluginParameter } from "../types";

const DECORATIVE_CONTROL_TYPES = ["eq", "amp", "cab", "mic", "mic_stand", "pad", "meter", "waveform"];

/** Find the real cutoff/frequency parameter this EQ widget should track. */
export function findCutoffParam(parameters: PluginParameter[], selfId: string): PluginParameter | undefined {
  return parameters.find(
    (p) =>
      p.id !== selfId &&
      /cutoff|freq(?!.*(rate|lfo|speed))/i.test(p.id + p.name) &&
      !DECORATIVE_CONTROL_TYPES.includes(p.controlType || "")
  );
}

/** Find the real resonance/Q parameter this EQ widget should track. */
export function findResonanceParam(parameters: PluginParameter[], selfId: string): PluginParameter | undefined {
  return parameters.find(
    (p) =>
      p.id !== selfId &&
      /reson|^q$|\bq\b/i.test(p.id + " " + p.name) &&
      !DECORATIVE_CONTROL_TYPES.includes(p.controlType || "")
  );
}

export interface FilterCurve {
  /** SVG path `d` attribute for the response line, in local widget pixel space. */
  pathD: string;
  /** X position of the cutoff marker. */
  cutoffX: number;
  /** Y position of the cutoff marker (accounts for the resonance peak). */
  cutoffY: number;
  /** The cutoff frequency actually driving the curve. */
  cutoffHz: number;
  /** The parameter id to drag the cutoff marker against, if one was found. */
  cutoffParamId?: string;
  cutoffParamMin?: number;
  cutoffParamMax?: number;
  /** True when no real cutoff/resonance param exists and the shape is a generic placeholder. */
  isPlaceholder: boolean;
}

/**
 * Compute a real lowpass/highpass-shaped frequency-response curve across a
 * 20 Hz - 20 kHz log axis, using the plugin's actual cutoff/resonance
 * parameters when present. Falls back to a gentle generic curve so the
 * widget never renders empty when no filter parameter exists.
 */
export function computeFilterCurve(
  parameters: PluginParameter[],
  selfParam: PluginParameter,
  width: number,
  height: number
): FilterCurve {
  const cutoffParam = findCutoffParam(parameters, selfParam.id);
  const resonanceParam = findResonanceParam(parameters, selfParam.id);
  const isHighpass = /high.?pass|hp\b/i.test(cutoffParam?.name || "");

  const cutoffHz = cutoffParam ? cutoffParam.value : 1000;
  const cutoffNorm = Math.log(Math.max(20, Math.min(20000, cutoffHz)) / 20) / Math.log(1000);
  const resNorm = resonanceParam
    ? (resonanceParam.value - resonanceParam.min) / Math.max(1e-6, resonanceParam.max - resonanceParam.min)
    : 0.25;
  const peakDb = resNorm * 16;
  const peakWidth = 0.18 - resNorm * 0.11;

  const STEPS = 48;
  const points: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const xNorm = i / STEPS;
    const octavesFromCutoff = (xNorm - cutoffNorm) * (Math.log(1000) / Math.LN2);
    let db = isHighpass ? Math.min(0, octavesFromCutoff * 9) : Math.min(0, -octavesFromCutoff * 9);
    const bump = peakDb * Math.exp(-((xNorm - cutoffNorm) ** 2) / (2 * peakWidth * peakWidth));
    db += bump;
    db = Math.max(-24, Math.min(18, db));
    const py = height / 2 - (db / 40) * height;
    points.push([xNorm * width, py]);
  }
  const pathD = points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

  return {
    pathD,
    cutoffX: cutoffNorm * width,
    cutoffY: height / 2 - (Math.min(18, peakDb) / 40) * height,
    cutoffHz,
    cutoffParamId: cutoffParam?.id,
    cutoffParamMin: cutoffParam?.min,
    cutoffParamMax: cutoffParam?.max,
    isPlaceholder: !cutoffParam,
  };
}

/** Convert a widget's X pixel position into the Hz value along the shared 20Hz-20kHz log axis. */
export function xPixelToHz(xPixel: number, width: number): number {
  const ratio = Math.max(0, Math.min(1, xPixel / width));
  return 20 * Math.pow(1000, ratio);
}

/**
 * Multi-band EQ curve. computeFilterCurve above renders one cutoff/resonance
 * knob as a single lowpass/highpass shape -- it has no way to represent a
 * 3+ band parametric EQ with independent gain per band. This is the real
 * (DSP-linked, not decorative) upgrade: every gain-bearing band on the
 * plugin becomes its own node on one composite curve, each independently
 * draggable on BOTH axes (frequency AND gain, vs. computeFilterCurve's
 * frequency-only marker).
 */

const EQ_DB_RANGE = 18; // +/- full scale on the curve's Y axis

export interface EqBand {
  /** The gain parameter driving this band (dB, may go negative). */
  gainParamId: string;
  gainParamMin: number;
  gainParamMax: number;
  gainValue: number;
  /** Center frequency: a fixed heuristic corner for shelf bands, or the
   *  live value of a paired sweepable frequency param for peak bands. */
  hz: number;
  /** The frequency parameter to drag horizontally, when this band is
   *  sweepable (e.g. "mid" paired with "midFreq"). Fixed shelf bands have
   *  none -- their node only drags vertically. */
  freqParamId?: string;
  freqParamMin?: number;
  freqParamMax?: number;
  /** "shelf" for the outer low/high bands (wide, gentle bump), "peak" for
   *  an inner/movable band (narrower, more surgical bump). */
  shape: "shelf" | "peak";
}

/**
 * Discover every gain-bearing EQ band on the plugin. Recognizes the shipped
 * 3-band recipe's "low"/"mid"/"high" (+ sweepable "midFreq") by name
 * directly; falls back to a generic "*Gain"/"*_gain" convention (paired
 * with an optional same-prefixed "*Freq" sibling) so a future recipe with
 * different band names or a different band count still gets picked up
 * without code changes here.
 */
export function findEqBands(parameters: PluginParameter[], selfId: string): EqBand[] {
  const eligible = parameters.filter((p) => p.id !== selfId && !DECORATIVE_CONTROL_TYPES.includes(p.controlType || ""));
  const byExactId = (id: string) => eligible.find((p) => p.id.toLowerCase() === id);

  const low = byExactId("low");
  const mid = byExactId("mid");
  const high = byExactId("high");
  const midFreq = byExactId("midfreq");

  const bands: EqBand[] = [];
  if (low) bands.push({ gainParamId: low.id, gainParamMin: low.min, gainParamMax: low.max, gainValue: low.value, hz: 120, shape: "shelf" });
  if (mid) {
    bands.push({
      gainParamId: mid.id,
      gainParamMin: mid.min,
      gainParamMax: mid.max,
      gainValue: mid.value,
      hz: midFreq ? midFreq.value : 1000,
      freqParamId: midFreq?.id,
      freqParamMin: midFreq?.min,
      freqParamMax: midFreq?.max,
      shape: "peak",
    });
  }
  if (high) bands.push({ gainParamId: high.id, gainParamMin: high.min, gainParamMax: high.max, gainValue: high.value, hz: 6000, shape: "shelf" });

  if (bands.length > 0) return bands;

  // Generic fallback: any "<prefix>Gain" / "<prefix>_gain" param (but not a
  // bare "gain" trim, which belongs to a different control entirely),
  // paired with an optional "<prefix>Freq" / "<prefix>_freq" sibling.
  for (const p of eligible) {
    const m = p.id.match(/^(.+?)_?[Gg]ain$/);
    if (!m || m[1] === "") continue;
    const prefix = m[1];
    const freqSibling = eligible.find((f) => new RegExp(`^${prefix}_?freq$`, "i").test(f.id));
    bands.push({
      gainParamId: p.id,
      gainParamMin: p.min,
      gainParamMax: p.max,
      gainValue: p.value,
      hz: freqSibling ? freqSibling.value : 1000,
      freqParamId: freqSibling?.id,
      freqParamMin: freqSibling?.min,
      freqParamMax: freqSibling?.max,
      shape: "peak",
    });
  }
  return bands;
}

export interface EqCurveNode {
  x: number;
  y: number;
  hz: number;
  gainDb: number;
  gainParamId: string;
  gainParamMin: number;
  gainParamMax: number;
  freqParamId?: string;
  freqParamMin?: number;
  freqParamMax?: number;
}

export interface EqCurve {
  pathD: string;
  nodes: EqCurveNode[];
  /** True when fewer than 2 bands were found -- caller should render
   *  computeFilterCurve's single-marker shape instead. */
  isFallback: boolean;
}

function hzToXNorm(hz: number): number {
  return Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000);
}

function dbToPy(db: number, height: number): number {
  const clamped = Math.max(-EQ_DB_RANGE, Math.min(EQ_DB_RANGE, db));
  return height / 2 - (clamped / (EQ_DB_RANGE * 2)) * height;
}

/**
 * Compute a composite frequency-response curve across the shared 20 Hz -
 * 20 kHz log axis by summing every band's own bump (same Gaussian-peak
 * math computeFilterCurve uses for its resonance bump, one instance per
 * band here), plus one draggable node per band.
 */
export function computeEqCurve(parameters: PluginParameter[], selfParam: PluginParameter, width: number, height: number): EqCurve {
  const bands = findEqBands(parameters, selfParam.id);
  if (bands.length < 2) return { pathD: "", nodes: [], isFallback: true };

  const STEPS = 64;
  const points: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const xNorm = i / STEPS;
    let db = 0;
    for (const b of bands) {
      const bandXNorm = hzToXNorm(b.hz);
      const bandWidth = b.shape === "shelf" ? 0.35 : 0.16;
      db += b.gainValue * Math.exp(-((xNorm - bandXNorm) ** 2) / (2 * bandWidth * bandWidth));
    }
    points.push([xNorm * width, dbToPy(db, height)]);
  }
  const pathD = points.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

  const nodes: EqCurveNode[] = bands.map((b) => ({
    x: hzToXNorm(b.hz) * width,
    y: dbToPy(b.gainValue, height),
    hz: b.hz,
    gainDb: b.gainValue,
    gainParamId: b.gainParamId,
    gainParamMin: b.gainParamMin,
    gainParamMax: b.gainParamMax,
    freqParamId: b.freqParamId,
    freqParamMin: b.freqParamMin,
    freqParamMax: b.freqParamMax,
  }));

  return { pathD, nodes, isFallback: false };
}

/** Convert a widget's Y pixel position into a dB value on the shared
 *  +/-18 dB curve axis -- the vertical counterpart to xPixelToHz. */
export function yPixelToDb(yPixel: number, height: number): number {
  const norm = Math.max(0, Math.min(1, yPixel / height));
  return (0.5 - norm) * (EQ_DB_RANGE * 2);
}

export type WaveShape = "sine" | "triangle" | "sawtooth" | "square";

export function waveShapeFromValue(value: number): WaveShape {
  const rounded = Math.round(value);
  if (rounded === 2) return "triangle";
  if (rounded === 3) return "sawtooth";
  if (rounded === 4) return "square";
  return "sine";
}

/** SVG path `d` attribute for a two-cycle waveform preview. */
export function computeWaveformPath(value: number, width: number, height: number): string {
  const shape = waveShapeFromValue(value);
  const steps = 60;
  let points = "";
  for (let i = 0; i <= steps; i++) {
    const rx = (i / steps) * width;
    let ry = height / 2;
    const rad = (i / steps) * Math.PI * 4;

    if (shape === "sine") {
      ry = height / 2 + Math.sin(rad) * (height / 4);
    } else if (shape === "triangle") {
      ry = height / 2 + (Math.abs((i % 30) - 15) - 7.5) * (height / 15);
    } else if (shape === "sawtooth") {
      ry = height / 2 + ((i % 30) / 30 - 0.5) * (height / 2);
    } else {
      ry = height / 2 + (Math.sin(rad) >= 0 ? 1 : -1) * (height / 5);
    }
    points += `${i === 0 ? "M" : "L"} ${rx.toFixed(1)},${ry.toFixed(1)} `;
  }
  return points;
}

export function waveShapeLabel(value: number): string {
  const shape = waveShapeFromValue(value);
  return shape === "sine" ? "SINE" : shape === "triangle" ? "TRI" : shape === "sawtooth" ? "SAW" : "SQUARE";
}
