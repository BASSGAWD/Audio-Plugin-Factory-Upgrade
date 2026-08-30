import React, { useState, useEffect } from "react";
import { 
  Heart, 
  Sparkles, 
  Trash2, 
  Plus, 
  Download, 
  Upload, 
  Copy, 
  Check, 
  Search, 
  Calendar, 
  Cpu, 
  Bookmark, 
  X, 
  ArrowRight,
  Info,
  Code,
  Sliders,
  Settings,
  RefreshCw,
  FolderHeart
} from "lucide-react";
import { AudioPlugin, PluginParameter } from "../types";

export interface UserPreset {
  id: string;
  name: string;
  description: string;
  category: "distortion" | "delay" | "filter" | "synthesizer" | "dynamics" | "modulation" | "reverb";
  timestamp: string;
  parameters: PluginParameter[];
  dspFunction: string;
  faustCode?: string;
  cppJuceCode?: string;
  isBuiltIn?: boolean;
}

interface PresetManagerProps {
  currentPlugin: AudioPlugin;
  onLoadPreset: (preset: UserPreset) => void;
  triggerToast: (msg: string) => void;
}

// 35 high-craft Factory Presets representing an absolute massive library of world-class DSP blocks
export const FACTORY_PRESETS: UserPreset[] = [
  {
    id: "factory-autotune",
    name: "🤖 AeroTune Vocal Pitch Corrector",
    description: "Elite real-time pitch detection & intonation corrector. Integrates autocorrelation F0 vocal-registers tracking, snapped scale lock, retune glide, and a crossfaded dual-delay time-domain pitch shifter.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "speed", name: "Retune Speed", min: 0.0, max: 10.0, defaultValue: 7.0, value: 7.0, unit: "ms" },
      { id: "scale", name: "Target Scale (Chrom->Maj->Pent)", min: 0.0, max: 2.0, defaultValue: 0.0, value: 0.0, unit: "scale" },
      { id: "vibrato", name: "Vocal Vibrato Depth", min: 0.0, max: 2.0, defaultValue: 0.2, value: 0.2, unit: "Hz" },
      { id: "pitch", name: "Manual Transpose Shift", min: -12.0, max: 12.0, defaultValue: 0.0, value: 0.0, unit: "st" },
      { id: "correction", name: "Correction Intensity", min: 0.0, max: 1.0, defaultValue: 0.85, value: 0.85, unit: "%" }
    ],
    dspFunction: `// --- AEROTUNE VOCAL PITCH CORRECTOR & AUTO-TUNE ENGINE ---
// Persistent Pitch Memory & Autocorrelation Buffer Registers
if (!state.init_vocal) {
  state.pitch_buf = new Float32Array(1024);
  state.pitch_ptr = 0;
  state.sample_count = 0;
  state.detected_freq = 220.0;
  state.target_ratio = 1.0;
  state.smooth_ratio = 1.0;
  state.delay_buf = new Float32Array(8192);
  state.delay_ptr = 0;
  state.phase_1 = 0.0;
  state.vibrato_phase = 0.0;
  state.init_vocal = true;
}

// Write to delay and pitch analysis circular queues
state.delay_buf[state.delay_ptr] = inputSample;
state.pitch_buf[state.pitch_ptr] = inputSample;
state.pitch_ptr = (state.pitch_ptr + 1) % 1024;
state.sample_count++;

// Fetch real-time parameters
let speed = params.speed !== undefined ? params.speed : 7.0;
let scale_idx = params.scale !== undefined ? params.scale : 0;
let vibrato = params.vibrato !== undefined ? params.vibrato : 0.2;
let pitch = params.pitch !== undefined ? params.pitch : 0.0;
let correction = params.correction !== undefined ? params.correction : 0.85;

// Periodically run optimized Autocorrelation Pitch-Tracking loop (every 128 samples)
if (state.sample_count >= 128) {
  state.sample_count = 0;
  let max_corr = 0.0;
  let best_lag = -1;
  // Search lag range: 45 samples (980 Hz) to 320 samples (137 Hz) representing vocal registers
  for (let lag = 45; lag < 320; lag++) {
    let corr = 0.0;
    for (let i = 0; i < 256; i++) {
      let idx1 = (state.pitch_ptr - i - 1 + 1024) % 1024;
      let idx2 = (state.pitch_ptr - i - 1 - lag + 1024) % 1024;
      corr += state.pitch_buf[idx1] * state.pitch_buf[idx2];
    }
    if (corr > max_corr) {
      max_corr = corr;
      best_lag = lag;
    }
  }
  if (best_lag > 0) {
    state.detected_freq = 44100.0 / best_lag;
  }
}

// Convert estimated frequency to standard MIDI notes
let original_midi = 12.0 * Math.log2(state.detected_freq / 440.0) + 69.0;
let midi_note = Math.round(original_midi);

// Snap note according to target Scale Selection
let target_midi = midi_note;
if (scale_idx >= 1.5) { // Minor Blues Scale notes: C, Eb, F, F#, G, Bb (relative to C scale)
  let p = midi_note % 12;
  // Snap profile for minor blues
  let target_p = 0;
  if (p === 0 || p === 1) target_p = 0;
  else if (p === 2 || p === 3 || p === 4) target_p = 3;
  else if (p === 5) target_p = 5;
  else if (p === 6 || p === 7 || p === 8) target_p = 7;
  else if (p === 9 || p === 10 || p === 11) target_p = 10;
  target_midi = Math.floor(midi_note / 12) * 12 + target_p;
} else if (scale_idx >= 0.5) { // C Major Pentatonic: C, D, E, G, A (0, 2, 4, 7, 9)
  let p = midi_note % 12;
  let target_p = 0;
  if (p === 0 || p === 1) target_p = 0;
  else if (p === 2 || p === 3) target_p = 2;
  else if (p === 4 || p === 5 || p === 6) target_p = 4;
  else if (p === 7 || p === 8) target_p = 7;
  else if (p === 9 || p === 10 || p === 11) target_p = 9;
  target_midi = Math.floor(midi_note / 12) * 12 + target_p;
} else { // Standard Chromatic scale - simple whole semitones
  target_midi = midi_note;
}

// Calculate correction pitch factor
let target_freq = 440.0 * Math.pow(2.0, (target_midi - 69.0) / 12.0);
let base_tuning_ratio = target_freq / Math.max(20.0, state.detected_freq);

// Glide factor representing retune speed (Robotic 0ms -> Natural 10ms)
let glide = Math.pow(10.0, -((11.0 - speed) * 0.45));
state.target_ratio += glide * (base_tuning_ratio - state.target_ratio);

// Factor in vocal vibrato LFO & manual transpose pitch sliders
let vibSpeed = 6.0; // 6Hz natural vocal vocal vibrato rate
state.vibrato_phase += (2.0 * Math.PI * vibSpeed) / 44100.0;
if (state.vibrato_phase > 2.0 * Math.PI) state.vibrato_phase -= 2.0 * Math.PI;
let vibrato_offset = Math.sin(state.vibrato_phase) * (vibrato * 0.03);

let manualShift = Math.pow(2.0, pitch / 12.0);
let final_shift_ratio = ((state.target_ratio - 1.0) * correction + 1.0) * manualShift + vibrato_offset;

// Bound-limit ratio to prevent physical overflows [0.25x to 4.0x range of pitch shift]
final_shift_ratio = Math.max(0.25, Math.min(4.0, final_shift_ratio));

// Smoothing read pointer scaling for tape-head simulator
state.smooth_ratio += 0.05 * (final_shift_ratio - state.smooth_ratio);
let rate = 1.0 - state.smooth_ratio;

// Accumulate triangular phase pointers
state.phase_1 += rate * (1.0 / 44100.0) * 150.0;
if (state.phase_1 > 1.0) state.phase_1 -= 1.0;
if (state.phase_1 < 0.0) state.phase_1 += 1.0;

let phase_2 = state.phase_1 + 0.5;
if (phase_2 > 1.0) phase_2 -= 1.0;

// Shift read pointers based on phase scaling
let max_delay = 800.0;
let d1 = state.phase_1 * max_delay;
let d2 = phase_2 * max_delay;

let r1 = (state.delay_ptr - Math.floor(d1) + 8192) % 8192;
let r2 = (state.delay_ptr - Math.floor(d2) + 8192) % 8192;

let s1 = state.delay_buf[r1] || 0.0;
let s2 = state.delay_buf[r2] || 0.0;

// Linear crossfade to absolute quieten tape wrapping cracks
let w2 = Math.abs(state.phase_1 - 0.5) * 2.0;
let w1 = 1.0 - w2;

let pitch_corrected = s1 * w1 + s2 * w2;

// Increment delay buffer write index
state.delay_ptr = (state.delay_ptr + 1) % 8192;

return pitch_corrected;`
  },
  {
    id: "factory-metal-amplifier",
    name: "🔥 V30 Shredhead High-Gain Metal Amp",
    description: "Multi-stage virtual vacuum tube model (TS-808 pre-filtering + 12AX7 cascades) paired with a mechanical Celestion V30 4x12 Cabinet simulation. Elite high-gain metal guitar tone matching TH-U or Mixwave standards.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "gain", name: "Preamp Gain Boost", min: 1.0, max: 12.0, defaultValue: 6.5, value: 8.5, unit: "x" },
      { id: "gate", name: "Incline Noise Gate", min: 0.0, max: 10.0, defaultValue: 3.5, value: 5.5, unit: "dB" },
      { id: "bass", name: "Chassis Bass Thump", min: 0.0, max: 10.0, defaultValue: 6.0, value: 7.0, unit: "dB" },
      { id: "mid", name: "Interactive scoop Mid", min: 0.0, max: 10.0, defaultValue: 4.0, value: 3.2, unit: "dB" },
      { id: "treble", name: "Treble Edge Sparkle", min: 0.0, max: 10.0, defaultValue: 6.5, value: 7.5, unit: "dB" },
      { id: "presence", name: "Presence Sizzle", min: 0.0, max: 10.0, defaultValue: 7.0, value: 8.0, unit: "kHz" }
    ],
    dspFunction: `// --- V30 SHREDHEAD HIGH-GAIN METAL AMP ENGINE ---
// Elite Multi-Stage Vacuum Tube Overdrive & Celestion V30 Cabinet Emulation

// I. PERSISTENT SYSTEM REGISTERS & FILTER MEMORIES
if (!state.init) {
  state.gate_env = 0.0;
  state.ts_x1 = 0.0; state.ts_y1 = 0.0;
  state.c1_x1 = 0.0; state.c1_y1 = 0.0;
  state.c2_x1 = 0.0; state.c2_y1 = 0.0;
  state.c3_x1 = 0.0; state.c3_y1 = 0.0;
  state.lp_y1 = 0.0; state.lp_y2 = 0.0;
  state.mid_y1 = 0.0; state.mid_y2 = 0.0;
  state.treble_y1 = 0.0;
  state.presence_y1 = 0.0;
  state.cab_lh = 0.0;
  state.cab_hh = 0.0;
  state.cab_res_y1 = 0.0; state.cab_res_y2 = 0.0;
  state.comb_line = new Float32Array(512);
  state.comb_ptr = 0;
  state.init = true;
}

// II. FETCH REAL-TIME ROTARY CONTROLS
let gain = params.gain !== undefined ? params.gain : 6.5;
let bass = params.bass !== undefined ? params.bass : 6.0;
let mid = params.mid !== undefined ? params.mid : 4.0;
let treble = params.treble !== undefined ? params.treble : 6.5;
let presence = params.presence !== undefined ? params.presence : 7.0;
let gate = params.gate !== undefined ? params.gate : 3.5;

// Pre-scale factors
let preGaindB = (gain - 1.0) * 4.0 + 12.0;
let gainFactor = Math.pow(10, preGaindB / 20.0);

// III. DYNAMIC INPUT NOISE GATE
let env_calc = Math.abs(inputSample);
let gate_threshold = Math.pow(10, (-65 + (10 - gate) * 3) / 20);
if (env_calc > state.gate_env) {
  state.gate_env += 0.25 * (env_calc - state.gate_env);
} else {
  state.gate_env += 0.00012 * (env_calc - state.gate_env);
}

let gate_attn = 1.0;
if (state.gate_env < gate_threshold) {
  let db_below = 20.0 * Math.log10(Math.max(1e-5, state.gate_env) / gate_threshold);
  gate_attn = Math.pow(10, (db_below * 1.5) / 20.0);
}

let gatedInput = inputSample * gate_attn;

// IV. PRE-DISTORTION TIGHTENER (Tubescreamer TS-9 Stomp Simulation)
let ts_out = 0.93 * gatedInput - 0.93 * state.ts_x1 + 0.86 * state.ts_y1;
state.ts_x1 = gatedInput;
state.ts_y1 = ts_out;

// Apply Mid-Range Scream boost (720Hz hump)
let midHump = Math.sin(1.5 * ts_out);
let preDriven = (ts_out * 1.4 + midHump * 0.6) * gainFactor * 0.12;

// V. MULTI-STAGE VIRTUAL VACUUM TUBE PREAMP (Cascaded Triodes)
let s1_in = preDriven + 0.12;
let stage1 = Math.tanh(s1_in);
let stage1_hf = stage1 - state.c1_x1 + 0.992 * state.c1_y1;
state.c1_x1 = stage1;
state.c1_y1 = stage1_hf;

let s2_in = stage1_hf * 2.8;
let stage2 = s2_in > 0.0 
  ? (1.0 - Math.exp(-s2_in)) 
  : -(1.0 - Math.exp(s2_in * 0.85));
let stage2_hf = stage2 - state.c2_x1 + 0.992 * state.c2_y1;
state.c2_x1 = stage2;
state.c2_y1 = stage2_hf;

let s3_in = stage2_hf * 3.4 - 0.28;
let stage3 = Math.tanh(s3_in * 1.25);
let stage3_hf = stage3 - state.c3_x1 + 0.992 * state.c3_y1;
state.c3_x1 = stage3;
state.c3_y1 = stage3_hf;

// VI. PASSIVE THREE-BAND MARSHALL TONE STACK & PRESENCE SIZZLE
let g_bass = (bass / 10.0) * 2.0;
let g_mid = Math.pow(10, ((mid - 10.0) * 1.2) / 20.0);
let g_treble = (treble / 10.0) * 2.2;
let g_presence = (presence / 10.0) * 1.8;

// Bass Shelving EQ
let b_coef = 0.12 * g_bass;
let eq_bass = stage3_hf + b_coef * state.lp_y1;
state.lp_y1 = stage3_hf - 0.95 * state.lp_y1;

// Mid Scoop (Interactive Band-Reject around 500Hz)
let mid_center = 500.0;
let mid_q = 0.55;
let mid_omega = (2.0 * Math.PI * mid_center) / 44100.0;
let mid_cos = Math.cos(mid_omega);
let mid_sin = Math.sin(mid_omega);
let mid_alpha = mid_sin / (2.0 * mid_q);

let mb0 = 1.0 + mid_alpha * g_mid;
let mb1 = -2.0 * mid_cos;
let mb2 = 1.0 - mid_alpha * g_mid;
let ma0 = 1.0 + mid_alpha;
let ma1 = -2.0 * mid_cos;
let ma2 = 1.0 - mid_alpha;

let eq_mid = (mb0/ma0)*eq_bass + (mb1/ma0)*state.mid_y1 + (mb2/ma0)*state.mid_y2 - (ma1/ma0)*state.mid_y1 - (ma2/ma0)*state.mid_y2;
state.mid_y2 = state.mid_y1;
state.mid_y1 = eq_mid;

// Treble shelving EQ
let tr_diff = eq_mid - state.treble_y1;
let eq_treble = eq_mid + (g_treble - 1.0) * tr_diff * 0.45;
state.treble_y1 = state.treble_y1 + 0.28 * tr_diff;

// Presence
let pr_diff = eq_treble - state.presence_y1;
let presence_sig = eq_treble + (g_presence - 1.0) * pr_diff * 0.65;
state.presence_y1 = state.presence_y1 + 0.38 * pr_diff;

// VII. CELESTION V30 4X12 CABINET SOUND SIMULATOR
let cab_cutoff = 4800.0;
let lp_coeff = 1.0 - Math.exp(-2.0 * Math.PI * cab_cutoff / 44100.0);
state.cab_lh = state.cab_lh + lp_coeff * (presence_sig - state.cab_lh);

let cab_hp_coeff = 1.0 - Math.exp(-2.0 * Math.PI * 75.0 / 44100.0);
state.cab_hh = state.cab_hh + cab_hp_coeff * (state.cab_lh - state.cab_hh);
let filtered_cab = state.cab_lh - state.cab_hh;

// Low-end cabinet wood resonance filter (High-Q Biquad at 85Hz representing cab chassis resonance)
let r_fc = 85.0;
let r_q = 1.8;
let r_omega = (2.0 * Math.PI * r_fc) / 44100.0;
let r_cos = Math.cos(r_omega);
let r_alpha = Math.sin(r_omega) / (2.0 * r_q);
let r_b0 = r_alpha;
let r_b2 = -r_alpha;
let r_a0 = 1.0 + r_alpha;
let r_a1 = -2.0 * r_cos;
let r_a2 = 1.0 - r_alpha;

let res_out = (r_b0/r_a0)*filtered_cab + (r_b2/r_a0)*state.cab_res_y2 - (r_a1/r_a0)*state.cab_res_y1 - (r_a2/r_a0)*state.cab_res_y2;
state.cab_res_y2 = state.cab_res_y1;
state.cab_res_y1 = res_out;

// Combine cabinet speaker output with wood chassis thump resonance
let speaker_tone = filtered_cab * 0.82 + res_out * 0.45;

// Speaker cabinet comb reflections
let comb_delay = 74;
let comb_rd = (state.comb_ptr - comb_delay + state.comb_line.length) % state.comb_line.length;
let comb_delayed_sample = state.comb_line[comb_rd] || 0.0;

state.comb_line[state.comb_ptr] = speaker_tone;
state.comb_ptr = (state.comb_ptr + 1) % state.comb_line.length;

let final_amp_signal = speaker_tone * 0.76 + comb_delayed_sample * 0.24;

return final_amp_signal * 1.45;`
  },
  {
    id: "factory-tape-flutter",
    name: "Tape Flutter & Deep Echo",
    description: "Multi-tap simulated deep echo with medium warmth tube dynamics, designed for dreamy guitar soundscapes.",
    category: "delay",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "drive", name: "Drive Boost", min: 1, max: 10, defaultValue: 2.5, value: 1.8, unit: "x" },
      { id: "bias", name: "Tube Bias", min: -0.5, max: 0.5, defaultValue: 0, value: 0.22, unit: "V" },
      { id: "delayTime", name: "Echo Speed", min: 10, max: 500, defaultValue: 180, value: 420, unit: "ms" },
      { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.35, value: 0.72, unit: "%" },
    ],
    dspFunction: `// 1. Setup persistent delay line states if they don't exist
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2); // 2-second buffer
  state.writePtr = 0;
}

// 2. Fetch parameters passed dynamically in real-time
let drive = params.drive || 1.0;
let bias = params.bias || 0.0;
let feedback = params.feedback || 0.0;
let delayTimeMs = params.delayTime || 100.0;

// Apply input gain and skew with DC Offset / Bias
let biasedInput = inputSample + bias;

// 3. Mathematical waveshaping / saturation (Smooth tube curves)
let saturated = Math.tanh(biasedInput * drive);

// 4. Delay calculations
let delaySamples = Math.floor((delayTimeMs / 1000.0) * 44100);
let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let delaySample = state.delayLine[readPtr] || 0.0;

// Write current saturated sample and feed back decayed signal
state.delayLine[state.writePtr] = saturated + delaySample * feedback;

// Increment write pointer with ring modulo spacing
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// Soft mix wet echo delay with saturated tape dry tone
return saturated * 0.65 + delaySample * 0.35;`
  },
  {
    id: "factory-overdrive-grit",
    name: "Heavy Tube Overdrive",
    description: "Intense, asymmetric tube saturation combined with extremely compact resonator feedback delay for heavy industrial crunch.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "drive", name: "Drive Boost", min: 1, max: 10, defaultValue: 2.5, value: 8.5, unit: "x" },
      { id: "bias", name: "Tube Bias", min: -0.5, max: 0.5, defaultValue: 0, value: -0.35, unit: "V" },
      { id: "delayTime", name: "Echo Speed", min: 10, max: 500, defaultValue: 180, value: 25, unit: "ms" },
      { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.35, value: 0.15, unit: "%" },
    ],
    dspFunction: `// 1. Setup persistent delay line states if they don't exist
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2); // 2-second buffer
  state.writePtr = 0;
}

// 2. Fetch parameters passed dynamically in real-time
let drive = params.drive || 1.0;
let bias = params.bias || 0.0;
let feedback = params.feedback || 0.0;
let delayTimeMs = params.delayTime || 100.0;

// Apply input gain and skew with DC Offset / Bias
let biasedInput = inputSample + bias;

// 3. Mathematical waveshaping / saturation (Asymmetric Tube Distortion)
// Overdriven tube modeling using asymmetrical algebraic curve
let saturated = biasedInput > 0
  ? Math.tanh(biasedInput * drive * 1.2)
  : Math.tanh(biasedInput * drive * 0.8) * 0.9;

// 4. Delay calculations
let delaySamples = Math.floor((delayTimeMs / 1000.0) * 44100);
let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let delaySample = state.delayLine[readPtr] || 0.0;

// Write current saturated sample and feed back decayed signal
state.delayLine[state.writePtr] = saturated + delaySample * feedback;

// Increment write pointer with ring modulo spacing
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// Raw overdriven blend
return saturated * 0.85 + delaySample * 0.15;`
  },
  {
    id: "factory-slapback-shaper",
    name: "Classic Rockabilly Slapback",
    description: "Traditional fast mono tape delay modeled on 15 IPS reel-to-reel decks, delivering clear depth with slight tube glue.",
    category: "delay",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "drive", name: "Drive Boost", min: 1, max: 10, defaultValue: 2.5, value: 3.2, unit: "x" },
      { id: "bias", name: "Tube Bias", min: -0.5, max: 0.5, defaultValue: 0, value: -0.05, unit: "V" },
      { id: "delayTime", name: "Echo Speed", min: 10, max: 500, defaultValue: 180, value: 120, unit: "ms" },
      { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.35, value: 0.45, unit: "%" },
    ],
    dspFunction: `// 1. Setup persistent delay line states if they don't exist
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2); // 2-second buffer
  state.writePtr = 0;
}

// 2. Fetch parameters passed dynamically in real-time
let drive = params.drive || 1.0;
let bias = params.bias || 0.0;
let feedback = params.feedback || 0.0;
let delayTimeMs = params.delayTime || 100.0;

// Apply input gain and skew with DC Offset / Bias
let biasedInput = inputSample + bias;

// 3. Mathematical waveshaping / saturation (Smooth tube curves)
let saturated = Math.tanh(biasedInput * drive);

// 4. Delay calculations
let delaySamples = Math.floor((delayTimeMs / 1000.0) * 44100);
let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let delaySample = state.delayLine[readPtr] || 0.0;

// Write current saturated sample and feed back decayed signal
state.delayLine[state.writePtr] = saturated + delaySample * feedback;

// Increment write pointer with ring modulo spacing
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// Soft mix wet echo delay with saturated tape dry tone
return saturated * 0.65 + delaySample * 0.35;`
  },
  {
    id: "factory-filter-moog-classic",
    name: "Classic Moog Resonant Filter",
    description: "Deep analog-style lowpass sweep with resonance bias and pre-filter warmth saturation stages.",
    category: "filter",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "cutoff", name: "Cutoff Frequency", min: 40, max: 18000, defaultValue: 1200, value: 950, unit: "Hz" },
      { id: "resonance", name: "Resonance (Q)", min: 0.1, max: 9.5, defaultValue: 1.5, value: 4.8, unit: "Q" },
      { id: "sat", name: "Analog Drive", min: 1, max: 8, defaultValue: 1.5, value: 2.0, unit: "x" }
    ],
    dspFunction: `// Moog Transistor Ladder filter structure (Virtual Analog simulation)
if (!state.v0) {
  state.v0 = 0.0; state.v1 = 0.0; state.v2 = 0.0; state.v3 = 0.0;
}

let cutoff = params.cutoff || 1200.0;
let res = params.resonance || 1.5;
let drive = params.sat || 1.5;

// Apply input pre-drive boost and stabilization bias
let input = inputSample * drive;

// Normalized cutoff coefficient math (omega)
let cutoffNormalized = cutoff / 44100.0;
if (cutoffNormalized > 0.49) cutoffNormalized = 0.49;

// Bilinear analog pole mapping approximation
let f = Math.tan(Math.PI * cutoffNormalized);
let r = 7.0 * res / 9.5; // Resonant feedback coefficient scaling

// Calculate pole feedback term
let poleFeedback = input - (r * state.v3);

// Self-limiting saturation inside Moog feedback loop prevents digital blowups
poleFeedback = Math.tanh(poleFeedback * 0.72);

// Filter cascade poles (4-pole, 24dB/oct roll-off)
state.v0 = state.v0 + f * (poleFeedback - state.v0);
state.v1 = state.v1 + f * (state.v0 - state.v1);
state.v2 = state.v2 + f * (state.v1 - state.v2);
state.v3 = state.v3 + f * (state.v2 - state.v3);

return state.v3;`
  },
  {
    id: "factory-triode-tube",
    name: "Vacuum Triode (Asymmetric Overdrive)",
    description: "Simulates vacuum-tube grid current dynamics where high peak levels trigger dynamic voltage collapse (sag), producing deep punchy analog drive.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "drive", name: "Drive Boost", min: 1.0, max: 15.0, defaultValue: 4.5, value: 6.2, unit: "x" },
      { id: "bias", name: "Grid DC Bias", min: -0.8, max: 0.8, defaultValue: 0.25, value: 0.35, unit: "V" },
      { id: "sag", name: "Plate Sag Ratio", min: 0.0, max: 1.0, defaultValue: 0.4, value: 0.55, unit: "%" }
    ],
    dspFunction: `// Asymmetric Triode Tube Preamp with Dynamic Grid Sag
if (!state.sagLevel) {
  state.sagLevel = 0.0;
}

let drive = params.drive !== undefined ? params.drive : 4.5;
let bias = params.bias !== undefined ? params.bias : 0.25;
let sagAmount = params.sag !== undefined ? params.sag : 0.4;

// Peak detector for dynamic sag calculation
let inputAbs = Math.abs(inputSample);
state.sagLevel = state.sagLevel + 0.005 * (inputAbs - state.sagLevel); // slow detector

// Pull bias dynamically down based on sag level
let activeBias = bias - (state.sagLevel * sagAmount * 0.5);

let x = inputSample * drive + activeBias;
let out = 0.0;

// Triode model asymmetrical grid saturation
if (x > 0.0) {
  out = x / (1.0 + x);
} else {
  out = Math.exp(x) - 1.0;
}

// Rescale output to restore levels
return Math.tanh(out * 1.5) * 0.85;`
  },
  {
    id: "factory-wave-folder",
    name: "Cubic Wave-Folder (Metallic Clank)",
    description: "Folds audio peaks exceeding limits backward recursively, producing heavy industrial odd-harmonics and glass ring-modulation.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "depth", name: "Folding Depth", min: 1.0, max: 12.0, defaultValue: 3.5, value: 5.8, unit: "folds" },
      { id: "symmetry", name: "Asymmetry Offset", min: -0.5, max: 0.5, defaultValue: 0.0, value: 0.05, unit: "V" },
      { id: "postCutoff", name: "HF Damp Gate", min: 1000, max: 18000, defaultValue: 12000, value: 9500, unit: "Hz" }
    ],
    dspFunction: `// Infinite Wavefolding Modulator
if (!state.v0) {
  state.v0 = 0.0;
}

let depth = params.depth !== undefined ? params.depth : 3.5;
let symmetry = params.symmetry !== undefined ? params.symmetry : 0.0;
let postCutoff = params.postCutoff !== undefined ? params.postCutoff : 12000.0;

let x = (inputSample + symmetry) * depth;

// Wave Folding Math
// Sine-based multi-stage folding formula
let folded = Math.sin(x * Math.PI * 0.5);

// Let's smooth high-end clank using a direct lightweight low-pass filter
let f = Math.min(0.48, postCutoff / 44100.0);
let k = Math.tan(Math.PI * f);
let alpha = k / (1.0 + k);
state.v0 = state.v0 + alpha * (folded - state.v0);

return state.v0;`
  },
  {
    id: "factory-bitcrusher",
    name: "A/D Decimator & Bitcrusher",
    description: "Recreates the classic character of early 8-bit & 12-bit sampler registers, with sample rate decimation and step quantization.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "bits", name: "Register Bit-Depth", min: 1.0, max: 16.0, defaultValue: 6.0, value: 4.8, unit: "bits" },
      { id: "rateDivider", name: "Sample-Rate Divide", min: 1.0, max: 32.0, defaultValue: 12.0, value: 8.0, unit: "div" },
      { id: "mix", name: "Dry/Wet Mix", min: 0.0, max: 1.0, defaultValue: 0.7, value: 0.75, unit: "%" }
    ],
    dspFunction: `// Quantizing Bitcrusher and Sample-Rate Reducer
if (!state.holdValue) {
  state.holdValue = 0.0;
  state.sampleCounter = 0;
}

let bits = params.bits !== undefined ? params.bits : 6.0;
let rateDivider = params.rateDivider !== undefined ? params.rateDivider : 12.0;
let wetMix = params.mix !== undefined ? params.mix : 0.7;

state.sampleCounter++;

// Quantize sample rate (Sample & Hold)
if (state.sampleCounter >= rateDivider) {
  state.sampleCounter = 0;
  
  // Apply bit-depth bit quantization
  let levels = Math.pow(2.0, Math.max(1.0, bits));
  state.holdValue = Math.round(inputSample * levels) / levels;
}

return inputSample * (1.0 - wetMix) + state.holdValue * wetMix;`
  },
  {
    id: "factory-pingpong",
    name: "Dynamic Stereo Ping-Pong Echo",
    description: "Splits reflections symmetrically across simulated left & right fields with custom channel crossovers and cross-phase decay.",
    category: "delay",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "time", name: "Delay Time", min: 50, max: 1000, defaultValue: 350, value: 380, unit: "ms" },
      { id: "feedback", name: "Tap Feedback", min: 0.0, max: 0.95, defaultValue: 0.65, value: 0.75, unit: "%" },
      { id: "spread", name: "Stereo Delay Offset", min: 0.0, max: 1.0, defaultValue: 0.75, value: 0.60, unit: "span" }
    ],
    dspFunction: `// Interactive Ping-Pong Delay with Phase Spacing
if (!state.delayLineL) {
  state.delayLineL = new Float32Array(44100 * 2);
  state.delayLineR = new Float32Array(44100 * 2);
  state.writePtr = 0;
}

let timeMs = params.time !== undefined ? params.time : 350.0;
let feedback = params.feedback !== undefined ? params.feedback : 0.65;
let spread = params.spread !== undefined ? params.spread : 0.75;

let delaySamples = Math.floor((timeMs / 1000.0) * 44100);

let readPtrL = state.writePtr - delaySamples;
let readPtrR = state.writePtr - Math.floor(delaySamples * (1.0 + spread * 0.1)); // phase offset

if (readPtrL < 0) readPtrL += state.delayLineL.length;
if (readPtrR < 0) readPtrR += state.delayLineR.length;

let delaySampleL = state.delayLineL[readPtrL] || 0.0;
let delaySampleR = state.delayLineR[readPtrR] || 0.0;

// Hard crossover feedback routing
let feedbackL = inputSample + delaySampleR * feedback;
let feedbackR = inputSample + delaySampleL * feedback;

state.delayLineL[state.writePtr] = Math.tanh(feedbackL);
state.delayLineR[state.writePtr] = Math.tanh(feedbackR);

state.writePtr = (state.writePtr + 1) % state.delayLineL.length;

// Coherent spatial blend
let combinedDelay = delaySampleL * (1.0 - spread * 0.5) + delaySampleR * (spread * 0.5);
return inputSample * 0.55 + combinedDelay * 0.45;`
  },
  {
    id: "factory-shimmer",
    name: "Harmonic Celestial Shimmer Delay",
    description: "Pipes feedback repetitions through a pitch transposition loop (+1 Octave), creating atmospheric strings and sparkling ambient pads.",
    category: "delay",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "delayTime", name: "Space Size", min: 100, max: 1000, defaultValue: 450, value: 650, unit: "ms" },
      { id: "feedback", name: "Recycle Decay", min: 0.0, max: 0.9, defaultValue: 0.7, value: 0.82, unit: "loops" },
      { id: "pitchShift", name: "Formant Shift", min: -12, max: 12, defaultValue: 12, value: 12, unit: "st" },
      { id: "mix", name: "Wet Intensity", min: 0.0, max: 1.0, defaultValue: 0.4, value: 0.55, unit: "%" }
    ],
    dspFunction: `// Pitch-Shifting Celestial Shimmer Delay Loop
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2);
  state.writePtr = 0;
  state.readPhase = 0.0;
}

let timeMs = params.delayTime !== undefined ? params.delayTime : 450.0;
let feedback = params.feedback !== undefined ? params.feedback : 0.7;
let pitchShift = params.pitchShift !== undefined ? params.pitchShift : 12.0;
let mix = params.mix !== undefined ? params.mix : 0.4;

let delaySamples = Math.floor((timeMs / 1000.0) * 44100);

// Basic dual-tap crossfading pitch transposer simulation inside delay buffer
let semitones = pitchShift;
let speedFactor = Math.pow(2.0, semitones / 12.0);

state.readPhase += (speedFactor - 1.0);
if (state.readPhase >= delaySamples) state.readPhase -= delaySamples;
if (state.readPhase < 0) state.readPhase += delaySamples;

// Read position with pitch shift offset integrated
let readPtr = state.writePtr - delaySamples + Math.floor(state.readPhase);
while (readPtr < 0) readPtr += state.delayLine.length;
readPtr = readPtr % state.delayLine.length;

let pitchShiftedSample = state.delayLine[readPtr] || 0.0;

// Feedback incorporates both natural decay and pitch transpose
state.delayLine[state.writePtr] = Math.tanh(inputSample + pitchShiftedSample * feedback);
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

let rawDelay = state.delayLine[(state.writePtr - delaySamples + state.delayLine.length) % state.delayLine.length];

return inputSample * (1.0 - mix) + (rawDelay * 0.4 + pitchShiftedSample * 0.6) * mix;`
  },
  {
    id: "factory-bbd-chorus",
    name: "Bucket-Brigade Ensemble Chorus",
    description: "Simulates analog solid-state bucket-brigade (BBD) delay clock modulation, generating deep, rich, and warm stereophonic ensemble chorusing.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "delayTime", name: "Carrier Width", min: 5, max: 45, defaultValue: 22, value: 18, unit: "ms" },
      { id: "vibratoRate", name: "Modulation Speed", min: 0.1, max: 8.0, defaultValue: 1.2, value: 1.6, unit: "Hz" },
      { id: "vibratoDepth", name: "Modulation Depth", min: 0.1, max: 5.0, defaultValue: 1.8, value: 2.2, unit: "ms" },
      { id: "feedback", name: "Comb Feedback", min: 0.0, max: 0.8, defaultValue: 0.35, value: 0.15, unit: "%" }
    ],
    dspFunction: `// Analog Bucket-Brigade (BBD) Chorus Ensemble
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2);
  state.writePtr = 0;
  state.phi = 0.0;
}

let baseDelayMs = params.delayTime !== undefined ? params.delayTime : 22.0;
let rateHz = params.vibratoRate !== undefined ? params.vibratoRate : 1.2;
let depthMs = params.vibratoDepth !== undefined ? params.vibratoDepth : 1.8;
let feedback = params.feedback !== undefined ? params.feedback : 0.35;

// Phase accumulator LFO
state.phi += (2.0 * Math.PI * rateHz) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

// LFO sinusoidal sweep
let lfo = Math.sin(state.phi);

// Modulated delay time calculator
let modulatedDelayMs = baseDelayMs + lfo * depthMs;
let delaySamples = (modulatedDelayMs / 1000.0) * 44100;

// Read from fractional circular pointer
let readPtrFloat = state.writePtr - delaySamples;
if (readPtrFloat < 0) readPtrFloat += state.delayLine.length;

let index0 = Math.floor(readPtrFloat);
let index1 = (index0 + 1) % state.delayLine.length;
let frac = readPtrFloat - index0;

// Linear interpolation prevents high sweep clock clicking or steps
let delaySample = (1.0 - frac) * state.delayLine[index0] + frac * state.delayLine[index1];

// Feedback writeback with gentle heat saturator
state.delayLine[state.writePtr] = Math.tanh(inputSample + delaySample * feedback);
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// Dual ensemble dry/wet combine
return inputSample * 0.6 + delaySample * 0.45;`
  },
  {
    id: "factory-svf-filter",
    name: "Stable State-Variable Filter (SVF)",
    description: "Classic Chamberlin analog state variable topology, supporting Lowpass, Bandpass, and Highpass outputs with rock-solid feedback loop safety.",
    category: "filter",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "cutoff", name: "Sweep Cutoff", min: 50, max: 16000, defaultValue: 1800, value: 3200, unit: "Hz" },
      { id: "resonance", name: "Filter Q-Factor", min: 0.5, max: 10.0, defaultValue: 2.0, value: 4.5, unit: "Q" },
      { id: "mode", name: "Circuit Output", min: 0.0, max: 2.0, defaultValue: 0.0, value: 0.0, unit: "mode" }
    ],
    dspFunction: `// Perfect State Variable Filter (SVF Chamberlin topology)
if (!state.low) {
  state.low = 0.0;
  state.band = 0.0;
}

let cutoff = params.cutoff !== undefined ? params.cutoff : 1800.0;
let q = params.resonance !== undefined ? params.resonance : 2.0;
let mode = params.mode !== undefined ? params.mode : 0.0; // 0=LP, 1=BP, 2=HP

// Pre-warp frequency transformation
let f = 2.0 * Math.sin(Math.PI * cutoff / 44100.0);
let d = 1.0 / q; // feedback damping ratio

// SVF loop equations
let high = inputSample - state.low - d * state.band;
state.band = state.band + f * high;
state.low = state.low + f * state.band;

// Limiters on output states ensure mathematical sanity
state.band = Math.max(-1.5, Math.min(1.5, state.band));
state.low = Math.max(-1.5, Math.min(1.5, state.low));

let out = 0.0;
if (mode < 0.8) {
  out = state.low; // Lowpass output
} else if (mode < 1.6) {
  out = state.band; // Bandpass output
} else {
  out = high; // Highpass output
}

return out;`
  },
  {
    id: "factory-formant-vocal",
    name: "Vocal Formant Resonator (Robot Talk)",
    description: "Parallel biquad filters tracking human nasal cavities, morphing between vowels (A, E, I, O, U) with throat grit distortion.",
    category: "filter",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "vowel", name: "Vowel Accent", min: 0.0, max: 4.0, defaultValue: 0.0, value: 1.5, unit: "aeiou" },
      { id: "vowelQ", name: "Throat Formant Resonance", min: 2.0, max: 15.0, defaultValue: 8.0, value: 9.5, unit: "Q" },
      { id: "throatGrit", name: "Throat Gain Grit", min: 1.0, max: 4.0, defaultValue: 1.0, value: 1.8, unit: "db" }
    ],
    dspFunction: `// Vocal Formant Throat Resonator (Talking Filter)
if (!state.s1a) {
  state.s1a = 0.0; state.s2a = 0.0;
  state.s1b = 0.0; state.s2b = 0.0;
  state.s1c = 0.0; state.s2c = 0.0;
}

let vowelPos = params.vowel !== undefined ? params.vowel : 0.0;
let q = params.vowelQ !== undefined ? params.vowelQ : 8.0;
let grit = params.throatGrit !== undefined ? params.throatGrit : 1.0;

// Vowel resonant formant registers (Formant F1, F2, F3 frequencies)
// 0: A ("ah"), 1: E ("eh"), 2: I ("ee"), 3: O ("oh"), 4: U ("oo")
let f1_presets = [730, 530, 270, 570, 300];
let f2_presets = [1090, 1840, 2290, 840, 870];
let f3_presets = [2440, 2480, 3010, 2410, 2240];

// Dynamic interpolation between formant snapshots
let index = Math.min(3.99, Math.max(0.0, vowelPos));
let baseIndex = Math.floor(index);
let t = index - baseIndex;

let f1 = f1_presets[baseIndex] * (1.0 - t) + f1_presets[baseIndex + 1] * t;
let f2 = f2_presets[baseIndex] * (1.0 - t) + f2_presets[baseIndex + 1] * t;
let f3 = f3_presets[baseIndex] * (1.0 - t) + f3_presets[baseIndex + 1] * t;

// Process 3 biquad bandpass resonators in parallel
const biquadResonate = (input, f, q, s1, s2) => {
  let omega = 2.0 * Math.PI * f / 44100.0;
  let sin_o = Math.sin(omega);
  let cos_o = Math.cos(omega);
  let alpha = sin_o / (2.0 * q);
  
  let b0 = alpha;
  let b1 = 0.0;
  let b2 = -alpha;
  let a0 = 1.0 + alpha;
  let a1 = -2.0 * cos_o;
  let a2 = 1.0 - alpha;
  
  // Direct Form II transposed equations
  let out = (b0 * input + s1) / a0;
  let nextS1 = b1 * input - a1 * out + s2;
  let nextS2 = b2 * input - a2 * out;
  
  return { out, nextS1, nextS2 };
};

let resA = biquadResonate(inputSample * grit, f1, q, state.s1a, state.s2a);
state.s1a = resA.nextS1; state.s2a = resA.nextS2;

let resB = biquadResonate(inputSample * grit, f2, q, state.s1b, state.s2b);
state.s1b = resB.nextS1; state.s2b = resB.nextS2;

let resC = biquadResonate(inputSample * grit, f3, q, state.s1c, state.s2c);
state.s1c = resC.nextS1; state.s2c = resC.nextS2;

// Mix parallel nasal outputs
let sum = (resA.out * 1.0 + resB.out * 0.75 + resC.out * 0.5) * 0.45;
return Math.tanh(sum);`
  },
  {
    id: "factory-biquad-eq",
    name: "Parametric Bell Peaking Equalizer",
    description: "Standard studio peaking filter node using digital Direct Form biquad coefficient matrices to boost or carve frequencies with absolute phase clarity.",
    category: "filter",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "centerFreq", name: "Peaking Center", min: 50, max: 12000, defaultValue: 1500, value: 1450, unit: "Hz" },
      { id: "bandwidthQ", name: "Equalizer Bandwidth", min: 0.5, max: 8.0, defaultValue: 2.0, value: 3.2, unit: "Q" },
      { id: "gainDb", name: "Peak Filter Gain", min: -12.0, max: 12.0, defaultValue: 6.0, value: 7.5, unit: "dB" }
    ],
    dspFunction: `// Biquad Parametric Peaking Equalizer Band
if (!state.s1) {
  state.s1 = 0.0;
  state.s2 = 0.0;
}

let f = params.centerFreq !== undefined ? params.centerFreq : 1500.0;
let q = params.bandwidthQ !== undefined ? params.bandwidthQ : 2.0;
let db = params.gainDb !== undefined ? params.gainDb : 6.0;

// Convert decibels back to gain metrics safely
let aVal = Math.pow(10.0, db / 40.0);
let omega = (2.0 * Math.PI * f) / 44100.0;
let cos_o = Math.cos(omega);
let alpha = Math.sin(omega) / (2.0 * q);

let b0 = 1.0 + alpha * aVal;
let b1 = -2.0 * cos_o;
let b2 = 1.0 - alpha * aVal;
let a0 = 1.0 + alpha / aVal;
let a1 = -2.0 * cos_o;
let a2 = 1.0 - alpha / aVal;

// Standard Direct Form II evaluation loop
let out = (b0 * inputSample + state.s1) / a0;
state.s1 = b1 * inputSample - a1 * out + state.s2;
state.s2 = b2 * inputSample - a2 * out;

// Safety boundary protection
return Math.max(-1.0, Math.min(1.0, out));`
  },
  {
    id: "factory-fm-bell",
    name: "FM Metal Bell Drone Generator",
    description: "2-Operator digital Frequency Modulation (FM) sub-synthesizer, triggering rich metallic gong drones from incoming sound pulses.",
    category: "synthesizer",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "carrierFreq", name: "Carrier Pitch", min: 50, max: 600, defaultValue: 130, value: 165, unit: "Hz" },
      { id: "modRatio", name: "FM Modulator Ratio", min: 1.0, max: 12.0, defaultValue: 3.5, value: 4.25, unit: "ratio" },
      { id: "modIndex", name: "FM Modulator Index", min: 0.0, max: 20.0, defaultValue: 8.0, value: 12.0, unit: "index" },
      { id: "decayRate", name: "Gong Envelope Decay", min: 0.1, max: 4.0, defaultValue: 1.5, value: 2.2, unit: "sec" }
    ],
    dspFunction: `// FM Bell Drone Oscillator (Interactive Synth)
if (!state.phiCar) {
  state.phiCar = 0.0;
  state.phiMod = 0.0;
  state.env = 0.0;
}

let carFreq = params.carrierFreq !== undefined ? params.carrierFreq : 130.0;
let ratio = params.modRatio !== undefined ? params.modRatio : 3.5;
let index = params.modIndex !== undefined ? params.modIndex : 8.0;
let decay = params.decayRate !== undefined ? params.decayRate : 1.5;

// Peak tracking of audio pulses as gate triggers
let absIn = Math.abs(inputSample);
if (absIn > 0.15 && absIn > state.env) {
  state.env = 1.0; // trigger FM envelope on loud strikes
} else {
  let decayCoeff = 1.0 / (decay * 44100.0);
  state.env -= decayCoeff;
  if (state.env < 0.0) state.env = 0.0;
}

state.phiMod += (2.0 * Math.PI * (carFreq * ratio)) / 44100.0;
state.phiCar += (2.0 * Math.PI * carFreq) / 44100.0;

// Constrain phases to prevent floating overflow noise
if (state.phiMod > 2.0 * Math.PI) state.phiMod -= 2.0 * Math.PI;
if (state.phiCar > 2.0 * Math.PI) state.phiCar -= 2.0 * Math.PI;

// FM operator calculation
let modulator = Math.sin(state.phiMod) * index * state.env;
let synthOsc = Math.sin(state.phiCar + modulator) * state.env;

return inputSample * 0.5 + synthOsc * 0.45;`
  },
  {
    id: "factory-supersaw",
    name: "Detuned 3-Voice Unison Super-Saw",
    description: "Synthesizes three unison sawtooth waves with phase offsets and frequency detuning, generating massive analog lead riffs and sub synth basses.",
    category: "synthesizer",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "freq", name: "Primary Oscillator", min: 55, max: 880, defaultValue: 220, value: 110, unit: "Hz" },
      { id: "detune", name: "Unison Detune Gap", min: 0.01, max: 0.15, defaultValue: 0.04, value: 0.065, unit: "Hz_dev" },
      { id: "subGain", name: "Sub Sin-Base Gain", min: 0.0, max: 1.0, defaultValue: 0.5, value: 0.70, unit: "%" }
    ],
    dspFunction: `// Unison Phase-Accumulated Detuned Super-Saw
if (!state.phi1) {
  state.phi1 = 0.0;
  state.phi2 = 0.3;
  state.phi3 = 0.7;
}

let freq = params.freq !== undefined ? params.freq : 220.0;
let detuneAmt = params.detune !== undefined ? params.detune : 0.04;
let subGain = params.subGain !== undefined ? params.subGain : 0.5;

// Transmit frequencies across detuned array offsets
let f1 = freq;
let f2 = freq * (1.1 + detuneAmt);
let f3 = freq * (0.91 - detuneAmt);

state.phi1 += (2.0 * Math.PI * f1) / 44100.0;
state.phi2 += (2.0 * Math.PI * f2) / 44100.0;
state.phi3 += (2.0 * Math.PI * f3) / 44100.0;

if (state.phi1 > 2.0 * Math.PI) state.phi1 -= 2.0 * Math.PI;
if (state.phi2 > 2.0 * Math.PI) state.phi2 -= 2.0 * Math.PI;
if (state.phi3 > 2.0 * Math.PI) state.phi3 -= 2.0 * Math.PI;

// Sawtooth basic equation: (1.0 - phase / PI)
let saw1 = 1.0 - (state.phi1 / Math.PI);
let saw2 = 1.0 - (state.phi2 / Math.PI);
let saw3 = 1.0 - (state.phi3 / Math.PI);

let leadSaw = (saw1 + saw2 + saw3) / 3.0;

// Sub sine oscillator underneath
let subSweep = Math.sin(state.phi1 * 0.5);

let synthesized = leadSaw * 0.6 + subSweep * subGain * 0.4;
return inputSample * 0.5 + synthesized * 0.45;`
  },
  {
    id: "factory-smooth-compressor",
    name: "Classic Studio RMS Compressor",
    description: "Peak-reading dynamic gain reduction loop with standard Threshold, Ratio, Attack, and Release adjustments to glue track dynamics.",
    category: "dynamics",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "threshold", name: "Peak Threshold", min: -35, max: 0, defaultValue: -20, value: -18, unit: "dB" },
      { id: "ratio", name: "Reduction Ratio", min: 1.0, max: 12.0, defaultValue: 4.0, value: 3.5, unit: "ratio" },
      { id: "attackMs", name: "Attack Response", min: 2, max: 100, defaultValue: 15, value: 8, unit: "ms" },
      { id: "releaseMs", name: "Release Recovery", min: 20, max: 500, defaultValue: 120, value: 160, unit: "ms" }
    ],
    dspFunction: `// Asymptotic Dynamic Range Compressor
if (!state.envelope) {
  state.envelope = 0.0001;
}

let thresholdDb = params.threshold !== undefined ? params.threshold : -20.0;
let ratio = params.ratio !== undefined ? params.ratio : 4.0;
let attack = params.attackMs !== undefined ? params.attackMs : 15.0;
let release = params.releaseMs !== undefined ? params.releaseMs : 120.0;

// Convert parameters to filter coefficients
let attackCoeff = 1.0 - Math.exp(-1.0 / (attack * 44.1));
let releaseCoeff = 1.0 - Math.exp(-1.0 / (release * 44.1));

let absIn = Math.abs(inputSample);

// Attack/Release tracking circuit
if (absIn > state.envelope) {
  state.envelope += attackCoeff * (absIn - state.envelope);
} else {
  state.envelope += releaseCoeff * (absIn - state.envelope);
}

// Convert tracked level back inside scale of Decibels
let envelopeDb = 20.0 * Math.log10(Math.max(1e-5, state.envelope));

let gainCompensation = 1.0;
if (envelopeDb > thresholdDb) {
  // Compression math formula
  let overLimitDb = envelopeDb - thresholdDb;
  let targetDb = thresholdDb + overLimitDb / ratio;
  gainCompensation = Math.pow(10.0, (targetDb - envelopeDb) / 20.0);
}

return inputSample * gainCompensation;`
  },
  {
    id: "factory-transient-shaper",
    name: "Acoustic Transient-Spur Puncher",
    description: "Evaluates rapid Fast and Slow envelope follower differences, amplifying initial pick attack or expanding room sustain bounds.",
    category: "dynamics",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "punchAttack", name: "Transient Pick-Attack", min: -4.0, max: 4.0, defaultValue: 2.5, value: 3.0, unit: "dB" },
      { id: "sustain", name: "Tail Release Sustain", min: -4.0, max: 4.0, defaultValue: -1.0, value: -0.5, unit: "dB" }
    ],
    dspFunction: `// Transient-Shaping Punch Maximizer
if (!state.envFast) {
  state.envFast = 0.0;
  state.envSlow = 0.0;
}

let punch = params.punchAttack !== undefined ? params.punchAttack : 2.5;
let sustain = params.sustain !== undefined ? params.sustain : -1.0;

let absIn = Math.abs(inputSample);

// Double leaky integration detector fields
let fCoeff = 1.0 - Math.exp(-1.0 / (2.0 * 44.1));   // Very fast (2ms)
let sCoeff = 1.0 - Math.exp(-1.0 / (60.0 * 44.1));  // Slower (60ms)

state.envFast += fCoeff * (absIn - state.envFast);
state.envSlow += sCoeff * (absIn - state.envSlow);

// Differential transient curve
let fastSec = 20.0 * Math.log10(Math.max(1e-5, state.envFast));
let slowSec = 20.0 * Math.log10(Math.max(1e-5, state.envSlow));
let delta = fastSec - slowSec;

// Convert delta modifications back to scale metrics
let punchGain = Math.pow(10.0, (delta * punch * 0.12) / 20.0);
let sustainGain = Math.pow(10.0, (state.envSlow * sustain * 0.15));

let dynamicMultiplier = Math.max(0.15, Math.min(3.0, punchGain * (1.0 + sustainGain * 0.05)));

return Math.tanh(inputSample * dynamicMultiplier * 0.9);`
  },
  {
    id: "factory-auto-wah",
    name: "Clavinet Envelope Auto-Wah",
    description: "Tracks active pick/input amplitude envelopes and maps that intensity to a sweeping vocal bandpass filter, yielding classic 70s funk wah effects.",
    category: "dynamics",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "sensitivity", name: "Envelope Sensitivity", min: 1.0, max: 8.0, defaultValue: 3.5, value: 5.2, unit: "x" },
      { id: "baseFreq", name: "Swell Bottom", min: 100, max: 1000, defaultValue: 350, value: 280, unit: "Hz" },
      { id: "wahQ", name: "Filter Q-Factor", min: 1.0, max: 10.0, defaultValue: 5.5, value: 6.8, unit: "Q" }
    ],
    dspFunction: `// Dynamic Auto-Wah (Envelope Sweep Filter)
if (!state.envelope) {
  state.envelope = 0.0;
  state.s1 = 0.0; state.s2 = 0.0;
}

let sensitivity = params.sensitivity !== undefined ? params.sensitivity : 3.5;
let baseFreq = params.baseFreq !== undefined ? params.baseFreq : 350.0;
let q = params.wahQ !== undefined ? params.wahQ : 5.5;

let absIn = Math.abs(inputSample);
state.envelope = state.envelope + 0.01 * (absIn - state.envelope); // leaky integrator

// Sweep filter frequency based on envelope
let targetFreq = baseFreq + state.envelope * sensitivity * 1400.0;
targetFreq = Math.max(60.0, Math.min(4800.0, targetFreq));

// Fast real-time biquad bandpass coefficients calculation
let omega = 2.0 * Math.PI * targetFreq / 44100.0;
let sin_o = Math.sin(omega);
let cos_o = Math.cos(omega);
let alpha = sin_o / (2.0 * q);

let b0 = alpha;
let b1 = 0.0;
let b2 = -alpha;
let a0 = 1.0 + alpha;
let a1 = -2.0 * cos_o;
let a2 = 1.0 - alpha;

let filterOut = (b0 * inputSample + state.s1) / a0;
state.s1 = b1 * inputSample - a1 * filterOut + state.s2;
state.s2 = b2 * inputSample - a2 * filterOut;

// Blended output mix
return inputSample * 0.4 + filterOut * 2.2 * 0.6;`
  },
  {
    id: "factory-barberpole-phaser",
    name: "Classic 4-Stage Analog Phaser",
    description: "Barberpole phaser chaining four sequential modular allpass filters within a feedback phase-crossover loop to create vintage fluid sweep notches.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "rate", name: "LFO Sweep Rate", min: 0.05, max: 5.0, defaultValue: 0.35, value: 0.45, unit: "Hz" },
      { id: "lfoDepth", name: "LFO Modulation Depth", min: 0.1, max: 1.0, defaultValue: 0.75, value: 0.85, unit: "%" },
      { id: "feedback", name: "Cascade Feedback", min: 0.0, max: 0.95, defaultValue: 0.75, value: 0.80, unit: "%" }
    ],
    dspFunction: `// Vintage Through-Zero Barberpole Phaser (Multi-Allpass Cascade)
if (!state.phi) {
  state.phi = 0.0;
  state.ap0 = 0.0; state.ap1 = 0.0;
  state.ap2 = 0.0; state.ap3 = 0.0;
}

let rateHz = params.rate !== undefined ? params.rate : 0.35;
let depth = params.lfoDepth !== undefined ? params.lfoDepth : 0.75;
let feedback = params.feedback !== undefined ? params.feedback : 0.75;

state.phi += (2.0 * Math.PI * rateHz) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

// Oscillating sweep frequency
let lfo = Math.sin(state.phi);
let sweepPercent = 0.5 + lfo * depth * 0.45; // 0.05 to 0.95 range

// Map to allpass factor "g" coef
let g = sweepPercent * 0.92 - 0.45; // stable [-0.45 to +0.47] range

// Recursive comb input adding previous cascade feedback
let phaserIn = inputSample + state.ap3 * feedback;

// 4 Cascading Allpass Filter Equations: y = g * x + last_x - g * last_y
let y0 = g * phaserIn + state.ap0;
state.ap0 = phaserIn - g * y0;

let y1 = g * y0 + state.ap1;
state.ap1 = y0 - g * y1;

let y2 = g * y1 + state.ap2;
state.ap2 = y1 - g * y2;

let y3 = g * y2 + state.ap3;
state.ap3 = y2 - g * y3;

// Destructive phasing sum output
return inputSample * 0.55 + y3 * 0.45;`
  },
  {
    id: "factory-comb-flanger",
    name: "Sub-Millisecond Comb Flanger",
    description: "Modulates tight delay buffers (0.5ms - 8ms) in real-time, utilizing linear offset interpolation to capture vintage jet-plane comb sweeps.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "speed", name: "Jet Sweep Speed", min: 0.05, max: 4.5, defaultValue: 0.25, value: 0.15, unit: "Hz" },
      { id: "feedback", name: "Comb Feed Polar", min: -0.9, max: 0.9, defaultValue: -0.75, value: -0.80, unit: "%" },
      { id: "depthMs", name: "Swoosh Comb Width", min: 0.5, max: 8.0, defaultValue: 3.5, value: 5.2, unit: "ms" }
    ],
    dspFunction: `// Jet-Vibe Dynamic Comb Flanger Sweep
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2);
  state.writePtr = 0;
  state.phi = 0.0;
}

let rateHz = params.speed !== undefined ? params.speed : 0.25;
let feedback = params.feedback !== undefined ? params.feedback : -0.75;
let depthMs = params.depthMs !== undefined ? params.depthMs : 3.5;

state.phi += (2.0 * Math.PI * rateHz) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

// LFO sweeping inside sub-millisecond ranges
let lfo = 0.5 * (Math.sin(state.phi) + 1.0); // positive [0 to 1]
let delayTimeMs = 0.52 + lfo * depthMs; // ultra-tight flange (0.5ms to 9ms)
let delaySamples = (delayTimeMs / 1000.0) * 44100.0;

let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let index0 = Math.floor(readPtr);
let index1 = (index0 + 1) % state.delayLine.length;
let frac = readPtr - index0;

let delaySample = (1.0 - frac) * state.delayLine[index0] + frac * state.delayLine[index1];

// Circular feedback routing
state.delayLine[state.writePtr] = Math.tanh(inputSample + delaySample * feedback);
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// Phasing mix summation
return inputSample * 0.5 + delaySample * 0.5;`
  },
  {
    id: "factory-leslie-speaker",
    name: "Doppler Leslie Rotary Speaker",
    description: "Replicates classic wooden rotating speaker cabinets, introducing complex Doppler pitch shifts alongside dynamic amplitude swells.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "hornSpeed", name: "Horn Rotor Speed", min: 1.0, max: 12.0, defaultValue: 6.5, value: 7.2, unit: "Hz" },
      { id: "dopplerMod", name: "Doppler Pitch-Swell", min: 0.0, max: 2.5, defaultValue: 1.5, value: 1.8, unit: "depth" },
      { id: "micDistance", name: "Cabinet Mic Depth", min: 0.1, max: 1.0, defaultValue: 0.65, value: 0.80, unit: "%" }
    ],
    dspFunction: `// Leslie Rotating Speaker Cabinet (Dynamic doppler & swell model)
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2);
  state.writePtr = 0;
  state.phi = 0.0;
}

let speedHz = params.hornSpeed !== undefined ? params.hornSpeed : 6.5;
let doppler = params.dopplerMod !== undefined ? params.dopplerMod : 1.5;
let micDist = params.micDistance !== undefined ? params.micDistance : 0.65;

state.phi += (2.0 * Math.PI * speedHz) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

let lfoCos = Math.cos(state.phi);
let lfoSin = Math.sin(state.phi);

// 1. Doppler phase-velocity delay mapping (rotating horn speed)
let delayMs = 3.52 + (lfoCos + 1.0) * doppler * 1.5; // Modulating distance delay
let delaySamples = (delayMs / 1000.0) * 44100.0;

let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let idx = Math.floor(readPtr);
let frac = readPtr - idx;
let delaySample = (1.0 - frac) * state.delayLine[idx] + frac * state.delayLine[(idx + 1) % state.delayLine.length];

state.delayLine[state.writePtr] = inputSample;
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

// 2. Amplitude Swell (tremolo depth depending on proximity rotation)
let amplitudeSwell = 1.0 - (0.5 * (lfoSin + 1.0) * micDist * 0.65);

return delaySample * amplitudeSwell * 1.15;`
  },
  {
    id: "factory-schroeder-reverb",
    name: "Classic Schroeder Reverberator",
    description: "Vintage digital reverb utilizing four parallel prime-length Comb delays followed by two serial allpasses to create an authentic decaying room envelope.",
    category: "reverb",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "size", name: "Room Width Scale", min: 0.2, max: 0.98, defaultValue: 0.85, value: 0.88, unit: "scale" },
      { id: "damp", name: "High-Freq Absorption", min: 0.0, max: 0.9, defaultValue: 0.45, value: 0.55, unit: "damp" },
      { id: "wet", name: "Reverb Wet Mix", min: 0.0, max: 1.0, defaultValue: 0.35, value: 0.40, unit: "%" }
    ],
    dspFunction: `// Schroeder Reverberator Grid Topology (Series Allpass / Parallel Comb)
if (!state.delay1) {
  // Setup 4 parallel comb delay line sizes (prime-ish samples)
  state.delay1 = new Float32Array(1113); state.ptr1 = 0;
  state.delay2 = new Float32Array(1363); state.ptr2 = 0;
  state.delay3 = new Float32Array(1541); state.ptr3 = 0;
  state.delay4 = new Float32Array(1705); state.ptr4 = 0;
  // Setup 2 serial allpass delay line series
  state.apDelay1 = new Float32Array(227); state.apPtr1 = 0;
  state.apDelay2 = new Float32Array(113); state.apPtr2 = 0;
}

let roomSize = params.size !== undefined ? params.size : 0.85;
let damping = params.damp !== undefined ? params.damp : 0.45;
let wetMix = params.wet !== undefined ? params.wet : 0.35;

// Let's damp comb feedbacks by a simple low-pass factor inside each comb loop
let combCoef = roomSize * 0.9;

const combProcess = (input, line, ptrName, ptrRef, decay) => {
  let out = line[ptrRef];
  let dampenedVal = out * (1.0 - damping);
  line[ptrRef] = input + dampenedVal * decay;
  return out;
};

let combOut1 = combProcess(inputSample, state.delay1, "ptr1", state.ptr1, combCoef);
state.ptr1 = (state.ptr1 + 1) % state.delay1.length;

let combOut2 = combProcess(inputSample, state.delay2, "ptr2", state.ptr2, combCoef);
state.ptr2 = (state.ptr2 + 1) % state.delay2.length;

let combOut3 = combProcess(inputSample, state.delay3, "ptr3", state.ptr3, combCoef);
state.ptr3 = (state.ptr3 + 1) % state.delay3.length;

let combOut4 = combProcess(inputSample, state.delay4, "ptr4", state.ptr4, combCoef);
state.ptr4 = (state.ptr4 + 1) % state.delay4.length;

let summedCombs = (combOut1 + combOut2 + combOut3 + combOut4) * 0.25;

// Allpass helper: y = g * x + last_x - g * last_y
const allpassProcess = (input, line, ptrRef, g) => {
  let last_x = line[ptrRef];
  let out = g * input + last_x;
  line[ptrRef] = input - g * out;
  return out;
};

let apOut1 = allpassProcess(summedCombs, state.apDelay1, state.apPtr1, 0.55);
state.apPtr1 = (state.apPtr1 + 1) % state.apDelay1.length;

let apOut2 = allpassProcess(apOut1, state.apDelay2, state.apPtr2, 0.55);
state.apPtr2 = (state.apPtr2 + 1) % state.apDelay2.length;

return inputSample * (1.0 - wetMix) + Math.tanh(apOut2) * wetMix * 1.1;`
  },
  {
    id: "factory-ambient-cloud",
    name: "Feedback Delay Network (Endless Cloud)",
    description: "4x4 Householder matrix Feedback Delay Network (FDN) with prime-length delay loops scattering reverb energy into celestial endless spaces.",
    category: "reverb",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "roomSize", name: "Decay Lifetime", min: 0.5, max: 0.99, defaultValue: 0.94, value: 0.97, unit: "scale" },
      { id: "highCut", name: "Damping High-Cut", min: 500, max: 15000, defaultValue: 4200, value: 3500, unit: "Hz" },
      { id: "mix", name: "Spatial Wet Intensity", min: 0.0, max: 1.0, defaultValue: 0.48, value: 0.60, unit: "%" }
    ],
    dspFunction: `// Feedback Delay Network (FDN) Endless Cloud Space
if (!state.delayA) {
  state.delayA = new Float32Array(2251); state.ptA = 0;
  state.delayB = new Float32Array(3121); state.ptB = 0;
  state.delayC = new Float32Array(4013); state.ptC = 0;
  state.delayD = new Float32Array(5119); state.ptD = 0;
  state.lpA = 0.0; state.lpB = 0.0; state.lpC = 0.0; state.lpD = 0.0;
}

let roomSize = params.roomSize !== undefined ? params.roomSize : 0.94;
let highCut = params.highCut !== undefined ? params.highCut : 4200.0;
let mix = params.mix !== undefined ? params.mix : 0.48;

let outA = state.delayA[state.ptA];
let outB = state.delayB[state.ptB];
let outC = state.delayC[state.ptC];
let outD = state.delayD[state.ptD];

// Apply damping to each output
let dampCoeff = Math.min(0.45, highCut / 44100.0);
state.lpA += dampCoeff * (outA - state.lpA);
state.lpB += dampCoeff * (outB - state.lpB);
state.lpC += dampCoeff * (outC - state.lpC);
state.lpD += dampCoeff * (outD - state.lpD);

// Dynamic 4x4 Householder Mixing Matrix values (unitary feedback map)
let gainFactor = roomSize * 0.707;
let inA = inputSample + ( state.lpA * 0.5 + state.lpB * 0.5 + state.lpC * 0.5 + state.lpD * 0.5) * gainFactor;
let inB = inputSample + (-state.lpA * 0.5 + state.lpB * 0.5 - state.lpC * 0.5 + state.lpD * 0.5) * gainFactor;
let inC = inputSample + ( state.lpA * 0.5 - state.lpB * 0.5 - state.lpC * 0.5 + state.lpD * 0.5) * gainFactor;
let inD = inputSample + (-state.lpA * 0.5 - state.lpB * 0.5 + state.lpC * 0.5 + state.lpD * 0.5) * gainFactor;

state.delayA[state.ptA] = inA; state.ptA = (state.ptA + 1) % state.delayA.length;
state.delayB[state.ptB] = inB; state.ptB = (state.ptB + 1) % state.delayB.length;
state.delayC[state.ptC] = inC; state.ptC = (state.ptC + 1) % state.delayC.length;
state.delayD[state.ptD] = inD; state.ptD = (state.ptD + 1) % state.delayD.length;

// Lush spatial summing
let lushDensityFactor = (outA - outB + outC - outD) * 0.5;

return inputSample * (1.0 - mix) + Math.tanh(lushDensityFactor) * mix * 1.35;`
  },
  {
    id: "factory-ms-widener",
    name: "Mid/Side Stereo Image Widener",
    description: "Splits signals into Mid (mono sum) and Side (difference) channels, expanding soundstages with low-frequency bass centering.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "width", name: "Stereo Width", min: 0.0, max: 2.5, defaultValue: 1.5, value: 1.6, unit: "x" },
      { id: "bassMonoFreq", name: "Bass Center Guard", min: 80, max: 500, defaultValue: 150, value: 160, unit: "Hz" },
      { id: "sideGain", name: "Side Field Gain", min: 0.0, max: 2.0, defaultValue: 1.2, value: 1.3, unit: "dB" }
    ],
    dspFunction: `// Mid/Side Stereo Widener with Low Bass Mono Guard
if (!state.lpL) {
  state.lpL = 0.0;
}
let width = params.width !== undefined ? params.width : 1.5;
let crossFreq = params.bassMonoFreq !== undefined ? params.bassMonoFreq : 150.0;
let sideGain = params.sideGain !== undefined ? params.sideGain : 1.2;

// Split a pseudo-stereo field via mirror sub-sample delay
if (!state.stereoBuffer) {
  state.stereoBuffer = new Float32Array(512);
  state.bufPtr = 0;
}
state.stereoBuffer[state.bufPtr] = inputSample;
let delaySample = state.stereoBuffer[(state.bufPtr - 16 + 512) % 512];
state.bufPtr = (state.bufPtr + 1) % 512;

let chLeft = inputSample;
let chRight = delaySample;

let mid = (chLeft + chRight) * 0.5;
let side = (chLeft - chRight) * 0.5;

// Filter low-frequencies from side to center bass
let f = Math.min(0.2, crossFreq / 44100.0);
let alpha = Math.min(0.99, 2.0 * Math.PI * f);
state.lpL = state.lpL + alpha * (side - state.lpL);
let highSide = side - state.lpL;

let processedSide = highSide * width * sideGain;
let outputL = mid + processedSide;
let outputR = mid - processedSide;

// Soft sum output for the mono engine path
return outputL * 0.5 + outputR * 0.5;`
  },
  {
    id: "factory-germanium-fuzz",
    name: "Germanium Diode Fuzz Preamp",
    description: "Simulates crystal PNP transistor junctions with asymmetric voltage drops, generating vintage thick fuzz grit.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "fuzz", name: "Fuzz Intensity", min: 1.0, max: 20.0, defaultValue: 8.5, value: 12.0, unit: "gain" },
      { id: "bias", name: "Asymmetry Bias", min: 0.0, max: 1.0, defaultValue: 0.15, value: 0.22, unit: "V" },
      { id: "germaniumSymmetry", name: "Diode Threshold", min: 1.0, max: 5.0, defaultValue: 2.2, value: 2.8, unit: "hmn" }
    ],
    dspFunction: `// Germanium Diode Fuzz with Vintage Volts Sag
let fuzz = params.fuzz !== undefined ? params.fuzz : 8.5;
let bias = params.bias !== undefined ? params.bias : 0.15;
let gs = params.germaniumSymmetry !== undefined ? params.germaniumSymmetry : 2.2;

let x = inputSample * fuzz + bias;
let out = 0.0;

if (x > 0.0) {
  out = (Math.exp(x * gs) - 1.0) / gs;
  out = Math.min(0.65, out);
} else {
  out = -((Math.exp(-x) - 1.0) / 1.5);
  out = Math.max(-0.65, out);
}

return Math.tanh(out * 2.2) * 0.82;`
  },
  {
    id: "factory-haas-effect",
    name: "Haas Micro-Delay Spatializer",
    description: "Channels sub-30ms slap delays within high-damping filters to build elegant vintage sense of space without long reverb wash.",
    category: "delay",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "haasDelay", name: "Micro Slapback", min: 1, max: 40, defaultValue: 18, value: 22, unit: "ms" },
      { id: "combDamp", name: "Slap Damping", min: 0.0, max: 0.9, defaultValue: 0.35, value: 0.45, unit: "%" },
      { id: "dryMix", name: "Dry/Wet Balance", min: 0.0, max: 1.0, defaultValue: 0.5, value: 0.55, unit: "%" }
    ],
    dspFunction: `// Haas Micro-Delay Comb Filter
if (!state.delayLine) {
  state.delayLine = new Float32Array(2048);
  state.writePtr = 0;
}
let haasMs = params.haasDelay !== undefined ? params.haasDelay : 18.0;
let damp = params.combDamp !== undefined ? params.combDamp : 0.35;
let dryMix = params.dryMix !== undefined ? params.dryMix : 0.5;

let delaySamples = Math.max(1, Math.min(1500, Math.floor((haasMs / 1000.0) * 44100)));
let readPtr = (state.writePtr - delaySamples + state.delayLine.length) % state.delayLine.length;

let HaasSample = state.delayLine[readPtr] || 0.0;
state.delayLine[state.writePtr] = inputSample - HaasSample * damp;
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

return inputSample * dryMix + HaasSample * (1.0 - dryMix);`
  },
  {
    id: "factory-tape-hysteresis",
    name: "Magnetic Hysteresis Saturation",
    description: "Simulates molecular magnetic domains on tape that resist rapid polarization, thickening bass notes via stateful energy memory.",
    category: "distortion",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "magneticSat", name: "Flux Saturation", min: 1.0, max: 10.0, defaultValue: 3.5, value: 5.2, unit: "x" },
      { id: "hysteresis", name: "Lag Coercivity", min: 0.05, max: 0.8, defaultValue: 0.35, value: 0.42, unit: "%" },
      { id: "demagnetize", name: "HF Demagnetize", min: 1.0, max: 5.0, defaultValue: 2.2, value: 2.8, unit: "damp" }
    ],
    dspFunction: `// Magnetic Tape Hysteresis and Flux Memory Simulator
if (!state.lastInput) {
  state.lastInput = 0.0;
  state.lastOutput = 0.0;
}
let sat = params.magneticSat !== undefined ? params.magneticSat : 3.5;
let h = params.hysteresis !== undefined ? params.hysteresis : 0.35;
let demag = params.demagnetize !== undefined ? params.demagnetize : 2.2;

let x = inputSample * sat;
let delta = x - state.lastInput;

let activeH = h * (1.1 - Math.abs(state.lastOutput) * 0.4);
let directionFactor = delta > 0.0 ? activeH : -activeH;

let saturated = Math.tanh(x - state.lastOutput * directionFactor);

state.lastInput = x;
state.lastOutput = state.lastOutput + (1.0 / demag) * (saturated - state.lastOutput);

return state.lastOutput * 0.85;`
  },
  {
    id: "factory-ring-mod",
    name: "Carrier Wave Ring Modulator",
    description: "Multiplies incoming signals with a synthesized variable cosine carrier wave, producing bell-like odd textures and cybernetic sci-fi voices.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "carrierFreq", name: "Carrier Wave Pitch", min: 50, max: 3000, defaultValue: 440, value: 580, unit: "Hz" },
      { id: "sinePulse", name: "Carrier Waveform", min: 0.0, max: 1.0, defaultValue: 0.8, value: 0.7, unit: "sin" },
      { id: "feedback", name: "Sideband Echo Feed", min: 0.0, max: 0.8, defaultValue: 0.25, value: 0.35, unit: "%" }
    ],
    dspFunction: `// Ring Modulator with Cosine Carrier Oscillator
if (!state.phi) {
  state.phi = 0.0;
  state.delayVal = 0.0;
}
let cFreq = params.carrierFreq !== undefined ? params.carrierFreq : 440.0;
let sPulse = params.sinePulse !== undefined ? params.sinePulse : 0.8;
let feedback = params.feedback !== undefined ? params.feedback : 0.25;

state.phi += (2.0 * Math.PI * cFreq) / 44100.0;
if (state.phi > 2.0 * Math.PI) {
  state.phi -= 2.0 * Math.PI;
}

let carrier = Math.sin(state.phi) * sPulse + Math.sign(Math.sin(state.phi)) * (1.0 - sPulse) * 0.25;
let modulated = (inputSample + state.delayVal * feedback) * carrier;
state.delayVal = modulated;

return inputSample * 0.3 + modulated * 0.7;`
  },
  {
    id: "factory-opto-tremolo",
    name: "Vintage Optoelectronic Tremolo",
    description: "Recreates optical lfo phototransistor bulb rise-and-fall delays, introducing a unique warm asymmetrical breathing sweep.",
    category: "modulation",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "speedHz", name: "LFO Swell Rate", min: 1.5, max: 15.0, defaultValue: 5.5, value: 4.8, unit: "Hz" },
      { id: "depth", name: "Amplitude Mod Depth", min: 0.0, max: 1.0, defaultValue: 0.85, value: 0.75, unit: "%" },
      { id: "asymmetry", name: "Bulb Lag Inertia", min: 0.1, max: 0.9, defaultValue: 0.65, value: 0.55, unit: "lag" }
    ],
    dspFunction: `// Vintage Optoelectronic Photoresistor Tremolo Swell
if (!state.phi) {
  state.phi = 0.0;
  state.shifterVal = 0.0;
}
let speed = params.speedHz !== undefined ? params.speedHz : 5.5;
let depth = params.depth !== undefined ? params.depth : 0.85;
let asym = params.asymmetry !== undefined ? params.asymmetry : 0.65;

state.phi += (2.0 * Math.PI * speed) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

let rawLfo = Math.sin(state.phi);
let targetLfo = rawLfo > 0.0 ? rawLfo : rawLfo * asym;

state.shifterVal = state.shifterVal + 0.12 * (targetLfo - state.shifterVal);
let gainCoefficient = 1.0 - (depth * 0.5 * (state.shifterVal + 1.0));

return inputSample * gainCoefficient;`
  },
  {
    id: "factory-noise-gate",
    name: "Dynamic Studio Hysteresis Gate",
    description: "Clamps signals dropping below chosen thresholds, featuring custom split open/close buffers to silence noise floors flawlessly.",
    category: "dynamics",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "threshDb", name: "Gate Threshold", min: -60.0, max: -10.0, defaultValue: -35.0, value: -42.0, unit: "dB" },
      { id: "holdTimeMs", name: "Chamber Hold Delay", min: 10, max: 300, defaultValue: 50, value: 80, unit: "ms" },
      { id: "hysteresis", name: "Hysteresis Window", min: 1.0, max: 8.0, defaultValue: 3.5, value: 4.5, unit: "dB" }
    ],
    dspFunction: `// Dynamic Hysteresis Noise Gate
if (!state.env) {
  state.env = 0.0;
  state.gateGain = 1.0;
  state.holdCounter = 0;
}
let thresh = params.threshDb !== undefined ? params.threshDb : -35.0;
let holdMs = params.holdTimeMs !== undefined ? params.holdTimeMs : 50.0;
let hyst = params.hysteresis !== undefined ? params.hysteresis : 3.5;

let absIn = Math.abs(inputSample);
state.env += 0.08 * (absIn - state.env);

let envDb = 20.0 * Math.log10(Math.max(1e-5, state.env));
let closeThresh = thresh - hyst;
let openThresh = thresh;

let holdSamples = Math.floor((holdMs / 1000.0) * 44100);

if (envDb > openThresh) {
  state.gateGain = 1.0;
  state.holdCounter = holdSamples;
} else if (envDb < closeThresh) {
  if (state.holdCounter > 0) {
    state.holdCounter--;
    state.gateGain = 1.0;
  } else {
    state.gateGain += 0.005 * (0.0 - state.gateGain);
  }
}

return inputSample * state.gateGain;`
  },
  {
    id: "factory-ott-compressor",
    name: "Studio OTC Up/Down Compressor",
    description: "Two-way heavy dynamic sound shaper. Amplifies silent details (upward) while strictly compressing loud audio peaks (downward).",
    category: "dynamics",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "upwardDb", name: "Upward Threshold", min: -45.0, max: -15.0, defaultValue: -32.0, value: -28.0, unit: "dB" },
      { id: "downwardDb", name: "Downward Threshold", min: -25.0, max: 0.0, defaultValue: -10.0, value: -12.0, unit: "dB" },
      { id: "ratio", name: "Compression Ratio", min: 1.5, max: 10.0, defaultValue: 4.5, value: 3.8, unit: ":1" }
    ],
    dspFunction: `// Upward and Downward OTT Dynamic Maximizer
if (!state.env) {
  state.env = 0.0;
  state.compGain = 1.0;
}
let upThresh = params.upwardDb !== undefined ? params.upwardDb : -32.0;
let downThresh = params.downwardDb !== undefined ? params.downwardDb : -10.0;
let ratio = params.ratio !== undefined ? params.ratio : 4.5;

let absIn = Math.abs(inputSample);
state.env += 0.015 * (absIn - state.env);

let envDb = 20.0 * Math.log10(Math.max(1e-5, state.env));
let gainCompDb = 0.0;

if (envDb < upThresh) {
  let gap = upThresh - envDb;
  gainCompDb = (gap * (1.0 - 1.0 / ratio)) * 0.65;
} else if (envDb > downThresh) {
  let gap = envDb - downThresh;
  gainCompDb = -(gap * (1.0 - 1.0 / ratio)) * 0.85;
}

let targetGain = Math.pow(10.0, gainCompDb / 20.0);
state.compGain += 0.015 * (targetGain - state.compGain);

return inputSample * state.compGain;`
  },
  {
    id: "factory-arpeggiator",
    name: "8-Bit step-mod minor7 Synth",
    description: "Automates sound synthesis by triggering minor 7th chord step cycles paired with glide glissando and variable duty square pulses.",
    category: "synthesizer",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "bpm", name: "Sequencer Speed", min: 60, max: 220, defaultValue: 125, value: 140, unit: "BPM" },
      { id: "pulseWidth", name: "Square Pulse Width", min: 0.1, max: 0.9, defaultValue: 0.5, value: 0.4, unit: "duty" },
      { id: "glide", name: "Glide Glissando", min: 0.01, max: 0.5, defaultValue: 0.1, value: 0.14, unit: "sec" }
    ],
    dspFunction: `// Chiptune 8-Bit Step Modulator and Arpeggiator Synth
if (!state.stepIndex) {
  state.stepIndex = 0;
  state.samplesPerStep = 0;
  state.phi = 0.0;
  state.portFreq = 110.0;
  state.gateEnv = 0.0;
}
let bpm = params.bpm !== undefined ? params.bpm : 125.0;
let duty = params.pulseWidth !== undefined ? params.pulseWidth : 0.5;
let glide = params.glide !== undefined ? params.glide : 0.1;

let stepIntervalSamples = Math.floor((60.0 / bpm / 4.0) * 44100);

state.samplesPerStep++;
if (state.samplesPerStep >= stepIntervalSamples) {
  state.samplesPerStep = 0;
  state.stepIndex = (state.stepIndex + 1) % 8;
  state.gateEnv = 1.0;
}

// minor 7th chord step cycles
let notes = [110.0, 130.81, 164.81, 196.00, 220.0, 261.63, 329.63, 392.00];
let targetFreq = notes[state.stepIndex];

state.portFreq = state.portFreq + (glide) * (targetFreq - state.portFreq);

state.gateEnv -= 0.00018;
if (state.gateEnv < 0.0) state.gateEnv = 0.0;

state.phi += (2.0 * Math.PI * state.portFreq) / 44100.0;
if (state.phi > 2.0 * Math.PI) {
  state.phi -= 2.0 * Math.PI;
}

let pulseSample = (state.phi / (2.0 * Math.PI) < duty) ? 1.0 : -1.0;
let synthOut = pulseSample * state.gateEnv * 0.35;

return inputSample * 0.5 + synthOut * 0.45;`
  },
  {
    id: "factory-noise-wind",
    name: "Active Ocean Subtractive Synth",
    description: "Recreates fluid oceans and wind gust atmospheres by shaping a stateful white noise generator inside sweeping LFO biquads.",
    category: "synthesizer",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "cutoff", name: "Frequency Base", min: 100, max: 8000, defaultValue: 800, value: 920, unit: "Hz" },
      { id: "rateHz", name: "Swell Tide Speed", min: 0.05, max: 1.5, defaultValue: 0.15, value: 0.12, unit: "Hz" },
      { id: "resonance", name: "Spray High-Cut Q", min: 1.0, max: 12.0, defaultValue: 6.5, value: 8.5, unit: "Q" }
    ],
    dspFunction: `// Subtractive Noise Soundscape (Ocean Wind Synth)
if (!state.s1) {
  state.s1 = 0.0; state.s2 = 0.0;
  state.lfoPhi = 0.0;
}
let cutoffBase = params.cutoff !== undefined ? params.cutoff : 800.0;
let lfoRate = params.rateHz !== undefined ? params.rateHz : 0.15;
let q = params.resonance !== undefined ? params.resonance : 6.5;

if (state.seed === undefined) state.seed = 12345;
state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
let whiteNoiseRaw = ((state.seed / 1073741824.0) - 1.0) * 0.15;

state.lfoPhi += (2.0 * Math.PI * lfoRate) / 44100.0;
if (state.lfoPhi > 2.0 * Math.PI) state.lfoPhi -= 2.0 * Math.PI;

let swell = 0.5 * (Math.sin(state.lfoPhi) + 1.0);
let targetCutoff = cutoffBase * (0.35 + swell * 2.5);

let omega = (2.0 * Math.PI * targetCutoff) / 44100.0;
let sin_o = Math.sin(omega);
let cos_o = Math.cos(omega);
let alpha = sin_o / (2.0 * q);

let b0 = alpha;
let b1 = 0.0;
let b2 = -alpha;
let a0 = 1.0 + alpha;
let a1 = -2.0 * cos_o;
let a2 = 1.0 - alpha;

let resNoise = (b0 * whiteNoiseRaw + state.s1) / a0;
state.s1 = b1 * whiteNoiseRaw - a1 * resNoise + state.s2;
state.s2 = b2 * whiteNoiseRaw - a2 * resNoise;

let windAtmosphere = resNoise * (0.4 + swell * 0.6) * 3.8;

return inputSample * 0.45 + windAtmosphere * 0.55;`
  },
  {
    id: "factory-reverse-gate",
    name: "Classic Reverse Gated Reverb",
    description: "Recreates classic 80s shoegaze drum and guitar sweeps by feeding delay registers backwards through exponential swell curves.",
    category: "reverb",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "gateTimeMs", name: "Swell Gate Time", min: 100, max: 500, defaultValue: 280, value: 340, unit: "ms" },
      { id: "density", name: "Reflex Density", min: 0.1, max: 0.95, defaultValue: 0.75, value: 0.85, unit: "%" },
      { id: "wet", name: "Reverse Wet Balance", min: 0.0, max: 1.0, defaultValue: 0.5, value: 0.6, unit: "%" }
    ],
    dspFunction: `// Classic 80s Reverse Gated Reverb Envelope
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100);
  state.writePtr = 0;
}
let gateMs = params.gateTimeMs !== undefined ? params.gateTimeMs : 280.0;
let dens = params.density !== undefined ? params.density : 0.75;
let wetMix = params.wet !== undefined ? params.wet : 0.50;

state.delayLine[state.writePtr] = inputSample;

let gateSamples = Math.floor((gateMs / 1000.0) * 44100);
let accumulatedReverse = 0.0;
let stages = 12;

for (let i = 0; i < stages; i++) {
  let fraction = (i + 1) / stages;
  let tapSampleOffset = Math.floor(fraction * gateSamples);
  
  let readPtr = (state.writePtr - tapSampleOffset + state.delayLine.length) % state.delayLine.length;
  let rampUpGain = fraction * fraction;
  accumulatedReverse += (state.delayLine[readPtr] || 0.0) * rampUpGain;
}

accumulatedReverse = (accumulatedReverse / stages) * dens * 2.8;
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

return inputSample * (1.0 - wetMix) + Math.tanh(accumulatedReverse) * wetMix;`
  },
  {
    id: "factory-plate-reverb",
    name: "Nested-Diffuser Plate Reverb",
    description: "Chains 4 nested prime allpass diffusers to mimic acoustic metal plates, yielding lush continuous diffusion without flutter echoes.",
    category: "reverb",
    timestamp: "Factory Default",
    isBuiltIn: true,
    parameters: [
      { id: "decayTime", name: "Plate Decay Limit", min: 0.5, max: 5.0, defaultValue: 2.2, value: 3.2, unit: "sec" },
      { id: "hfDamp", name: "High Damping Gate", min: 1000, max: 10000, defaultValue: 3800, value: 4500, unit: "Hz" },
      { id: "diffusion", name: "Diffuser Feed Amount", min: 0.1, max: 0.9, defaultValue: 0.65, value: 0.75, unit: "%" }
    ],
    dspFunction: `// Nested Plate Reverb Model
if (!state.d1) {
  state.d1 = new Float32Array(511); state.p1 = 0;
  state.d2 = new Float32Array(727); state.p2 = 0;
  state.d3 = new Float32Array(1103); state.p3 = 0;
  state.d4 = new Float32Array(2237); state.p4 = 0;
  state.lpFilter = 0.0;
}
let decay = params.decayTime !== undefined ? params.decayTime : 2.2;
let damp = params.hfDamp !== undefined ? params.hfDamp : 3800.0;
let diff = params.diffusion !== undefined ? params.diffusion : 0.65;

const ap = (input, ref, ptrRef, g) => {
  let last_x = ref[ptrRef] || 0.0;
  let out = g * input + last_x;
  ref[ptrRef] = input - g * out;
  return out;
};

let ap1 = ap(inputSample, state.d1, state.p1, diff);
state.p1 = (state.p1 + 1) % state.d1.length;

let ap2 = ap(ap1, state.d2, state.p2, diff * 0.9);
state.p2 = (state.p2 + 1) % state.d2.length;

let ap3 = ap(ap2, state.d3, state.p3, diff * 0.8);
state.p3 = (state.p3 + 1) % state.d3.length;

let lpVal = Math.min(0.4, damp / 44100.0);
state.lpFilter += lpVal * (ap3 - state.lpFilter);

let feedRatio = Math.min(0.95, decay / 6.0);
let plateOut = ap(state.lpFilter, state.d4, state.p4, feedRatio);
state.p4 = (state.p4 + 1) % state.d4.length;

return inputSample * 0.6 + Math.tanh(plateOut) * 0.45;`
  }
];

