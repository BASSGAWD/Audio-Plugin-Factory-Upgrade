import React from "react";
import { Check, Trophy, Ear } from "lucide-react";

/**
 * Build status bar with checkpoint markers. Stages are driven by REAL
 * pipeline callbacks (planner jobs, perfecting-loop iterations) — never a
 * fake timer. Shown while a build is in flight in both Simple and Pro chat.
 *
 * When the perfecting loop runs it also feeds a live leaderboard of the
 * versions it is producing (which version, what changed, and its score), so
 * "looping" is visibly happening instead of flashing by unseen.
 */
export interface BuildStage {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
  /** Small live detail, e.g. "v3/25" during the perfecting loop. */
  note?: string;
}

export interface BuildVersion {
  /** v1 = initial build, v2.. = rework passes. */
  label: string;
  score: number;
  changeSummary: string;
  /** building = in flight; kept = became the new best; dropped = not better. */
  status: "building" | "kept" | "dropped";
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Rank the produced versions by score (best first) for the leaderboard. */
function rankVersions(versions: BuildVersion[]): { v: BuildVersion; rank: number }[] {
  const settled = versions.filter((v) => v.status !== "building");
  const order = [...settled].sort((a, b) => b.score - a.score);
  const rankOf = new Map(order.map((v, i) => [v.label, i + 1]));
  return versions.map((v) => ({ v, rank: rankOf.get(v.label) ?? 0 }));
}

export default function BuildProgressBar({
  stages,
  versions = [],
  onJudge,
}: {
  stages: BuildStage[];
  versions?: BuildVersion[];
  /** When set, a "Judge by ear" button appears under the leaderboard. */
  onJudge?: () => void;
}) {
  if (stages.length === 0 && versions.length === 0) return null;
  const doneCount = stages.filter((s) => s.status === "done").length;
  const activeIdx = stages.findIndex((s) => s.status === "active");
  const progress = stages.length === 0 ? 1 : Math.min(1, (doneCount + (activeIdx >= 0 ? 0.5 : 0)) / stages.length);

  const ranked = versions.length > 0 ? rankVersions(versions) : [];

  return (
    <div className="w-full max-w-2xl mx-auto select-none">
      {stages.length > 0 && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Plugin build progress">
          <div className="relative h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-500" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            {stages.map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-1 min-w-0" style={{ flex: 1 }}>
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-full border transition-colors ${
                    s.status === "done"
                      ? "bg-orange-600 border-orange-500 text-white"
                      : s.status === "active"
                      ? "border-orange-500 text-orange-400 animate-pulse"
                      : "border-neutral-700 text-neutral-700"
                  }`}
                >
                  {s.status === "done" ? <Check className="w-2.5 h-2.5" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                </span>
                <span className={`text-[9px] font-medium truncate max-w-full ${s.status === "pending" ? "text-neutral-600" : s.status === "active" ? "text-orange-300" : "text-neutral-400"}`}>
                  {s.label}
                  {s.note ? ` ${s.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2" aria-label="Version leaderboard">
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <Trophy className="w-3 h-3 text-orange-400" />
            <span className="text-[10px] font-semibold tracking-wide text-neutral-300 uppercase">Versions</span>
          </div>
          <ul className="flex flex-col gap-1">
            {ranked.map(({ v, rank }) => {
              const medal = rank >= 1 && rank <= 3 ? MEDALS[rank - 1] : "";
              return (
                <li
                  key={v.label}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-colors ${
                    v.status === "building"
                      ? "bg-orange-500/10 border border-orange-700/50 animate-pulse"
                      : rank === 1
                      ? "bg-orange-500/10 border border-orange-800/50"
                      : "border border-transparent"
                  }`}
                >
                  <span className="w-5 text-center shrink-0">{v.status === "building" ? "…" : medal || "•"}</span>
                  <span className="font-mono font-semibold text-neutral-200 shrink-0">{v.label}</span>
                  <span className="flex-1 truncate text-neutral-400">{v.changeSummary}</span>
                  <span className="shrink-0 tabular-nums text-neutral-300 font-mono">
                    {v.status === "building" ? "—" : Math.round(v.score)}
                  </span>
                  {v.status === "kept" && <span className="shrink-0 text-[9px] font-semibold text-emerald-400 uppercase">kept</span>}
                </li>
              );
            })}
          </ul>
          {onJudge && (
            <button
              type="button"
              onClick={onJudge}
              className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-bold transition-colors cursor-pointer"
            >
              <Ear className="w-3.5 h-3.5" />
              Judge by ear →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
