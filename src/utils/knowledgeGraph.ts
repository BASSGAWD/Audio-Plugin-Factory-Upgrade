/**
 * The knowledge graph: structured metadata OVER the verified banks.
 *
 * The recipe/primitive/topology banks hold verified code; this module holds
 * what an engineer KNOWS ABOUT that code — which concept each module
 * implements, what character and material it suits, what it costs in latency
 * and CPU, and which concepts relate to which. The planner traverses these
 * tags instead of matching keywords, which is how "transparent mastering
 * compressor" resolves to the lookahead soft-knee design instead of whatever
 * regex fired first.
 *
 * Two consumers today:
 *   1. rankTopologies() — requirements-driven topology selection for the
 *      offline builder (deterministic; the default wins on neutral prompts).
 *   2. The knowledge auditor (knowledgeAudit.ts) — coverage vs. the master
 *      curriculum, redundancy, trust tiers, and the gap report.
 *
 * Plus one write path: logPromptGap() records prompts the banks couldn't
 * confidently serve, so the next primitives get added where real demand is,
 * not where a quota says.
 */

import { DSP_RECIPES } from "./dspRecipes";
import { DSP_PRIMITIVES } from "./dspPrimitives";
import { DSP_TOPOLOGIES, DspTopology, topologiesForFamily } from "./dspTopologies";
import { PluginFamily } from "./pluginSpec";
import { BuildRequirements, CharacterGoal, SourceMaterial, hasRequirements } from "./requirements";

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

export type NodeKind = "recipe" | "primitive" | "topology";

/** Trust tiers, highest first. Everything executable in the banks is
 *  gate-verified (tier 1); learned localStorage material is provisional. */
export type TrustTier = 1 | 2 | 3 | 4 | 5;

export interface KnowledgeNode {
  id: string;
  kind: NodeKind;
  /** The engineering concept this module implements, e.g. "compressor". */
  concept: string;
  /** Concepts this one connects to — the graph's edges. */
  related: string[];
  /** 1 = gate-verified shipped code. */
  trust: TrustTier;
}

const RECIPE_CONCEPTS: Record<string, { concept: string; related: string[] }> = {
  reverb: { concept: "reverb", related: ["comb-filter", "allpass", "damping", "early-reflections", "feedback-delay-network"] },
  delay: { concept: "delay", related: ["feedback-loop", "damping", "dry-wet-mix", "ring-buffer"] },
  modulation: { concept: "chorus", related: ["lfo", "fractional-delay", "interpolation", "vibrato"] },
  tremolo: { concept: "tremolo", related: ["lfo", "amplitude-modulation", "gain-modulation"] },
  phaser: { concept: "phaser", related: ["lfo", "allpass", "notch-filter", "phase-cancellation", "feedback-loop"] },
  // No test collision (same check already done for wavetable/fm-synthesis):
  // researchEngineTest.ts and blockProcessingTest.ts both exercise
  // "spectral-processing" via the research-approval path but never assert
  // it's a gap BEFORE research, so closing knowledgeAudit.ts's real
  // satisfiedBy: ["fft", "spectral-processing"] gap here is correct, not a
  // collision risk.
  spectral_gate: { concept: "spectral-processing", related: ["fft", "stft", "overlap-add", "frequency-domain"] },
  dynamics: { concept: "compressor", related: ["envelope-detector", "gain-computer", "attack-release", "makeup-gain", "threshold", "ratio"] },
  eq: { concept: "equalizer", related: ["crossover", "band-splitting", "shelving", "parametric-mid"] },
  filter: { concept: "filter", related: ["state-variable-filter", "resonance", "cutoff-smoothing"] },
  distortion: { concept: "distortion", related: ["waveshaping", "oversampling", "gain-compensation", "tone-filter", "harmonics"] },
  sampler: { concept: "drum-synth", related: ["voice-allocation", "envelope-generator", "pad-triggering"] },
  pitch: { concept: "pitch-correction", related: ["autocorrelation", "pitch-detection", "scale-snapping", "formant-preservation", "resynthesis"] },
  synth: { concept: "synthesizer", related: ["oscillator", "detune", "state-variable-filter", "envelope-generator"] },
};

const PRIMITIVE_CONCEPTS: Record<string, { concept: string; related: string[] }> = {
  pitch_grain: { concept: "granular-pitch-shift", related: ["pitch-correction", "crossfade", "delay"] },
  ring_mod: { concept: "ring-modulation", related: ["oscillator", "sidebands", "inharmonicity"] },
  bitcrush: { concept: "bit-reduction", related: ["quantization", "sample-rate-reduction", "aliasing"] },
  wavefold: { concept: "wavefolding", related: ["waveshaping", "harmonics", "distortion"] },
  drive: { concept: "soft-clipping", related: ["waveshaping", "distortion", "gain-compensation"] },
  comb_resonator: { concept: "comb-filter", related: ["reverb", "resonance", "feedback-loop"] },
  wobble_filter: { concept: "lfo-filter-sweep", related: ["lfo", "filter", "state-variable-filter"] },
  tone_lp: { concept: "tone-filter", related: ["filter", "damping"] },
  chopper: { concept: "rhythmic-gating", related: ["lfo", "tremolo", "amplitude-modulation"] },
  echo: { concept: "delay", related: ["feedback-loop", "damping", "ring-buffer"] },
};

