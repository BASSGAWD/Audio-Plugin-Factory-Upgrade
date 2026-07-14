/**
 * Opt-in perfecting loop: after a build clears the gate, rework it up to N
 * user-chosen times and keep only iterations that MEASURABLY score higher.
 *
 * Two rework strategies, best-effort per iteration:
 *  - Refiner worker (local LLM): rewrites the dspFunction for richer
 *    character against the gate's real evidence, parameter schema frozen.
 *    Every candidate must pass the full acceptance check before it is even
 *    scored — a regression can never replace a working build.
 *  - Deterministic voicing variant: seeded nudges of the intensity
 *    parameters' defaults (mix/drive/feedback/...), re-gated. Safe on ANY
 *    plugin, including cloud-generated ones, because it never touches code.
 *
 * The full iteration trace lands in the BuildReport, so "perfected over N
 * loops" is always shown as scores, not vibes.
 */

import { AudioPlugin, BuildReport, PluginParameter } from "../types";
import { AudioPluginSpec, classifyPluginIntent } from "./pluginSpec";
import { LLMConfig, callLocalLLM, isLocalProvider } from "./llmGateway";
import { DSP_CODING_RULES, SOUND_QUALITY_RULES } from "./dspPromptKit";
import { checkDsp } from "./pluginVerifier";
import { normalizeModelDspCode } from "./healthcheckRunner";
import { QualityGateResult, runQualityGate } from "./qualityGate";

export const MAX_REFINE_LOOPS = 25;

export interface RefinementIteration {
  iteration: number;
  action: string;
  accepted: boolean;
  score: number;
  /** Plain-language "what changed vs the current best" for the UI trace. */
  changeSummary: string;
}

/**
 * One retained, gated version — the unit the ranking leaderboard and the blind
 * A/B/C listening test operate on. Candidates are distinct plugins (deduped by
 * DSP + param defaults) so the user is never auditioning identical clones.
 */
export interface RankedCandidate {
  /** Stable version tag: v1 = initial build, v2.. = rework passes. */
  label: string;
  plugin: AudioPlugin;
  gate: QualityGateResult;
  score: number;
  /** 1 = highest refinementScore. */
  rank: number;
  changeSummary: string;
}

export interface RefinementResult {
  plugin: AudioPlugin;
  gate: QualityGateResult;
  iterations: RefinementIteration[];
  /** Score of the initial build, for the before/after story. */
  initialScore: number;
  bestScore: number;
  /** Distinct versions, ranked best-first (top 3), for the leaderboard + blind test. */
  candidates: RankedCandidate[];
}

/**
 * How close two refinementScores must be to count as a tie the human ear should
 * settle. The score spans ~0-800 (four 0-100 dimensions + 4x confidence), so 6
 * points is well under 1% — it captures all-100s/confidence ties and sub-point
 * character/correction differences without ever calling a real gap a tie.
 */
export const NEAR_TIE_MARGIN = 6;
export function isNearTie(a: number, b: number): boolean {
  return Math.abs(a - b) <= NEAR_TIE_MARGIN;
}

/**
 * One number to climb: all four gate dimensions plus confidence, minus a
 * small penalty per deterministic correction the gate had to apply (a build
 * that needs no gain trim beats one that does, even at equal scores) and per
 * cross-signal dead spot (a build that works on plucks AND sustains beats one
 * that dies on some material), plus a small bonus for characterIndex. These
 * last terms are tie-breakers only: the correctness terms (scores,
 * confidence) dominate the ~0-800 range, so they refine ranking among
 * otherwise-equal candidates without ever letting an incorrect build win.
 */
export function refinementScore(gate: QualityGateResult): number {
  const s = gate.scores;
  const corrections = gate.report.fixes.filter((f) => /corrected/i.test(f)).length;
  const characterBonus = 3 * gate.report.characterIndex;
  const deadSpotPenalty = 5 * (gate.report.silentOnSignals?.length ?? 0);
  // Harshness: only when the gate judged it a defect for this family (harsh),
  // scaled by how bad. Tops out at ~5, another tie-breaker among correct builds.
  const harshnessPenalty = gate.report.harsh ? 5 * (gate.report.aliasingIndex ?? 0) : 0;
  return s.looks + s.performance + s.latency + s.musicality + 4 * gate.report.confidence - 2 * corrections + characterBonus - deadSpotPenalty - harshnessPenalty;
}

/* ------------------------------------------------------------------ */
/* Deterministic voicing variants                                      */
/* ------------------------------------------------------------------ */

const INTENSITY_PARAM = /^(mix|drive|feedback|decay|depth|space|tone|cutoff|resonance|damp)$/;
/** Seeded nudge pattern: alternating directions, growing amplitude. */
const NUDGE_FRACTIONS = [0.12, -0.12, 0.2, -0.2, 0.3, -0.3];

const DECORATIVE_CONTROLS = new Set(["meter", "label", "waveform", "eq", "amp", "cab", "mic", "mic_stand", "pad", "button"]);

