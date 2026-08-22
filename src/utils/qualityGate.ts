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
 *    is ~0 in this per-sample engine). The plugin's actual per-sample CPU
 *    cost is measured separately (see measureCpuCost / CpuCost) and reported
 *    informationally -- it never touches this headline score, because
 *    wall-clock timing is noisy on a machine doing other concurrent work.
 */

import { AudioPlugin, BuildReport, PluginParameter } from "../types";
import { sanitizeDspCode } from "./healthcheckRunner";
import { PluginFamily } from "./pluginSpec";
import { UiTheme, buildUiSpec, composeTheme, orderParametersBySpec } from "./uiSpec";
import { auditDspCode, formatCodeAudit } from "./codeAudit";
import { ArchetypeId, applyArchetype, inferControlType, pickArchetype, resolveControlOverlaps, rectsOverlap } from "./guiArchetypes";
import { measureFeatureDepth } from "./featureManifest";
import { DSP_RECIPES, DspRecipe } from "./dspRecipes";
import { resolveGlowBoxShadow } from "./customSkin";
import { resolveMaterial } from "./materialVisuals";

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

function compileDspBody(dspFunction: string): ((i: number, p: any, s: any, r?: number, k?: number) => number) | null {
  try {
    const sanitized = sanitizeDspCode(dspFunction);
    // "inputR" is the OPT-IN stereo contract: mono bodies never reference it
    // and behave exactly as before; stereo bodies read it (guarded with
    // `inputR !== undefined ? inputR : inputSample`) and write their right
    // channel to state.outR each sample, returning the left. "inputKey" is
    // the OPT-IN external sidechain key, same guarded-optional shape --
    // every existing render path leaves it undefined, so a sidechain body's
    // own `inputKey !== undefined ? inputKey : inputSample` fallback makes
    // it measure as an ordinary self-detecting compressor everywhere except
    // the dedicated dual-signal test that actually supplies a key.
    return new Function("inputSample", "params", "state", "inputR", "inputKey", sanitized) as any;
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

/**
 * Mandatory final safety net. Every place a compiled per-sample DSP body's
 * return value is about to be treated as an audio sample -- here in the
 * offline gate's render path, and (mirrored by hand, since it runs in a
 * separate JS realm) in the live AudioWorklet/ScriptProcessor playback path
 * in App.tsx -- passes through this UNCONDITIONALLY, regardless of what the
 * recipe, structural composition, or LLM output did internally:
 *
 *  - NaN/Infinity -> 0. A divide-by-zero, an unstable feedback coefficient,
 *    or a structural-search combination of primitives never individually
 *    tested together must never reach a speaker as full-scale noise.
 *  - denormals (nonzero magnitude below ~1e-15) -> flushed to exactly 0.
 *    JS has no hardware FTZ/DAZ, so an unflushed denormal-producing
 *    reverb/delay tail can stall the CPU for the lifetime of the plugin.
 *  - hard-ceiling clip to +/-4.0 as an absolute last-resort backstop --
 *    comfortably above any legitimate signal (unity is +/-1.0, and the
 *    live path's own final output clip is +/-1.0) but far below anything
 *    that could be genuinely damaging.
 *
 * This is NOT a mixing/loudness decision -- it is not the true-peak/
 * loudness measurement elsewhere in this file -- and it must never fire on
 * any golden recipe or topology variant at reasonable settings (see
 * safetyNetTest.ts). If it ever does on a legitimate build, that is a bug
 * in the threshold, not a plugin to "fix".
 */
const DENORMAL_FLOOR = 1e-15;
const SAFETY_CEILING = 4.0;
export function sanitizeSample(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x !== 0 && Math.abs(x) < DENORMAL_FLOOR) return 0;
  if (x > SAFETY_CEILING) return SAFETY_CEILING;
  if (x < -SAFETY_CEILING) return -SAFETY_CEILING;
  return x;
}

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
    let raw = 0;
    try {
      raw = dspFunc(signal(i), params, state, signal(i + STEREO_SKEW));
    } catch {
      return fail();
    }
    // NaN/Infinity here is treated as an outright FAILED render (not merely
    // sanitized to 0 and continued) so this file's instability detection
    // keeps working exactly as before -- calibrateUnstableParams, the
    // unstableParams audit, and every downstream `.failed` check depend on
    // this signal to find and FIX (or flag) a broken parameter range, which
    // silently zeroing the sample and continuing would hide. Every FINITE
    // sample still passes through sanitizeSample UNCONDITIONALLY (denormal
    // flush + hard-ceiling clip) before it is used as an audio sample below
    // -- the same safety net the live playback path applies at its own
    // per-sample DSP call site.
    if (!Number.isFinite(raw)) {
      return fail();
    }
    const y = sanitizeSample(raw);
    out[i] = y;
    sumSq += y * y;
    dcSum += y;
    if (y >= 0.999 || y <= -0.999) clipCount++;

    const yr = state.outR;
    if (yr !== undefined) {
      if (!Number.isFinite(yr)) return fail();
      const yrSafe = sanitizeSample(yr);
      if (!outR) outR = new Float32Array(length);
      outR[i] = yrSafe;
      sumSqR += yrSafe * yrSafe;
      if (yrSafe >= 0.999 || yrSafe <= -0.999) clipCount++;
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
/** Canonical "measurement never ran" result -- shared by measureMusicality's
 *  own compile/render-failure paths and by runQualityGate's cheap pre-check
 *  short-circuit (quickHealthCheck below), so both produce an identically-
 *  shaped fatal MusicalityMeasurement. */
function fatalMusicalityMeasurement(evidence: string): MusicalityMeasurement {
  return {
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
  };
}

export function measureMusicality(dspFunction: string, parameters: PluginParameter[]): MusicalityMeasurement {
  const failure = fatalMusicalityMeasurement;

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

/**
 * TEMPORAL axis of character: does material appear in the OUTPUT where the
 * INPUT went silent (an echo, a reverb tail)? characterOnSignal's spectral
 * L1 is structurally blind to this -- a clean delay repeats the SAME
 * frequency content later, so a static spectral-distribution snapshot barely
 * moves even though the effect is obviously, audibly transformative. Reuses
 * the input-then-silence tail probe (tailSignalAt/TAIL_TOTAL) and
 * envelopeShape(), both already proven for reference-deviation's own
 * temporal axis (reverb tail persistence, dynamics envelope comparison).
 */
function temporalCharacterOnTail(dspFunc: (i: number, p: any, s: any, r?: number) => number, defaults: Record<string, number>): number {
  const dry = new Float32Array(TAIL_TOTAL);
  for (let i = 0; i < TAIL_TOTAL; i++) dry[i] = tailSignalAt(i);
  const wet = renderPass(dspFunc, defaults, TAIL_TOTAL, tailSignalAt);
  if (wet.failed) return 0;

  let wetEnergy = 0;
  for (let i = 0; i < wet.samples.length; i++) wetEnergy += wet.samples[i] * wet.samples[i];
  if (wetEnergy <= 1e-9) return 0; // silent output: nothing measurable, not "maximally different"

  const dryShape = envelopeShape(dry);
  const wetShape = envelopeShape(wet.samples);
  let l1 = 0;
  for (let i = 0; i < dryShape.length; i++) l1 += Math.abs(dryShape[i] - wetShape[i]);
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
  const spectralTerm = count === 0 ? 0 : sum / count;

  // Combined via MAX, not average: a plugin only needs to be characterful on
  // ONE axis to earn full credit -- a filter/distortion via spectral shape, a
  // delay/reverb via temporal structure, a compressor via level-dependent
  // gain. Averaging would unfairly drag down a plugin that legitimately
  // excels at just one (a great delay's spectral term stays near zero by
  // nature; that must not halve its character score).
  //
  // Short-circuit when spectral has already nearly saturated: MAX cannot be
  // raised further by anything else, so the two extra renders below (a
  // ~31k-sample tail probe, two ~22k-sample level probes) would be pure
  // waste. This is called on every candidate the refinement loop and
  // best-of-N produce, so avoiding unreachable work here compounds. Set
  // near the ceiling deliberately -- most real builds (0.01-0.15 typical
  // spectral range measured across this session's generated plugins) never
  // approach it, so this only skips genuinely pathological/extreme cases,
  // never a build that could actually benefit from the other axes.
  if (spectralTerm > 0.95) return spectralTerm;

  const temporalTerm = temporalCharacterOnTail(dspFunc, defaults);
  const dynamicsTerm = dynamicsCharacterOnLevel(dspFunc, defaults);
  return Math.max(spectralTerm, temporalTerm, dynamicsTerm);
}

/* ------------------------------------------------------------------ */
/* Reference deviation: does this behave like a KNOWN-GOOD family member? */
/* ------------------------------------------------------------------ */

/**
 * The single, unambiguous "the" golden reference for a family -- mirrors
 * dspRecipes.ts's (private, unexported) FAMILY_TO_RECIPES mapping, kept in
 * sync by hand since this module does not own dspRecipes.ts. Composite
 * families (multiband_saturator, hybrid_other, utility) have no ONE
 * single-stage reference behavior to be "like", so they are deliberately
 * absent here -- this measurement returns null rather than compare a
 * multi-stage build against an arbitrary single-stage recipe.
 */
const REFERENCE_RECIPE_ID_FOR_FAMILY: Partial<Record<PluginFamily, string>> = {
  eq: "eq",
  filter: "filter",
  distortion: "distortion",
  saturator: "distortion",
  amp_sim: "distortion",
  delay: "delay",
  reverb: "reverb",
  modulation: "modulation",
  dynamics: "dynamics",
  sampler: "sampler",
  pitch: "pitch",
  synthesizer: "synth",
};

function goldenRecipeFor(family: PluginFamily | null | undefined): DspRecipe | null {
  if (!family) return null;
  const id = REFERENCE_RECIPE_ID_FOR_FAMILY[family];
  if (!id) return null;
  return DSP_RECIPES.find((r) => r.id === id) ?? null;
}

export interface ReferenceDeviation {
  /** Which golden recipe (dspRecipes.ts id) this candidate was compared against. */
  referenceId: string;
  /** 0..2: combined distance between the candidate's and the reference's
   *  measured RESPONSE on the same probe signals, each rendered at its own
   *  default settings (0 = matches the reference's shape, 2 = the
   *  theoretical max). Two components, averaged: spectral energy
   *  distribution on a broadband probe (catches a filter/EQ/distortion that
   *  doesn't reshape the spectrum the way its family does) and envelope
   *  SHAPE over time on an input-then-silence probe (catches a
   *  compressor/reverb/delay that doesn't reshape dynamics or ring on the
   *  way its family does -- spectral shape alone is nearly blind to this).
   *  NOT a quality score -- a novel, legitimately better design SHOULD be
   *  free to diverge from one specific reference; this is context, not a
   *  correctness verdict. */
  deviation: number;
  /** 0-100 informational score: 100 = closely tracks how a proven member of
   *  this family responds to the same signals; low = shares essentially
   *  nothing in common with it structurally -- a strong "this may be
   *  wired wrong at a level no single-parameter check would name" signal. */
  score: number;
  evidence: string;
}

/** Same broadband probe the brightness semantic checks use -- meaningful
 *  even for generator families (synth/sampler) that ignore their input
 *  entirely: what's compared there is each build's own resulting timbre. */
const REF_DEVIATION_WINDOW = CROSS_SIGNAL_WINDOW;
/** Envelope window for the temporal-shape comparison -- coarse enough to be
 *  stable, fine enough to resolve a compressor's gain-reduction shape and a
 *  reverb's decay against the ~0.7s tail probe (TAIL_TOTAL). */
const REF_DEVIATION_ENV_WIN = 512;
/** Deviation at/above this reads as "shares essentially nothing" -> score 0.
 *  Calibrated (see referenceDeviationTest.ts) so every legitimate ALTERNATE
 *  topology already shipping in this project's bank -- a different but
 *  equally valid engineering choice for the same family -- lands
 *  comfortably under it, while an inert/near-passthrough counterpart clears
 *  it decisively; a number only that honest-vs-broken gap can calibrate,
 *  not one invented in the abstract.
 */
const REF_DEVIATION_CEIL = 1.0;

/** Normalized (sums to 1, or all-zero when silent) RMS-envelope trajectory
 *  over the tail probe -- the SHAPE of energy over time, independent of
 *  absolute loudness (which output trim already corrects elsewhere and
 *  isn't the point of this comparison). */
function envelopeShape(samples: Float32Array): number[] {
  const raw = envelopeSeries(samples, REF_DEVIATION_ENV_WIN);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 1e-9) return raw.map(() => 0);
  return raw.map((v) => v / sum);
}

/** How much louder material is held down relative to quiet material, in dB
 *  (gainAtLevel's own convention: positive = compresses). A STATIONARY probe
 *  -- spectral shape or a single-level envelope -- cannot see this at all
 *  (fitnessDynamics needs the same two-level trick for exactly this reason):
 *  a compressor and a passthrough can look identical on a probe that never
 *  varies level. Null for either build means "not comparable on this axis",
 *  not "identical" -- callers must treat it as excluded, not zero. */
function levelGainDelta(dspFunc: (i: number, p: any, s: any, r?: number) => number, params: Record<string, number>): number | null {
  const quiet = gainAtLevel(dspFunc, params, 0.1);
  const loud = gainAtLevel(dspFunc, params, 1.6);
  if (quiet === null || loud === null) return null;
  return quiet - loud;
}

// Character-only probe for the dynamics axis: deliberately NOT gainAtLevel
// (that stays exactly as-is for fitnessDynamics/referenceDeviation, which
// have their own precision requirements and are called far less often).
// Unlike a delay/reverb tail -- inherently hundreds of ms because that is
// how long an audible echo or decay actually takes, and NOT safe to shrink
// (a realistic 350ms default delay time sits almost exactly at this
// project's tail-probe boundary; shrinking it would break the temporal-axis
// fix above for realistic delay times) -- a compressor's envelope settles
// in tens of ms by construction: this project's own recipes cap attack at
// 30ms. A much shorter window is genuinely safe here, PROVIDED the probe
// itself is steady rather than periodic -- arpAt changes notes every ~286ms,
// so a short window risks landing mid-transition; sustainAt is a single
// continuous tone with no bar changes to land badly on.
const CHARACTER_LEVEL_WINDOW = 6615; // 150ms: 5x the slowest attack this project's recipes allow
function quickGainAtLevel(dspFunc: (i: number, p: any, s: any, r?: number) => number, params: Record<string, number>, scale: number): number | null {
  const sig = (i: number) => sustainAt(i) * scale;
  let inSq = 0;
  for (let i = 0; i < CHARACTER_LEVEL_WINDOW; i++) inSq += sig(i) * sig(i);
  const inRms = Math.sqrt(inSq / CHARACTER_LEVEL_WINDOW);
  if (inRms < 1e-6) return null;
  const out = renderPass(dspFunc, params, CHARACTER_LEVEL_WINDOW, sig);
  if (out.failed || out.rms < 1e-7) return null;
  return 20 * Math.log10(out.rms / inRms);
}

/**
 * DYNAMICS axis of character: does louder material get held down relative
 * to quieter material? Neither the spectral nor temporal axis above can see
 * this -- both compare a STATIONARY probe's shape, and a compressor vs. a
 * passthrough render near-identically when the input level never varies
 * (the exact reason fitnessDynamics needs the same two-level trick). Same
 * 8dB reference point fitnessDynamics already uses for "definitively
 * working compressor" -- one calibration constant for one underlying
 * signal, not two independently-guessed numbers for the same thing; only
 * the PROBE differs (quickGainAtLevel, ~1/7th the render cost), not the
 * calibration.
 */
function dynamicsCharacterOnLevel(dspFunc: (i: number, p: any, s: any, r?: number) => number, defaults: Record<string, number>): number {
  const quiet = quickGainAtLevel(dspFunc, defaults, 0.1);
  const loud = quickGainAtLevel(dspFunc, defaults, 1.6);
  if (quiet === null || loud === null) return 0; // not comparable on this axis, not "no character"
  const delta = quiet - loud;
  return Math.max(0, Math.min(1, delta / 8));
}

/** 2nd+3rd harmonic content on a clean tone -- distortion's defining trait,
 *  which the generic spectral/envelope terms measure only weakly (clipping a
 *  BROADBAND noise probe barely moves its aggregate spectral distribution,
 *  since the added harmonics are themselves broadband-ish). Reuses
 *  harmonicShare/cleanToneAt, already proven decisive in functionalFitnessTest. */
function harmonicGenerationFor(dspFunc: (i: number, p: any, s: any, r?: number) => number, params: Record<string, number>): number | null {
  const out = renderPass(dspFunc, params, 8192, cleanToneAt);
  if (out.failed || out.rms < 1e-5) return null;
  return harmonicShare(out.samples);
}

/** Tail energy relative to the active-region level -- reverb's defining
 *  trait (does it ring on?), which the coarse envelope-shape term alone
 *  under-weights against a strong plate/FDN's very different overall decay
 *  curve shape. `samples` must already be a render on the tail probe
 *  (input then silence) -- reuses whatever the caller already rendered. */
function tailPersistence(samples: Float32Array): number {
  let activeSq = 0;
  const activeLen = Math.min(TAIL_INPUT_END, samples.length);
  for (let i = 0; i < activeLen; i++) activeSq += samples[i] * samples[i];
  const activeRms = Math.sqrt(activeSq / Math.max(1, activeLen));
  if (activeRms < 1e-6) return 0;
  return tailRms(samples) / activeRms;
}

/** Families whose defining behavior is harmonic generation -- amp_sim is a
 *  gain-staged preamp drive by construction (see dspRecipes.ts's own
 *  amp_sim -> distortion routing rationale), so it shares the same axis. */
const HARMONIC_DEFINED_FAMILIES = new Set<PluginFamily>(["distortion", "saturator", "amp_sim"]);

/** Families whose candidates are GENERATORS, not processors -- they ignore
 *  the probe signal entirely, so there is no shared input constraining their
 *  spectral shape the way there is for every effects family (a reverb, a
 *  compressor, a distortion all reshape the SAME broadband noise probe, so
 *  "does it reshape a common input similarly" is a meaningful comparison).
 *  A synth's entire spectral identity comes from its synthesis METHOD, and
 *  multiple correct methods (subtractive, wavetable, FM, ...) are EXPECTED
 *  to sound nothing alike spectrally -- that variety is the point of having
 *  more than one. Measured directly: synth_wavetable (morph 0.5, tables up
 *  to the 16th harmonic) scored spectral deviation 1.12, synth_fm (2.5 rad
 *  index) scored 1.41 -- both past this function's own "shares essentially
 *  nothing" ceiling of 1.0 -- against the golden reference's simple
 *  3-harmonic detuned pad, despite both being correctly built, gate-verified
 *  voices (fitnessSynth: 100 for both). The envelope-shape term still
 *  applies -- a generator's own onset behavior is a real, comparable design
 *  property -- only the spectral axis is excluded. */
const GENERATOR_FAMILIES = new Set<PluginFamily>(["synthesizer"]);

/**
 * Run a candidate and its family's GOLDEN RECIPE through the SAME probe
 * signals (each at its own default settings, since that is the plugin's
 * defining behavior) and compare the shape of their responses -- spectrally
 * (a broadband probe) and temporally (an input-then-silence probe, so
 * dynamics/decay families are measured on the axis that actually defines
 * them, not just the ones that happen to reshape a static spectrum). Reuses
 * machinery measureCharacterIndex/fitnessModulation/fitnessReverb already
 * verified, rather than inventing new signal-processing from scratch.
 * Purely informational -- feeds refinementScore(), never the four headline
 * dimensions.
 */
// Golden recipes are static -- their reference renders never change across
// calls. measureReferenceDeviation runs once per candidate per gate pass
// (now on every structural-search iteration too), so re-rendering the SAME
// golden recipe's spectral + envelope probes from scratch every single time
// was pure waste. Cached per family, populated on first use.
const goldenReferenceRenderCache = new Map<
  PluginFamily,
  {
    refFunc: NonNullable<ReturnType<typeof compileDspBody>>;
    refParams: ReturnType<typeof defaultParamsMap>;
    refSpec: ReturnType<typeof renderPass>;
    refEnv: ReturnType<typeof renderPass>;
  } | null
>();

function getGoldenReferenceRenders(family: PluginFamily) {
  const cached = goldenReferenceRenderCache.get(family);
  if (cached !== undefined) return cached;
  const golden = goldenRecipeFor(family);
  const refFunc = golden ? compileDspBody(golden.body) : null;
  let result: {
    refFunc: NonNullable<typeof refFunc>;
    refParams: ReturnType<typeof defaultParamsMap>;
    refSpec: ReturnType<typeof renderPass>;
    refEnv: ReturnType<typeof renderPass>;
  } | null = null;
  if (golden && refFunc) {
    const refParams = defaultParamsMap(golden.parameters as PluginParameter[]);
    const refSpec = renderPass(refFunc, refParams, REF_DEVIATION_WINDOW, noiseProbeAt);
    const refEnv = renderPass(refFunc, refParams, TAIL_TOTAL, tailSignalAt);
    if (!refSpec.failed && !refEnv.failed) result = { refFunc, refParams, refSpec, refEnv };
  }
  goldenReferenceRenderCache.set(family, result);
  return result;
}

export function measureReferenceDeviation(
  dspFunction: string,
  parameters: PluginParameter[],
  family: PluginFamily | null | undefined
): ReferenceDeviation | null {
  const golden = goldenRecipeFor(family);
  if (!golden) return null;
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return null;
  const cachedRef = getGoldenReferenceRenders(family as PluginFamily);
  if (!cachedRef) return null; // golden recipes always compile/render; defensive only
  const { refFunc, refParams, refSpec, refEnv } = cachedRef;
  const candParams = defaultParamsMap(parameters);

  const candSpec = renderPass(dspFunc, candParams, REF_DEVIATION_WINDOW, noiseProbeAt);
  const candEnv = renderPass(dspFunc, candParams, TAIL_TOTAL, tailSignalAt);
  if (candSpec.failed || candEnv.failed) return null;

  let candEnergy = 0;
  for (let i = 0; i < candSpec.samples.length; i++) candEnergy += candSpec.samples[i] * candSpec.samples[i];
  let refEnergy = 0;
  for (let i = 0; i < refSpec.samples.length; i++) refEnergy += refSpec.samples[i] * refSpec.samples[i];

  // Both silent on the spectral probe -- there is no shape to compare, and
  // calling two flatlines "a match" would be a meaningless claim either way.
  if (candEnergy <= 1e-9 && refEnergy <= 1e-9) {
    return {
      referenceId: golden.id,
      deviation: 0,
      score: 100,
      evidence: `both this build and the ${golden.id} reference render silent on the probe signal`,
    };
  }
  // One is silent and the other isn't -- the starkest possible mismatch;
  // score at the floor without needing the shape math at all.
  if (candEnergy <= 1e-9 || refEnergy <= 1e-9) {
    return {
      referenceId: golden.id,
      deviation: 2,
      score: 0,
      evidence: `this build is ${candEnergy <= 1e-9 ? "silent" : "audible"} on the probe signal while the family's ${golden.id} reference is ${refEnergy <= 1e-9 ? "silent" : "audible"}`,
    };
  }

  const measureSpectral = !family || !GENERATOR_FAMILIES.has(family);
  let spectralL1: number | null = null;
  if (measureSpectral) {
    const candDist = spectralBandDistribution(candSpec.samples, SAMPLE_RATE);
    const refDist = spectralBandDistribution(refSpec.samples, SAMPLE_RATE);
    spectralL1 = 0;
    for (let i = 0; i < candDist.length; i++) spectralL1 += Math.abs(candDist[i] - refDist[i]);
  }

  const candShape = envelopeShape(candEnv.samples);
  const refShape = envelopeShape(refEnv.samples);
  let envelopeL1 = 0;
  const envLen = Math.min(candShape.length, refShape.length);
  for (let i = 0; i < envLen; i++) envelopeL1 += Math.abs(candShape[i] - refShape[i]);

  // Level-dependent gain (compression behavior): a STATIONARY probe -- the
  // spectral and envelope terms above -- is structurally blind to this (a
  // compressor and a straight passthrough can render near-identically on a
  // probe whose level never changes). Restricted to "dynamics" ON PURPOSE:
  // it is the one family whose whole job IS a level-dependent gain response,
  // so a big candidate-vs-reference gap there is a genuine red flag. For
  // every other family it would be actively misleading rather than neutral
  // -- e.g. a fuzz distortion's dramatically level-sensitive gain curve
  // (measured: ~1.25 vs a soft-clip reference) is exactly what gives fuzz
  // its character, not a defect, and this term would punish it for being a
  // good fuzz. Excluded (not zeroed) when either build can't be measured on
  // this axis at all, so silence there never masquerades as a match.
  const candGainDelta = family === "dynamics" ? levelGainDelta(dspFunc, candParams) : null;
  const refGainDelta = family === "dynamics" ? levelGainDelta(refFunc, refParams) : null;
  let levelDev: number | null = null;
  if (candGainDelta !== null && refGainDelta !== null) {
    levelDev = Math.max(0, Math.min(2, Math.abs(candGainDelta - refGainDelta) / Math.max(4, Math.abs(refGainDelta))));
  }

  // Harmonic generation (distortion/saturator/amp_sim's defining trait).
  const candHarm = family && HARMONIC_DEFINED_FAMILIES.has(family) ? harmonicGenerationFor(dspFunc, candParams) : null;
  const refHarm = family && HARMONIC_DEFINED_FAMILIES.has(family) ? harmonicGenerationFor(refFunc, refParams) : null;
  let harmDev: number | null = null;
  if (candHarm !== null && refHarm !== null) {
    harmDev = Math.max(0, Math.min(2, Math.abs(candHarm - refHarm) / Math.max(0.02, refHarm)));
  }

  // Tail persistence (reverb's defining trait: does it ring on?). Reuses the
  // tail-probe renders already taken for the envelope-shape term above.
  const tailDev =
    family === "reverb"
      ? Math.max(0, Math.min(2, Math.abs(tailPersistence(candEnv.samples) - tailPersistence(refEnv.samples)) / Math.max(0.05, tailPersistence(refEnv.samples))))
      : null;

  const terms = [
    ...(spectralL1 !== null ? [spectralL1] : []),
    envelopeL1,
    ...(levelDev !== null ? [levelDev] : []),
    ...(harmDev !== null ? [harmDev] : []),
    ...(tailDev !== null ? [tailDev] : []),
  ];
  const deviation = Math.max(0, Math.min(2, terms.reduce((a, b) => a + b, 0) / terms.length));
  const score = Math.max(0, Math.min(100, Math.round((1 - deviation / REF_DEVIATION_CEIL) * 100)));
  const extraLabels = [levelDev !== null ? "level-dependent gain" : "", harmDev !== null ? "harmonic generation" : "", tailDev !== null ? "tail persistence" : ""].filter(Boolean);
  return {
    referenceId: golden.id,
    deviation: Math.round(deviation * 1000) / 1000,
    score,
    evidence:
      `response shape (${spectralL1 !== null ? "spectrum + " : ""}envelope-over-time${extraLabels.length ? " + " + extraLabels.join(" + ") : ""}) differs from the family's "${golden.id}" reference by ${deviation.toFixed(2)} ` +
      `(0 = matches, ${REF_DEVIATION_CEIL}+ = shares essentially nothing; ${spectralL1 !== null ? `spectral ${spectralL1.toFixed(2)}, ` : ""}envelope ${envelopeL1.toFixed(2)}` +
      `${levelDev !== null ? `, level-gain ${levelDev.toFixed(2)}` : ""}${harmDev !== null ? `, harmonic ${harmDev.toFixed(2)}` : ""}${tailDev !== null ? `, tail ${tailDev.toFixed(2)}` : ""})`,
  };
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

/* ------------------------------------------------------------------ */
/* Functional fitness: does it do its JOB, and how well?               */
/* ------------------------------------------------------------------ */

/**
 * The four headline scores prove a build is CORRECT (audible, stable, honest
 * controls). They saturate: ~98% of clean candidates hit a perfect 100, and
 * competing designs land within ~2 points of each other out of ~800. That
 * leaves the perfecting loop, best-of-N, and the fusion ensemble with no
 * gradient to climb — you cannot improve what you cannot measure.
 *
 * Functional fitness measures the thing the headline scores can't: whether
 * the plugin actually performs its family's JOB, on a continuous scale.
 * A compressor that compresses 8 dB beats one that compresses 0.5 dB; a
 * delay whose echo lands at the time its knob claims beats one that's 40%
 * off; a filter whose -3 dB corner sits where "Cutoff" says beats one that
 * lies by two octaves.
 *
 * INFORMATIONAL by design: it feeds the refinement/selection score and the
 * build report, but never the four headline dimensions — so the >= 97 floor
 * stays exactly as provable as before.
 */
export interface FunctionalFitness {
  /** 0-100: how well this build performs its family's core job. */
  score: number;
  /** Short label of what was measured, e.g. "gain reduction". */
  metric: string;
  /** The measured evidence, in plain words with real numbers. */
  evidence: string;
  /**
   * The measurement as a GRADIENT rather than a grade.
   *
   * Several of these tests produce a signed, multiplicative error against a
   * knob's own label -- an echo landing at 175 ms with Time set to 350, a
   * -3 dB corner an octave above where Cutoff says. That error mechanically
   * implies its own correction: multiply every read of `paramId` inside the
   * DSP by `factor` and the knob starts telling the truth.
   *
   * Emitted only when the deviation is far past anything an honest design
   * produces (see the CALIBRATE_* thresholds), and acted on only by
   * calibrateParamScaling(), which re-measures and keeps the rewrite ONLY
   * when it provably helped -- exactly the contract calibrateUnstableParams
   * follows for range fixes.
   */
  calibration?: { paramId: string; factor: number };
}

/**
 * How far past honest a measurement must land before it is allowed to propose
 * a mechanical repair. Deliberately well outside the spread of the verified
 * golden recipes and topologies (measured, see calibrationRepairTest.ts), so
 * the repair pass costs nothing on a healthy build and only ever engages on a
 * knob that is genuinely lying about itself.
 */
/** Delay echo timing: |measured - claimed| / claimed. Honest designs < 0.02. */
const CALIBRATE_DELAY_ERR = 0.08;
/** Filter corner, in octaves off nominal. Honest (even resonant) designs < 0.35. */
const CALIBRATE_FILTER_OCTAVES = 0.6;
/** LFO rate: |measured - claimed| / claimed, after the 1x/2x convention fold. */
const CALIBRATE_RATE_ERR = 0.25;
/** Oscillator pitch, in octave-folded semitones off the Pitch knob. */
const CALIBRATE_PITCH_SEMIS = 0.6;

/**
 * Render a probe scaled to a target peak, returning output/input gain in dB.
 *
 * Uses noiseProbeAt, NOT arpAt -- deliberately. arpAt is built entirely from
 * Math.sin() fundamentals capped at 784 Hz with no harmonics, so it has
 * essentially zero energy anywhere near a sidechain-filtered detector's
 * passband (a de-esser listens ~1.5-8 kHz). Measured directly: comp_deesser
 * showed only 0.30 dB of quiet-vs-loud gain change on arpAt (reading as
 * "barely compressing," nearly indistinguishable from a broken passthrough)
 * vs. 4.84 dB on noiseProbeAt's flat broadband spectrum -- the same probe
 * this function's own spectral-deviation sibling term already uses, so a
 * legitimate narrowband compressor is finally visible to the ONE axis whose
 * entire job is proving level-dependent gain exists. Every broadband topology
 * (comp_ff_rms, comp_opto, comp_fet_1176, comp_lookahead_master, ...) shifts
 * by only 2-12% under the swap -- comfortably inside every existing
 * threshold -- while an inert passthrough still reads exactly 0 dB on either
 * probe, since "never compresses" doesn't depend on what the probe sounds
 * like.
 */
function gainAtLevel(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  scale: number
): number | null {
  const N = 22050;
  const sig = (i: number) => noiseProbeAt(i) * scale;
  let inSq = 0;
  for (let i = 0; i < N; i++) inSq += sig(i) * sig(i);
  const inRms = Math.sqrt(inSq / N);
  if (inRms < 1e-6) return null;
  const out = renderPass(dspFunc, params, N, sig);
  if (out.failed || out.rms < 1e-7) return null;
  return 20 * Math.log10(out.rms / inRms);
}

/** Dynamics: a compressor applies LESS gain to loud material than to quiet.
 *  That difference IS compression, measured in dB. */
function fitnessDynamics(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>
): FunctionalFitness | null {
  const quiet = gainAtLevel(dspFunc, params, 0.1);
  const loud = gainAtLevel(dspFunc, params, 1.6);
  if (quiet === null || loud === null) return null;
  const grDb = quiet - loud; // positive = louder material held down
  // 0 dB = not compressing at all; 8 dB of program-dependent reduction is a
  // definitively working compressor.
  const score = Math.max(0, Math.min(100, Math.round((grDb / 8) * 100)));
  return {
    score,
    metric: "gain reduction",
    evidence: `holds loud material ${grDb.toFixed(1)} dB further down than quiet material (measured across a 24 dB input range)`,
  };
}

/** Reverb: how long does the tail actually ring? A "reverb" whose energy is
 *  gone in 40 ms is not a reverb, however clean it measures. */
function fitnessReverb(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>
): FunctionalFitness | null {
  const out = renderPass(dspFunc, params, TAIL_TOTAL, tailSignalAt);
  if (out.failed) return null;
  const WIN = 2048;
  const level = (start: number): number => {
    let sq = 0;
    let n = 0;
    for (let i = start; i < Math.min(start + WIN, out.samples.length); i++) {
      sq += out.samples[i] * out.samples[i];
      n++;
    }
    return n > 0 ? Math.sqrt(sq / n) : 0;
  };
  const l0 = level(TAIL_INPUT_END);
  if (l0 < 1e-5) return { score: 0, metric: "decay time", evidence: "no audible tail after the input stops — this does not ring like a space" };
  const target = l0 / 31.62; // -30 dB
  let decaySamples = out.samples.length - TAIL_INPUT_END;
  for (let s = TAIL_INPUT_END; s + WIN < out.samples.length; s += WIN) {
    if (level(s) <= target) {
      decaySamples = s - TAIL_INPUT_END;
      break;
    }
  }
  const rt60 = (decaySamples / SAMPLE_RATE) * 2; // -30 dB measured, extrapolated
  // 0.6 s+ reads as a real space; below ~0.15 s it is an ambience blip.
  const score = Math.max(0, Math.min(100, Math.round((rt60 / 0.6) * 100)));
  return {
    score,
    metric: "decay time",
    evidence: `tail decays over ~${rt60.toFixed(2)} s (RT60 extrapolated from the measured -30 dB point)`,
  };
}

/** Delay: is the echo where the Time knob CLAIMS it is? A calibration check
 *  the audibility and semantic tests can't catch. */
function fitnessDelay(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const timeParam = parameters.find((p) => /^(time|delay|delaytime)$/i.test(p.id));
  if (!timeParam) return null;
  const timeMs = params[timeParam.id];
  if (!Number.isFinite(timeMs) || timeMs <= 0) return null;
  const expected = Math.round((timeMs / 1000) * SAMPLE_RATE);
  const N = Math.min(88200, expected * 3 + 4410);
  // A single short click, then silence: the echo is whatever comes back.
  const click = (i: number) => (i < 64 ? Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE) * 0.8 : 0);
  const out = renderPass(dspFunc, params, N, click);
  if (out.failed) return null;
  // Find the loudest peak well after the direct sound.
  let peakIdx = -1;
  let peak = 0;
  for (let i = 512; i < N; i++) {
    const a = Math.abs(out.samples[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
  }
  if (peak < 1e-4 || peakIdx < 0) {
    return { score: 0, metric: "echo timing", evidence: "no distinct echo returned after the input click" };
  }
  const errRatio = Math.abs(peakIdx - expected) / expected;
  const score = Math.max(0, Math.min(100, Math.round((1 - errRatio / 0.25) * 100)));
  return {
    score,
    metric: "echo timing",
    evidence: `echo lands at ${((peakIdx / SAMPLE_RATE) * 1000).toFixed(0)} ms with Time set to ${timeMs.toFixed(0)} ms (${(errRatio * 100).toFixed(1)}% off)`,
    // Delay length is linear in the Time value on every sane implementation,
    // so the ratio of wanted-to-measured delay IS the correction factor.
    calibration:
      errRatio > CALIBRATE_DELAY_ERR ? { paramId: timeParam.id, factor: expected / peakIdx } : undefined,
  };
}

/** Filter/EQ: does the -3 dB corner sit where "Cutoff" says it does? */
function fitnessFilter(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const cutoffParam = parameters.find((p) => /^(cutoff|freq|frequency)$/i.test(p.id));
  if (!cutoffParam) return null;
  const cutoff = params[cutoffParam.id];
  if (!Number.isFinite(cutoff) || cutoff < 40) return null;

  // Measure the SETTLED response: the filter's startup transient (and any
  // per-sample coefficient smoothing) otherwise smears the estimate by about
  // a third-octave, which reads as a miscalibrated knob on an honest filter.
  const SETTLE = 4096;
  const N = 12288;
  // goertzelPower snaps its analysis to the nearest DFT bin, so a probe tone
  // that is NOT bin-centered leaks energy and reads quieter than it is --
  // which understates the passband reference and drags the apparent corner a
  // full grid step high. Generate and measure on exact bin centers.
  const binHz = SAMPLE_RATE / (N - SETTLE);
  const snap = (hz: number) => Math.max(binHz, Math.round(hz / binHz) * binHz);
  const responseAt = (hzRaw: number): number => {
    const hz = snap(hzRaw);
    const sig = (i: number) => Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 0.4;
    const out = renderPass(dspFunc, params, N, sig);
    if (out.failed) return 0;
    return Math.sqrt(goertzelPower(out.samples.slice(SETTLE), hz, SAMPLE_RATE));
  };
  // Passband reference well below the corner, then a sweep upward.
  const refFreq = Math.max(40, cutoff / 8);
  const refMult = refFreq / cutoff;
  const ref = responseAt(refFreq);
  if (ref < 1e-5) return null;
  // Third-octave probe grid: a coarse octave grid would report a resonant
  // filter (whose -3 dB point legitimately sits above nominal) as wildly
  // miscalibrated. Resolution here is the difference between measuring the
  // filter and measuring the grid.
  const probes = [0.5, 0.63, 0.8, 1, 1.26, 1.6, 2, 2.5, 3.2, 4].map((m) => ({ mult: m, hz: cutoff * m }));
  const points: { mult: number; resp: number }[] = [{ mult: refMult, resp: ref }];
  for (const p of probes) {
    if (p.hz > 18000) break;
    points.push({ mult: p.mult, resp: responseAt(p.hz) });
  }
  // A resonant filter's passband gain is its PEAK near the corner, not the
  // flat low-frequency reference -- measuring -3 dB down from that peak
  // (the standard definition of a resonant filter's corner) is the
  // difference between crediting real resonance and mistaking it for a
  // miscalibrated knob.
  let peak = ref;
  for (const pt of points) {
    if (pt.resp > peak) peak = pt.resp;
  }
  const dbAt = (resp: number) => 20 * Math.log10(Math.max(1e-9, resp / peak));

  // Walk the (log-frequency, dB) curve and interpolate the exact -3 dB
  // crossing -- snapping to the first probe past threshold overstates the
  // error by up to a full grid step on this third-octave probe spacing.
  let cornerMult: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const prevDb = dbAt(prev.resp);
    const curDb = dbAt(cur.resp);
    if (prevDb > -3 && curDb <= -3) {
      const lx = Math.log2(prev.mult);
      const lc = Math.log2(cur.mult);
      const t = (-3 - prevDb) / (curDb - prevDb);
      cornerMult = Math.pow(2, lx + t * (lc - lx));
      break;
    }
  }
  if (cornerMult === null) {
    return { score: 0, metric: "cutoff calibration", evidence: `no -3 dB rolloff found within 4x of the ${cutoff.toFixed(0)} Hz Cutoff setting — the knob's label does not match where it filters` };
  }
  // 2 octaves of error = 0. Resonance (credited above via the peak
  // reference) still legitimately shifts a real filter's half-power point up
  // by a fraction of an octave, so an honest design -- resonant or not --
  // lands comfortably high while a knob that ignores its own value still
  // falls to the floor.
  const octavesOff = Math.abs(Math.log2(cornerMult));
  const score = Math.max(0, Math.min(100, Math.round((1 - octavesOff / 2) * 100)));
  const peakDb = 20 * Math.log10(peak / ref);
  const resonanceNote = peakDb > 1 ? ` (resonance lifts the passband ~${peakDb.toFixed(1)} dB near the corner)` : "";
  return {
    score,
    metric: "cutoff calibration",
    evidence: `-3 dB corner measured at ~${(cutoff * cornerMult).toFixed(0)} Hz with Cutoff set to ${cutoff.toFixed(0)} Hz (${octavesOff.toFixed(1)} octaves off)${resonanceNote}`,
    // The corner sits at cutoff * cornerMult; dividing the knob's value by
    // cornerMult moves it onto the label. Only proposed past the point where
    // no honest topology in the bank lands.
    calibration:
      octavesOff > CALIBRATE_FILTER_OCTAVES ? { paramId: cutoffParam.id, factor: 1 / cornerMult } : undefined,
  };
}

/** Multi-band EQ: does each band's dB knob actually move ITS OWN region by
 *  roughly the labeled amount? A gain knob wired to nothing (or to the
 *  wrong band) still passes every correctness check -- this is the only
 *  place that measures the knob does its job. */
function fitnessEq(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const midFreqParam = parameters.find((p) => /^mid.?freq$/i.test(p.id));
  const midFreq = midFreqParam ? params[midFreqParam.id] : 1200;
  const bandProbes: { id: string; hz: number }[] = [];
  if (parameters.some((p) => p.id === "low")) bandProbes.push({ id: "low", hz: 150 });
  if (parameters.some((p) => p.id === "mid")) bandProbes.push({ id: "mid", hz: Math.max(200, midFreq) });
  if (parameters.some((p) => p.id === "high")) bandProbes.push({ id: "high", hz: Math.min(12000, Math.max(3000, midFreq * 4)) });
  if (bandProbes.length === 0) return null;

  const N = 8192;
  const SETTLE = 2048;
  const respAt = (testParams: Record<string, number>, hz: number): number => {
    const sig = (i: number) => Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * 0.4;
    const out = renderPass(dspFunc, testParams, N, sig);
    if (out.failed) return NaN;
    return Math.sqrt(goertzelPower(out.samples.slice(SETTLE), hz, SAMPLE_RATE));
  };

  // Flatten every band to 0 dB as the shared reference, then move ONE band
  // at a time -- isolates each knob's real effect from the others' defaults.
  const flat: Record<string, number> = { ...params };
  for (const b of bandProbes) flat[b.id] = 0;

  const TEST_DB = 6;
  let totalErr = 0;
  let n = 0;
  const parts: string[] = [];
  for (const band of bandProbes) {
    const ref = respAt(flat, band.hz);
    if (!Number.isFinite(ref) || ref < 1e-6) continue;
    const boostResp = respAt({ ...flat, [band.id]: TEST_DB }, band.hz);
    const cutResp = respAt({ ...flat, [band.id]: -TEST_DB }, band.hz);
    if (!Number.isFinite(boostResp) || !Number.isFinite(cutResp)) continue;
    const boostDb = 20 * Math.log10(Math.max(1e-6, boostResp / ref));
    const cutDb = 20 * Math.log10(Math.max(1e-6, cutResp / ref));
    totalErr += Math.abs(boostDb - TEST_DB) + Math.abs(cutDb + TEST_DB);
    n += 2;
    parts.push(`${band.id} @${band.hz.toFixed(0)}Hz: +${TEST_DB}dB measured ${boostDb.toFixed(1)}dB, -${TEST_DB}dB measured ${cutDb.toFixed(1)}dB`);
  }
  if (n === 0) return { score: 0, metric: "band gain accuracy", evidence: "every band is silent -- the EQ has no measurable passband to move" };
  const avgErr = totalErr / n;
  // 6 dB of average error = 0: a band that measures roughly HALF its
  // labeled move (common with gentle crossovers and a safety soft-clip)
  // still scores in the honest-but-imperfect range; a band wired to
  // nothing measures the full 6 dB of error and falls to the floor.
  const score = Math.max(0, Math.min(100, Math.round((1 - avgErr / TEST_DB) * 100)));
  return {
    score,
    metric: "band gain accuracy",
    evidence: parts.join("; "),
  };
}

/**
 * Autocorrelation pitch detector with parabolic peak interpolation — the
 * sub-lag precision is what makes a cents-accurate reading possible (a whole
 * semitone is only ~6% of the lag at 440 Hz, so integer lags are far too
 * coarse to judge tuning).
 */
function detectPitchHz(samples: Float32Array, minHz = 60, maxHz = 1600): number | null {
  const minLag = Math.max(2, Math.floor(SAMPLE_RATE / maxHz));
  const maxLag = Math.min(samples.length - 2, Math.floor(SAMPLE_RATE / minHz));
  if (maxLag <= minLag) return null;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (energy / samples.length < 1e-8) return null;

  const corr = new Float64Array(maxLag + 2);
  let bestLag = -1;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = samples.length - lag;
    for (let i = 0; i < n; i++) sum += samples[i] * samples[i + lag];
    const c = sum / n;
    corr[lag] = c;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  if (bestLag <= minLag || bestLag >= maxLag || best <= 0) return null;
  const a = corr[bestLag - 1];
  const b = corr[bestLag];
  const c2 = corr[bestLag + 1];
  const denom = a - 2 * b + c2;
  const delta = Math.abs(denom) > 1e-12 ? (0.5 * (a - c2)) / denom : 0;
  const refined = bestLag + Math.max(-1, Math.min(1, delta));
  return SAMPLE_RATE / refined;
}

/** Short-window RMS envelope — the series a modulation effect moves. */
function envelopeSeries(samples: Float32Array, win = 256): number[] {
  const out: number[] = [];
  for (let s = 0; s + win <= samples.length; s += win) {
    let sq = 0;
    for (let i = s; i < s + win; i++) sq += samples[i] * samples[i];
    out.push(Math.sqrt(sq / win));
  }
  return out;
}

/** Modulation: does it actually MOVE, and at the rate the knob claims?
 *  A chorus/phaser/tremolo whose LFO is dead measures as a static filter. */
function fitnessModulation(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const N = 132300; // 3 s — enough to see even a 0.2 Hz sweep
  const probe = (i: number) => Math.sin((2 * Math.PI * 900 * i) / SAMPLE_RATE) * 0.4;
  const out = renderPass(dspFunc, params, N, probe);
  if (out.failed) return null;
  const WIN = 256;
  const env = envelopeSeries(out.samples.slice(8192), WIN);
  if (env.length < 16) return null;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  if (mean < 1e-5) return { score: 0, metric: "modulation depth", evidence: "output is effectively silent on a steady tone — nothing is modulating" };
  const variance = env.reduce((a, v) => a + (v - mean) * (v - mean), 0) / env.length;
  const depth = Math.sqrt(variance) / mean; // 0 = static, higher = deeper sweep
  const depthScore = Math.max(0, Math.min(100, Math.round((depth / 0.15) * 100)));

  // Rate calibration: the envelope's own period, versus the Rate knob.
  const rateParam = parameters.find((p) => /^(rate|speed|lfo|frequency)$/i.test(p.id));
  const envRate = SAMPLE_RATE / WIN;
  let measuredHz: number | null = null;
  if (rateParam && depth > 0.02) {
    const envArr = new Float32Array(env.map((v) => v - mean));
    const minLag = Math.max(2, Math.floor(envRate / 12));
    const maxLag = Math.min(envArr.length - 2, Math.floor(envRate / 0.15));
    let bestLag = -1;
    let best = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      const n = envArr.length - lag;
      for (let i = 0; i < n; i++) sum += envArr[i] * envArr[i + lag];
      const c = sum / n;
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && best > 0) measuredHz = envRate / bestLag;
  }

  if (!rateParam || measuredHz === null) {
    return {
      score: depthScore,
      metric: "modulation depth",
      evidence: `sweeps the signal by ${(depth * 100).toFixed(1)}% on a steady tone (a static filter measures ~0%)`,
    };
  }
  const setHz = params[rateParam.id];
  // Amplitude peaks can land at 1x or 2x the LFO rate depending on the
  // effect (a tremolo dips once per cycle, a through-zero comb twice), so
  // accept either as correct calibration.
  const err = Math.min(Math.abs(measuredHz - setHz), Math.abs(measuredHz - setHz * 2)) / Math.max(0.05, setHz);
  const rateScore = Math.max(0, Math.min(100, Math.round((1 - err / 0.5) * 100)));
  // Which convention this effect follows (one dip per cycle or two) is decided
  // by whichever target the measurement is nearer in RATIO terms -- the same
  // ambiguity the score already forgives. Correcting toward the far one would
  // "fix" a correct through-zero comb into a wrong one.
  const oneX = Math.abs(Math.log(measuredHz / Math.max(1e-6, setHz)));
  const twoX = Math.abs(Math.log(measuredHz / Math.max(1e-6, setHz * 2)));
  const target = oneX <= twoX ? setHz : setHz * 2;
  return {
    score: Math.round(depthScore * 0.6 + rateScore * 0.4),
    metric: "modulation depth + rate",
    evidence: `sweeps ${(depth * 100).toFixed(1)}% deep at ~${measuredHz.toFixed(2)} Hz with Rate set to ${setHz.toFixed(2)} Hz`,
    calibration:
      err > CALIBRATE_RATE_ERR && measuredHz > 1e-6 ? { paramId: rateParam.id, factor: target / measuredHz } : undefined,
  };
}

/** Pitch correction: feed a deliberately detuned note and measure how much
 *  of the tuning error the plugin actually removes. */
function fitnessPitch(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>
): FunctionalFitness | null {
  // A4 = 440 Hz pushed 45 cents sharp: unambiguously out of tune, but still
  // nearest to A rather than A#.
  const OFFSET_CENTS = 45;
  const inHz = 440 * Math.pow(2, OFFSET_CENTS / 1200);
  const N = 66150; // 1.5 s: the detector needs time to lock and correct
  const tone = (i: number) => Math.sin((2 * Math.PI * inHz * i) / SAMPLE_RATE) * 0.45;
  const out = renderPass(dspFunc, params, N, tone);
  if (out.failed) return null;
  // Measure the settled second half only.
  const settled = out.samples.slice(Math.floor(N / 2));
  const outHz = detectPitchHz(settled, 200, 900);
  if (outHz === null) return { score: 0, metric: "pitch correction", evidence: "no stable pitch detectable in the output" };
  const centsFrom = (hz: number) => {
    const semis = 12 * Math.log2(hz / 440);
    return (semis - Math.round(semis)) * 100;
  };
  const outErr = Math.abs(centsFrom(outHz));
  const corrected = (OFFSET_CENTS - outErr) / OFFSET_CENTS; // 1 = fully in tune
  const score = Math.max(0, Math.min(100, Math.round(corrected * 100)));
  return {
    score,
    metric: "pitch correction",
    evidence: `pulls a ${OFFSET_CENTS}-cent-sharp note to ${outErr.toFixed(0)} cents off (${(corrected * 100).toFixed(0)}% of the error removed)`,
  };
}

/** Sampler: every pad must make a sound, and pads must not all be the same
 *  sound wearing different labels. */
function fitnessSampler(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const pads = parameters.filter((p) => /^pad_/i.test(p.id));
  if (pads.length < 2) return null;
  const N = 8192;
  const silence = () => 0;
  const renders: Float32Array[] = [];
  let audible = 0;
  for (const pad of pads) {
    const solo: Record<string, number> = { ...params };
    for (const other of pads) solo[other.id] = other.id === pad.id ? pad.max : 0;
    const out = renderPass(dspFunc, solo, N, silence);
    if (out.failed) continue;
    if (out.rms > 1e-4) audible++;
    renders.push(out.samples);
  }
  if (renders.length < 2) return { score: 0, metric: "pad voices", evidence: "no pad produced measurable output" };
  // Distinctness: mean normalized difference between every pad pair.
  let pairs = 0;
  let distinctPairs = 0;
  for (let a = 0; a < renders.length; a++) {
    for (let b = a + 1; b < renders.length; b++) {
      let diff = 0;
      let energy = 0;
      for (let i = 0; i < N; i++) {
        diff += Math.abs(renders[a][i] - renders[b][i]);
        energy += Math.abs(renders[a][i]) + Math.abs(renders[b][i]);
      }
      pairs++;
      if (energy > 1e-4 && diff / energy > 0.2) distinctPairs++;
    }
  }
  const audibleRatio = audible / pads.length;
  const distinctRatio = pairs > 0 ? distinctPairs / pairs : 0;
  const score = Math.max(0, Math.min(100, Math.round((audibleRatio * 0.5 + distinctRatio * 0.5) * 100)));
  return {
    score,
    metric: "pad voices",
    evidence: `${audible}/${pads.length} pads make a sound and ${distinctPairs}/${pairs} pad pairs are audibly different from each other`,
  };
}

/** Synthesizer: a generator must actually generate — at the pitch it claims,
 *  with harmonic content rather than a bare sine. */
function fitnessSynth(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>,
  parameters: PluginParameter[]
): FunctionalFitness | null {
  const N = 32768;
  const out = renderPass(dspFunc, params, N, () => 0); // generators ignore input
  if (out.failed) return null;
  if (out.rms < 1e-4) return { score: 0, metric: "tone generation", evidence: "generates no audible tone at default settings" };
  const settled = out.samples.slice(8192);
  const detected = detectPitchHz(settled, 40, 1600);
  const pitchParam = parameters.find((p) => /^(pitch|freq|frequency|tune)$/i.test(p.id) && p.max > 40);

  if (!pitchParam || detected === null) {
    return { score: 70, metric: "tone generation", evidence: `generates a steady tone (RMS ${out.rms.toFixed(3)}) with no pitch control to verify against` };
  }
  const setHz = params[pitchParam.id];
  // Octave errors are a detector artifact as often as a real one; judge the
  // pitch class distance in semitones, folded to the nearest octave.
  const semis = 12 * Math.log2(detected / Math.max(1, setHz));
  const foldedSemis = Math.abs(semis - 12 * Math.round(semis / 12));
  const score = Math.max(0, Math.min(100, Math.round((1 - foldedSemis / 3) * 100)));
  // Correct toward the OCTAVE the detector actually reported, not toward the
  // raw knob value: an octave error here is as often the autocorrelation
  // locking a subharmonic as a real mistuning, and "repairing" that would
  // transpose an honest oscillator by a full octave.
  const octaveTarget = setHz * Math.pow(2, Math.round(semis / 12));
  return {
    score,
    metric: "pitch accuracy",
    evidence: `sounds ${detected.toFixed(1)} Hz with Pitch set to ${setHz.toFixed(1)} Hz (${foldedSemis.toFixed(2)} semitones off, octave-folded)`,
    calibration:
      foldedSemis > CALIBRATE_PITCH_SEMIS ? { paramId: pitchParam.id, factor: octaveTarget / detected } : undefined,
  };
}

/** Character effects with no single canonical job (novel hybrid chains):
 *  the job is TRANSFORMATION — a "character" effect that barely alters the
 *  signal is not doing anything, however cleanly it measures. */
function fitnessTransformation(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>
): FunctionalFitness | null {
  const N = 22050;
  const out = renderPass(dspFunc, params, N, arpAt);
  if (out.failed || out.rms < 1e-5) return null;
  // Gain-match first so raw level change is not mistaken for character.
  let inSq = 0;
  for (let i = 0; i < N; i++) inSq += arpAt(i) * arpAt(i);
  const inRms = Math.sqrt(inSq / N);
  if (inRms < 1e-6) return null;
  const g = inRms / out.rms;
  let diff = 0;
  for (let i = 0; i < N; i++) diff += Math.abs(out.samples[i] * g - arpAt(i));
  const normDiff = diff / N / inRms;
  const score = Math.max(0, Math.min(100, Math.round((normDiff / 0.6) * 100)));
  return {
    score,
    metric: "transformation depth",
    evidence: `alters the gain-matched signal by ${(normDiff * 100).toFixed(0)}% of its own level (a near-passthrough measures ~0%)`,
  };
}

/** Distortion: how much harmonic content does it actually generate? */
function fitnessDistortion(
  dspFunc: (i: number, p: any, s: any, r?: number) => number,
  params: Record<string, number>
): FunctionalFitness | null {
  const out = renderPass(dspFunc, params, 8192, cleanToneAt);
  if (out.failed || out.rms < 1e-5) return null;
  const share = harmonicShare(out.samples);
  // 0.08 (2nd+3rd at ~8% of the fundamental) is a solidly driven stage.
  const score = Math.max(0, Math.min(100, Math.round((share / 0.08) * 100)));
  return {
    score,
    metric: "harmonic generation",
    evidence: `adds 2nd+3rd harmonics at ${(share * 100).toFixed(1)}% of the fundamental on a clean tone at default settings`,
  };
}

/**
 * Measure how well a build performs its family's core job. Returns null for
 * families with no meaningful functional test (utility, hybrid, sampler),
 * so nothing is penalized for a test that doesn't apply.
 */
export function measureFunctionalFitness(
  dspFunction: string,
  parameters: PluginParameter[],
  family: PluginFamily | null | undefined
): FunctionalFitness | null {
  if (!family) return null;
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return null;
  const params = defaultParamsMap(parameters);
  try {
    switch (family) {
      case "dynamics":
        return fitnessDynamics(dspFunc, params);
      case "reverb":
        return fitnessReverb(dspFunc, params);
      case "delay":
        return fitnessDelay(dspFunc, params, parameters);
      case "filter":
        return fitnessFilter(dspFunc, params, parameters);
      case "eq":
        return fitnessEq(dspFunc, params, parameters);
      case "distortion":
      case "saturator":
      case "multiband_saturator":
      case "amp_sim":
        return fitnessDistortion(dspFunc, params);
      case "modulation":
        return fitnessModulation(dspFunc, params, parameters);
      case "pitch":
        return fitnessPitch(dspFunc, params);
      case "sampler":
        return fitnessSampler(dspFunc, params, parameters);
      case "synthesizer":
        return fitnessSynth(dspFunc, params, parameters);
      case "hybrid_other":
        return fitnessTransformation(dspFunc, params);
      default:
        // "utility" (gain/pan trims) has no meaningful functional job to
        // measure — better honestly unmeasured than scored against a test
        // that does not apply.
        return null;
    }
  } catch {
    return null;
  }
}

export interface VoicingDifferentiation {
  /** 0-100: how measurably different this control's discrete choices are. */
  score: number;
  metric: string;
  evidence: string;
}

/**
 * Renders the DSP once per discrete step of a "select" parameter (e.g.
 * amp_sim's headType 0..3 or cabType 0..2), holding every other parameter at
 * its default, and measures how much the output actually differs between
 * choices on a clean test tone.
 *
 * This exists because fitnessDistortion (and every other functional-fitness
 * probe) only ever renders once, at default parameter values -- it would
 * happily score a selector wired to nothing exactly as high as a real one,
 * since it never LOOKS at the other choices. A discrete selector needs its
 * own decisive-gap test: a do-nothing selector (or one bound only to a
 * cosmetic label field, never read by the DSP) renders byte-identical
 * output at every step and measures ~0% difference; real per-branch
 * coefficients (see AMP_CHANNEL's headType/cabType) produce a clear,
 * nonzero difference between every pair of choices. Informational only --
 * ranks candidates in refinementScore(), never gates the >=97 floor.
 */
export function measureVoicingDifferentiation(
  dspFunction: string,
  parameters: PluginParameter[],
  paramId: string
): VoicingDifferentiation | null {
  const target = parameters.find((p) => p.id === paramId);
  if (!target) return null;
  const steps = Math.round(target.max) - Math.round(target.min) + 1;
  if (steps < 2) return null;
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return null;
  const baseParams = defaultParamsMap(parameters);

  const renders: Float32Array[] = [];
  for (let step = 0; step < steps; step++) {
    const params = { ...baseParams, [paramId]: Math.round(target.min) + step };
    const out = renderPass(dspFunc, params, 4096, cleanToneAt);
    if (out.failed) return null;
    renders.push(out.samples);
  }

  // Pairwise normalized RMS difference between every pair of choices -- the
  // WORST (smallest) pair is what matters: a selector that only tells two
  // of its four choices apart is still a selector that doesn't really work.
  let minDiff = Infinity;
  for (let i = 0; i < renders.length; i++) {
    for (let j = i + 1; j < renders.length; j++) {
      const a = renders[i];
      const b = renders[j];
      let sumSqDiff = 0;
      let sumSqCombined = 0;
      for (let k = 0; k < a.length; k++) {
        const d = a[k] - b[k];
        sumSqDiff += d * d;
        sumSqCombined += (a[k] * a[k] + b[k] * b[k]) / 2;
      }
      const rmsDiff = Math.sqrt(sumSqDiff / a.length);
      const rmsCombined = Math.sqrt(sumSqCombined / a.length);
      const normDiff = rmsCombined > 1e-9 ? rmsDiff / rmsCombined : 0;
      minDiff = Math.min(minDiff, normDiff);
    }
  }
  // 0.15 (15% normalized RMS difference) is a clearly audible timbral/tonal
  // shift between two amp voicings or cab sizes; a wired-to-nothing
  // selector measures ~0% between every pair.
  const score = Math.max(0, Math.min(100, Math.round((minDiff / 0.15) * 100)));
  return {
    score,
    metric: `${target.name} differentiation`,
    evidence: `the two most-similar "${target.name}" choices still differ by ${(minDiff * 100).toFixed(1)}% of their combined signal level on a clean test tone (a selector wired to nothing measures ~0%)`,
  };
}

/* ------------------------------------------------------------------ */
/* Calibration repair: turn a measured error into a mechanical FIX      */
/* ------------------------------------------------------------------ */

/**
 * A knob that lies about itself by a clean multiplicative factor -- an echo
 * at half the time the Time knob claims, a corner two octaves above where
 * Cutoff says -- is not merely a low score. The gate already knows the exact
 * factor, so the correction is arithmetic, not another model round-trip.
 *
 * The repair rewrites every VALUE read of `params.<id>` in the DSP body to
 * `(params.<id> * factor)`. The knob's declared range, units, and displayed
 * number all stay exactly as the user sees them; only the number the DSP
 * receives is corrected, so the label becomes true instead of the range
 * becoming a lie.
 */
export interface CalibrationRepair {
  paramId: string;
  /** Multiplier applied to the DSP's reads of that parameter. */
  factor: number;
  /** Which fitness measurement produced the gradient ("echo timing", ...). */
  metric: string;
  /** Functional fitness before and after -- the proof it was kept for. */
  before: number;
  after: number;
  /** Human-readable note for the build transcript. */
  note: string;
}

/** Factors outside this band mean the measurement, not the plugin, is wrong
 *  (a detector that locked onto noise). Refuse to "repair" from those. */
const CALIBRATE_MIN_FACTOR = 0.05;
const CALIBRATE_MAX_FACTOR = 20;
/** Below ~2% the correction is inside the measurement's own resolution. */
const CALIBRATE_MIN_LOG_FACTOR = 0.02;
/** Fitness points a rewrite must gain to be worth shipping. Well above the
 *  1-2 point jitter of the probe grids, so noise can never trigger a rewrite. */
const CALIBRATE_MIN_GAIN = 5;
/** A second pass can finish what a nonlinear first pass started; more than
 *  that is chasing measurement noise. */
const CALIBRATE_MAX_PASSES = 2;

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite every read of `params.<id>` (dot or bracket form) as
 * `(params.<id> * factor)`.
 *
 * Two things it deliberately refuses to touch:
 *  - comparison sites (`params.x !== undefined`). The whole codebase reads
 *    parameters through that guard, and scaling the guard turns a missing
 *    parameter into `NaN !== undefined` -> true -> NaN poured into the audio
 *    path. The guard stays literal; the VALUE branch gets scaled.
 *  - any body that WRITES to the parameter (`params.x = `, `+=`, `++`).
 *    Returns null instead, so the caller ships the original code.
 *
 * Returns null when nothing was rewritten, so "no read sites found" can
 * never be mistaken for "repair applied".
 */
export function scaleParamReads(dspFunction: string, id: string, factor: number): string | null {
  const esc = escapeForRegExp(id);
  const pattern = new RegExp(`params\\s*(?:\\.\\s*${esc}|\\[\\s*(['"])${esc}\\1\\s*\\])(?![\\w$])`, "g");
  const mult = Math.round(factor * 1e6) / 1e6;

  let out = "";
  let last = 0;
  let rewrites = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(dspFunction)) !== null) {
    const after = dspFunction.slice(match.index + match[0].length);
    // Writes make this parameter a mutable local, not a knob read -- bail.
    if (/^\s*(?:\+\+|--|[-+*/%|&^]?=(?!=))/.test(after)) return null;
    out += dspFunction.slice(last, match.index);
    // Leave `!== undefined` / `=== x` style guards alone (see doc comment).
    out += /^\s*(?:===|!==|==|!=)/.test(after) ? match[0] : `(${match[0]} * ${mult})`;
    if (!/^\s*(?:===|!==|==|!=)/.test(after)) rewrites++;
    last = match.index + match[0].length;
  }
  if (rewrites === 0) return null;
  return out + dspFunction.slice(last);
}

