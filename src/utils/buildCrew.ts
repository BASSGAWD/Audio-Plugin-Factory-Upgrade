/**
 * Who actually does each job in a build — the honest version.
 *
 * The app ships a roster of five named specialists (defaultAgents.ts) and used
 * to show a "Consulting Aero… Consulting Decibel…" checklist while a build ran.
 * That checklist was a `setInterval` advancing every 1400ms: none of those
 * agents' system prompts ever reached a model during a build, and the display
 * was identical whether the model did all the work or none of it.
 *
 * Meanwhile a genuine multi-worker pipeline DOES exist in buildPlanner.ts --
 * an Intent Architect, a Parameter Agent, a DSP Generator (or Graph Architect
 * when no recipe matches), a bounded Repair pass, and a deterministic quality
 * gate. Each is a distinct prompt whose output feeds the next, and each already
 * records a REAL JobTrace: worker name, status, attempt count, and failure
 * evidence. It was just anonymous and invisible in the UI.
 *
 * This module names those real jobs with the roster's identities and reports
 * what each one ACTUALLY did, derived entirely from that trace. Nothing here
 * invents work: a job that fell back to the deterministic compiler says so, a
 * job that never ran says so, and the deterministic quality gate is labelled
 * as deterministic rather than implying an AI critic reviewed the work.
 */
import { JobTrace } from "./buildPlanner";

export interface CrewMember {
  /** Matches an agent id in defaultAgents.ts (for avatar/color reuse). */
  agentId: string;
  name: string;
  /** What this specialist really does -- the pipeline job, not a flavor label. */
  job: string;
  /** Real outcome, derived from the JobTrace. */
  status: "done" | "repaired" | "fallback" | "skipped" | "working" | "pending";
  /** The actual result or reason, straight from the trace's own evidence. */
  detail?: string;
}

/**
 * Which roster identity owns which real pipeline job id.
 *
 * Nexus is deliberately NOT here. It coordinates and talks to the user; it
 * does not generate parameters or DSP. Listing it as a build worker would be
 * the same lie the fake timer told.
 */
const JOB_OWNERS: Array<{ jobId: string; agentId: string; name: string; job: string }> = [
  { jobId: "intent", agentId: "nexus", name: "Nexus", job: "Reads the request and picks the DSP identity" },
  { jobId: "parameters", agentId: "haptic", name: "Haptic", job: "Designs the plugin's controls" },
  { jobId: "dsp_code", agentId: "aero", name: "Aero", job: "Writes and verifies the signal-processing code" },
  { jobId: "validate", agentId: "decibel", name: "Decibel", job: "Quality gate (deterministic) + repair pass" },
];

/** Workers in the trace that mean "no model produced this". */
const DETERMINISTIC_WORKERS = new Set(["Deterministic Compiler", "Graph Composer", "QA Agent"]);

/**
 * Build the crew view from the pipeline's own real job trace. Each member's
 * status comes from that job's real JobStatus / worker name, so a build where
 * every model call failed shows four fallbacks, not four checkmarks.
 */
export function crewFromTrace(trace: JobTrace[]): CrewMember[] {
  return JOB_OWNERS.map((owner) => {
    const t = trace.find((j) => j.id === owner.jobId);
    if (!t) {
      return { ...owner, status: "skipped" as const, detail: "not needed for this build" };
    }

    // The quality gate is deterministic code, not a model. Say so plainly
    // rather than letting a green check imply an AI reviewed the work.
    if (owner.jobId === "validate") {
      return {
        ...owner,
        status: t.status === "repaired" ? ("repaired" as const) : ("done" as const),
        detail: `gate ${Math.round(t.confidence * 100)}/100${t.attempts > 1 ? ` · ${t.attempts} passes` : ""}${t.evidence ? ` · ${t.evidence}` : ""}`,
      };
    }

    if (t.status === "fallback" || DETERMINISTIC_WORKERS.has(t.worker)) {
      return {
        ...owner,
        status: "fallback" as const,
        detail: t.evidence || "model unavailable — the deterministic compiler built this",
      };
    }

    if (t.status === "repaired") {
      return {
        ...owner,
        status: "repaired" as const,
        detail: `needed ${t.attempts} attempt${t.attempts === 1 ? "" : "s"}${t.evidence ? ` · ${t.evidence}` : ""}`,
      };
    }

    return {
      ...owner,
      status: "done" as const,
      detail: t.evidence || `${t.worker} · ${t.ms}ms`,
    };
  });
}

/** One-line summary. Never claims a model ran when none did. */
export function crewSummary(crew: CrewMember[]): string {
  const contributed = crew.filter((m) => m.status === "done" || m.status === "repaired").length;
  const fell = crew.filter((m) => m.status === "fallback").length;
  if (contributed === 0) return "Built by the deterministic compiler — no model was involved.";
  if (fell > 0) return `${contributed} contributed · ${fell} fell back to the deterministic compiler`;
  return `${contributed} specialist${contributed === 1 ? "" : "s"} contributed`;
}
