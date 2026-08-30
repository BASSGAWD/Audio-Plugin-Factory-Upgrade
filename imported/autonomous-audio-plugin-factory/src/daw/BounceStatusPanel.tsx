import { AlertTriangle, Download, LoaderCircle } from "lucide-react";
export type BounceState =
  | { status: "idle" }
  | { status: "rendering"; progress: number }
  | { status: "complete"; fileName: string; clipped: boolean; url: string; peak: number; clippedSamples?: number }
  | { status: "failed"; error: string };

/** UI contract deliberately contains no rendering implementation details. */
export interface BounceStatusPanelProps {
  state: BounceState;
  hasClips: boolean;
  onBounce: () => void;
  onCancel: () => void;
  rangeLabel?: string;
  disabledReason?: string;
  rangeMode?: "full" | "selection";
  tailSeconds?: number;
  onRangeMode?: (mode: "full" | "selection") => void;
  onTailSeconds?: (seconds: number) => void;
}

export default function BounceStatusPanel({
  state, hasClips, onBounce, onCancel, rangeLabel = "Full arrangement", disabledReason, rangeMode = "full", tailSeconds = 0, onRangeMode, onTailSeconds,
}: BounceStatusPanelProps) {
  const unavailableReason = disabledReason ?? (!hasClips ? "Add at least one audio clip before bouncing." : undefined);
  return (
    <section aria-label="Offline bounce" className="h-full flex flex-col">
      <div className="h-10 px-3 border-b border-neutral-800 flex items-center"><h2 className="text-xs font-semibold uppercase tracking-wider">Bounce</h2></div>
      <div className="p-3 space-y-3">
        <p className="text-[11px] text-neutral-400">{rangeLabel} · WAV · master bus</p>
        <label className="block text-[10px] text-neutral-400">RANGE
          <select data-testid="select-bounce-range" value={rangeMode} onChange={(e) => onRangeMode?.(e.target.value as "full" | "selection")} className="ml-2 bg-neutral-900 border border-neutral-700 rounded p-1">
            <option value="full">Full arrangement</option><option value="selection">Loop range</option>
          </select>
        </label>
        <label className="block text-[10px] text-neutral-400">TAIL (seconds)
          <input data-testid="input-bounce-tail" type="number" min={0} max={30} step={.1} value={tailSeconds} onChange={(e) => onTailSeconds?.(Math.max(0, Math.min(30, Number(e.target.value))))} className="ml-2 w-16 bg-neutral-900 border border-neutral-700 rounded p-1" />
        </label>
        <button data-testid="button-start-bounce" type="button" disabled={Boolean(unavailableReason) || state.status === "rendering"} onClick={onBounce} className="w-full flex items-center justify-center gap-2 p-2 rounded bg-orange-500 text-neutral-950 text-xs font-semibold disabled:bg-neutral-800 disabled:text-neutral-500">
          <Download className="w-4 h-4" /> Bounce arrangement
        </button>
        {unavailableReason && <p data-testid="status-bounce-empty" className="text-[10px] text-neutral-500">{unavailableReason}</p>}
        {state.status === "rendering" && <div data-testid="status-bounce-rendering" role="status" aria-live="polite"><div className="flex text-[11px] items-center gap-2"><LoaderCircle className="w-3 h-3 animate-spin" /> Rendering {Math.round(state.progress * 100)}%</div><div className="mt-2 h-1 overflow-hidden rounded bg-neutral-800" role="progressbar" aria-label="Bounce progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}><div className="h-full bg-orange-500" style={{ width: `${Math.max(0, Math.min(1, state.progress)) * 100}%` }} /></div><button data-testid="button-cancel-bounce" type="button" onClick={onCancel} className="text-[10px] text-rose-400 mt-2">Cancel</button></div>}
        {state.status === "failed" && <p data-testid="status-bounce-failed" role="alert" className="text-[10px] text-rose-400">{state.error}</p>}
        {state.status === "complete" && <div data-testid="status-bounce-complete" role="status" className="text-[10px] text-emerald-400"><a data-testid="link-download-bounce" href={state.url} download={state.fileName} className="underline">Download {state.fileName}</a><p className="mt-1 text-neutral-500">Peak {state.peak.toFixed(3)}</p>{state.clipped && <p className="text-amber-400 mt-1"><AlertTriangle className="w-3 h-3 inline" /> Clipping detected{state.clippedSamples === undefined ? "" : ` (${state.clippedSamples} samples)`} in rendered output.</p>}</div>}
      </div>
    </section>
  );
}