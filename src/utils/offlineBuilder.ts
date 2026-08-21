/**
 * Deterministic offline plugin builder -- the "any prompt, any situation"
 * guarantee of the factory.
 *
 * Every online generation path can fail (no API key, network down, local
 * model unloaded). This module makes the offline fallback a REAL generator
 * instead of a keyword demo: any natural-language request is compiled
 * through the same spec-first pipeline the online paths use --
 *
 *   prompt -> classifyPluginIntent -> scoreRecipes (verified golden recipes)
 *          -> single recipe build | hybrid two-stage composition
 *          -> generic character-chain fallback when NO family matches
 *
 * -- so the result is always a complete, honest, gate-passing plugin. The
 * caller must still run runQualityGate() on the result (same contract as
 * every other generation path).
 */

import { PluginParameter, AudioPlugin } from "../types";
import {
  AudioPluginSpec,
  PluginFamily,
  classifyPluginIntent,
  familyToCategory,
} from "./pluginSpec";
import { DSP_RECIPES, DspRecipe, PITCH_SHIFT_RECIPE, scoreRecipes } from "./dspRecipes";
import { buildPrimitiveGraph, composePrimitiveGraph, inferStages, reverseChain, swapSiblingInChain, DSP_PRIMITIVES } from "./dspPrimitives";
import { inferRequirements, hasRequirements, BuildRequirements } from "./requirements";
import { rankTopologies, logPromptGap } from "./knowledgeGraph";
import { DspTopology, DSP_TOPOLOGIES } from "./dspTopologies";
import { findApprovedModuleForPrompt } from "./researchEngine";

/** Why a particular topology was chosen — the "engineering brain" made
 *  visible: the design name, the one-line rationale, and the wording it read. */
export interface EngineeringChoice {
  topology: string;
  rationale: string;
  evidence: string[];
}

export interface OfflineBuild {
  name: string;
  category: AudioPlugin["category"];
  description: string;
  parameters: PluginParameter[];
  dspFunction: string;
  family: PluginFamily;
  /** Present only on the requirements-matched build (candidate[0]) when the
   *  wording drove a non-default topology; alternates carry none. */
  engineeringChoice?: EngineeringChoice;
  /** Markdown bullet list describing what was built, for the chat reply. */
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Naming                                                              */
/* ------------------------------------------------------------------ */

const FAMILY_LABELS: Record<PluginFamily, string> = {
  eq: "Parametric Shaper",
  filter: "Resonant Filter",
  distortion: "Drive Engine",
  saturator: "Analog Saturator",
  multiband_saturator: "Multiband Saturator",
  delay: "Echo Unit",
  reverb: "Space Processor",
  modulation: "Motion Modulator",
  dynamics: "Dynamics Processor",
  synthesizer: "Synth Voice",
  pitch: "Pitch Shifter",
  amp_sim: "Amp Channel",
  sampler: "Beat Station",
  utility: "Utility Channel",
  hybrid_other: "Custom Processor",
};

const NAME_STOPWORDS = new Set([
  "make", "me", "a", "an", "the", "that", "which", "with", "for", "of", "and",
  "to", "it", "i", "want", "need", "build", "create", "give", "design",
  "generate", "please", "plugin", "effect", "some", "sounds", "sound", "like",
  "really", "very", "my", "into", "turn", "can", "you", "something", "kind",
  "sort", "one", "new", "add", "this", "is", "be", "on", "in", "at", "up",
]);

/** "make a lush hall reverb" -> "Lush Hall Reverb". Family label when the
 *  prompt has nothing usable. */
export function derivePluginName(prompt: string, family: PluginFamily): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w));
  const picked = words.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const base = picked.join(" ").trim();
  return base || FAMILY_LABELS[family];
}

/* ------------------------------------------------------------------ */
/* Flavor: descriptive words in the prompt shape the default voicing   */
/* ------------------------------------------------------------------ */

interface FlavorRule {
  match: RegExp;
  /** Applied to parameter ids. */
  targets: RegExp;
  /** Where in the [min, max] range to place the default (0..1). */
  frac: number;
  note: string;
}

const FLAVOR_RULES: FlavorRule[] = [
  { match: /dark|warm|mellow|smooth|muffl|vintage|lo.?fi|dusty/i, targets: /^(tone|cutoff)$/, frac: 0.28, note: "voiced dark -- tone/cutoff lowered" },
  { match: /bright|airy|crisp|sparkl|glassy/i, targets: /^(tone|cutoff)$/, frac: 0.82, note: "voiced bright -- tone/cutoff raised" },
  { match: /subtle|gentle|slight|mild|tasteful/i, targets: /^(mix|drive|depth|feedback|space)$/, frac: 0.22, note: "kept subtle -- intensity lowered" },
  { match: /extreme|aggressive|heavy|brutal|insane|crushed|destroy|savage/i, targets: /^(drive|feedback|depth|resonance)$/, frac: 0.85, note: "pushed hard -- intensity raised" },
  { match: /huge|massive|giant|long|endless|cathedral|epic|wash|infinite/i, targets: /^(decay|feedback|space)$/, frac: 0.8, note: "sized huge -- decay/feedback raised" },
  // Delay time is raised less aggressively than decay/feedback: repeats must
  // stay inside the quality gate's measurement window or the feedback knob
  // becomes unmeasurable (and inaudible in the short preview).
  { match: /huge|massive|giant|long|endless|cathedral|epic|wash|infinite/i, targets: /^time$/, frac: 0.42, note: "delay time raised (kept in audible echo range)" },
  { match: /short|tight|small|snappy|slap/i, targets: /^(decay|time|space)$/, frac: 0.18, note: "kept tight -- decay/time lowered" },
  { match: /\bfast|quick|rapid\b/i, targets: /^(rate|speed)$/, frac: 0.75, note: "sped up -- rate raised" },
  { match: /\bslow|lazy\b/i, targets: /^(rate|speed)$/, frac: 0.15, note: "slowed down -- rate lowered" },
];

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Mutates parameter defaults toward the prompt's descriptive words.
 *  Returns human-readable notes about what was adjusted. */