/** A continuous, non-decorative parameter worth nudging for a voicing variant. */
function isNudgeable(p: PluginParameter): boolean {
  if (p.min >= p.max) return false;
  if (p.id.startsWith("pad_")) return false;
  if (p.controlType && DECORATIVE_CONTROLS.has(p.controlType)) return false;
  if (/bypass|enable|power|on_off/i.test(p.id)) return false;
  return true;
}

/** Clone the plugin with intensity-parameter defaults nudged by a seeded
 *  fraction of their range. Never touches the DSP code. When a plugin has no
 *  named intensity knob (e.g. autotune's key/scale), fall back to nudging every
 *  continuous non-decorative param so looping still yields a DISTINCT version to
 *  rank and audition instead of an identical clone. */
export function voicingVariant(plugin: AudioPlugin, iteration: number): AudioPlugin {
  const frac = NUDGE_FRACTIONS[(iteration - 1) % NUDGE_FRACTIONS.length];
  const intensity = plugin.parameters.filter((p) => INTENSITY_PARAM.test(p.id));
  const targets = intensity.length > 0 ? intensity : plugin.parameters.filter(isNudgeable);
  const targetIds = new Set(targets.map((p) => p.id));
  const parameters = plugin.parameters.map((p) => {
    if (!targetIds.has(p.id)) return { ...p };
    const nudged = Math.min(p.max, Math.max(p.min, p.defaultValue + frac * (p.max - p.min)));
    const v = Math.round(nudged * 1000) / 1000;
    return { ...p, defaultValue: v, value: v };
  });
  return { ...plugin, parameters };
}

/** Human-readable default-value differences between two versions of a plugin
 *  ("Mix +12%, Feedback -12%"), as a percentage of each param's range. Used for
 *  the per-version change summary in the leaderboard. */
