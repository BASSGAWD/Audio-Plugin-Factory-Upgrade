import { Link2, Volume2 } from "lucide-react";
import type { Bus, Track } from "./model";
import type { EngineMeters } from "./realtimeAudioEngine";

interface MixerViewProps {
  tracks: Track[];
  sidechains: Record<string, string | null>;
  meters: EngineMeters;
  buses: Bus[];
  onChange: (id: string, patch: Partial<Track>) => void;
  onSend: (id: string, gain: number) => void;
  onSidechain: (destinationId: string, sourceId: string | null) => void;
  onBusChange: (id: string, patch: Partial<Bus>) => void;
}

function Meter({ meter }: { meter?: { level: number; peak: number } }) {
  const percent = Math.min(100, (meter?.level ?? 0) * 150);
  const peak = Math.min(100, (meter?.peak ?? 0) * 100);
  return <div aria-label={meter ? `Level ${(meter.level * 100).toFixed(0)}%, peak ${(meter.peak * 100).toFixed(0)}%` : "No metering signal"} className="relative h-24 w-2 rounded-full bg-neutral-800 overflow-hidden flex items-end"><div className="w-full bg-emerald-500 transition-all" style={{ height: `${percent}%` }} /><i className="absolute w-full h-px bg-orange-300" style={{ bottom: `${peak}%` }} /></div>;
}

export default function MixerView({ tracks, sidechains, meters, buses, onChange, onSend, onSidechain, onBusChange }: MixerViewProps) {
  return (
    <section aria-label="Mixer" className="h-full flex flex-col">
      <div className="px-4 h-10 shrink-0 flex items-center border-b border-neutral-800"><h2 className="text-xs font-semibold uppercase tracking-wider">Mixer</h2><span className="ml-auto text-[10px] text-neutral-500">Live RMS and peak meters</span></div>
      <div className="flex-1 overflow-x-auto p-3 flex items-stretch gap-2">
        {tracks.map((track) => (
          <article data-testid={`strip-mixer-${track.id}`} key={track.id} className="w-32 shrink-0 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex flex-col items-center">
            <div className="text-[11px] font-medium truncate w-full text-center">{track.name}</div>
            <div className="text-[9px] text-neutral-500 mt-1">{track.inserts.length ? `${track.inserts.length} transparent insert adapter${track.inserts.length > 1 ? "s" : ""}` : "No inserts"}</div>
            <div className="flex gap-3 mt-3">
              <Meter meter={meters.tracks[track.id]} />
              <input data-testid={`input-gain-${track.id}`} aria-label={`${track.name} gain`} className="h-24 accent-orange-500" style={{ writingMode: "vertical-lr", direction: "rtl" }} type="range" min={0} max={1.5} step={.01} value={track.gain} onChange={(e) => onChange(track.id, { gain: Number(e.target.value) })} />
            </div>
            <label className="text-[9px] text-neutral-500 mt-2">PAN
              <input data-testid={`input-pan-${track.id}`} aria-label={`${track.name} pan`} type="range" min={-1} max={1} step={.01} value={track.pan} onChange={(e) => onChange(track.id, { pan: Number(e.target.value) })} className="w-full accent-orange-500" />
            </label>
            <label className="text-[9px] text-neutral-500 mt-2">SEND A
              <input data-testid={`input-send-${track.id}`} aria-label={`${track.name} send to return A`} type="range" min={0} max={1} step={.01} value={track.sends[0]?.gain ?? 0} onChange={(e) => onSend(track.id, Number(e.target.value))} className="w-full accent-sky-500" />
            </label>
            <label className="mt-2 w-full text-[9px] text-neutral-500 flex items-center gap-1"><Link2 className="w-3 h-3" /> SIDECHAIN
              <select data-testid={`select-sidechain-${track.id}`} aria-label={`${track.name} sidechain source`} value={sidechains[track.id] ?? ""} onChange={(e) => onSidechain(track.id, e.target.value || null)} disabled={!track.inserts.some((insert) => insert.routing?.auxiliaryInput.supported)} className="w-full min-w-0 bg-neutral-950 border border-neutral-700 rounded p-1 text-neutral-300 disabled:opacity-50">
                <option value="">Internal</option>
                {tracks.filter((candidate) => candidate.id !== track.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <div className="flex gap-1 mt-auto pt-3">
              <button data-testid={`button-mixer-mute-${track.id}`} type="button" aria-pressed={track.mute} onClick={() => onChange(track.id, { mute: !track.mute })} className={`w-8 h-6 text-[9px] rounded ${track.mute ? "bg-orange-500 text-black" : "bg-neutral-800"}`}>M</button>
              <button data-testid={`button-mixer-solo-${track.id}`} type="button" aria-pressed={track.solo} onClick={() => onChange(track.id, { solo: !track.solo })} className={`w-8 h-6 text-[9px] rounded ${track.solo ? "bg-orange-500 text-black" : "bg-neutral-800"}`}>S</button>
            </div>
          </article>
        ))}
        {buses.map((bus) => <article key={bus.id} className={`w-32 shrink-0 rounded-lg p-2 text-center border ${bus.kind === "master" ? "bg-orange-950/20 border-orange-900/50" : "bg-sky-950/20 border-sky-900/50"}`}>
          {bus.kind === "master" && <Volume2 className="w-4 h-4 mx-auto text-orange-400" />}
          <div className="text-[11px] font-medium">{bus.name}</div><div className="mt-2 flex justify-center"><Meter meter={meters.buses[bus.id]} /></div>
          <label className="block text-[9px] text-neutral-500 mt-2">GAIN<input aria-label={`${bus.name} gain`} type="range" min={0} max={1.5} step={.01} value={bus.gain} onChange={(e) => onBusChange(bus.id, { gain: Number(e.target.value) })} className="w-full accent-orange-500" /></label>
          <label className="block text-[9px] text-neutral-500 mt-1">PAN<input aria-label={`${bus.name} pan`} type="range" min={-1} max={1} step={.01} value={bus.pan} onChange={(e) => onBusChange(bus.id, { pan: Number(e.target.value) })} className="w-full accent-orange-500" /></label>
        </article>)}
      </div>
    </section>
  );
}