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
