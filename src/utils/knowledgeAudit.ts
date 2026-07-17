/**
 * Milestone 1 — the Knowledge Auditor.
 *
 * Grades the factory's knowledge the way a university accredits a
 * curriculum, on four dimensions:
 *
 *   COVERAGE  — is each concept on the master curriculum implemented?
 *   AUTHORITY — what trust tier does each knowledge store sit at?
 *   BALANCE   — is any concept over-represented while neighbors are empty?
 *   ABILITY   — can the pipeline actually BUILD the benchmark projects,
 *               measured by the same quality gate everything ships through?
 *
 * Everything here is deterministic and honest: coverage is computed from the
 * knowledge graph's real nodes (not aspiration), and ability is measured by
 * actually running builds through the gate — never claimed. Missing items
 * are the deliverable, not an embarrassment: they are the shopping list for
 * the next bank additions.
 */

import { AudioPlugin } from "../types";
import { KNOWLEDGE_GRAPH, KnowledgeNode, knownConcepts, rankTopologies } from "./knowledgeGraph";
import { inferRequirements } from "./requirements";
import { buildOfflineCandidates } from "./offlineBuilder";
import { runQualityGate } from "./qualityGate";
import { classifyPluginIntent, familyToCategory } from "./pluginSpec";

/* ------------------------------------------------------------------ */
/* The master curriculum                                               */
/* ------------------------------------------------------------------ */

export interface CurriculumItem {
  area: string;
  concept: string;
  /** Concepts in the graph (node or edge) that satisfy this item. */
  satisfiedBy: string[];
}

/**
 * What a serious plugin platform should know, per area. An item counts as
 * covered only when the knowledge graph actually reaches one of its
 * satisfying concepts. Items with NO match are the gap report.
 */
