import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, GripVertical, Plus, Scissors, Trash2 } from "lucide-react";
import type { AudioAsset, AudioClip, Track, TrackColor } from "./model";

interface ArrangementViewProps {
  tracks: Track[];
  assets: AudioAsset[];
  duration: number;
  position: number;
  zoom: number;
  snap: number;
  selectedClipId: string | null;
  onAddTrack: () => void;
  onTrackChange: (id: string, patch: Partial<Track>) => void;
  onMoveTrack: (id: string, direction: -1 | 1) => void;
  onDeleteTrack: (id: string) => void;
  onSelectClip: (id: string) => void;
  onClipChange: (trackId: string, clipId: string, patch: Partial<AudioClip>) => void;
  onSplitClip: (trackId: string, clipId: string) => void;
  onDeleteClip: (trackId: string, clipId: string) => void;
  onSeek: (time: number) => void;
  onZoom: (zoom: number) => void;
  onSnap: (snap: number) => void;
}

const COLORS: TrackColor[] = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#f43f5e"];
const MIN_CLIP_DURATION = .05;

type ClipGesture = {
  trackId: string;
  clip: AudioClip;
  originX: number;
  kind: "move" | "trim-start" | "trim-end";
};

function snapTime(time: number, grid: number) {
  const nonNegative = Math.max(0, time);
  return grid > 0 ? Math.round(nonNegative / grid) * grid : nonNegative;
}

