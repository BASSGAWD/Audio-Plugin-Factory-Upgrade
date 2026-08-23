/**
 * Roaming Mode — a background researcher for the Research Lab.
 *
 * Once turned on, this keeps calling the exact same research pipeline
 * (runResearch -> isApprovable -> approveResearch) on a timer instead of a
 * human clicking "Research" -- picking the factory's own next open
 * knowledge gap, researching it with live web sources, and auto-adding it
 * the moment it clears the SAME safety gate the manual Approve button
 * requires. It never touches, loosens, or reimplements that gate.
 *
 * Deliberately NOT a React hook or component: it has to keep running
 * regardless of which screen is showing (Simple mode, Canvas, or any other
 * Pro-mode companion tab) -- ResearchLab.tsx (where the manual approval UI
 * lives) unmounts the instant the user navigates away, so a background
 * feature anchored to its lifecycle would stop the moment you looked away.
 * This module owns its own persisted flag, its own interval, and its own
 * status object; App.tsx boots it once (initRoamingResearch()) above every
 * uiMode branch, and ResearchLab.tsx only ever reads/renders its status.
 *
 * "Background" here means "for as long as this browser tab stays open" --
 * there's no server-side job runner in this app to keep it going otherwise,
 * and that's an accepted, honest limitation, not something worked around.
 */
import {
  ResearchSources, runResearch, isApprovable, approveResearch, readResearchQueue,
  resolveResearchConcept, createProxyWebFetcher,
} from "./researchEngine";
import { listKnowledgeGaps, KnowledgeGap } from "./knowledgeAudit";
import { getLLMConfig, isLocalProvider } from "./llmGateway";

const ROAMING_ENABLED_KEY = "audio_factory_roaming_research_v1";

/** ~40 request-bursts/hour against a fixed, curated static-site allowlist
 *  (Wikipedia/CCRMA/W3C) -- considerate, not aggressive. The gap list is
 *  finite, so a full sweep finishes well inside an hour; once every gap
 *  has been attempted, ticks cost one localStorage read and an array scan
 *  with zero network, so the interval can keep running indefinitely for
 *  free and will pick back up the moment a new gap appears (e.g. a fresh
 *  unserved prompt gets logged). */
export const ROAMING_INTERVAL_MS = 90_000;

export type RoamingPhase = "off" | "idle" | "researching" | "done";

export type RoamingOutcome =
  | { kind: "idle" }
  | { kind: "skipped" } // a tick was already in flight; this one no-oped
  | { kind: "auto-added"; concept: string; itemId: string; buildable: boolean }
  | { kind: "queued"; concept: string; itemId: string; reason: "blocked" | "gate-failed" | "no-findings" }
  | { kind: "error"; concept: string | null; message: string };

export interface RoamingStatus {
  enabled: boolean;
  phase: RoamingPhase;
  /** In flight, or the last one finished -- null only before the first tick. */
  concept: string | null;
  lastOutcome: RoamingOutcome | null;
  lastRunAt: string | null;
  /** Ticks that actually ran research (not idle/skipped). */
  researched: number;
  /** Items approved by roaming specifically. */
  autoAdded: number;
}

let status: RoamingStatus = {
  enabled: false,
  phase: "off",
  concept: null,
  lastOutcome: null,
  lastRunAt: null,
  researched: 0,
  autoAdded: 0,
};

const listeners = new Set<(s: RoamingStatus) => void>();

function setStatus(patch: Partial<RoamingStatus>) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
}

export function getRoamingStatus(): RoamingStatus {
  return status;
}

/** Subscribe to status changes; returns an unsubscribe function. The UI
 *  gets pushed updates so an auto-added item can trigger a live refresh
 *  (e.g. Decision History updating) with no polling. */
