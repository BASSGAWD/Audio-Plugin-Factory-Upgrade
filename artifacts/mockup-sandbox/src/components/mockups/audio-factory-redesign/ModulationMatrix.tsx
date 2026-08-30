import { useMemo, useState } from "react";
import { Cable, Check, CircleHelp, Download, Grid3X3, MoreHorizontal, Play, RotateCcw, Save, SlidersHorizontal, X } from "lucide-react";

type Route = { amount: number; color: string };

const sources = [
  { code: "LFO 01", name: "TIDAL SWELL", color: "#ed9365", meta: "0.18 Hz · sine" },
  { code: "ENV 02", name: "SHARPEN", color: "#d7c36e", meta: "A 12 ms · R 640 ms" },
  { code: "SEQ 03", name: "NIGHT DRIVE", color: "#8bb4b6", meta: "16 steps · 1/8" },
  { code: "MIDI", name: "KEY PRESSURE", color: "#b798bd", meta: "aftertouch · ch 01" },
  { code: "AUDIO", name: "ROOM RETURN", color: "#d18f7f", meta: "−18.4 dB · stereo" },
];

const destinations = [
  { code: "VCO 01", name: "PITCH" },
  { code: "VCO 01", name: "SHAPE" },
  { code: "FOLD 02", name: "BIAS" },
  { code: "FOLD 02", name: "DRIVE" },
  { code: "SPACE 03", name: "TIME" },
  { code: "SPACE 03", name: "MIX" },
  { code: "OUT", name: "PAN" },
  { code: "OUT", name: "LEVEL" },
];

const initialRoutes: Route[][] = [
  [{ amount: 48, color: "#ed9365" }, { amount: 23, color: "#ed9365" }, null as never, { amount: 17, color: "#ed9365" }, { amount: 68, color: "#ed9365" }, { amount: 38, color: "#ed9365" }, { amount: 52, color: "#ed9365" }, null as never],
  [{ amount: 17, color: "#d7c36e" }, { amount: 72, color: "#d7c36e" }, { amount: 61, color: "#d7c36e" }, { amount: 85, color: "#d7c36e" }, null as never, { amount: 24, color: "#d7c36e" }, null as never, { amount: 13, color: "#d7c36e" }],
  [{ amount: 32, color: "#8bb4b6" }, null as never, { amount: 46, color: "#8bb4b6" }, { amount: 21, color: "#8bb4b6" }, { amount: 77, color: "#8bb4b6" }, { amount: 54, color: "#8bb4b6" }, { amount: 63, color: "#8bb4b6" }, { amount: 40, color: "#8bb4b6" }],
  [null as never, { amount: 19, color: "#b798bd" }, null as never, null as never, { amount: 28, color: "#b798bd" }, { amount: 65, color: "#b798bd" }, { amount: 74, color: "#b798bd" }, { amount: 58, color: "#b798bd" }],
  [{ amount: 9, color: "#d18f7f" }, null as never, { amount: 18, color: "#d18f7f" }, { amount: 43, color: "#d18f7f" }, { amount: 35, color: "#d18f7f" }, { amount: 81, color: "#d18f7f" }, null as never, { amount: 49, color: "#d18f7f" }],
];