export default function ArrangementView(props: ArrangementViewProps) {
  const pxPerSecond = 18 * props.zoom;
  const canvasWidth = Math.max(900, props.duration * pxPerSecond);
  const [gesture, setGesture] = useState<ClipGesture | null>(null);

  useEffect(() => {
    if (!gesture) return;
    const finish = () => setGesture(null);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [gesture]);

  const beginGesture = (event: ReactPointerEvent, trackId: string, clip: AudioClip, kind: ClipGesture["kind"]) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelectClip(clip.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setGesture({ trackId, clip, originX: event.clientX, kind });
  };

  const updateGesture = (event: ReactPointerEvent) => {
    if (!gesture) return;
    const delta = (event.clientX - gesture.originX) / pxPerSecond;
    const { clip, trackId, kind } = gesture;
    if (kind === "move") {
      props.onClipChange(trackId, clip.id, { start: snapTime(clip.start + delta, props.snap) });
      return;
    }
    if (kind === "trim-start") {
      const start = Math.min(clip.start + clip.duration - MIN_CLIP_DURATION, snapTime(clip.start + delta, props.snap));
      // Moving the left edge earlier reveals existing source rather than
      // rewriting it; the clip offset is the durable non-destructive trim.
      const clampedStart = Math.max(0, clip.start - clip.offset, start);
      props.onClipChange(trackId, clip.id, {
        start: clampedStart,
        offset: clip.offset + (clampedStart - clip.start),
        duration: clip.duration - (clampedStart - clip.start),
      });
      return;
    }
    const maximum = clip.loop ? Number.MAX_SAFE_INTEGER : Math.max(MIN_CLIP_DURATION, clip.sourceDuration - clip.offset);
    const duration = Math.min(maximum, Math.max(MIN_CLIP_DURATION, snapTime(clip.duration + delta, props.snap)));
    props.onClipChange(trackId, clip.id, { duration });
  };

  const keyboardEdit = (event: React.KeyboardEvent, trackId: string, clip: AudioClip) => {
    const step = props.snap || .01;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    props.onSelectClip(clip.id);
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    if (!event.altKey) {
      props.onClipChange(trackId, clip.id, { start: snapTime(clip.start + direction * step, props.snap) });
    } else if (direction > 0) {
      const duration = Math.min(clip.loop ? Number.MAX_SAFE_INTEGER : clip.sourceDuration - clip.offset, clip.duration + step);
      props.onClipChange(trackId, clip.id, { duration: Math.max(MIN_CLIP_DURATION, duration) });
    } else if (clip.duration > MIN_CLIP_DURATION) {
      const trim = Math.min(step, clip.duration - MIN_CLIP_DURATION);
      props.onClipChange(trackId, clip.id, { start: clip.start + trim, offset: clip.offset + trim, duration: clip.duration - trim });
    }
  };
  return (
    <section aria-label="Arrangement" className="flex-1 min-h-0 flex flex-col bg-neutral-950">
      <div className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Arrangement</h2>
          <button data-testid="button-add-audio-track" type="button" onClick={props.onAddTrack} className="text-[11px] flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"><Plus className="w-3 h-3" /> Audio track</button>
        </div>
        <div className="flex gap-3 text-[10px] text-neutral-400">
          <label>Snap <select data-testid="select-grid-snap" value={props.snap} onChange={(e) => props.onSnap(Number(e.target.value))} className="ml-1 bg-neutral-900 border border-neutral-700 rounded p-1"><option value={0}>Off</option><option value={0.25}>1/16</option><option value={0.5}>1/8</option><option value={1}>1/4</option></select></label>
          <label>Zoom <input data-testid="input-timeline-zoom" aria-label="Timeline zoom" type="range" min={0.5} max={3} step={0.25} value={props.zoom} onChange={(e) => props.onZoom(Number(e.target.value))} className="w-20 accent-orange-500" /></label>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex sticky top-0 z-20 bg-neutral-950">
          <div className="w-56 shrink-0 h-7 border-r border-b border-neutral-800" />
          <button data-testid="button-timeline-ruler" type="button" aria-label="Timeline ruler; click to seek" onClick={(e) => props.onSeek(Math.max(0, (e.nativeEvent.offsetX / pxPerSecond)))} className="relative h-7 border-b border-neutral-800 text-left" style={{ width: canvasWidth }}>
            {Array.from({ length: Math.ceil(canvasWidth / (pxPerSecond * 4)) }, (_, i) => <span key={i} className="absolute text-[9px] text-neutral-500 border-l border-neutral-700 h-full pl-1" style={{ left: i * pxPerSecond * 4 }}>{i * 4}s</span>)}
          </button>
        </div>
        {props.tracks.map((track, index) => (
          <div key={track.id} data-testid={`row-track-${track.id}`} className="flex h-24 border-b border-neutral-800">
            <div className="w-56 shrink-0 p-2 flex gap-2 border-r border-neutral-800 bg-neutral-900/70">
              <div className="w-1 rounded-full" style={{ backgroundColor: track.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <GripVertical className="w-3 h-3 text-neutral-600" />
                  <input data-testid={`input-track-name-${track.id}`} aria-label={`Rename ${track.name}`} value={track.name} onChange={(e) => props.onTrackChange(track.id, { name: e.target.value })} className="w-full bg-transparent text-xs font-medium outline-none focus:ring-1 ring-orange-500 rounded px-1" />
                </div>
                <div className="flex gap-1 mt-2">
                  {(["mute", "solo", "armed"] as const).map((key) => <button data-testid={`button-track-${key}-${track.id}`} key={key} type="button" aria-pressed={track[key]} onClick={() => props.onTrackChange(track.id, { [key]: !track[key] })} className={`w-7 h-6 rounded text-[9px] font-bold uppercase ${track[key] ? key === "armed" ? "bg-rose-600 text-white" : "bg-orange-500 text-black" : "bg-neutral-800 text-neutral-400"}`}>{key[0]}</button>)}
                  <select data-testid={`select-track-color-${track.id}`} aria-label={`Color for ${track.name}`} value={track.color} onChange={(e) => props.onTrackChange(track.id, { color: e.target.value as TrackColor })} className="w-8 bg-neutral-800 rounded text-[0px]">{COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <button data-testid={`button-track-up-${track.id}`} type="button" disabled={index === 0} onClick={() => props.onMoveTrack(track.id, -1)} aria-label={`Move ${track.name} up`} className="text-[10px] disabled:opacity-20">↑</button>
                  <button data-testid={`button-track-down-${track.id}`} type="button" disabled={index === props.tracks.length - 1} onClick={() => props.onMoveTrack(track.id, 1)} aria-label={`Move ${track.name} down`} className="text-[10px] disabled:opacity-20">↓</button>
                  <button data-testid={`button-delete-track-${track.id}`} type="button" onClick={() => props.onDeleteTrack(track.id)} aria-label={`Delete ${track.name}`} className="ml-auto text-neutral-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
            <div onPointerMove={updateGesture} className="relative bg-[linear-gradient(to_right,rgba(82,82,91,.22)_1px,transparent_1px)]" style={{ width: canvasWidth, backgroundSize: `${pxPerSecond * Math.max(.25, props.snap || 1)}px 100%` }}>
              <div className="absolute z-10 top-0 bottom-0 w-px bg-orange-400 pointer-events-none" style={{ left: props.position * pxPerSecond }} />
              {track.clips.map((clip) => (
                <div data-testid={`button-clip-${clip.id}`} role="button" tabIndex={0} key={clip.id} onClick={() => props.onSelectClip(clip.id)} onKeyDown={(event) => keyboardEdit(event, track.id, clip)} onPointerDown={(event) => beginGesture(event, track.id, clip, "move")} aria-label={`${clip.name}, starts ${clip.start.toFixed(2)} seconds, duration ${clip.duration.toFixed(2)} seconds. Arrow keys move; Alt plus arrows trims.`} className={`absolute top-3 h-16 rounded-md border px-2 text-left overflow-hidden cursor-grab touch-none ${props.selectedClipId === clip.id ? "border-white ring-2 ring-white/30" : "border-black/30"}`} style={{ left: clip.start * pxPerSecond, width: Math.max(28, clip.duration * pxPerSecond), backgroundColor: `${track.color}b8` }}>
                  <span data-testid={`handle-clip-trim-start-${clip.id}`} role="separator" aria-label={`Trim start of ${clip.name}`} onPointerDown={(event) => beginGesture(event, track.id, clip, "trim-start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30" />
                  <span data-testid={`handle-clip-trim-end-${clip.id}`} role="separator" aria-label={`Trim end of ${clip.name}`} onPointerDown={(event) => beginGesture(event, track.id, clip, "trim-end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" />
                  <span className="block truncate text-[10px] font-semibold text-white">{clip.name}</span>
                  <span aria-hidden className="flex h-8 items-center gap-px opacity-60 overflow-hidden">
                    {(props.assets.find((asset) => asset.id === clip.assetId)?.waveform ?? []).filter((_, index, values) => index % Math.max(1, Math.ceil(values.length / 36)) === 0).slice(0, 36).map((peak, index) => (
                      <span key={index} className="w-px shrink-0 bg-white" style={{ height: `${Math.max(2, peak * 100)}%` }} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {props.tracks.length === 0 && <div data-testid="status-empty-arrangement" className="p-12 text-center text-sm text-neutral-500">No tracks yet. Add an audio track to begin.</div>}
      </div>
      {props.selectedClipId && (() => {
        const owner = props.tracks.find((t) => t.clips.some((c) => c.id === props.selectedClipId));
        const clip = owner?.clips.find((c) => c.id === props.selectedClipId);
        if (!owner || !clip) return null;
        return <div className="h-12 shrink-0 border-t border-neutral-800 px-3 flex items-center gap-3 text-[11px]">
          <strong className="truncate max-w-36">{clip.name}</strong>
          <label>Start <input data-testid="input-clip-start" type="number" min={0} step={props.snap || .01} value={clip.start} onChange={(e) => props.onClipChange(owner.id, clip.id, { start: Math.max(0, Number(e.target.value)) })} className="w-16 ml-1 bg-neutral-900 border border-neutral-700 rounded p-1" /></label>
          <label>Offset <input data-testid="input-clip-offset" type="number" min={0} max={Math.max(0, clip.sourceDuration - clip.duration)} step={props.snap || .01} value={clip.offset} onChange={(e) => props.onClipChange(owner.id, clip.id, { offset: Math.max(0, Math.min(clip.sourceDuration - clip.duration, Number(e.target.value))) })} className="w-16 ml-1 bg-neutral-900 border border-neutral-700 rounded p-1" /></label>
          <label>Length <input data-testid="input-clip-duration" type="number" min={.05} max={clip.loop ? undefined : Math.max(.05, clip.sourceDuration - clip.offset)} step={props.snap || .01} value={clip.duration} onChange={(e) => props.onClipChange(owner.id, clip.id, { duration: Math.max(.05, Math.min(clip.loop ? Number.MAX_SAFE_INTEGER : clip.sourceDuration - clip.offset, Number(e.target.value))) })} className="w-16 ml-1 bg-neutral-900 border border-neutral-700 rounded p-1" /></label>
          <button data-testid="button-loop-clip" type="button" onClick={() => props.onClipChange(owner.id, clip.id, { loop: !clip.loop })} aria-pressed={clip.loop} className="flex gap-1 items-center"><Copy className="w-3 h-3" /> Loop</button>
          <button data-testid="button-split-clip" type="button" onClick={() => props.onSplitClip(owner.id, clip.id)} className="flex gap-1 items-center"><Scissors className="w-3 h-3" /> Split at playhead</button>
          <button data-testid="button-delete-clip" type="button" onClick={() => props.onDeleteClip(owner.id, clip.id)} className="text-rose-400 ml-auto">Delete clip</button>
        </div>;
      })()}
    </section>
  );
}