export function paramDeltas(base: AudioPlugin, cand: AudioPlugin): string[] {
  const out: string[] = [];
  for (const bp of base.parameters) {
    const cp = cand.parameters.find((p) => p.id === bp.id);
    if (!cp) continue;
    const range = bp.max - bp.min || 1;
    const d = cp.defaultValue - bp.defaultValue;
    if (Math.abs(d) < range * 0.005) continue;
    const pct = Math.round((d / range) * 100);
    out.push(`${bp.name} ${pct > 0 ? "+" : ""}${pct}%`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* LLM refiner worker                                                  */
/* ------------------------------------------------------------------ */

const REFINER_SYSTEM_PROMPT = `You are the Refinement Agent of an audio plugin factory. You receive a WORKING, verified plugin (parameter schema + dspFunction) plus its measured quality evidence and the original request. Improve the SOUND — richer character, smoother parameter response, more musical defaults-to-extremes behaviour — while keeping the parameter schema EXACTLY as given (same ids, read every one of them) and the same general algorithm family.
Return ONLY JSON: { "dspFunction": "<improved JS body>", "notes": "<one sentence: what you improved>" }
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}`;

export type RefinerWorker = (input: {
  prompt: string;
  plugin: AudioPlugin;
  evidence: string;
}) => Promise<{ dspFunction: string; notes: string }>;

function buildLocalRefiner(llmConfig: LLMConfig, signal?: AbortSignal): RefinerWorker | null {
  if (!isLocalProvider(llmConfig)) return null;
  return async ({ prompt, plugin, evidence }) => {
    const paramList = plugin.parameters
      .map((p) => `{ "id": "${p.id}", "min": ${p.min}, "max": ${p.max}, "defaultValue": ${p.defaultValue} }`)
      .join(",\n");
    const payload = await callLocalLLM({
      config: llmConfig,
      systemPrompt: REFINER_SYSTEM_PROMPT,
      userText: `Original request: ${prompt}\n\nMeasured evidence from the quality gate:\n${evidence}\n\nFROZEN parameter schema:\n[${paramList}]\n\nCurrent working dspFunction:\n${plugin.dspFunction}`,
      temperature: 0.4,
      signal,
    });
    return {
      dspFunction: typeof payload?.dspFunction === "string" ? payload.dspFunction : "",
      notes: typeof payload?.notes === "string" ? payload.notes : "",
    };
  };
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

export interface RefinementOptions {
  prompt: string;
  spec?: AudioPluginSpec | null;
  /** User-chosen loop count; clamped to 1..MAX_REFINE_LOOPS. */
  iterations: number;
  llmConfig?: LLMConfig;
  /** Called at the start of each rework pass (drives the UI status bar). */
  onIteration?: (n: number, total: number) => void;
  /** Called once each rework pass has been gated (drives the live leaderboard). */
  onCandidate?: (
    n: number,
    total: number,
    cand: { label: string; score: number; accepted: boolean; changeSummary: string }
  ) => void;
  /** Injectable refiner (tests); null disables LLM rework entirely. */
  refiner?: RefinerWorker | null;
  signal?: AbortSignal;
}

/**
 * Run the perfecting loop from an already-gated build. Monotonic by
 * construction: a candidate replaces the current best only when its full
 * acceptance check passes AND its score is strictly higher.
 */
export async function runRefinementLoop(
  initial: { plugin: AudioPlugin; gate: QualityGateResult },
  opts: RefinementOptions
): Promise<RefinementResult> {
  const spec = opts.spec ?? classifyPluginIntent(opts.prompt);
  const iterations = Math.max(1, Math.min(MAX_REFINE_LOOPS, Math.round(opts.iterations)));
  const refiner =
    opts.refiner !== undefined ? opts.refiner : opts.llmConfig ? buildLocalRefiner(opts.llmConfig, opts.signal) : null;

  const gateOf = (plugin: AudioPlugin) =>
    runQualityGate(plugin, { family: spec.family, prompt: opts.prompt, intent: spec.interpretedGoal });

  let best = { plugin: initial.plugin, gate: initial.gate };
  const initialScore = refinementScore(initial.gate);
  let bestScore = initialScore;
  const trace: RefinementIteration[] = [];

  // Every distinct gated version, kept for ranking + the blind listening test.
  interface Collected { label: string; plugin: AudioPlugin; gate: QualityGateResult; score: number; changeSummary: string; }
  const collected: Collected[] = [
    { label: "v1", plugin: initial.plugin, gate: initial.gate, score: initialScore, changeSummary: "initial build" },
  ];

  for (let n = 1; n <= iterations; n++) {
    opts.onIteration?.(n, iterations);
    let action = "";
    let changeSummary = "";
    let candidate: AudioPlugin | null = null;

    // Strategy 1: LLM rework of the DSP (schema frozen), acceptance-checked.
    if (refiner) {
      try {
        const evidence = [
          `scores: looks ${best.gate.scores.looks} / performance ${best.gate.scores.performance} / musicality ${best.gate.scores.musicality}`,
          best.gate.report.deadParams.length > 0 ? `controls with no audible effect: ${best.gate.report.deadParams.join(", ")}` : "",
          ...best.gate.report.fixes.filter((f) => /corrected/i.test(f)),
        ].filter(Boolean).join("\n");
        const reworked = await refiner({ prompt: opts.prompt, plugin: best.plugin, evidence });
        const dsp = normalizeModelDspCode(reworked.dspFunction);
        if (dsp.trim()) {
          const acceptance = checkDsp(dsp, best.plugin.parameters);
          if (acceptance.ok) {
            candidate = { ...best.plugin, dspFunction: dsp };
            action = `model rework${reworked.notes ? ` (${reworked.notes.slice(0, 90)})` : ""}`;
            changeSummary = reworked.notes ? reworked.notes.slice(0, 90) : "reworked the DSP for richer character";
          } else {
            action = `model rework rejected by acceptance check (${acceptance.evidence.slice(0, 90)})`;
          }
        } else {
          action = "model rework returned no code";
        }
      } catch (err: any) {
        if (err?.name === "AbortError") throw err;
        action = `model rework failed (${String(err?.message || err).slice(0, 80)})`;
      }
    }

    // Strategy 2: deterministic voicing variant (also the LLM-failure fallback).
    if (!candidate) {
      candidate = voicingVariant(best.plugin, n);
      action = action ? `${action}; tried voicing variant instead` : `voicing variant (seeded nudge ${n})`;
      const deltas = paramDeltas(best.plugin, candidate);
      changeSummary = deltas.length > 0 ? deltas.join(", ") : "voicing nudge (no audible change)";
    }

    const candidateGate = gateOf(candidate);
    const score = refinementScore(candidateGate);
    const accepted = score > bestScore;
    const label = `v${n + 1}`;
    if (accepted) {
      best = { plugin: candidateGate.plugin, gate: candidateGate };
      bestScore = score;
    }
    trace.push({ iteration: n, action, accepted, score, changeSummary });
    collected.push({ label, plugin: candidateGate.plugin, gate: candidateGate, score, changeSummary });
    opts.onCandidate?.(n, iterations, { label, score, accepted, changeSummary });
  }

  // Rank distinct versions best-first for the leaderboard and blind test. Two
  // versions are "the same" when their DSP and rounded param defaults match, so
  // the user never auditions identical clones.
  const signature = (p: AudioPlugin) =>
    p.dspFunction + "|" + p.parameters.map((q) => `${q.id}:${Math.round(q.defaultValue * 1000)}`).join(",");
  const seen = new Set<string>();
  const unique: Collected[] = [];
  for (const c of collected) {
    const sig = signature(c.plugin);
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(c);
  }
  unique.sort((a, b) => b.score - a.score);
  const candidates: RankedCandidate[] = unique.slice(0, 3).map((c, i) => ({
    label: c.label,
    plugin: c.plugin,
    gate: c.gate,
    score: c.score,
    rank: i + 1,
    changeSummary: c.changeSummary,
  }));

  // Attach the trace to whichever report ships (the doc's honesty rule:
  // "perfected" must be shown as scores, not claimed).
  const refinement: NonNullable<BuildReport["refinement"]> = trace.map((t) => ({ ...t }));
  best.gate.report.refinement = refinement;
  if (best.plugin.buildReport) best.plugin.buildReport.refinement = refinement;

  return { plugin: best.plugin, gate: best.gate, iterations: trace, initialScore, bestScore, candidates };
}