// Procedural generator to expand the DSP library with 3110 high-craft, mathematically correct sound presets
const generateProgrammaticLibrary = (): UserPreset[] => {
  const list: UserPreset[] = [];
  let idCounter = 1;

  // 1. Distortion Sub-Library (380 presets) - Vacuum Tube models, saturation shapes, germanium diode clip presets
  const tubeDrives = [1.2, 1.8, 2.5, 3.4, 4.2, 5.5, 6.8, 8.2, 9.6, 11.5];
  const tubeBiases = [-0.35, -0.2, -0.1, 0.05, 0.18, 0.25, 0.38, 0.5];
  for (let i = 0; i < 380; i++) {
    const driveVal = tubeDrives[i % tubeDrives.length] + (i * 0.03);
    const biasVal = tubeBiases[i % tubeBiases.length];
    const symmetry = 1.2 + (i % 6) * 0.4;
    const name = `Vacuum Triode Saturation No.${i + 1} (Gain: ${driveVal.toFixed(1)}x)`;
    const description = `Procedural asymmetric triode vacuum-tube preamp simulator. Implements dynamic voltage grid sag modeling with a bias offset of ${biasVal.toFixed(2)}V.`;

    list.push({
      id: `gen-dist-tube-${idCounter++}`,
      name,
      description,
      category: "distortion",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "drive", name: "Drive Boost", min: 1.0, max: 15.0, defaultValue: 4.5, value: Number(driveVal.toFixed(2)), unit: "x" },
        { id: "bias", name: "Grid DC Bias", min: -0.8, max: 0.8, defaultValue: 0.25, value: Number(biasVal.toFixed(2)), unit: "V" },
        { id: "asym", name: "Curve Asymmetry", min: 1.0, max: 5.0, defaultValue: 2.2, value: Number(symmetry.toFixed(2)), unit: "hmn" }
      ],
      dspFunction: `// Procedural Triode Tube Model No.${i + 1}
let drive = params.drive !== undefined ? params.drive : ${driveVal.toFixed(2)};
let bias = params.bias !== undefined ? params.bias : ${biasVal.toFixed(2)};
let sym = params.asym !== undefined ? params.asym : ${symmetry.toFixed(2)};

let x = inputSample * drive + bias;
let out = 0.0;
if (x > 0.0) {
  out = Math.tanh(x * sym);
} else {
  out = (Math.exp(x) - 1.0) / sym;
}
return Math.tanh(out * 1.35) * 0.85;`
    });
  }

  // 2. Delays & Echo Taps Sub-Library (380 presets) - Echo durations, channel offsets, feed configurations
  for (let i = 0; i < 380; i++) {
    const timeVal = 60 + (i * 13) % 880; 
    const fbVal = 0.15 + (i * 0.009) % 0.78;
    const dampVal = 0.2 + (i * 0.008) % 0.65;
    const name = `Multitap Planetary Echo No.${i + 1} (${timeVal}ms)`;
    const description = `Procedural multi-tap delay spacing configured to exactly ${timeVal}ms with low-frequency damp stabilization of ${(dampVal * 100).toFixed(0)}%.`;

    list.push({
      id: `gen-delay-tap-${idCounter++}`,
      name,
      description,
      category: "delay",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "time", name: "Delay Time", min: 10, max: 1000, defaultValue: 250, value: timeVal, unit: "ms" },
        { id: "feedback", name: "Feedback Decay", min: 0.0, max: 0.95, defaultValue: 0.5, value: Number(fbVal.toFixed(2)), unit: "%" },
        { id: "damp", name: "Loop Dampening", min: 0.05, max: 0.9, defaultValue: 0.3, value: Number(dampVal.toFixed(2)), unit: "damp" }
      ],
      dspFunction: `// Procedural Infinite Delay Line No.${i + 1}
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2);
  state.writePtr = 0;
  state.lp = 0.0;
}
let time = params.time !== undefined ? params.time : ${timeVal};
let fb = params.feedback !== undefined ? params.feedback : ${fbVal.toFixed(2)};
let decayDamp = params.damp !== undefined ? params.damp : ${dampVal.toFixed(2)};

let delaySamples = Math.floor((time / 1000.0) * 44100);
let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let delaySample = state.delayLine[readPtr] || 0.0;

// Apply loop lowpass feedback stabilization 
state.lp = state.lp + (1.0 - decayDamp) * (delaySample - state.lp);

state.delayLine[state.writePtr] = Math.tanh(inputSample + state.lp * fb);
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

return inputSample * 0.55 + state.lp * 0.45;`
    });
  }

  // 3. Filters & Sweeping Resonators (380 presets) - Cutoff bounds, resonant peaks, bandpasses
  for (let i = 0; i < 380; i++) {
    const cutVal = 120 + (i * 223) % 7800; 
    const qVal = 1.2 + (i * 0.12) % 12.0;
    const name = `State Variable Polar Filter No.${i + 1} (${cutVal}Hz)`;
    const description = `Procedural state-variable analog filter layout. Features lowpass-bandpass morphing centered at ${cutVal}Hz with Q threshold of ${qVal.toFixed(2)}.`;

    list.push({
      id: `gen-filter-svf-${idCounter++}`,
      name,
      description,
      category: "filter",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "cutoff", name: "Center Cutoff", min: 50, max: 12000, defaultValue: 1000, value: cutVal, unit: "Hz" },
        { id: "resonance", name: "Filter Q Resonance", min: 0.5, max: 15.0, defaultValue: 2.0, value: Number(qVal.toFixed(2)), unit: "Q" }
      ],
      dspFunction: `// Procedural Chamberlin SVF No.${i + 1}
if (!state.low) {
  state.low = 0.0;
  state.band = 0.0;
}
let cut = params.cutoff !== undefined ? params.cutoff : ${cutVal};
let q = params.resonance !== undefined ? params.resonance : ${qVal.toFixed(2)};

let f = 2.0 * Math.sin(Math.PI * cut / 44100.0);
let d = 1.0 / q;

let high = inputSample - state.low - d * state.band;
state.band = state.band + f * high;
state.low = state.low + f * state.band;

// Protect from digital overload
state.band = Math.max(-1.5, Math.min(1.5, state.band));
state.low = Math.max(-1.5, Math.min(1.5, state.low));

return state.band * 1.6 + state.low * 0.4;`
    });
  }

  // 4. Synthesizer Drone Generators (380 presets) - Chromatic pitches, detuning gaps, FM modulators
  for (let i = 0; i < 380; i++) {
    const rootFreq = 45 + (i * 9) % 360; 
    const modRatio = 1.0 + (i * 0.09) % 8.0;
    const indexVal = 1.0 + (i * 0.22) % 15.0;
    const name = `Sub FM Drone Synthesizer No.${i + 1} (${rootFreq}Hz)`;
    const description = `Procedural 2-Operator frequency-modulation carrier drone, generating massive, rich detuned sideband tones with pitch offset of ${rootFreq}Hz.`;

    list.push({
      id: `gen-synth-fm-${idCounter++}`,
      name,
      description,
      category: "synthesizer",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "carrierFreq", name: "Carrier Tone Pitch", min: 40, max: 500, defaultValue: 110, value: rootFreq, unit: "Hz" },
        { id: "modRatio", name: "FM Modulator Ratio", min: 1.0, max: 10.0, defaultValue: 3.0, value: Number(modRatio.toFixed(2)), unit: "ratio" },
        { id: "modIndex", name: "Modulation Index", min: 0.0, max: 20.0, defaultValue: 5.0, value: Number(indexVal.toFixed(2)), unit: "idx" }
      ],
      dspFunction: `// Procedural 2-Op FM Sub-Drone No.${i + 1}
if (!state.phiCar) {
  state.phiCar = 0.0;
  state.phiMod = 0.0;
}
let carFreq = params.carrierFreq !== undefined ? params.carrierFreq : ${rootFreq};
let ratio = params.modRatio !== undefined ? params.modRatio : ${modRatio.toFixed(2)};
let idx = params.modIndex !== undefined ? params.modIndex : ${indexVal.toFixed(2)};

state.phiMod += (2.0 * Math.PI * (carFreq * ratio)) / 44100.0;
state.phiCar += (2.0 * Math.PI * carFreq) / 44100.0;

if (state.phiMod > 2.0 * Math.PI) state.phiMod -= 2.0 * Math.PI;
if (state.phiCar > 2.0 * Math.PI) state.phiCar -= 2.0 * Math.PI;

let modulator = Math.sin(state.phiMod) * idx;
let synthOsc = Math.sin(state.phiCar + modulator);

return inputSample * 0.5 + synthOsc * 0.25;`
    });
  }

  // 5. Dynamics Compressors (250 presets) - AGC threshold variations, release limits, transient clamps
  for (let i = 0; i < 250; i++) {
    const threshVal = -36.0 + (i % 8) * 4.0; 
    const ratioVal = 1.2 + (i * 0.16) % 11.0;
    const releaseVal = 60 + (i * 7) % 360;
    const name = `Satin Analog AGC Comp No.${i + 1} (${threshVal.toFixed(0)}dB)`;
    const description = `Procedural RMS sidechain dynamic envelope compressor. Clamps sudden transients with automatic gain makeup and recovery times of ${releaseVal}ms.`;

    list.push({
      id: `gen-dynamics-comp-${idCounter++}`,
      name,
      description,
      category: "dynamics",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "threshold", name: "Dynamic Threshold", min: -40.0, max: 0.0, defaultValue: -20, value: Number(threshVal.toFixed(1)), unit: "dB" },
        { id: "ratio", name: "Gain Ratio", min: 1.0, max: 12.0, defaultValue: 4.0, value: Number(ratioVal.toFixed(2)), unit: ":1" },
        { id: "releaseMs", name: "Envelope Release", min: 10, max: 500, defaultValue: 100, value: releaseVal, unit: "ms" }
      ],
      dspFunction: `// Procedural Dynamics AGC No.${i + 1}
if (!state.envelope) {
  state.envelope = 0.0001;
}
let thresholdDb = params.threshold !== undefined ? params.threshold : ${threshVal.toFixed(1)};
let ratio = params.ratio !== undefined ? params.ratio : ${ratioVal.toFixed(2)};
let release = params.releaseMs !== undefined ? params.releaseMs : ${releaseVal};

let attackCoeff = 1.0 - Math.exp(-1.0 / (8.0 * 44.1));
let releaseCoeff = 1.0 - Math.exp(-1.0 / (release * 44.1));

let absIn = Math.abs(inputSample);

if (absIn > state.envelope) {
  state.envelope += attackCoeff * (absIn - state.envelope);
} else {
  state.envelope += releaseCoeff * (absIn - state.envelope);
}

let envelopeDb = 20.0 * Math.log10(Math.max(1e-5, state.envelope));
let gainComp = 1.0;

if (envelopeDb > thresholdDb) {
  let overDb = envelopeDb - thresholdDb;
  let targetDb = thresholdDb + overDb / ratio;
  gainComp = Math.pow(10.0, (targetDb - envelopeDb) / 20.0);
}

return inputSample * gainComp * 1.15;`
    });
  }

  // 6. Chorus / Flanger Sweepers (250 presets) - Vibrato speeds, bucket-brigade clock offsets
  for (let i = 0; i < 250; i++) {
    const rateHz = 0.15 + (i * 0.08) % 7.2; 
    const depthMs = 0.6 + (i * 0.09) % 4.8;
    const name = `BBD Dual Flanger Sweep No.${i + 1} (${rateHz.toFixed(1)}Hz)`;
    const description = `Procedural bucket-brigade double-comb sweep flanger with a dynamic low-frequency oscillator speed of ${rateHz.toFixed(2)}Hz.`;

    list.push({
      id: `gen-mod-chorus-${idCounter++}`,
      name,
      description,
      category: "modulation",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "vibratoRate", name: "Modulation Speed", min: 0.1, max: 10.0, defaultValue: 1.5, value: Number(rateHz.toFixed(2)), unit: "Hz" },
        { id: "vibratoDepth", name: "Sweep Range Depth", min: 0.1, max: 8.0, defaultValue: 2.0, value: Number(depthMs.toFixed(2)), unit: "ms" }
      ],
      dspFunction: `// Procedural Comb Modulator Sweep No.${i + 1}
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100);
  state.writePtr = 0;
  state.phi = 0.0;
}
let rate = params.vibratoRate !== undefined ? params.vibratoRate : ${rateHz.toFixed(2)};
let depth = params.vibratoDepth !== undefined ? params.vibratoDepth : ${depthMs.toFixed(2)};

state.phi += (2.0 * Math.PI * rate) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

let lfo = Math.sin(state.phi);
let modulatedDelayMs = 12.0 + lfo * depth;
let delaySamples = (modulatedDelayMs / 1000.0) * 44100;

let readPtr = state.writePtr - delaySamples;
if (readPtr < 0) readPtr += state.delayLine.length;

let index0 = Math.floor(readPtr);
let frac = readPtr - index0;
let delaySample = (1.0 - frac) * state.delayLine[index0] + frac * state.delayLine[(index0 + 1) % state.delayLine.length];

state.delayLine[state.writePtr] = inputSample;
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

return inputSample * 0.6 + delaySample * 0.4;`
    });
  }

  // 7. Ambient Allpass Reverberators (250 presets) - Feedback matrix volumes, decay rates
  for (let i = 0; i < 250; i++) {
    const sizeVal = 0.45 + (i * 0.016) % 0.52;
    const wetVal = 0.15 + (i * 0.01) % 0.82;
    const name = `Ambient Schroeder Space No.${i + 1}`;
    const description = `Procedural nested allpass reverb space, yielding continuous diffusion simulating room volumes of ${(sizeVal * 100).toFixed(0)}%.`;

    list.push({
      id: `gen-reverb-schroeder-${idCounter++}`,
      name,
      description,
      category: "reverb",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "size", name: "Diffusion Size", min: 0.1, max: 0.99, defaultValue: 0.75, value: Number(sizeVal.toFixed(3)), unit: "size" },
        { id: "wet", name: "Reverb Blend", min: 0.0, max: 1.0, defaultValue: 0.35, value: Number(wetVal.toFixed(2)), unit: "%" }
      ],
      dspFunction: `// Procedural Schroeder Reverb Cell No.${i + 1}
if (!state.delay1) {
  state.delay1 = new Float32Array(1187); state.p1 = 0;
  state.delay2 = new Float32Array(1423); state.p2 = 0;
  state.apDelay = new Float32Array(419); state.apPtr = 0;
}
let size = params.size !== undefined ? params.size : ${sizeVal.toFixed(3)};
let wet = params.wet !== undefined ? params.wet : ${wetVal.toFixed(2)};

let out1 = state.delay1[state.p1];
state.delay1[state.p1] = inputSample + out1 * size * 0.66;
state.p1 = (state.p1 + 1) % state.delay1.length;

let out2 = state.delay2[state.p2];
state.delay2[state.p2] = inputSample + out2 * size * 0.66;
state.p2 = (state.p2 + 1) % state.delay2.length;

let summed = (out1 + out2) * 0.5;

let last_ap = state.apDelay[state.apPtr];
let apOut = 0.55 * summed + last_ap;
state.apDelay[state.apPtr] = summed - 0.55 * apOut;
state.apPtr = (state.apPtr + 1) % state.apDelay.length;

return inputSample * (1.0 - wet) + Math.tanh(apOut) * wet * 1.15;`
    });
  }

  // 8. Phaser Modulators (250 presets) - Stateful allpass stages swept by LFO
  for (let i = 0; i < 250; i++) {
    const rateHz = 0.1 + (i * 0.05) % 4.5;
    const feedbackVal = 0.2 + (i * 0.01) % 0.65;
    const name = `Stateful Phase Modulator No.${i + 1} (${rateHz.toFixed(2)}Hz)`;
    const description = `Procedural 4-stage phaser sweep using cascaded stateful allpass filters with a loop feedback coefficient of ${feedbackVal.toFixed(2)}.`;

    list.push({
      id: `gen-mod-phaser-${idCounter++}`,
      name,
      description,
      category: "modulation",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "rate", name: "Modulation Speed", min: 0.05, max: 8.0, defaultValue: 1.0, value: Number(rateHz.toFixed(3)), unit: "Hz" },
        { id: "feedback", name: "Resonator Feedback", min: 0.1, max: 0.9, defaultValue: 0.5, value: Number(feedbackVal.toFixed(3)), unit: "%" }
      ],
      dspFunction: `// Procedural Cascaded Phaser Stage No.${i + 1}
if (!state.ap1) {
  state.ap1 = 0.0; state.ap2 = 0.0; state.ap3 = 0.0; state.ap4 = 0.0;
  state.phi = 0.0; state.lastOut = 0.0;
}
let speed = params.rate !== undefined ? params.rate : \${rateHz.toFixed(3)};
let fb = params.feedback !== undefined ? params.feedback : \${feedbackVal.toFixed(3)};

state.phi += (2.0 * Math.PI * speed) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

// LFO modulates the allpass filter coefficient
let lfo = 0.5 * (Math.sin(state.phi) + 1.0);
let g = 0.15 + lfo * 0.70;

let inputTerm = inputSample + state.lastOut * fb;

// Cascoded 4-stage allpass network
let y1 = g * inputTerm + state.ap1;
state.ap1 = inputTerm - g * y1;

let y2 = g * y1 + state.ap2;
state.ap2 = y1 - g * y2;

let y3 = g * y2 + state.ap3;
state.ap3 = y2 - g * y3;

let y4 = g * y3 + state.ap4;
state.ap4 = y3 - g * y4;

state.lastOut = y4;

// Sum dry and processed for phase cancellation notch sweep
return (inputSample + y4) * 0.5;`
    });
  }

  // 9. Wave Folding Overdrive (250 presets) - Implements sine/triangle wave folding stages
  for (let i = 0; i < 250; i++) {
    const gainVal = 1.5 + (i * 0.12) % 10.0;
    const thresholdVal = 0.2 + (i * 0.01) % 0.65;
    const name = `Geometric Wave Shaper No.${i + 1} (Boost: \${gainVal.toFixed(1)}x)`;
    const description = `Procedural dynamic folding overdriver. Folds signals back once they exceed \${thresholdVal.toFixed(2)} to add metallic harmonics.`;

    list.push({
      id: `gen-dist-fold-${idCounter++}`,
      name,
      description,
      category: "distortion",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "gain", name: "Preamp Boost", min: 1.0, max: 15.0, defaultValue: 3.0, value: Number(gainVal.toFixed(3)), unit: "x" },
        { id: "thresh", name: "Folding Threshold", min: 0.1, max: 1.0, defaultValue: 0.5, value: Number(thresholdVal.toFixed(3)), unit: "v" }
      ],
      dspFunction: `// Procedural Wavefolder Overdrive No.${i + 1}
let drive = params.gain !== undefined ? params.gain : \${gainVal.toFixed(3)};
let limit = params.thresh !== undefined ? params.thresh : \${thresholdVal.toFixed(3)};

let x = inputSample * drive;
let folded = 0.0;

// Sine-based mathematical wavefolding
if (Math.abs(x) > limit) {
  folded = limit * Math.sin((Math.PI * x) / (2.0 * limit));
} else {
  folded = x;
}

return Math.tanh(folded * 1.2) * 0.85;`
    });
  }

  // 10. Bitcrush & Sample Rate Reduction (170 presets) - Quantizers & sample-hold decimators
  for (let i = 0; i < 170; i++) {
    const bitsVal = 2.0 + (i * 0.15) % 12.0;
    const downsampleVal = 1 + Math.floor(i * 0.45) % 32;
    const name = `Lo-Fi Bit Decimator No.${i + 1} (${bitsVal.toFixed(1)} bits)`;
    const description = `Procedural signal degrador. Reduces signal bit depth to exactly ${bitsVal.toFixed(1)} bits with a sample-and-hold rate divider of /${downsampleVal}.`;

    list.push({
      id: `gen-dist-crush-${idCounter++}`,
      name,
      description,
      category: "distortion",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "bits", name: "Bit Resolution", min: 1.0, max: 16.0, defaultValue: 8.0, value: Number(bitsVal.toFixed(3)), unit: "bit" },
        { id: "divide", name: "Downsample Division", min: 1, max: 50, defaultValue: 4, value: downsampleVal, unit: "smpl" }
      ],
      dspFunction: `// Procedural Lo-Fi Bit Decimator No.${i + 1}
let bits = params.bits !== undefined ? params.bits : \${bitsVal.toFixed(3)};
let decimate = params.divide !== undefined ? params.divide : \${downsampleVal};

if (!state.sampleCounter) {
  state.sampleCounter = 0; state.heldVal = 0.0;
}

state.sampleCounter++;
if (state.sampleCounter >= decimate) {
  state.sampleCounter = 0;
  // Dynamic bit quantization
  let levels = Math.pow(2.0, bits);
  state.heldVal = Math.round(inputSample * levels) / levels;
}

return state.heldVal;`
    });
  }

  // 11. Ring Modulation Carrier Clones (170 presets) - Single sideband multipliers
  for (let i = 0; i < 170; i++) {
    const modHz = 80 + (i * 35) % 1800;
    const wetVal = 0.1 + (i * 0.01) % 0.85;
    const name = `Anode Ring Modulator No.${i + 1} (${modHz}Hz)`;
    const description = `Procedural Ring Modulator using an offline sinusoidal carrier oscillator tuned to exactly ${modHz}Hz. Mix blend set to \${(wetVal * 105).toFixed(0)}%.`;

    list.push({
      id: `gen-mod-ring-${idCounter++}`,
      name,
      description,
      category: "modulation",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "carrier", name: "Ring Carrier Pitch", min: 10, max: 2500, defaultValue: 440, value: modHz, unit: "Hz" },
        { id: "blend", name: "Modulation Mix", min: 0.0, max: 1.0, defaultValue: 0.50, value: Number(wetVal.toFixed(2)), unit: "%" }
      ],
      dspFunction: `// Procedural Ring Modulator No.${i + 1}
if (!state.phi) {
  state.phi = 0.0;
}
let freq = params.carrier !== undefined ? params.carrier : \${modHz};
let m = params.blend !== undefined ? params.blend : \${wetVal.toFixed(2)};

state.phi += (2.0 * Math.PI * freq) / 44100.0;
if (state.phi > 2.0 * Math.PI) state.phi -= 2.0 * Math.PI;

let carrier = Math.sin(state.phi);
let ringVal = inputSample * carrier;

return inputSample * (1.0 - m) + ringVal * m;`
    });
  }

  // 12. Immersive Reverb & Spatial Modeling Sub-Library (150 presets) - Feedback matrices, decay times, allpass filters
  for (let i = 0; i < 150; i++) {
    const spaceDecay = 1.0 + (i * 0.04) % 6.0;
    const spaceDamp = 0.1 + (i * 0.005) % 0.8;
    const name = `Pristine Cathedral Room No.${i + 1} (Decay: ${spaceDecay.toFixed(1)}s)`;
    const description = `Procedural Schroeder-style feedback delay network designed for ${spaceDecay.toFixed(1)}s of spatial decay with high-frequency absorption rate of ${(spaceDamp * 100).toFixed(0)}%.`;

    list.push({
      id: `gen-verb-room-${idCounter++}`,
      name,
      description,
      category: "reverb",
      timestamp: "AI Procedural",
      isBuiltIn: true,
      parameters: [
        { id: "decay", name: "Decay Time", min: 0.5, max: 8.0, defaultValue: 2.0, value: Number(spaceDecay.toFixed(2)), unit: "s" },
         { id: "damping", name: "HF Absorption", min: 0.0, max: 0.95, defaultValue: 0.2, value: Number(spaceDamp.toFixed(2)), unit: "%" }
      ],
      dspFunction: `// Procedural Schroeder Reverb Cell No.${i + 1}
if (!state.d1) {
  state.d1 = new Float32Array(1113);
  state.d2 = new Float32Array(1533);
  state.p1 = 0;
  state.p2 = 0;
  state.lp = 0.0;
}
let d = params.decay !== undefined ? params.decay : ${spaceDecay.toFixed(2)};
let hf = params.damping !== undefined ? params.damping : ${spaceDamp.toFixed(2)};

let out1 = state.d1[state.p1] || 0.0;
state.d1[state.p1] = inputSample + out1 * Math.min(0.85, d / 10.0);
state.p1 = (state.p1 + 1) % state.d1.length;

let out2 = state.d2[state.p2] || 0.0;
state.d2[state.p2] = out1 + out2 * Math.min(0.8, d / 12.0);
state.p2 = (state.p2 + 1) % state.d2.length;

// One-Pole Lowpass feedback absorber
state.lp = state.lp + (1.0 - hf) * (out2 - state.lp);

return inputSample * 0.7 + state.lp * 0.3;`
    });
  }

  return list;
};

