/**
 * Canvas factory: the autonomous build pipeline behind every canvas card.
 *
 * One prompt in, one fully-gated plugin out — no chat, no model dependency:
 *   1. spec        deterministic intent classification
 *   2. build       best-of-N deterministic candidates (recipes / primitives)
 *   3. gate        every candidate through the full quality gate
 *   4. perfect     seeded voicing rework, accepted only on a strictly
 *                  higher refinementScore (same rule as the chat pipeline)
 *
 * The loop yields to the event loop between gate runs so a building card
 * never freezes the canvas UI, and it reports progress through callbacks so
 * the card can show real pipeline evidence instead of a fake spinner.
 */

import { AudioPlugin, BuildReport } from "../types";
import { AudioPluginSpec, classifyPluginIntent } from "./pluginSpec";
import { buildOfflineCandidates, OfflineBuild } from "./offlineBuilder";
import { QualityGateResult, runQualityGate } from "./qualityGate";
import { refinementScore, voicingVariant, paramDeltas, MAX_REFINE_LOOPS, NEAR_TIE_MARGIN } from "./refinementLoop";
import { buildPortableScaffolds } from "./portableCodegen";

export interface CanvasBuildProgress {
  /** Pipeline checkpoint: "spec" | "build" | "gate" | "perfect" | "done". */
  stage: string;
  /** Human-readable detail for the card status line (e.g. "v3/6"). */
  detail?: string;
  /** Best min-score seen so far (0-100), once gating has started. */
  bestMinScore?: number;
  /** Versions gated so far, including seeds. */
  versionsTried?: number;
}

export interface CanvasBuildResult {
  plugin: AudioPlugin;
  gate: QualityGateResult;
  spec: AudioPluginSpec;
  /** Lowest of the four headline scores — the number the card badge shows. */
  minScore: number;
  /** Total distinct versions gated (base + seeds + rework passes). */
  versionsTried: number;
}

const minOf = (g: QualityGateResult) =>
  Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);

/** Let the browser paint between CPU-heavy gate runs. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface CanvasBuildOptions {
  /** Perfecting passes after the best seed is chosen (0 = seeds only). */
  refineLoops?: number;
  onProgress?: (p: CanvasBuildProgress) => void;
  signal?: AbortSignal;
}

/**
 * Build one plugin from one prompt, end to end. Deterministic and offline:
 * the same prompt always yields the same plugin at the same scores.
 */
export async function buildCanvasPlugin(prompt: string, opts: CanvasBuildOptions = {}): Promise<CanvasBuildResult> {
  const report = (p: CanvasBuildProgress) => opts.onProgress?.(p);
  const throwIfAborted = () => {
    if (opts.signal?.aborted) throw new DOMException("Canvas build aborted", "AbortError");
  };

  report({ stage: "spec" });
  const spec = classifyPluginIntent(prompt);
  await yieldToUi();
  throwIfAborted();

  report({ stage: "build" });
  const candidates = buildOfflineCandidates(prompt, spec);
  if (candidates.length === 0) throw new Error("The deterministic builder produced no candidates for this prompt.");
  await yieldToUi();
  throwIfAborted();

  // Gate every distinct candidate; the best gated seed becomes the base the
  // perfecting loop reworks. Candidates arrive in preference order — the
  // requirements-matched topology first (e.g. the vintage/Warmth compressor
  // for "warm vintage vocals"), then alternates. A later candidate must beat
  // the current best by MORE than a near-tie to displace it, so an
  // ear-indistinguishable score win never silently overrides the deliberate
  // engineering choice.
  report({ stage: "gate" });
  let best: { plugin: AudioPlugin; gate: QualityGateResult } | null = null;
  let bestScore = -Infinity;
  let bestChoice: OfflineBuild["engineeringChoice"] = undefined;
  let versionsTried = 0;
  const seenDsp = new Set<string>();
  for (const cand of candidates) {
    if (seenDsp.has(cand.dspFunction)) continue;
    seenDsp.add(cand.dspFunction);
    const candidatePlugin: AudioPlugin = {
      id: `canvas-${Date.now()}-${versionsTried}`,
      name: cand.name,
      category: cand.category,
      description: cand.description,
      parameters: cand.parameters.map((p) => ({ ...p, value: p.value !== undefined ? p.value : p.defaultValue })),
      dspFunction: cand.dspFunction,
      faustCode: "",
      cppJuceCode: "",
      createdAt: new Date().toLocaleDateString(),
    };
    const gate = runQualityGate(candidatePlugin, { family: cand.family, prompt, intent: spec.interpretedGoal, uiMetaphor: spec.uiMetaphor });
    versionsTried++;
    const score = refinementScore(gate);
    if (score > bestScore + NEAR_TIE_MARGIN) {
      best = { plugin: gate.plugin, gate };
      bestScore = score;
      bestChoice = cand.engineeringChoice;
    }
    report({ stage: "gate", detail: `seed ${versionsTried}`, bestMinScore: best ? minOf(best.gate) : undefined, versionsTried });
    await yieldToUi();
    throwIfAborted();
  }
  if (!best) throw new Error("No candidate survived the quality gate.");

  // Perfecting loop: deterministic voicing rework, monotonic by construction.
  const loops = Math.max(0, Math.min(MAX_REFINE_LOOPS, Math.round(opts.refineLoops ?? 0)));
  const refinementTrace: NonNullable<BuildReport["refinement"]> = [];
  for (let n = 1; n <= loops; n++) {
    report({ stage: "perfect", detail: `v${n}/${loops}`, bestMinScore: minOf(best.gate), versionsTried });
    const variant = voicingVariant(best.plugin, n);
    const deltas = paramDeltas(best.plugin, variant);
    const gate = runQualityGate(variant, { family: spec.family, prompt, intent: spec.interpretedGoal, uiMetaphor: spec.uiMetaphor });
    versionsTried++;
    const score = refinementScore(gate);
    const accepted = score > bestScore;
    refinementTrace.push({
      iteration: n,
      action: deltas.length > 0 ? `voicing rework (${deltas.join(", ")})` : "voicing rework (no audible change)",
      accepted,
      score,
    });
    if (accepted) {
      best = { plugin: gate.plugin, gate };
      bestScore = score;
    }
    await yieldToUi();
    throwIfAborted();
  }
  if (refinementTrace.length > 0) {
    best.gate.report.refinement = refinementTrace;
    if (best.plugin.buildReport) best.plugin.buildReport.refinement = refinementTrace;
  }
  // Carry the winning candidate's "why this design" onto the shipped report so
  // the card can show it. Voicing reworks keep the same topology, so the
  // rationale survives the perfecting loop.
  if (bestChoice && best.plugin.buildReport) {
    best.plugin.buildReport.engineeringChoice = bestChoice;
  }

  // Ship with portable code attached so "Open in Studio" and the exporter
  // get the same artifacts a chat build would carry.
  const scaffolds = buildPortableScaffolds(best.plugin);
  const plugin: AudioPlugin = {
    ...best.plugin,
    faustCode: scaffolds.faustCode,
    cppJuceCode: scaffolds.cppJuceCode,
  };

  report({ stage: "done", bestMinScore: minOf(best.gate), versionsTried });
  return { plugin, gate: best.gate, spec, minScore: minOf(best.gate), versionsTried };
}

