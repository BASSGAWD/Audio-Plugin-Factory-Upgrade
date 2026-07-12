/**
 * Post-generation quality gate.
 *
 * The verifier (pluginVerifier.ts) proves generated code won't crash or blow
 * up. This module proves it is actually GOOD, across the four dimensions the
 * factory grades itself on -- and deterministically fixes what can be fixed
 * without another model round-trip:
 *
 *  - musicality: measured on a real musical signal (the same chord arp the
 *    preview engine plays). Gain staging is corrected with an output trim the
 *    audio engine applies; silent output and dead ("decorative") parameters
 *    are detected and reported as repair evidence.
 *  - looks: every parameter is guaranteed a controlType, layout coordinates,
 *    and a category-matched color theme via polishPluginVisuals().
 *  - performance: static real-time-safety analysis of the DSP body.
 *  - latency: scored from measured generation wall-time.
 */

import { AudioPlugin, BuildReport, PluginParameter } from "../types";
import { sanitizeDspCode } from "./healthcheckRunner";
import { PluginFamily } from "./pluginSpec";
import { UiTheme, buildUiSpec, composeTheme, orderParametersBySpec } from "./uiSpec";

export interface QualityScores {
  looks: number;
  performance: number;
  latency: number;
  musicality: number;
}

export interface MusicalityMeasurement {
  ok: boolean;
  /** RMS of the musical test input. */
  inputRms: number;
  /** RMS of the processed output at default settings, before trim. */
  outputRms: number;
  /** Gain offset input->output in dB at defaults (0 = unity). */
  gainOffsetDb: number;
  /** Linear multiplier that restores unity loudness (1 = none needed). */
  suggestedTrim: number;
  /** True when output is effectively silence while input is not. */
  isSilent: boolean;
  /** Ratio of near-clipped samples in the output. */
  clippingRatio: number;
  /** Mean absolute DC offset of the output. */
  dcOffset: number;
  /** Parameter ids that produced no measurable change from min to max. */
  deadParams: string[];
  /** Parameter ids verified audible. */
  audibleParams: string[];
  /** Parameter ids whose min or max setting made the DSP throw or emit NaN. */
  unstableParams: string[];
  /** Human-readable failure evidence for the repair loop ("" when ok). */
  evidence: string;
  /**
   * True when measurement never ran at all (code doesn't compile, or throws /
   * NaNs on the default render). Distinguishes "nothing measurable" from
   * "measured clean" -- without it a syntax error scores a perfect 100
   * because every per-dimension deduction list is empty.
   */
  fatal?: boolean;
}

export interface QualityGateResult {
  plugin: AudioPlugin;
  scores: QualityScores;
  notes: string[];
  /** Structured, measured build evidence (also stored on plugin.buildReport). */
  report: BuildReport;
}

const SAMPLE_RATE = 44100;

/**
 * The identical musical program material the preview engine's "synth" source
 * plays, so measurements predict exactly what the user will hear on Play.
 */
function musicalInputAt(index: number): number {
  const t = index / SAMPLE_RATE;
  const bar = Math.floor(t * 3.5);
  const notes = [220, 261.63, 329.63, 392, 440, 523.25, 659.25, 783.99];
  const rootFreq = notes[bar % notes.length];
  const vibrato = 1.0 + Math.sin(2 * Math.PI * 5 * t) * 0.008;
  const baseOsc = Math.sin(2 * Math.PI * rootFreq * vibrato * t);
  const subOsc = Math.sin(2 * Math.PI * (rootFreq * 0.5) * t) * 0.45;
  const chorusOsc = Math.sin(2 * Math.PI * (rootFreq * 1.01) * t) * 0.25;
  return (baseOsc + subOsc + chorusOsc) * 0.18;
}

function compileDspBody(dspFunction: string): ((i: number, p: any, s: any) => number) | null {
  try {
    const sanitized = sanitizeDspCode(dspFunction);
    return new Function("inputSample", "params", "state", sanitized) as any;
  } catch {
    return null;
  }
}

function defaultParamsMap(parameters: PluginParameter[]): Record<string, number> {
  const map: Record<string, number> = {};
  parameters.forEach((p) => {
    map[p.id] = p.defaultValue !== undefined ? p.defaultValue : p.value;
  });
  return map;
}

