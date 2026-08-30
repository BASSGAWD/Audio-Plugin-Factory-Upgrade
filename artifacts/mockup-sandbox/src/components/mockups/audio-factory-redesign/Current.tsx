import { useState } from "react";
import {
  Activity, Bookmark, BookOpen, ChevronDown, Code2, Cpu, Download,
  FlaskConical, Github, Grid3X3, Layers, MessageSquare, Minus, PanelLeftClose,
  PanelLeftOpen, Pause, Play, Plus, Send, Sliders, Sparkles, Terminal,
  Volume2, Wand2, Wrench, Workflow, ZoomIn, ZoomOut,
} from "lucide-react";
import "./_group.css";

type TabId =
  | "chat" | "architect" | "presets" | "playground" | "canvas" | "code"
  | "diagnostics" | "lab" | "terminal" | "export" | "cpp" | "memory"
  | "research" | "github";

const tabLabels: Record<TabId, string> = {
  chat: "AI Chat", architect: "Architect", presets: "Presets",
  playground: "Playground", canvas: "Block Router", code: "Script JS",
  diagnostics: "Purity QA", lab: "Stress Sweep", terminal: "Terminal",
  export: "Export", cpp: "VST3 Build", memory: "Models & Memory",
  research: "Research Lab", github: "GitHub Search",
};

const groups = [
  { label: "Create", tabs: [
    ["chat", "AI Chat", MessageSquare, "text-orange-400"],
    ["architect", "Architect", Wand2, "text-indigo-400"],
    ["presets", "Presets", Bookmark, "text-orange-400"],
  ]},
  { label: "Sound", tabs: [
    ["playground", "Playground", Sliders, "text-indigo-400"],
    ["canvas", "Block Router", Workflow, "text-indigo-400"],
  ]},
  { label: "Code", tabs: [
    ["code", "Script JS", Code2, "text-sky-400"],
    ["diagnostics", "Purity QA", Activity, "text-amber-500"],
    ["lab", "Stress Sweep", FlaskConical, "text-rose-400"],
    ["terminal", "Terminal", Terminal, "text-emerald-400"],
  ]},
  { label: "Ship", tabs: [
    ["export", "Export", Download, "text-emerald-400"],
    ["cpp", "VST3 Build", Cpu, "text-indigo-400"],
  ]},
  { label: "System", tabs: [
    ["memory", "Models & Memory", Workflow, "text-orange-400"],
    ["research", "Research Lab", BookOpen, "text-sky-400"],
    ["github", "GitHub Search", Github, "text-indigo-400"],
  ]},
] as const;

const parameters = [
  { id: "speed", name: "Retune Speed", value: 7, min: 0, max: 10, unit: "ms", x: 30, y: 35 },
  { id: "scale", name: "Target Scale", value: 0, min: 0, max: 2, unit: "scale", x: 230, y: 35 },
  { id: "vibrato", name: "Vocal Vibrato", value: .2, min: 0, max: 2, unit: "Hz", x: 430, y: 35 },
  { id: "pitch", name: "Manual Transpose", value: 0, min: -12, max: 12, unit: "st", x: 130, y: 190 },
  { id: "correction", name: "Correction Intensity", value: .85, min: 0, max: 1, unit: "%", x: 370, y: 190 },
];

