/**
 * Topology bank: the engineering CHOICES within a plugin family.
 *
 * The golden recipe bank answers "what is a compressor"; this bank answers
 * "which compressor" -- feed-forward RMS for glue, peak-detector for drums,
 * feedback with color for vocals, lookahead soft-knee for mastering. Each
 * family's DEFAULT topology is its golden recipe, so a prompt with no
 * requirements builds exactly what it always built; the alternates only win
 * when the requirements (src/utils/requirements.ts) point at them, and they
 * additionally compete as best-of-N seeds under the same strictly-higher
 * refinement rule as everything else.
 *
 * Contract for every body (same as dspRecipes):
 *   - the string is the BODY of function(inputSample, params, state)
 *   - exactly ONE return statement (chainStage/composers block-wrap bodies)
 *   - guard every log/division, clamp every feedback below 1
 *   - nonlinearities use the 2x midpoint-average oversampling idiom
 *   - every parameter audibly works min->max and honors its name's semantics
 *     (the gate measures both; a topology that fails does not ship)
 */

import { DSP_RECIPES, DspRecipe } from "./dspRecipes";
import { PluginFamily } from "./pluginSpec";
import { CharacterGoal, SourceMaterial } from "./requirements";

export interface TopologyTags {
  /** Structural name, e.g. "feed-forward-rms", "fdn-plate". */
  topology: string;
  /** Character goals this design serves ("any" never appears here). */
  character: CharacterGoal[];
  /** Source material this design suits. */
  sources: SourceMaterial[];
  /** "lookahead" designs are excluded when the latency budget is live. */
  latency: "zero" | "lookahead";
  cpu: "light" | "medium";
}

export interface DspTopology {
  id: string;
  family: PluginFamily;
  title: string;
  /** The one-sentence engineering rationale, shown to the user. */
  rationale: string;
  parameters: DspRecipe["parameters"];
  body: string;
  tags: TopologyTags;
  /** The family's golden-recipe default; wins whenever requirements are neutral. */
  isDefault?: boolean;
}

const golden = (id: string): DspRecipe => {
  const r = DSP_RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`Golden recipe "${id}" missing from DSP_RECIPES`);
  return r;
};

