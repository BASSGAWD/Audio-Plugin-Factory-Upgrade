/**
 * The built-in research corpus — Milestone 2's offline source material.
 *
 * Each entry is what a research pass over the referenced literature yields
 * for one concept: claims (each carrying its citation), and — when the
 * engine's architecture permits — a proposed DSP module written to the same
 * conventions as every bank module (single return, init-guarded state,
 * guarded math, honest parameter names). Proposed modules are NEVER trusted:
 * the research engine runs them through the quality gate and the user must
 * approve them before the factory may build with them.
 *
 * Entries with `blocked` document concepts the current engine structurally
 * cannot implement (mono per-sample JS, no file IO, no block processing).
 * Researching those yields the CONSTRAINT as the finding — an honest "not
 * yet possible, and here is why" instead of a broken module.
 *
 * A local LLM (when configured) and live web fetches (via /api/proxy) can
 * add findings on top of this corpus; corpus entries exist so the research
 * engine works fully offline and deterministically.
 */

import { PluginFamily } from "./pluginSpec";
import { DspRecipe } from "./dspRecipes";

export interface Citation {
  title: string;
  source: string;
  url?: string;
  /** Authority score 0-100 (their tier table): official spec ~98, academic
   *  ~95, books ~90, curated community ~70, forums ~55, model output ~20. */
  authority: number;
}

export interface ResearchClaim {
  text: string;
  citation: Citation;
}

export interface CorpusEntry {
  concept: string;
  area: string;
  /** Prompt wording this concept serves (used when an approved module is
   *  matched against future build requests). */
  match: RegExp;
  claims: ResearchClaim[];
  proposedModule?: {
    family: PluginFamily;
    title: string;
    parameters: DspRecipe["parameters"];
    body: string;
  };
  /** Present when the engine structurally cannot implement this concept. */
  blocked?: string;
}

const JOS_PASP: Omit<Citation, "title"> = {
  source: "J.O. Smith, Physical Audio Signal Processing (CCRMA, Stanford)",
  url: "https://ccrma.stanford.edu/~jos/pasp/",
  authority: 95,
};