const TOPOLOGY_CONCEPTS: Record<string, { concept: string; related: string[] }> = {
  comp_ff_rms: { concept: "compressor", related: ["envelope-detector", "gain-computer", "feed-forward-topology"] },
  comp_peak_punch: { concept: "compressor", related: ["peak-detection", "attack-release", "transients", "feed-forward-topology"] },
  comp_feedback_glue: { concept: "compressor", related: ["feedback-topology", "waveshaping", "program-dependence"] },
  comp_lookahead_master: { concept: "compressor", related: ["lookahead", "soft-knee", "mastering", "gain-computer"] },
  comp_opto: { concept: "compressor", related: ["opto-model", "program-dependence", "photocell"] },
  comp_fet_1176: { concept: "compressor", related: ["fet-model", "peak-detection", "transients"] },
  comp_multiband_2band: { concept: "compressor", related: ["multiband-compression", "crossover", "band-splitting"] },
  comp_deesser: { concept: "compressor", related: ["sidechain-filter", "de-essing", "sibilance"] },
  comp_parallel: { concept: "compressor", related: ["parallel-topology", "wet-dry-blend", "upward-density", "new-york-style"] },
  // No test collision (same check already done for wavetable/fm-synthesis/
  // spectral_gate above): stereoEngineTest.ts approves mid-side research
  // before ever checking coverage, never checks it's a gap beforehand, so
  // this correctly closes knowledgeAudit.ts's real
  // satisfiedBy: ["stereo-linking", "mid-side"] gap.
  comp_midside: { concept: "compressor", related: ["mid-side", "stereo-linking", "width-control"] },
  reverb_schroeder: { concept: "reverb", related: ["comb-filter", "allpass", "damping"] },
  reverb_fdn_plate: { concept: "reverb", related: ["feedback-delay-network", "hadamard-matrix", "plate-reverb", "damping"] },
  reverb_room_er: { concept: "reverb", related: ["early-reflections", "room-simulation", "damping"] },
  delay_tape: { concept: "delay", related: ["feedback-loop", "damping", "tape-emulation"] },
  delay_digital: { concept: "delay", related: ["feedback-loop", "ring-buffer", "transparency"] },
  delay_pingpong: { concept: "delay", related: ["ping-pong", "cross-feed", "stereo-spread"] },
  dist_softclip: { concept: "distortion", related: ["waveshaping", "oversampling", "tone-filter"] },
  dist_tube_asym: { concept: "distortion", related: ["asymmetric-waveshaping", "even-harmonics", "tube-emulation", "oversampling"] },
  dist_fuzz: { concept: "distortion", related: ["softsign-curve", "fuzz", "oversampling", "tone-filter"] },
  dist_dynamic_sat: { concept: "distortion", related: ["dynamic-saturation", "envelope-follower", "level-dependent-drive"] },
  synth_pad: { concept: "synthesizer", related: ["oscillator", "detune", "state-variable-filter", "envelope-generator"] },
  // No test collision to guard against here (unlike comp_parallel) --
  // researchEngineTest.ts never uses "wavetable" or "fm-synthesis" as a
  // gap-before-research worked example, so these correctly close the real
  // curriculum gaps (knowledgeAudit.ts's satisfiedBy: ["wavetable"] /
  // ["fm-synthesis"]) the moment the topology ships, same as opto-model/
  // fet-model/multiband-compression/sidechain-filter already do.
  synth_wavetable: { concept: "synthesizer", related: ["wavetable", "band-limiting", "table-morphing", "phase-accumulator"] },
  synth_fm: { concept: "synthesizer", related: ["fm-synthesis", "phase-modulation", "operator-ratio", "sidebands"] },
  eq_3band: { concept: "equalizer", related: ["crossover", "band-splitting", "shelving", "parametric-mid"] },
  eq_biquad_bell: { concept: "equalizer", related: ["biquad", "rbj-cookbook", "peaking-filter"] },
};