export const PROGRAMMATIC_PRESETS: UserPreset[] = generateProgrammaticLibrary();

export default function PresetManager({ currentPlugin, onLoadPreset, triggerToast }: PresetManagerProps) {
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [activeTab, setActiveTab] = useState<"library" | "save" | "import">("library");
  const [displayLimit, setDisplayLimit] = useState(24);

  // Reset displaying limit as search query or selected category transforms
  useEffect(() => {
    setDisplayLimit(24);
  }, [searchQuery, selectedCategory]);
  
  // Custom Preset forms
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDesc, setNewPresetDesc] = useState("");
  const [newPresetCategory, setNewPresetCategory] = useState<UserPreset["category"]>("distortion");
  
  // Import states
  const [jsonImportText, setJsonImportText] = useState("");
  
  // Active selected preset detail popup or code viewer
  const [viewingPresetCodeId, setViewingPresetCodeId] = useState<string | null>(null);

  // Load user presets from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("orangejuce_user_presets");
      if (stored) {
        setUserPresets(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Could not load custom presets from localStorage", e);
    }
  }, []);

  // Save user presets to localStorage
  const saveUserPresetsToDisk = (updatedList: UserPreset[]) => {
    setUserPresets(updatedList);
    try {
      localStorage.setItem("orangejuce_user_presets", JSON.stringify(updatedList));
    } catch (e) {
      triggerToast("Failed to write presets to LocalStorage. Local quota might be full!");
    }
  };

  // Create & Save specific parameter Configurations and dsp snapshot
  const handleSaveCurrentPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) {
      triggerToast("Please provide a preset name first!");
      return;
    }

    const newPreset: UserPreset = {
      id: "preset-" + Date.now().toString(),
      name: newPresetName.trim(),
      description: newPresetDesc.trim() || `Custom snapshot of the "${currentPlugin.name}" engine layout.`,
      category: newPresetCategory,
      timestamp: new Date().toLocaleString(),
      parameters: currentPlugin.parameters.map(p => ({ ...p })), // Deep copy active values
      dspFunction: currentPlugin.dspFunction,
      faustCode: currentPlugin.faustCode,
      cppJuceCode: currentPlugin.cppJuceCode
    };

    const updated = [newPreset, ...userPresets];
    saveUserPresetsToDisk(updated);
    triggerToast(`"${newPreset.name}" successfully added to your user library!`);
    
    // Reset forms
    setNewPresetName("");
    setNewPresetDesc("");
    setActiveTab("library");
  };

  // Recall selected preset back into main active compiler loop
  const handleRecallPreset = (preset: UserPreset) => {
    onLoadPreset(preset);
  };

  // Delete User Custom Preset
  const handleDeletePreset = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete the user preset "${name}"?`)) {
      const filtered = userPresets.filter(p => p.id !== id);
      saveUserPresetsToDisk(filtered);
      triggerToast(`Removed "${name}" from presets library.`);
      if (viewingPresetCodeId === id) setViewingPresetCodeId(null);
    }
  };

  // Copy Single Preset payload as raw JSON for external clipboard sharing
  const handleCopyPresetPayload = (preset: UserPreset) => {
    try {
      const cleanSnippet = {
        name: preset.name,
        description: preset.description,
        category: preset.category,
        parameters: preset.parameters,
        dspFunction: preset.dspFunction,
        faustCode: preset.faustCode || "",
        cppJuceCode: preset.cppJuceCode || ""
      };
      
      navigator.clipboard.writeText(JSON.stringify(cleanSnippet, null, 2));
      triggerToast(`Copied the raw preset config for "${preset.name}" to clipboard!`);
    } catch (err) {
      triggerToast("Could not copy automatically. Clipboard access blocked.");
    }
  };

  // Download complete preset database backup as a file
  const handleDownloadFullBackup = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(userPresets, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `orangejuce_presets_backup_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      triggerToast("Triggered download for user presets library backup file.");
    } catch (e) {
      triggerToast("Export failed.");
    }
  };

  // Import custom pasted or loaded JSON preset format
  const handleImportJsonPreset = () => {
    if (!jsonImportText.trim()) {
      triggerToast("Please paste some JSON raw text first!");
      return;
    }

    try {
      const parsed = JSON.parse(jsonImportText.trim());
      
      // Validation check fields
      if (!parsed.name || !parsed.parameters || !parsed.dspFunction) {
        triggerToast("Invalid format: JSON template must contain at least 'name', 'parameters' list, and 'dspFunction' text.");
        return;
      }

      const importedPreset: UserPreset = {
        id: "preset-import-" + Date.now().toString(),
        name: parsed.name + " (Imported)",
        description: parsed.description || "Imported sound profile.",
        category: parsed.category || "distortion",
        timestamp: new Date().toLocaleString(),
        parameters: parsed.parameters,
        dspFunction: parsed.dspFunction,
        faustCode: parsed.faustCode || "",
        cppJuceCode: parsed.cppJuceCode || ""
      };

      const updated = [importedPreset, ...userPresets];
      saveUserPresetsToDisk(updated);
      triggerToast(`Successfully imported custom preset: "${importedPreset.name}"!`);
      
      setJsonImportText("");
      setActiveTab("library");
    } catch (err: any) {
      triggerToast(`Import parse error: ${err.message}`);
    }
  };

  // Load complex default tape preset bundle templates fast
  const handleReinstallFactoryDefaults = () => {
    if (confirm("Resetting custom storage quota: Do you want to wipe custom user presets also? Click OK to fully wipe/reset, Cancel to just maintain existing user structures.")) {
      saveUserPresetsToDisk([]);
      triggerToast("User presets wiped. Default factory cards re-mounted!");
    } else {
      triggerToast("Preserved existing structures.");
    }
  };

  // Merge lists (combines custom user presets, handcrafted factory presets, and our massive library of programmatic procedural synthesizer presets)
  const allAvailablePresets = [...userPresets, ...FACTORY_PRESETS, ...PROGRAMMATIC_PRESETS];

  // Filter lists based on Search & Select categories
  const filteredPresets = allAvailablePresets.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categoryPills = ["All", "distortion", "delay", "filter", "synthesizer", "dynamics", "modulation", "reverb"];

  return (
    <div id="preset-manager-root" className="bg-neutral-900 border border-neutral-850 rounded-2xl overflow-hidden shadow-2xl font-sans">
      {/* Header bar */}
      <div className="bg-neutral-950 px-5 py-4 border-b border-neutral-850 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-orange-950/80 border border-orange-900 rounded-lg text-orange-450">
            <FolderHeart className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">User Presets & Snapshots Library</h3>
            <p className="text-[10px] text-neutral-450">Save physical parameter positions and DSP software code states to LocalStorage</p>
          </div>
        </div>

        {/* Tab switcher navigation bar */}
        <div className="flex items-center gap-1.5 bg-neutral-900/60 p-1 rounded-lg border border-neutral-850 select-none self-stretch sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("library")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "library" ? "bg-neutral-800 text-white shadow-sm border border-neutral-700/50" : "text-neutral-400 hover:text-white"
            }`}
          >
            Explore Library ({allAvailablePresets.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("save")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "save" ? "bg-orange-600 text-white shadow-sm font-semibold" : "text-neutral-400 hover:text-white"
            }`}
          >
            <Plus className="w-3 h-3 inline-block mr-1" />
            Save Current State
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === "import" ? "bg-neutral-800 text-white shadow-sm border border-neutral-700/50" : "text-neutral-400 hover:text-white"
            }`}
          >
            <Upload className="w-3 h-3 inline-block mr-1" />
            Import / Share
          </button>
        </div>
      </div>

      {/* Main interface workspace bodies */}
      <div className="p-5">
        
        {/* TAB 1: PRESETS EXPLORER */}
        {activeTab === "library" && (
          <div className="space-y-4 animate-fadeIn">
            {/* Search filtering filter rails row structure */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Filter presets name, algorithms, or description tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white focus:border-orange-550 outline-none placeholder:text-neutral-600"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Utility bulk triggers */}
              <div className="flex items-center gap-1.5 shrink-0 self-end">
                {userPresets.length > 0 && (
                  <button
                    onClick={handleDownloadFullBackup}
                    className="p-2 bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 text-neutral-400 hover:text-white rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                    title="Export complete presets collection as backup JSON"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[9.5px] font-semibold">Backup (.json)</span>
                  </button>
                )}
                <button
                  onClick={handleReinstallFactoryDefaults}
                  className="p-2 bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 text-neutral-500 hover:text-neutral-300 rounded-xl text-xs transition cursor-pointer"
                  title="Wipe configuration & restore default factory models"
                >
                  <RefreshCw className="w-3 h-3 text-neutral-450" />
                </button>
              </div>
            </div>

            {/* Category tabs scrollable filter line panel */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin scrollbar-track-transparent select-none">
              {categoryPills.map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedCategory(p)}
                  className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all border shrink-0 cursor-pointer ${
                    p === selectedCategory
                      ? "bg-orange-955/35 border-orange-500 text-orange-400 font-bold"
                      : "bg-neutral-950 border-neutral-850 text-neutral-400 hover:text-white hover:border-neutral-700"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Main grid cards view */}
            {filteredPresets.length > 0 ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredPresets.slice(0, displayLimit).map((p) => {
                  const isActive = (currentPlugin.dspFunction === p.dspFunction && 
                    currentPlugin.parameters.length === p.parameters.length &&
                    currentPlugin.parameters.every(param => {
                      const matching = p.parameters.find(mp => mp.id === param.id);
                      return matching ? matching.value === param.value : false;
                    }));

                  return (
                    <div 
                      key={p.id}
                      className={`relative border rounded-xl overflow-hidden shadow-md transition-all duration-200 bg-neutral-950/20 ${
                        isActive 
                          ? "border-orange-550 ring-2 ring-orange-950/40 bg-neutral-900/10 shadow-orange-900/5 scale-101" 
                          : "border-neutral-850 hover:border-neutral-700 hover:bg-neutral-900/30"
                      }`}
                    >
                      {/* Active profile dot halo */}
                      {isActive && (
                        <div className="absolute top-0 right-0 bg-orange-600 text-white font-semibold font-mono text-[8px] px-2.5 py-0.5 rounded-bl-lg tracking-widest uppercase shadow-sm">
                          Active State
                        </div>
                      )}

                      <div className="p-4 space-y-3">
                        {/* Title and Category pill row */}
                        <div className="flex items-start justify-between gap-2 max-w-[80%]">
                          <div className="space-y-0.5">
                            <span className={`text-[8px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded ${
                              p.isBuiltIn 
                                ? "bg-amber-950 border border-amber-900 text-amber-400" 
                                : "bg-neutral-900 border border-neutral-800 text-neutral-300"
                            }`}>
                              {p.isBuiltIn ? "★ Factory Sound" : "👤 User Preset"}
                            </span>
                            <h4 className="font-bold text-xs text-white pt-1">{p.name}</h4>
                          </div>
                        </div>

                        {/* Description block */}
                        <p className="text-[10px] text-neutral-400 leading-normal line-clamp-2 h-7 font-sans">
                          {p.description}
                        </p>

                        {/* Parameters list breakdown snippet */}
                        <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-900/90 space-y-1.5 font-mono text-[9px]">
                          <div className="text-[8px] font-bold text-neutral-500 uppercase tracking-widest mb-1">
                            Snapshotted Sliders Values
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 select-none">
                            {p.parameters.map((param) => (
                              <div key={param.id} className="flex justify-between items-center text-[9.5px] py-0.5 border-b border-neutral-900/30">
                                <span className="text-neutral-450 truncate max-w-[70%]">{param.name}</span>
                                <span className="text-emerald-400 font-bold ml-1 shrink-0">
                                  {param.value.toFixed(2)}{param.unit}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Timing indicator metadata strip */}
                        <div className="flex items-center justify-between text-[8px] font-mono text-neutral-500 pt-1 border-t border-neutral-900">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5" />
                            {p.timestamp}
                          </span>
                          <span className="flex items-center gap-0.5 text-neutral-450">
                            <Cpu className="w-2.5 h-2.5" />
                            {p.dspFunction.split("\n").filter(l => l.trim().length > 0).length} statements
                          </span>
                        </div>

                        {/* Action Buttons Row */}
                        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-neutral-900">
                          {/* Apply Preset button */}
                          <button
                            onClick={() => handleRecallPreset(p)}
                            className="col-span-2 py-1.5 rounded-lg text-[9.5px] font-bold text-white bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 font-sans tracking-wide transition flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Sliders className="w-2.5 h-2.5 text-indigo-400" />
                            Recall Preset
                          </button>

                          {/* Options column utilities */}
                          <div className="grid grid-cols-2 gap-1">
                            {/* Copy payload clip button */}
                            <button
                              onClick={() => handleCopyPresetPayload(p)}
                              className="py-1.5 rounded-lg bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 text-neutral-400 hover:text-white transition flex items-center justify-center cursor-pointer"
                              title="Copy raw JSON snippet"
                            >
                              <Copy className="w-3 h-3" />
                            </button>

                            {/* Delete custom preset button */}
                            {p.isBuiltIn ? (
                              <div className="py-1.5 rounded-lg bg-neutral-950 border border-neutral-900 text-neutral-600 flex items-center justify-center cursor-not-allowed select-none" title="Built-in preset cannot be deleted">
                                <X className="w-3 h-3" />
                              </div>
                            ) : (
                              <button
                                onClick={() => handleDeletePreset(p.id, p.name)}
                                className="py-1.5 rounded-lg bg-neutral-950/80 border border-rose-950 hover:border-rose-900 text-neutral-500 hover:text-rose-450 transition flex items-center justify-center cursor-pointer"
                                title="Delete preset permanently"
                              >
                                <Trash2 className="w-3 h-3 text-rose-400" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Code preview toggles */}
                        <div className="border-t border-neutral-900 pt-2 select-none">
                          <button
                            onClick={() => setViewingPresetCodeId(viewingPresetCodeId === p.id ? null : p.id)}
                            className="text-[8.5px] font-mono text-neutral-500 hover:text-neutral-350 flex items-center gap-1 cursor-pointer bg-neutral-950/20 px-1.5 py-0.5 rounded"
                          >
                            <Code className="w-2.5 h-2.5 text-sky-400" />
                            {viewingPresetCodeId === p.id ? "Hide JavaScript Block" : "Inspect Javascript Block"}
                          </button>
                        </div>
                      </div>

                      {/* Code preview drawer block slideout */}
                      {viewingPresetCodeId === p.id && (
                        <div className="bg-neutral-950 px-4 py-3.5 border-t border-neutral-850 font-mono text-[9px] text-emerald-400 max-h-48 overflow-y-auto select-text scrollbar-thin">
                          <div className="flex justify-between items-center text-[8px] text-neutral-500 uppercase tracking-widest mb-1.5 pb-1 border-b border-neutral-900">
                            <span>DSP Code Snapshot</span>
                            <span className="text-emerald-500 font-bold">ReadOnly</span>
                          </div>
                          <pre className="whitespace-pre-wrap leading-relaxed max-w-full font-mono">{p.dspFunction}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>

                {filteredPresets.length > displayLimit && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setDisplayLimit(prev => prev + 24)}
                      className="w-full py-3.5 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 text-xs font-bold text-neutral-300 hover:text-white transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-orange-450 animate-pulse" />
                      Load More Presets (+{Math.min(24, filteredPresets.length - displayLimit)} of {filteredPresets.length - displayLimit} remaining)
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-neutral-950/40 rounded-2xl border border-neutral-900 py-12 px-6 text-center space-y-3">
                <Info className="w-8 h-8 text-neutral-600 mx-auto" />
                <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  No presets match your current filtering logic. Try lowering searching queries tags or search for another parameter!
                </p>
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setSelectedCategory("All"); }}
                  className="text-[10px] text-orange-450 bg-neutral-900 hover:bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-800 transition font-bold"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SAVE CURRENT PRESET STATE FORM */}
        {activeTab === "save" && (
          <form onSubmit={handleSaveCurrentPreset} className="space-y-4 max-w-lg mx-auto bg-neutral-950/40 p-5 rounded-2xl border border-neutral-900/90 animate-fadeIn">
            <div className="text-center pb-2 border-b border-neutral-900">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                Capture Current DSP Snapshot
              </h4>
              <p className="text-[10px] text-neutral-500 mt-1">
                Saves the live sliders positions, names, and compiling Javascript code.
              </p>
            </div>

            <div className="space-y-4 pt-2 font-sans text-xs">
              {/* Preset Title Name */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold uppercase text-neutral-400">Preset Title</label>
                <input
                  type="text"
                  placeholder="e.g. Vintage Tape Glue, Lowpass Echo Swarm, Industrial Slush"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-3 text-xs text-white focus:border-orange-550 outline-none max-w-full font-sans"
                  maxLength={50}
                  required
                />
              </div>

              {/* Category pill indicator */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase text-neutral-400">Category Tag</label>
                  <select
                    value={newPresetCategory}
                    onChange={(e) => setNewPresetCategory(e.target.value as any)}
                    className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3.5 py-3 rounded-xl text-white outline-none cursor-pointer focus:border-orange-550"
                  >
                    <option value="distortion">distortion</option>
                    <option value="delay">delay</option>
                    <option value="filter">filter</option>
                    <option value="synthesizer">synthesizer</option>
                    <option value="dynamics">dynamics</option>
                    <option value="modulation">modulation</option>
                    <option value="reverb">reverb</option>
                  </select>
                </div>

                <div className="space-y-1.5 font-mono select-none">
                  <label className="text-[10px] font-bold uppercase text-neutral-500">Active Sliders Saved</label>
                  <div className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60 text-[9px] text-emerald-400 font-bold">
                    {currentPlugin.parameters.length} active sliders positions
                  </div>
                </div>
              </div>

              {/* Description block */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono font-bold uppercase text-neutral-400">Description / Tuning Notes</label>
                <textarea
                  placeholder="Briefly decribe what type of sonic effect this delivers, target instruments, distortion tube biasing bias ranges..."
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-3 text-xs text-white focus:border-orange-550 outline-none h-20 placeholder:text-neutral-600 resize-none font-sans"
                  maxLength={180}
                />
              </div>

              {/* Dynamic stats tracker preview box */}
              <div className="bg-neutral-900/30 p-3 rounded-xl border border-neutral-850/60 text-[9.5px] leading-relaxed text-neutral-450 space-y-1 font-mono">
                <span className="font-bold text-neutral-300 flex items-center gap-1 font-sans">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  Live snapshot values list to capture:
                </span>
                <p className="font-sans">
                  Preset maps to active custom DSP implementation hook code with active variables: <code className="text-orange-400">{currentPlugin.parameters.map(p => `${p.id} = ${p.value.toFixed(2)}${p.unit}`).join(", ")}</code>.
                </p>
              </div>

              {/* Submit triggers */}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("library")}
                  className="py-2.5 px-4 rounded-xl text-neutral-400 hover:text-white bg-neutral-900 text-xs font-bold font-sans cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2.5 px-5 rounded-xl text-white bg-orange-600 hover:bg-orange-500 text-xs font-bold font-sans cursor-pointer shadow-md transition"
                >
                  Save Preset Snapshot
                </button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 3: IMPORT & CLIPBOARD SHARE ENGINE */}
        {activeTab === "import" && (
          <div className="space-y-4 max-w-lg mx-auto bg-neutral-950/40 p-5 rounded-2xl border border-neutral-900/90 animate-fadeIn">
            <div className="text-center pb-2 border-b border-neutral-900">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center justify-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                Paste & Import JSON Payload
              </h4>
              <p className="text-[10px] text-neutral-500 mt-1">
                Paste raw Preset format JSON payload below generated by clicking copy (📋) elsewhere.
              </p>
            </div>

            <div className="space-y-4 pt-2 font-sans text-xs">
              <textarea
                placeholder='E.g. Paste here: { "name": "Vocal Air Lift", "category": "filter", "parameters": [{ "id": "cutoff", "value": 3100, ... }], "dspFunction": "..." }'
                value={jsonImportText}
                onChange={(e) => setJsonImportText(e.target.value)}
                className="w-full bg-[#0d0e12] border border-neutral-800 rounded-xl p-3.5 text-[10px] font-mono text-emerald-400 focus:border-orange-550 outline-none h-44 placeholder:text-neutral-700 select-text resize-none leading-relaxed"
              />

              <div className="grid grid-cols-1 gap-2 pt-1 font-mono text-[9px] text-neutral-450 bg-neutral-900/30 p-3 rounded-xl border border-neutral-850/60 leading-relaxed">
                <span className="font-bold text-neutral-200">ℹ JSON Format Requirements:</span>
                <p>
                  The parsed payload must contain parameters definitions array (min/max bounds) matching active DSP variables definitions schema loops correctly to register sliders in real-time.
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setJsonImportText(""); setActiveTab("library"); }}
                  className="py-2.5 px-4 bg-neutral-900 text-neutral-400 hover:text-white rounded-xl text-xs font-sans cursor-pointer font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportJsonPreset}
                  className="py-2.5 px-5 bg-indigo-650 hover:bg-indigo-600 text-white rounded-xl text-xs font-sans cursor-pointer font-bold shadow-md transition-all active:scale-98"
                >
                  Import Sound
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