export function ModulationMatrix() {
  const [routes, setRoutes] = useState(initialRoutes);
  const [selected, setSelected] = useState<[number, number] | null>([2, 5]);
  const [playing, setPlaying] = useState(true);
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState("");
  const routeCount = useMemo(() => routes.flat().filter(Boolean).length, [routes]);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2200); };
  const toggleRoute = (r: number, c: number) => {
    setSelected([r, c]);
    setRoutes((old) => old.map((row, ri) => row.map((cell, ci) => ri === r && ci === c ? (cell ? null as never : { amount: 42, color: sources[r].color }) : cell)));
    setSaved(false);
  };
  const reset = () => { setRoutes(initialRoutes); setSaved(false); notify("Matrix returned to the last rehearsal map."); };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#e8e4d8] text-[#26332f]" style={{ fontFamily: "'Sora', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;500;600;700&display=swap');.mm-mono{font-family:'DM Mono',monospace}.mm-grain{background-image:radial-gradient(rgba(36,48,46,.12) .7px,transparent .7px);background-size:5px 5px}.mm-rack{background:linear-gradient(90deg,#293532 0 25px,#3a4842 25px calc(100% - 25px),#293532 calc(100% - 25px));box-shadow:0 28px 42px rgba(44,43,34,.19),inset 0 0 0 1px rgba(12,23,20,.65)}.mm-grid{background-image:linear-gradient(rgba(172,185,164,.1) 1px,transparent 1px),linear-gradient(90deg,rgba(172,185,164,.1) 1px,transparent 1px);background-size:24px 24px}`}</style>
      <header className="flex h-16 items-center justify-between border-b border-[#c7c4b7] bg-[#f4f0e5] px-4 md:px-7">
        <div className="flex items-center gap-3"><div className="mm-grain grid h-9 w-9 place-items-center rounded-[11px] bg-[#e6814f]"><Cable className="h-4 w-4" /></div><div className="leading-none"><b className="text-[13px] tracking-[-.07em]">ORANGEJUCE</b><span className="mm-mono ml-2 rounded border border-[#ddc2ad] bg-[#fff1e5] px-1.5 py-1 text-[8px] tracking-[.13em] text-[#a65333]">PATCH LAB</span><p className="mt-1 text-[10px] text-[#79827a]">Modulation matrix / dense view</p></div></div>
        <div className="flex items-center gap-2"><button onClick={() => notify("Every colored dot is a live modulation route.")} className="hidden rounded-md p-2 text-[#65716a] md:block"><CircleHelp className="h-4 w-4" /></button><button onClick={() => { setSaved(true); notify("Matrix snapshot saved."); }} className="mm-mono hidden items-center gap-2 rounded-lg border border-[#c5c8bc] bg-[#faf8f0] px-3 py-2 text-[9px] tracking-[.09em] sm:flex"><Save className="h-3 w-3" /><i className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-[#9dad60]" : "bg-[#df754b]"}`} />{saved ? "SAVED" : "SAVE"}</button><button onClick={() => notify("Matrix menu opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c5c8bc] bg-[#faf8f0]"><MoreHorizontal className="h-4 w-4" /></button></div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-7 md:px-8 md:py-10">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mm-mono mb-2 flex items-center gap-2 text-[9px] tracking-[.2em] text-[#a65333]"><Grid3X3 className="h-3 w-3" /> ROUTING SURFACE / 05 × 08</div><h1 className="text-[clamp(27px,4vw,48px)] font-semibold leading-[.95] tracking-[-.065em]">MODULATION<br /><span className="text-[#a65333]">MATRIX</span></h1></div><div className="max-w-[280px] text-right text-[11px] leading-relaxed text-[#68756d]">A live map of every pressure, pulse, and accident moving through the rack.</div></div>
        <section className="mm-rack rounded-[18px] p-3 md:p-5"><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${playing ? "animate-pulse bg-[#bdce7f]" : "bg-[#65736a]"}`} /><span className="mm-mono text-[9px] tracking-[.16em] text-[#bbc5bb]">{playing ? "SIGNAL FLOWING" : "MONITOR PAUSED"}</span></div><span className="mm-mono text-[9px] text-[#91a097]">{routeCount} ACTIVE ROUTES</span></div>
          <div className="overflow-x-auto rounded-[10px] border border-[#526159] bg-[#202a28]"><div className="min-w-[920px] p-3 md:p-5"><div className="grid grid-cols-[190px_repeat(8,1fr)] gap-1.5"><div className="mm-mono flex items-end pb-2 text-[8px] tracking-[.15em] text-[#899990]">SOURCE / DESTINATION</div>{destinations.map((d, i) => <div key={i} className="h-[70px] border-b border-[#475750] px-2 pb-2"><span className="mm-mono block text-[8px] text-[#b9c785]">{d.code}</span><span className="mt-1 block text-[10px] font-semibold leading-tight text-[#e4e9df]">{d.name}</span><div className="mt-2 h-1 rounded-full bg-[#425149]"><i className="block h-full w-1/3 rounded-full bg-[#aebf7c]" /></div></div>)}
              {sources.map((source, r) => <div key={source.code} className="contents"><div className="flex h-[68px] items-center gap-3 border-b border-[#475750] pr-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#66766c] bg-[#15201d] text-[9px] font-semibold" style={{ color: source.color }}>{String(r + 1).padStart(2, "0")}</span><div><span className="mm-mono block text-[8px] tracking-[.12em]" style={{ color: source.color }}>{source.code}</span><b className="block text-[10px] text-[#e4e9df]">{source.name}</b><span className="mm-mono block truncate text-[7px] text-[#8e9b92]">{source.meta}</span></div></div>{routes[r].map((route, c) => <button key={c} aria-label={`${source.name} to ${destinations[c].name}`} onClick={() => toggleRoute(r, c)} className={`relative grid h-[68px] place-items-center border border-[#3e4c45] transition-transform hover:scale-[.97] ${selected?.[0] === r && selected?.[1] === c ? "bg-[#49594e]" : "bg-[#293631]"}`}>{route ? <span className="grid h-8 w-8 place-items-center rounded-full border-2 bg-[#17221f] text-[9px] font-semibold shadow-[inset_0_0_0_3px_#25332e]" style={{ borderColor: route.color, color: route.color, transform: `scale(${0.72 + route.amount / 220})` }}>{route.amount}</span> : <span className="h-1.5 w-1.5 rounded-full bg-[#55645c]" />}{selected?.[0] === r && selected?.[1] === c && <Check className="absolute right-1 top-1 h-3 w-3 text-[#d9e2bb]" />}</button>)}</div>)}</div></div></div>
          <div className="mm-grid mt-3 flex min-h-14 items-center justify-between gap-4 rounded-lg border border-[#526159] px-4"><div className="mm-mono flex flex-wrap items-center gap-x-5 gap-y-2 text-[8px] text-[#b8c3b8]">{sources.map((s) => <span key={s.code} className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.code}</span>)}</div><span className="mm-mono hidden text-[8px] text-[#84948a] sm:block">CLICK A CELL TO PATCH / UNPATCH</span></div>
        </section>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><button onClick={() => setPlaying((v) => !v)} className="flex items-center gap-2 rounded-lg bg-[#273a34] px-4 py-2.5 text-[10px] font-semibold text-[#f3f1e6]">{playing ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}{playing ? "PAUSE MONITOR" : "PLAY MONITOR"}</button><button onClick={reset} className="flex items-center gap-2 rounded-lg border border-[#c5c8bc] bg-[#f7f3e8] px-4 py-2.5 text-[10px] font-semibold text-[#526159]"><RotateCcw className="h-3 w-3" /> RESET MAP</button></div><div className="mm-mono flex items-center gap-3 text-[9px] text-[#77847b]"><SlidersHorizontal className="h-3 w-3" /> RANGE: ± 100% <Download className="ml-2 h-3 w-3" /> EXPORT</div></div>
        <div className="mt-6 flex items-center justify-between rounded-xl border border-[#c5c6b8] bg-[#eeece2]/80 px-4 py-3"><p className="text-[10px] text-[#627067]"><span className="mm-mono mr-2 text-[#a85a3b]">MATRIX NOTE</span>Dense is a feature. Routes stay visible while you perform.</p><button onClick={() => notify("Patch labels pinned to the rack.")} className="mm-mono text-[9px] text-[#a65334]">PIN LABELS</button></div>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full bg-[#273a34] px-4 py-2.5 text-[11px] text-[#f4f1e6] shadow-lg">{toast}<button aria-label="Dismiss" onClick={() => setToast("")} className="ml-3"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}