function OrangeLogo({ size = 34 }: { size?: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-orange-400/20 bg-orange-500 shadow-lg shadow-orange-950/40 shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="relative z-10 h-full w-full p-0.5" fill="none">
        <path d="M48 20C52 10 62 12 60 22C55 24 48 22 48 20" fill="#22c55e" stroke="#15803d" strokeWidth="2.5"/>
        <circle cx="50" cy="56" r="32" fill="#f97316" stroke="#ea580c" strokeWidth="3"/>
        <path d="M30 40A15 15 0 0150 30" stroke="#ffedd5" strokeWidth="3" strokeLinecap="round" opacity=".6"/>
        <circle cx="42" cy="54" r="4" fill="#1c0a00"/><circle cx="58" cy="54" r="4" fill="#1c0a00"/>
        <circle cx="41" cy="52" r="1.5" fill="white"/><circle cx="57" cy="52" r="1.5" fill="white"/>
        <path d="M45 61Q50 66 55 61" stroke="#1c0a00" strokeWidth="3.5" strokeLinecap="round"/>
        <path d="M23 54C23 28 77 28 77 54" stroke="#27272a" strokeWidth="6" strokeLinecap="round"/>
        <path d="M23 54C23 28 77 28 77 54" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round"/>
        <rect x="18" y="46" width="9" height="18" rx="4" fill="#27272a"/><rect x="73" y="46" width="9" height="18" rx="4" fill="#27272a"/>
        <rect x="62" y="72" width="22" height="16" rx="3" fill="#18181b" stroke="#3f3f46"/>
        <path d="M65 80L70 76L75 84L80 80" stroke="#22c55e" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

function Knob({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const normalized = (value - min) / (max - min);
  const angle = -135 + normalized * 270;
  return (
    <button
      className="af-knob relative h-12 w-12 rounded-full"
      style={{ "--angle": `${angle}deg` } as React.CSSProperties}
      onClick={() => onChange(value >= max ? min : Math.min(max, value + (max - min) / 10))}
      title="Click to adjust"
    />
  );
}

function Playground() {
  const [values, setValues] = useState(Object.fromEntries(parameters.map(p => [p.id, p.value])));
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [rail, setRail] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <div className="relative flex h-[780px] w-full flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 select-none">
        <div className="absolute left-0 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-r-xl border-y border-r border-neutral-800 bg-neutral-950/95 p-1 shadow-xl">
          {[[Grid3X3,"palette"], [Wrench,"tools"], [Sparkles,"templates"], [BookOpen,"manual"]].map(([I,id]) => {
            const Icon = I as typeof Grid3X3;
            return <button key={id as string} onClick={() => setRail(rail === id ? null : id as string)} className={`flex h-8 w-8 items-center justify-center rounded-lg ${rail === id ? "bg-indigo-600 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}><Icon className="h-4 w-4"/></button>;
          })}
          <div className="mx-1 border-t border-neutral-800"/>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800"><Sliders className="h-4 w-4"/></button>
        </div>

        {rail && (
          <div className="absolute left-11 top-14 z-40 w-64 rounded-xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between"><span className="font-mono text-[10px] font-bold uppercase text-neutral-300">{rail}</span><button onClick={() => setRail(null)} className="text-neutral-500">×</button></div>
            <div className="grid grid-cols-2 gap-2">
              {["Rotary knob","Fader","Toggle","VU meter","EQ display","Waveform"].map(x => <button key={x} className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-left text-[9px] text-neutral-400 hover:border-indigo-700">{x}</button>)}
            </div>
          </div>
        )}

        <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900 p-2 text-xs text-neutral-300">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-1">
                <span className="font-mono text-[10px] font-bold uppercase text-neutral-500">Board</span>
                <input value="720" readOnly className="w-14 rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-neutral-300"/>
                <span className="text-neutral-600">×</span>
                <input value="440" readOnly className="w-14 rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-neutral-300"/>
              </div>
              <div className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-1">
                <button className="rounded border border-indigo-500 bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">SNAP ON</button>
                <select className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-neutral-400"><option>10px</option><option>20px</option></select>
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-950 px-1.5 py-1">
              <button onClick={() => setZoom(Math.max(.7, zoom-.1))} className="rounded p-1 text-neutral-400 hover:bg-neutral-800"><ZoomOut className="h-3.5 w-3.5"/></button>
              <span className="w-10 text-center font-mono text-[10px] font-bold text-indigo-400">{Math.round(zoom*100)}%</span>
              <button onClick={() => setZoom(Math.min(1.2, zoom+.1))} className="rounded p-1 text-neutral-400 hover:bg-neutral-800"><ZoomIn className="h-3.5 w-3.5"/></button>
              <button onClick={() => setZoom(1)} className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[9px] text-neutral-400">FIT</button>
            </div>
          </div>
          <div className="af-canvas-grid af-scroll relative flex-1 overflow-auto p-10">
            <div className="relative shrink-0 transition-transform" style={{ transform:`scale(${zoom})`, transformOrigin:"top left" }}>
              <div className="absolute -top-7 left-0 flex h-4 w-[720px] items-end justify-between border-b border-neutral-800 pb-0.5 font-mono text-[8px] text-neutral-600">
                {[0,100,200,300,400,500,600,700].map(x => <span key={x}>{x}px</span>)}
              </div>
              <div className="af-faceplate relative h-[440px] w-[720px] overflow-hidden rounded-lg">
                <div className="absolute left-6 top-3 flex items-center gap-2">
                  <OrangeLogo size={25}/><div><div className="font-display text-[11px] font-black tracking-widest text-orange-400">AEROTUNE</div><div className="font-mono text-[7px] uppercase tracking-[.2em] text-neutral-600">Vocal pitch corrector</div></div>
                </div>
                <div className="absolute right-5 top-5 flex items-center gap-1.5 font-mono text-[8px] text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 af-pulse"/>DSP READY</div>
                {parameters.map(p => (
                  <div key={p.id} className="absolute flex h-[120px] w-[180px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-neutral-800 bg-neutral-900/50 p-2.5 text-white hover:border-indigo-500" style={{left:p.x,top:p.y}}>
                    <Knob value={values[p.id]} min={p.min} max={p.max} onChange={v=>setValues(s=>({...s,[p.id]:v}))}/>
                    <span className="mt-1 max-w-full truncate text-[9px] font-semibold text-neutral-300">{p.name}</span>
                    <span className="font-mono text-[8px] text-orange-400">{values[p.id].toFixed(p.max <= 2 ? 2 : 1)} {p.unit}</span>
                  </div>
                ))}
                <button onClick={()=>setPlaying(!playing)} className={`absolute bottom-5 right-6 flex items-center gap-2 rounded-lg border px-4 py-2 font-mono text-[9px] font-bold ${playing ? "border-rose-800 bg-rose-950/70 text-rose-300" : "border-emerald-800 bg-emerald-950/70 text-emerald-300"}`}>
                  {playing ? <Pause className="h-3 w-3"/> : <Play className="h-3 w-3 fill-current"/>}{playing ? "MUTE" : "AUDITION"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <div className="mx-auto flex h-[75vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-900 bg-neutral-900/20 shadow-2xl">
      <div className="flex items-center justify-between border-b border-neutral-900 bg-neutral-950 px-4 py-3">
        <div className="flex items-center gap-2.5"><OrangeLogo size={28}/><div><div className="font-mono text-[8px] font-bold uppercase tracking-wider text-neutral-500">Active Staff Specialist</div><div className="text-xs font-semibold">Nexus <span className="ml-1 rounded border border-orange-900/60 bg-orange-950/60 px-1.5 py-0.5 font-mono text-[8px] text-orange-400">ARCHITECT</span></div></div></div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[8px] text-neutral-400"><span className="mr-1.5 inline-block h-1 w-1 rounded-full bg-orange-500"/>OFFLINE COMPILER</div>
      </div>
      <div className="af-scroll flex flex-1 flex-col justify-center overflow-auto p-6">
        {messages.length === 0 ? <div className="mx-auto max-w-lg space-y-5 text-center"><div className="flex justify-center"><OrangeLogo size={72}/></div><div><h3 className="font-display text-sm font-black uppercase text-orange-500">ORANGEJUCE Studio</h3><p className="mt-1 font-mono text-[9px] uppercase tracking-widest text-neutral-500">Autonomous Audio DSP Co-Processor</p></div><p className="text-[10.5px] leading-relaxed text-neutral-400">Prompt ORANGEJUCE to design and compile filters, delays, waveshapers, and tape saturations in real time.</p></div> :
          <div className="space-y-3">{messages.map((m,i)=><div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-tr-none border border-neutral-800 bg-neutral-900 p-3 text-xs">{m}</div>)}</div>}
      </div>
      <form onSubmit={e=>{e.preventDefault();if(input.trim()){setMessages(m=>[...m,input]);setInput("");}}} className="border-t border-neutral-900 bg-neutral-950 p-3">
        <div className="relative"><input value={input} onChange={e=>setInput(e.target.value)} placeholder="Tell Nexus to edit or make a plugin..." className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 pr-11 text-xs text-white outline-none focus:border-orange-600"/><button className="absolute right-1.5 top-1.5 rounded-md bg-orange-600 p-2 text-white"><Send className="h-3 w-3"/></button></div>
      </form>
    </div>
  );
}

function PlaceholderPanel({ tab }: { tab: string }) {
  return <div className="mx-auto max-w-5xl rounded-2xl border border-neutral-900 bg-neutral-950/60 p-6"><div className="mb-6 flex items-center gap-3 border-b border-neutral-900 pb-4"><div className="rounded-xl border border-indigo-900/50 bg-indigo-950/80 p-2 text-indigo-400"><Workflow className="h-5 w-5"/></div><div><h2 className="font-display text-sm font-black uppercase text-indigo-400">{tab}</h2><p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">OrangeJuce production workspace</p></div></div><div className="grid grid-cols-3 gap-3">{["Workspace configuration","Active plugin pipeline","Build readiness"].map((x,i)=><div key={x} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"><div className="mb-3 h-1.5 rounded bg-neutral-800"><div className="h-full rounded bg-indigo-600" style={{width:`${55+i*17}%`}}/></div><div className="text-[10px] font-semibold text-neutral-300">{x}</div><div className="mt-1 font-mono text-[8px] text-neutral-600">LOCAL STATE · READY</div></div>)}</div></div>;
}

export function Current() {
  const [active, setActive] = useState<TabId>("playground");
  const [collapsed, setCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  return (
    <div className="af-root min-h-screen h-screen overflow-hidden flex flex-col antialiased">
      <header className="z-40 flex shrink-0 items-center justify-between border-b border-neutral-900 bg-neutral-950 px-4 py-2">
        <div className="flex items-center gap-2.5">
          <OrangeLogo/>
          <div>
            <div className="flex items-center gap-1.5"><h1 className="font-display font-extrabold tracking-tight text-orange-500">ORANGEJUCE</h1><span className="rounded border border-orange-900/60 bg-orange-950/60 px-1.5 py-0.5 font-mono text-[8px] font-black tracking-wider text-orange-400">DSP ENGINE</span><button className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-orange-400/20 bg-orange-600 text-[10px] font-black text-white">?</button></div>
            <p className="mt-0.5 text-[9px] text-neutral-500">Real-Time DSP Audio Compiler &amp; Sandbox</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <button onClick={()=>setModelOpen(!modelOpen)} className="flex max-w-[260px] items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/80 px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/><span className="font-mono text-[8px] font-bold tracking-wider text-neutral-400">OFFLINE COMPILER</span><ChevronDown className="h-2.5 w-2.5 text-neutral-500"/></button>
            {modelOpen && <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl"><div className="px-2 py-1 font-mono text-[8px] font-black uppercase tracking-widest text-neutral-500">AI Engine</div>{["Offline Compiler","Gemini Cloud","Ollama (local)","LM Studio (local)"].map((x,i)=><button key={x} onClick={()=>setModelOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[10px] text-neutral-300 hover:bg-neutral-800"><span className={`h-1.5 w-1.5 rounded-full ${i===0?"bg-emerald-500":"bg-red-500"}`}/>{x}</button>)}</div>}
          </div>
          <button className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[10px] font-semibold text-neutral-300"><Code2 className="h-3 w-3 text-emerald-400"/>Export Code</button>
          <button className="flex items-center gap-1 rounded-lg border border-orange-900/60 bg-orange-950/40 px-2.5 py-1 text-[10px] font-semibold text-orange-300"><MessageSquare className="h-3 w-3"/>Simple Mode</button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 bg-neutral-950">
        <nav className={`flex shrink-0 flex-col border-r border-neutral-900 bg-neutral-950 transition-all ${collapsed?"w-[52px]":"w-[184px]"}`}>
          <button onClick={()=>setCollapsed(!collapsed)} className="flex shrink-0 items-center gap-2 border-b border-neutral-900 px-3 py-2.5 text-neutral-500 hover:text-neutral-200">{collapsed?<PanelLeftOpen className="h-4 w-4"/>:<PanelLeftClose className="h-4 w-4"/>}{!collapsed&&<span className="font-mono text-[10px] font-bold uppercase tracking-wider">Workspace</span>}</button>
          <div className="af-scroll min-h-0 flex-1 overflow-y-auto">
            {groups.map(group=><div key={group.label} className="pb-1">{!collapsed?<div className="px-3 pb-1 pt-2 font-mono text-[8.5px] font-black uppercase tracking-widest text-neutral-600">{group.label}</div>:<div className="mx-3 my-1.5 border-t border-neutral-900"/>}
              {group.tabs.map(([id,label,Icon,color])=><button key={id} onClick={()=>setActive(id)} title={collapsed?label:undefined} className={`flex w-full items-center gap-2.5 border-l-2 py-2 pr-2 font-mono text-[11px] font-bold ${collapsed?"justify-center pl-2":"pl-[10px]"} ${active===id?(id==="chat"||id==="presets"||id==="memory"?"border-orange-500 bg-orange-950/25 text-orange-200":"border-indigo-500 bg-indigo-950/25 text-indigo-200"):"border-transparent text-neutral-400 hover:bg-neutral-900/50 hover:text-neutral-100"}`}><Icon className={`h-4 w-4 shrink-0 ${active===id?"":color}`}/>{!collapsed&&<span className="truncate">{label}</span>}</button>)}
            </div>)}
          </div>
        </nav>
        <section className="af-scroll min-w-0 flex-1 overflow-y-auto bg-neutral-950/40 p-4 md:p-5">
          {active==="playground"?<Playground/>:active==="chat"?<Chat/>:<PlaceholderPanel tab={tabLabels[active]}/>}
        </section>
      </main>
    </div>
  );
}