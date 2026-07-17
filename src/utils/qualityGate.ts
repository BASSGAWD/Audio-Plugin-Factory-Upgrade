/**
 * Post-generation quality gate.
 *
 * The verifier (pluginVerifier.ts) proves generated code won't crash or blow
 * up. This module proves it is actually GOOD, across the four dimensions the
 * factory grades itself on -- and deterministically fixes what can be fixed
 * without another model round-trip:
 *
 *  - musicality: measured across a BANK of realistic signals (a chord arp --
 *    the same one the preview plays -- plus a plucked note, a sustained tone,
 *    and percussive bursts). Gain staging is corrected with an output trim
 *    the audio engine applies; silent output, cross-signal dead spots, and
 *    dead ("decorative") parameters are detected and reported as evidence.
 *  - looks: every parameter is guaranteed a controlType, layout coordinates,
 *    and a category-matched color theme via polishPluginVisuals().
 *  - performance: static real-time-safety analysis of the DSP body.
 *  - latency: scored from measured generation wall-time (see scoreLatency --
 *    this is generation responsiveness, not the plugin's audio latency, which
 *    is ~0 in this per-sample engine).
 */

import { AudioPlugin, BuildReport, PluginParameter } from "../types";
import { sanitizeDspCode } from "./healthcheckRunner";
import { PluginFamily } from "./pluginSpec";
import { UiTheme, buildUiSpec, composeTheme, orderParametersBySpec } from "./uiSpec";
import { auditDspCode, formatCodeAudit } from "./codeAudit";

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
  /** Names of non-primary test signals on which the plugin goes silent while
   *  it is audible on the arp -- a real dead-spot (e.g. chokes plucks or
   *  sustains). Reported, and penalized by the refinement loop, but NOT
   *  scored into the four headline dimensions. */
  silentOnSignals: string[];
  /** True when the DSP produced a distinct right channel (state.outR) on the
   *  program render — genuine stereo output, not dual-mono. */
  stereoOutput?: boolean;
  /** RMS of the interchannel (L-R) difference on the program render at
   *  defaults. 0 for mono/dual-mono. */
  stereoWidthRms?: number;
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
/** Window for the per-signal cross-liveness check (0.5s = 2 burst periods). */
const CROSS_SIGNAL_WINDOW = 22050;

/**
 * The identical musical program material the preview engine's "synth" source
 * plays, so measurements predict exactly what the user will hear on Play.
 * This is the PRIMARY signal -- the deterministic gain/DC/silence fixes are
 * computed on it so they match the preview exactly.
 */
function arpAt(index: number): number {
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

/**
 * A plucked, decaying note (guitar/bass-like): fast attack, exponential
 * decay, re-triggered every 0.5s across a low register. Exercises transient
 * response and attack/release behaviour that a legato arp never reveals --
 * an attack-time or transient-shaper knob is dead on the arp but alive here.
 */
function pluckAt(index: number): number {
  const t = index / SAMPLE_RATE;
  const period = 0.5;
  const phase = t % period;
  const bar = Math.floor(t / period);
  const notes = [82.41, 110, 146.83, 196, 246.94, 329.63]; // E2..E4, guitar range
  const f = notes[bar % notes.length];
  const attack = Math.min(1, phase / 0.003); // ~3 ms attack
  const env = attack * Math.exp(-phase * 6);
  const osc = Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f * t) + 0.25 * Math.sin(2 * Math.PI * 3 * f * t);
  return osc * env * 0.18;
}

/**
 * A steady sustained tone with light vibrato -- equilibrium behaviour for
 * filters, EQ, drive, and anything whose character only settles after the
 * transient has passed.
 */
function sustainAt(index: number): number {
  const t = index / SAMPLE_RATE;
  const f = 196; // G3
  const vib = 1 + Math.sin(2 * Math.PI * 5 * t) * 0.006;
  const osc = Math.sin(2 * Math.PI * f * vib * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t) + 0.2 * Math.sin(2 * Math.PI * 3 * f * t);
  return osc * 0.2;
}

/** Deterministic value-noise hash (no Math.random -- measurements must be
 *  reproducible so scores are stable across runs). */