export const KNOWLEDGE_GRAPH: KnowledgeNode[] = [
  ...DSP_RECIPES.map((r) => ({
    id: r.id,
    kind: "recipe" as NodeKind,
    concept: RECIPE_CONCEPTS[r.id]?.concept ?? r.id,
    related: RECIPE_CONCEPTS[r.id]?.related ?? [],
    trust: 1 as TrustTier,
  })),
  ...DSP_PRIMITIVES.map((p) => ({
    id: p.id,
    kind: "primitive" as NodeKind,
    concept: PRIMITIVE_CONCEPTS[p.id]?.concept ?? p.id,
    related: PRIMITIVE_CONCEPTS[p.id]?.related ?? [],
    trust: 1 as TrustTier,
  })),
  ...DSP_TOPOLOGIES.map((t) => ({
    id: t.id,
    kind: "topology" as NodeKind,
    concept: TOPOLOGY_CONCEPTS[t.id]?.concept ?? t.id,
    related: TOPOLOGY_CONCEPTS[t.id]?.related ?? [],
    trust: 1 as TrustTier,
  })),
];

export function nodesForConcept(concept: string): KnowledgeNode[] {
  return KNOWLEDGE_GRAPH.filter((n) => n.concept === concept || n.related.includes(concept));
}

/**
 * Research-queue storage key. The queue is WRITTEN by researchEngine.ts;
 * the graph only READS approved concepts from it (defined here, not there,
 * so the engine can import the graph without a dependency cycle).
 */
export const RESEARCH_QUEUE_KEY = "orange_juce_research_queue_v1";

/** Concepts added by human-APPROVED research (see researchEngine.ts).
 *  Pending and rejected items contribute nothing — approval is the boundary. */
export function approvedResearchConcepts(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const queue: Array<{ status?: string; concept?: string }> = JSON.parse(localStorage.getItem(RESEARCH_QUEUE_KEY) || "[]");
    return queue.filter((i) => i.status === "approved" && typeof i.concept === "string").map((i) => i.concept as string);
  } catch {
    return [];
  }
}

/** Every distinct concept the graph can currently reach (nodes + edges +
 *  approved research). */
export function knownConcepts(): string[] {
  const set = new Set<string>();
  for (const n of KNOWLEDGE_GRAPH) {
    set.add(n.concept);
    n.related.forEach((r) => set.add(r));
  }
  approvedResearchConcepts().forEach((c) => set.add(c));
  return [...set].sort();
}

/* ------------------------------------------------------------------ */
/* Requirements-driven topology ranking                                */
/* ------------------------------------------------------------------ */

/**
 * Rank a family's topology variants against the inferred requirements.
 * Deterministic scoring:
 *   +3 source match, +2 character match, -100 lookahead on a live budget
 *   (hard exclusion), +0.5 default tiebreak.
 * With NO requirements the default stays first, so neutral prompts build
 * exactly the golden recipe they always built.
 */
export function rankTopologies(family: PluginFamily, req: BuildRequirements): DspTopology[] {
  const variants = topologiesForFamily(family);
  if (variants.length === 0) return [];
  if (!hasRequirements(req)) {
    return [...variants].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
  }
  const score = (t: DspTopology): number => {
    let s = t.isDefault ? 0.5 : 0;
    if (req.latency === "live" && t.tags.latency === "lookahead") return -100;
    if (req.source !== "any" && (t.tags.sources.includes(req.source) || t.tags.sources.includes("any" as SourceMaterial))) {
      s += t.tags.sources.includes(req.source) ? 3 : 1;
    }
    if (req.character !== "any" && t.tags.character.includes(req.character as CharacterGoal)) s += 2;
    if (req.latency === "studio" && t.tags.latency === "lookahead") s += 1;
    return s;
  };
  return [...variants]
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > -100)
    .sort((a, b) => b.s - a.s || Number(!!b.t.isDefault) - Number(!!a.t.isDefault))
    .map((x) => x.t);
}

/* ------------------------------------------------------------------ */
/* Demand-driven growth: the prompt gap log                            */
/* ------------------------------------------------------------------ */

const GAPS_KEY = "orange_juce_prompt_gaps_v1";
const GAPS_MAX = 50;

export interface PromptGap {
  prompt: string;
  family: string;
  /** Why it's a gap: which part of the banks came up short. */
  reason: string;
  at: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Record a prompt the banks couldn't confidently serve. Deduped by prompt. */
export function logPromptGap(prompt: string, family: string, reason: string): void {
  const store = storage();
  if (!store) return;
  try {
    const gaps: PromptGap[] = JSON.parse(store.getItem(GAPS_KEY) || "[]");
    const trimmed = prompt.trim().toLowerCase().slice(0, 160);
    if (gaps.some((g) => g.prompt === trimmed)) return;
    gaps.push({ prompt: trimmed, family, reason, at: new Date().toISOString() });
    store.setItem(GAPS_KEY, JSON.stringify(gaps.slice(-GAPS_MAX)));
  } catch (err) {
    console.warn("[knowledgeGraph] could not persist prompt gap:", err);
  }
}

export function readPromptGaps(): PromptGap[] {
  const store = storage();
  if (!store) return [];
  try {
    return JSON.parse(store.getItem(GAPS_KEY) || "[]");
  } catch {
    return [];
  }
}