/* ------------------------------------------------------------------ */
/* Card persistence                                                    */
/* ------------------------------------------------------------------ */

export interface CanvasCard {
  id: string;
  prompt: string;
  x: number;
  y: number;
  status: "queued" | "building" | "ready" | "failed";
  /** Live stage label while building (from CanvasBuildProgress). */
  stage?: string;
  stageDetail?: string;
  versionsTried?: number;
  plugin?: AudioPlugin;
  minScore?: number;
  error?: string;
  createdAt: number;
}

export interface CanvasWorkspace {
  cards: CanvasCard[];
  view: { x: number; y: number; zoom: number };
}

export const CANVAS_STORAGE_KEY = "audio_factory_canvas_v1";

export function loadCanvasWorkspace(): CanvasWorkspace {
  const fallback: CanvasWorkspace = { cards: [], view: { x: 0, y: 0, zoom: 1 } };
  try {
    const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.cards)) return fallback;
    const cards: CanvasCard[] = parsed.cards
      .filter((c: any) => c && typeof c.id === "string" && typeof c.prompt === "string")
      .map((c: any) => {
        const ready = c.status === "ready" && c.plugin && typeof c.plugin.dspFunction === "string";
        return {
          id: c.id,
          prompt: c.prompt,
          x: Number.isFinite(c.x) ? c.x : 0,
          y: Number.isFinite(c.y) ? c.y : 0,
          // A card that was mid-build when the tab closed resumes as queued —
          // the factory finishes its own jobs.
          status: ready ? "ready" : c.status === "failed" ? "failed" : "queued",
          plugin: ready ? c.plugin : undefined,
          minScore: ready && Number.isFinite(c.minScore) ? c.minScore : undefined,
          versionsTried: Number.isFinite(c.versionsTried) ? c.versionsTried : undefined,
          error: typeof c.error === "string" ? c.error : undefined,
          createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
        } as CanvasCard;
      });
    const view = parsed.view && Number.isFinite(parsed.view.x) && Number.isFinite(parsed.view.y) && Number.isFinite(parsed.view.zoom)
      ? { x: parsed.view.x, y: parsed.view.y, zoom: Math.max(0.3, Math.min(1.75, parsed.view.zoom)) }
      : fallback.view;
    return { cards, view };
  } catch {
    return fallback;
  }
}

export function saveCanvasWorkspace(ws: CanvasWorkspace): void {
  try {
    // Building/queued cards persist without transient stage fields.
    const cards = ws.cards.map((c) => ({
      id: c.id,
      prompt: c.prompt,
      x: c.x,
      y: c.y,
      status: c.status === "building" ? "queued" : c.status,
      plugin: c.status === "ready" ? c.plugin : undefined,
      minScore: c.minScore,
      versionsTried: c.versionsTried,
      error: c.error,
      createdAt: c.createdAt,
    }));
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ cards, view: ws.view }));
  } catch (err) {
    // localStorage full or unavailable: the canvas keeps working in memory.
    console.warn("Canvas workspace could not be persisted:", err);
  }
}

/** Free spot for a new card near the viewport center: march down-right in
 *  half-card steps until nothing overlaps. Deterministic, no RNG jitter. */
export function placeNewCard(cards: CanvasCard[], centerX: number, centerY: number): { x: number; y: number } {
  const W = 360;
  const H = 240;
  let x = Math.round(centerX - W / 2);
  let y = Math.round(centerY - H / 2);
  const collides = (cx: number, cy: number) =>
    cards.some((c) => Math.abs(c.x - cx) < W * 0.9 && Math.abs(c.y - cy) < H * 0.9);
  let step = 0;
  while (collides(x, y) && step < 40) {
    step++;
    x += 48;
    y += 40;
  }
  return { x, y };
}
