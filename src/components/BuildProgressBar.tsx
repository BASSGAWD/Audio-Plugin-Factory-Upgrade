import React from "react";
import { Check } from "lucide-react";

/**
 * Build status bar with checkpoint markers. Stages are driven by REAL
 * pipeline callbacks (planner jobs, perfecting-loop iterations) — never a
 * fake timer. Shown while a build is in flight in both Simple and Pro chat.
 */
export interface BuildStage {
  id: string;
  label: string;
  status: "pending" | "active" | "done";
  /** Small live detail, e.g. "3/25" during the perfecting loop. */
  note?: string;
}

export default function BuildProgressBar({ stages }: { stages: BuildStage[] }) {
  if (stages.length === 0) return null;
  const doneCount = stages.filter((s) => s.status === "done").length;
  const activeIdx = stages.findIndex((s) => s.status === "active");
  const progress = Math.min(1, (doneCount + (activeIdx >= 0 ? 0.5 : 0)) / stages.length);

  return (
    <div className="w-full max-w-2xl mx-auto select-none" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Plugin build progress">
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
  );
}
