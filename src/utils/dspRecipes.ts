/**
 * Golden DSP recipe library.
 *
 * Local models write dramatically better DSP when shown a proven reference
 * implementation of the effect family they're being asked for -- they adapt
 * good structure instead of inventing broken comb filters from scratch. Each
 * recipe here is a complete, verified dspFunction body (they are run through
 * the quality gate in tests and score >= 97) plus the pitfalls models most
 * often hit for that effect family.
 *
 * buildRecipeContext() detects the requested effect family from the user's
 * prompt and returns ONE compact reference block to append to the model's
 * user message -- or "" when nothing matches, keeping prompts lean.
 */

import { PluginParameter } from "../types";
import { AudioPluginSpec, PluginFamily } from "./pluginSpec";
import { findCandidateRecipe } from "./recipeMemory";

export interface DspRecipe {
  id: string;
  title: string;
  /** Matched against the user's natural-language request. */
  match: RegExp;
  parameters: Array<Pick<PluginParameter, "id" | "name" | "min" | "max" | "defaultValue" | "unit">>;
  body: string;
  pitfalls: string[];
}

export const DSP_RECIPES: DspRecipe[] = [
  {
    id: "reverb",
    title: "Schroeder reverb (4 parallel prime-length combs -> 2 series allpasses)",
    match: /reverb|verb\b|room|hall|plate|shimmer|space|ambien|cathedral/i,
    parameters: [
      { id: "decay", name: "Decay", min: 0, max: 0.95, defaultValue: 0.75, unit: "ratio" },
      { id: "damp", name: "Damping", min: 0, max: 0.9, defaultValue: 0.4, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.3, unit: "ratio" },
    ],
    body: `if (!state.init) {
  state.c0 = new Float32Array(1557); state.c1 = new Float32Array(1617);
  state.c2 = new Float32Array(1491); state.c3 = new Float32Array(1422);
  state.i0 = 0; state.i1 = 0; state.i2 = 0; state.i3 = 0;
  state.d0 = 0; state.d1 = 0; state.d2 = 0; state.d3 = 0;
  state.a1 = new Float32Array(225); state.a1i = 0;
  state.a2 = new Float32Array(556); state.a2i = 0;
  state.init = true;
}
let decay = params.decay !== undefined ? params.decay : 0.75;
let damp = params.damp !== undefined ? params.damp : 0.4;
let mix = params.mix !== undefined ? params.mix : 0.3;
let hf = 1 - damp * 0.8;
let y0 = state.c0[state.i0]; state.d0 += hf * (y0 - state.d0); state.c0[state.i0] = inputSample + state.d0 * decay; state.i0 = (state.i0 + 1) % 1557;
let y1 = state.c1[state.i1]; state.d1 += hf * (y1 - state.d1); state.c1[state.i1] = inputSample + state.d1 * decay; state.i1 = (state.i1 + 1) % 1617;
let y2 = state.c2[state.i2]; state.d2 += hf * (y2 - state.d2); state.c2[state.i2] = inputSample + state.d2 * decay; state.i2 = (state.i2 + 1) % 1491;
let y3 = state.c3[state.i3]; state.d3 += hf * (y3 - state.d3); state.c3[state.i3] = inputSample + state.d3 * decay; state.i3 = (state.i3 + 1) % 1422;
let s = (y0 + y1 + y2 + y3) * 0.25;
let ap1 = state.a1[state.a1i];
let x1 = s + ap1 * 0.5;
state.a1[state.a1i] = x1;
s = ap1 - x1 * 0.5;
state.a1i = (state.a1i + 1) % 225;
let ap2 = state.a2[state.a2i];
let x2 = s + ap2 * 0.5;
state.a2[state.a2i] = x2;
s = ap2 - x2 * 0.5;
state.a2i = (state.a2i + 1) % 556;
return Math.tanh(inputSample * (1 - mix) + s * mix * 1.6);`,
    pitfalls: [
      "A single short comb filter sounds like a metal pipe, not a room -- use 4+ parallel combs with mutually PRIME lengths plus 1-2 series allpasses.",
      "Put a one-pole damping lowpass INSIDE each comb's feedback loop (real rooms lose highs faster than lows).",
      "Clamp decay/feedback below 1.0 or the tail grows forever.",
    ],
  },
  {
    id: "delay",
    title: "Tape-style feedback delay (damped loop, dry/wet mix)",
    match: /delay|echo|slapback|ping.?pong|dub\b|tape/i,
    parameters: [
      { id: "time", name: "Time", min: 20, max: 1500, defaultValue: 350, unit: "ms" },
      { id: "feedback", name: "Feedback", min: 0, max: 0.95, defaultValue: 0.45, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
    ],
    body: `if (!state.init) { state.buf = new Float32Array(96000); state.ptr = 0; state.damp = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 350;
let fb = Math.min(0.95, params.feedback !== undefined ? params.feedback : 0.45);
let mix = params.mix !== undefined ? params.mix : 0.35;
let d = Math.max(1, Math.min(95999, Math.floor(time * 44.1)));
let read = (state.ptr - d + 96000) % 96000;
let wet = state.buf[read];
state.damp += 0.4 * (wet - state.damp);
state.buf[state.ptr] = inputSample + state.damp * fb;
state.ptr = (state.ptr + 1) % 96000;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    pitfalls: [
      "Wrap ring-buffer indices with modulo and clamp the delay length inside the buffer size.",
      "Clamp feedback below ~0.95 and put a gentle lowpass in the loop so repeats decay warmly instead of building harshness.",
      "Keep a dry path: a delay with no dry signal sounds broken at defaults.",
    ],
  },
  {
    id: "modulation",
    title: "Chorus (LFO-modulated fractional delay with linear interpolation)",
    match: /chorus|flang|phaser|vibrato|tremolo|modulat|wobble|ensemble|leslie|rotary/i,
    parameters: [
      { id: "rate", name: "Rate", min: 0.05, max: 8, defaultValue: 0.8, unit: "Hz" },
      { id: "depth", name: "Depth", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
    ],
    body: `if (!state.init) { state.buf = new Float32Array(4410); state.ptr = 0; state.ph = 0; state.init = true; }
let rate = params.rate !== undefined ? params.rate : 0.8;
let depth = params.depth !== undefined ? params.depth : 0.5;
let mix = params.mix !== undefined ? params.mix : 0.5;
state.buf[state.ptr] = inputSample;
state.ph += 2 * Math.PI * rate / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
let delaySamp = 330 + Math.sin(state.ph) * 220 * depth;
let readPos = state.ptr - delaySamp;
while (readPos < 0) readPos += 4410;
let i0 = Math.floor(readPos) % 4410;
let i1 = (i0 + 1) % 4410;
let frac = readPos - Math.floor(readPos);
let wet = state.buf[i0] * (1 - frac) + state.buf[i1] * frac;
state.ptr = (state.ptr + 1) % 4410;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    pitfalls: [
      "Fractional delay reads MUST interpolate (linear at minimum) or the modulation crackles.",
      "Advance the LFO phase per sample and wrap it; recomputing from a global time float loses precision over minutes.",
      "Keep the modulated delay center offset larger than the modulation depth so the read never crosses the write head.",
    ],
  },
  {
    id: "dynamics",
    title: "Feed-forward compressor (dB-domain envelope, attack/release, makeup)",
    match: /compress|limiter|dynamics|squash|punch|glue|expander|gate\b|sidechain|duck/i,
    parameters: [
      { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -24, unit: "dB" },
      { id: "ratio", name: "Ratio", min: 1, max: 20, defaultValue: 4, unit: ":1" },
      { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 3, unit: "dB" },
    ],
    body: `if (!state.init) { state.env = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -24;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 4);
let makeup = params.makeup !== undefined ? params.makeup : 3;
let x = Math.abs(inputSample);
let coeff = x > state.env ? 0.003 : 0.0004;
state.env += coeff * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let gainDb = overDb > 0 ? -overDb * (1 - 1 / ratio) : 0;
let g = Math.pow(10, (gainDb + makeup) / 20);
return Math.tanh(inputSample * g);`,
    pitfalls: [
      "Track the envelope with SEPARATE attack and release coefficients; a single coefficient pumps.",
      "Compute gain reduction in the dB domain, then convert back with Math.pow(10, dB/20).",
      "Guard the log: Math.log10(Math.max(1e-6, env)) -- log of 0 is -Infinity and poisons the whole chain.",
    ],
  },
  {
    id: "eq",
    title: "3-band parametric EQ (one-pole crossovers, per-band gain, sweepable mid)",
    match: /\beq\b|equali[sz]er|parametric|band gain|tone.?shap/i,
    parameters: [
      { id: "low", name: "Low", min: -12, max: 12, defaultValue: 3, unit: "dB" },
      { id: "mid", name: "Mid", min: -12, max: 12, defaultValue: 4, unit: "dB" },
      { id: "midFreq", name: "Mid Freq", min: 250, max: 5000, defaultValue: 1200, unit: "Hz" },
      { id: "high", name: "High", min: -12, max: 12, defaultValue: 3, unit: "dB" },
    ],
    body: `if (!state.init) { state.l1 = 0; state.l2 = 0; state.sm = 1200; state.init = true; }
let low = params.low !== undefined ? params.low : 3;
let mid = params.mid !== undefined ? params.mid : 4;
let midFreq = params.midFreq !== undefined ? params.midFreq : 1200;
let high = params.high !== undefined ? params.high : 3;
state.sm += 0.002 * (midFreq - state.sm);
let a1 = 1 - Math.exp(-2 * Math.PI * 300 / 44100);
state.l1 += a1 * (inputSample - state.l1);
let split2 = Math.min(8000, state.sm * 1.6);
let a2 = 1 - Math.exp(-2 * Math.PI * split2 / 44100);
state.l2 += a2 * (inputSample - state.l2);
let lowB = state.l1;
let midB = state.l2 - state.l1;
let highB = inputSample - state.l2;
let out = lowB * Math.pow(10, low / 20) + midB * Math.pow(10, mid / 20) + highB * Math.pow(10, high / 20);
return Math.tanh(out);`,
    pitfalls: [
      "Split into REAL bands (crossover filters) and apply gain per band — a single lowpass with a gain knob is not an EQ.",
      "Convert dB gains with Math.pow(10, dB/20); adding raw dB values to samples is a classic blowup.",
      "Smooth the sweepable mid-frequency per sample or the crossover zippers audibly.",
      "Keep default gains modestly boosted (not 0 dB) so every band knob is audibly doing something on first play.",
    ],
  },
  {
    id: "filter",
    title: "State-variable resonant lowpass (smoothed cutoff, stable coefficients)",
    match: /filter|cutoff|lowpass|low.?pass|highpass|high.?pass|bandpass|wah|eq\b|equali[sz]|tone.?shap|resonan/i,
    parameters: [
      { id: "cutoff", name: "Cutoff", min: 60, max: 12000, defaultValue: 1400, unit: "Hz" },
      { id: "resonance", name: "Resonance", min: 0, max: 0.9, defaultValue: 0.4, unit: "ratio" },
    ],
    body: `if (!state.init) { state.low = 0; state.band = 0; state.smF = 1400; state.init = true; }
let cutoff = params.cutoff !== undefined ? params.cutoff : 1400;
let res = params.resonance !== undefined ? params.resonance : 0.4;
state.smF += 0.002 * (cutoff - state.smF);
let f = 2 * Math.sin(Math.PI * Math.min(0.22, state.smF / 44100));
let q = 1.2 - res;
state.low += f * state.band;
let high = inputSample - state.low - q * state.band;
state.band += f * high;
return Math.tanh(state.low);`,
    pitfalls: [
      "Clamp the frequency coefficient (f < ~0.25 for a Chamberlin SVF) or the filter explodes above ~10 kHz.",
      "Smooth the cutoff per sample (state.smF += 0.002 * (target - state.smF)) -- jumping coefficients zipper audibly.",
      "Map resonance so damping never reaches 0; q = 1.2 - res with res <= 0.9 stays stable.",
    ],
  },
  {
    id: "distortion",
    title: "Soft-clip drive (dB drive, gain compensation, post-tone lowpass)",
    match: /dist|fuzz|drive|satur|crunch|clip|warm|grit|amp\b|overdrive|screamer|bitcrush|lo.?fi/i,
    parameters: [
      { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 8, unit: "dB" },
      { id: "tone", name: "Tone", min: 500, max: 12000, defaultValue: 4500, unit: "Hz" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.lp = 0; state.smDrive = 8; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 8;
let tone = params.tone !== undefined ? params.tone : 4500;
let mix = params.mix !== undefined ? params.mix : 1;
state.smDrive += 0.002 * (drive - state.smDrive);
let g = Math.pow(10, state.smDrive / 20);
let wet = Math.tanh(inputSample * g) / Math.pow(g, 0.65);
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (wet - state.lp);
wet = state.lp;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    pitfalls: [
      "Compensate the drive gain (divide by ~g^0.65) or turning Drive up just makes it louder, not more distorted.",
      "Follow the clipper with a gentle lowpass -- raw tanh harmonics above ~8 kHz read as harsh fizz.",
      "Smooth the drive value per sample so automation doesn't zipper.",
    ],
  },
  {
    id: "sampler",
    title: "8-voice pad-triggered synth (held-gate voices, not one-shot samples -- this engine has no file playback)",
    match: /sampler|sample\s*pad|drum\s*pad|beat\s*pad|\bmpc\b|pad\s*machine|drum\s*machine|finger\s*drum/i,
    parameters: [
      { id: "pad_1", name: "Pad 1 - Kick", min: 0, max: 127, defaultValue: 127, unit: "vel" },
      { id: "pad_2", name: "Pad 2 - Sub Tom", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_3", name: "Pad 3 - Snare", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_4", name: "Pad 4 - Tom", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_5", name: "Pad 5 - Perc", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_6", name: "Pad 6 - Hat", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_7", name: "Pad 7 - Clap", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "pad_8", name: "Pad 8 - Bell", min: 0, max: 127, defaultValue: 0, unit: "vel" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.9, unit: "ratio" },
    ],
    body: `if (!state.init) {
  state.p1 = 0; state.p2 = 0; state.p4 = 0; state.p5 = 0; state.p7 = 0; state.p8 = 0;
  state.n3 = 0; state.n6 = 0;
  state.init = true;
}
let mix = params.mix !== undefined ? params.mix : 0.9;
let sum = 0;
if (params.pad_1) {
  state.p1 += 2 * Math.PI * 55 / 44100; if (state.p1 > 2 * Math.PI) state.p1 -= 2 * Math.PI;
  sum += Math.sin(state.p1) * 0.95 * (params.pad_1 / 127);
}
if (params.pad_2) {
  state.p2 += 2 * Math.PI * 82 / 44100; if (state.p2 > 2 * Math.PI) state.p2 -= 2 * Math.PI;
  sum += Math.sin(state.p2) * 0.8 * (params.pad_2 / 127);
}
if (params.pad_3) {
  let noise = (Math.random() * 2 - 1);
  state.n3 += 0.5 * (noise - state.n3);
  sum += state.n3 * 0.6 * (params.pad_3 / 127);
}
if (params.pad_4) {
  state.p4 += 2 * Math.PI * 220 / 44100; if (state.p4 > 2 * Math.PI) state.p4 -= 2 * Math.PI;
  sum += Math.sin(state.p4) * 0.6 * (params.pad_4 / 127);
}
if (params.pad_5) {
  state.p5 += 2 * Math.PI * 330 / 44100; if (state.p5 > 2 * Math.PI) state.p5 -= 2 * Math.PI;
  sum += Math.sin(state.p5) * 0.55 * (params.pad_5 / 127);
}
if (params.pad_6) {
  let noise2 = (Math.random() * 2 - 1);
  state.n6 += 0.85 * (noise2 - state.n6);
  sum += state.n6 * 0.35 * (params.pad_6 / 127);
}
if (params.pad_7) {
  state.p7 += 2 * Math.PI * 440 / 44100; if (state.p7 > 2 * Math.PI) state.p7 -= 2 * Math.PI;
  sum += Math.sin(state.p7) * 0.45 * (params.pad_7 / 127);
}
if (params.pad_8) {
  state.p8 += 2 * Math.PI * 660 / 44100; if (state.p8 > 2 * Math.PI) state.p8 -= 2 * Math.PI;
  sum += Math.sin(state.p8) * 0.4 * (params.pad_8 / 127);
}
return Math.tanh(sum * mix);`,
    pitfalls: [
      "This engine has no sample/file playback -- a 'sampler' here means an 8-voice synthesized pad instrument, NOT real WAV loading. Never claim to load audio files.",
      "Pads must be additive and independent (one pad's state must never reset another's) -- use a separate phase/noise-smoother state variable PER pad.",
      "At least one pad should default ON (nonzero defaultValue) so the plugin is audible immediately without the user pressing anything first.",
      "Divide each pad's velocity by 127 so 0-127 MIDI-style range maps to a sane 0-1 amplitude multiplier.",
      "Guard every phase accumulator with a wrap (if (phase > 2*PI) phase -= 2*PI) -- unbounded growth loses float precision over a long session.",
    ],
  },
  {
    id: "pitch",
    title: "Autotune (autocorrelation F0 detection -> key/scale snap -> formant-preserving resynthesis)",
    match: /pitch|autotune|auto.?tune|harmoni[sz]er|octav(?:e|iz)|transpose|detune.?voice|tuner|retune|correct(?:ion)?/i,
    parameters: [
      { id: "key", name: "Key", min: 0, max: 12, defaultValue: 0, unit: "" },
      { id: "scale", name: "Scale", min: 0, max: 3, defaultValue: 1, unit: "" },
      { id: "speed", name: "Retune Speed", min: 0, max: 100, defaultValue: 20, unit: "ms" },
      { id: "formant", name: "Formant", min: -12, max: 12, defaultValue: 0, unit: "st" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) {
  state.buf = new Float32Array(4096);
  state.wp = 0;
  state.rp1 = 0;
  state.rp2 = 1024; // half a grain (GRAIN/2) apart so the two Hann windows sum to 1.0
  state.hop = 0;
  state.detF = 220;
  state.ratio = 1;
  state.pc = new Float32Array(12);
  state.dl1 = 0; state.dl2 = 0; state.wl1 = 0; state.wl2 = 0;
  state.deLo = 0; state.deMid = 0; state.deHi = 0;
  state.weLo = 0; state.weMid = 0; state.weHi = 0;
  state.init = true;
}
let BUF = 4096;
let GRAIN = 2048;
let key = params.key !== undefined ? params.key : 0;
let scale = params.scale !== undefined ? params.scale : 1;
let speed = params.speed !== undefined ? params.speed : 20;
let formant = params.formant !== undefined ? params.formant : 0;
let mix = params.mix !== undefined ? params.mix : 1;

// 1. Write the dry sample into the analysis/resynthesis ring.
let dry = inputSample;
state.buf[state.wp] = dry;
state.wp = (state.wp + 1) % BUF;

// 2. Detect the fundamental every 512 samples via normalized autocorrelation.
//    Hold the previous estimate on near-silence so gaps never divide by zero.
state.hop++;
if (state.hop >= 512) {
  state.hop = 0;
  let N = 512;
  let energy = 0;
  for (let n = 0; n < N; n++) {
    let s = state.buf[(state.wp - 1 - n + BUF + BUF) % BUF];
    energy += s * s;
  }
  if (energy > 1e-3) {
    let bestLag = 0;
    let bestCorr = 0;
    for (let lag = 44; lag <= 551; lag++) {
      let corr = 0;
      for (let n = 0; n < N; n += 2) {
        let a = state.buf[(state.wp - 1 - n + BUF + BUF) % BUF];
        let b = state.buf[(state.wp - 1 - n - lag + BUF + BUF + BUF) % BUF];
        corr += a * b;
      }
      corr = corr / (energy + 1e-9);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag > 0 && bestCorr > 0.25) {
      state.detF = 44100 / bestLag;
      let midiD = 69 + 12 * Math.log(state.detF / 440) / Math.log(2);
      let pcls = ((Math.round(midiD) % 12) + 12) % 12;
      for (let k = 0; k < 12; k++) state.pc[k] *= 0.995;
      state.pc[pcls] += 1;
    }
  }
}

// 3. Snap the detected note to the selected key + scale (0=Auto key uses the
//    accumulated pitch-class histogram). Scale masks are 12-bit note sets.
let tonic;
if (key <= 0.5) {
  let bestPc = 0; let bestVal = -1;
  for (let k = 0; k < 12; k++) { if (state.pc[k] > bestVal) { bestVal = state.pc[k]; bestPc = k; } }
  tonic = bestPc;
} else {
  tonic = (Math.round(key) - 1) % 12;
}
let sc = Math.round(scale);
let mask = 4095;              // chromatic
if (sc === 1) mask = 2741;   // major     {0,2,4,5,7,9,11}
else if (sc === 2) mask = 1453; // minor  {0,2,3,5,7,8,10}
else if (sc >= 3) mask = 661;   // penta  {0,2,4,7,9}
let midiIn = 69 + 12 * Math.log(state.detF / 440) / Math.log(2);
let nearMidi = Math.round(midiIn);
let rel = ((nearMidi - tonic) % 12 + 12) % 12;
let snapRel = rel;
for (let r = 0; r <= 6; r++) {
  let up = (rel + r) % 12;
  let dn = (rel - r + 12) % 12;
  if ((mask >> up) & 1) { snapRel = up; break; }
  if ((mask >> dn) & 1) { snapRel = dn; break; }
}
let snappedMidi = nearMidi - rel + snapRel;
let targetF = 440 * Math.pow(2, (snappedMidi - 69) / 12);
let target = targetF / (state.detF + 1e-9);
if (target < 0.5) target = 0.5;
if (target > 2) target = 2;

// 4. Retune speed: glide the resample ratio toward the target (0 ms = instant).
let alpha = speed < 0.5 ? 1 : 1 - Math.exp(-1 / (speed * 0.001 * 44100 + 1));
state.ratio += alpha * (target - state.ratio);
let ratio = state.ratio;

// 5. Resynthesize at the corrected pitch: two Hann-windowed read heads a half
//    grain apart, summing to 1.0, advanced by the (dynamic) correction ratio.
let i0a = Math.floor(state.rp1) % BUF; if (i0a < 0) i0a += BUF;
let i1a = (i0a + 1) % BUF;
let fracA = state.rp1 - Math.floor(state.rp1);
let sampleA = state.buf[i0a] * (1 - fracA) + state.buf[i1a] * fracA;
let i0b = Math.floor(state.rp2) % BUF; if (i0b < 0) i0b += BUF;
let i1b = (i0b + 1) % BUF;
let fracB = state.rp2 - Math.floor(state.rp2);
let sampleB = state.buf[i0b] * (1 - fracB) + state.buf[i1b] * fracB;
let posA = state.rp1 % GRAIN; if (posA < 0) posA += GRAIN;
let posB = state.rp2 % GRAIN; if (posB < 0) posB += GRAIN;
let winA = 0.5 - 0.5 * Math.cos((2 * Math.PI * posA) / GRAIN);
let winB = 0.5 - 0.5 * Math.cos((2 * Math.PI * posB) / GRAIN);
let wet = sampleA * winA + sampleB * winB;
state.rp1 += ratio; if (state.rp1 >= BUF) state.rp1 -= BUF; if (state.rp1 < 0) state.rp1 += BUF;
state.rp2 += ratio; if (state.rp2 >= BUF) state.rp2 -= BUF; if (state.rp2 < 0) state.rp2 += BUF;

// 6. Formant preservation: split dry + wet into 3 bands (one-pole crossovers
//    at ~500 Hz and ~2500 Hz), then impose the DRY band envelopes on the wet
//    excitation so the vocal formants stay put while the pitch moves. The
//    Formant knob tilts the low<->high balance for deliberate formant shift.
let a1 = 1 - Math.exp(-2 * Math.PI * 500 / 44100);
let a2 = 1 - Math.exp(-2 * Math.PI * 2500 / 44100);
state.dl1 += a1 * (dry - state.dl1);
state.dl2 += a2 * (dry - state.dl2);
let dLo = state.dl1; let dMid = state.dl2 - state.dl1; let dHi = dry - state.dl2;
state.wl1 += a1 * (wet - state.wl1);
state.wl2 += a2 * (wet - state.wl2);
let wLo = state.wl1; let wMid = state.wl2 - state.wl1; let wHi = wet - state.wl2;
let ea = 0.0015;
state.deLo += ea * (Math.abs(dLo) - state.deLo);
state.deMid += ea * (Math.abs(dMid) - state.deMid);
state.deHi += ea * (Math.abs(dHi) - state.deHi);
state.weLo += ea * (Math.abs(wLo) - state.weLo);
state.weMid += ea * (Math.abs(wMid) - state.weMid);
state.weHi += ea * (Math.abs(wHi) - state.weHi);
let tilt = Math.pow(2, formant / 12);
let tiltRt = Math.sqrt(tilt);
let gLo = (state.deLo / (state.weLo + 1e-4)) / tiltRt;
let gMid = state.deMid / (state.weMid + 1e-4);
let gHi = (state.deHi / (state.weHi + 1e-4)) * tiltRt;
if (gLo > 4) gLo = 4; if (gMid > 4) gMid = 4; if (gHi > 4) gHi = 4;
let wetFC = wLo * gLo + wMid * gMid + wHi * gHi;

// 7. Blend the corrected voice against the dry signal.
return Math.tanh(dry * (1 - mix) + wetFC * mix);`,
    pitfalls: [
      "Detect the fundamental with normalized autocorrelation over a running state buffer (peak lag in the ~80-1000 Hz vocal range), then SNAP it to the selected key/scale and resynth at the corrected pitch -- this is a real tuner, not a fixed pitch shift. Guard detection against silence: when the analysis window energy is near zero, HOLD the previous F0 instead of dividing by it, or the burst/gap material NaNs.",
      "Snap to a note SET, not a fixed offset: represent the scale as a 12-bit mask (chromatic/major/minor/pentatonic) and search outward from the detected pitch class for the nearest allowed degree. Key 0 = Auto: pick the tonic from an accumulated, decaying pitch-class histogram so the plugin follows the performance's key.",
      "Glide the correction ratio toward the target with a Retune Speed coefficient (0 ms = instant/robotic snap, larger = human-like slide); jumping the ratio per detection clicks. Clamp the ratio to +/-1 octave.",
      "Use TWO Hann-windowed read heads a half grain apart (windows sum to 1.0), advanced by the dynamic correction ratio, wrapped independently with modulo; linearly interpolate every fractional read.",
      "Preserve formants by transferring the DRY per-band envelopes onto the pitch-shifted wet (3-band one-pole crossover, dry_env/(wet_env+eps) per band, clamped) -- shifting pitch without this gives chipmunk/monster artifacts. The Formant knob should tilt the band balance so it stays audibly useful even at zero correction.",
    ],
  },
  {
    id: "synth",
    title: "Detuned 2-oscillator pad voice with SVF lowpass (ignores audio input -- a generator, not a processor)",
    match: /\bsynth(?:esizer)?\b|drone|\bpad\b.*(?:synth|sound|voice)|generative|arpegg|oscillator/i,
    parameters: [
      { id: "freq", name: "Root Frequency", min: 55, max: 880, defaultValue: 220, unit: "Hz" },
      { id: "detune", name: "Detune", min: 0, max: 50, defaultValue: 12, unit: "cents" },
      { id: "cutoff", name: "Cutoff", min: 200, max: 8000, defaultValue: 2500, unit: "Hz" },
      { id: "level", name: "Level", min: 0, max: 1, defaultValue: 0.6, unit: "ratio" },
    ],
    body: `if (!state.init) { state.p1 = 0; state.p2 = 0; state.low = 0; state.band = 0; state.init = true; }
let freq = params.freq !== undefined ? params.freq : 220;
let detune = params.detune !== undefined ? params.detune : 12;
let cutoff = params.cutoff !== undefined ? params.cutoff : 2500;
let level = params.level !== undefined ? params.level : 0.6;

let f2 = freq * Math.pow(2, detune / 1200);

state.p1 += 2 * Math.PI * freq / 44100; if (state.p1 > 2 * Math.PI) state.p1 -= 2 * Math.PI;
state.p2 += 2 * Math.PI * f2 / 44100; if (state.p2 > 2 * Math.PI) state.p2 -= 2 * Math.PI;

let osc1 = Math.sin(state.p1) + Math.sin(state.p1 * 2) * 0.5 + Math.sin(state.p1 * 3) * 0.25;
let osc2 = Math.sin(state.p2) + Math.sin(state.p2 * 2) * 0.5 + Math.sin(state.p2 * 3) * 0.25;
let mixed = (osc1 + osc2) * 0.22;

let g = Math.min(0.5, 2 * Math.PI * cutoff / 44100);
state.low += g * state.band;
let high = mixed - state.low - 0.3 * state.band;
state.band += g * high;

return Math.tanh(state.low * level);`,
    pitfalls: [
      "This is a GENERATOR, not an effect -- it must ignore inputSample entirely and produce its own continuous tone from state and params, like the sampler recipe.",
      "Detune the second oscillator in CENTS via Math.pow(2, detune/1200), not a raw Hz offset -- a fixed Hz offset sounds wildly out of tune at low root frequencies and negligible at high ones.",
      "Add a couple of harmonic overtones (sin(phase*2), sin(phase*3)) instead of a bare sine -- a single sine at both oscillators sounds thin and the detune is barely audible.",
      "Run the mixed oscillators through a real lowpass (state-variable filter) tied to a cutoff parameter, not just a raw sum -- otherwise there is no reason for a 'Cutoff' knob to exist.",
    ],
  },
];

/**
 * Fixed dual-tap pitch SHIFTER (the pre-autotune `pitch` recipe). Not part of
 * DSP_RECIPES routing -- autotune requests now get the real tuner above. This
 * lives on as a composition building block for effects that genuinely want a
 * constant transpose, above all shimmer reverb's octave-up tail sheen.
 */
export const PITCH_SHIFT_RECIPE: DspRecipe = {
  id: "pitch_shift",
  title: "Dual-tap delay-line pitch shifter (Hann-crossfaded read heads, fixed transpose)",
  match: /pitch.?shift|octave.?(?:up|down)|transpose/i,
  parameters: [
    { id: "pitch", name: "Pitch Shift", min: -12, max: 12, defaultValue: 7, unit: "st" },
    { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
  ],
  body: `if (!state.init) {
  state.buf = new Float32Array(4096);
  state.wp = 0;
  state.rp1 = 0;
  state.rp2 = 1024; // half a grain (grain/2) apart so the two Hann windows sum to 1.0
  state.init = true;
}
let pitch = params.pitch !== undefined ? params.pitch : 7;
let mix = params.mix !== undefined ? params.mix : 0.5;
let ratio = Math.pow(2, pitch / 12);
let grain = 2048;
let bufLen = 4096;

state.buf[state.wp] = inputSample;
state.wp = (state.wp + 1) % bufLen;

let i0a = Math.floor(state.rp1) % bufLen; if (i0a < 0) i0a += bufLen;
let i1a = (i0a + 1) % bufLen;
let fracA = state.rp1 - Math.floor(state.rp1);
let sampleA = state.buf[i0a] * (1 - fracA) + state.buf[i1a] * fracA;

let i0b = Math.floor(state.rp2) % bufLen; if (i0b < 0) i0b += bufLen;
let i1b = (i0b + 1) % bufLen;
let fracB = state.rp2 - Math.floor(state.rp2);
let sampleB = state.buf[i0b] * (1 - fracB) + state.buf[i1b] * fracB;

let posA = state.rp1 % grain; if (posA < 0) posA += grain;
let posB = state.rp2 % grain; if (posB < 0) posB += grain;
let winA = 0.5 - 0.5 * Math.cos((2 * Math.PI * posA) / grain);
let winB = 0.5 - 0.5 * Math.cos((2 * Math.PI * posB) / grain);

let wet = sampleA * winA + sampleB * winB;

state.rp1 += ratio;
state.rp2 += ratio;
if (state.rp1 >= bufLen) state.rp1 -= bufLen;
if (state.rp1 < 0) state.rp1 += bufLen;
if (state.rp2 >= bufLen) state.rp2 -= bufLen;
if (state.rp2 < 0) state.rp2 += bufLen;

return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
  pitfalls: [
    "This is a FIXED transpose (shifts by the amount you set), not a tuner -- it has no pitch detection or scale snapping. Use the `pitch` autotune recipe for correction.",
    "Use TWO read heads spaced half a grain apart, each with a Hann window (0.5 - 0.5*cos), so their windows sum to exactly 1.0 at every position -- this is what eliminates the clicking a single moving read head would cause when it wraps.",
    "Advance both read pointers by the same fractional ratio (2^(semitones/12)) per sample; wrap them independently with modulo, not relative to the write pointer.",
    "Always linearly interpolate the buffer read (fractional index) -- integer-only reads alias badly at non-octave shift amounts.",
  ],
};

/** Pick the recipe matching a natural-language request (first match wins). */
export function detectRecipe(userPrompt: string): DspRecipe | null {
  for (const recipe of DSP_RECIPES) {
    if (recipe.match.test(userPrompt)) return recipe;
  }
  return null;
}

/** Which recipes cover a given spec family. Hybrids compose several. */
const FAMILY_TO_RECIPES: Partial<Record<PluginFamily, string[]>> = {
  eq: ["eq"],
  filter: ["filter"],
  distortion: ["distortion"],
  saturator: ["distortion"],
  multiband_saturator: ["filter", "distortion"],
  delay: ["delay"],
  reverb: ["reverb"],
  modulation: ["modulation"],
  dynamics: ["dynamics"],
  // Amp sims are fundamentally gain-staged preamp drive + tone shaping --
  // the distortion recipe's structure is the right reference; the mandatory
  // amp head / cab / mic UI is a separate, purely visual enforcement layer.
  amp_sim: ["distortion"],
  sampler: ["sampler"],
  pitch: ["pitch"],
  synthesizer: ["synth"],
};

export interface ScoredRecipe {
  recipe: DspRecipe;
  /** 0..1 confidence following the harness router bands. */
  confidence: number;
}

/**
 * Score-based recipe routing (never binary). Spec-family mapping scores
 * highest; a raw keyword hit still counts when no spec is available. A
 * hybrid spec pulls in EVERY recipe its behavior composes from -- an
 * EQ-looking multiband saturator gets both the filter and the waveshaper
 * references, because its DSP is band isolation + per-band drive.
 */
export function scoreRecipes(userPrompt: string, spec?: AudioPluginSpec | null): ScoredRecipe[] {
  const scored = new Map<string, ScoredRecipe>();

  if (spec) {
    for (const id of FAMILY_TO_RECIPES[spec.family] || []) {
      const recipe = DSP_RECIPES.find((r) => r.id === id);
      if (recipe) scored.set(id, { recipe, confidence: 0.85 });
    }
  }

  for (const recipe of DSP_RECIPES) {
    if (recipe.match.test(userPrompt)) {
      const existing = scored.get(recipe.id);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.1);
      } else {
        scored.set(recipe.id, { recipe, confidence: spec ? 0.55 : 0.75 });
      }
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2); // at most two references keeps the prompt lean
}

function formatRecipeBlock(recipe: DspRecipe, role: string): string {
  const paramList = recipe.parameters
    .map((p) => `{ "id": "${p.id}", "name": "${p.name}", "min": ${p.min}, "max": ${p.max}, "defaultValue": ${p.defaultValue}, "unit": "${p.unit}" }`)
    .join(",\n  ");

  return `[VERIFIED REFERENCE (${role}) -- ${recipe.title}.
Adapt this proven structure to the user's request (rename/add parameters, reshape the character); do not regress to a naive implementation.
Reference parameters:
  ${paramList}
Reference dspFunction body:
${recipe.body}
Known pitfalls for this effect family:
${recipe.pitfalls.map((p, i) => `${i + 1}. ${p}`).join("\n")}]`;
}

/**
 * Reference block(s) to append to the model's user message. Empty string
 * when the request doesn't clearly match an effect family. When a spec is
 * provided, hybrid requests compose multiple recipes, and a matching
 * candidate recipe from past verified builds is included as a third,
 * project-specific reference.
 */
export function buildRecipeContext(userPrompt: string, spec?: AudioPluginSpec | null): string {
  const blocks: string[] = [];

  const scoredList = scoreRecipes(userPrompt, spec);
  if (scoredList.length === 2 && spec?.hybrid) {
    blocks.push(
      `[HYBRID BUILD PLAN: compose the two references below -- use the "${scoredList[0].recipe.id}" structure and the "${scoredList[1].recipe.id}" structure as stages of ONE dspFunction (e.g. isolate the band, process it, blend back with the dry signal).]`
    );
  }
  scoredList.forEach((s, idx) => {
    blocks.push(formatRecipeBlock(s.recipe, scoredList.length > 1 ? `stage ${idx + 1}, confidence ${s.confidence.toFixed(2)}` : `confidence ${s.confidence.toFixed(2)}`));
  });

  // Self-improving memory: a past build of this same family that verified at
  // >= 97 is the most project-specific reference available.
  const candidate = findCandidateRecipe(userPrompt, spec?.family);
  if (candidate) {
    blocks.push(
      `[PAST VERIFIED BUILD of a similar request ("${candidate.sourcePrompt.slice(0, 80)}") -- scored ${candidate.minScore}/100 in this project's quality gate. Its dspFunction, for structural reference:
${candidate.dspFunction}]`
    );
  }

  return blocks.join("\n\n");
}
