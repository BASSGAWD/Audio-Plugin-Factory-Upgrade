import { useState, type CSSProperties } from "react";
import {
  Activity, ArrowUpRight, Bot, Check, ChevronDown, ChevronRight, CircleHelp,
  Code2, Download, Layers3, Menu, MessageSquare, MoreHorizontal,
  Pause, Play, Plus, RotateCcw, Search, Settings2, SlidersHorizontal,
  Sparkles, Terminal, Waves, X,
} from "lucide-react";
import "./_group.css";

const specialists = [
  { name: "NEXUS", role: "SYSTEM ARCHITECT", status: "ACTIVE", icon: Bot },
  { name: "MIRA", role: "DSP RESEARCH", status: "VERIFIED", icon: Waves },
  { name: "KITE", role: "INTERFACE SYSTEMS", status: "STANDBY", icon: Layers3 },
];
const controls = [
  { label: "RETUNE", value: "7.0", unit: "ms", percent: 70 },
  { label: "HUMANIZE", value: "42", unit: "%", percent: 42 },
  { label: "VIBRATO", value: "0.20", unit: "Hz", percent: 20 },
  { label: "FORMANT", value: "ON", unit: "", percent: 65 },
];
const nav = [
  ["Cockpit", SlidersHorizontal], ["Signal chain", Waves], ["Faceplate", Layers3],
  ["Code workspace", Code2], ["Evidence", Activity], ["Build log", Terminal],
] as const;

function OrangeMark() {
  return <div className="grid h-9 w-9 place-items-center rounded-[11px] border border-[#ffb27f]/35 bg-[#fb6a20] shadow-[inset_0_1px_rgba(255,255,255,.4)]">
    <div className="h-4 w-4 rounded-full border-[3px] border-[#242a25] border-t-[#d9ee78]" />
  </div>;
}

function Knob({ value, onTurn }: { value: number; onTurn: () => void }) {
  const rotation = -135 + (value / 100) * 270;
  return <button aria-label="Adjust parameter" onClick={onTurn} className="oj-knob relative h-[54px] w-[54px] rounded-full transition-transform hover:scale-105 active:scale-95" style={{ "--rotation": `${rotation}deg` } as CSSProperties} />;
}

