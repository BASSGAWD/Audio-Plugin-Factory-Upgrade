import React from "react";
import { CrewMember, crewSummary } from "../utils/buildCrew";

/**
 * Who actually worked on this build.
 *
 * Replaces a checklist that was driven by a 1400ms `setInterval` and showed
 * the same "Consulting Aero… Consulting Decibel…" sequence whether a model
 * did all the work or none of it. Every row here is derived from the
 * pipeline's own real JobTrace (buildPlanner.ts), so a specialist whose model
 * call failed and was covered by the deterministic compiler shows a fallback
 * marker and says so, instead of a green check it didn't earn.
 */
export default function BuildCrewPanel({ crew }: { crew: CrewMember[] }) {
  if (crew.length === 0) return null;

  return (
    <div className="pt-2.5 border-t border-neutral-850 space-y-2">
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-neutral-500">
        Build crew
        <span className="ml-auto normal-case tracking-normal text-neutral-600">{crewSummary(crew)}</span>
      </div>

      {crew.map((m, idx) => {
        const { status } = m;
        const isDone = status === "done" || status === "repaired";
        const isFallback = status === "fallback";
        const isSkipped = status === "skipped";
        const isWorking = status === "working";

        return (
          <div
            key={`${m.agentId}-${idx}`}
            className={`flex items-start gap-2.5 transition-all duration-300 ${
              isWorking ? "opacity-100" : isDone ? "opacity-80" : isFallback || isSkipped ? "opacity-50" : "opacity-25"
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {status === "done" ? (
                <div className="w-3.5 h-3.5 rounded-full bg-emerald-950/80 border border-emerald-500/80 flex items-center justify-center">
                  <span className="text-[8px] text-emerald-400 font-bold font-mono">✓</span>
                </div>
              ) : status === "repaired" ? (
                <div className="w-3.5 h-3.5 rounded-full bg-sky-950/70 border border-sky-600/80 flex items-center justify-center" title="Succeeded, but needed a repair pass">
                  <span className="text-[8px] text-sky-400 font-bold font-mono">↻</span>
                </div>
              ) : isWorking ? (
                <div className="w-3.5 h-3.5 rounded-full bg-orange-950/80 border border-orange-500/80 flex items-center justify-center animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                </div>
              ) : isFallback ? (
                <div className="w-3.5 h-3.5 rounded-full bg-amber-950/60 border border-amber-700/70 flex items-center justify-center" title="No model output — the deterministic compiler produced this">
                  <span className="text-[8px] text-amber-500 font-bold font-mono">!</span>
                </div>
              ) : isSkipped ? (
                <div className="w-3.5 h-3.5 rounded-full bg-neutral-950 border border-neutral-700 flex items-center justify-center" title="Not needed for this build">
                  <span className="text-[8px] text-neutral-500 font-bold font-mono">–</span>
                </div>
              ) : (
                <div className="w-3.5 h-3.5 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                  <span className="w-1 h-1 rounded-full bg-neutral-700" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p
                className={`text-[10.5px] leading-snug font-sans ${
                  isWorking ? "text-orange-200 font-medium" : isDone ? "text-neutral-300" : "text-neutral-500"
                }`}
              >
                <span className="font-semibold">{m.name}</span>
                <span className="text-neutral-500"> — {m.job}</span>
              </p>
              {m.detail && (
                <p className={`text-[9.5px] leading-snug mt-0.5 truncate ${isFallback ? "text-amber-500/80" : "text-neutral-600"}`} title={m.detail}>
                  {m.detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
