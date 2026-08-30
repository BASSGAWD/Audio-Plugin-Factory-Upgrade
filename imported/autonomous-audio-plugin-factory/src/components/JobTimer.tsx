import React, { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

/**
 * Elapsed-time + ETA readout for long-running jobs (model generation, native
 * builds, analysis passes). Local models have no progress callbacks, so the
 * honest signal we can give is elapsed time plus a "typically ~Xs" estimate
 * learned from this machine's own previous runs of the same job type
 * (rolling history in localStorage, median of the last few runs).
 */

const STORAGE_KEY_JOB_HISTORY = "audio_factory_job_durations";
const HISTORY_PER_JOB = 5;

function readHistory(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_JOB_HISTORY) || "{}");
  } catch {
    return {};
  }
}

function recordJobDuration(jobKey: string, seconds: number): void {
  // Sub-second runs are cache hits/failures, not representative timings.
  if (seconds < 1) return;
  const history = readHistory();
  const runs = history[jobKey] || [];
  runs.push(Math.round(seconds));
  history[jobKey] = runs.slice(-HISTORY_PER_JOB);
  localStorage.setItem(STORAGE_KEY_JOB_HISTORY, JSON.stringify(history));
}

function typicalDuration(jobKey: string): number | null {
  const runs = readHistory()[jobKey];
  if (!runs || runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

interface JobTimerProps {
  /** Timer runs while true; on the true->false edge the duration is recorded. */
  active: boolean;
  /** Stable identifier for this job type, e.g. "chat_generation". */
  jobKey: string;
  /** Optional label prefix, e.g. "Generating". */
  label?: string;
  className?: string;
}

export default function JobTimer({ active, jobKey, label, className = "" }: JobTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const [eta] = useState<number | null>(() => typicalDuration(jobKey));

  useEffect(() => {
    if (!active) return;

    startedAtRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);

    // Record in the cleanup so the duration is captured both when `active`
    // flips false in place AND when the parent unmounts this component
    // outright (e.g. the chat loading card disappearing).
    return () => {
      clearInterval(interval);
      if (startedAtRef.current !== null) {
        recordJobDuration(jobKey, (Date.now() - startedAtRef.current) / 1000);
        startedAtRef.current = null;
      }
    };
  }, [active, jobKey]);

  if (!active) return null;

  const remaining = eta !== null ? eta - elapsed : null;
  const progressPct = eta !== null ? Math.min(97, Math.round((elapsed / eta) * 100)) : null;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5 font-mono text-[9px] text-neutral-400">
        <Clock className="w-3 h-3 text-orange-400" />
        <span>
          {label ? `${label} · ` : ""}
          {formatSeconds(elapsed)} elapsed
          {remaining !== null && remaining > 0 && <span className="text-neutral-500"> · ~{formatSeconds(remaining)} left (typical)</span>}
          {remaining !== null && remaining <= 0 && <span className="text-neutral-500"> · running longer than usual</span>}
        </span>
      </div>
      {progressPct !== null && (
        <div className="w-full h-0.5 bg-neutral-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-orange-500/70 rounded-full transition-all duration-1000"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