/** A repaired build may not be WORSE on any correctness axis the headline
 *  musicality score reads. This is what keeps a calibration fix from ever
 *  buying accuracy with a dead knob or a silent output. */
function musicalityHolds(before: MusicalityMeasurement, after: MusicalityMeasurement): boolean {
  if (after.fatal) return false;
  if (after.isSilent && !before.isSilent) return false;
  if (after.deadParams.length > before.deadParams.length) return false;
  if (after.unstableParams.length > before.unstableParams.length) return false;
  if (after.silentOnSignals.length > before.silentOnSignals.length) return false;
  return true;
}

/**
 * Apply the calibration gradients the fitness measurements produced, keeping
 * each rewrite ONLY when re-measurement proves it helped -- the same contract
 * calibrateUnstableParams follows for range fixes, and the reason a wrong
 * gradient costs nothing but a little CPU.
 *
 * Returns the (possibly rewritten) DSP together with the measurements taken
 * on whatever it decided to ship, so the caller never re-measures.
 */
export function calibrateParamScaling(
  dspFunction: string,
  parameters: PluginParameter[],
  family: PluginFamily | null | undefined,
  baseMusicality: MusicalityMeasurement,
  baseFitness: FunctionalFitness | null
): {
  dspFunction: string;
  repairs: CalibrationRepair[];
  musicality: MusicalityMeasurement;
  fitness: FunctionalFitness | null;
} {
  const repairs: CalibrationRepair[] = [];
  let curDsp = dspFunction;
  let curFit = baseFitness;
  let curMus = baseMusicality;
  if (baseMusicality.fatal) return { dspFunction: curDsp, repairs, musicality: curMus, fitness: curFit };

  for (let pass = 0; pass < CALIBRATE_MAX_PASSES; pass++) {
    const cal = curFit?.calibration;
    if (!cal || !curFit) break;
    if (!Number.isFinite(cal.factor)) break;
    if (cal.factor < CALIBRATE_MIN_FACTOR || cal.factor > CALIBRATE_MAX_FACTOR) break;
    if (Math.abs(Math.log(cal.factor)) < CALIBRATE_MIN_LOG_FACTOR) break;
    const param = parameters.find((p) => p.id === cal.paramId);
    if (!param) break;

    const candidateDsp = scaleParamReads(curDsp, cal.paramId, cal.factor);
    if (!candidateDsp || candidateDsp === curDsp) break;
    if (!compileDspBody(candidateDsp)) break;

    const candFit = measureFunctionalFitness(candidateDsp, parameters, family);
    if (!candFit || candFit.score < curFit.score + CALIBRATE_MIN_GAIN) break;
    const candMus = measureMusicality(candidateDsp, parameters);
    if (!musicalityHolds(curMus, candMus)) break;
    // A rescaled read can shift a DIFFERENT parameter's semantic honesty
    // (e.g. correcting Pitch changes the harmonic content a Cutoff-brightness
    // check probes) -- the fix must not trade one form of correctness for
    // another, so re-verify semantics too and refuse a net regression.
    const skipIds = new Set([...curMus.deadParams, ...curMus.unstableParams]);
    const beforeViolations = verifyParamSemantics(curDsp, parameters, skipIds).violations.length;
    const afterViolations = verifyParamSemantics(candidateDsp, parameters, skipIds).violations.length;
    if (afterViolations > beforeViolations) break;

    repairs.push({
      paramId: cal.paramId,
      factor: Math.round(cal.factor * 1e6) / 1e6,
      metric: curFit.metric,
      before: curFit.score,
      after: candFit.score,
      note:
        `Calibrated: "${param.name}" was off by ${cal.factor.toFixed(3)}x -- the DSP's reads of it are now scaled so the knob's number matches what it actually does ` +
        `(${curFit.metric} ${curFit.score} -> ${candFit.score}/100; ${candFit.evidence})`,
    });
    curDsp = candidateDsp;
    curFit = candFit;
    curMus = candMus;
  }

  return { dspFunction: curDsp, repairs, musicality: curMus, fitness: curFit };
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

/* ------------------------------------------------------------------ */
/* CPU cost: measure real per-sample DSP wall-time (informational)      */
/* ------------------------------------------------------------------ */

/**
 * Cross-platform monotonic clock: `performance.now()` exists in both the
 * browser (this module is imported by App.tsx) and modern Node (tsx/test),
 * matching the fallback already used in buildPlanner.ts.
 */
const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface CpuCost {
  /** Measured wall-clock time per rendered sample, in nanoseconds -- the
   *  median of several timed passes after a JIT warm-up run. Absolute
   *  values are noisy on a shared/loaded machine; only used as a RELATIVE
   *  signal between candidates of the same build, never a pass/fail gate. */
  nsPerSample: number;
  /** nsPerSample as a fraction of the real-time budget at 44.1kHz (1.0 =
   *  the entire per-sample budget). Context for a human reading the
   *  report -- the SCORE below is deliberately much more conservative than
   *  this ratio so it can discriminate between correct-and-cheap and
   *  correct-and-expensive builds long before either is anywhere near
   *  missing real time. */
  budgetFraction: number;
  /**
   * 0-100: light, appropriately-scoped DSP (one-pole filters, a handful of
   * comb/allpass taps, simple waveshaping) scores near 100; a per-sample
   * body doing disproportionate real work -- per-sample convolution, dense
   * unnecessary oversampling, redundant inner loops -- scores lower. This
   * is the dimension `scoreLatency` claims to measure but doesn't: that
   * function grades GENERATION wall-time and returns a flat 100 for every
   * deterministic/offline build (== every build the offline gate ever
   * evaluates), so it currently carries zero information about the
   * plugin's own audio cost. This measurement fills that gap.
   *
   * Deliberately INFORMATIONAL, not wired into the headline `latency`
   * score: wall-clock timing is measurably noisy on a machine running
   * other concurrent work, and a flaky headline score that occasionally
   * dips a correct build below the >=97 floor would be strictly worse
   * than the current uninformative-but-stable 100. Combined with the
   * static analyzeRealtimeSafety findings (below) so a build that is BOTH
   * measurably expensive AND unsafely coded is flagged on both signals.
   */
  score: number;
  /** Static real-time-safety findings folded in (empty when clean) --
   *  unguarded allocation, logging, or blocking calls in the audio path. */
  staticIssues: string;
  evidence: string;
}

/** Real-time budget per sample at 44.1kHz, in nanoseconds (~22.7 us). */
const CPU_BUDGET_NS = 1e9 / SAMPLE_RATE;
/** Below this, score is a flat 100. Generous on purpose (budget/40): every
 *  verified golden recipe and topology in the bank measures well under it
 *  (see cpuCostTest.ts) -- only DSP doing real disproportionate per-sample
 *  work moves the needle, which is the entire point of a discriminating
 *  signal rather than a pass/fail cliff at the real-time budget itself. */
const CPU_TARGET_NS = CPU_BUDGET_NS / 40;
const CPU_WARMUP_SAMPLES = 3000;
const CPU_TIMED_SAMPLES = 10000;
const CPU_TRIALS = 3;

/**
 * Time the ACTUAL per-sample DSP cost by running it, not by reasoning about
 * it statically. `renderPass` already renders thousands of samples for every
 * other measurement in this file, so timing one more pass is nearly free.
 * A JIT warm-up precedes the timed passes so V8's cold-interpreter overhead
 * doesn't swamp real DSP-cost differences; the timed result is the MEDIAN of
 * several trials, which is far more robust than the mean to a noisy machine
 * (a single stall from another process biases a mean but not a median).
 */
export function measureCpuCost(dspFunction: string, parameters: PluginParameter[]): CpuCost | null {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return null;
  const params = defaultParamsMap(parameters);
  const state: any = {};

  try {
    for (let i = 0; i < CPU_WARMUP_SAMPLES; i++) {
      dspFunc(PRIMARY_SIGNAL.at(i), params, state, PRIMARY_SIGNAL.at(i + STEREO_SKEW));
    }
  } catch {
    return null;
  }

  const trialsNs: number[] = [];
  for (let t = 0; t < CPU_TRIALS; t++) {
    const start = now();
    try {
      for (let i = 0; i < CPU_TIMED_SAMPLES; i++) {
        dspFunc(PRIMARY_SIGNAL.at(i), params, state, PRIMARY_SIGNAL.at(i + STEREO_SKEW));
      }
    } catch {
      return null;
    }
    const elapsedMs = now() - start;
    trialsNs.push((elapsedMs * 1e6) / CPU_TIMED_SAMPLES);
  }
  trialsNs.sort((a, b) => a - b);
  const nsPerSample = Math.max(0, trialsNs[Math.floor(trialsNs.length / 2)]);

  const budgetFraction = nsPerSample / CPU_BUDGET_NS;
  const score =
    nsPerSample <= CPU_TARGET_NS
      ? 100
      : Math.max(0, Math.min(100, Math.round(100 * (1 - (nsPerSample - CPU_TARGET_NS) / (CPU_BUDGET_NS - CPU_TARGET_NS)))));

  const staticSafety = analyzeRealtimeSafety(dspFunction);
  // Fold the static findings in as an additional penalty (capped, since the
  // headline `performance` score already fully accounts for them -- this is
  // only so a body that is BOTH slow AND unsafe reads as worse than one that
  // is merely slow, without double-counting when it's just unsafe).
  const combinedScore = Math.max(0, Math.min(score, staticSafety.score < 100 ? score - 5 : score));

  return {
    nsPerSample: Math.round(nsPerSample * 100) / 100,
    budgetFraction: Math.round(budgetFraction * 1000) / 1000,
    score: combinedScore,
    staticIssues: staticSafety.evidence,
    evidence: `~${nsPerSample.toFixed(0)} ns/sample (${(budgetFraction * 100).toFixed(2)}% of the ${CPU_BUDGET_NS.toFixed(0)} ns real-time budget at 44.1kHz)${staticSafety.evidence ? `; static: ${staticSafety.evidence}` : ""}`,
  };
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

// inferControlType lives in guiArchetypes.ts now (re-exported below) so both
// the build-time gate and the browser's archetype switcher share one
// heuristic.

const SAMPLER_PAD_COUNT = 8;

const HEAD_TYPE_LABELS: Array<{ ampChannelType: "clean" | "crunch" | "lead" | "modern"; customText: string }> = [
  { ampChannelType: "clean", customText: "CLEAN CH." },
  { ampChannelType: "crunch", customText: "PLEXI 50W" },
  { ampChannelType: "lead", customText: "LEAD CH." },
  { ampChannelType: "modern", customText: "MODERN HI-GAIN" },
];
const CAB_TYPE_LABELS: Array<{ cabSize: "1x12" | "2x12" | "4x12"; customText: string }> = [
  { cabSize: "1x12", customText: "CELESTION G12" },
  { cabSize: "2x12", customText: "VINTAGE 30 x2" },
  { cabSize: "4x12", customText: "CELESTION V30" },
];

/** The showpiece amp-head faceplate is decorative (a big visual, no dspFunction
 *  ever reads its own value/min/max) -- but its label/channel art should still
 *  agree with the plugin's REAL headType selection instead of always reading
 *  "PLEXI 50W / Crunch" regardless of what's actually selected. `headTypeValue`
 *  is the current real headType param's value, when the plugin has one. */
function buildAmpHeadParam(headTypeValue?: number): PluginParameter {
  const idx = Math.max(0, Math.min(HEAD_TYPE_LABELS.length - 1, Math.round(headTypeValue ?? 1)));
  const label = HEAD_TYPE_LABELS[idx];
  return {
    id: "amp_head_auto", name: "Amp Head", min: 0, max: 10, defaultValue: 5, value: 5, unit: "gain",
    controlType: "amp", customText: label.customText,
    ampTolexPattern: "carbon", ampKnobStyle: "chickenhead", ampChannelType: label.ampChannelType, ampTubeGlow: true,
    w: 340, h: 150,
  };
}

/** Same as buildAmpHeadParam: decorative faceplate, but its label/cab-size
 *  art agrees with the real cabType selection instead of always "4x12". */
function buildCabinetParam(cabTypeValue?: number): PluginParameter {
  const idx = Math.max(0, Math.min(CAB_TYPE_LABELS.length - 1, Math.round(cabTypeValue ?? 2)));
  const label = CAB_TYPE_LABELS[idx];
  return {
    id: "cabinet_auto", name: "Cabinet", min: 0, max: 10, defaultValue: 5, value: 5, unit: "vol",
    controlType: "cab", customText: label.customText,
    cabGrillStyle: "metalgrid", cabSize: label.cabSize, cabMicModel: "SM57",
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

/** Decorative marker param: its own value/min/max are never read -- it
 *  exists only to claim a "controlType": "eq" slot so the multi-node EQ
 *  curve (computeEqCurve, controlVisuals.ts) has somewhere to render. The
 *  widget itself discovers and drives the REAL low/mid/high/midFreq params
 *  elsewhere on the plugin; dragging a node writes back to those, never to
 *  this marker. Sized for the eq_focus archetype's hero slot. */
function buildEqCurveParam(): PluginParameter {
  return {
    id: "eq_curve_auto", name: "EQ Curve", min: 0, max: 1, defaultValue: 0, value: 0, unit: "",
    controlType: "eq", w: 560, h: 180,
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
      params.push(buildAmpHeadParam(params.find((p) => p.id === "headType")?.value));
      changes.push("added the amp head faceplate (every amp sim gets one)");
    }
    if (!params.some((p) => p.controlType === "cab")) {
      params.push(buildCabinetParam(params.find((p) => p.id === "cabType")?.value));
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

  if (family === "eq") {
    // Only when there's an actual multi-band shape to show -- a "filter"
    // build that got misclassified as "eq" with just one cutoff knob has
    // nothing for a curve widget to add.
    const bandCount = params.filter((p) => /^(low|mid|high)$/i.test(p.id)).length;
    if (bandCount >= 2 && !params.some((p) => p.controlType === "eq")) {
      params.push(buildEqCurveParam());
      changes.push("added the multi-band EQ curve display (every parametric EQ gets one)");
    }
  }

  if (changes.length === 0) return { plugin, changes: [] };
  return { plugin: { ...plugin, parameters: params }, changes };
}

/**
 * Guarantee a polished faceplate: every parameter gets a controlType, an
 * archetype-appropriate layout, and theme colors; the plugin gets a coherent
 * skin. Model-provided styling is always preserved -- this only fills gaps.
 *
 * Three independent passes, in order: (1) control-type inference -- some
 * archetypes route by type (pedal separates toggles), so every param needs
 * a real controlType before layout runs; (2) archetype layout -- positions
 * whatever doesn't already have x/y, defaulting to "grid" (the original,
 * unchanged algorithm) when no archetype is specified; (3) theme -- accent
 * color and font, kept as a fully separate axis from layout so switching
 * one never disturbs the other.
 */
export function polishPluginVisuals(
  plugin: AudioPlugin,
  themeOverride?: UiTheme,
  archetype?: ArchetypeId
): { plugin: AudioPlugin; changes: string[] } {
  const theme = themeOverride ?? (CATEGORY_THEMES[plugin.category] || CATEGORY_THEMES.filter);
  const changes: string[] = [];

  let styledCount = 0;
  const typed = plugin.parameters.map((p) => {
    if (p.controlType) return p;
    styledCount++;
    return { ...p, controlType: inferControlType(p) };
  });

  const layout = applyArchetype(archetype ?? "grid", typed);
  // Repairs positions that ALREADY collide -- e.g. a plugin edited multiple
  // times before this occupied-slot-aware layout shipped, where every
  // param already has x/y so the "only fill gaps" layout above leaves them
  // untouched even if they overlap. Runs on every build; a true no-op when
  // nothing actually overlaps. See guiArchetypes.ts's resolveControlOverlaps.
  const repairedPositions = resolveControlOverlaps(layout.parameters);
  if (repairedPositions !== layout.parameters) {
    changes.push("repositioned overlapping controls that had collided");
  }
  layout.parameters = repairedPositions;

  // Amp/cab/mic/pad showpiece widgets never get a font override (matches
  // the pre-archetype behavior exactly); every control gets an accent.
  //
  // isFirstPolish reuses this function's own existing "have I touched this
  // plugin before" signal (customSkin is only ever set once, below) to gate
  // a HARD accentColor overwrite -- not just a backfill of missing values --
  // on every non-showpiece param. Research into professional plugin UI
  // design converged on "one dominant accent color, not a rainbow of
  // per-knob colors" as one of the clearest markers of a polished vs.
  // unfinished-looking plugin; GUI_DESIGN_PHILOSOPHY (dspPromptKit.ts) has
  // always asked the LLM for this, but nothing enforced it -- a model that
  // emitted divergent per-parameter colors anyway sailed straight through.
  // Gating on isFirstPolish (rather than always overwriting) is what keeps
  // this from clobbering a color a user later hand-picks via the Element
  // Inspector: this function DOES get re-invoked on already-generated
  // plugins (template swaps, preset loads), but by then customSkin is
  // already set, so the gate is already closed by the time any user edit
  // could exist.
  const isFirstPolish = !plugin.customSkin;
  const themedParams = layout.parameters.map((p) => {
    const isShowpieceOrPad = p.controlType === "amp" || p.controlType === "cab" || p.controlType === "mic" || p.controlType === "pad";
    const accentColor = isShowpieceOrPad
      ? (p.accentColor ?? theme.accent)
      : isFirstPolish
        ? theme.accent
        : (p.accentColor ?? theme.accent);
    return {
      ...p,
      accentColor,
      fontStyle: isShowpieceOrPad ? p.fontStyle : p.fontStyle ?? theme.font,
    };
  });

  const polished: AudioPlugin = {
    ...plugin,
    parameters: themedParams,
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
  if (isFirstPolish) changes.push(`normalized every control to one dominant accent color (${theme.accent})`);
  if (styledCount > 0) changes.push(`assigned control types to ${styledCount} parameter(s)`);
  if (layout.laidOutCount > 0) changes.push(`auto-laid-out ${layout.laidOutCount} control(s) on the designer grid`);

  return { plugin: polished, changes };
}

/** How many pairs of positioned controls overlap on the faceplate. Used to
 *  penalize scoreLooks below (a plugin with genuinely overlapping controls
 *  should not be able to score 100 -- "the controls are usable and
 *  distinct" is squarely what "looks" already claims to certify) and as
 *  evidence in measureVisualIntegrity. By the time a build reaches here,
 *  resolveControlOverlaps (guiArchetypes.ts, run inside
 *  polishPluginVisuals) has already repaired any collision that occurred
 *  during layout -- this check is a permanent regression guard on the
 *  headline score itself, not the primary defense, so a future change that
 *  breaks the repair pass fails every one of this project's >=97-floor
 *  tests instead of shipping an unusable, silently-stacked faceplate. */
function countControlOverlaps(parameters: PluginParameter[]): number {
  const rects = parameters
    .filter((p) => p.x !== undefined && p.y !== undefined && p.controlType !== "label")
    .map((p) => ({ x: p.x as number, y: p.y as number, w: p.w ?? 120, h: p.h ?? 100 }));
  let count = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) count++;
    }
  }
  return count;
}

export function scoreLooks(plugin: AudioPlugin): number {
  let score = 100;
  for (const p of plugin.parameters) {
    if (!p.controlType) score -= 8;
    if (p.x === undefined || p.y === undefined) score -= 4;
    if (!p.accentColor) score -= 2;
  }
  if (!plugin.customSkin) score -= 10;
  // Heavier than the structural checks above -- overlapping controls are
  // unusable, not merely unstyled -- and enough on its own to guarantee a
  // plugin with even one collision can never reach 100.
  const overlaps = countControlOverlaps(plugin.parameters);
  if (overlaps > 0) score -= 15 + overlaps * 10;
  return Math.max(0, score);
}

/* ------------------------------------------------------------------ */
/* Visual integrity: WCAG contrast -- the "does this look legible"     */
/* dimension none of the four headline scores or scoreLooks measure.   */
/* ------------------------------------------------------------------ */

export interface VisualIntegrity {
  /** 0-100, informational. */
  score: number;
  metric: string;
  evidence: string;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Standard WCAG 2.1 contrast ratio (1:1 to 21:1). Returns null when either
 *  color isn't a parsable 6-digit hex. */
function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

/**
 * Real "does this look legible" checks that neither the four headline
 * dimensions nor scoreLooks's structural presence checks cover: WCAG
 * contrast between the faceplate's text/accent colors and its own
 * background. Informational only -- ranks candidates in refinementScore(),
 * never gates the >=97 floor. Unlike overlap (a plain usability defect),
 * contrast is a real design-taste dimension where a legitimately bold,
 * high-contrast-BY-DESIGN theme should never be blocked from shipping over
 * a borderline number -- see CLAUDE.md's "four headline dimensions
 * saturate; new measurements rank, never lower the floor" rule.
 *
 * Returns null when there's no custom skin at all (nothing to measure) or
 * neither text nor accent color parses as a plain 6-digit hex.
 */
export function measureVisualIntegrity(plugin: AudioPlugin): VisualIntegrity | null {
  const skin = plugin.customSkin;
  if (!skin?.bgColor) return null;
  const checks: Array<{ label: string; ratio: number | null }> = [];
  if (skin.textColor) checks.push({ label: "text", ratio: contrastRatio(skin.textColor, skin.bgColor) });
  if (skin.accentColor) checks.push({ label: "accent", ratio: contrastRatio(skin.accentColor, skin.bgColor) });
  const valid = checks.filter((c): c is { label: string; ratio: number } => c.ratio !== null);
  if (valid.length === 0) return null;
  const worst = valid.reduce((min, c) => (c.ratio < min.ratio ? c : min));
  const overlaps = countControlOverlaps(plugin.parameters);
  const score = Math.max(0, Math.min(100, Math.round((worst.ratio / WCAG_AA_NORMAL_TEXT) * 100)));
  return {
    score,
    metric: "visual integrity",
    evidence: `worst contrast is ${worst.label}-vs-background at ${worst.ratio.toFixed(2)}:1 (WCAG AA wants >= ${WCAG_AA_NORMAL_TEXT}:1)${overlaps > 0 ? `; ${overlaps} control pair(s) still overlap` : ""}`,
  };
}

export interface SkeuomorphicFidelity {
  /** 0-100, informational. */
  score: number;
  metric: string;
  evidence: string;
}

/**
 * Does this plugin's declared visual-craft intent actually render, or does
 * some of it silently no-op? Concretely: `resolveGlowBoxShadow`
 * (customSkin.ts) is the ONLY place `glowStyle` turns into a real glow
 * effect -- for a long time it implemented just the "neon" branch, so 5 of
 * ATTRIBUTE_THEMES' 8 entries (aggressive/clinical/industrial/vintage/
 * luxurious -- see uiSpec.ts), which assign "shadow"/"flat"/"vintage", were
 * rendering with NO glow treatment at all despite the theme declaring one.
 * This check calls the real resolver against the plugin's actual customSkin
 * and asserts a non-"none" glowStyle produced a real, non-undefined glow --
 * a direct, decisive-gap-testable proof that the fix (not just the intent)
 * is in place. Deliberately checks `resolveGlowBoxShadow` directly rather
 * than the full `resolveCustomSkinStyle().boxShadow` -- that combined field
 * is now ALWAYS defined (every faceplate gets a baseline chassis bezel
 * regardless of glow), so testing it directly would no longer distinguish
 * "glow rendered" from "glow silently dropped, bezel still there". Also
 * records the resolved material (resolveMaterial, materialVisuals.ts) as
 * evidence -- always present (it's a total function with a fallback), so it
 * informs but never gates. Informational only: ranks candidates in
 * refinementScore(), never moves the >=97 headline floor, per this
 * project's standing rule for every measurement added after the original
 * four (see CLAUDE.md).
 */
export function measureSkeuomorphicFidelity(plugin: AudioPlugin): SkeuomorphicFidelity | null {
  const skin = plugin.customSkin;
  if (!skin) return null;
  const material = resolveMaterial(plugin);
  const glowStyle = skin.glowStyle;
  const expectsGlow = !!glowStyle && glowStyle !== "none";
  if (!expectsGlow) {
    return {
      score: 100,
      metric: "skeuomorphic fidelity",
      evidence: `no glow requested (glowStyle="${glowStyle ?? "unset"}"); material=${material}`,
    };
  }
  const glowRendered = resolveGlowBoxShadow(skin) !== undefined;
  return {
    score: glowRendered ? 100 : 40,
    metric: "skeuomorphic fidelity",
    evidence: glowRendered
      ? `glowStyle="${glowStyle}" resolved to a real CSS effect; material=${material}`
      : `glowStyle="${glowStyle}" resolved to NO CSS effect -- the theme's declared glow is being silently dropped; material=${material}`,
  };
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

/* ------------------------------------------------------------------ */
/* Fail-fast pre-check: recognize a broken candidate before paying for  */
/* the full measurement suite                                           */
/* ------------------------------------------------------------------ */

/**
 * runQualityGate chains a heavy stack of measurements after musicality --
 * calibration search, functional fitness, an aliasing FFT, true-peak
 * oversampling, a static code audit, multi-trial CPU timing, and a
 * multi-render reference-deviation comparison -- none of which change the
 * verdict for a candidate that is already provably broken. Worse,
 * measureMusicality ITSELF runs an expensive per-parameter audibility sweep
 * (every non-decorative parameter, at both its min and max, across all four
 * bank signals) that a broken candidate pays for too, even though nothing
 * downstream will ever look at the result.
 *
 * This probe renders the EXACT same signal, window, and default settings as
 * measureMusicality's own primary render, and uses the identical isSilent
 * ratio threshold -- it is not a new, separately-calibrated check that could
 * diverge from the full pass, just the same verdict reached before the
 * expensive sweep after it runs. Returns null when the candidate is healthy
 * enough to be worth the full suite.
 */
export function quickHealthCheck(dspFunction: string, parameters: PluginParameter[]): MusicalityMeasurement | null {
  const dspFunc = compileDspBody(dspFunction);
  if (!dspFunc) return fatalMusicalityMeasurement("dspFunction does not compile");

  const defaults = defaultParamsMap(parameters);
  const probe = renderPass(dspFunc, defaults, SAMPLE_RATE);
  if (probe.failed) {
    return fatalMusicalityMeasurement("output produced NaN/Infinity or threw on musical program material at default settings");
  }

  let inSumSq = 0;
  for (let i = 0; i < SAMPLE_RATE; i++) {
    const x = PRIMARY_SIGNAL.at(i);
    inSumSq += x * x;
  }
  const inputRms = Math.sqrt(inSumSq / SAMPLE_RATE);
  // Same signal, window, and 2% (~34 dB) ratio measureMusicality's own
  // isSilent check uses below -- not a new threshold to calibrate, the
  // identical computation performed earlier so the expensive sweep after it
  // is never reached for a candidate that would fail it anyway.
  if (probe.rms < inputRms * 0.02) {
    return fatalMusicalityMeasurement(
      "output is essentially silent on musical program material at default settings -- the per-parameter audibility sweep and the rest of the measurement suite were skipped as moot"
    );
  }

  return null;
}

/**
 * Run the full gate: measure, deterministically fix (output trim + visual
 * polish), score all four dimensions, and return the improved plugin plus a
 * transcript-ready set of notes.
 */
export function runQualityGate(
  plugin: AudioPlugin,
  opts: { generationMs?: number; family?: PluginFamily | null; prompt?: string; intent?: string; uiMetaphor?: string | null } = {}
): QualityGateResult {
  const notes: string[] = [];

  // --- Fail-fast pre-check: a candidate that doesn't compile, throws/NaNs,
  //     or is silent at defaults is provably broken from a probe far
  //     cheaper than the full measurement suite this function chains below
  //     it (per-parameter audibility sweep, calibration, functional
  //     fitness, aliasing FFT, true peak, code audit, CPU timing, reference
  //     deviation) -- see quickHealthCheck and safetyNetTest.ts for the
  //     measured saving. ---
  // --- Musicality: measure, then fix gain staging deterministically ---
  let m = quickHealthCheck(plugin.dspFunction, plugin.parameters) ?? measureMusicality(plugin.dspFunction, plugin.parameters);
  let workingParams = plugin.parameters;
  let workingDsp = plugin.dspFunction;

  // Range calibration: an unstable extreme becomes a FIXED range, not a
  // warning. Only kept when re-measurement proves it actually helped.
  if (!m.fatal && m.unstableParams.length > 0) {
    const cal = calibrateUnstableParams(workingDsp, workingParams, m.unstableParams);
    if (cal.calibrated.length > 0) {
      const m2 = measureMusicality(workingDsp, cal.parameters);
      if (!m2.fatal && m2.unstableParams.length < m.unstableParams.length) {
        m = m2;
        workingParams = cal.parameters;
        cal.fixes.forEach((f) => notes.push(`${f}.`));
      }
    }
  }

  // --- Calibration repair: a knob whose measured behaviour is a clean
  //     multiplicative factor off its own label (echo timing, filter corner,
  //     LFO rate, oscillator pitch) gets its DSP reads rescaled so the number
  //     on the knob matches what it actually does. Applied, RE-MEASURED, and
  //     kept only when functional fitness measurably improved and nothing on
  //     the musicality side regressed -- same contract as the range
  //     calibration above. Informational: it can only raise
  //     report.functionalFitness, never a headline score. ---
  let fitness = m.fatal ? null : measureFunctionalFitness(workingDsp, workingParams, opts.family ?? null);
  const calibrationRepairs: CalibrationRepair[] = [];
  if (!m.fatal && fitness?.calibration) {
    const scaled = calibrateParamScaling(workingDsp, workingParams, opts.family ?? null, m, fitness);
    if (scaled.repairs.length > 0) {
      workingDsp = scaled.dspFunction;
      m = scaled.musicality;
      fitness = scaled.fitness;
      calibrationRepairs.push(...scaled.repairs);
      scaled.repairs.forEach((r) => notes.push(`${r.note}.`));
    }
  }

  // --- Parameter semantics: every knob must do what its name claims ---
  const semantics = m.fatal
    ? { checks: [] as SemanticCheck[], violations: [] as string[] }
    : verifyParamSemantics(workingDsp, workingParams, new Set([...m.deadParams, ...m.unstableParams]));
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
  // (built on the calibrated parameters/DSP so any range or scaling fixes
  // actually ship -- this is what makes workingDsp the shipped code)
  const measuredPlugin: AudioPlugin =
    workingParams === plugin.parameters && workingDsp === plugin.dspFunction
      ? plugin
      : { ...plugin, parameters: workingParams, dspFunction: workingDsp };
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
  // The GUI archetype is picked from the request's classified uiMetaphor
  // (richest signal, when the caller has it) or the bare family as a
  // fallback -- see guiArchetypes.ts's pickArchetype for the full mapping.
  const archetype = pickArchetype(opts.uiMetaphor, opts.family ?? null);
  const { plugin: polishedRaw, changes } = polishPluginVisuals({ ...orderedPlugin, outputTrim, dcBlock }, theme, archetype);
  const polished: AudioPlugin = { ...polishedRaw, uiArchetype: polishedRaw.uiArchetype ?? archetype };
  changes.forEach((c) => notes.push(`Visual polish: ${c}.`));
  if (archetype !== "grid") notes.push(`GUI archetype: ${archetype} (matched to how this plugin should look and behave).`);

  // --- Performance: static real-time safety ---
  const perf = analyzeRealtimeSafety(workingDsp);
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
  const characterIndex = m.fatal ? 0 : measureCharacterIndex(workingDsp, workingParams);

  // Aliasing/harshness: measured always (informational), but only counted a
  // DEFECT for families that are supposed to stay spectrally clean -- a
  // ring-mod, pitch shifter, chorus, or generator is inharmonic by design, so
  // a high index there is character, not a bug. `harsh` drives the refinement
  // penalty and a report warning; it never touches the four headline scores.
  const aliasingIndex = m.fatal ? 0 : measureAliasing(workingDsp, workingParams);
  const harsh = !m.fatal && !!opts.family && CLEAN_FAMILIES.has(opts.family) && aliasingIndex > ALIAS_DEFECT_THRESHOLD;
  if (harsh) {
    notes.push(`Aliasing/harshness: ${aliasingIndex.toFixed(2)} inharmonic energy on a clean tone -- a ${opts.family} should stay smooth; this has audible digital fizz (oversample or lowpass the nonlinearity).`);
  }

  // Inter-sample true peak (dBTP), 4x Catmull-Rom reconstruction. The trim
  // computed above is applied at the ENGINE's output stage, so report the
  // trimmed level -- what a converter would actually see.
  const rawTruePeakDb = m.fatal ? -Infinity : measureTruePeak(workingDsp, workingParams);
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
  const codeAudit = m.fatal ? null : auditDspCode(workingDsp, workingParams);
  if (codeAudit) {
    notes.push(formatCodeAudit(codeAudit));
  }

  // Functional fitness: does it do its family's JOB, and how well? The four
  // headline scores saturate at 100 for every correct build; this is what
  // separates a compressor that compresses from one that merely runs.
  // (Already measured above, before/after the calibration-repair pass --
  // `fitness` here is the FINAL, post-repair value, so a knob the gate just
  // fixed reports its corrected score, not its pre-repair one.)
  if (fitness) {
    notes.push(`Functional fitness ${fitness.score}/100 (${fitness.metric}): ${fitness.evidence}.`);
  }

  // --- Feature depth: does this build carry the control vocabulary a REAL
  //     unit of its family has? Fitness asks "does it do its job"; a 3-knob
  //     compressor passes that while still feeling like a toy. This is the
  //     measurement that separates minimal from complete. Informational —
  //     it ranks candidates in refinementScore(), never gates shipping.
  //     It cannot reward knob-spam: every parameter counted here still has
  //     to survive the deadParams audibility check above. ---
  const depth = measureFeatureDepth(polished.parameters, opts.family);
  if (depth) {
    notes.push(`Feature depth ${depth.score}/100: ${depth.evidence}.`);
  }

  // --- CPU cost: the real audio cost `latency` claims to measure but does
  //     not (scoreLatency returns a flat 100 for every deterministic/offline
  //     build). Measured by TIMING the DSP, not reasoning about it statically
  //     -- renderPass already renders thousands of samples for every other
  //     measurement above, so this is nearly free. Deliberately informational
  //     (see CpuCost doc comment): it ranks candidates in refinementScore(),
  //     it never touches the headline `latency` score, because wall-clock
  //     timing is measurably noisy on a machine doing other concurrent work
  //     and a flaky headline score would be worse than the current stable
  //     (if uninformative) 100. ---
  const cpuCost = m.fatal ? null : measureCpuCost(workingDsp, workingParams);
  if (cpuCost) {
    notes.push(`CPU cost ${cpuCost.score}/100: ${cpuCost.evidence}.`);
  }

  // --- Reference deviation: does this behave like a known-good member of
  //     its family? Runs the candidate and its family's golden recipe
  //     through the SAME probe signal and compares the shape of their
  //     responses -- catches classes of structural wrongness no single
  //     named parameter check can (a knob-level test can't see "this
  //     doesn't look like a compressor at all"). Informational only. ---
  const referenceDeviation = m.fatal ? null : measureReferenceDeviation(workingDsp, workingParams, opts.family ?? null);
  if (referenceDeviation) {
    notes.push(`Reference deviation ${referenceDeviation.score}/100: ${referenceDeviation.evidence}.`);
  }

  // --- Voicing differentiation: any "select" param (a discrete voicing
  //     switch like amp_sim's headType/cabType) gets its own decisive-gap
  //     check -- does the DSP actually branch per choice, or is the
  //     selector wired to nothing? Informational, one entry per select
  //     param present; never touches the >=97 headline floor. ---
  const voicingDifferentiation = m.fatal
    ? undefined
    : plugin.parameters
        .filter((p) => p.controlType === "select")
        .map((p) => measureVoicingDifferentiation(workingDsp, plugin.parameters, p.id))
        .filter((v): v is VoicingDifferentiation => v !== null);
  voicingDifferentiation?.forEach((v) => notes.push(`${v.metric} ${v.score}/100: ${v.evidence}.`));

  // --- Visual integrity: WCAG contrast on the final, polished faceplate --
  //     the "does this look legible" dimension scoreLooks's structural
  //     checks don't cover. Informational only. ---
  const visualIntegrity = measureVisualIntegrity(polished);
  if (visualIntegrity) {
    notes.push(`Visual integrity ${visualIntegrity.score}/100: ${visualIntegrity.evidence}.`);
  }

  // --- Skeuomorphic fidelity: does the theme's declared glow/material
  //     intent actually render, or silently no-op? Informational only. ---
  const skeuomorphicFidelity = measureSkeuomorphicFidelity(polished);
  if (skeuomorphicFidelity) {
    notes.push(`Skeuomorphic fidelity ${skeuomorphicFidelity.score}/100: ${skeuomorphicFidelity.evidence}.`);
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
    functionalFitness: fitness ?? undefined,
    featureDepth: depth ? { score: depth.score, evidence: depth.evidence, missing: [...depth.missing.required, ...depth.missing.expected] } : undefined,
    calibrationRepairs: calibrationRepairs.length > 0 ? calibrationRepairs.map((r) => ({ paramId: r.paramId, factor: r.factor, metric: r.metric, before: r.before, after: r.after })) : undefined,
    cpuCost: cpuCost ?? undefined,
    referenceDeviation: referenceDeviation ?? undefined,
    voicingDifferentiation: voicingDifferentiation && voicingDifferentiation.length > 0 ? voicingDifferentiation : undefined,
    visualIntegrity: visualIntegrity ?? undefined,
    skeuomorphicFidelity: skeuomorphicFidelity ?? undefined,
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
