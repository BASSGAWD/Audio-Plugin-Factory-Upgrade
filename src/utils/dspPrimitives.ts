/**
 * DSP primitive library + graph composer — the answer to "no recipe".
 *
 * Whole-plugin recipes cover known families; NOVEL prompts are served by
 * composing small verified primitive stages into an N-stage chain. The unit
 * of reuse is a 1-2 knob stage (drive, modulated delay, pitch grains, ring
 * mod, ...), so ~10 primitives × chains of 2-4 = thousands of distinct,
 * fully-deterministic plugins. Keyword inference picks the stages (an LLM
 * can also propose the same tiny graph spec later — it's a menu choice, not
 * code generation); the composer assembles block-scoped stage bodies exactly
 * like composeRecipes, and the quality gate verifies the result as always.
 */

import { PluginParameter } from "../types";

export interface DspPrimitive {
  id: string;
  title: string;
  /** Prompt keywords that vote for this stage. */
  match: RegExp;
  /** Fixed chain position priority (lower = earlier). */
  order: number;
  parameters: Array<Pick<PluginParameter, "id" | "name" | "min" | "max" | "defaultValue" | "unit">>;
  /** Stage body: reads inputSample, ends in `return <expr>;` (composer rewires both). */
  body: string;
}

export const DSP_PRIMITIVES: DspPrimitive[] = [
  {
    id: "pitch_grain",
    title: "granular pitch shifter",
    match: /granular|grain|texture|shimmer|pitch|alien|crystal|sparkle|space|cosmic|dream/i,
    order: 10,
    parameters: [{ id: "shift", name: "Shift", min: -12, max: 12, defaultValue: 5, unit: "st" }],
    body: `if (!state.init) { state.buf = new Float32Array(4096); state.wp = 0; state.rp1 = 0; state.rp2 = 2048; state.init = true; }
let shift = params.shift !== undefined ? params.shift : 5;
let ratio = Math.pow(2, shift / 12);
state.buf[state.wp] = inputSample;
state.wp = (state.wp + 1) % 4096;
let i0a = Math.floor(state.rp1) % 4096; if (i0a < 0) i0a += 4096;
let sA = state.buf[i0a];
let i0b = Math.floor(state.rp2) % 4096; if (i0b < 0) i0b += 4096;
let sB = state.buf[i0b];
let posA = state.rp1 % 2048; if (posA < 0) posA += 2048;
let posB = state.rp2 % 2048; if (posB < 0) posB += 2048;
let wA = 0.5 - 0.5 * Math.cos((2 * Math.PI * posA) / 2048);
let wB = 0.5 - 0.5 * Math.cos((2 * Math.PI * posB) / 2048);
state.rp1 += ratio; if (state.rp1 >= 4096) state.rp1 -= 4096; if (state.rp1 < 0) state.rp1 += 4096;
state.rp2 += ratio; if (state.rp2 >= 4096) state.rp2 -= 4096; if (state.rp2 < 0) state.rp2 += 4096;
return inputSample * 0.4 + (sA * wA + sB * wB) * 0.8;`,
  },
  {
    id: "ring_mod",
    title: "ring modulator",
    match: /ring|robot|metallic|bell|alien|weird|mangle|inharmonic/i,
    order: 12,
    parameters: [{ id: "ringfreq", name: "Ring Freq", min: 20, max: 2000, defaultValue: 180, unit: "Hz" }],
    body: `if (!state.init) { state.ph = 0; state.sm = 180; state.init = true; }
let ringfreq = params.ringfreq !== undefined ? params.ringfreq : 180;
state.sm += 0.002 * (ringfreq - state.sm);
state.ph += 2 * Math.PI * state.sm / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
return inputSample * (0.45 + 0.55 * Math.sin(state.ph));`,
  },
  {
    id: "bitcrush",
    title: "bit crusher",
    match: /crush|bit|glitch|digital|8.?bit|chip|destroy|mangle|broken|lo.?fi/i,
    order: 14,
    parameters: [{ id: "crush", name: "Crush", min: 2, max: 16, defaultValue: 7, unit: "bits" }],
    body: `if (!state.init) { state.held = 0; state.n = 0; state.init = true; }
let crush = params.crush !== undefined ? params.crush : 7;
let levels = Math.pow(2, crush);
let hold = Math.max(1, Math.round((17 - crush) * 0.9));
state.n++;
if (state.n >= hold) { state.n = 0; state.held = Math.round(inputSample * levels) / levels; }
return state.held;`,
  },
  {
    id: "wavefold",
    title: "wavefolder",
    match: /fold|warp|bend|twist|gnarl|west.?coast|harmonic/i,
    order: 16,
    parameters: [{ id: "fold", name: "Fold", min: 1, max: 8, defaultValue: 3, unit: "x" }],
    body: `if (!state.init) { state.smF = 3; state.init = true; }
let fold = params.fold !== undefined ? params.fold : 3;
state.smF += 0.002 * (fold - state.smF);
let y = Math.sin(inputSample * state.smF * 1.7);
return y / Math.pow(state.smF, 0.4);`,
  },
  {
    id: "drive",
    title: "soft-clip drive",
    match: /drive|warm|dirt|grit|saturat|expensive|thick|fat|analog/i,
    order: 20,
    parameters: [{ id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 8, unit: "dB" }],
    body: `if (!state.init) { state.smD = 8; state.init = true; }
let drive = params.drive !== undefined ? params.drive : 8;
state.smD += 0.002 * (drive - state.smD);
let g = Math.pow(10, state.smD / 20);
return Math.tanh(inputSample * g) / Math.pow(g, 0.65);`,
  },
  {
    id: "comb_resonator",
    title: "comb resonator",
    match: /comb|resonat|metallic|tube\b|pipe|tunnel|robot/i,
    order: 24,
    parameters: [{ id: "combfreq", name: "Resonance Pitch", min: 60, max: 880, defaultValue: 220, unit: "Hz" }],
    body: `if (!state.init) { state.buf = new Float32Array(1024); state.ptr = 0; state.init = true; }
let combfreq = params.combfreq !== undefined ? params.combfreq : 220;
let d = Math.max(2, Math.min(1023, Math.round(44100 / combfreq)));
let read = (state.ptr - d + 1024) % 1024;
let fb = state.buf[read];
state.buf[state.ptr] = inputSample + fb * 0.72;
state.ptr = (state.ptr + 1) % 1024;
return inputSample * 0.5 + fb * 0.6;`,
  },
  {
    id: "wobble_filter",
    title: "wobble filter (LFO-swept lowpass)",
    match: /wobble|wah|sweep|underwater|seasick|liquid|dub\b|drunk|lava/i,
    order: 30,
    parameters: [{ id: "wrate", name: "Wobble Rate", min: 0.1, max: 6, defaultValue: 0.9, unit: "Hz" }],
    body: `if (!state.init) { state.low = 0; state.band = 0; state.ph = 0; state.init = true; }
let wrate = params.wrate !== undefined ? params.wrate : 0.9;
state.ph += 2 * Math.PI * wrate / 44100;
if (state.ph > 2 * Math.PI) state.ph -= 2 * Math.PI;
let cutoff = 900 + Math.sin(state.ph) * 750;
let f = 2 * Math.sin(Math.PI * Math.min(0.2, cutoff / 44100));
state.low += f * state.band;
let high = inputSample - state.low - 0.7 * state.band;
state.band += f * high;
return state.low * 1.25;`,
  },
  {
    id: "tone_lp",
    title: "tone lowpass",
    match: /dark|muffl|soft|underwater|deep|dream|smooth|warm/i,
    order: 34,
    parameters: [{ id: "tone", name: "Tone", min: 400, max: 12000, defaultValue: 4200, unit: "Hz" }],
    body: `if (!state.init) { state.lp = 0; state.init = true; }
let tone = params.tone !== undefined ? params.tone : 4200;
let a = 1 - Math.exp(-2 * Math.PI * tone / 44100);
state.lp += a * (inputSample - state.lp);
return state.lp;`,
  },
  {
    id: "chopper",
    title: "rhythmic chopper",
    match: /chop|stutter|gate\b|rhythm|pulse|helicopter|strobe/i,
    order: 40,
    parameters: [{ id: "chop", name: "Chop Rate", min: 0.5, max: 14, defaultValue: 5, unit: "Hz" }],
    body: `if (!state.init) { state.ph = 0; state.init = true; }
let chop = params.chop !== undefined ? params.chop : 5;
state.ph += chop / 44100;
if (state.ph > 1) state.ph -= 1;
let g = state.ph < 0.5 ? 1 : 0.12;
if (!state.g) state.g = g;
state.g += 0.008 * (g - state.g);
return inputSample * state.g;`,
  },
  {
    id: "echo",
    title: "damped echo",
    match: /echo|space|cosmic|trail|dream|cave|distant|repeat|bounce/i,
    order: 50,
    parameters: [{ id: "time", name: "Echo Time", min: 60, max: 700, defaultValue: 240, unit: "ms" }, { id: "feedback", name: "Feedback", min: 0, max: 0.9, defaultValue: 0.45, unit: "ratio" }],
    body: `if (!state.init) { state.buf = new Float32Array(44100); state.ptr = 0; state.dm = 0; state.init = true; }
let time = params.time !== undefined ? params.time : 240;
let feedback = Math.min(0.9, params.feedback !== undefined ? params.feedback : 0.45);
let d = Math.max(1, Math.min(44099, Math.floor(time * 44.1)));
let read = (state.ptr - d + 44100) % 44100;
let wet = state.buf[read];
state.dm += 0.4 * (wet - state.dm);
state.buf[state.ptr] = inputSample + state.dm * feedback;
state.ptr = (state.ptr + 1) % 44100;
return inputSample * 0.7 + wet * 0.65;`,
  },
];

