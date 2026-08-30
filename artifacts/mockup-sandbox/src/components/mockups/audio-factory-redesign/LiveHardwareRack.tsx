import { useMemo, useState } from "react";
import { Cable, ChevronDown, CircleHelp, Download, MoreHorizontal, Play, Power, RotateCcw, Save, Volume2, X } from "lucide-react";

const modules = [
  { id: "osc", code: "VCO / 01", title: "ORBITAL VOICE", tint: "#f2a36e", knobs: ["COARSE", "FINE", "SHAPE"], sockets: ["1V/O", "FM", "SYNC"], output: "OUT" },
  { id: "wave", code: "SHAPER / 02", title: "FOLDING ROOM", tint: "#c3b86f", knobs: ["FOLD", "BIAS", "DRIVE"], sockets: ["CV", "TRIG", "IN"], output: "OUT" },
  { id: "space", code: "SPATIAL / 03", title: "COPPER SPACE", tint: "#8faab2", knobs: ["TIME", "DAMP", "MIX"], sockets: ["CV", "GATE", "IN"], output: "L / R" },
];

export function LiveHardwareRack() {
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState("");
  const [active, setActive] = useState("space");
  const [values, setValues] = useState([58, 42, 73, 61, 38, 82, 48, 69, 88]);
  const [patch, setPatch] = useState(true);
  const meters = useMemo(() => Array.from({ length: 29 }, (_, i) => 18 + ((i * 17 + i * i * 3) % 70)), []);
  const note = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2300); };
  const adjust = (index: number, value: number) => { setValues((old) => old.map((n, i) => i === index ? value : n)); setSaved(false); };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#e9e5d9] text-[#24302e] selection:bg-[#e7aa77]" style={{ fontFamily: "'Sora', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;500;600;700&display=swap');
      .lhr-mono{font-family:'DM Mono',monospace}.lhr-grain{background-image:radial-gradient(rgba(36,48,46,.12) .7px,transparent .7px);background-size:5px 5px}.lhr-rack{background:linear-gradient(90deg,#293532 0 26px,#384741 26px calc(100% - 26px),#293532 calc(100% - 26px));box-shadow:0 28px 42px rgba(44,43,34,.2),inset 0 0 0 1px rgba(12,23,20,.65)}.lhr-module{background:linear-gradient(108deg,rgba(255,255,255,.09),transparent 25%),#202a28;box-shadow:inset 0 1px rgba(255,255,255,.1),0 4px 0 rgba(0,0,0,.25)}.lhr-screw{box-shadow:inset 0 1px 1px #8d9b92,0 1px 1px #111}.lhr-meter i{animation:lhr-pulse .85s ease-in-out infinite alternate}@keyframes lhr-pulse{to{transform:scaleY(.42);opacity:.58}}`}</style>

      <header className="flex h-16 items-center justify-between border-b border-[#c7c4b7] bg-[#f4f0e5] px-4 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="lhr-grain grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[#e6814f] shadow-[inset_0_-3px_rgba(91,47,29,.22)]"><Cable className="h-4 w-4" /></div>
          <div className="min-w-0 leading-none"><b className="text-[13px] tracking-[-.07em]">ORANGEJUCE</b><span className="lhr-mono ml-2 rounded border border-[#ddc2ad] bg-[#fff1e5] px-1.5 py-1 text-[8px] tracking-[.13em] text-[#a65333]">PATCH LAB</span><p className="mt-1 truncate text-[10px] text-[#79827a]">Velvet Pitch / performance rig</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Help" onClick={() => note("Patch tips: drag an output to any glowing input.")} className="hidden rounded-md p-2 text-[#65716a] md:block"><CircleHelp className="h-4 w-4" /></button>
          <button onClick={() => { setSaved(true); note("Rack configuration saved."); }} className="lhr-mono hidden items-center gap-2 rounded-lg border border-[#c5c8bc] bg-[#faf8f0] px-3 py-2 text-[9px] tracking-[.09em] text-[#4a5a53] sm:flex"><Save className="h-3 w-3" /><i className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-[#9dad60]" : "bg-[#df754b]"}`} />{saved ? "SAVED" : "SAVE"}</button>
          <button aria-label="Menu" onClick={() => note("Rack options opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c5c8bc] bg-[#faf8f0]"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1460px] grid-cols-1 lg:grid-cols-[330px_1fr]">
        <aside className="border-b border-[#c9c6b8] bg-[#f0ede2] p-5 lg:min-h-[calc(100dvh-64px)] lg:border-b-0 lg:border-r lg:p-7">
          <p className="lhr-mono text-[9px] tracking-[.17em] text-[#7d8378]">PERFORMANCE PATCH / 03</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-[.94] tracking-[-.075em] text-[#293632]">Put it<br />through the rack.</h1>
          <p className="mt-5 max-w-[270px] text-[12px] leading-relaxed text-[#6a746c]">A live signal chain with physical behavior. Twist a control, reroute the voltage, keep moving.</p>
          <div className="mt-7 border-y border-[#d2cec0] py-4">
            <div className="mb-3 flex items-center justify-between"><span className="lhr-mono text-[9px] tracking-[.14em] text-[#7a8278]">PATCH MEMORY</span><button onClick={() => note("Memory browser is ready.")} className="text-[10px] font-medium text-[#a85031]">BROWSE</button></div>
            <button onClick={() => note("‘Glass corridor’ patch loaded.")} className="w-full rounded-lg border border-[#dbb394] bg-[#fff7ee] px-3 py-3 text-left shadow-[0_3px_0_#e6d0bd]"><b className="block text-[12px]">Glass corridor</b><span className="lhr-mono mt-1 block text-[9px] text-[#967767]">03 MODULES · 05 CABLES</span></button>
          </div>
          <div className="mt-5 space-y-2">
            {[["INPUT", "Vocal pass · -8.4dB"], ["CLOCK", "124 BPM · internal"], ["LATENCY", "8.2 ms total"]].map(([k, v]) => <div key={k} className="flex justify-between text-[10px]"><span className="lhr-mono text-[#8a9186]">{k}</span><span className="text-[#58655e]">{v}</span></div>)}
          </div>
          <div className="mt-7 flex gap-2">
            <button onClick={() => { setValues([58, 42, 73, 61, 38, 82, 48, 69, 88]); setPatch(true); setSaved(false); note("Controls returned to patch memory."); }} className="lhr-mono flex items-center gap-1.5 rounded-md border border-[#c6c8bb] bg-[#faf8f0] px-3 py-2 text-[9px] text-[#58655e]"><RotateCcw className="h-3 w-3" /> RECALL</button>
            <button onClick={() => note("Build package staged for export.")} className="lhr-mono flex items-center gap-1.5 rounded-md bg-[#30423b] px-3 py-2 text-[9px] text-[#f2f1e7]"><Download className="h-3 w-3" /> BUILD</button>
          </div>
        </aside>

        <section className="relative overflow-hidden bg-[#d9d8ca] p-4 md:p-7">
          <div className="lhr-grain absolute inset-0 opacity-20" />
          <div className="relative mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#e4764f]" /><span className="lhr-mono text-[9px] tracking-[.17em] text-[#52615a]">LIVE HARDWARE PREVIEW</span></div><button onClick={() => setPatch(!patch)} className={`lhr-mono flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[9px] ${patch ? "border-[#a8b68d] bg-[#edf3dd] text-[#506040]" : "border-[#b7b8ab] bg-[#ebe9df] text-[#6f766f]"}`}><Power className="h-3 w-3" />{patch ? "PATCHED" : "BYPASS"}</button></div>
          <div className="lhr-rack relative mx-auto max-w-[820px] rounded-[18px] p-6 pt-7 md:p-8">
            <div className="absolute left-[13px] top-5 bottom-5 flex flex-col justify-between">{Array.from({ length: 8 }, (_, i) => <i key={i} className="lhr-screw h-3 w-3 rounded-full border border-[#18221f] bg-[#59665f]" />)}</div>
            <div className="absolute right-[13px] top-5 bottom-5 flex flex-col justify-between">{Array.from({ length: 8 }, (_, i) => <i key={i} className="lhr-screw h-3 w-3 rounded-full border border-[#18221f] bg-[#59665f]" />)}</div>
            <div className="mb-5 flex items-center justify-between border-b border-[#526058] pb-3 text-[#dce2da]"><div className="flex items-center gap-2"><Volume2 className="h-4 w-4 text-[#e99667]" /><b className="text-[13px] tracking-[-.04em]">VELVET PITCH</b><span className="lhr-mono text-[8px] tracking-[.16em] text-[#9faea4]">MODULAR EDITION</span></div><button onClick={() => setPlaying(!playing)} className={`grid h-8 w-8 place-items-center rounded-full ${playing ? "bg-[#c4d67f] text-[#26322d]" : "bg-[#e77f54] text-[#2a3631]"}`}><Play className={`h-3 w-3 ${!playing && "ml-0.5 fill-current"}`} /></button></div>
            <svg className="pointer-events-none absolute left-7 top-[84px] z-10 hidden h-[390px] w-[calc(100%-56px)] md:block" viewBox="0 0 740 390" preserveAspectRatio="none"><path d="M125 52 C 290 52, 184 168, 355 168 S 435 287, 596 287" fill="none" stroke="#e9a05f" strokeWidth="5" strokeLinecap="round" /><path d="M579 52 C 480 82, 605 170, 452 170 S 174 286, 142 286" fill="none" stroke="#a8c7d0" strokeWidth="5" strokeLinecap="round" /><path d="M132 50 C 78 106, 260 171, 132 287" fill="none" stroke="#b9c26d" strokeWidth="5" strokeLinecap="round" /><circle cx="125" cy="52" r="6" fill="#e9a05f"/><circle cx="596" cy="287" r="6" fill="#e9a05f"/></svg>
            <div className="relative space-y-4">
              {modules.map((module, moduleIndex) => <div key={module.id} className={`lhr-module min-h-[107px] rounded-lg border ${active === module.id ? "border-[#d9d0ac]" : "border-[#43534d]"} px-4 py-3 text-[#e9eee8]`} onClick={() => setActive(module.id)}>
                <div className="flex items-start justify-between"><div><p className="lhr-mono text-[8px] tracking-[.15em]" style={{ color: module.tint }}>{module.code}</p><h2 className="mt-1 text-[12px] font-semibold tracking-[-.04em]">{module.title}</h2></div><div className="lhr-mono flex gap-2 text-[8px] text-[#9caaa1]"><span>±5V</span><ChevronDown className="h-3 w-3" /></div></div>
                <div className="mt-3 flex items-end justify-between"><div className="flex gap-3">{module.knobs.map((label, knobIndex) => { const valueIndex = moduleIndex * 3 + knobIndex; return <label key={label} className="relative grid w-11 place-items-center text-center"><button aria-label={`${module.title} ${label}`} onClick={(event) => { event.stopPropagation(); note(`${label.toLowerCase()} under your hand.`); }} className="relative h-9 w-9 rounded-full border-[4px] border-[#586861] bg-[#16201d] shadow-[inset_0_0_0_1px_#0a1110]"><i className="absolute left-1/2 top-[2px] h-3 w-[2px] -translate-x-1/2 rounded bg-[#ec9967]" style={{ transform: `translateX(-50%) rotate(${values[valueIndex] * 2.2 - 110}deg)`, transformOrigin: "bottom center" }} /></button><input aria-label={label} className="mt-1 h-1 w-10 cursor-pointer accent-[#e79365]" type="range" min="0" max="100" value={values[valueIndex]} onChange={(e) => adjust(valueIndex, Number(e.target.value))} /><span className="lhr-mono mt-0.5 text-[7px] text-[#b7c2ba]">{label}</span></label>; })}</div>
                  <div className="flex gap-3">{module.sockets.map((socket, i) => <button key={socket} aria-label={`${socket} patch point`} onClick={(event) => { event.stopPropagation(); note(`${socket} patch point selected.`); }} className="grid place-items-center gap-1"><i className="grid h-5 w-5 place-items-center rounded-full border-2 border-[#75837b] bg-[#0d1513] shadow-[inset_0_0_0_3px_#26332e]"><b className={`h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-[#e99a63]" : "bg-[#9fc0ca]"}`} /></i><span className="lhr-mono text-[7px] text-[#a9b6ae]">{socket}</span></button>)}<button aria-label="Output patch point" onClick={(event) => { event.stopPropagation(); note(`${module.output} is sending signal.`); }} className="grid place-items-center gap-1"><i className="grid h-5 w-5 place-items-center rounded-full border-2 border-[#b2bc78] bg-[#0d1513] shadow-[inset_0_0_0_3px_#26332e]"><b className="h-1.5 w-1.5 rounded-full bg-[#d4dc8a]" /></i><span className="lhr-mono text-[7px] text-[#c4cf9b]">{module.output}</span></button></div>
                </div>
              </div>)}
            </div>
            <div className="lhr-meter mt-5 flex h-8 items-center gap-1 rounded border border-[#3f5049] bg-[#16201d] px-3">{meters.map((n, i) => <i key={i} className="w-1 flex-1 rounded-sm bg-[#9ebc85]" style={{ height: `${playing ? n : Math.min(n, 28)}%`, animationDelay: `${i * 35}ms`, animationPlayState: playing ? "running" : "paused" }} />)}<span className="lhr-mono ml-2 text-[8px] text-[#a9b5ab]">{playing ? "−9.4 dB" : "IDLE"}</span></div>
          </div>
          <div className="relative mx-auto mt-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c5c6b8] bg-[#eeece2]/80 px-4 py-3"><p className="text-[10px] text-[#627067]"><span className="lhr-mono mr-2 text-[#a85a3b]">PATCH NOTES</span>CV routes are shown in the rack, not hidden in a macro menu.</p><button onClick={() => note("Cable view remains visible for the build.")} className="lhr-mono text-[9px] text-[#a65334]">KEEP CABLES VISIBLE</button></div>
        </section>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full bg-[#273a34] px-4 py-2.5 text-[11px] text-[#f4f1e6] shadow-lg">{toast}<button aria-label="Dismiss" onClick={() => setToast("")} className="ml-3"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}