export const CURRICULUM: CurriculumItem[] = [
  // -- Compressors ---------------------------------------------------
  { area: "Compressors", concept: "Envelope detection (attack/release)", satisfiedBy: ["envelope-detector", "attack-release"] },
  { area: "Compressors", concept: "Peak detection", satisfiedBy: ["peak-detection"] },
  { area: "Compressors", concept: "Feed-forward topology", satisfiedBy: ["feed-forward-topology"] },
  { area: "Compressors", concept: "Feedback topology", satisfiedBy: ["feedback-topology"] },
  { area: "Compressors", concept: "Soft knee", satisfiedBy: ["soft-knee"] },
  { area: "Compressors", concept: "Lookahead", satisfiedBy: ["lookahead"] },
  { area: "Compressors", concept: "Gain computer (dB domain)", satisfiedBy: ["gain-computer"] },
  { area: "Compressors", concept: "Program dependence", satisfiedBy: ["program-dependence"] },
  { area: "Compressors", concept: "Parallel (NY) compression", satisfiedBy: ["parallel-compression"] },
  { area: "Compressors", concept: "Multiband compression", satisfiedBy: ["multiband-compression"] },
  { area: "Compressors", concept: "Sidechain input (external key)", satisfiedBy: ["sidechain-input"] },
  { area: "Compressors", concept: "Internal sidechain filtering (de-esser)", satisfiedBy: ["sidechain-filter"] },
  { area: "Compressors", concept: "Opto/VCA/FET circuit models", satisfiedBy: ["opto-model", "vca-model", "fet-model"] },
  { area: "Compressors", concept: "Stereo linking / mid-side", satisfiedBy: ["stereo-linking", "mid-side"] },
  // -- Reverbs -------------------------------------------------------
  { area: "Reverbs", concept: "Schroeder (combs + allpasses)", satisfiedBy: ["comb-filter", "allpass"] },
  { area: "Reverbs", concept: "Feedback delay network", satisfiedBy: ["feedback-delay-network"] },
  { area: "Reverbs", concept: "Plate character", satisfiedBy: ["plate-reverb"] },
  { area: "Reverbs", concept: "Early reflections / room", satisfiedBy: ["early-reflections", "room-simulation"] },
  { area: "Reverbs", concept: "In-loop damping", satisfiedBy: ["damping"] },
  { area: "Reverbs", concept: "Shimmer (pitched tail)", satisfiedBy: ["granular-pitch-shift"] },
  { area: "Reverbs", concept: "Convolution / impulse responses", satisfiedBy: ["convolution"] },
  // -- Delays --------------------------------------------------------
  { area: "Delays", concept: "Feedback loop with damping", satisfiedBy: ["feedback-loop", "damping"] },
  { area: "Delays", concept: "Pristine digital regeneration", satisfiedBy: ["transparency"] },
  { area: "Delays", concept: "Fractional/interpolated reads", satisfiedBy: ["fractional-delay", "interpolation"] },
  { area: "Delays", concept: "Tape emulation", satisfiedBy: ["tape-emulation"] },
  { area: "Delays", concept: "Multi-tap patterns", satisfiedBy: ["multi-tap"] },
  { area: "Delays", concept: "Ping-pong / stereo spread", satisfiedBy: ["ping-pong"] },
  // -- Distortion ----------------------------------------------------
  { area: "Distortion", concept: "Soft clipping with compensation", satisfiedBy: ["soft-clipping", "gain-compensation"] },
  { area: "Distortion", concept: "Asymmetric / even harmonics", satisfiedBy: ["asymmetric-waveshaping", "even-harmonics"] },
  { area: "Distortion", concept: "Hard fuzz curves", satisfiedBy: ["softsign-curve", "fuzz"] },
  { area: "Distortion", concept: "Wavefolding", satisfiedBy: ["wavefolding"] },
  { area: "Distortion", concept: "Bit/rate reduction (lo-fi)", satisfiedBy: ["bit-reduction", "quantization"] },
  { area: "Distortion", concept: "Anti-aliased nonlinearity (oversampling)", satisfiedBy: ["oversampling"] },
  { area: "Distortion", concept: "Dynamic (level-tracking) saturation", satisfiedBy: ["dynamic-saturation"] },
  // -- Filters & EQ ----------------------------------------------------
  { area: "Filters & EQ", concept: "State-variable filter", satisfiedBy: ["state-variable-filter"] },
  { area: "Filters & EQ", concept: "Resonance control (stable)", satisfiedBy: ["resonance"] },
  { area: "Filters & EQ", concept: "Band splitting / crossover", satisfiedBy: ["crossover", "band-splitting"] },
  { area: "Filters & EQ", concept: "Parametric mid sweep", satisfiedBy: ["parametric-mid"] },
  { area: "Filters & EQ", concept: "Coefficient smoothing (no zipper)", satisfiedBy: ["cutoff-smoothing"] },
  { area: "Filters & EQ", concept: "Biquad / RBJ cookbook forms", satisfiedBy: ["biquad"] },
  // -- Modulation ------------------------------------------------------
  { area: "Modulation", concept: "LFO-modulated delay (chorus)", satisfiedBy: ["lfo", "fractional-delay"] },
  { area: "Modulation", concept: "Tremolo / rhythmic gating", satisfiedBy: ["tremolo", "rhythmic-gating"] },
  { area: "Modulation", concept: "Ring modulation", satisfiedBy: ["ring-modulation"] },
  { area: "Modulation", concept: "Phaser (allpass cascade)", satisfiedBy: ["phaser"] },
  // -- Pitch & Time ----------------------------------------------------
  { area: "Pitch & Time", concept: "Pitch detection (autocorrelation)", satisfiedBy: ["autocorrelation", "pitch-detection"] },
  { area: "Pitch & Time", concept: "Scale-snapping correction", satisfiedBy: ["scale-snapping"] },
  { area: "Pitch & Time", concept: "Formant preservation", satisfiedBy: ["formant-preservation"] },
  { area: "Pitch & Time", concept: "Granular pitch shifting", satisfiedBy: ["granular-pitch-shift"] },
  { area: "Pitch & Time", concept: "Spectral (FFT) processing", satisfiedBy: ["fft", "spectral-processing"] },
  // -- Synthesis -------------------------------------------------------
  { area: "Synthesis", concept: "Oscillators with detune", satisfiedBy: ["oscillator", "detune"] },
  { area: "Synthesis", concept: "Envelope generators", satisfiedBy: ["envelope-generator"] },
  { area: "Synthesis", concept: "Voice allocation (polyphony)", satisfiedBy: ["voice-allocation"] },
  { area: "Synthesis", concept: "Wavetable synthesis", satisfiedBy: ["wavetable"] },
  { area: "Synthesis", concept: "FM synthesis", satisfiedBy: ["fm-synthesis"] },
  // -- Engineering hygiene (implemented by the quality gate) -----------
  { area: "Engineering hygiene", concept: "Gain staging (measured + corrected)", satisfiedBy: ["gate:gain-staging"] },
  { area: "Engineering hygiene", concept: "DC offset protection", satisfiedBy: ["gate:dc-blocking"] },
  { area: "Engineering hygiene", concept: "Aliasing measurement", satisfiedBy: ["gate:aliasing-measurement"] },
  { area: "Engineering hygiene", concept: "Per-control audibility proof", satisfiedBy: ["gate:parameter-audibility"] },
  { area: "Engineering hygiene", concept: "Semantic control honesty", satisfiedBy: ["gate:semantic-honesty"] },
  { area: "Engineering hygiene", concept: "Real-time safety audit", satisfiedBy: ["gate:realtime-safety"] },
  { area: "Engineering hygiene", concept: "Parameter range auto-calibration", satisfiedBy: ["gate:range-calibration"] },
  { area: "Engineering hygiene", concept: "True-peak / loudness normalization", satisfiedBy: ["gate:true-peak"] },
];