export function subscribeRoaming(fn: (s: RoamingStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function isRoamingEnabled(): boolean {
  return storage()?.getItem(ROAMING_ENABLED_KEY) === "1";
}

/**
 * Picks the next gap Roaming Mode should research: the first one whose
 * resolved concept has NO existing item in the queue yet, regardless of
 * that item's status. "Attempted" deliberately means any status, not just
 * pending:
 *  - pending: runResearch short-circuits and returns the same item with
 *    no network call, forever -- picking it again would never make progress.
 *  - rejected: a human said no; roaming must never re-litigate that.
 *  - approved: curriculum-gap rows close naturally once knownConcepts()
 *    reaches them, but prompt-gap rows have NO removal path (readPromptGaps
 *    is an append-only log) -- an approved prompt-gap row would otherwise
 *    be re-picked and re-researched every tick forever, creating a fresh
 *    duplicate queue entry each time (runResearch's own dedup only matches
 *    status === "pending", so it would not catch this).
 */
export function pickNextRoamingGap(): KnowledgeGap | null {
  const attempted = new Set(readResearchQueue().map((i) => i.concept));
  return listKnowledgeGaps().find((g) => !attempted.has(resolveResearchConcept(g.researchKey))) ?? null;
}

function defaultRoamingSources(): ResearchSources {
  const cfg = getLLMConfig();
  return {
    llmConfig: isLocalProvider(cfg) ? cfg : null,
    // Roaming ALWAYS uses live web sources for fuller research -- turning
    // the toggle on IS the opt-in to that network activity. The Research
    // Lab's own "Include live web sources" checkbox governs only the
    // manual Research button and is not consulted here.
    webFetcher: createProxyWebFetcher(),
  };
}

let inFlight = false;

/**
 * The pure, directly-testable core: pick the next gap (or report idle),
 * research it, and auto-add it if -- and only if -- it clears the exact
 * same isApprovable() bar the manual Approve button requires. No timer
 * logic lives in here, so a test can call this directly, repeatedly,
 * without waiting on real wall-clock time. `sources` is injectable so
 * tests stay fully offline and deterministic, same as every other suite
 * in this project.
 */
export async function runRoamingTick(opts: { sources?: ResearchSources } = {}): Promise<RoamingOutcome> {
  if (inFlight) return { kind: "skipped" };

  const gap = pickNextRoamingGap();
  if (!gap) {
    setStatus({ phase: "idle", concept: null, lastOutcome: { kind: "idle" }, lastRunAt: new Date().toISOString() });
    return { kind: "idle" };
  }

  inFlight = true;
  setStatus({ phase: "researching", concept: gap.researchKey });
  try {
    const item = await runResearch(gap.researchKey, opts.sources ?? defaultRoamingSources());
    // Same bar as the Approve button -- isApprovable() is the ONLY gate and
    // is never re-implemented or relaxed here. runResearch has already run
    // the real quality gate on any proposed module before this line.
    const approved = isApprovable(item) ? approveResearch(item.id, "roaming") : null;
    const outcome: RoamingOutcome = approved
      ? { kind: "auto-added", concept: item.concept, itemId: item.id, buildable: !!item.proposedModule }
      : {
          kind: "queued",
          concept: item.concept,
          itemId: item.id,
          // "no findings" (claims.length === 0) is itself surfaced as a
          // blocking conflict by runResearch, so it must be checked BEFORE
          // the generic blocking-conflict test below, or every no-findings
          // result gets mislabeled as a structural "blocked" reason.
          reason:
            item.claims.length === 0
              ? "no-findings"
              : item.conflicts.some((c) => c.severity === "blocking")
                ? "blocked"
                : "gate-failed",
        };
    setStatus({
      phase: "done",
      concept: item.concept,
      lastOutcome: outcome,
      lastRunAt: new Date().toISOString(),
      researched: status.researched + 1,
      autoAdded: status.autoAdded + (outcome.kind === "auto-added" ? 1 : 0),
    });
    return outcome;
  } catch (err: any) {
    const outcome: RoamingOutcome = { kind: "error", concept: gap.researchKey, message: String(err?.message || err).slice(0, 200) };
    setStatus({ phase: "done", lastOutcome: outcome, lastRunAt: new Date().toISOString(), researched: status.researched + 1 });
    return outcome;
  } finally {
    inFlight = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

function startLoop() {
  if (timer) return; // already running
  setStatus({ enabled: true, phase: status.phase === "off" ? "idle" : status.phase });
  void runRoamingTick(); // fire immediately so enabling it feels responsive
  timer = setInterval(() => {
    if (isRoamingEnabled()) void runRoamingTick();
  }, ROAMING_INTERVAL_MS);
}

function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  setStatus({ enabled: false, phase: "off", concept: null });
}

/** Persists the flag and starts/stops the loop to match. */
export function setRoamingEnabled(on: boolean): void {
  const store = storage();
  if (store) store.setItem(ROAMING_ENABLED_KEY, on ? "1" : "0");
  if (on) startLoop();
  else stopLoop();
}

let booted = false;

/**
 * Call once at app boot (App.tsx, above every uiMode branch). Idempotent --
 * required because this app renders inside React.StrictMode (src/main.tsx),
 * which double-invokes effects in dev; without this guard a naive
 * useEffect(() => initRoamingResearch(), []) would start two intervals.
 * Reads the persisted flag and resumes the loop if it was left on.
 */
export function initRoamingResearch(): void {
  if (booted) return;
  booted = true;
  if (isRoamingEnabled()) startLoop();
}
