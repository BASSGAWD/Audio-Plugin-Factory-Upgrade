import { Plus, Trash2 } from "lucide-react";
import type { AutomationLane, AutomationPoint, Track } from "./model";

type AutomationTarget = AutomationLane["target"];

interface AutomationPanelProps {
  tracks: Track[];
  trackId: string | null;
  parameter: "gain" | "pan";
  points: AutomationPoint[];
  onTrack: (id: string) => void;
  onParameter: (parameter: "gain" | "pan") => void;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<AutomationPoint>) => void;
  onDelete: (id: string) => void;
  /**
   * Lets a project owner select a plugin lane without changing the legacy
   * track gain/pan callback contract. `points` must represent this target.
   */
  selectedTarget?: AutomationTarget;
  onTarget?: (target: AutomationTarget) => void;
  parameterRanges?: Record<string, { min: number; max: number }>;
}

export default function AutomationPanel(props: AutomationPanelProps) {
  const pluginTargets = props.tracks.flatMap((track) => track.inserts.flatMap((insert) =>
    Object.keys(insert.parameters).map((parameterId) => ({
      kind: "plugin" as const,
      ownerId: insert.id,
      parameterId,
      label: `${track.name} · ${insert.name} · ${parameterId}`,
    }))));
  const isPluginTarget = props.selectedTarget?.kind === "plugin";
  const targetValue = isPluginTarget
    ? `plugin:${props.selectedTarget.ownerId}:${props.selectedTarget.parameterId}`
    : props.parameter;
  const range = isPluginTarget
    ? props.parameterRanges?.[`${props.selectedTarget.ownerId}:${props.selectedTarget.parameterId}`] ?? { min: 0, max: 1 }
    : props.parameter === "pan" ? { min: -1, max: 1 } : { min: 0, max: 1.5 };

  const selectTarget = (value: string) => {
    if (value === "gain" || value === "pan") {
      props.onParameter(value);
      return;
    }
    const [, ownerId, ...parameterParts] = value.split(":");
    const parameterId = parameterParts.join(":");
    if (ownerId && parameterId) props.onTarget?.({ kind: "plugin", ownerId, parameterId });
  };
  return (
    <section aria-label="Automation editor" className="h-full flex flex-col">
      <div className="h-10 border-b border-neutral-800 flex items-center gap-2 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider">Automation</h2>
        <select data-testid="select-automation-track" aria-label="Automation track" value={props.trackId ?? ""} onChange={(e) => props.onTrack(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded p-1 text-[11px]"><option value="" disabled>Select track</option>{props.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select>
        <select data-testid="select-automation-parameter" aria-label="Automation parameter" value={targetValue} onChange={(e) => selectTarget(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded p-1 text-[11px]">
          <optgroup label="Track">
            <option value="gain">Track gain</option>
            <option value="pan">Track pan</option>
          </optgroup>
          {pluginTargets.length > 0 && <optgroup label="Plugin parameters">
            {pluginTargets.map((target) => <option key={`${target.ownerId}:${target.parameterId}`} value={`plugin:${target.ownerId}:${target.parameterId}`} disabled={!props.onTarget}>{target.label}</option>)}
          </optgroup>}
        </select>
        <button data-testid="button-add-automation-point" type="button" disabled={!props.trackId} onClick={props.onAdd} className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-neutral-800 disabled:opacity-30"><Plus className="w-3 h-3" /> Point</button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {props.points.length === 0 ? <p data-testid="status-empty-automation" className="text-xs text-neutral-500">No automation points. Add one at the playhead.</p> : (
          <div className="space-y-2">{props.points.map((point) => <div data-testid={`row-automation-${point.id}`} key={point.id} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center bg-neutral-900 rounded p-2">
            <label className="text-[10px] text-neutral-500">TIME <input data-testid={`input-automation-time-${point.id}`} aria-label="Automation point time" type="number" min={0} step={.01} value={point.time} onChange={(e) => props.onChange(point.id, { time: Math.max(0, Number(e.target.value)) })} className="w-full bg-neutral-950 border border-neutral-700 rounded p-1 text-neutral-200" /></label>
            <label className="text-[10px] text-neutral-500">VALUE <input data-testid={`input-automation-value-${point.id}`} aria-label="Automation point value" type="range" min={range.min} max={range.max} step={.01} value={point.value} onChange={(e) => props.onChange(point.id, { value: Number(e.target.value) })} className="w-full accent-orange-500" /></label>
            <button data-testid={`button-delete-automation-${point.id}`} type="button" onClick={() => props.onDelete(point.id)} aria-label="Delete automation point" className="text-neutral-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>)}</div>
        )}
      </div>
    </section>
  );
}