export function Upgraded() {
  const [active, setActive] = useState("Cockpit");
  const [showBrief, setShowBrief] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSpecialist, setSelectedSpecialist] = useState(0);
  const [values, setValues] = useState(controls.map((control) => control.percent));
  const [mode, setMode] = useState("Natural");
  const [menuOpen, setMenuOpen] = useState(false);

  const turn = (index: number) => setValues((old) => old.map((value, i) => i === index ? value >= 95 ? 10 : value + 10 : value));

  return (
    <div className="oj-cockpit flex min-h-[800px] w-full select-none overflow-hidden">
      <aside className="flex w-[76px] shrink-0 flex-col items-center border-r border-[#474d47] bg-[#202421] py-4">
        <OrangeMark />
        <div className="mt-7 flex flex-col gap-2">
          {nav.map(([label, Icon]) => <button key={label} title={label} onClick={() => setActive(label)} className={`grid h-10 w-10 place-items-center rounded-xl transition-all ${active === label ? "bg-[#fb6a20] text-[#1f231f] shadow-[0_7px_15px_rgba(0,0,0,.25)]" : "text-[#a8aca3] hover:bg-[#343a35] hover:text-[#e3e0d4]"}`}><Icon size={18} strokeWidth={active === label ? 2.5 : 1.7} /></button>)}
        </div>
        <div className="mt-auto flex flex-col gap-2"><button className="grid h-10 w-10 place-items-center rounded-xl text-[#9da199] hover:bg-[#343a35]"><CircleHelp size={18}/></button><button className="grid h-10 w-10 place-items-center rounded-xl text-[#9da199] hover:bg-[#343a35]"><Settings2 size={18}/></button></div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[67px] shrink-0 items-center justify-between border-b border-[#474d47] bg-[#202421] px-6">
          <div className="flex items-center gap-4">
            <div><div className="flex items-center gap-2"><h1 className="text-[15px] font-bold tracking-[.13em] text-[#f1eee2]">ORANGEJUCE</h1><span className="oj-mono rounded border border-[#fb6a20]/40 bg-[#fb6a20]/10 px-1.5 py-0.5 text-[8px] tracking-[.12em] text-[#ffad73]">FACTORY 02</span></div><p className="oj-mono mt-0.5 text-[9px] tracking-[.08em] text-[#858b83]">AUTONOMOUS INSTRUMENT BUILDING</p></div>
            <span className="h-7 border-l border-[#474d47]" />
            <button onClick={() => setMenuOpen(!menuOpen)} className="relative flex items-center gap-2 rounded-lg border border-[#4d534d] bg-[#292e2a] px-2.5 py-1.5 text-[11px] text-[#dedbd0] hover:border-[#80877d]"><span className="h-2 w-2 rounded-full bg-[#b8d85a]" />AEROTUNE <ChevronDown size={13}/>{menuOpen && <div className="absolute left-0 top-9 z-30 w-48 rounded-lg border border-[#555b54] bg-[#292e2a] p-1 text-left shadow-2xl"><button onClick={() => setMenuOpen(false)} className="w-full rounded px-2 py-2 text-left text-[10px] hover:bg-[#383e39]">Aerotune vocal corrector</button><button onClick={() => setMenuOpen(false)} className="w-full rounded px-2 py-2 text-left text-[10px] hover:bg-[#383e39]">New instrument build</button></div>}</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#4a514b] bg-[#292e2a] px-3 py-1.5 xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#b8d85a]" /><span className="oj-mono text-[9px] tracking-[.1em] text-[#c8d0b3]">LOCAL ENGINE / 18ms</span></div>
            <button className="flex items-center gap-1.5 rounded-lg border border-[#4d534d] px-3 py-1.5 text-[11px] font-medium text-[#dedbd0] hover:bg-[#343a35]"><Download size={14}/> Export</button>
            <button onClick={() => setShowBrief(!showBrief)} className="flex items-center gap-1.5 rounded-lg bg-[#fb6a20] px-3 py-1.5 text-[11px] font-bold text-[#202421] hover:bg-[#ff8141]"><Sparkles size={14}/> {showBrief ? "Focus build" : "Show brief"}</button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col bg-[#1b1f1c] p-5">
            <div className="oj-rise mb-4 flex items-end justify-between">
              <div><div className="oj-mono mb-1 text-[9px] tracking-[.18em] text-[#fb8c50]">FACEPLATE / LIVE PROTOTYPE</div><h2 className="text-xl font-semibold tracking-tight text-[#eeebdf]">Aerotune — vocal pitch correction</h2></div>
              <div className="flex items-center gap-2"><button onClick={() => setValues(controls.map(c => c.percent))} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-[#aeb4aa] hover:bg-[#303630]"><RotateCcw size={13}/> Reset values</button><button className="grid h-7 w-7 place-items-center rounded-md border border-[#4a504a] text-[#adb2aa] hover:bg-[#343a35]"><MoreHorizontal size={15}/></button></div>
            </div>
            <div className="oj-face oj-rise oj-delay1 relative flex min-h-[388px] flex-1 overflow-hidden rounded-xl border border-[#5a6059] p-6 shadow-[0_18px_34px_rgba(0,0,0,.3)]">
              <div className="absolute inset-x-0 top-0 h-px bg-[#d7e4b2]/20" />
              <div className="flex w-full flex-col">
                <div className="flex items-start justify-between border-b border-[#858a7e]/25 pb-4">
                  <div className="flex items-center gap-3"><OrangeMark /><div><div className="text-[16px] font-bold tracking-[.22em] text-[#f1eee2]">AEROTUNE</div><div className="oj-mono mt-0.5 text-[8px] tracking-[.16em] text-[#adb4a3]">PRECISION VOCAL PROCESSOR</div></div></div>
                  <div className="flex items-center gap-2 rounded-full border border-[#b8d85a]/25 bg-[#1e251c]/55 px-2.5 py-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#b8d85a]" /><span className="oj-mono text-[8px] tracking-[.12em] text-[#c8dca0]">DSP LOCKED</span></div>
                </div>
                <div className="my-auto grid grid-cols-4 gap-4 px-4">
                  {controls.map((control, index) => {
                    const readout = index === 0 ? (values[index] / 10).toFixed(1) : index === 1 ? values[index].toString() : index === 2 ? (values[index] / 100).toFixed(2) : values[index] > 50 ? "ON" : "OFF";
                    return <div key={control.label} className="flex flex-col items-center rounded-lg border border-[#8e9388]/25 bg-[#171b18]/35 px-2 py-4 shadow-[inset_0_1px_rgba(255,255,255,.04)]"><Knob value={values[index]} onTurn={() => turn(index)} /><div className="mt-3 text-[10px] font-semibold tracking-[.09em] text-[#d9d6ca]">{control.label}</div><div className="oj-mono mt-1 text-[12px] text-[#ffad73]">{readout}<span className="ml-1 text-[8px] text-[#999e92]">{control.unit}</span></div></div>;
                  })}
                </div>
                <div className="flex items-end justify-between border-t border-[#858a7e]/25 pt-4">
                  <div className="flex gap-1.5">{["Natural", "Hard tune", "Studio"].map(option => <button key={option} onClick={() => setMode(option)} className={`rounded-md px-2.5 py-1.5 text-[10px] transition-colors ${mode === option ? "bg-[#d8d5ca] font-semibold text-[#222722]" : "border border-[#5b615a] text-[#bdc1b7] hover:bg-[#3c433d]"}`}>{option}</button>)}</div>
                  <button onClick={() => setIsPlaying(!isPlaying)} className={`flex items-center gap-2 rounded-md px-4 py-2 text-[10px] font-bold tracking-[.1em] ${isPlaying ? "bg-[#d8d5ca] text-[#232723]" : "bg-[#b8d85a] text-[#202520]"}`}>{isPlaying ? <Pause size={13} fill="currentColor"/> : <Play size={13} fill="currentColor"/>}{isPlaying ? "STOP AUDITION" : "AUDITION"}</button>
                </div>
              </div>
            </div>
            <div className="oj-rise oj-delay2 mt-4 grid grid-cols-[1.25fr_.75fr] gap-4">
              <div className="oj-metal rounded-xl p-3"><div className="mb-2 flex items-center justify-between"><span className="oj-mono text-[9px] tracking-[.14em] text-[#aeb3a8]">INPUT CONFIDENCE</span><span className="oj-mono text-[9px] text-[#c8dca0]">98.4%</span></div><div className="flex h-10 items-end gap-1">{[25,44,34,72,47,82,51,34,63,88,57,69,35,75,50,40,71,53,79,38,60,85,45,56,40,76].map((height, i) => <i key={i} className="oj-vu flex-1 rounded-t-sm opacity-90" style={{height:`${height}%`}} />)}</div></div>
              <div className="oj-metal rounded-xl p-3"><div className="oj-mono text-[9px] tracking-[.14em] text-[#aeb3a8]">BUILD HEALTH</div><div className="mt-2 flex items-end gap-2"><span className="text-2xl font-semibold text-[#f0ede1]">A</span><div className="pb-1 text-[10px] text-[#aab0a6]">No unstable paths<br/><span className="text-[#b8d85a]">6 checks passed</span></div></div></div>
            </div>
          </section>

          {showBrief && <aside className="w-[310px] shrink-0 border-l border-[#474d47] bg-[#202421] p-4">
            <div className="mb-5 flex items-center justify-between"><div><div className="oj-mono text-[9px] tracking-[.16em] text-[#fb8c50]">AUTONOMOUS CELL</div><h3 className="mt-1 text-sm font-semibold text-[#eeebdf]">Build brief</h3></div><button onClick={() => setShowBrief(false)} className="rounded-md p-1 text-[#a4aaa0] hover:bg-[#343a35]"><X size={15}/></button></div>
            <div className="rounded-xl border border-[#4b514b] bg-[#292e2a] p-3"><div className="flex items-start gap-2"><MessageSquare size={15} className="mt-0.5 text-[#ff8c4d]"/><p className="text-[11px] leading-relaxed text-[#d6d4c8]">“Build a transparent vocal corrector with stable formant handling and musical low-latency response.”</p></div><button className="mt-3 flex items-center gap-1 text-[10px] font-medium text-[#ffad73] hover:text-[#ffc39d]">View source prompt <ArrowUpRight size={12}/></button></div>
            <div className="mt-5"><div className="mb-2 flex items-center justify-between"><span className="oj-mono text-[9px] tracking-[.14em] text-[#9da39a]">SPECIALIST CELL</span><span className="oj-mono text-[9px] text-[#b8d85a]">3 ONLINE</span></div><div className="space-y-1">{specialists.map((person, index) => { const Icon = person.icon; return <button key={person.name} onClick={() => setSelectedSpecialist(index)} className={`flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-colors ${selectedSpecialist === index ? "border-[#fb6a20]/60 bg-[#fb6a20]/10" : "border-transparent hover:bg-[#2d332e]"}`}><div className="grid h-7 w-7 place-items-center rounded-md bg-[#3a413a] text-[#d8d5ca]"><Icon size={14}/></div><div className="min-w-0 flex-1"><div className="text-[10px] font-bold tracking-[.08em] text-[#e4e1d5]">{person.name}</div><div className="oj-mono text-[8px] text-[#969d93]">{person.role}</div></div><span className={`h-1.5 w-1.5 rounded-full ${index === 2 ? "bg-[#7e857b]" : "bg-[#b8d85a]"}`}/></button>})}</div></div>
            <div className="mt-5 border-t border-[#444a44] pt-4"><div className="mb-3 flex items-center justify-between"><span className="oj-mono text-[9px] tracking-[.14em] text-[#9da39a]">EVIDENCE LEDGER</span><button className="text-[#aab0a6] hover:text-[#f0ede1]"><Search size={14}/></button></div>{["Pitch detector: YIN + parabolic", "Formant preservation curve", "Latency target: under 12ms"].map((item, index) => <div key={item} className="mb-2 flex items-center gap-2 text-[10px] text-[#ced0c7]"><span className="grid h-4 w-4 place-items-center rounded-full bg-[#b8d85a]/15 text-[#b8d85a]"><Check size={10}/></span>{item}<ChevronRight size={12} className="ml-auto text-[#747b73]"/></div>)}</div>
            <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#555b54] py-2 text-[10px] font-medium text-[#d8d5ca] hover:border-[#81887e] hover:bg-[#303630]"><Plus size={14}/> Add specialist task</button>
          </aside>}
        </main>
        <footer className="flex h-8 shrink-0 items-center justify-between border-t border-[#474d47] bg-[#202421] px-5 oj-mono text-[8px] tracking-[.1em] text-[#8d948b]"><div className="flex gap-4"><span>48kHz / 32-bit float</span><span>64 samples</span><span className="text-[#b8d85a]">ENGINE STABLE</span></div><div className="flex items-center gap-3"><span>BUILD 0.8.14</span><span className="flex items-center gap-1 text-[#c9c4b6]"><Menu size={11}/> COMMAND PALETTE</span></div></footer>
      </div>
    </div>
  );
}