interface RenderStats {
  rms: number;
  dcOffset: number;
  clippingRatio: number;
  failed: boolean;
  samples: Float32Array;
}

function renderPass(
  dspFunc: (i: number, p: any, s: any) => number,
  params: Record<string, number>,
  length: number
): RenderStats {
  const out = new Float32Array(length);
  const state: any = {};
  let sumSq = 0;
  let dcSum = 0;
  let clipCount = 0;

  for (let i = 0; i < length; i++) {
    let y = 0;
    try {
      y = dspFunc(musicalInputAt(i), params, state);
    } catch {
      return { rms: 0, dcOffset: 0, clippingRatio: 0, failed: true, samples: out };
    }
    if (!Number.isFinite(y)) {
      return { rms: 0, dcOffset: 0, clippingRatio: 0, failed: true, samples: out };
    }
    out[i] = y;
    sumSq += y * y;
    dcSum += y;
    if (y >= 0.999 || y <= -0.999) clipCount++;
  }

  return {
    rms: Math.sqrt(sumSq / length),
    dcOffset: Math.abs(dcSum / length),
    clippingRatio: clipCount / length,
    failed: false,
    samples: out,
  };
}

/** Parameters that are purely visual and shouldn't be audibility-tested. */
function isDecorativeParam(p: PluginParameter): boolean {
  const decorativeControls = ["meter", "label", "waveform", "eq", "amp", "cab", "mic", "mic_stand", "pad", "button"];
  if (p.controlType && decorativeControls.includes(p.controlType)) return true;
  if (p.min === p.max) return true;
  return /bypass|enable|power|on_off/i.test(p.id);
}

/**
 * Measure how the plugin behaves on real program material: loudness vs the
 * dry signal at defaults, silence, clipping, DC, and whether each parameter
 * audibly changes the sound between its min and max.
 */
export function measureMusicality(dspFunction: string, parameters: PluginParameter[]): MusicalityMeasurement {
  const failure = (evidence: string): MusicalityMeasurement => ({
    ok: false,
    inputRms: 0,
    outputRms: 0,
    gainOffsetDb: 0,
    suggestedTrim: 1,
    isSilent: false,
    clippingRatio: 0,
    dcOffset: 0,
    deadParams: [],
    audibleParams: [],
    unstableParams: [],
    evidence,
    fatal: true,
  });

  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return failure("dspFunction does not compile");

  const defaults = defaultParamsMap(parameters);

  // --- 1. Loudness / cleanliness at defaults on 1s of musical material ---
  const FULL = SAMPLE_RATE;
  let inSumSq = 0;
  for (let i = 0; i < FULL; i++) {
    const x = musicalInputAt(i);
    inSumSq += x * x;
  }
  const inputRms = Math.sqrt(inSumSq / FULL);

  const main = renderPass(dspFunc, defaults, FULL);
  if (main.failed) return failure("output produced NaN/Infinity or threw on musical program material at default settings");

  const outputRms = main.rms;
  const isSilent = outputRms < inputRms * 0.02; // more than ~34 dB below the dry signal
  const gainOffsetDb = isSilent ? -60 : 20 * Math.log10(outputRms / inputRms);
  const suggestedTrim = isSilent ? 1 : Math.min(8, Math.max(0.125, inputRms / outputRms));

  // --- 2. Per-parameter audibility: min vs max must actually change the sound ---
  // 1.5s per pass: long enough for delay/reverb tails (a 350ms default delay
  // needs several repeats before feedback becomes audible), still <100ms of
  // compute for a 7-parameter plugin.
  const SHORT = 66150;
  const deadParams: string[] = [];
  const audibleParams: string[] = [];
  const unstableParams: string[] = [];

  for (const p of parameters) {
    if (isDecorativeParam(p)) continue;

    const atMin = { ...defaults, [p.id]: p.min };
    const atMax = { ...defaults, [p.id]: p.max };
    const a = renderPass(dspFunc, atMin, SHORT);
    const b = renderPass(dspFunc, atMax, SHORT);

    if (a.failed || b.failed) {
      // The knob breaks the DSP somewhere in its legal range -- a user WILL
      // find that spot. Hard evidence for the repair loop.
      unstableParams.push(p.id);
      continue;
    }

    let diffSum = 0;
    for (let i = 0; i < SHORT; i++) diffSum += Math.abs(a.samples[i] - b.samples[i]);
    const meanDiff = diffSum / SHORT;
    const rmsDiff = Math.abs(a.rms - b.rms);

    if (meanDiff < 0.003 && rmsDiff < 0.003) {
      deadParams.push(p.id);
    } else {
      audibleParams.push(p.id);
    }
  }

  // --- 3. Aggregate evidence for the repair loop ---
  const problems: string[] = [];
  if (isSilent) {
    problems.push(
      `output is essentially SILENT at default settings (output RMS ${outputRms.toFixed(5)} vs input RMS ${inputRms.toFixed(3)}) -- fix the gain staging / signal path so the processed signal is audible at defaults`
    );
  }
  if (deadParams.length > 0) {
    problems.push(
      `these parameters have NO audible effect between their min and max on 1.5s of musical material: ${deadParams.join(", ")} -- the DSP must actually read params.<id> and the value must influence the output math`
    );
  }
  if (unstableParams.length > 0) {
    problems.push(
      `the DSP produced NaN/Infinity or threw when these parameters were set to their min or max: ${unstableParams.join(", ")} -- every value in a parameter's declared [min, max] range must be safe (clamp coefficients, guard divisions, wrap indices)`
    );
  }

  return {
    ok: problems.length === 0,
    inputRms,
    outputRms,
    gainOffsetDb,
    suggestedTrim,
    isSilent,
    clippingRatio: main.clippingRatio,
    dcOffset: main.dcOffset,
    deadParams,
    audibleParams,
    unstableParams,
    evidence: problems.join("; "),
  };
}