export const RESEARCH_CORPUS: CorpusEntry[] = [
  /* ================================================================ */
  {
    concept: "phaser",
    area: "Modulation",
    match: /phaser|phase\s*shift|swirl/i,
    claims: [
      {
        text: "A phaser is a cascade of first-order allpass filters whose break frequency is swept by an LFO; summing the allpassed signal with the dry input creates moving spectral notches.",
        citation: { title: "Phasing — allpass chains", ...JOS_PASP },
      },
      {
        text: "Feedback from the last allpass stage back into the first deepens the notches into resonant peaks; keep the loop gain below 1 for stability.",
        citation: { title: "Phaser feedback design", source: "musicdsp.org community archive", url: "https://www.musicdsp.org/", authority: 70 },
      },
      {
        text: "First-order allpass: y[n] = c*x[n] + x[n-1] - c*y[n-1], with c = (tan(pi*f/fs) - 1) / (tan(pi*f/fs) + 1).",
        citation: { title: "First-order allpass coefficient", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "modulation",
      title: "4-stage allpass phaser (LFO-swept notches, resonant feedback)",
      parameters: [
        { id: "rate", name: "Rate", min: 0.05, max: 5, defaultValue: 0.5, unit: "Hz" },
        { id: "depth", name: "Depth", min: 0, max: 1, defaultValue: 0.6, unit: "ratio" },
        { id: "resonance", name: "Resonance", min: 0, max: 0.85, defaultValue: 0.4, unit: "ratio" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
      ],
      body: `if (!state.init) { state.ph = 0; state.x1 = 0; state.y1 = 0; state.x2 = 0; state.y2 = 0; state.x3 = 0; state.y3 = 0; state.x4 = 0; state.y4 = 0; state.init = true; }
let rate = params.rate !== undefined ? params.rate : 0.5;
let depth = params.depth !== undefined ? params.depth : 0.6;
let res = Math.min(0.85, params.resonance !== undefined ? params.resonance : 0.4);
let mix = params.mix !== undefined ? params.mix : 0.5;
state.ph += 2 * Math.PI * rate / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
let sweep = 400 + (Math.sin(state.ph) * 0.5 + 0.5) * depth * 3600;
let t = Math.tan(Math.PI * Math.min(0.45, sweep / 44100));
let c = (t - 1) / (t + 1);
let s = inputSample + state.y4 * res;
let y1 = c * s + state.x1 - c * state.y1; state.x1 = s; state.y1 = y1;
let y2 = c * y1 + state.x2 - c * state.y2; state.x2 = y1; state.y2 = y2;
let y3 = c * y2 + state.x3 - c * state.y3; state.x3 = y2; state.y3 = y3;
let y4 = c * y3 + state.x4 - c * state.y4; state.x4 = y3; state.y4 = y4;
let wet = 0.5 * (inputSample + y4);
return Math.tanh(inputSample * (1 - mix) + wet * mix * 1.2);`,
    },
  },
  /* ================================================================ */
  {
    concept: "parallel-compression",
    area: "Compressors",
    match: /parallel\s*comp|new\s*york\s*comp|ny\s*comp|upward\s*blend/i,
    claims: [
      {
        text: "Parallel (New York) compression blends a heavily compressed copy with the untouched dry signal, adding density to quiet material while preserving transients.",
        citation: { title: "Parallel compression", source: "B. Katz, Mastering Audio: The Art and the Science", authority: 90 },
      },
      {
        text: "Use a fast, deep compressor on the wet path (high ratio, low threshold) — the blend control, not the ratio, sets the effect intensity.",
        citation: { title: "Parallel compression technique", source: "Wikipedia: Parallel compression", url: "https://en.wikipedia.org/wiki/Parallel_compression", authority: 75 },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "Parallel (NY) compressor (crushed wet path blended with pristine dry)",
      parameters: [
        { id: "threshold", name: "Threshold", min: -48, max: -12, defaultValue: -30, unit: "dB" },
        { id: "ratio", name: "Ratio", min: 4, max: 20, defaultValue: 10, unit: ":1" },
        { id: "blend", name: "Blend", min: 0, max: 1, defaultValue: 0.4, unit: "ratio" },
        { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 8, unit: "dB" },
      ],
      body: `if (!state.init) { state.env = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -30;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 10);
let blend = params.blend !== undefined ? params.blend : 0.4;
let makeup = params.makeup !== undefined ? params.makeup : 8;
let x = Math.abs(inputSample);
state.env += (x > state.env ? 0.01 : 0.0008) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let gainDb = overDb > 0 ? -overDb * (1 - 1 / ratio) : 0;
let wet = inputSample * Math.pow(10, (gainDb + makeup) / 20);
return Math.tanh(inputSample * (1 - blend) + wet * blend);`,
    },
  },
  /* ================================================================ */
  {
    concept: "multi-tap",
    area: "Delays",
    match: /multi.?tap|rhythmic\s*(?:delay|echo)|tap\s*delay/i,
    claims: [
      {
        text: "A multi-tap delay reads one delay line at several offsets simultaneously, producing a rhythmic pattern of echoes from a single write head.",
        citation: { title: "Tapped delay lines", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "delay",
      title: "Multi-tap rhythmic delay (3 pattern taps on one line, damped regeneration)",
      parameters: [
        { id: "time", name: "Time", min: 50, max: 1200, defaultValue: 400, unit: "ms" },
        { id: "feedback", name: "Feedback", min: 0, max: 0.85, defaultValue: 0.35, unit: "ratio" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
      ],
      body: `if (!state.init) { state.buf = new Float32Array(96000); state.ptr = 0; state.damp = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 400;
let fb = Math.min(0.85, params.feedback !== undefined ? params.feedback : 0.35);
let mix = params.mix !== undefined ? params.mix : 0.35;
let d = Math.max(4, Math.min(52900, Math.floor(time * 44.1)));
let d1 = Math.max(1, Math.floor(d * 0.5));
let d2 = Math.max(2, Math.floor(d * 0.75));
let t1 = state.buf[(state.ptr - d1 + 96000) % 96000];
let t2 = state.buf[(state.ptr - d2 + 96000) % 96000];
let t3 = state.buf[(state.ptr - d + 96000) % 96000];
let wet = t1 * 0.32 + t2 * 0.28 + t3 * 0.4;
state.damp += 0.35 * (t3 - state.damp);
state.buf[state.ptr] = inputSample + state.damp * fb;
state.ptr = (state.ptr + 1) % 96000;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    },
  },
  /* ================================================================ */
  {
    concept: "dynamic-saturation",
    area: "Distortion",
    match: /dynamic\s*satur|responsive\s*(?:drive|satur)|envelope\s*(?:drive|satur)/i,
    claims: [
      {
        text: "Dynamic (level-dependent) saturation tracks the input envelope and increases the waveshaper drive on louder material, emulating how analog stages distort progressively rather than uniformly.",
        citation: { title: "Nonlinear processing", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
    ],
    proposedModule: {
      family: "distortion",
      title: "Dynamic saturator (envelope-tracked drive, 2x oversampled, tone filter)",
      parameters: [
        { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 10, unit: "dB" },
        { id: "response", name: "Response", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
        { id: "tone", name: "Tone", min: 500, max: 12000, defaultValue: 4200, unit: "Hz" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
      ],
      body: `if (!state.init) { state.lp = 0; state.env = 0; state.smDrive = 10; state.prevIn = 0; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 10;
let response = params.response !== undefined ? params.response : 0.5;
let tone = params.tone !== undefined ? params.tone : 4200;
let mix = params.mix !== undefined ? params.mix : 1;
state.smDrive += 0.002 * (drive - state.smDrive);
let x = Math.abs(inputSample);
state.env += (x > state.env ? 0.008 : 0.0009) * (x - state.env);
let envNorm = Math.min(1, state.env * 3.5);
let dynDb = state.smDrive * (1 - response * 0.6 + response * envNorm);
let g = Math.pow(10, dynDb / 20);
let midIn = 0.5 * (state.prevIn + inputSample);
let wet = 0.5 * (Math.tanh(midIn * g) + Math.tanh(inputSample * g)) / Math.pow(g, 0.65);
state.prevIn = inputSample;
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (wet - state.lp);
wet = state.lp;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    },
  },
  /* ================================================================ */
  {
    concept: "biquad",
    area: "Filters & EQ",
    match: /biquad|peaking\s*(?:eq|filter)|bell\s*(?:eq|filter|boost)/i,
    claims: [
      {
        text: "The RBJ cookbook peaking EQ: A = 10^(dBgain/40), alpha = sin(w0)/(2Q); b0 = 1+alpha*A, b1 = -2cos(w0), b2 = 1-alpha*A, a0 = 1+alpha/A, a1 = -2cos(w0), a2 = 1-alpha/A.",
        citation: { title: "Audio EQ Cookbook (peaking EQ)", source: "R. Bristow-Johnson, W3C Audio EQ Cookbook", url: "https://www.w3.org/TR/audio-eq-cookbook/", authority: 98 },
      },
      {
        text: "Smooth the center frequency per sample when it is user-swept; recomputing coefficients from a smoothed value avoids zipper noise.",
        citation: { title: "Time-varying filter coefficients", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "eq",
      title: "RBJ peaking bell EQ (cookbook biquad, smoothed sweepable center)",
      parameters: [
        { id: "freq", name: "Center Freq", min: 200, max: 8000, defaultValue: 1000, unit: "Hz" },
        { id: "boost", name: "Boost", min: -12, max: 12, defaultValue: 6, unit: "dB" },
        { id: "q", name: "Q", min: 0.4, max: 4, defaultValue: 1, unit: "Q" },
      ],
      body: `if (!state.init) { state.x1 = 0; state.x2 = 0; state.yy1 = 0; state.yy2 = 0; state.smF = 1000; state.init = true; }
let freq = params.freq !== undefined ? params.freq : 1000;
let boost = params.boost !== undefined ? params.boost : 6;
let q = Math.max(0.4, params.q !== undefined ? params.q : 1);
state.smF += 0.002 * (freq - state.smF);
let A = Math.pow(10, boost / 40);
let w0 = 2 * Math.PI * Math.min(16000, state.smF) / 44100;
let alpha = Math.sin(w0) / (2 * q);
let cosw = Math.cos(w0);
let a0 = 1 + alpha / A;
let b0 = (1 + alpha * A) / a0;
let b1 = -2 * cosw / a0;
let b2 = (1 - alpha * A) / a0;
let a1 = -2 * cosw / a0;
let a2 = (1 - alpha / A) / a0;
let y = b0 * inputSample + b1 * state.x1 + b2 * state.x2 - a1 * state.yy1 - a2 * state.yy2;
state.x2 = state.x1; state.x1 = inputSample;
state.yy2 = state.yy1; state.yy1 = y;
return Math.tanh(y);`,
    },
  },
  /* ================================================================ */
  /* Structurally blocked concepts — the finding IS the constraint     */
  /* ================================================================ */
  {
    concept: "convolution",
    area: "Reverbs",
    match: /convolution|impulse\s*response|\bir\b\s*(?:reverb|loader)/i,
    claims: [
      {
        text: "Convolution reverb multiplies the input spectrum by a measured impulse response; practical implementations use partitioned FFT convolution to keep latency low.",
        citation: { title: "FIR convolution and partitioned convolution", ...JOS_PASP },
      },
    ],
    blocked:
      "This engine has no audio-file loading, so there is no way to import an impulse response, and direct time-domain convolution of a realistic IR (~2 s = 88,200 taps) is far beyond the per-sample JS budget. Prerequisite: sample import + block (FFT) processing.",
  },
  {
    concept: "mid-side",
    area: "Compressors",
    match: /mid.?side|\bm\/s\b|stereo.?(?:width|link|linking|image)/i,
    claims: [
      {
        text: "Mid-side processing encodes L/R into sum (mid) and difference (side) channels so dynamics or EQ can treat center and width independently.",
        citation: { title: "M/S matrixing", source: "Wikipedia: Joint (audio engineering)", url: "https://en.wikipedia.org/wiki/Joint_(audio_engineering)", authority: 75 },
      },
    ],
    blocked:
      "The DSP engine is strictly mono (one inputSample in, one sample out) — there is no second channel to matrix against. Prerequisite: a stereo engine (dual-channel processing path in audioEngine + gate).",
  },
  {
    concept: "spectral-processing",
    area: "Pitch & Time",
    match: /spectral|fft|frequency.?domain|vocoder|spectral\s*transient/i,
    claims: [
      {
        text: "Spectral processors window the signal into overlapping blocks, transform with an FFT, operate on magnitude/phase, and resynthesize by overlap-add.",
        citation: { title: "Spectral audio signal processing", source: "J.O. Smith, Spectral Audio Signal Processing (CCRMA)", url: "https://ccrma.stanford.edu/~jos/sasp/", authority: 95 },
      },
    ],
    blocked:
      "The engine calls the DSP function once per sample with no lookahead block, so windowed FFT processing cannot run inside it. Prerequisite: block-based processing support (buffer N samples, process, overlap-add) in the audio engine and the gate's renderer.",
  },
];

export function corpusEntriesFor(concept: string): CorpusEntry[] {
  const needle = concept.toLowerCase();
  return RESEARCH_CORPUS.filter(
    (e) => e.concept === needle || e.concept.includes(needle) || needle.includes(e.concept) || e.match.test(concept)
  );
}
