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

import { AudioPlugin, BuildReport } from "../types";
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
}

export interface RefinementResult {
  plugin: AudioPlugin;
  gate: QualityGateResult;
  iterations: RefinementIteration[];
  /** Score of the initial build, for the before/after story. */
  initialScore: number;
  bestScore: number;
}

/**
 * One number to climb: all four gate dimensions plus confidence, minus a
 * small penalty per deterministic correction the gate had to apply (a build
 * that needs no gain trim beats one that does, even at equal scores), plus a
 * small bonus for characterIndex — a tie-breaker only. It cannot make an
 * incorrect build win: the correctness terms (scores, confidence) dominate
 * the range (0-800), while the character bonus tops out at 3, just enough to
 * separate otherwise-equal candidates in favor of the more transformative one.
 */
export function refinementScore(gate: QualityGateResult): number {
  const s = gate.scores;
  const corrections = gate.report.fixes.filter((f) => /corrected/i.test(f)).length;
  const characterBonus = 3 * gate.report.characterIndex;
  return s.looks + s.performance + s.latency + s.musicality + 4 * gate.report.confidence - 2 * corrections + characterBonus;
}

/* ------------------------------------------------------------------ */
/* Deterministic voicing variants                                      */
/* ------------------------------------------------------------------ */

const INTENSITY_PARAM = /^(mix|drive|feedback|decay|depth|space|tone|cutoff|resonance|damp)$/;
/** Seeded nudge pattern: alternating directions, growing amplitude. */
const NUDGE_FRACTIONS = [0.12, -0.12, 0.2, -0.2, 0.3, -0.3];

/** Clone the plugin with intensity-parameter defaults nudged by a seeded
 *  fraction of their range. Never touches the DSP code. */
export function voicingVariant(plugin: AudioPlugin, iteration: number): AudioPlugin {
  const frac = NUDGE_FRACTIONS[(iteration - 1) % NUDGE_FRACTIONS.length];
  const parameters = plugin.parameters.map((p) => {
    if (!INTENSITY_PARAM.test(p.id)) return { ...p };
    const nudged = Math.min(p.max, Math.max(p.min, p.defaultValue + frac * (p.max - p.min)));
    const v = Math.round(nudged * 1000) / 1000;
    return { ...p, defaultValue: v, value: v };
  });
  return { ...plugin, parameters };
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

  for (let n = 1; n <= iterations; n++) {
    opts.onIteration?.(n, iterations);
    let action = "";
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
    }

    const candidateGate = gateOf(candidate);
    const score = refinementScore(candidateGate);
    const accepted = score > bestScore;
    if (accepted) {
      best = { plugin: candidateGate.plugin, gate: candidateGate };
      bestScore = score;
    }
    trace.push({ iteration: n, action, accepted, score });
  }

  // Attach the trace to whichever report ships (the doc's honesty rule:
  // "perfected" must be shown as scores, not claimed).
  const refinement: NonNullable<BuildReport["refinement"]> = trace.map((t) => ({ ...t }));
  best.gate.report.refinement = refinement;
  if (best.plugin.buildReport) best.plugin.buildReport.refinement = refinement;

  return { plugin: best.plugin, gate: best.gate, iterations: trace, initialScore, bestScore };
}