/**
 * Character index: how much the DSP reshapes the dry signal's spectral
 * balance, measured across 8 log-spaced bands via a single-bin Goertzel
 * transform (a cheap DFT at one frequency — no FFT dependency needed for
 * just 8 bins). 0 = the wet spectrum's energy distribution matches the dry
 * signal (silence or near-passthrough); 1 = dramatically reshaped.
 *
 * This is NOT a quality signal — a distorted mess and a tasteful shimmer
 * can score similarly high. It exists purely as a tie-breaker: when the
 * perfecting loop has multiple candidates that are all equally CORRECT
 * (per the gate above), prefer the one that does more to the sound.
 */
const CHARACTER_BANDS_HZ = [100, 200, 400, 800, 1600, 3200, 6400, 12000];
const CHARACTER_WINDOW = 8192;

/** Power at one frequency bin via the Goertzel algorithm: O(n), no FFT. */
function goertzelPower(samples: Float32Array, freqHz: number, sampleRate: number): number {
  const n = samples.length;
  const k = Math.round((n * freqHz) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

/** Normalized (sums to 1) energy distribution across CHARACTER_BANDS_HZ. */
function spectralBandDistribution(samples: Float32Array, sampleRate: number): number[] {
  const energies = CHARACTER_BANDS_HZ.map((f) => Math.sqrt(goertzelPower(samples, f, sampleRate)));
  const total = energies.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return energies.map(() => 0); // silence: no distribution to speak of
  return energies.map((e) => e / total);
}

export function measureCharacterIndex(dspFunction: string, parameters: PluginParameter[]): number {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return 0;

  const defaults = defaultParamsMap(parameters);
  const dry = new Float32Array(CHARACTER_WINDOW);
  for (let i = 0; i < CHARACTER_WINDOW; i++) dry[i] = musicalInputAt(i);

  const wet = renderPass(dspFunc, defaults, CHARACTER_WINDOW);
  if (wet.failed) return 0;

  // Silent output has no spectral distribution to compare (the all-zero
  // fallback in spectralBandDistribution would otherwise read as "maximally
  // different from dry" -- the opposite of the intended meaning). Treat it
  // the same as "nothing measurable": 0. Silence is already penalized
  // separately and heavily by scoreMusicality's isSilent check.
  let wetEnergy = 0;
  for (let i = 0; i < wet.samples.length; i++) wetEnergy += wet.samples[i] * wet.samples[i];
  if (wetEnergy <= 1e-9) return 0;

  const dryDist = spectralBandDistribution(dry, SAMPLE_RATE);
  const wetDist = spectralBandDistribution(wet.samples, SAMPLE_RATE);

  let l1 = 0;
  for (let i = 0; i < dryDist.length; i++) l1 += Math.abs(dryDist[i] - wetDist[i]);
  // L1 distance between two distributions that each sum to 1 maxes at 2.
  return Math.max(0, Math.min(1, l1 / 2));
}

/**
 * Static real-time-safety scan of the DSP body. Returns repair-worthy
 * evidence ("" when clean) plus a performance score.
 */
export function analyzeRealtimeSafety(dspFunction: string): { evidence: string; score: number } {
  let score = 100;
  const issues: string[] = [];

  const hasInitGuard = /if\s*\(\s*!\s*state\.\w+\s*\)/.test(dspFunction);
  const allocates = /new\s+(Float32Array|Float64Array|Array|Object|Map|Set)\s*\(|\.fill\s*\(/.test(dspFunction);

  if (allocates && !hasInitGuard) {
    issues.push(
      "allocates memory (new Array/Float32Array) without an `if (!state.init) { ... }` guard -- per-sample allocation causes audio stutter; wrap ALL allocations in a one-time init guard"
    );
    score -= 25;
  }

  if (/console\.(log|warn|error)/.test(dspFunction)) {
    issues.push("calls console.log inside the per-sample loop -- remove all logging from real-time code");
    score -= 15;
  }

  if (/JSON\.(parse|stringify)|fetch\s*\(|setTimeout|setInterval/.test(dspFunction)) {
    issues.push("uses JSON/fetch/timers inside the audio path -- real-time DSP must be pure arithmetic");
    score -= 30;
  }

  return { evidence: issues.join("; "), score: Math.max(0, score) };
}

/** Category-matched visual themes so every generation gets a deliberate look. */
const CATEGORY_THEMES: Record<
  AudioPlugin["category"],
  { bg: string; border: string; accent: string; text: string; font: NonNullable<AudioPlugin["customSkin"]>["fontStyle"] }
> = {
  distortion: { bg: "#1a0f0a", border: "#7c2d12", accent: "#f97316", text: "#fed7aa", font: "grotesk" },
  delay: { bg: "#0a1214", border: "#155e63", accent: "#2dd4bf", text: "#ccfbf1", font: "mono" },
  filter: { bg: "#0d0a1a", border: "#4c1d95", accent: "#a78bfa", text: "#ede9fe", font: "sans" },
  synthesizer: { bg: "#12081c", border: "#86198f", accent: "#e879f9", text: "#fae8ff", font: "orbitron" },
  dynamics: { bg: "#0f1108", border: "#3f6212", accent: "#a3e635", text: "#ecfccb", font: "mono" },
  modulation: { bg: "#081019", border: "#1e40af", accent: "#60a5fa", text: "#dbeafe", font: "sans" },
  reverb: { bg: "#0b0e14", border: "#334155", accent: "#94a3b8", text: "#e2e8f0", font: "serif" },
};

function inferControlType(p: PluginParameter): NonNullable<PluginParameter["controlType"]> {
  if (p.controlType) return p.controlType;
  if (/bypass|enable|power|on_off|switch/i.test(p.id) || (p.min === 0 && p.max === 1 && p.unit === "state")) return "toggle";
  if (/meter|vu|reduction/i.test(p.id) || /meter|vu/i.test(p.name)) return "meter";
  if (/mix|level|volume|output|makeup|blend|dry_wet|drywet/i.test(p.id)) return "slider";
  return "knob";
}

const SAMPLER_PAD_COUNT = 8;

function buildAmpHeadParam(): PluginParameter {
  return {
    id: "amp_head_auto", name: "Amp Head", min: 0, max: 10, defaultValue: 5, value: 5, unit: "gain",
    controlType: "amp", customText: "PLEXI 50W",
    ampTolexPattern: "carbon", ampKnobStyle: "chickenhead", ampChannelType: "crunch", ampTubeGlow: true,
    w: 340, h: 150,
  };
}

function buildCabinetParam(): PluginParameter {
  return {
    id: "cabinet_auto", name: "Cabinet", min: 0, max: 10, defaultValue: 5, value: 5, unit: "vol",
    controlType: "cab", customText: "CELESTION V30",
    cabGrillStyle: "metalgrid", cabSize: "4x12", cabMicModel: "SM57",
    w: 240, h: 240,
  };
}

function buildMicPositionParam(): PluginParameter {
  return {
    id: "mic_position_auto", name: "Mic Position", min: 0, max: 100, defaultValue: 20, value: 20, unit: "mm",
    controlType: "mic", valX: 35, valY: 50,
    w: 160, h: 160,
  };
}

function buildPadParam(index: number): PluginParameter {
  return {
    id: `pad_auto_${index}`, name: `Pad ${index}`, min: 0, max: 127, defaultValue: 0, value: 0, unit: "vel",
    controlType: "pad", w: 100, h: 100,
  };
}

/**
 * Family-mandatory UI: some plugin types get a fixed interface regardless of
 * what the model actually returned. A guitar/bass amp sim ALWAYS gets an amp
 * head, a cabinet, and mic positioning; a sampler/drum-pad request ALWAYS
 * gets a full pad-trigger grid. This never removes anything the model
 * provided -- it only tops up what's missing, so a model that already did
 * the right thing costs nothing extra. This is what makes the UI match the
 * request every time, instead of only when the model happens to comply.
 */
function enforceFamilyRequirements(plugin: AudioPlugin, family: PluginFamily | null | undefined): { plugin: AudioPlugin; changes: string[] } {
  if (!family) return { plugin, changes: [] };
  const changes: string[] = [];
  const params = [...plugin.parameters];

  if (family === "amp_sim") {
    if (!params.some((p) => p.controlType === "amp")) {
      params.push(buildAmpHeadParam());
      changes.push("added the amp head faceplate (every amp sim gets one)");
    }
    if (!params.some((p) => p.controlType === "cab")) {
      params.push(buildCabinetParam());
      changes.push("added the speaker cabinet (every amp sim gets one)");
    }
    if (!params.some((p) => p.controlType === "mic")) {
      params.push(buildMicPositionParam());
      changes.push("added cabinet mic positioning (every amp sim gets one)");
    }
  }

  if (family === "sampler") {
    const existingPadCount = params.filter((p) => p.controlType === "pad").length;
    if (existingPadCount < SAMPLER_PAD_COUNT) {
      for (let i = existingPadCount + 1; i <= SAMPLER_PAD_COUNT; i++) {
        params.push(buildPadParam(i));
      }
      changes.push(`filled out the sample pad grid to ${SAMPLER_PAD_COUNT} pads`);
    }
  }

  if (changes.length === 0) return { plugin, changes: [] };
  return { plugin: { ...plugin, parameters: params }, changes };
}

/**
 * Guarantee a polished faceplate: every parameter gets a controlType, grid
 * layout coordinates, and theme colors; the plugin gets a coherent skin.
 * Model-provided styling is always preserved -- this only fills gaps.
 */
export function polishPluginVisuals(plugin: AudioPlugin, themeOverride?: UiTheme): { plugin: AudioPlugin; changes: string[] } {
  const theme = themeOverride ?? (CATEGORY_THEMES[plugin.category] || CATEGORY_THEMES.filter);
  const changes: string[] = [];

  let styledCount = 0;
  let laidOutCount = 0;

  // Amp/cab/mic faceplates are large; keep them on their own row. Pads form
  // their own dedicated trigger grid below everything else.
  const regular = plugin.parameters.filter(
    (p) => p.controlType !== "amp" && p.controlType !== "cab" && p.controlType !== "mic" && p.controlType !== "pad"
  );
  const showpiece = plugin.parameters.filter((p) => p.controlType === "amp" || p.controlType === "cab" || p.controlType === "mic");
  const pads = plugin.parameters.filter((p) => p.controlType === "pad");

  const COLS = 4;
  const CELL_W = 140;
  const CELL_H = 125;
  const ORIGIN_X = 40;
  const ORIGIN_Y = 70;

  const polishedRegular = regular.map((p, idx) => {
    const next: PluginParameter = { ...p };

    if (!next.controlType) {
      next.controlType = inferControlType(p);
      styledCount++;
    }
    if (!next.accentColor) next.accentColor = theme.accent;
    if (!next.fontStyle) next.fontStyle = theme.font;

    if (next.x === undefined || next.y === undefined) {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      next.x = ORIGIN_X + col * CELL_W;
      next.y = ORIGIN_Y + row * CELL_H;
      next.w = next.w ?? 120;
      next.h = next.h ?? (next.controlType === "toggle" ? 80 : 100);
      laidOutCount++;
    }
    return next;
  });

  const regularRows = Math.ceil(polishedRegular.length / COLS);
  const polishedShowpiece = showpiece.map((p, idx) => {
    const next: PluginParameter = { ...p };
    if (next.x === undefined || next.y === undefined) {
      next.x = ORIGIN_X + idx * 340;
      next.y = ORIGIN_Y + regularRows * CELL_H + 20;
      next.w = next.w ?? 320;
      next.h = next.h ?? 220;
      laidOutCount++;
    }
    if (!next.accentColor) next.accentColor = theme.accent;
    return next;
  });

  const showpieceRows = showpiece.length > 0 ? 1 : 0;
  const PAD_COLS = 4;
  const PAD_SIZE = 100;
  const PAD_GAP = 12;
  const padOriginY = ORIGIN_Y + regularRows * CELL_H + (showpieceRows > 0 ? 280 : 0);
  const polishedPads = pads.map((p, idx) => {
    const next: PluginParameter = { ...p };
    if (next.x === undefined || next.y === undefined) {
      const col = idx % PAD_COLS;
      const row = Math.floor(idx / PAD_COLS);
      next.x = ORIGIN_X + col * (PAD_SIZE + PAD_GAP);
      next.y = padOriginY + row * (PAD_SIZE + PAD_GAP);
      next.w = next.w ?? PAD_SIZE;
      next.h = next.h ?? PAD_SIZE;
      laidOutCount++;
    }
    if (!next.accentColor) next.accentColor = theme.accent;
    return next;
  });

  const polished: AudioPlugin = {
    ...plugin,
    parameters: [...polishedRegular, ...polishedShowpiece, ...polishedPads],
    customSkin: plugin.customSkin ?? {
      bgColor: theme.bg,
      borderColor: theme.border,
      accentColor: theme.accent,
      textColor: theme.text,
      fontStyle: theme.font,
      glowStyle: (theme as UiTheme).glowStyle ?? "neon",
      borderWidth: 1,
    },
  };

  if (!plugin.customSkin) changes.push(`applied a ${plugin.category}-themed faceplate skin`);
  if (styledCount > 0) changes.push(`assigned control types to ${styledCount} parameter(s)`);
  if (laidOutCount > 0) changes.push(`auto-laid-out ${laidOutCount} control(s) on the designer grid`);

  return { plugin: polished, changes };
}

function scoreLooks(plugin: AudioPlugin): number {
  let score = 100;
  for (const p of plugin.parameters) {
    if (!p.controlType) score -= 8;
    if (p.x === undefined || p.y === undefined) score -= 4;
    if (!p.accentColor) score -= 2;
  }
  if (!plugin.customSkin) score -= 10;
  return Math.max(0, score);
}

function scoreLatency(generationMs?: number): number {
  if (generationMs === undefined) return 100; // deterministic/offline paths are instant
  if (generationMs <= 20000) return 100;
  if (generationMs <= 40000) return 97;
  if (generationMs <= 75000) return 88;
  if (generationMs <= 120000) return 75;
  return 60;
}

function scoreMusicality(m: MusicalityMeasurement, trimmed: boolean, dcBlocked: boolean): number {
  // Code that never produced a measurable render (syntax error, NaN on the
  // default pass) is a hard zero -- not an unblemished 100.
  if (m.fatal) return 0;
  let score = 100;
  if (m.isSilent) score -= 60;

  const tested = m.audibleParams.length + m.deadParams.length;
  if (tested > 0) {
    score -= Math.min(30, m.deadParams.length * 10);
  }
  score -= Math.min(30, m.unstableParams.length * 15);
  // Bad internal staging that needed more than 12 dB of external correction --
  // the trim fully fixes loudness, so this only notes the smell.
  if (!m.isSilent && Math.abs(m.gainOffsetDb) > 12 && trimmed) score -= 3;
  // Residual gain error only counts when it could NOT be trimmed away
  if (!trimmed && Math.abs(m.gainOffsetDb) > 3) score -= Math.min(20, Math.abs(m.gainOffsetDb));
  if (m.clippingRatio > 0.1) score -= 10;
  // DC offset only costs points when the engine-level blocker isn't handling it
  if (m.dcOffset > 0.1 && !dcBlocked) score -= 10;
  return Math.max(0, score);
}

/**
 * Run the full gate: measure, deterministically fix (output trim + visual
 * polish), score all four dimensions, and return the improved plugin plus a
 * transcript-ready set of notes.
 */
export function runQualityGate(
  plugin: AudioPlugin,
  opts: { generationMs?: number; family?: PluginFamily | null; prompt?: string; intent?: string } = {}
): QualityGateResult {
  const notes: string[] = [];

  // --- Musicality: measure, then fix gain staging deterministically ---
  const m = measureMusicality(plugin.dspFunction, plugin.parameters);
  let outputTrim = 1;
  let trimmed = false;

  if (!m.isSilent && Math.abs(m.gainOffsetDb) > 1.5) {
    outputTrim = m.suggestedTrim;
    trimmed = true;
    notes.push(
      `Gain staging corrected: output was ${m.gainOffsetDb > 0 ? "+" : ""}${m.gainOffsetDb.toFixed(1)} dB vs the dry signal; a ${outputTrim >= 1 ? "+" : ""}${(20 * Math.log10(outputTrim)).toFixed(1)} dB output trim now restores unity loudness.`
    );
  }
  // DC accumulation is fixed at the engine level with a one-pole blocker
  let dcBlock = false;
  if (!m.isSilent && m.dcOffset > 0.05) {
    dcBlock = true;
    notes.push(`DC offset corrected: output carried ${m.dcOffset.toFixed(3)} DC bias; the engine now runs a DC blocker after this plugin.`);
  }

  if (m.deadParams.length > 0) {
    notes.push(`Parameters with no audible effect between min and max: ${m.deadParams.join(", ")}.`);
  }
  if (m.unstableParams.length > 0) {
    notes.push(`Parameters that break the DSP at range extremes: ${m.unstableParams.join(", ")}.`);
  }
  if (m.audibleParams.length > 0) {
    notes.push(`Verified audible on musical material: ${m.audibleParams.length}/${m.audibleParams.length + m.deadParams.length} parameters.`);
  }

  // --- UI enforcement: guarantee the fixed layout some families require ---
  const enforced = enforceFamilyRequirements(plugin, opts.family ?? null);
  enforced.changes.forEach((c) => notes.push(`Layout: ${c}.`));

  // --- Semantic UI spec -> deterministic layout: rank primary controls
  //     first and compose the theme from prompt design attributes. The
  //     model never dictates order, coordinates, or colors. ---
  const uiSpec = buildUiSpec(opts.prompt ?? "", enforced.plugin.parameters);
  const orderedPlugin: AudioPlugin = {
    ...enforced.plugin,
    parameters: orderParametersBySpec(enforced.plugin.parameters, uiSpec),
  };
  const categoryTheme = CATEGORY_THEMES[plugin.category] || CATEGORY_THEMES.filter;
  const theme = composeTheme(uiSpec.attributes, { ...categoryTheme, glowStyle: "neon" });
  if (uiSpec.attributes.length > 0) {
    notes.push(`Design language: ${uiSpec.attributes.join(" + ")} (theme composed from your wording).`);
  }

  // --- Looks: deterministic polish ---
  const { plugin: polished, changes } = polishPluginVisuals({ ...orderedPlugin, outputTrim, dcBlock }, theme);
  changes.forEach((c) => notes.push(`Visual polish: ${c}.`));

  // --- Performance: static real-time safety ---
  const perf = analyzeRealtimeSafety(plugin.dspFunction);
  if (perf.evidence) notes.push(`Real-time safety: ${perf.evidence}.`);

  const scores: QualityScores = {
    looks: scoreLooks(polished),
    performance: perf.score,
    latency: scoreLatency(opts.generationMs),
    musicality: scoreMusicality(m, trimmed, dcBlock),
  };

  // --- Build report: only measured facts, never claims ---
  const minScore = Math.min(scores.looks, scores.performance, scores.latency, scores.musicality);
  const confidence = m.fatal
    ? 0
    : Math.max(0, Math.min(100, minScore - m.deadParams.length * 5 - m.unstableParams.length * 10));
  const characterIndex = m.fatal ? 0 : measureCharacterIndex(plugin.dspFunction, plugin.parameters);
  const report: BuildReport = {
    intent: (opts.intent || opts.prompt || plugin.description || plugin.name).slice(0, 160),
    attributes: uiSpec.attributes,
    layout: uiSpec.layout,
    primaryControls: uiSpec.primaryControls,
    secondaryControls: uiSpec.secondaryControls,
    compiled: !m.fatal,
    scores,
    audibleParams: m.audibleParams,
    deadParams: m.deadParams,
    unstableParams: m.unstableParams,
    fixes: notes.slice(),
    confidence,
    characterIndex,
  };

  const final: AudioPlugin = { ...polished, quality: scores, buildReport: report };
  return { plugin: final, scores, notes, report };
}

/** Format scores as a one-line chat badge. */
export function formatQualityBadge(scores: QualityScores): string {
  const avg = Math.round((scores.looks + scores.performance + scores.latency + scores.musicality) / 4);
  return `**Quality gate ${avg}/100** — looks ${scores.looks} · performance ${scores.performance} · latency ${scores.latency} · musicality ${scores.musicality}`;
}

/**
 * Compact chat-ready build report: measured evidence, not claims. Dead or
 * unstable controls are stated plainly — never hidden behind a success line.
 */
export function formatBuildReport(r: BuildReport): string {
  const lines: string[] = [`📋 **Build report — confidence ${r.confidence}/100**`];

  const tested = r.audibleParams.length + r.deadParams.length;
  const verified = r.compiled
    ? `compiled ✓ · ${r.audibleParams.length}/${tested} controls verified audible on musical material`
    : "DID NOT COMPILE — the DSP never produced sound";
  lines.push(`- Verified: ${verified}`);

  if (r.deadParams.length > 0) {
    lines.push(`- ⚠️ No audible effect measured: ${r.deadParams.join(", ")}`);
  }
  if (r.unstableParams.length > 0) {
    lines.push(`- ⚠️ Unstable at range extremes: ${r.unstableParams.join(", ")}`);
  }

  const repairFixes = r.fixes.filter((f) => /corrected|trim|DC/i.test(f));
  if (repairFixes.length > 0) {
    lines.push(`- Fixes applied: ${repairFixes.map((f) => f.replace(/\.$/, "")).join("; ")}`);
  }

  lines.push(`- ${formatQualityBadge(r.scores).replace(/\*\*/g, "")}`);
  lines.push(`- Character: ${r.characterIndex.toFixed(2)}/1 (how much this reshapes the dry signal — not a quality score)`);

  const ui = [
    `${r.layout} layout`,
    r.primaryControls.length > 0 ? `primary ${r.primaryControls.join(", ")}` : "",
    r.attributes.length > 0 ? `theme ${r.attributes.join(" + ")}` : "",
  ].filter(Boolean).join(" · ");
  lines.push(`- UI: ${ui}`);

  if (r.jobs && r.jobs.length > 0) {
    const glyph = (s: string) => (s === "passed" ? "✓" : s === "repaired" ? "🔧" : s === "fallback" ? "↩" : "✗");
    lines.push(`- Pipeline: ${r.jobs.map((j) => `${j.id} ${glyph(j.status)}${j.attempts > 1 ? ` (${j.attempts} tries)` : ""}`).join(" → ")}`);
    const noteworthy = r.jobs.filter((j) => j.status !== "passed" && j.evidence);
    for (const j of noteworthy.slice(0, 3)) {
      lines.push(`  - ${j.worker}: ${j.evidence}`);
    }
  }

  if (r.refinement && r.refinement.length > 0) {
    const kept = r.refinement.filter((i) => i.accepted).length;
    lines.push(
      `- Perfecting loop: ${r.refinement.length} rework ${r.refinement.length === 1 ? "pass" : "passes"} — ${
        kept > 0 ? `kept ${kept} improvement(s), best from loop ${r.refinement.filter((i) => i.accepted).slice(-1)[0].iteration}` : "no candidate beat the original (kept the first build)"
      }`
    );
    for (const it of r.refinement) {
      lines.push(`  - loop ${it.iteration}: ${it.action} → ${it.accepted ? `KEPT (score ${it.score})` : `discarded (score ${it.score})`}`);
    }
  }

  return lines.join("\n");
}