/** Concepts the quality gate itself implements (verified by its test suite).
 *  These satisfy "Engineering hygiene" items the same way graph nodes
 *  satisfy DSP items. */
const GATE_CAPABILITIES = new Set([
  "gate:gain-staging",
  "gate:dc-blocking",
  "gate:aliasing-measurement",
  "gate:parameter-audibility",
  "gate:semantic-honesty",
  "gate:realtime-safety",
  "gate:range-calibration",
  // measureTruePeak(): 4x Catmull-Rom inter-sample peak, reported per build
  "gate:true-peak",
]);

/* ------------------------------------------------------------------ */
/* Benchmark projects (demonstrated ability)                           */
/* ------------------------------------------------------------------ */

export interface BenchmarkSpec {
  name: string;
  prompt: string;
}

/** The benchmark bank: every entry is BUILT through the real pipeline and
 *  scored by the real gate when the audit runs. */
export const BENCHMARKS: BenchmarkSpec[] = [
  { name: "Transparent mastering compressor", prompt: "a transparent compressor for the master bus" },
  { name: "Drum smash compressor", prompt: "an aggressive punchy drum compressor" },
  { name: "Vintage vocal compressor", prompt: "a warm vintage compressor for vocals" },
  { name: "Live vocal compressor", prompt: "a compressor for live vocals on stage" },
  { name: "Plate vocal reverb", prompt: "a plate reverb for vocals" },
  { name: "Tight drum room", prompt: "a tight room reverb for drums" },
  { name: "Shimmer reverb", prompt: "a dreamy shimmer reverb" },
  { name: "Tape echo", prompt: "a warm tape echo with wobble" },
  { name: "Pristine digital delay", prompt: "a clean transparent digital delay" },
  { name: "Tube saturation", prompt: "warm tube saturation for bass" },
  { name: "Hard fuzz", prompt: "a brutal fuzz pedal" },
  { name: "Resonant filter sweep", prompt: "a resonant lowpass filter" },
  { name: "3-band EQ", prompt: "a 3 band eq with sweepable mids" },
  { name: "Chorus", prompt: "a lush chorus" },
  { name: "Autotune", prompt: "autotune my vocals to C major" },
  { name: "Drum pads", prompt: "an 808 drum pad sampler" },
  { name: "Synth pad", prompt: "a dreamy synth pad generator" },
  { name: "Novel hybrid", prompt: "an underwater dream machine" },
];

/* ------------------------------------------------------------------ */
/* Audit result types                                                  */
/* ------------------------------------------------------------------ */

export interface AreaCoverage {
  area: string;
  covered: number;
  total: number;
  pct: number;
  missing: string[];
}

export interface ConceptBalance {
  concept: string;
  modules: string[];
}

export interface BenchmarkResult {
  name: string;
  prompt: string;
  family: string;
  minScore: number;
  pass: boolean;
  candidatesTried: number;
  /** Topology the engineering layer chose (when the family has choices). */
  chosenTopology: string | null;
  /** Static engineering-quality score of the winning build's code (0-100). */
  codeHealth: number;
}

