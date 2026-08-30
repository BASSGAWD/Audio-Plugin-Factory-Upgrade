import React from "react";
import { AlertTriangle, ShieldCheck, Zap, Activity, Info } from "lucide-react";
import { DSPAnalysisResult, DspCritiqueItem } from "../types";

interface DSPAnalyzerProps {
  analysis: DSPAnalysisResult | null;
  isLoading: boolean;
  onRunAudit: () => void;
  onApplyFix: (fix: DspCritiqueItem) => void;
  isAutoFixing?: boolean;
}

export default function DSPAnalyzer({
  analysis,
  isLoading,
  onRunAudit,
  onApplyFix,
  isAutoFixing = false,
}: DSPAnalyzerProps) {

  // Color mapper based on stability rating
  const getPurityColor = (score: number) => {
    if (score >= 90) return "text-emerald-600 bg-emerald-50 border-emerald-100";
    if (score >= 70) return "text-amber-600 bg-amber-50 border-amber-100";
    return "text-red-600 bg-red-50 border-red-100";
  };

  const getStabilityIcon = (score: number) => {
    if (score >= 80) return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
    return <AlertTriangle className="w-5 h-5 text-amber-500" />;
  };

  return (
    <div id="dsp-analyzer" className="bg-white rounded-2xl border border-neutral-200/80 p-4 shadow-3xs space-y-4">
      {/* 1. Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-950 flex items-center justify-center text-white">
            <Activity className="w-4 h-4 text-[#da9902]" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-neutral-400">Signal Diagnostics</span>
            <h4 className="font-display font-semibold text-xs text-neutral-800">Decibel Stability Scan</h4>
          </div>
        </div>

        <button
          onClick={onRunAudit}
          disabled={isLoading || isAutoFixing}
          className="text-[11px] font-sans font-bold text-neutral-800 hover:text-white bg-neutral-100 hover:bg-neutral-900 border border-neutral-300 hover:border-neutral-950 rounded-xl px-3.5 py-2 transition-all disabled:opacity-40 select-none cursor-pointer"
        >
          {isAutoFixing ? "Fixing recursively..." : isLoading ? "Auditing Code..." : "Run Performance Audit"}
        </button>
      </div>

      {isLoading && (
        <div className="py-12 text-center space-y-2 select-none">
          <div className="inline-block relative w-9 h-9 border-4 border-amber-500/10 border-t-amber-500 rounded-full animate-spin"></div>
          <p className="text-xs text-neutral-500 font-mono">
            {isAutoFixing ? "Applying self-healing patches recursively until 100% pristine..." : "Running high-precision DSP security scan..."}
          </p>
        </div>
      )}

      {/* 3. Analysis Dashboard Results */}
      {!isLoading && analysis && (
        <div className="space-y-4 animate-fadeIn">
          <div className="grid grid-cols-3 gap-3">
            {/* Score item */}
            <div className={`p-3 rounded-xl border text-center ${getPurityColor(analysis.purityScore)}`}>
              <span className="block text-[9px] font-bold font-mono uppercase tracking-widest opacity-80 mb-1">Purity Score</span>
              <div className="flex items-center justify-center gap-1">
                {getStabilityIcon(analysis.purityScore)}
                <span className="text-lg font-display font-bold">{analysis.purityScore}%</span>
              </div>
            </div>

            {/* Stability factor */}
            <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-center">
              <span className="block text-[9px] font-bold font-mono text-neutral-450 uppercase tracking-widest mb-1">Stability Factor</span>
              <span className="inline-block text-[11px] font-bold text-neutral-700 bg-white border px-2 py-0.5 rounded-full mt-0.5 truncate max-w-full">
                {analysis.stabilityAssessment}
              </span>
            </div>

            {/* Performance footprint */}
            <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-center col-span-1">
              <span className="block text-[9px] font-bold font-mono text-neutral-450 uppercase tracking-widest mb-1">Complexity Burden</span>
              <div className="flex items-center justify-center gap-1 mt-1 text-sky-600 font-bold text-[11px]">
                <Zap className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span className="truncate">{analysis.performanceEstimate}</span>
              </div>
            </div>
          </div>

          {/* Core math critique summary */}
          <div className="bg-sky-50/50 border border-sky-100 rounded-xl p-3 text-xs leading-relaxed text-sky-900 font-sans flex items-start gap-2">
            <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block mb-0.5 text-sky-950">Architectural Critique:</strong>
              {analysis.mathCritique}
            </div>
          </div>

          {/* Suggestions Accordions */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-b pb-1.5">
              <span className="text-[10px] font-bold font-mono text-neutral-400 uppercase tracking-widest">
                Detected Anomalies & Auto-Fix recommendation
              </span>
              {analysis.suggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() => onApplyFix(analysis.suggestions[0])}
                  disabled={isLoading || isAutoFixing}
                  className="text-[9.5px] font-extrabold uppercase tracking-wider text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 rounded-md px-2 py-0.5 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-40 select-none active:scale-95"
                >
                  {isAutoFixing ? "⚙️ Healing Loop Active..." : "✨ Auto-Fix All"}
                </button>
              )}
            </div>

            {analysis.suggestions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/20 p-4 text-center">
                <p className="text-xs text-emerald-700 font-bold font-sans">No signal integrity warnings detected!</p>
                <p className="text-[10px] text-neutral-500 mt-0.5">Your calculations are theoretically safe, non-allocating, and mathematically stable.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[220px] overflow-y-auto scrollbar-thin">
                {analysis.suggestions.map((item, index) => (
                  <div key={index} className="border border-neutral-150 rounded-xl p-3 space-y-2 text-xs">
                    <div className="flex items-start justify-between">
                      <span className="bg-rose-50 text-rose-700 font-mono font-bold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-widest">
                        {item.category}
                      </span>
                      <button
                        onClick={() => onApplyFix(item)}
                        disabled={isLoading || isAutoFixing}
                        className="text-[10px] font-bold text-sky-600 hover:text-white bg-sky-50 hover:bg-sky-800 border border-sky-200 hover:border-sky-800 rounded-lg px-2.5 py-1 transition-all flex items-center gap-1 active:scale-95 cursor-pointer select-none disabled:opacity-40"
                      >
                        {isAutoFixing ? "Healing..." : "Auto-Fix Code"}
                      </button>
                    </div>

                    <div className="space-y-1">
                      <div className="text-neutral-450 text-[10px] font-mono">DANGEROUS PHRASE:</div>
                      <code className="block bg-neutral-900 border border-neutral-950 text-rose-400 p-2 rounded-lg font-mono text-[10px] whitespace-pre-wrap">
                        {item.snippet}
                      </code>
                    </div>

                    <div className="text-neutral-600 leading-relaxed font-sans">
                      {item.issue}
                    </div>

                    <div className="space-y-1">
                      <div className="text-emerald-600 text-[10px] font-bold font-mono">STABILIZED ALTERNATIVE:</div>
                      <code className="block bg-emerald-950/20 border border-emerald-100 text-emerald-800 p-2 rounded-lg font-mono text-[10px] whitespace-pre-wrap">
                        {item.recommendationCode}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!analysis && !isLoading && (
        <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center text-neutral-400 space-y-1">
          <p className="text-xs font-semibold">Stability Sweep Idle</p>
          <p className="text-[10px] font-sans text-neutral-500">Run a security check to inspect clipping risk, filter singularities, and check JavaScript memory leak status.</p>
        </div>
      )}
    </div>
  );
}
