import React from "react";
import { Repeat } from "lucide-react";
import { MAX_REFINE_LOOPS } from "../utils/refinementLoop";

/**
 * Perfecting-loop control: an on/off toggle plus a typed loop count
 * (1..MAX_REFINE_LOOPS). When on, every build gets N rework passes and only
 * iterations that measurably score higher are kept — the build report shows
 * each loop's outcome. Used in the Pro chat header and Simple Mode.
 */
interface RefineControlProps {
  /** 0 = off; 1..MAX_REFINE_LOOPS = enabled with that many passes. */
  loops: number;
  onChange: (loops: number) => void;
  variant?: "pro" | "simple";
}

export default function RefineControl({ loops, onChange, variant = "pro" }: RefineControlProps) {
  const enabled = loops > 0;

  const containerClass =
    variant === "pro"
      ? "flex items-center gap-1.5 bg-neutral-900/80 border border-neutral-800 px-2 py-0.5 rounded-lg select-none"
      : "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 select-none";

  return (
    <div
      className={containerClass}
      title={`Perfecting loop: after each build, rework it up to N times and keep only versions that score higher (max ${MAX_REFINE_LOOPS}). Every loop's outcome shows in the build report.`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle perfecting loop"
        onClick={() => onChange(enabled ? 0 : 3)}
        className={`flex items-center gap-1 cursor-pointer transition-colors ${
          enabled ? "text-orange-400" : "text-neutral-500 hover:text-neutral-300"
        }`}
      >
        <Repeat className={variant === "pro" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        <span className={variant === "pro" ? "text-[8.5px] font-mono font-bold tracking-wider" : "font-medium"}>
          {variant === "pro" ? "PERFECT" : "Perfect"}
        </span>
      </button>
      {enabled && (
        <>
          <span className={`${variant === "pro" ? "text-[8.5px]" : "text-xs"} text-neutral-500`}>×</span>
          <input
            type="number"
            min={1}
            max={MAX_REFINE_LOOPS}
            value={loops}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) onChange(Math.max(1, Math.min(MAX_REFINE_LOOPS, n)));
            }}
            aria-label="Number of perfecting loops"
            className={`bg-neutral-950 border border-neutral-800 focus:border-orange-700 outline-none rounded text-center text-neutral-200 cursor-text ${
              variant === "pro" ? "w-9 text-[10px] px-1 py-0.5" : "w-11 text-xs px-1 py-0.5"
            }`}
          />
        </>
      )}
    </div>
  );
}