/** Default chain when nothing votes: still characterful, never a shrug. */
const DEFAULT_STAGE_IDS = ["drive", "wobble_filter", "echo"];

/** Pick 2-4 stages by keyword votes, chain-ordered. Deterministic. */
export function inferStages(prompt: string): DspPrimitive[] {
  const voted = DSP_PRIMITIVES.filter((p) => p.match.test(prompt));
  const chosen = (voted.length >= 2 ? voted : DSP_PRIMITIVES.filter((p) => DEFAULT_STAGE_IDS.includes(p.id)))
    .sort((a, b) => a.order - b.order)
    .slice(0, 4);
  return chosen;
}

export interface ComposedGraph {
  title: string;
  stageIds: string[];
  parameters: Array<Pick<PluginParameter, "id" | "name" | "min" | "max" | "defaultValue" | "unit">>;
  body: string;
}

/**
 * Assemble N stages into one dspFunction: each stage runs in its own block
 * scope with namespaced state; stage i consumes stage i-1's output; a global
 * Mix blends the chain against the dry input. Same invariants as
 * composeRecipes (single trailing return per stage body).
 */
export function composePrimitiveGraph(stages: DspPrimitive[]): ComposedGraph {
  const params: ComposedGraph["parameters"] = [];
  const seen = new Set<string>();
  const parts: string[] = [`let __x0 = inputSample;`];

  stages.forEach((stage, i) => {
    let body = stage.body.replace(/\bstate\./g, `state.s${i}_`).replace(/\binputSample\b/g, `__x${i}`);
    for (const p of stage.parameters) {
      let id = p.id;
      if (seen.has(id)) {
        id = `${p.id}_${i + 1}`;
        body = body.replace(new RegExp(`\\bparams\\.${p.id}\\b`, "g"), `params.${id}`);
        params.push({ ...p, id, name: `${p.name} ${i + 1}` });
      } else {
        params.push({ ...p });
      }
      seen.add(id);
    }
    const idx = body.lastIndexOf("return ");
    const expr = body.slice(idx + "return ".length).replace(/;\s*$/, "");
    body = `${body.slice(0, idx)}__x${i + 1} = ${expr};`;
    parts.push(`let __x${i + 1} = 0;\n// --- STAGE ${i + 1}: ${stage.title} ---\n{\n${body}\n}`);
  });

  params.push({ id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.85, unit: "ratio" });
  parts.push(`let mix = params.mix !== undefined ? params.mix : 0.85;
return Math.tanh(inputSample * (1 - mix) + __x${stages.length} * mix);`);

  return {
    title: stages.map((s) => s.title).join(" → "),
    stageIds: stages.map((s) => s.id),
    parameters: params,
    body: parts.join("\n\n"),
  };
}

/** One-call entry: infer stages from the prompt and compose the graph. */
export function buildPrimitiveGraph(prompt: string): ComposedGraph {
  return composePrimitiveGraph(inferStages(prompt));
}