function hashNoise(index: number): number {
  const s = Math.sin(index * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Staccato percussive hits with silence gaps -- 60 ms bursts every 250 ms.
 * Exercises gates, transient shapers, compressor attack, and how a plugin
 * behaves during SILENCE between hits (a reverb should ring on, a gate
 * should close) -- none of which a continuous signal tests.
 */
function burstAt(index: number): number {
  const t = index / SAMPLE_RATE;
  const period = 0.25;
  const phase = t % period;
  if (phase > 0.06) return 0; // silence between hits
  const bar = Math.floor(t / period);
  const f = [110, 220, 165, 330][bar % 4];
  const attack = Math.min(1, phase / 0.002);
  const env = attack * Math.exp(-phase * 30);
  const osc = Math.sin(2 * Math.PI * f * t) + hashNoise(index) * 0.3; // tonal + noisy transient edge
  return osc * env * 0.25;
}

/** The signal bank the gate measures across. Index 0 is PRIMARY (the arp);
 *  it must stay first because the deterministic fixes key off it. */
const TEST_SIGNALS: { name: string; at: (i: number) => number }[] = [
  { name: "arp", at: arpAt },
  { name: "pluck", at: pluckAt },
  { name: "sustain", at: sustainAt },
  { name: "burst", at: burstAt },
];
const PRIMARY_SIGNAL = TEST_SIGNALS[0];

function compileDspBody(dspFunction: string): ((i: number, p: any, s: any, r?: number) => number) | null {
  try {
    const sanitized = sanitizeDspCode(dspFunction);
    // "inputR" is the OPT-IN stereo contract: mono bodies never reference it
    // and behave exactly as before; stereo bodies read it (guarded with
    // `inputR !== undefined ? inputR : inputSample`) and write their right
    // channel to state.outR each sample, returning the left.
    return new Function("inputSample", "params", "state", "inputR", sanitized) as any;
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
  /** Right-channel render, present only when the DSP set state.outR. */
  samplesR: Float32Array | null;
  /** True when the DSP produced a distinct right channel. */
  stereo: boolean;
}

/** Interchannel skew (samples) used to derive the right-channel test feed
 *  from any signal: ~2.2 ms of decorrelation, enough for mid-side and width
 *  processing to have real side content to work on, while keeping the same
 *  energy and character as the left feed. Mono DSP ignores it entirely. */
const STEREO_SKEW = 97;

function renderPass(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  length: number,
  signal: (i: number) => number = PRIMARY_SIGNAL.at
): RenderStats {
  const out = new Float32Array(length);
  let outR: Float32Array | null = null;
  const state: any = {};
  let sumSq = 0;
  let sumSqR = 0;
  let dcSum = 0;
  let clipCount = 0;

  const fail = (): RenderStats => ({ rms: 0, dcOffset: 0, clippingRatio: 0, failed: true, samples: out, samplesR: null, stereo: false });

  for (let i = 0; i < length; i++) {
    let y = 0;
    try {
      y = dspFunc(signal(i), params, state, signal(i + STEREO_SKEW));
    } catch {
      return fail();
    }
    if (!Number.isFinite(y)) {
      return fail();
    }
    out[i] = y;
    sumSq += y * y;
    dcSum += y;
    if (y >= 0.999 || y <= -0.999) clipCount++;

    const yr = state.outR;
    if (yr !== undefined) {
      if (!Number.isFinite(yr)) return fail();
      if (!outR) outR = new Float32Array(length);
      outR[i] = yr;
      sumSqR += yr * yr;
      if (yr >= 0.999 || yr <= -0.999) clipCount++;
    }
  }

  return {
    // Stereo modules are judged on both channels' energy; mono numbers are
    // byte-identical to the pre-stereo gate.
    rms: outR ? Math.sqrt((sumSq + sumSqR) / (2 * length)) : Math.sqrt(sumSq / length),
    dcOffset: Math.abs(dcSum / length),
    clippingRatio: clipCount / (outR ? 2 * length : length),
    failed: false,
    samples: out,
    samplesR: outR,
    stereo: outR !== null,
  };
}

/** RMS of the interchannel difference — 0 for mono/dual-mono output. */
function interchannelDiffRms(r: RenderStats): number {
  if (!r.samplesR) return 0;
  let sq = 0;
  for (let i = 0; i < r.samples.length; i++) {
    const d = r.samples[i] - r.samplesR[i];
    sq += d * d;
  }
  return Math.sqrt(sq / r.samples.length);
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
    silentOnSignals: [],
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
    const x = PRIMARY_SIGNAL.at(i);
    inSumSq += x * x;
  }
  const inputRms = Math.sqrt(inSumSq / FULL);

  const main = renderPass(dspFunc, defaults, FULL);
  if (main.failed) return failure("output produced NaN/Infinity or threw on musical program material at default settings");

  const outputRms = main.rms;
  const isSilent = outputRms < inputRms * 0.02; // more than ~34 dB below the dry signal
  const gainOffsetDb = isSilent ? -60 : 20 * Math.log10(outputRms / inputRms);
  const suggestedTrim = isSilent ? 1 : Math.min(8, Math.max(0.125, inputRms / outputRms));

  // Cross-signal liveness: a plugin that's audible on the arp but goes silent
  // on plucks or sustained notes has a real hole (a gate that chokes quiet
  // sustains, an effect that only works on continuous tones). Reported as a
  // weakness and fed to the refinement loop -- deliberately NOT scored into
  // the four headline dimensions, so the >=97 floor stays provable.
  const silentOnSignals: string[] = [];
  if (!isSilent) {
    for (const sig of TEST_SIGNALS) {
      if (sig === PRIMARY_SIGNAL) continue;
      let sigInSq = 0;
      for (let i = 0; i < CROSS_SIGNAL_WINDOW; i++) {
        const x = sig.at(i);
        sigInSq += x * x;
      }
      const sigInputRms = Math.sqrt(sigInSq / CROSS_SIGNAL_WINDOW);
      if (sigInputRms < 1e-4) continue; // signal itself is near-silent; nothing to compare
      const sigOut = renderPass(dspFunc, defaults, CROSS_SIGNAL_WINDOW, sig.at);
      if (!sigOut.failed && sigOut.rms < sigInputRms * 0.02) silentOnSignals.push(sig.name);
    }
  }

  // --- 2. Per-parameter audibility ACROSS THE SIGNAL BANK ---
  // A knob is AUDIBLE if moving min->max changes the sound on ANY realistic
  // signal (an attack-time knob is dead on a legato arp but alive on plucks/
  // bursts -- measuring across signals rescues genuinely-useful knobs the
  // single-signal test wrongly called dead). A knob is UNSTABLE if it makes
  // the DSP throw/NaN on ANY signal (a divide-by-envelope that only blows up
  // during the silence gaps of the burst is still a real bug a user hits).
  // Primary (arp) uses the full 1.5s window for delay/reverb tails; the extra
  // signals use 0.5s (transient differences reveal fast) to keep it cheap.
  const SHORT = 66150;
  const EXTRA_SHORT = 22050;
  const AUDIBLE_THRESHOLD = 0.003;
  const deadParams: string[] = [];
  const audibleParams: string[] = [];
  const unstableParams: string[] = [];

  for (const p of parameters) {
    if (isDecorativeParam(p)) continue;

    const atMin = { ...defaults, [p.id]: p.min };
    const atMax = { ...defaults, [p.id]: p.max };
    let audible = false;
    let unstable = false;

    for (const sig of TEST_SIGNALS) {
      const len = sig === PRIMARY_SIGNAL ? SHORT : EXTRA_SHORT;
      const a = renderPass(dspFunc, atMin, len, sig.at);
      const b = renderPass(dspFunc, atMax, len, sig.at);
      if (a.failed || b.failed) {
        unstable = true;
        break; // a hard failure on any signal dominates
      }
      if (audible) continue; // already proven audible; keep scanning only for instability
      let diffSum = 0;
      for (let i = 0; i < len; i++) diffSum += Math.abs(a.samples[i] - b.samples[i]);
      // Stereo-aware: a Width-style knob may change ONLY the right channel;
      // count its delta too (a missing side falls back to that render's left).
      if (a.samplesR || b.samplesR) {
        const ar = a.samplesR || a.samples;
        const br = b.samplesR || b.samples;
        for (let i = 0; i < len; i++) diffSum += Math.abs(ar[i] - br[i]);
      }
      if (diffSum / len >= AUDIBLE_THRESHOLD || Math.abs(a.rms - b.rms) >= AUDIBLE_THRESHOLD) {
        audible = true;
      }
    }

    if (unstable) unstableParams.push(p.id);
    else if (audible) audibleParams.push(p.id);
    else deadParams.push(p.id);
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
      `these parameters have NO audible effect between their min and max on ANY of the four test signals (arp, plucked, sustained, percussive): ${deadParams.join(", ")} -- the DSP must actually read params.<id> and the value must influence the output math`
    );
  }
  if (unstableParams.length > 0) {
    problems.push(
      `the DSP produced NaN/Infinity or threw when these parameters were set to their min or max: ${unstableParams.join(", ")} -- every value in a parameter's declared [min, max] range must be safe (clamp coefficients, guard divisions, wrap indices)`
    );
  }

  // Soft weaknesses: surfaced in the evidence and penalized by the refinement
  // loop, but NOT counted toward `ok` (they don't trigger the hard repair
  // loop) or the four headline scores (the >=97 floor stays provable).
  const weaknesses: string[] = [];
  if (silentOnSignals.length > 0) {
    weaknesses.push(
      `goes essentially SILENT on the ${silentOnSignals.join(", ")} signal(s) while audible on the arp -- the plugin has a dead spot on that kind of material (e.g. chokes plucked or sustained notes)`
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
    silentOnSignals,
    stereoOutput: main.stereo,
    stereoWidthRms: interchannelDiffRms(main),
    evidence: [...problems, ...weaknesses].join("; "),
  };
}

/* ------------------------------------------------------------------ */
/* Parameter semantics: a knob must do what its NAME claims            */
/* ------------------------------------------------------------------ */

/**
 * The audibility check above proves a knob DOES something; these checks prove
 * it does the RIGHT thing. Each semantic family is a directional test with
 * generous tolerance -- only clear reversals are flagged (a Cutoff that gets
 * darker as it opens, a Feedback that shortens the tail, a Drive that removes
 * harmonics, a Mix that moves wet->dry). This is the difference between "all
 * controls are alive" and "all controls are honest" -- the most common failure
 * of model-written DSP is plausible-looking code wired to the wrong math.
 */
const BRIGHT_PARAM = /^(cutoff|tone|treble|presence|bright|brightness|air|open)$/i;
const TAIL_PARAM = /^(feedback|decay|size|room|length|sustain)$/i;
const DRIVE_PARAM = /^(drive|dist|distortion|saturation|fuzz|gain)$/i;
const MIX_PARAM = /^(mix|blend|drywet|dry_wet|wet)$/i;
const WIDTH_PARAM = /^(width|spread|stereo_width|stereowidth|separation)$/i;

export interface SemanticCheck {
  param: string;
  property: string;
  detail: string;
  ok: boolean;
}

/**
 * ABSOLUTE high-frequency amplitude (1.6k / 3.2k / 6.4k / 12.8k Hz), per
 * sample. Absolute rather than share-of-total on purpose: in a multi-stage
 * chain an upstream stage may already band-limit the signal, so opening a
 * tone knob adds MID energy -- a relative share would read that honest
 * brightening as "darker" (the mid growth dilutes the high share). The
 * absolute measure only drops when high content genuinely disappears.
 */
function highBandLevel(samples: Float32Array): number {
  const amps = [1600, 3200, 6400, 12800].map((f) => Math.sqrt(goertzelPower(samples, f, SAMPLE_RATE)));
  return amps.reduce((a, b) => a + b, 0) / samples.length;
}

/** Broadband deterministic-noise probe: brightness checks need energy ABOVE
 *  the crossover bands -- the musical bank's harmonics stop near 600 Hz, so a
 *  cutoff sweep is invisible on them. Flat noise makes it unambiguous. */
function noiseProbeAt(i: number): number {
  return hashNoise(i) * 0.25;
}

/** 2nd+3rd harmonic amplitude relative to the fundamental on the clean tone. */
function harmonicShare(samples: Float32Array): number {
  const f1 = Math.sqrt(goertzelPower(samples, ALIAS_FUNDAMENTAL, SAMPLE_RATE));
  const f2 = Math.sqrt(goertzelPower(samples, ALIAS_FUNDAMENTAL * 2, SAMPLE_RATE));
  const f3 = Math.sqrt(goertzelPower(samples, ALIAS_FUNDAMENTAL * 3, SAMPLE_RATE));
  return (f2 + f3) / (f1 + 1e-6);
}

/** 0.7 s window whose input stops at 0.35 s -- the last 0.2 s is pure tail. */
const TAIL_TOTAL = 30870;
const TAIL_INPUT_END = 15435;
function tailSignalAt(i: number): number {
  return i < TAIL_INPUT_END ? arpAt(i) : 0;
}
function tailRms(samples: Float32Array): number {
  let sq = 0;
  let n = 0;
  for (let i = 22050; i < samples.length; i++) {
    sq += samples[i] * samples[i];
    n++;
  }
  return Math.sqrt(sq / Math.max(1, n));
}

export function verifyParamSemantics(
  dspFunction: string,
  parameters: PluginParameter[],
  skipIds: Set<string> = new Set()
): { checks: SemanticCheck[]; violations: string[] } {
  const checks: SemanticCheck[] = [];
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return { checks, violations: [] };
  const defaults = defaultParamsMap(parameters);

  const render = (id: string, v: number, len: number, sig: (i: number) => number) =>
    renderPass(dspFunc, { ...defaults, [id]: v }, len, sig);

  for (const p of parameters) {
    if (skipIds.has(p.id) || isDecorativeParam(p)) continue;

    if (BRIGHT_PARAM.test(p.id)) {
      // Opening a brightness-style knob must not DARKEN the sound.
      const lo = render(p.id, p.min, CROSS_SIGNAL_WINDOW, noiseProbeAt);
      const hi = render(p.id, p.max, CROSS_SIGNAL_WINDOW, noiseProbeAt);
      if (lo.failed || hi.failed || lo.rms < 1e-4 || hi.rms < 1e-4) continue;
      const a = highBandLevel(lo.samples);
      const b = highBandLevel(hi.samples);
      // Only a clear reversal is a violation: opening the knob lost more than
      // half the absolute high content that was audibly there at min.
      const ok = !(b < a * 0.5 && a > 1e-5);
      checks.push({ param: p.id, property: "brightness", detail: `high-band level ${a.toExponential(2)} at min -> ${b.toExponential(2)} at max`, ok });
    } else if (TAIL_PARAM.test(p.id)) {
      // More feedback/decay/size must not SHORTEN the ring-out.
      const lo = render(p.id, p.min, TAIL_TOTAL, tailSignalAt);
      const hi = render(p.id, p.max, TAIL_TOTAL, tailSignalAt);
      if (lo.failed || hi.failed) continue;
      const a = tailRms(lo.samples);
      const b = tailRms(hi.samples);
      const ok = !(b < a * 0.8 && a > 1e-4);
      checks.push({ param: p.id, property: "tail", detail: `tail RMS ${a.toFixed(5)} at min -> ${b.toFixed(5)} at max`, ok });
    } else if (DRIVE_PARAM.test(p.id)) {
      // More drive must not REMOVE harmonics from a clean tone.
      const lo = render(p.id, p.min, 8192, cleanToneAt);
      const hi = render(p.id, p.max, 8192, cleanToneAt);
      if (lo.failed || hi.failed || lo.rms < 1e-4 || hi.rms < 1e-4) continue;
      const a = harmonicShare(lo.samples);
      const b = harmonicShare(hi.samples);
      const ok = !(b < a * 0.8 && a - b > 0.01);
      checks.push({ param: p.id, property: "harmonics", detail: `2nd+3rd harmonic ratio ${a.toFixed(4)} at min -> ${b.toFixed(4)} at max`, ok });
    } else if (WIDTH_PARAM.test(p.id)) {
      // Opening a Width/Spread knob must not NARROW the stereo image. Only
      // meaningful when the module actually produces a right channel; the
      // render feed is already the decorrelated stereo pair.
      const lo = render(p.id, p.min, CROSS_SIGNAL_WINDOW, PRIMARY_SIGNAL.at);
      const hi = render(p.id, p.max, CROSS_SIGNAL_WINDOW, PRIMARY_SIGNAL.at);
      if (lo.failed || hi.failed || (!lo.stereo && !hi.stereo)) continue;
      const a = interchannelDiffRms(lo);
      const b = interchannelDiffRms(hi);
      const ok = !(b < a * 0.5 && a > 1e-4);
      checks.push({ param: p.id, property: "stereo-width", detail: `interchannel difference RMS ${a.toFixed(5)} at min -> ${b.toFixed(5)} at max`, ok });
    } else if (MIX_PARAM.test(p.id)) {
      // Raising Mix must move the output AWAY from the dry signal, not toward it.
      const lo = render(p.id, p.min, CROSS_SIGNAL_WINDOW, PRIMARY_SIGNAL.at);
      const hi = render(p.id, p.max, CROSS_SIGNAL_WINDOW, PRIMARY_SIGNAL.at);
      if (lo.failed || hi.failed) continue;
      let dLo = 0;
      let dHi = 0;
      for (let i = 0; i < CROSS_SIGNAL_WINDOW; i++) {
        const dry = PRIMARY_SIGNAL.at(i);
        dLo += Math.abs(lo.samples[i] - dry);
        dHi += Math.abs(hi.samples[i] - dry);
      }
      dLo /= CROSS_SIGNAL_WINDOW;
      dHi /= CROSS_SIGNAL_WINDOW;
      const ok = !(dHi < dLo * 0.6 && dLo - dHi > 0.01);
      checks.push({ param: p.id, property: "wet-dry", detail: `distance from dry ${dLo.toFixed(4)} at min -> ${dHi.toFixed(4)} at max`, ok });
    }
  }

  return { checks, violations: checks.filter((c) => !c.ok).map((c) => c.param) };
}

/* ------------------------------------------------------------------ */
/* Parameter range calibration: FIX unstable extremes, don't just flag */
/* ------------------------------------------------------------------ */

/** True when the DSP renders clean on every bank signal at this one value. */
function stableAt(
  dspFunc: (i: number, p: any, s: any) => number,
  defaults: Record<string, number>,
  id: string,
  value: number
): boolean {
  for (const sig of TEST_SIGNALS) {
    if (renderPass(dspFunc, { ...defaults, [id]: value }, CROSS_SIGNAL_WINDOW, sig.at).failed) return false;
  }
  return true;
}

/**
 * A parameter that NaNs at an extreme is normally a -15 musicality hit and a
 * warning the user has to live with. Calibration turns it into a FIX: binary-
 * search the widest stable interval from the default outward and rewrite
 * min/max (with a small safety margin), so the shipped knob range is fully
 * usable. Returns the calibrated parameters and evidence strings; parameters
 * whose default itself is unstable are left alone (that is a fatal build, not
 * a range problem).
 */
export function calibrateUnstableParams(
  dspFunction: string,
  parameters: PluginParameter[],
  unstableIds: string[]
): { parameters: PluginParameter[]; fixes: string[]; calibrated: string[] } {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc || unstableIds.length === 0) return { parameters, fixes: [], calibrated: [] };

  const defaults = defaultParamsMap(parameters);
  const fixes: string[] = [];
  const calibrated: string[] = [];

  const next = parameters.map((p) => {
    if (!unstableIds.includes(p.id)) return { ...p };
    if (!stableAt(dspFunc, defaults, p.id, p.defaultValue)) return { ...p }; // default broken: not a range problem
    const range = p.max - p.min;
    const out: PluginParameter = { ...p };

    for (const which of ["min", "max"] as const) {
      const extreme = which === "min" ? p.min : p.max;
      if (stableAt(dspFunc, defaults, p.id, extreme)) continue;
      // Binary search between the (stable) default and the (unstable) extreme.
      let good = p.defaultValue;
      let bad = extreme;
      for (let step = 0; step < 6; step++) {
        const mid = (good + bad) / 2;
        if (stableAt(dspFunc, defaults, p.id, mid)) good = mid;
        else bad = mid;
      }
      // Pull 2% of the range further inside the stable region for margin.
      const margin = 0.02 * range;
      const bound = which === "min" ? good + margin : good - margin;
      const rounded = Math.round(bound * 1000) / 1000;
      if (which === "min") out.min = rounded;
      else out.max = rounded;
      fixes.push(
        `Calibrated: ${p.name} ${which} pulled from ${extreme} to ${rounded} -- values beyond made the DSP throw or emit NaN, so the shipped range is now fully usable`
      );
    }

    if (out.min !== p.min || out.max !== p.max) {
      out.defaultValue = Math.min(out.max, Math.max(out.min, p.defaultValue));
      out.value = Math.min(out.max, Math.max(out.min, p.value !== undefined ? p.value : p.defaultValue));
      calibrated.push(p.id);
    }
    return out;
  });

  return { parameters: next, fixes, calibrated };
}

/* ------------------------------------------------------------------ */
/* Preview loudness matching                                           */
/* ------------------------------------------------------------------ */

/**
 * Exact unity-loudness trim for auditioning a candidate: unlike the gate's
 * gain correction (which only kicks in beyond a 1.5 dB deadband), this is
 * precise -- the blind A/B/C listening test must compare CHARACTER, not
 * level, because the louder option always sounds "better" to human ears.
 */
export function measurePreviewTrim(dspFunction: string, parameters: PluginParameter[]): number {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return 1;
  let inSq = 0;
  for (let i = 0; i < CROSS_SIGNAL_WINDOW; i++) {
    const x = PRIMARY_SIGNAL.at(i);
    inSq += x * x;
  }
  const inputRms = Math.sqrt(inSq / CROSS_SIGNAL_WINDOW);
  const out = renderPass(dspFunc, defaultParamsMap(parameters), CROSS_SIGNAL_WINDOW);
  if (out.failed || out.rms < 1e-5) return 1;
  return Math.min(8, Math.max(0.125, inputRms / out.rms));
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

/** Spectral reshaping of ONE signal (0 = unchanged/silent, 1 = maximally
 *  reshaped). Averaged across the bank by measureCharacterIndex. */
function characterOnSignal(dspFunc: (i: number, p: any, s: any) => number, defaults: Record<string, number>, signal: (i: number) => number): number {
  const dry = new Float32Array(CHARACTER_WINDOW);
  for (let i = 0; i < CHARACTER_WINDOW; i++) dry[i] = signal(i);

  const wet = renderPass(dspFunc, defaults, CHARACTER_WINDOW, signal);
  if (wet.failed) return 0;

  // Silent output has no spectral distribution to compare (the all-zero
  // fallback in spectralBandDistribution would otherwise read as "maximally
  // different from dry" -- the opposite of the intended meaning). Treat it
  // as "nothing measurable": 0.
  let wetEnergy = 0;
  for (let i = 0; i < wet.samples.length; i++) wetEnergy += wet.samples[i] * wet.samples[i];
  if (wetEnergy <= 1e-9) return 0;

  // The dry burst is mostly silence; a near-zero-energy dry signal makes the
  // distribution comparison meaningless, so skip it in the average.
  let dryEnergy = 0;
  for (let i = 0; i < dry.length; i++) dryEnergy += dry[i] * dry[i];
  if (dryEnergy <= 1e-9) return -1; // sentinel: "not comparable", excluded from the mean

  const dryDist = spectralBandDistribution(dry, SAMPLE_RATE);
  const wetDist = spectralBandDistribution(wet.samples, SAMPLE_RATE);

  let l1 = 0;
  for (let i = 0; i < dryDist.length; i++) l1 += Math.abs(dryDist[i] - wetDist[i]);
  // L1 distance between two distributions that each sum to 1 maxes at 2.
  return Math.max(0, Math.min(1, l1 / 2));
}

export function measureCharacterIndex(dspFunction: string, parameters: PluginParameter[]): number {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return 0;

  const defaults = defaultParamsMap(parameters);
  // Average the spectral reshaping across every comparable signal, so the
  // character score reflects how the plugin behaves on plucks and sustains,
  // not just the arp.
  let sum = 0;
  let count = 0;
  for (const sig of TEST_SIGNALS) {
    const c = characterOnSignal(dspFunc, defaults, sig.at);
    if (c >= 0) {
      sum += c;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** In-place iterative radix-2 Cooley-Tukey FFT (length must be a power of 2).
 *  Forward transform; re/im are overwritten with the spectrum. */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const vr = re[b] * cwr - im[b] * cwi;
        const vi = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = ncwr;
      }
    }
  }
}

/**
 * Aliasing / harshness index: 0 = clean, 1 = severely aliased. Nonlinear DSP
 * (distortion, waveshaping, bitcrush, cheap pitch/sample-rate tricks) creates
 * harmonics above Nyquist that FOLD BACK to INHARMONIC frequencies -- the
 * digital "fizz" that separates an amateur clipper from an oversampled one.
 *
 * Measured on a dedicated clean sine (NOT the musical bank -- a single tone
 * makes the harmonic bookkeeping unambiguous), chosen to land exactly on an
 * FFT bin so its true harmonics do too. Take the windowed power spectrum;
 * energy sitting ON a harmonic bin (+/-2 bins for window leakage) is
 * legitimate, everything else is aliasing/noise. index = inharmonic / total.
 */
/** Families expected to stay spectrally clean -- a high aliasing index here
 *  is a real defect (digital fizz), not intended character. Excludes the
 *  inharmonic-by-design families (modulation, pitch, synthesizer, sampler,
 *  hybrid_other, utility). */
const CLEAN_FAMILIES = new Set<PluginFamily>([
  "distortion", "saturator", "multiband_saturator", "amp_sim", "filter", "eq", "dynamics", "delay", "reverb",
]);
/** Above this inharmonic ratio a clean-family build is "harsh". Clean golden
 *  recipes top out ~0.02, strong aliasers (bitcrush, sample-rate reduction)
 *  read 0.6+, so this cleanly separates defect from noise floor. */
const ALIAS_DEFECT_THRESHOLD = 0.05;

const ALIAS_N = 8192;
const ALIAS_BIN = 464; // fundamental bin -> 464 * 44100/8192 = 2497.9 Hz
const ALIAS_FUNDAMENTAL = (ALIAS_BIN * SAMPLE_RATE) / ALIAS_N;
function cleanToneAt(index: number): number {
  return Math.sin((2 * Math.PI * ALIAS_FUNDAMENTAL * index) / SAMPLE_RATE) * 0.5;
}

/**
 * Inter-sample TRUE peak (dBTP) of the program render at default settings.
 * Sample peaks miss overs that appear between samples after DAC
 * reconstruction; this estimates them by 4x oversampling with Catmull-Rom
 * interpolation (a good local approximation of the sinc reconstruction the
 * BS.1770 true-peak meter mandates). Informational measurement — the gate
 * notes it when a build risks clipping a converter.
 */
export function measureTruePeak(dspFunction: string, parameters: PluginParameter[]): number {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return -Infinity;
  const wet = renderPass(dspFunc, defaultParamsMap(parameters), 22050);
  if (wet.failed) return -Infinity;
  let peak = 0;
  const channels = wet.samplesR ? [wet.samples, wet.samplesR] : [wet.samples];
  for (const s of channels) {
    for (let i = 1; i < s.length - 2; i++) {
      const p0 = s[i - 1], p1 = s[i], p2 = s[i + 1], p3 = s[i + 2];
      const a1 = Math.abs(p1);
      if (a1 > peak) peak = a1;
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        const v =
          0.5 *
          (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        const av = Math.abs(v);
        if (av > peak) peak = av;
      }
    }
  }
  return peak <= 1e-9 ? -Infinity : 20 * Math.log10(peak);
}

export function measureAliasing(dspFunction: string, parameters: PluginParameter[]): number {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return 0;

  const defaults = defaultParamsMap(parameters);
  const wet = renderPass(dspFunc, defaults, ALIAS_N, cleanToneAt);
  if (wet.failed) return 0;

  // Hann-window to contain spectral leakage, then FFT.
  const re = new Float64Array(ALIAS_N);
  const im = new Float64Array(ALIAS_N);
  let energy = 0;
  for (let i = 0; i < ALIAS_N; i++) {
    energy += wet.samples[i] * wet.samples[i];
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (ALIAS_N - 1));
    re[i] = wet.samples[i] * w;
  }
  if (energy <= 1e-9) return 0; // silent -- nothing to judge

  fftInPlace(re, im);

  const half = ALIAS_N >> 1;
  const isHarmonic = new Uint8Array(half);
  for (let h = 1; h * ALIAS_BIN < half - 3; h++) {
    for (let d = -2; d <= 2; d++) isHarmonic[h * ALIAS_BIN + d] = 1;
  }

  let total = 0;
  let inharmonic = 0;
  // Skip DC and the lowest few bins (windowing smears energy there).
  for (let k = 3; k < half; k++) {
    const power = re[k] * re[k] + im[k] * im[k];
    total += power;
    if (!isHarmonic[k]) inharmonic += power;
  }
  if (total <= 1e-12) return 0;
  return Math.max(0, Math.min(1, inharmonic / total));
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

function scoreMusicality(m: MusicalityMeasurement, trimmed: boolean, dcBlocked: boolean, semanticViolations = 0): number {
  // Code that never produced a measurable render (syntax error, NaN on the
  // default pass) is a hard zero -- not an unblemished 100.
  if (m.fatal) return 0;
  let score = 100;
  if (m.isSilent) score -= 60;
  // A knob that is alive but does the WRONG thing is worse than a dead one --
  // it actively misleads the player. Penalized like dead params, capped so a
  // single systematic mistake can't zero an otherwise-working build.
  score -= Math.min(18, semanticViolations * 6);

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
  let m = measureMusicality(plugin.dspFunction, plugin.parameters);
  let workingParams = plugin.parameters;

  // Range calibration: an unstable extreme becomes a FIXED range, not a
  // warning. Only kept when re-measurement proves it actually helped.
  if (!m.fatal && m.unstableParams.length > 0) {
    const cal = calibrateUnstableParams(plugin.dspFunction, workingParams, m.unstableParams);
    if (cal.calibrated.length > 0) {
      const m2 = measureMusicality(plugin.dspFunction, cal.parameters);
      if (!m2.fatal && m2.unstableParams.length < m.unstableParams.length) {
        m = m2;
        workingParams = cal.parameters;
        cal.fixes.forEach((f) => notes.push(`${f}.`));
      }
    }
  }

  // --- Parameter semantics: every knob must do what its name claims ---
  const semantics = m.fatal
    ? { checks: [] as SemanticCheck[], violations: [] as string[] }
    : verifyParamSemantics(plugin.dspFunction, workingParams, new Set([...m.deadParams, ...m.unstableParams]));
  for (const c of semantics.checks) {
    if (!c.ok) notes.push(`Semantic violation: "${c.param}" is audible but does not behave like its name (${c.property}: ${c.detail}).`);
  }

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
  if (m.silentOnSignals.length > 0) {
    notes.push(`Cross-signal dead spot: silent on ${m.silentOnSignals.join(", ")} while audible on the arp.`);
  }
  if (m.audibleParams.length > 0) {
    notes.push(`Verified audible on musical material: ${m.audibleParams.length}/${m.audibleParams.length + m.deadParams.length} parameters.`);
  }

  // --- UI enforcement: guarantee the fixed layout some families require ---
  // (built on the calibrated parameters so any range fixes actually ship)
  const measuredPlugin: AudioPlugin = workingParams === plugin.parameters ? plugin : { ...plugin, parameters: workingParams };
  const enforced = enforceFamilyRequirements(measuredPlugin, opts.family ?? null);
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
    musicality: scoreMusicality(m, trimmed, dcBlock, semantics.violations.length),
  };

  // --- Build report: only measured facts, never claims ---
  const minScore = Math.min(scores.looks, scores.performance, scores.latency, scores.musicality);
  const confidence = m.fatal
    ? 0
    : Math.max(0, Math.min(100, minScore - m.deadParams.length * 5 - m.unstableParams.length * 10 - semantics.violations.length * 5));
  const characterIndex = m.fatal ? 0 : measureCharacterIndex(plugin.dspFunction, workingParams);

  // Aliasing/harshness: measured always (informational), but only counted a
  // DEFECT for families that are supposed to stay spectrally clean -- a
  // ring-mod, pitch shifter, chorus, or generator is inharmonic by design, so
  // a high index there is character, not a bug. `harsh` drives the refinement
  // penalty and a report warning; it never touches the four headline scores.
  const aliasingIndex = m.fatal ? 0 : measureAliasing(plugin.dspFunction, workingParams);
  const harsh = !m.fatal && !!opts.family && CLEAN_FAMILIES.has(opts.family) && aliasingIndex > ALIAS_DEFECT_THRESHOLD;
  if (harsh) {
    notes.push(`Aliasing/harshness: ${aliasingIndex.toFixed(2)} inharmonic energy on a clean tone -- a ${opts.family} should stay smooth; this has audible digital fizz (oversample or lowpass the nonlinearity).`);
  }

  // Inter-sample true peak (dBTP), 4x Catmull-Rom reconstruction. The trim
  // computed above is applied at the ENGINE's output stage, so report the
  // trimmed level -- what a converter would actually see.
  const rawTruePeakDb = m.fatal ? -Infinity : measureTruePeak(plugin.dspFunction, workingParams);
  const truePeakDb = Number.isFinite(rawTruePeakDb) ? rawTruePeakDb + 20 * Math.log10(Math.max(1e-6, outputTrim)) : rawTruePeakDb;
  if (Number.isFinite(truePeakDb)) {
    if (truePeakDb > -0.1) {
      notes.push(`True peak: ${truePeakDb.toFixed(2)} dBTP after trim -- inter-sample overs can clip a DAC; leave ~1 dB of headroom.`);
    } else {
      notes.push(`True peak: ${truePeakDb.toFixed(2)} dBTP (inter-sample, 4x oversampled) -- safe converter headroom.`);
    }
  }

  if (m.stereoOutput) {
    notes.push(
      `Stereo output verified: distinct left/right channels (interchannel difference RMS ${(m.stereoWidthRms ?? 0).toFixed(4)} on program material). Native VST3 export currently renders the left/mono path.`
    );
  }

  // Static engineering audit: grade the CODE (real-time safety, numerical
  // robustness, smoothing, maintainability), not just the sound. Informational
  // — never touches the four headline scores, so the >=97 floor stays provable.
  const codeAudit = m.fatal ? null : auditDspCode(plugin.dspFunction, workingParams);
  if (codeAudit) {
    notes.push(formatCodeAudit(codeAudit));
  }

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
    silentOnSignals: m.silentOnSignals,
    semanticChecks: semantics.checks,
    semanticViolations: semantics.violations,
    fixes: notes.slice(),
    confidence,
    characterIndex,
    aliasingIndex,
    harsh,
    truePeakDb: Number.isFinite(truePeakDb) ? Math.round(truePeakDb * 100) / 100 : undefined,
    stereoOutput: !!m.stereoOutput,
    codeHealth: codeAudit ? codeAudit.codeHealth : undefined,
    codeFindings: codeAudit ? codeAudit.findings.map((f) => `[${f.severity}] ${f.message}`) : undefined,
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
  if (r.silentOnSignals && r.silentOnSignals.length > 0) {
    lines.push(`- ⚠️ Silent on ${r.silentOnSignals.join(", ")} material (dead on plucks/sustains, alive on the arp)`);
  }
  if (r.semanticViolations && r.semanticViolations.length > 0) {
    lines.push(`- ⚠️ Controls that don't do what their name claims: ${r.semanticViolations.join(", ")}`);
  } else if (r.semanticChecks && r.semanticChecks.length > 0) {
    lines.push(`- Semantics verified: ${r.semanticChecks.length} control(s) measurably do what their names claim`);
  }

  const repairFixes = r.fixes.filter((f) => /corrected|trim|DC/i.test(f));
  if (repairFixes.length > 0) {
    lines.push(`- Fixes applied: ${repairFixes.map((f) => f.replace(/\.$/, "")).join("; ")}`);
  }

  if (r.harsh) {
    lines.push(`- ⚠️ Aliasing/harshness: ${(r.aliasingIndex ?? 0).toFixed(2)} inharmonic on a clean tone — audible digital fizz for a processor that should stay smooth`);
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
    // iteration 0 = alternate seed builds considered BEFORE the loop ran.
    const passes = r.refinement.filter((i) => i.iteration > 0);
    const kept = r.refinement.filter((i) => i.accepted).length;
    lines.push(
      `- Perfecting loop: ${passes.length} rework ${passes.length === 1 ? "pass" : "passes"} — ${
        kept > 0 ? `kept ${kept} improvement(s)` : "no candidate beat the original (kept the first build)"
      }`
    );
    for (const it of r.refinement) {
      const tag = it.iteration === 0 ? "seed" : `loop ${it.iteration}`;
      lines.push(`  - ${tag}: ${it.action} → ${it.accepted ? `KEPT (score ${it.score})` : `discarded (score ${it.score})`}`);
    }
  }

  return lines.join("\n");
}
