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
 * cannot implement. Researching those yields the CONSTRAINT as the finding —
 * an honest "not yet possible, and here is why" instead of a broken module.
 * (Block/FFT processing IS available: a body can buffer N samples in
 * init-guarded state and run an inline FFT on hop boundaries — see the
 * convolution and spectral-processing entries. What remains blocked needs a
 * capability the per-sample signature genuinely lacks, e.g. a second input
 * BUS for external sidechain keying.)
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
  {
    concept: "opto-model",
    area: "Compressors",
    match: /opto|la-?2a|electro.?optical|tube\s*level/i,
    claims: [
      {
        text: "Opto compressors (LA-2A family) derive gain reduction from a light source driving a photocell whose resistance recovers non-linearly: release starts fast (~60 ms) then slows dramatically (1-5 s) the longer and harder the unit has been compressing — the classic program-dependent release.",
        citation: { title: "Optical compressor behavior", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed. (dynamic range control)", authority: 90 },
      },
      {
        text: "The LA-2A exposes only Peak Reduction and Gain; ratio (~3:1) and time constants are emergent from the T4 optical cell, not user controls.",
        citation: { title: "LA-2A design", source: "Wikipedia: LA-2A Leveling Amplifier", url: "https://en.wikipedia.org/wiki/LA-2A_Leveling_Amplifier", authority: 75 },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "Opto leveling amplifier (photocell-style program-dependent release, fixed gentle ratio)",
      parameters: [
        { id: "reduction", name: "Peak Reduction", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
        { id: "makeup", name: "Gain", min: 0, max: 24, defaultValue: 5, unit: "dB" },
      ],
      body: `if (!state.init) { state.env = 0; state.memory = 0; state.init = true; }
let reduction = params.reduction !== undefined ? params.reduction : 0.5;
let makeup = params.makeup !== undefined ? params.makeup : 5;
let thresh = -8 - reduction * 30;
let x = Math.abs(inputSample);
let releaseC = 0.0008 / (1 + state.memory * 40);
state.env += (x > state.env ? 0.005 : releaseC) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let grDb = overDb > 0 ? overDb * (1 - 1 / 3) : 0;
state.memory += 0.00002 * (Math.min(1, grDb / 12) - state.memory);
let g = Math.pow(10, (-grDb + makeup) / 20);
return Math.tanh(inputSample * g);`,
    },
  },
  /* ================================================================ */
  {
    concept: "fet-model",
    area: "Compressors",
    match: /fet\b|1176|all.?buttons/i,
    claims: [
      {
        text: "FET compressors (1176 family) use a field-effect transistor as the gain element, giving microsecond-class attack (20-800 us) — fast enough to clamp individual transient wavefronts — with input drive setting how hard the signal hits a fixed threshold.",
        citation: { title: "FET dynamic range control", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
      {
        text: "The 1176 has no threshold control: turning Input up pushes more signal over the fixed threshold, so drive doubles as intensity — and the FET stage adds a touch of harmonic color at high drive.",
        citation: { title: "1176 Peak Limiter design", source: "Wikipedia: 1176 Peak Limiter", url: "https://en.wikipedia.org/wiki/1176_Peak_Limiter", authority: 75 },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "FET peak limiter (microsecond attack, fixed threshold, input-driven intensity)",
      parameters: [
        { id: "input", name: "Input", min: 0, max: 24, defaultValue: 8, unit: "dB" },
        { id: "ratio", name: "Ratio", min: 4, max: 20, defaultValue: 8, unit: ":1" },
        { id: "attack", name: "Attack", min: 0.05, max: 5, defaultValue: 0.3, unit: "ms" },
        { id: "makeup", name: "Output", min: 0, max: 24, defaultValue: 3, unit: "dB" },
      ],
      body: `if (!state.init) { state.env = 0; state.init = true; }
let input = params.input !== undefined ? params.input : 8;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 8);
let attack = Math.max(0.05, params.attack !== undefined ? params.attack : 0.3);
let makeup = params.makeup !== undefined ? params.makeup : 3;
let gIn = Math.pow(10, input / 20);
let driven = inputSample * gIn;
let x = Math.abs(driven);
let aC = 1 - Math.exp(-1 / (attack * 44.1));
state.env += (x > state.env ? aC : 0.0007) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - (-16);
let grDb = overDb > 0 ? overDb * (1 - 1 / ratio) : 0;
let g = Math.pow(10, (-grDb + makeup) / 20) / Math.pow(gIn, 0.7);
return Math.tanh(driven * g);`,
    },
  },
  /* ================================================================ */
  {
    concept: "multiband-compression",
    area: "Compressors",
    match: /multi.?band\s*comp|band.?split\s*comp|ott\b/i,
    claims: [
      {
        text: "A multiband compressor splits the signal with crossover filters and compresses each band independently, so low-end energy cannot pump the highs; the bands are summed after per-band gain reduction.",
        citation: { title: "Multiband dynamics", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
      {
        text: "Complementary one-pole (or Linkwitz-Riley) crossovers keep the recombined spectrum flat when both bands are at unity gain.",
        citation: { title: "Crossover filters", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "2-band multiband compressor (complementary crossover, independent band envelopes)",
      parameters: [
        { id: "crossover", name: "Crossover", min: 150, max: 4000, defaultValue: 800, unit: "Hz" },
        { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -24, unit: "dB" },
        { id: "ratio", name: "Ratio", min: 1, max: 20, defaultValue: 4, unit: ":1" },
        { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 4, unit: "dB" },
      ],
      body: `if (!state.init) { state.lp = 0; state.smX = 800; state.envL = 0; state.envH = 0; state.init = true; }
let crossover = params.crossover !== undefined ? params.crossover : 800;
let thresh = params.threshold !== undefined ? params.threshold : -24;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 4);
let makeup = params.makeup !== undefined ? params.makeup : 4;
state.smX += 0.002 * (crossover - state.smX);
let a = 1 - Math.exp(-2 * Math.PI * state.smX / 44100);
state.lp += a * (inputSample - state.lp);
let low = state.lp;
let high = inputSample - low;
let xl = Math.abs(low);
state.envL += (xl > state.envL ? 0.004 : 0.0005) * (xl - state.envL);
let dbL = 20 * Math.log10(Math.max(1e-6, state.envL));
let grL = dbL > thresh ? (dbL - thresh) * (1 - 1 / ratio) : 0;
let xh = Math.abs(high);
state.envH += (xh > state.envH ? 0.004 : 0.0005) * (xh - state.envH);
let dbH = 20 * Math.log10(Math.max(1e-6, state.envH));
let grH = dbH > thresh ? (dbH - thresh) * (1 - 1 / ratio) : 0;
let mk = Math.pow(10, makeup / 20);
let out = low * Math.pow(10, -grL / 20) * mk + high * Math.pow(10, -grH / 20) * mk;
return Math.tanh(out);`,
    },
  },
  /* ================================================================ */
  {
    concept: "sidechain-filter",
    area: "Compressors",
    match: /de.?ess|sibilan|sidechain\s*filter|harsh\s*s\b/i,
    claims: [
      {
        text: "A de-esser is a compressor whose DETECTOR listens through a highpass/bandpass filter tuned to the sibilance region (~4-9 kHz), reducing gain only when 'ess' energy spikes — internal sidechain filtering in its most common form.",
        citation: { title: "De-essing / sidechain filtering", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "De-esser (highpass-filtered detector, high-band gain reduction)",
      parameters: [
        { id: "frequency", name: "Ess Frequency", min: 1500, max: 8000, defaultValue: 3000, unit: "Hz" },
        { id: "amount", name: "Amount", min: 0, max: 1, defaultValue: 0.6, unit: "ratio" },
        { id: "makeup", name: "Makeup", min: 0, max: 12, defaultValue: 0, unit: "dB" },
      ],
      body: `if (!state.init) { state.lp = 0; state.smF = 3000; state.env = 0; state.init = true; }
let frequency = params.frequency !== undefined ? params.frequency : 3000;
let amount = params.amount !== undefined ? params.amount : 0.6;
let makeup = params.makeup !== undefined ? params.makeup : 0;
state.smF += 0.002 * (frequency - state.smF);
let a = 1 - Math.exp(-2 * Math.PI * state.smF / 44100);
state.lp += a * (inputSample - state.lp);
let low = state.lp;
let high = inputSample - low;
let xs = Math.abs(high);
state.env += (xs > state.env ? 0.03 : 0.002) * (xs - state.env);
let essDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = essDb - (-26 - amount * 22);
let grDb = overDb > 0 ? Math.min(24, overDb * amount) : 0;
let mk = Math.pow(10, makeup / 20);
return Math.tanh((low + high * Math.pow(10, -grDb / 20)) * mk);`,
    },
  },
  /* ================================================================ */
  {
    concept: "wavetable",
    area: "Synthesis",
    match: /wavetable/i,
    claims: [
      {
        text: "A wavetable oscillator reads a stored single-cycle waveform with a phase accumulator and interpolated lookup; morphing crossfades between adjacent tables to sweep timbre continuously.",
        citation: { title: "Wavetable synthesis", ...JOS_PASP },
      },
      {
        text: "Band-limit each table (sum only the partials below Nyquist for the intended pitch range) or high tables alias audibly.",
        citation: { title: "Band-limited wavetables", source: "musicdsp.org community archive", url: "https://www.musicdsp.org/", authority: 70 },
      },
    ],
    proposedModule: {
      family: "synthesizer",
      title: "Morphing wavetable oscillator (4 band-limited tables, interpolated scan, airy noise layer)",
      parameters: [
        { id: "pitch", name: "Pitch", min: 55, max: 880, defaultValue: 220, unit: "Hz" },
        { id: "morph", name: "Morph", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
        { id: "cutoff", name: "Cutoff", min: 800, max: 12000, defaultValue: 4000, unit: "Hz" },
        { id: "level", name: "Level", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
      ],
      body: `if (!state.init) {
  state.tables = [];
  for (let t = 0; t < 4; t++) {
    let tab = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      let ph = 2 * Math.PI * i / 2048;
      let v = 0;
      if (t === 0) v = Math.sin(ph);
      else if (t === 1) { for (let k = 1; k <= 5; k += 2) v += Math.sin(k * ph) / (k * k); v *= 1.2; }
      else if (t === 2) { for (let k = 1; k <= 16; k++) v += Math.sin(k * ph) / k; v *= 0.55; }
      else { for (let k = 1; k <= 9; k += 2) v += Math.sin(k * ph) / k; v *= 0.75; }
      tab[i] = v;
    }
    state.tables.push(tab);
  }
  state.ph = 0; state.lp = 0; state.smP = 220; state.rng = 12345; state.init = true;
}
let pitch = params.pitch !== undefined ? params.pitch : 220;
let morph = Math.min(1, Math.max(0, params.morph !== undefined ? params.morph : 0.5));
let cutoff = params.cutoff !== undefined ? params.cutoff : 4000;
let level = params.level !== undefined ? params.level : 0.5;
state.smP += 0.002 * (pitch - state.smP);
state.ph += state.smP * 2048 / 44100;
if (state.ph >= 2048) state.ph -= 2048;
let pos = morph * 3;
let ti = Math.min(2, Math.floor(pos));
let frac = pos - ti;
let i0 = Math.floor(state.ph);
let i1 = (i0 + 1) % 2048;
let sf = state.ph - i0;
let ta = state.tables[ti];
let tb = state.tables[ti + 1];
let va = ta[i0] * (1 - sf) + ta[i1] * sf;
let vb = tb[i0] * (1 - sf) + tb[i1] * sf;
let osc = va * (1 - frac) + vb * frac;
state.rng = (state.rng * 1664525 + 1013904223) | 0;
let air = (state.rng / 2147483648) * 0.05;
let a = 1 - Math.exp(-2 * Math.PI * cutoff / 44100);
state.lp += a * (osc + air - state.lp);
return Math.tanh(state.lp * level * 0.8);`,
    },
  },
  /* ================================================================ */
  {
    concept: "fm-synthesis",
    area: "Synthesis",
    match: /\bfm\b|frequency\s*modulation|dx7/i,
    claims: [
      {
        text: "Two-operator FM: a modulator oscillator at ratio*f modulates the carrier's phase; the modulation index (in radians) sets sideband count and brightness — Chowning's founding result behind the DX7.",
        citation: { title: "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation", source: "J. Chowning, J. Audio Eng. Soc. 21(7), 1973", authority: 95 },
      },
      {
        text: "Integer carrier:modulator ratios give harmonic spectra; non-integer ratios give bells and metallic inharmonics.",
        citation: { title: "FM synthesis ratios", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "synthesizer",
      title: "2-operator FM voice (phase-modulated carrier, ratio + index timbre control)",
      parameters: [
        { id: "pitch", name: "Pitch", min: 55, max: 880, defaultValue: 220, unit: "Hz" },
        { id: "opRatio", name: "Op Ratio", min: 0.5, max: 8, defaultValue: 2, unit: "x" },
        { id: "fmAmount", name: "FM Amount", min: 0, max: 8, defaultValue: 2.5, unit: "rad" },
        { id: "level", name: "Level", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
      ],
      body: `if (!state.init) { state.phC = 0; state.phM = 0; state.smP = 220; state.smI = 2.5; state.init = true; }
let pitch = params.pitch !== undefined ? params.pitch : 220;
let opRatio = Math.max(0.1, params.opRatio !== undefined ? params.opRatio : 2);
let fmAmount = params.fmAmount !== undefined ? params.fmAmount : 2.5;
let level = params.level !== undefined ? params.level : 0.5;
state.smP += 0.002 * (pitch - state.smP);
state.smI += 0.002 * (fmAmount - state.smI);
state.phM += 2 * Math.PI * state.smP * opRatio / 44100;
if (state.phM > 2 * Math.PI) state.phM -= 2 * Math.PI;
state.phC += 2 * Math.PI * state.smP / 44100;
if (state.phC > 2 * Math.PI) state.phC -= 2 * Math.PI;
let osc = Math.sin(state.phC + state.smI * Math.sin(state.phM));
return Math.tanh(osc * level * 0.8);`,
    },
  },

  /* ================================================================ */
  /* Structurally blocked concepts — the finding IS the constraint     */
  /* ================================================================ */
  {
    concept: "sidechain-input",
    area: "Compressors",
    match: /sidechain\s*(?:input|key)|external\s*(?:key|sidechain)|duck\s*(?:from|to)\s/i,
    claims: [
      {
        text: "An external sidechain feeds a DIFFERENT signal into the compressor's detector (kick ducking a bass, voiceover ducking music) while the audio path processes the main input.",
        citation: { title: "Sidechain keying", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
    ],
    blocked:
      "The engine's DSP function receives exactly one input signal, so there is no second bus to key the detector from. INTERNAL sidechain filtering IS available — research 'sidechain-filter' (de-esser) for that. Prerequisite for external keying: a second input bus through audioEngine, the gate's renderer, and the plugin signature.",
  },
  {
    concept: "convolution",
    area: "Reverbs",
    match: /convolution|impulse\s*response|\bir\b\s*(?:reverb|loader)|convolv/i,
    claims: [
      {
        text: "Convolution reverb filters the input through a room's impulse response: each output sample is the dot product of the recent input history with the (time-reversed) IR — a direct FIR filter.",
        citation: { title: "FIR convolution", ...JOS_PASP },
      },
      {
        text: "A plausible room/plate IR is exponentially-decaying filtered noise: dense random reflections whose amplitude envelope falls at a rate set by the desired RT60, low-passed for air absorption.",
        citation: { title: "Statistical reverberation models", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed. (reverberation)", authority: 90 },
      },
      {
        text: "Full-length IRs (~2 s = 88k taps) need partitioned FFT convolution, but a short character IR (10-40 ms) convolves directly within a per-sample real-time budget.",
        citation: { title: "Partitioned convolution tradeoffs", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "reverb",
      title: "Convolution reverb (procedurally-synthesized room IR, direct FIR — 1024 taps)",
      parameters: [
        { id: "size", name: "Size", min: 0.1, max: 1, defaultValue: 0.6, unit: "ratio" },
        { id: "decay", name: "Decay", min: 0.1, max: 0.98, defaultValue: 0.7, unit: "ratio" },
        { id: "tone", name: "Tone", min: 800, max: 12000, defaultValue: 5000, unit: "Hz" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
      ],
      // The IR lives in a buffer allocated ONCE (init guard); it is refilled
      // in place (no allocation) only when Size/Decay/Tone change, so a swept
      // knob costs one refill per render, not one per sample. Direct FIR
      // convolution then reads the pre-built IR every sample. No file load:
      // the "measured" IR is synthesized as decaying, tone-shaped noise.
      body: `if (!state.init) {
  state.ir = new Float32Array(1024);
  state.buf = new Float32Array(1024);
  state.w = 0;
  state.key = -1;
  state.init = true;
}
let size = params.size !== undefined ? params.size : 0.6;
let decay = params.decay !== undefined ? params.decay : 0.7;
let tone = params.tone !== undefined ? params.tone : 5000;
let mix = params.mix !== undefined ? params.mix : 0.35;
let key = Math.round(size * 200) * 100000 + Math.round(decay * 1000) * 100 + Math.round(tone / 120);
if (key !== state.key) {
  let taps = Math.max(64, Math.floor(size * 1024));
  let rng = 22222;
  let lp = 0;
  let toneA = 1 - Math.exp(-2 * Math.PI * tone / 44100);
  let decayRate = 3 + (1 - decay) * 60;
  let norm = 0;
  for (let k = 0; k < 1024; k++) {
    if (k < taps) {
      rng = (rng * 1664525 + 1013904223) | 0;
      let wn = (rng / 2147483648);
      let env = Math.exp(-decayRate * k / taps);
      lp += toneA * (wn - lp);
      let early = k < 6 ? 0.9 : 0;
      let v = (lp + early * wn) * env;
      state.ir[k] = v;
      norm += v * v;
    } else {
      state.ir[k] = 0;
    }
  }
  let g = norm > 1e-9 ? 0.7 / Math.sqrt(norm) : 0;
  for (let k = 0; k < taps; k++) state.ir[k] *= g;
  state.key = key;
}
state.buf[state.w] = inputSample;
let acc = 0;
for (let k = 0; k < 1024; k++) {
  let idx = state.w - k;
  if (idx < 0) idx += 1024;
  acc += state.ir[k] * state.buf[idx];
}
state.w = (state.w + 1) % 1024;
return Math.tanh(inputSample * (1 - mix) + acc * mix * 1.4);`,
    },
  },
  {
    concept: "mid-side",
    area: "Compressors",
    match: /mid.?side|\bm\/s\b|stereo.?(?:width|link|linking|image)/i,
    claims: [
      {
        text: "Mid-side processing encodes L/R into sum (mid) and difference (side) channels so dynamics or EQ can treat center and width independently; decoding is L = M+S, R = M-S.",
        citation: { title: "M/S matrixing", source: "Wikipedia: Joint (audio engineering)", url: "https://en.wikipedia.org/wiki/Joint_(audio_engineering)", authority: 75 },
      },
      {
        text: "Detecting on the MID channel and applying the same gain to both outputs is stereo LINKING — it prevents the image from lurching left/right when one side gets loud.",
        citation: { title: "Stereo-linked dynamics", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
    ],
    proposedModule: {
      family: "dynamics",
      title: "Mid-side glue compressor (mid-detected linked gain, width control on the side channel)",
      parameters: [
        { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -24, unit: "dB" },
        { id: "ratio", name: "Ratio", min: 1, max: 12, defaultValue: 3, unit: ":1" },
        { id: "width", name: "Width", min: 0, max: 2, defaultValue: 1.2, unit: "x" },
        { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 4, unit: "dB" },
      ],
      body: `if (!state.init) { state.env = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -24;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 3);
let width = params.width !== undefined ? params.width : 1.2;
let makeup = params.makeup !== undefined ? params.makeup : 4;
let inR = inputR !== undefined ? inputR : inputSample;
let mid = (inputSample + inR) * 0.5;
let side = (inputSample - inR) * 0.5;
let x = Math.abs(mid);
state.env += (x > state.env ? 0.004 : 0.0005) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let grDb = overDb > 0 ? overDb * (1 - 1 / ratio) : 0;
let g = Math.pow(10, (-grDb + makeup) / 20);
let m2 = mid * g;
let s2 = side * width * g;
state.outR = Math.tanh(m2 - s2);
return Math.tanh(m2 + s2);`,
    },
  },
  /* ================================================================ */
  {
    concept: "ping-pong",
    area: "Delays",
    match: /ping.?pong|bouncing\s*(?:delay|echo)|stereo\s*(?:delay|echo)|alternat\w*\s*(?:delay|echo)/i,
    claims: [
      {
        text: "A ping-pong delay cross-feeds two delay lines: the input enters the left line, the left tap regenerates into the right line and the right back into the left, so each repeat alternates sides.",
        citation: { title: "Cross-coupled delay networks", ...JOS_PASP },
      },
    ],
    proposedModule: {
      family: "delay",
      title: "Ping-pong delay (cross-fed L/R lines, alternating repeats, width control)",
      parameters: [
        { id: "time", name: "Time", min: 50, max: 1200, defaultValue: 350, unit: "ms" },
        { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.45, unit: "ratio" },
        { id: "width", name: "Width", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
      ],
      body: `if (!state.init) { state.bufL = new Float32Array(96000); state.bufR = new Float32Array(96000); state.p = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 350;
let fb = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.45);
let width = params.width !== undefined ? params.width : 1;
let mix = params.mix !== undefined ? params.mix : 0.35;
let inR = inputR !== undefined ? inputR : inputSample;
let x = (inputSample + inR) * 0.5;
let d = Math.max(1, Math.min(52900, Math.floor(time * 44.1)));
let read = (state.p - d + 96000) % 96000;
let wetL = state.bufL[read];
let wetR = state.bufR[read];
state.bufL[state.p] = x + wetR * fb;
state.bufR[state.p] = wetL * fb;
state.p = (state.p + 1) % 96000;
let ms = (wetL + wetR) * 0.5;
let wl = ms + (wetL - ms) * width;
let wr = ms + (wetR - ms) * width;
state.outR = Math.tanh(inR * (1 - mix) + wr * mix * 1.3);
return Math.tanh(inputSample * (1 - mix) + wl * mix * 1.3);`,
    },
  },
  {
    concept: "spectral-processing",
    area: "Pitch & Time",
    match: /spectral|\bfft\b|frequency.?domain|spectral\s*(?:gate|freeze|transient|tilt)/i,
    claims: [
      {
        text: "Spectral processors window the signal into overlapping blocks, transform each with an FFT, operate on the magnitude/phase bins, and resynthesize by inverse-FFT and overlap-add.",
        citation: { title: "The short-time Fourier transform", source: "J.O. Smith, Spectral Audio Signal Processing (CCRMA)", url: "https://ccrma.stanford.edu/~jos/sasp/", authority: 95 },
      },
      {
        text: "A Hann analysis window at 50% hop satisfies the constant-overlap-add condition, so an identity spectral operation reconstructs the input exactly (no synthesis window needed).",
        citation: { title: "COLA and overlap-add reconstruction", source: "J.O. Smith, Spectral Audio Signal Processing (CCRMA)", url: "https://ccrma.stanford.edu/~jos/sasp/", authority: 95 },
      },
      {
        text: "A spectral gate attenuates bins whose magnitude falls below a threshold — a denoiser/detail control — while a spectral tilt scales bin magnitudes along frequency.",
        citation: { title: "Spectral-domain effects", source: "U. Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed.", authority: 90 },
      },
    ],
    proposedModule: {
      family: "modulation",
      title: "Spectral gate + tilt (streaming 256-pt STFT, Hann/50% overlap-add, inline radix-2 FFT)",
      parameters: [
        { id: "threshold", name: "Threshold", min: 0, max: 0.5, defaultValue: 0.08, unit: "ratio" },
        { id: "tilt", name: "Tilt", min: -1, max: 1, defaultValue: 0, unit: "ratio" },
        { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.7, unit: "ratio" },
      ],
      // A genuine streaming STFT inside the per-sample contract: input and an
      // overlap-add accumulator are ring buffers; every hop (N/2) samples one
      // frame is windowed, FFT'd, spectrally processed, inverse-FFT'd, and
      // added back. Latency is one block (~5.8 ms). All buffers are allocated
      // once (init guard); the FFT runs in place on pre-allocated arrays.
      body: `if (!state.init) {
  state.N = 256; state.H = 128;
  state.inr = new Float32Array(256);
  state.acc = new Float32Array(256);
  state.re = new Float32Array(256);
  state.im = new Float32Array(256);
  state.win = new Float32Array(256);
  for (let n = 0; n < 256; n++) state.win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / 256);
  state.ip = 0; state.cnt = 0;
  state.init = true;
}
let threshold = params.threshold !== undefined ? params.threshold : 0.08;
let tilt = params.tilt !== undefined ? params.tilt : 0;
let mix = params.mix !== undefined ? params.mix : 0.7;
let N = 256, H = 128;
state.inr[state.ip] = inputSample;
let y = state.acc[state.ip];
state.acc[state.ip] = 0;
state.ip = (state.ip + 1) % N;
state.cnt++;
if (state.cnt >= H) {
  state.cnt = 0;
  let re = state.re, im = state.im;
  for (let j = 0; j < N; j++) { re[j] = state.inr[(state.ip + j) % N] * state.win[j]; im[j] = 0; }
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let tr = re[i]; re[i] = re[j]; re[j] = tr; let ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= N; len <<= 1) {
    let ang = -2 * Math.PI / len; let wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < (len >> 1); k++) {
        let ar = re[i + k], ai = im[i + k];
        let brr = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        let bii = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ar + brr; im[i + k] = ai + bii;
        re[i + k + (len >> 1)] = ar - brr; im[i + k + (len >> 1)] = ai - bii;
        let ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  let maxMag = 1e-9;
  for (let b = 0; b <= (N >> 1); b++) { let mg = Math.sqrt(re[b] * re[b] + im[b] * im[b]); if (mg > maxMag) maxMag = mg; }
  let gate = threshold * maxMag;
  for (let b = 0; b <= (N >> 1); b++) {
    let mg = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    let g = mg < gate ? 0 : 1;
    let t = 1 + tilt * (b / (N >> 1) - 0.5) * 2; if (t < 0) t = 0;
    g *= t;
    re[b] *= g; im[b] *= g;
    if (b > 0 && b < (N >> 1)) { re[N - b] *= g; im[N - b] *= g; }
  }
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let tr = re[i]; re[i] = re[j]; re[j] = tr; let ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= N; len <<= 1) {
    let ang = 2 * Math.PI / len; let wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < (len >> 1); k++) {
        let ar = re[i + k], ai = im[i + k];
        let brr = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        let bii = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ar + brr; im[i + k] = ai + bii;
        re[i + k + (len >> 1)] = ar - brr; im[i + k + (len >> 1)] = ai - bii;
        let ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  for (let j = 0; j < N; j++) state.acc[(state.ip + j) % N] += re[j] / N;
}
return Math.tanh(inputSample * (1 - mix) + y * mix);`,
    },
  },
  /* ================================================================ */
  /* TEST-ONLY FIXTURES -- not a real DSP concept, never surfaced to    */
  /* users, never meant to be promoted into dspTopologies.ts.           */
  /*                                                                    */
  /* researchEngineTest.ts's "pending research changes nothing / approval */
  /* extends coverage / rejection changes nothing" lifecycle checks used  */
  /* to borrow a real-but-temporary corpus gap (phaser, then parallel-    */
  /* compression, then multi-tap) and each one broke the moment that       */
  /* concept legitimately shipped as a topology. These two fixtures decouple */
  /* "does the approval boundary work correctly" (an evergreen engine        */
  /* behavior) from "which real DSP concepts are still missing" (a moving   */
  /* target that shrinks as the corpus matures) -- they can never be         */
  /* promoted out from under the test because nothing real ever matches     */
  /* their deliberately synthetic concept names or match regexes.           */
  /* ================================================================ */
  {
    concept: "test-lifecycle-fixture-a",
    area: "Utility",
    match: /\btest.?lifecycle.?fixture.?a\b/i,
    claims: [
      { text: "Synthetic test fixture -- exercises the pending -> approved research lifecycle. Not a real DSP finding.", citation: { title: "Internal test fixture", source: "tests/researchEngineTest.ts", authority: 100 } },
      { text: "This concept is deliberately never promoted into dspTopologies.ts, so it stays a genuine pending-research example indefinitely.", citation: { title: "Internal test fixture", source: "tests/researchEngineTest.ts", authority: 100 } },
    ],
    proposedModule: {
      family: "utility",
      title: "Test fixture A (trivial gain trim -- never meant to ship to real users)",
      parameters: [{ id: "gain", name: "Gain", min: -24, max: 24, defaultValue: 0, unit: "dB" }],
      body: `if (!state.init) { state.init = true; }
let gain = params.gain !== undefined ? params.gain : 0;
let g = Math.pow(10, gain / 20);
return inputSample * g;`,
    },
  },
  {
    concept: "test-lifecycle-fixture-b",
    area: "Utility",
    match: /\btest.?lifecycle.?fixture.?b\b/i,
    claims: [
      { text: "Synthetic test fixture -- exercises the rejection lifecycle (rejecting research must change nothing). Not a real DSP finding.", citation: { title: "Internal test fixture", source: "tests/researchEngineTest.ts", authority: 100 } },
      { text: "This concept is deliberately never promoted into dspTopologies.ts, so it stays a genuine pending-research example indefinitely.", citation: { title: "Internal test fixture", source: "tests/researchEngineTest.ts", authority: 100 } },
    ],
    proposedModule: {
      family: "utility",
      title: "Test fixture B (trivial gain trim -- never meant to ship to real users)",
      parameters: [{ id: "gain", name: "Gain", min: -24, max: 24, defaultValue: 0, unit: "dB" }],
      body: `if (!state.init) { state.init = true; }
let gain = params.gain !== undefined ? params.gain : 0;
let g = Math.pow(10, gain / 20);
return inputSample * g;`,
    },
  },
];

export function corpusEntriesFor(concept: string): CorpusEntry[] {
  const needle = concept.toLowerCase();
  return RESEARCH_CORPUS.filter(
    (e) => e.concept === needle || e.concept.includes(needle) || needle.includes(e.concept) || e.match.test(concept)
  );
}
