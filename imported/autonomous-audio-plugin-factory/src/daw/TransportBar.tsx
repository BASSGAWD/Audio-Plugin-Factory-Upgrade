import { ChevronLeft, ChevronRight, Circle, Pause, Play, RotateCcw, RotateCw, Square } from "lucide-react";

interface TransportBarProps {
  playing: boolean;
  position: number;
  duration: number;
  tempo: number;
  signature: string;
  loop: boolean;
  metronome: boolean;
  countIn: boolean;
  loopStart: number;
  loopEnd: number;
  canUndo: boolean;
  canRedo: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onTempo: (tempo: number) => void;
  onSignature: (signature: string) => void;
  onLoop: () => void;
  onMetronome: () => void;
  onCountIn: () => void;
  onLoopRange: (start: number, end: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const clock = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
};

export default function TransportBar(props: TransportBarProps) {
  return (
    <section aria-label="Transport" className="h-16 shrink-0 border-b border-neutral-800 bg-neutral-950 flex items-center gap-3 px-4 overflow-x-auto">
      <div className="flex items-center gap-1">
        <button data-testid="button-undo-edit" type="button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo edit" className="p-2 rounded-md hover:bg-neutral-800 disabled:opacity-30"><RotateCcw className="w-4 h-4" /></button>
        <button data-testid="button-redo-edit" type="button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo edit" className="p-2 rounded-md hover:bg-neutral-800 disabled:opacity-30"><RotateCw className="w-4 h-4" /></button>
      </div>
      <div className="h-7 w-px bg-neutral-800" />
      <button data-testid="button-previous-marker" type="button" onClick={() => props.onSeek(Math.max(0, props.position - 4))} aria-label="Rewind four seconds" className="p-2 rounded-md hover:bg-neutral-800"><ChevronLeft className="w-4 h-4" /></button>
      <button data-testid="button-transport-stop" type="button" onClick={props.onStop} aria-label="Stop" className="p-2 rounded-md hover:bg-neutral-800"><Square className="w-3.5 h-3.5 fill-current" /></button>
      <button data-testid="button-transport-play" type="button" onClick={props.onPlayPause} aria-label={props.playing ? "Pause" : "Play"} aria-pressed={props.playing} className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-400 text-neutral-950 flex items-center justify-center">
        {props.playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
      <button data-testid="button-next-marker" type="button" onClick={() => props.onSeek(Math.min(props.duration, props.position + 4))} aria-label="Forward four seconds" className="p-2 rounded-md hover:bg-neutral-800"><ChevronRight className="w-4 h-4" /></button>
      <button data-testid="button-record-shortcut" type="button" disabled title="Arm a track, then use the Record panel" aria-label="Record from armed track in record panel" className="p-2 text-rose-500 disabled:opacity-60"><Circle className="w-4 h-4 fill-current" /></button>
      <output data-testid="status-transport-time" aria-label="Transport position" className="font-mono text-sm text-orange-300 min-w-20">{clock(props.position)}</output>
      <input data-testid="input-transport-seek" aria-label="Seek timeline" type="range" min={0} max={Math.max(1, props.duration)} step={0.01} value={props.position} onChange={(event) => props.onSeek(Number(event.target.value))} className="w-36 accent-orange-500" />
      <label className="flex items-center gap-1 text-[11px] text-neutral-400">BPM
        <input data-testid="input-tempo" aria-label="Tempo" type="number" min={30} max={300} value={props.tempo} onChange={(event) => props.onTempo(Number(event.target.value))} className="w-16 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-100" />
      </label>
      <select data-testid="select-time-signature" aria-label="Time signature" value={props.signature} onChange={(event) => props.onSignature(event.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs">
        <option>4/4</option><option>3/4</option><option>6/8</option>
      </select>
      {[
        ["Loop", props.loop, props.onLoop, "button-toggle-loop"],
        ["Click", props.metronome, props.onMetronome, "button-toggle-metronome"],
        ["1 bar in", props.countIn, props.onCountIn, "button-toggle-count-in"],
      ].map(([label, active, action, testId]) => (
        <button data-testid={testId as string} key={label as string} type="button" onClick={action as () => void} aria-pressed={active as boolean} className={`text-[11px] px-2.5 py-1.5 rounded border ${(active as boolean) ? "bg-orange-500/15 border-orange-500 text-orange-300" : "border-neutral-700 text-neutral-400"}`}>{label as string}</button>
      ))}
      <label className="text-[10px] text-neutral-500">LOOP
        <input data-testid="input-loop-start" aria-label="Loop start" type="number" min={0} max={props.loopEnd - .01} step={.01} value={props.loopStart} onChange={(event) => props.onLoopRange(Number(event.target.value), props.loopEnd)} className="ml-1 w-14 bg-neutral-900 border border-neutral-700 rounded px-1 py-1" />
        <input data-testid="input-loop-end" aria-label="Loop end" type="number" min={props.loopStart + .01} step={.01} value={props.loopEnd} onChange={(event) => props.onLoopRange(props.loopStart, Number(event.target.value))} className="ml-1 w-14 bg-neutral-900 border border-neutral-700 rounded px-1 py-1" />
      </label>
    </section>
  );
}