export interface KnowledgeAudit {
  generatedAt: string;
  inventory: { recipes: number; primitives: number; topologies: number; totalNodes: number; concepts: number };
  nodes: KnowledgeNode[];
  coverage: AreaCoverage[];
  overallCoveragePct: number;
  balance: ConceptBalance[];
  trustTiers: Array<{ tier: number; label: string; contents: string; validation: string }>;
  benchmarks: BenchmarkResult[];
  benchmarkPassRate: number;
}

/* ------------------------------------------------------------------ */
/* The auditor                                                         */
/* ------------------------------------------------------------------ */

function computeCoverage(): { coverage: AreaCoverage[]; overallPct: number } {
  const reachable = new Set([...knownConcepts(), ...GATE_CAPABILITIES]);
  const byArea = new Map<string, { covered: number; total: number; missing: string[] }>();
  for (const item of CURRICULUM) {
    const entry = byArea.get(item.area) || { covered: 0, total: 0, missing: [] };
    entry.total += 1;
    if (item.satisfiedBy.some((c) => reachable.has(c))) entry.covered += 1;
    else entry.missing.push(item.concept);
    byArea.set(item.area, entry);
  }
  const coverage: AreaCoverage[] = [...byArea.entries()].map(([area, e]) => ({
    area,
    covered: e.covered,
    total: e.total,
    pct: Math.round((e.covered / e.total) * 100),
    missing: e.missing,
  }));
  const total = CURRICULUM.length;
  const covered = coverage.reduce((s, a) => s + a.covered, 0);
  return { coverage, overallPct: Math.round((covered / total) * 100) };
}

function computeBalance(): ConceptBalance[] {
  const byConcept = new Map<string, string[]>();
  for (const n of KNOWLEDGE_GRAPH) {
    const list = byConcept.get(n.concept) || [];
    list.push(`${n.id} (${n.kind})`);
    byConcept.set(n.concept, list);
  }
  return [...byConcept.entries()]
    .map(([concept, modules]) => ({ concept, modules }))
    .sort((a, b) => b.modules.length - a.modules.length);
}

/** Build every benchmark through the real pipeline and gate it. Slow-ish
 *  (a few seconds total) — intended for the audit script and tests, not the
 *  UI thread. */
export function runBenchmarks(benchmarks: BenchmarkSpec[] = BENCHMARKS): BenchmarkResult[] {
  return benchmarks.map((b) => {
    const spec = classifyPluginIntent(b.prompt);
    const requirements = inferRequirements(b.prompt);
    const ranked = rankTopologies(spec.family, requirements);
    const candidates = buildOfflineCandidates(b.prompt, spec);
    let best = -1;
    let bestCodeHealth = 0;
    for (const c of candidates) {
      const plugin: AudioPlugin = {
        id: "audit", name: c.name, category: c.category, description: c.description,
        parameters: c.parameters, dspFunction: c.dspFunction,
        faustCode: "", cppJuceCode: "", createdAt: "",
      };
      try {
        const gated = runQualityGate(plugin, { family: c.family, prompt: b.prompt });
        const min = Math.min(gated.scores.looks, gated.scores.performance, gated.scores.latency, gated.scores.musicality);
        if (min > best) {
          best = min;
          bestCodeHealth = gated.report.codeHealth ?? 0;
        }
      } catch {
        // a throwing candidate scores nothing; others still compete
      }
    }
    return {
      name: b.name,
      prompt: b.prompt,
      family: spec.family,
      minScore: best,
      pass: best >= 97,
      candidatesTried: candidates.length,
      chosenTopology: ranked.length > 0 ? ranked[0].id : null,
      codeHealth: bestCodeHealth,
    };
  });
}