export const DSP_TOPOLOGIES: DspTopology[] = [
  /* ================================================================ */
  /* DYNAMICS: ten compressor designs                                  */
  /* ================================================================ */
  {
    id: "comp_ff_rms",
    family: "dynamics",
    title: golden("dynamics").title,
    rationale: "the proven general-purpose design — feed-forward dB-domain envelope, musical on anything",
    parameters: golden("dynamics").parameters,
    body: golden("dynamics").body,
    tags: { topology: "feed-forward-rms", character: ["transparent"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "comp_peak_punch",
    family: "dynamics",
    title: "Peak-detector punch compressor (fast instant-peak envelope, user attack, quick release)",
    rationale: "drums want a peak detector and a real Attack knob — slow the attack to let transients crack through, then clamp the body",
    parameters: [
      { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -20, unit: "dB" },
      { id: "ratio", name: "Ratio", min: 1, max: 20, defaultValue: 6, unit: ":1" },
      { id: "attack", name: "Attack", min: 0.05, max: 30, defaultValue: 1, unit: "ms" },
      { id: "release", name: "Release", min: 10, max: 400, defaultValue: 60, unit: "ms" },
      { id: "knee", name: "Knee", min: 0, max: 18, defaultValue: 3, unit: "dB" },
      { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 4, unit: "dB" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.env = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -20;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 6);
let attack = Math.max(0.05, params.attack !== undefined ? params.attack : 1);
let release = params.release !== undefined ? params.release : 60;
let knee = params.knee !== undefined ? params.knee : 3;
let makeup = params.makeup !== undefined ? params.makeup : 4;
let mix = params.mix !== undefined ? params.mix : 1;
let x = Math.abs(inputSample);
// Peak detector with a genuinely fast attack range: on drums, slowing the
// attack lets the stick crack through before the body is clamped. Release
// is short here by range -- this design is meant to recover between hits.
let aC = 1 - Math.exp(-1 / (attack * 44.1));
let rC = 1 - Math.exp(-1 / (Math.max(1, release) * 0.001 * 44100));
state.env += (x > state.env ? aC : rC) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let halfKnee = knee / 2;
let gainDb = 0;
if (overDb >= halfKnee) {
  gainDb = -overDb * (1 - 1 / ratio);
} else if (overDb > -halfKnee) {
  let kt = overDb + halfKnee;
  gainDb = -(1 - 1 / ratio) * kt * kt / (2 * Math.max(0.01, knee));
}
let g = Math.pow(10, (gainDb + makeup) / 20);
let comp = Math.tanh(inputSample * g);
return comp * mix + inputSample * (1 - mix);`,
    tags: { topology: "feed-forward-peak", character: ["aggressive"], sources: ["drums"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_feedback_glue",
    family: "dynamics",
    title: "Feedback-topology glue compressor (detector listens to the OUTPUT, gentle warmth stage)",
    rationale: "the vintage trick — detecting the already-compressed output self-smooths the gain curve, and a touch of tanh warmth flatters vocals and busses",
    parameters: [
      { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -26, unit: "dB" },
      { id: "ratio", name: "Ratio", min: 1, max: 12, defaultValue: 3, unit: ":1" },
      { id: "attack", name: "Attack", min: 1, max: 120, defaultValue: 25, unit: "ms" },
      { id: "release", name: "Release", min: 50, max: 1200, defaultValue: 300, unit: "ms" },
      { id: "warmth", name: "Warmth", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
      { id: "makeup", name: "Makeup", min: 0, max: 24, defaultValue: 4, unit: "dB" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.env = 0; state.prevOut = 0; state.prevIn = 0; state.prevShaped = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -26;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 3);
let attack = params.attack !== undefined ? params.attack : 25;
let release = params.release !== undefined ? params.release : 300;
let warmth = params.warmth !== undefined ? params.warmth : 0.35;
let makeup = params.makeup !== undefined ? params.makeup : 4;
let mix = params.mix !== undefined ? params.mix : 1;
// Feedback detection: the envelope follows the ALREADY-COMPRESSED output,
// which self-smooths the gain curve -- the vintage glue character. Attack
// and release stay slower here than a peak design by range, so the knobs
// shape that character rather than turning this into a punch compressor.
let x = Math.abs(state.prevOut);
let aCoeff = 1 - Math.exp(-1 / (Math.max(1, attack) * 0.001 * 44100));
let rCoeff = 1 - Math.exp(-1 / (Math.max(1, release) * 0.001 * 44100));
state.env += (x > state.env ? aCoeff : rCoeff) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let gainDb = overDb > 0 ? -overDb * (1 - 1 / ratio) : 0;
let g = Math.pow(10, (gainDb + makeup) / 20);
let hot = 1 + warmth * 4;
let norm = 1 + warmth * 2.2;
// The Warmth tanh is a real saturator, not a safety clamp, so it gets the
// same 2x oversampling as the distortion recipe: midpoint + current shaped,
// combined with a triangular [0.25, 0.5, 0.25] halfband decimator against
// the PREVIOUS cycle's shaped current.
let lin = inputSample * g;
let mid = 0.5 * (state.prevIn + inputSample) * g;
let shapedMid = Math.tanh(mid * hot);
let shapedCur = Math.tanh(lin * hot);
let out = (0.25 * state.prevShaped + 0.5 * shapedMid + 0.25 * shapedCur) / norm;
state.prevShaped = shapedCur;
state.prevIn = inputSample;
state.prevOut = out;
return out * mix + inputSample * (1 - mix);`,
    tags: { topology: "feedback-colored", character: ["colored"], sources: ["vocals", "mix_bus", "guitar", "bass"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_lookahead_master",
    family: "dynamics",
    title: "Lookahead soft-knee mastering compressor (1.5 ms lookahead, 6 dB knee, gentle ratios)",
    rationale: "mastering can spend latency — the detector reads the input 64 samples before the audio path plays it, so transients are caught without a hard knee's distortion",
    parameters: [
      { id: "threshold", name: "Threshold", min: -48, max: 0, defaultValue: -18, unit: "dB" },
      { id: "ratio", name: "Ratio", min: 1, max: 8, defaultValue: 2.5, unit: ":1" },
      { id: "attack", name: "Attack", min: 1, max: 60, defaultValue: 8, unit: "ms" },
      { id: "release", name: "Release", min: 50, max: 1000, defaultValue: 250, unit: "ms" },
      { id: "knee", name: "Knee", min: 0, max: 24, defaultValue: 6, unit: "dB" },
      { id: "makeup", name: "Makeup", min: 0, max: 12, defaultValue: 2, unit: "dB" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.buf = new Float32Array(64); state.p = 0; state.env = 0; state.init = true; }
let thresh = params.threshold !== undefined ? params.threshold : -18;
let ratio = Math.max(1, params.ratio !== undefined ? params.ratio : 2.5);
let attack = params.attack !== undefined ? params.attack : 8;
let release = params.release !== undefined ? params.release : 250;
let knee = Math.max(0.01, params.knee !== undefined ? params.knee : 6);
let makeup = params.makeup !== undefined ? params.makeup : 2;
let mix = params.mix !== undefined ? params.mix : 1;
let x = Math.abs(inputSample);
// Gentle mastering time constants, now exposed rather than fixed: the
// detector still reads 64 samples AHEAD of the audio path (below), so
// transients are caught without needing a hard knee's distortion.
let aC = 1 - Math.exp(-1 / (Math.max(1, attack) * 0.001 * 44100));
let rC = 1 - Math.exp(-1 / (Math.max(1, release) * 0.001 * 44100));
state.env += (x > state.env ? aC : rC) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let red = 0;
if (overDb >= knee / 2) red = overDb * (1 - 1 / ratio);
else if (overDb > -knee / 2) red = ((overDb + knee / 2) * (overDb + knee / 2)) / (2 * knee) * (1 - 1 / ratio);
let g = Math.pow(10, (-red + makeup) / 20);
let delayed = state.buf[state.p];
state.buf[state.p] = inputSample;
state.p = (state.p + 1) % 64;
return Math.tanh(delayed * g) * mix + delayed * (1 - mix);`,
    tags: { topology: "lookahead-soft-knee", character: ["transparent"], sources: ["master", "mix_bus"], latency: "lookahead", cpu: "light" },
  },
  // Four researched, gate-verified compressor designs (researchCorpus.ts:
  // opto-model, fet-model, multiband-compression, sidechain-filter) that
  // stayed in the "approved on request" research queue instead of the
  // permanent bank -- the knowledge auditor kept flagging them as missing
  // curriculum coverage because approval there is a per-session workflow
  // action, not a standing part of what the offline builder can reach.
  // Promoted verbatim (same body, same params) into first-class topology
  // variants that compete as best-of-N seeds like every other alternate.
  {
    id: "comp_opto",
    family: "dynamics",
    title: "Opto leveling amplifier (photocell-style program-dependent release, fixed gentle ratio)",
    rationale: "LA-2A-style: gain reduction comes from a light source driving a photocell whose resistance recovers non-linearly -- release starts fast then slows the longer and harder it has been compressing, the classic program-dependent glue with no ratio or time-constant knobs to fight",
    parameters: [
      { id: "reduction", name: "Peak Reduction", min: 0, max: 1, defaultValue: 0.5, unit: "ratio" },
      { id: "makeup", name: "Gain", min: 0, max: 24, defaultValue: 5, unit: "dB" },
    ],
    body: `if (!state.init) { state.env = 0; state.memory = 0; state.init = true; }
let reduction = params.reduction !== undefined ? params.reduction : 0.5;
let makeup = params.makeup !== undefined ? params.makeup : 5;
let thresh = -8 - reduction * 30;
let x = Math.abs(inputSample);
// Program-dependent release: the "memory" of recent gain reduction slows
// the release coefficient down the longer and harder the unit has been
// compressing -- the defining LA-2A behavior, not just a fixed R.C. time.
let releaseC = 0.0008 / (1 + state.memory * 40);
state.env += (x > state.env ? 0.005 : releaseC) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - thresh;
let grDb = overDb > 0 ? overDb * (1 - 1 / 3) : 0;
state.memory += 0.00002 * (Math.min(1, grDb / 12) - state.memory);
let g = Math.pow(10, (-grDb + makeup) / 20);
return Math.tanh(inputSample * g);`,
    tags: { topology: "opto-program-dependent", character: ["colored"], sources: ["vocals", "bass"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_fet_1176",
    family: "dynamics",
    title: "FET peak limiter (microsecond attack, fixed threshold, input-driven intensity)",
    rationale: "1176-style: a FET gain element allows microsecond-class attack fast enough to clamp individual transient wavefronts, with no threshold knob -- Input doubles as intensity, and the FET stage adds harmonic color at high drive",
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
// Microsecond-class attack -- fast enough to clamp the wavefront of an
// individual transient, not just its envelope. No threshold: driving more
// signal into a FIXED point is what sets intensity on the real unit.
let aC = 1 - Math.exp(-1 / (attack * 44.1));
state.env += (x > state.env ? aC : 0.0007) * (x - state.env);
let envDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = envDb - (-16);
let grDb = overDb > 0 ? overDb * (1 - 1 / ratio) : 0;
let g = Math.pow(10, (-grDb + makeup) / 20) / Math.pow(gIn, 0.7);
return Math.tanh(driven * g);`,
    tags: { topology: "fet-fixed-threshold", character: ["aggressive"], sources: ["drums", "vocals", "guitar"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_multiband_2band",
    family: "dynamics",
    title: "2-band multiband compressor (complementary crossover, independent band envelopes)",
    rationale: "splits the signal with a crossover and compresses each band independently, so low-end energy cannot pump the highs -- the complementary one-pole split keeps the recombined spectrum flat when both bands sit at unity gain",
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
// Complementary split: high = input - low, so low + high always sums back
// to the input exactly at unity gain -- no separate highpass state to
// drift out of phase with the lowpass.
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
    tags: { topology: "2band-complementary-crossover", character: ["transparent"], sources: ["mix_bus", "master"], latency: "zero", cpu: "medium" },
  },
  {
    id: "comp_deesser",
    family: "dynamics",
    title: "De-esser (highpass-filtered detector, high-band gain reduction)",
    rationale: "a compressor whose DETECTOR listens through a filter tuned to the sibilance region, reducing gain only when 'ess' energy spikes -- internal sidechain filtering in its most common form, so the body of the voice passes untouched",
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
// The DETECTOR listens to the high band only -- gain reduction is applied
// to the high band, but the low band (the body of the voice) passes
// through completely untouched, which is what keeps a de-esser from
// sounding like a dull, generally-compressed vocal.
let high = inputSample - low;
let xs = Math.abs(high);
state.env += (xs > state.env ? 0.03 : 0.002) * (xs - state.env);
let essDb = 20 * Math.log10(Math.max(1e-6, state.env));
let overDb = essDb - (-26 - amount * 22);
let grDb = overDb > 0 ? Math.min(24, overDb * amount) : 0;
let mk = Math.pow(10, makeup / 20);
return Math.tanh((low + high * Math.pow(10, -grDb / 20)) * mk);`,
    tags: { topology: "sidechain-filtered-deesser", character: ["transparent"], sources: ["vocals"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_parallel",
    family: "dynamics",
    title: "Parallel (New York) compressor (crushed wet path blended with pristine dry)",
    rationale: "runs a fast, deep compressor (high ratio, low threshold) on a SEPARATE wet path and blends it back against the untouched dry signal -- the Blend knob, not the ratio, sets the effect intensity, adding density to quiet material while transients keep their original punch from the dry path",
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
// The DRY path never touches the gain computer -- only the wet path is
// crushed, so transient punch survives blend even at high ratio.
let wet = inputSample * Math.pow(10, (gainDb + makeup) / 20);
return Math.tanh(inputSample * (1 - blend) + wet * blend);`,
    tags: { topology: "parallel-ny-blend", character: ["aggressive"], sources: ["drums", "vocals", "mix_bus"], latency: "zero", cpu: "light" },
  },
  {
    id: "comp_midside",
    family: "dynamics",
    title: "Mid-side glue compressor (mid-detected linked gain, width control on the side channel)",
    rationale: "encodes L/R into sum (mid) and difference (side) channels, detects and compresses on the MID channel only, then applies the SAME linked gain reduction to both -- so the stereo image never lurches left or right when one side gets loud -- with an independent Width control scaling the side channel",
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
    tags: { topology: "mid-side-linked", character: ["transparent"], sources: ["mix_bus", "master"], latency: "zero", cpu: "light" },
  },

  /* ================================================================ */
  /* REVERB: three room designs                                        */
  /* ================================================================ */
  {
    id: "reverb_schroeder",
    family: "reverb",
    title: golden("reverb").title,
    rationale: "the proven general-purpose hall — parallel prime combs with in-loop damping",
    parameters: golden("reverb").parameters,
    body: golden("reverb").body,
    tags: { topology: "schroeder-hall", character: ["colored"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "reverb_fdn_plate",
    family: "reverb",
    title: "4x4 FDN plate (Hadamard feedback matrix, short mutually-prime lines, bright damping)",
    rationale: "vocals want a plate — a feedback-delay-network's cross-mixed short lines go dense immediately instead of echoing like a hall",
    parameters: [
      { id: "decay", name: "Decay", min: 0, max: 0.95, defaultValue: 0.8, unit: "ratio" },
      { id: "damp", name: "Damping", min: 0, max: 0.9, defaultValue: 0.25, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.3, unit: "ratio" },
    ],
    body: `if (!state.init) {
  state.b0 = new Float32Array(443); state.b1 = new Float32Array(557);
  state.b2 = new Float32Array(683); state.b3 = new Float32Array(811);
  state.i0 = 0; state.i1 = 0; state.i2 = 0; state.i3 = 0;
  state.d0 = 0; state.d1 = 0; state.d2 = 0; state.d3 = 0;
  state.init = true;
}
let decay = params.decay !== undefined ? params.decay : 0.8;
let damp = params.damp !== undefined ? params.damp : 0.25;
let mix = params.mix !== undefined ? params.mix : 0.3;
let hf = 1 - damp * 0.75;
let y0 = state.b0[state.i0]; state.d0 += hf * (y0 - state.d0); y0 = state.d0;
let y1 = state.b1[state.i1]; state.d1 += hf * (y1 - state.d1); y1 = state.d1;
let y2 = state.b2[state.i2]; state.d2 += hf * (y2 - state.d2); y2 = state.d2;
let y3 = state.b3[state.i3]; state.d3 += hf * (y3 - state.d3); y3 = state.d3;
// The Hadamard mixing matrix below is orthonormal, so the loop gain IS fb:
// with ~600-sample lines, fb must approach 0.9+ for a plate-length tail.
// (At 0.62 this measured a 0.19 s decay -- an ambience blip, not a plate.)
let fb = Math.min(0.97, 0.45 + decay * 0.55);
let m0 = (y0 + y1 + y2 + y3) * 0.5;
let m1 = (y0 - y1 + y2 - y3) * 0.5;
let m2 = (y0 + y1 - y2 - y3) * 0.5;
let m3 = (y0 - y1 - y2 + y3) * 0.5;
state.b0[state.i0] = inputSample + m0 * fb; state.i0 = (state.i0 + 1) % 443;
state.b1[state.i1] = inputSample * 0.8 + m1 * fb; state.i1 = (state.i1 + 1) % 557;
state.b2[state.i2] = inputSample * 0.6 + m2 * fb; state.i2 = (state.i2 + 1) % 683;
state.b3[state.i3] = inputSample * 0.4 + m3 * fb; state.i3 = (state.i3 + 1) % 811;
let wet = (y0 + y1 + y2 + y3) * 0.3;
return Math.tanh(inputSample * (1 - mix) + wet * mix * 1.5);`,
    tags: { topology: "fdn-plate", character: ["colored", "transparent"], sources: ["vocals", "synth"], latency: "zero", cpu: "medium" },
  },
  {
    id: "reverb_room_er",
    family: "reverb",
    title: "Early-reflection room (4 spread taps + damped regeneration, sized by one knob)",
    rationale: "drums and live sources want a tight ROOM, not a hall — discrete early reflections keep transients readable while Size grows the space",
    parameters: [
      { id: "size", name: "Size", min: 0, max: 0.95, defaultValue: 0.5, unit: "ratio" },
      { id: "damp", name: "Damping", min: 0, max: 0.9, defaultValue: 0.35, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.3, unit: "ratio" },
    ],
    body: `if (!state.init) { state.buf = new Float32Array(8820); state.p = 0; state.d = 0; state.dw = 0; state.init = true; }
let size = params.size !== undefined ? params.size : 0.5;
let damp = params.damp !== undefined ? params.damp : 0.35;
let mix = params.mix !== undefined ? params.mix : 0.3;
let base = 260 + size * 5800;
let t1 = Math.max(1, Math.floor(base * 0.31));
let t2 = Math.max(2, Math.floor(base * 0.53));
let t3 = Math.max(3, Math.floor(base * 0.79));
let t4 = Math.max(4, Math.floor(base));
let s1 = state.buf[(state.p - t1 + 8820) % 8820];
let s2 = state.buf[(state.p - t2 + 8820) % 8820];
let s3 = state.buf[(state.p - t3 + 8820) % 8820];
let s4 = state.buf[(state.p - t4 + 8820) % 8820];
let wet = s1 * 0.32 + s2 * 0.27 + s3 * 0.23 + s4 * 0.28;
let hf = 1 - damp * 0.8;
state.d += hf * (s4 - state.d);
let regen = 0.22 + size * 0.6;
state.buf[state.p] = inputSample + state.d * regen;
state.p = (state.p + 1) % 8820;
state.dw += hf * (wet - state.dw);
wet = state.dw;
return Math.tanh(inputSample * (1 - mix) + wet * mix * 1.1);`,
    tags: { topology: "early-reflection-room", character: ["transparent"], sources: ["drums", "guitar"], latency: "zero", cpu: "light" },
  },

  /* ================================================================ */
  /* DELAY: three echo designs                                         */
  /* ================================================================ */
  {
    id: "delay_tape",
    family: "delay",
    title: golden("delay").title,
    rationale: "the proven default — repeats darken as they regenerate, like tape",
    parameters: golden("delay").parameters,
    body: golden("delay").body,
    tags: { topology: "tape-damped-loop", character: ["colored", "lofi"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "delay_digital",
    family: "delay",
    title: "Pristine digital delay (undamped loop — every repeat is an exact copy)",
    rationale: "transparent material wants repeats that stay full-bandwidth instead of darkening — no lowpass in the regeneration loop",
    parameters: [
      { id: "time", name: "Time", min: 20, max: 1500, defaultValue: 350, unit: "ms" },
      { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.4, unit: "ratio" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, unit: "ratio" },
    ],
    body: `if (!state.init) { state.buf = new Float32Array(96000); state.ptr = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 350;
let fb = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.4);
let mix = params.mix !== undefined ? params.mix : 0.35;
let d = Math.max(1, Math.min(95999, Math.floor(time * 44.1)));
let read = (state.ptr - d + 96000) % 96000;
let wet = state.buf[read];
state.buf[state.ptr] = inputSample + wet * fb;
state.ptr = (state.ptr + 1) % 96000;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    tags: { topology: "digital-clean-loop", character: ["transparent"], sources: ["vocals", "synth", "master"], latency: "zero", cpu: "light" },
  },
  {
    id: "delay_pingpong",
    family: "delay",
    title: "Ping-pong delay (cross-fed L/R lines, alternating repeats, width control)",
    rationale: "cross-feeds two delay lines -- input enters the left line, the left tap regenerates into the right line and the right back into the left, so each repeat alternates sides -- with a Width control scaling how far the bounce spreads from center",
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
    tags: { topology: "cross-fed-pingpong", character: ["colored"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
  },

  /* ================================================================ */
  /* DISTORTION: four drive designs                                    */
  /* ================================================================ */
  {
    id: "dist_softclip",
    family: "distortion",
    title: golden("distortion").title,
    rationale: "the proven default — symmetric soft clip with gain compensation and a tone filter",
    parameters: golden("distortion").parameters,
    body: golden("distortion").body,
    tags: { topology: "softclip-symmetric", character: ["colored"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "dist_tube_asym",
    family: "distortion",
    title: "Asymmetric tube stage (biased tanh — even harmonics, DC-compensated, 2x oversampled)",
    rationale: "warmth lives in EVEN harmonics — a biased transfer curve clips the two half-waves differently, like a single-ended tube stage",
    parameters: [
      { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 8, unit: "dB" },
      { id: "tone", name: "Tone", min: 500, max: 12000, defaultValue: 4200, unit: "Hz" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.lp = 0; state.smDrive = 8; state.prevIn = 0; state.prevShaped = 0; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 8;
let tone = params.tone !== undefined ? params.tone : 4200;
let mix = params.mix !== undefined ? params.mix : 1;
state.smDrive += 0.002 * (drive - state.smDrive);
let g = Math.pow(10, state.smDrive / 20);
let bias = 0.22;
let biasRest = Math.tanh(bias);
// 2x oversampled with a triangular [0.25, 0.5, 0.25] halfband decimator
// (this sample's midpoint-and-current shaped values plus the PREVIOUS
// cycle's shaped current) -- a real halfband null, not a plain box average.
let midIn = 0.5 * (state.prevIn + inputSample);
let shapedMid = Math.tanh(midIn * g + bias) - biasRest;
let shapedCur = Math.tanh(inputSample * g + bias) - biasRest;
let wet = (0.25 * state.prevShaped + 0.5 * shapedMid + 0.25 * shapedCur) / Math.pow(g, 0.65);
state.prevShaped = shapedCur;
state.prevIn = inputSample;
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (wet - state.lp);
wet = state.lp;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    tags: { topology: "asymmetric-tube", character: ["colored"], sources: ["guitar", "bass", "vocals"], latency: "zero", cpu: "light" },
  },
  {
    id: "dist_fuzz",
    family: "distortion",
    title: "Hard fuzz (softsign fold-back curve, heavy compensation, fizz-taming tone filter)",
    rationale: "aggression wants a flatter-topped curve than tanh — softsign squashes into a near-square while the 2x oversampling and tone filter keep the fizz out of the gate's red zone",
    parameters: [
      { id: "drive", name: "Drive", min: 0, max: 36, defaultValue: 14, unit: "dB" },
      { id: "tone", name: "Tone", min: 500, max: 12000, defaultValue: 3600, unit: "Hz" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1, unit: "ratio" },
    ],
    body: `if (!state.init) { state.lp = 0; state.smDrive = 14; state.prevIn = 0; state.prevShaped = 0; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 14;
let tone = params.tone !== undefined ? params.tone : 3600;
let mix = params.mix !== undefined ? params.mix : 1;
state.smDrive += 0.002 * (drive - state.smDrive);
let g = Math.pow(10, state.smDrive / 20);
// 2x oversampled with a triangular [0.25, 0.5, 0.25] halfband decimator --
// softsign's fold-back shoulders are sharper than tanh's, so the plain box
// average left more image energy behind; the halfband null cuts it further.
let midIn = 0.5 * (state.prevIn + inputSample) * g;
let curIn = inputSample * g;
let shapedMid = midIn / (1 + Math.abs(midIn));
let shapedCur = curIn / (1 + Math.abs(curIn));
let wet = (0.25 * state.prevShaped + 0.5 * shapedMid + 0.25 * shapedCur) / Math.pow(g, 0.7);
state.prevShaped = shapedCur;
state.prevIn = inputSample;
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (wet - state.lp);
wet = state.lp;
return Math.tanh(inputSample * (1 - mix) + wet * mix);`,
    tags: { topology: "softsign-fuzz", character: ["aggressive", "lofi"], sources: ["guitar", "drums", "synth"], latency: "zero", cpu: "light" },
  },
  {
    id: "dist_dynamic_sat",
    family: "distortion",
    title: "Dynamic saturator (envelope-tracked drive, 2x oversampled, tone filter)",
    rationale: "tracks the input envelope and increases waveshaper drive on louder material -- how an analog stage distorts progressively rather than uniformly, so quiet passages stay clean while peaks push into real saturation",
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
    tags: { topology: "envelope-tracked-drive", character: ["colored"], sources: ["vocals", "guitar", "bass"], latency: "zero", cpu: "light" },
  },

  /* ================================================================ */
  /* SYNTHESIZER: two voice-generation designs beyond subtractive       */
  /* ================================================================ */
  {
    id: "synth_pad",
    family: "synthesizer",
    title: golden("synth").title,
    rationale: "the proven default — two detuned oscillators through a state-variable lowpass, warm and simple",
    parameters: golden("synth").parameters,
    body: golden("synth").body,
    tags: { topology: "detuned-2osc-svf", character: ["colored"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "synth_wavetable",
    family: "synthesizer",
    title: "Morphing wavetable oscillator (4 band-limited tables, interpolated scan, airy noise layer)",
    rationale: "reads a stored single-cycle waveform with a phase accumulator and interpolated lookup, then crossfades between adjacent band-limited tables to sweep timbre continuously -- from a pure sine to a bright sawtooth-ish stack -- without the aliasing a naive high-partial lookup would add at low pitches",
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
    tags: { topology: "morphing-wavetable", character: ["colored"], sources: ["synth" as SourceMaterial], latency: "zero", cpu: "medium" },
  },
  {
    id: "synth_fm",
    family: "synthesizer",
    title: "2-operator FM voice (phase-modulated carrier, ratio + index timbre control)",
    rationale: "a modulator oscillator at ratio*frequency phase-modulates the carrier -- Chowning's founding FM result: integer carrier:modulator ratios give harmonic spectra, non-integer ratios give bells and metallic inharmonics, all from two sine calls and one multiply, no lookup tables or filters needed",
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
    tags: { topology: "2op-fm", character: ["colored"], sources: ["synth" as SourceMaterial], latency: "zero", cpu: "light" },
  },

  /* ================================================================ */
  /* EQ: two band-shaping designs                                      */
  /* ================================================================ */
  {
    id: "eq_3band",
    family: "eq",
    title: golden("eq").title,
    rationale: "the proven default — three real crossover-split bands with per-band gain, correct for broad tonal shaping",
    parameters: golden("eq").parameters,
    body: golden("eq").body,
    tags: { topology: "3band-crossover-shelf", character: ["transparent"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
    isDefault: true,
  },
  {
    id: "eq_biquad_bell",
    family: "eq",
    title: "RBJ peaking bell EQ (cookbook biquad, smoothed sweepable center)",
    rationale: "a single surgical bell -- the RBJ cookbook biquad (A/alpha/cos-w0 coefficient derivation) targets ONE frequency with a real Q-controlled bandwidth, instead of three fixed crossover-split bands, for a scoop/boost a broad 3-band EQ can't reach precisely",
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
    tags: { topology: "rbj-peaking-biquad", character: ["transparent"], sources: ["any" as SourceMaterial], latency: "zero", cpu: "light" },
  },
];

export function topologiesForFamily(family: PluginFamily): DspTopology[] {
  return DSP_TOPOLOGIES.filter((t) => t.family === family);
}