export function applyPromptFlavor(prompt: string, parameters: PluginParameter[]): string[] {
  const notes: string[] = [];
  for (const rule of FLAVOR_RULES) {
    if (!rule.match.test(prompt)) continue;
    let touched = false;
    for (const p of parameters) {
      if (!rule.targets.test(p.id)) continue;
      const v = round3(p.min + rule.frac * (p.max - p.min));
      p.defaultValue = v;
      p.value = v;
      touched = true;
    }
    if (touched) notes.push(rule.note);
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Extra local recipe bodies (families the golden library routes       */
/* through shared references but that deserve a richer offline build)  */
/* ------------------------------------------------------------------ */

/** Multi-stage high-gain amp channel: noise gate -> tightener -> cascaded
 *  tanh triode stages -> bass/mid/treble tone stack -> presence -> cab
 *  lowpass + chassis resonance + comb reflections. The mandatory amp/cab/mic
 *  UI is injected by the quality gate, not here. */
const AMP_CHANNEL: DspRecipe = {
  id: "amp_channel",
  title: "High-gain amp channel (gate, cascaded triodes, tone stack, cab sim)",
  match: /amp/i,
  parameters: [
    { id: "gain", name: "Preamp Gain", min: 1.0, max: 12.0, defaultValue: 6.5, unit: "x" },
    { id: "gate", name: "Noise Gate", min: 0.0, max: 10.0, defaultValue: 3.5, unit: "dB" },
    // Real per-voicing DSP branching (thresholded like AeroTune's `scale`
    // param): each step drives genuinely different drive/tone-stack
    // coefficients in the body below, not just a cosmetic label. Choices
    // are index-aligned to Math.round(value) across [min, max].
    { id: "headType", name: "Amp Voicing", min: 0, max: 3, defaultValue: 1, unit: "type", controlType: "select", choices: ["Clean", "Crunch", "Lead", "Modern"] },
    { id: "bass", name: "Bass", min: 0.0, max: 10.0, defaultValue: 6.0, unit: "dB" },
    { id: "mid", name: "Mid", min: 0.0, max: 10.0, defaultValue: 4.0, unit: "dB" },
    { id: "treble", name: "Treble", min: 0.0, max: 10.0, defaultValue: 6.5, unit: "dB" },
    { id: "presence", name: "Presence", min: 0.0, max: 10.0, defaultValue: 7.0, unit: "kHz" },
    { id: "cabType", name: "Cabinet", min: 0, max: 2, defaultValue: 2, unit: "type", controlType: "select", choices: ["1x12", "2x12", "4x12"] },
  ],
  body: `if (!state.init) {
  state.gate_env = 0.0;
  state.ts_x1 = 0.0; state.ts_y1 = 0.0;
  state.c1_x1 = 0.0; state.c1_y1 = 0.0;
  state.c2_x1 = 0.0; state.c2_y1 = 0.0;
  state.c3_x1 = 0.0; state.c3_y1 = 0.0;
  state.lp_y1 = 0.0;
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

let gain = params.gain !== undefined ? params.gain : 6.5;
let bass = params.bass !== undefined ? params.bass : 6.0;
let mid = params.mid !== undefined ? params.mid : 4.0;
let treble = params.treble !== undefined ? params.treble : 6.5;
let presence = params.presence !== undefined ? params.presence : 7.0;
let gate = params.gate !== undefined ? params.gate : 3.5;
let headType = params.headType !== undefined ? params.headType : 1;
let cabType = params.cabType !== undefined ? params.cabType : 2;

// Head voicing: real drive/tone-stack coefficients per channel, not a
// cosmetic label. Thresholded the same way AeroTune's scale param picks a
// scale -- each discrete step is a real branch, not an interpolation.
// Tone-tilt swings are deliberately wide (not just the drive/clip
// multipliers): once the preamp is already driven hard (this channel's
// default ~34dB preGaindB routinely saturates the cascaded tanh/exp
// stages regardless of hDriveMul), further gain differences compress
// toward the same clipped waveform -- but an EQ-shape difference survives
// saturation, so it's what actually keeps all four channels sounding
// distinct rather than converging once everything's already clipping.
let hDriveMul = 1.0, hToneTiltBass = 1.0, hToneTiltTreble = 1.0, hClipHardness = 1.0;
if (headType >= 2.5) { // Modern: tight/scooped low end, boosted top, hardest clip
  hDriveMul = 1.5; hToneTiltBass = 0.55; hToneTiltTreble = 1.5; hClipHardness = 1.6;
} else if (headType >= 1.5) { // Lead: most gain, creamy scooped-treble sustain
  hDriveMul = 2.0; hToneTiltBass = 1.3; hToneTiltTreble = 0.6; hClipHardness = 1.4;
} else if (headType >= 0.5) { // Crunch: the channel's original voicing
  hDriveMul = 1.0; hToneTiltBass = 1.0; hToneTiltTreble = 1.0; hClipHardness = 1.0;
} else { // Clean: minimal drive, scooped mids, glassy top end
  hDriveMul = 0.28; hToneTiltBass = 1.3; hToneTiltTreble = 0.65; hClipHardness = 0.5;
}

// Cabinet voicing: lowpass/highpass/resonance frequencies and the comb
// reflection delay all move together per cab size, not just a speaker icon.
let cabLp = 4800.0, cabHp = 75.0, cabRes = 85.0, cabComb = 74;
if (cabType >= 1.5) { // 4x12: darkest, deepest, biggest
  cabLp = 4200.0; cabHp = 60.0; cabRes = 82.0; cabComb = 95;
} else if (cabType >= 0.5) { // 2x12: the channel's original voicing
  cabLp = 4800.0; cabHp = 75.0; cabRes = 85.0; cabComb = 74;
} else { // 1x12: brightest, thinnest, most resonant peak
  cabLp = 5600.0; cabHp = 95.0; cabRes = 92.0; cabComb = 50;
}

let preGaindB = (gain - 1.0) * 4.0 + 12.0;
let gainFactor = Math.pow(10, preGaindB / 20.0);

// Input noise gate (envelope follower with fast attack, slow release)
let env_calc = Math.abs(inputSample);
let gate_threshold = Math.pow(10, (-60 + (10 - gate) * 5.2) / 20);
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

// Pre-distortion tightener (screamer-style highpass hump)
let ts_out = 0.93 * gatedInput - 0.93 * state.ts_x1 + 0.86 * state.ts_y1;
state.ts_x1 = gatedInput;
state.ts_y1 = ts_out;
let midHump = Math.sin(1.5 * ts_out);
let preDriven = (ts_out * 1.4 + midHump * 0.6) * gainFactor * hDriveMul * 0.12;

// Cascaded triode stages (asymmetric tanh/exp waveshapers with coupling caps)
let stage1 = Math.tanh(preDriven * hClipHardness + 0.12);
let stage1_hf = stage1 - state.c1_x1 + 0.992 * state.c1_y1;
state.c1_x1 = stage1;
state.c1_y1 = stage1_hf;

let s2_in = stage1_hf * 2.8 * hClipHardness;
let stage2 = s2_in > 0.0 ? (1.0 - Math.exp(-s2_in)) : -(1.0 - Math.exp(s2_in * 0.85));
let stage2_hf = stage2 - state.c2_x1 + 0.992 * state.c2_y1;
state.c2_x1 = stage2;
state.c2_y1 = stage2_hf;

let stage3 = Math.tanh((stage2_hf * 3.4 - 0.28) * 1.25 * hClipHardness);
let stage3_hf = stage3 - state.c3_x1 + 0.992 * state.c3_y1;
state.c3_x1 = stage3;
state.c3_y1 = stage3_hf;

// Tone stack: bass shelf, mid scoop biquad, treble + presence shelves
let g_bass = (bass / 10.0) * 2.0 * hToneTiltBass;
let g_mid = Math.pow(10, ((mid - 10.0) * 3.6) / 20.0);
let g_treble = (treble / 10.0) * 2.2 * hToneTiltTreble;
let g_presence = (presence / 10.0) * 1.8;

let eq_bass = stage3_hf + (0.12 * g_bass) * state.lp_y1;
state.lp_y1 = stage3_hf - 0.95 * state.lp_y1;

let mid_omega = (2.0 * Math.PI * 500.0) / 44100.0;
let mid_cos = Math.cos(mid_omega);
let mid_alpha = Math.sin(mid_omega) / 1.1;
let mb0 = 1.0 + mid_alpha * g_mid;
let mb2 = 1.0 - mid_alpha * g_mid;
let ma0 = 1.0 + mid_alpha;
let ma1 = -2.0 * mid_cos;
let ma2 = 1.0 - mid_alpha;
let eq_mid = (mb0 / ma0) * eq_bass + (ma1 / ma0) * state.mid_y1 + (mb2 / ma0) * state.mid_y2 - (ma1 / ma0) * state.mid_y1 - (ma2 / ma0) * state.mid_y2;
state.mid_y2 = state.mid_y1;
state.mid_y1 = eq_mid;

let tr_diff = eq_mid - state.treble_y1;
let eq_treble = eq_mid + (g_treble - 1.0) * tr_diff * 0.45;
state.treble_y1 = state.treble_y1 + 0.28 * tr_diff;

let pr_diff = eq_treble - state.presence_y1;
let presence_sig = eq_treble + (g_presence - 1.0) * pr_diff * 0.65;
state.presence_y1 = state.presence_y1 + 0.38 * pr_diff;

// Cabinet: lowpass, highpass, chassis resonance, and comb reflection delay
// all move per cabType (see the branch above) -- 4.8/75/85 kHz/Hz and a
// 74-sample comb were the 2x12's own values, now one voicing among three.
let lp_coeff = 1.0 - Math.exp(-2.0 * Math.PI * cabLp / 44100.0);
state.cab_lh = state.cab_lh + lp_coeff * (presence_sig - state.cab_lh);
let cab_hp_coeff = 1.0 - Math.exp(-2.0 * Math.PI * cabHp / 44100.0);
state.cab_hh = state.cab_hh + cab_hp_coeff * (state.cab_lh - state.cab_hh);
let filtered_cab = state.cab_lh - state.cab_hh;

let r_omega = (2.0 * Math.PI * cabRes) / 44100.0;
let r_alpha = Math.sin(r_omega) / 3.6;
let r_a0 = 1.0 + r_alpha;
let res_out = (r_alpha / r_a0) * filtered_cab + (-r_alpha / r_a0) * state.cab_res_y2 - ((-2.0 * Math.cos(r_omega)) / r_a0) * state.cab_res_y1 - ((1.0 - r_alpha) / r_a0) * state.cab_res_y2;
state.cab_res_y2 = state.cab_res_y1;
state.cab_res_y1 = res_out;

let speaker_tone = filtered_cab * 0.82 + res_out * 0.45;
let comb_rd = (state.comb_ptr - cabComb + 512) % 512;
let comb_delayed = state.comb_line[comb_rd] || 0.0;
state.comb_line[state.comb_ptr] = speaker_tone;
state.comb_ptr = (state.comb_ptr + 1) % 512;

return Math.tanh((speaker_tone * 0.76 + comb_delayed * 0.24) * 1.1);`,
  pitfalls: [],
};

/* Prompts matching NO known family used to fall back to a fixed
 * "character chain" recipe here; that was replaced by buildPrimitiveGraph
 * (dspPrimitives.ts), which composes a request-specific chain of verified
 * primitive stages instead. The generic recipe is gone -- see the no-recipe
 * branch of buildOfflinePlugin below. */

/* ------------------------------------------------------------------ */
/* Two-stage hybrid composition                                        */
/* ------------------------------------------------------------------ */

/** Recipes that GENERATE sound rather than process it -- as a hybrid stage
 *  they must come first so the effect stage has something to chew on. */
const GENERATOR_RECIPES = new Set(["sampler", "synth"]);

function prefixStateKeys(body: string, prefix: string): string {
  return body.replace(/\bstate\./g, `state.${prefix}`);
}

/** Turn the recipe body's single trailing `return <expr>;` into an
 *  assignment to <outVar> (declared by the caller in the outer scope) so a
 *  second stage can consume it. */
function captureReturnValue(body: string, outVar: string): string {
  const idx = body.lastIndexOf("return ");
  if (idx === -1) return `${body}\n${outVar} = 0;`;
  const expr = body.slice(idx + "return ".length).replace(/;\s*$/, "");
  return `${body.slice(0, idx)}${outVar} = ${expr};`;
}

interface ComposedRecipe {
  title: string;
  parameters: DspRecipe["parameters"];
  body: string;
  stageIds: [string, string];
}

/** Deterministically chain two verified recipe bodies: stage 1's output
 *  becomes stage 2's input. State keys are namespaced per stage; colliding
 *  parameter ids get a "2" suffix on the second stage. */
export function composeRecipes(first: DspRecipe, second: DspRecipe): ComposedRecipe {
  let a = first;
  let b = second;
  // A generator (synth/sampler) can only be stage 1.
  if (GENERATOR_RECIPES.has(b.id) && !GENERATOR_RECIPES.has(a.id)) {
    [a, b] = [b, a];
  }

  const stage1Body = captureReturnValue(prefixStateKeys(a.body, "s1_"), "__stage1Out");

  let stage2Body = prefixStateKeys(b.body, "s2_").replace(/\binputSample\b/g, "__stage1Out");
  const seenIds = new Set(a.parameters.map((p) => p.id));
  const stage2Params = b.parameters.map((p) => {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      return { ...p };
    }
    const newId = `${p.id}2`;
    stage2Body = stage2Body.replace(new RegExp(`\\bparams\\.${p.id}\\b`, "g"), `params.${newId}`);
    return { ...p, id: newId, name: `${p.name} (Stage 2)` };
  });

  return {
    title: `${a.title} feeding ${b.title}`,
    parameters: [...a.parameters.map((p) => ({ ...p })), ...stage2Params],
    // Each stage runs in its own block scope: recipes freely declare the same
    // local names (`let mix`, `let hf`), and without the braces any collision
    // is a duplicate-let SyntaxError that kills the whole function.
    body: `let __stage1Out = 0;\n// --- STAGE 1: ${a.title} ---\n{\n${stage1Body}\n}\n\n// --- STAGE 2: ${b.title} ---\n{\n${stage2Body}\n}`,
    stageIds: [a.id, b.id],
  };
}

/* ------------------------------------------------------------------ */
/* Friendly copy: what a musician needs to know, not DSP jargon        */
/* ------------------------------------------------------------------ */

/** One plain-language line per known control id (fallback: range + unit). */
const PARAM_HINTS: Record<string, string> = {
  decay: "how long the tail rings out",
  damp: "darkens the tail (higher = darker)",
  mix: "dry/wet balance",
  mix2: "blend of the second stage",
  time: "echo time",
  feedback: "how many repeats before it fades",
  rate: "movement speed",
  depth: "movement amount",
  threshold: "where the compression starts grabbing",
  ratio: "how hard it clamps once it grabs",
  makeup: "brings the level back up",
  attack: "how fast it reacts",
  cutoff: "brightness — sweep it to open or close the sound",
  low: "low-band gain — body and weight",
  shift: "granular pitch shift in semitones",
  ringfreq: "ring-mod carrier — low = tremolo, high = metallic",
  crush: "bit depth — lower = crunchier",
  fold: "wavefold amount — adds gnarly harmonics",
  combfreq: "resonator pitch — tuned metallic ring",
  wrate: "filter wobble speed",
  chop: "rhythmic gate speed",
  midFreq: "where the mid band sits — sweep to find the sweet spot",
  high: "high-band gain — air and sparkle",
  resonance: "emphasis right at the cutoff point",
  drive: "distortion amount",
  tone: "overall brightness",
  space: "adds room and echo around the sound",
  pitch: "shift in semitones (+12 = one octave up)",
  key: "target key — 0 = Auto (follows the take), 1-12 = C through B",
  scale: "scale to snap to — 0 chromatic, 1 major, 2 minor, 3 pentatonic",
  speed: "retune speed — 0 ms hard/robotic snap, higher = human glide",
  formant: "formant shift — 0 keeps the natural voice, +/- for chipmunk/deeper",
  freq: "root note frequency",
  detune: "width and thickness between the two oscillators",
  level: "output level",
  gain: "preamp gain — turn up for more grit",
  gate: "noise gate — higher chokes off hiss faster",
  bass: "low-end body",
  mid: "midrange scoop/boost",
  treble: "top-end bite",
  presence: "high-frequency sizzle",
};

function controlLine(p: PluginParameter): string {
  const hint = PARAM_HINTS[p.id] || `${p.min} to ${p.max} ${p.unit}`.trim();
  return `- **${p.name}** — ${hint}`;
}

/** Plain-language description per recipe id. */
const FRIENDLY_STRUCTURE: Record<string, string> = {
  reverb: "a dense hall — four parallel comb delays with a naturally darkening tail",
  delay: "a tape-style echo with warm, damped repeats",
  modulation: "a chorus that sweeps a short delay line for movement and width",
  dynamics: "a smooth compressor that rides the level in the dB domain",
  eq: "a real 3-band parametric EQ — low, sweepable mid, and high bands with independent gain",
  filter: "a resonant lowpass with a smoothed, sweepable cutoff",
  distortion: "a soft-clip drive with gain compensation and a tone control",
  sampler: "eight synthesized pads — kick, toms, snare, perc, hat, clap, bell",
  pitch: "a real autotuner — detects the sung pitch, snaps it to your key/scale, and resynthesizes with formant preservation",
  pitch_shift: "a click-free fixed pitch shifter with two crossfaded read heads",
  synth: "a detuned two-oscillator pad voice through a resonant lowpass",
  amp_channel: "a gated multi-stage tube-style preamp into a tone stack and a 4x12-style cab",
};

/** Openers rotated deterministically so consecutive builds don't read identically. */
const OPENERS = [
  "is loaded — press play to hear it",
  "is compiled and ready — hit play",
  "just landed on the deck — press play",
  "is live in the rack — give it a spin",
];

/** Tweak suggestions per family — every word here maps to a working
 *  relative-tweak rule for that family's actual parameters. */
const NEXT_MOVES: Record<string, string[]> = {
  reverb: ["longer", "darker", "drier"],
  delay: ["more feedback", "shorter", "wetter"],
  modulation: ["faster", "slower", "wetter"],
  dynamics: ["louder", "quieter"],
  filter: ["brighter", "darker"],
  eq: ["brighter", "darker"],
  distortion: ["dirtier", "cleaner", "darker"],
  saturator: ["dirtier", "cleaner", "darker"],
  multiband_saturator: ["dirtier", "darker", "wetter"],
  amp_sim: ["dirtier", "brighter", "quieter"],
  sampler: ["wetter", "drier"],
  pitch: ["wetter", "drier"],
  synthesizer: ["brighter", "darker", "louder"],
  synth: ["brighter", "darker", "louder"],
};

/** Tweak words that actually work for this family or app category. */
export function nextMovesFor(familyOrCategory: string): string[] {
  return NEXT_MOVES[familyOrCategory] || ["brighter", "darker", "wetter", "drier"];
}

/* ------------------------------------------------------------------ */
/* Honest capability notes (the engine must never lie about itself)    */
/* ------------------------------------------------------------------ */

const HONESTY_NOTES: Partial<Record<string, string>> = {
  sampler:
    "Every pad is a synthesized voice (kick, toms, snare, perc, hat, clap, bell) -- this engine has no audio-file loading, so nothing here claims to import WAVs.",
  pitch:
    "This is a real tuner: it detects the sung pitch by autocorrelation, snaps it to the Key and Scale you pick (Key = Auto follows the take's own key), and resynthesizes at the corrected pitch. Retune Speed sets snap vs. glide, and Formant keeps the vocal character natural while the pitch moves.",
  synth:
    "This is a generator: it produces its own tone from the oscillators and ignores the audio input.",
};

/* ------------------------------------------------------------------ */
/* The builder                                                         */
/* ------------------------------------------------------------------ */

function toLiveParams(recipeParams: DspRecipe["parameters"]): PluginParameter[] {
  return recipeParams.map((p) => ({ ...p, value: p.defaultValue }));
}

/**
 * Compile ANY natural-language request into a complete plugin, fully
 * offline. The caller must run the result through runQualityGate() -- the
 * same contract as every other generation path (the gate adds gain trim,
 * visual polish, and family-mandatory UI like amp/cab/mic or the pad grid).
 */
export function buildOfflinePlugin(prompt: string, specIn?: AudioPluginSpec | null): OfflineBuild {
  const spec = specIn ?? classifyPluginIntent(prompt);
  const scored = scoreRecipes(prompt, spec);
  const requirements = inferRequirements(prompt);

  let parameters: PluginParameter[];
  let dspFunction: string;
  let structure: string;
  let friendly: string;
  let engineeringChoice: DspTopology | null = null;
  const honesty: string[] = [];

  // A real shimmer is a reverb with a pitched-up sheen in the tail, not a
  // plain hall -- compose the verified reverb and pitch recipes and voice
  // the pitch stage as a subtle octave-up blend.
  const wantsShimmer = /shimmer/i.test(prompt) && spec.family === "reverb";

  // requirements.ts's source/character/latency dimensions don't recognize
  // structural wording like "multi-tap" -- without this short-circuit, a
  // bare "multi-tap delay" prompt has no requirements at all and
  // rankTopologies() just returns the family default (delay_tape).
  const wantsMultiTap = /multi.?tap|rhythmic\s*(?:delay|echo)|tap\s*delay/i.test(prompt) && spec.family === "delay";

  // Same gap: "convolution"/"impulse response" wording isn't a recognized
  // character/source/latency requirement either, so without this a prompt
  // naming the technique by name silently built reverb_fdn_plate (the
  // requirements-neutral runner-up) instead of reverb_convolution -- the
  // exact word the user typed. Regex matches researchCorpus.ts's own
  // "convolution" concept match verbatim.
  const wantsConvolution = /convolution|impulse\s*response|\bir\b\s*(?:reverb|loader)|convolv/i.test(prompt) && spec.family === "reverb";

  // Same gap again, for the external sidechain compressor: "sidechain"/
  // "duck" already route to the dynamics family (dspRecipes.ts's own match
  // regex), but requirements.ts has no dimension recognizing WHICH
  // compressor design that implies, so without this it silently built
  // comp_ff_rms (an ordinary self-detecting compressor with no key input at
  // all) instead of the one topology that actually reads inputKey.
  // Deliberately WIDER than researchCorpus.ts's own "sidechain-input" match
  // (which requires "sidechain" immediately followed by "input"/"key", and
  // "duck" immediately followed by "from"/"to") -- caught empirically that
  // real phrasing like "a sidechain compressor" or "ducking the bass from
  // the kick" has other words in between and didn't match that narrower
  // shape at all.
  const wantsSidechain = /sidechain\s*(?:input|key|comp)|external\s*(?:key|sidechain)|duck(?:s|ing)?\b.*\b(?:from|to)\b/i.test(prompt) && spec.family === "dynamics";

  // Human-approved research first: a gate-verified module the user approved
  // in the Research Lab whose concept wording matches this prompt beats the
  // generic banks -- that's the whole point of researching a gap.
  const researched = spec.family === "amp_sim" || wantsShimmer || wantsMultiTap || wantsConvolution || wantsSidechain ? null : findApprovedModuleForPrompt(prompt);

  if (researched?.proposedModule) {
    const m = researched.proposedModule;
    parameters = toLiveParams(m.parameters);
    dspFunction = m.body;
    structure = m.title;
    friendly = `an approved researched design — ${m.title}`;
    const topCitation = researched.claims[0]?.citation;
    if (topCitation) {
      honesty.push(`Built from research you approved (${researched.concept}), sourced from: ${topCitation.source}.`);
    }
  } else if (spec.family === "amp_sim") {
    parameters = toLiveParams(AMP_CHANNEL.parameters);
    dspFunction = AMP_CHANNEL.body;
    structure = AMP_CHANNEL.title;
    friendly = FRIENDLY_STRUCTURE.amp_channel;
  } else if (wantsShimmer) {
    const reverbRecipe = DSP_RECIPES.find((r) => r.id === "reverb")!;
    // Shimmer wants a FIXED octave-up sheen, not pitch correction -- compose the
    // standalone fixed shifter, not the `pitch` autotune recipe.
    const composed = composeRecipes(reverbRecipe, PITCH_SHIFT_RECIPE);
    parameters = toLiveParams(composed.parameters);
    for (const p of parameters) {
      if (p.id === "pitch") {
        p.name = "Shimmer Pitch";
        p.defaultValue = 12;
        p.value = 12;
      } else if (p.id === "mix2") {
        p.name = "Shimmer Amount";
        p.defaultValue = 0.35;
        p.value = 0.35;
      }
    }
    dspFunction = composed.body;
    structure = "Schroeder reverb with an octave-up pitch-shifted sheen woven into the tail";
    friendly = "a dense hall with an octave-up sparkle woven into the tail — a true shimmer";
  } else if (wantsMultiTap) {
    const multiTap = DSP_TOPOLOGIES.find((t) => t.id === "delay_multitap")!;
    parameters = toLiveParams(multiTap.parameters);
    dspFunction = multiTap.body;
    structure = multiTap.title;
    friendly = "a multi-tap rhythmic delay reading one line at three offsets, instead of a single steady echo";
    engineeringChoice = multiTap;
  } else if (wantsConvolution) {
    const convolution = DSP_TOPOLOGIES.find((t) => t.id === "reverb_convolution")!;
    parameters = toLiveParams(convolution.parameters);
    dspFunction = convolution.body;
    structure = convolution.title;
    friendly = "a direct FIR convolution against a synthesized room impulse response, instead of a comb/FDN network";
    engineeringChoice = convolution;
  } else if (wantsSidechain) {
    const sidechain = DSP_TOPOLOGIES.find((t) => t.id === "comp_sidechain_ext")!;
    parameters = toLiveParams(sidechain.parameters);
    dspFunction = sidechain.body;
    structure = sidechain.title;
    friendly = "an external sidechain compressor -- its detector follows a separate key input instead of the main signal";
    engineeringChoice = sidechain;
  } else if (scored.length >= 2 && (spec.hybrid || spec.family === "multiband_saturator")) {
    const composed = composeRecipes(scored[0].recipe, scored[1].recipe);
    parameters = toLiveParams(composed.parameters);
    dspFunction = composed.body;
    structure = composed.title;
    friendly = composed.stageIds
      .map((id) => FRIENDLY_STRUCTURE[id] || id)
      .join(", feeding ");
    for (const id of composed.stageIds) {
      const note = HONESTY_NOTES[id];
      if (note) honesty.push(note);
    }
  } else if (scored.length >= 1) {
    // Requirements-driven topology selection: when this family has competing
    // engineering designs, the knowledge graph ranks them against what the
    // wording asked for (source material / character / latency budget). With
    // no requirements the family default IS the golden recipe -- neutral
    // prompts build exactly what they always built.
    const rankedTopologies = rankTopologies(spec.family, requirements);
    if (rankedTopologies.length > 0) {
      const chosen = rankedTopologies[0];
      parameters = toLiveParams(chosen.parameters);
      dspFunction = chosen.body;
      structure = chosen.title;
      friendly = FRIENDLY_STRUCTURE[spec.family] || FRIENDLY_STRUCTURE[scored[0].recipe.id] || chosen.title;
      if (!chosen.isDefault) engineeringChoice = chosen;
      const note = HONESTY_NOTES[scored[0].recipe.id];
      if (note) honesty.push(note);
    } else {
      const recipe = scored[0].recipe;
      parameters = toLiveParams(recipe.parameters);
      dspFunction = recipe.body;
      structure = recipe.title;
      friendly = FRIENDLY_STRUCTURE[recipe.id] || recipe.title;
      const note = HONESTY_NOTES[recipe.id];
      if (note) honesty.push(note);
    }
  } else {
    // No recipe at all: compose a chain of verified DSP primitives inferred
    // from the prompt's wording — novel requests get a genuinely custom
    // signal path, not a generic shrug. Still gate-verified like everything.
    const graph = buildPrimitiveGraph(prompt);
    parameters = toLiveParams(graph.parameters);
    dspFunction = graph.body;
    structure = `composed primitive chain: ${graph.title}`;
    friendly = `a custom-composed signal chain — ${graph.title}`;
    // Demand-driven growth: when the wording voted for fewer than two
    // primitives, the chain is mostly fallback stages -- record the prompt
    // so the next primitives get added where real requests point.
    const votes = DSP_PRIMITIVES.filter((p) => p.match.test(prompt)).length;
    if (votes < 2) {
      logPromptGap(prompt, spec.family, `only ${votes} primitive keyword match(es) — served by fallback chain`);
    }
  }

  const flavorNotes = applyPromptFlavor(prompt, parameters);
  const name = derivePluginName(prompt, spec.family);

  const descriptionParts = [
    `${FAMILY_LABELS[spec.family]}: ${structure}.`,
    engineeringChoice ? `Engineering choice: ${engineeringChoice.rationale}.` : "",
    spec.dspIdentity && spec.source === "llm" ? spec.dspIdentity : "",
    ...honesty,
  ].filter(Boolean);

  // ---- Chat summary: written for a musician, varied, and actionable ----
  const opener = OPENERS[(prompt.length + name.length) % OPENERS.length];
  const pads = parameters.filter((p) => p.id.startsWith("pad_"));
  const knobs = parameters.filter((p) => !p.id.startsWith("pad_"));

  const summaryLines: string[] = [
    `🎛️ **${name}** ${opener}.`,
    "",
    `What it is: ${friendly}.`,
    "",
    "Your controls:",
  ];
  if (pads.length > 0) {
    summaryLines.push(`- **Pads 1-8** — ${FRIENDLY_STRUCTURE.sampler.split("— ")[1] || "eight trigger pads"}`);
  }
  knobs.slice(0, 8).forEach((p) => summaryLines.push(controlLine(p)));

  if (engineeringChoice && hasRequirements(requirements)) {
    summaryLines.push(
      "",
      `Engineering choice: **${engineeringChoice.tags.topology}** — ${engineeringChoice.rationale}. Read from your wording: ${requirements.evidence.join("; ")}.`
    );
  }
  if (flavorNotes.length > 0) {
    summaryLines.push("", `Voiced from your wording: ${flavorNotes.join("; ")}.`);
  }
  for (const note of honesty) {
    summaryLines.push("", `Straight talk: ${note}`);
  }

  const moves = nextMovesFor(spec.family);
  summaryLines.push(
    "",
    `Not quite it? Say ${moves.map((m) => `**"${m}"**`).join(", ")} — or describe the change and I'll rebuild.`
  );

  // "Why this design" on EVERY build, not just the ones where the wording
  // drove a requirement-based override -- previously this field only
  // appeared when competing topologies existed AND the prompt's wording
  // clearly favored one, so the vast majority of builds shipped with no
  // explanation at all. A build that hit no special-case branch above
  // still has a real, honest answer to "why this design": `structure`
  // (the recipe/topology's own title) and `friendly` (its one-line
  // description) are set by every branch, so this fallback is never a
  // fabrication -- just a lower-detail version of the same explanation
  // the requirement-driven branches already give.
  const finalEngineeringChoice = engineeringChoice
    ? {
        topology: engineeringChoice.tags.topology,
        rationale: engineeringChoice.rationale,
        evidence: hasRequirements(requirements) ? requirements.evidence : [`matched "${structure}" in your wording`],
      }
    : { topology: structure, rationale: friendly, evidence: [] as string[] };

  return {
    name,
    category: familyToCategory(spec.family),
    description: descriptionParts.join(" "),
    parameters,
    dspFunction,
    family: spec.family,
    summary: summaryLines.join("\n"),
    engineeringChoice: finalEngineeringChoice,
  };
}

/* ------------------------------------------------------------------ */
/* Best-of-N: distinct alternate builds of the same request            */
/* ------------------------------------------------------------------ */

/**
 * Up to three genuinely different deterministic takes on one prompt, for the
 * perfecting loop's seed pool and the blind listening test:
 *
 *   [0] the main build (exactly what buildOfflinePlugin ships today)
 *   [1] the other interpretation -- the hybrid composition when the main was
 *       a single recipe, or the strongest single recipe when it was a hybrid
 *   [2] a composed primitive character chain (a different signal path
 *       entirely)
 *
 * All candidates share the main build's name/summary (whichever wins IS the
 * build); duplicates by dspFunction are dropped. Callers gate each candidate
 * themselves -- same contract as buildOfflinePlugin.
 */
export function buildOfflineCandidates(prompt: string, specIn?: AudioPluginSpec | null): OfflineBuild[] {
  const spec = specIn ?? classifyPluginIntent(prompt);
  const main = buildOfflinePlugin(prompt, spec);
  const out: OfflineBuild[] = [main];
  const seen = new Set([main.dspFunction]);

  const push = (dspFunction: string, parameters: PluginParameter[], take: string) => {
    if (seen.has(dspFunction) || out.length >= 4) return;
    seen.add(dspFunction);
    out.push({
      ...main,
      description: `${FAMILY_LABELS[spec.family]}: alternate take — ${take}.`,
      parameters,
      dspFunction,
      // Alternates are runner-ups, not the requirement match — they carry no
      // "why this design" rationale (only candidate[0] does).
      engineeringChoice: undefined,
    });
  };

  // Competing engineering designs: the requirement-ranked runner-up
  // topologies enter the seed pool, so the blind measurement — not the
  // ranking heuristic — gets the final word.
  const requirements = inferRequirements(prompt);
  const rankedTopologies = rankTopologies(spec.family, requirements);
  for (const alt of rankedTopologies.slice(1, 3)) {
    push(alt.body, toLiveParams(alt.parameters), alt.title);
  }

  // Alternate interpretation: hybrid <-> single, whichever the main is NOT.
  const scored = scoreRecipes(prompt, spec);
  if (scored.length >= 2) {
    const composed = composeRecipes(scored[0].recipe, scored[1].recipe);
    push(composed.body, toLiveParams(composed.parameters), composed.title);
    push(scored[0].recipe.body, toLiveParams(scored[0].recipe.parameters), scored[0].recipe.title);
  }

  // A different signal path entirely: the composed primitive chain. When
  // `main` is ITSELF that chain (the no-recipe / novel-request path, e.g.
  // "granular texture mangler"), this push is a guaranteed duplicate that
  // gets silently dropped by `seen` -- leaving that whole family of prompts
  // with exactly ONE candidate, the narrowest possible search space. In that
  // case, widen the pool with genuine STRUCTURAL variants of the SAME chain
  // instead: the stages run in reverse order (a different signal path -- the
  // tone stage sees different harmonic content before vs. after a drive
  // stage), and each stage substituted for a same-role sibling (same job,
  // different character primitive) -- both real structural changes a
  // duplicate check can't manufacture on its own.
  try {
    const graph = buildPrimitiveGraph(prompt);
    push(graph.body, toLiveParams(graph.parameters), `composed chain (${graph.title})`);
    if (graph.body === main.dspFunction) {
      const stages = inferStages(prompt);
      const reordered = reverseChain(stages);
      if (reordered !== stages) {
        const rComposed = composePrimitiveGraph(reordered);
        push(rComposed.body, toLiveParams(rComposed.parameters), `reordered chain (${rComposed.title})`);
      }
      for (let i = 0; i < stages.length && out.length < 4; i++) {
        const swapped = swapSiblingInChain(stages, i, 0);
        if (swapped !== stages) {
          const sComposed = composePrimitiveGraph(swapped);
          push(sComposed.body, toLiveParams(sComposed.parameters), `stage swap (${sComposed.title})`);
        }
      }
    }
  } catch {
    // chain composition is best-effort; the main build always exists
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Relative tweaks ("make it brighter", "more feedback")               */
/* ------------------------------------------------------------------ */

interface TweakRule {
  match: RegExp;
  targets: RegExp;
  /** +1 raises matched params by 25% of range, -1 lowers. */
  dir: 1 | -1;
  note: string;
}

const TWEAK_RULES: TweakRule[] = [
  { match: /\bbrighter\b|more\s+(?:treble|top|air|sparkle)|open\s+it\s+up/i, targets: /tone|cutoff|treble|presence/i, dir: 1, note: "brightened (tone/cutoff up)" },
  { match: /\bdarker\b|\bwarmer\b|less\s+(?:treble|fizz|harsh)|muffle/i, targets: /tone|cutoff|treble|presence/i, dir: -1, note: "darkened (tone/cutoff down)" },
  // Damping is inverted: MORE damping = darker. Kept as separate rules so a
  // reverb (whose only brightness control is damping) responds correctly.
  { match: /\bbrighter\b|more\s+(?:treble|top|air|sparkle)|open\s+it\s+up/i, targets: /^damp/i, dir: -1, note: "brightened (less damping)" },
  { match: /\bdarker\b|\bwarmer\b|less\s+(?:treble|fizz|harsh)|muffle/i, targets: /^damp/i, dir: 1, note: "darkened (more damping)" },
  { match: /\bwetter\b|more\s+(?:mix|wet|effect|verb|reverb|echo)/i, targets: /mix|wet|space/i, dir: 1, note: "wetter (mix up)" },
  { match: /\bdrier\b|\bdryer\b|less\s+(?:mix|wet|effect|verb|reverb|echo)/i, targets: /mix|wet|space/i, dir: -1, note: "drier (mix down)" },
  { match: /more\s+(?:drive|gain|distortion|saturation|dirt)|\bdirtier\b|\bharder\b/i, targets: /drive|gain/i, dir: 1, note: "dirtier (drive up)" },
  { match: /less\s+(?:drive|gain|distortion|saturation|dirt)|\bcleaner\b|\bsofter\b/i, targets: /drive|gain/i, dir: -1, note: "cleaner (drive down)" },
  { match: /\blonger\b|more\s+(?:feedback|repeats|decay|tail|sustain)/i, targets: /feedback|decay|time/i, dir: 1, note: "longer (decay/feedback up)" },
  { match: /\bshorter\b|\btighter\b|less\s+(?:feedback|repeats|decay|tail)/i, targets: /feedback|decay|time/i, dir: -1, note: "tighter (decay/feedback down)" },
  { match: /\bfaster\b/i, targets: /rate|speed/i, dir: 1, note: "faster (rate up)" },
  { match: /\bslower\b/i, targets: /rate|speed/i, dir: -1, note: "slower (rate down)" },
  { match: /\blouder\b|more\s+(?:volume|level|output)/i, targets: /level|makeup|volume|output/i, dir: 1, note: "louder (level up)" },
  { match: /\bquieter\b|less\s+(?:volume|level|output)/i, targets: /level|makeup|volume|output/i, dir: -1, note: "quieter (level down)" },
];

/**
 * Apply relative adjustments to the ACTIVE plugin's parameters. Returns
 * notes describing what changed ([] when the prompt contains no tweak
 * wording or no parameter matched). Both value and defaultValue move so the
 * change survives the quality gate re-measurement.
 */
export function applyRelativeTweaks(prompt: string, parameters: PluginParameter[]): string[] {
  const notes: string[] = [];
  for (const rule of TWEAK_RULES) {
    if (!rule.match.test(prompt)) continue;
    let touched = false;
    for (const p of parameters) {
      if (!rule.targets.test(p.id) && !rule.targets.test(p.name)) continue;
      const step = 0.25 * (p.max - p.min) * rule.dir;
      const v = round3(Math.min(p.max, Math.max(p.min, p.value + step)));
      p.value = v;
      p.defaultValue = v;
      touched = true;
    }
    if (touched) notes.push(rule.note);
  }
  return notes;
}

/** True when the prompt is a relative adjustment of the current plugin
 *  rather than a request for a new one: it contains tweak wording and no
 *  plugin-family keyword (a family keyword means "build me that instead"). */
export function isRelativeTweakRequest(prompt: string): boolean {
  const heuristic = classifyPluginIntent(prompt);
  if (heuristic.family !== "hybrid_other") return false;
  return TWEAK_RULES.some((r) => r.match.test(prompt));
}