export function runKnowledgeAudit(opts: { withBenchmarks?: boolean } = {}): KnowledgeAudit {
  const { coverage, overallPct } = computeCoverage();
  const benchmarks = opts.withBenchmarks === false ? [] : runBenchmarks();
  const passCount = benchmarks.filter((b) => b.pass).length;
  return {
    generatedAt: new Date().toISOString(),
    inventory: {
      recipes: KNOWLEDGE_GRAPH.filter((n) => n.kind === "recipe").length,
      primitives: KNOWLEDGE_GRAPH.filter((n) => n.kind === "primitive").length,
      topologies: KNOWLEDGE_GRAPH.filter((n) => n.kind === "topology").length,
      totalNodes: KNOWLEDGE_GRAPH.length,
      concepts: knownConcepts().length,
    },
    nodes: KNOWLEDGE_GRAPH,
    coverage,
    overallCoveragePct: overallPct,
    balance: computeBalance(),
    trustTiers: [
      { tier: 1, label: "Gate-verified shipped code", contents: "golden recipes, primitives, topology variants", validation: "every module must score >= 97 in the regression suite before it can ship" },
      { tier: 2, label: "Gate infrastructure", contents: "signal bank, measurements, semantic checks", validation: "covered by its own test suites (hardening, knobMath, signalBank)" },
      { tier: 3, label: "Deterministic heuristics", contents: "intent classifier, requirements inference, tweak rules", validation: "spec + coverage-audit test suites" },
      { tier: 4, label: "Learned, re-validated at use", contents: "candidate recipe memory, learned pitfalls (localStorage)", validation: "re-gated before reuse; pitfalls only bias prompts, never ship code" },
      { tier: 5, label: "Model proposals", contents: "local LLM rework/edit suggestions", validation: "never trusted: must beat the incumbent's measured score to survive" },
    ],
    benchmarks,
    benchmarkPassRate: benchmarks.length === 0 ? 0 : Math.round((passCount / benchmarks.length) * 100),
  };
}

/* ------------------------------------------------------------------ */
/* Report formatting                                                   */
/* ------------------------------------------------------------------ */

function bar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatKnowledgeAudit(a: KnowledgeAudit): string {
  const lines: string[] = [];
  lines.push("# OrangeJuce Knowledge Audit");
  lines.push("");
  lines.push(`Generated ${a.generatedAt} — every number below is measured, not claimed.`);
  lines.push("");
  lines.push("## 1. Inventory");
  lines.push("");
  lines.push(`- Golden recipes: **${a.inventory.recipes}**`);
  lines.push(`- Composable primitives: **${a.inventory.primitives}**`);
  lines.push(`- Topology variants (engineering choices): **${a.inventory.topologies}**`);
  lines.push(`- Graph nodes: **${a.inventory.totalNodes}**, reachable concepts: **${a.inventory.concepts}**`);
  lines.push("");
  lines.push(`## 2. Curriculum coverage — overall ${a.overallCoveragePct}%`);
  lines.push("");
  for (const area of a.coverage) {
    lines.push(`\`${bar(area.pct)}\` **${area.area}** ${area.pct}% (${area.covered}/${area.total})`);
  }
  lines.push("");
  lines.push("### Gap report (the shopping list)");
  lines.push("");
  for (const area of a.coverage.filter((c) => c.missing.length > 0)) {
    lines.push(`- **${area.area}**: ${area.missing.join("; ")}`);
  }
  lines.push("");
  lines.push("## 3. Balance (modules per concept)");
  lines.push("");
  for (const b of a.balance.filter((x) => x.modules.length > 1)) {
    lines.push(`- **${b.concept}** ×${b.modules.length}: ${b.modules.join(", ")}`);
  }
  lines.push("");
  lines.push("## 4. Trust tiers");
  lines.push("");
  lines.push("| Tier | What | Contents | Validation |");
  lines.push("|------|------|----------|------------|");
  for (const t of a.trustTiers) {
    lines.push(`| ${t.tier} | ${t.label} | ${t.contents} | ${t.validation} |`);
  }
  lines.push("");
  if (a.benchmarks.length > 0) {
    const avgHealth = Math.round(a.benchmarks.reduce((s, b) => s + b.codeHealth, 0) / a.benchmarks.length);
    lines.push(`## 5. Demonstrated ability — ${a.benchmarkPassRate}% of benchmarks ship at the >= 97 floor (avg code health ${avgHealth})`);
    lines.push("");
    lines.push("| Benchmark | Family | Min score | Code health | Ships? | Candidates | Topology chosen |");
    lines.push("|-----------|--------|-----------|-------------|--------|------------|-----------------|");
    for (const b of a.benchmarks) {
      lines.push(`| ${b.name} | ${b.family} | ${b.minScore} | ${b.codeHealth} | ${b.pass ? "yes" : "NO"} | ${b.candidatesTried} | ${b.chosenTopology ?? "—"} |`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("Regenerate with `npm run audit`. Coverage comes from the knowledge graph");
  lines.push("(src/utils/knowledgeGraph.ts); ability comes from real gated builds.");
  return lines.join("\n");
}
