import { useMemo, useState } from "react";
import {
  ArrowRight, AudioLines, Check, ChevronDown, ChevronRight, CircleHelp,
  Code2, Cpu, Download, FileAudio, Gauge, Layers3, Play, Plus, SlidersHorizontal,
  Sparkles, Terminal, Wand2, X,
} from "lucide-react";

const steps = [
  { id: "brief", kicker: "01", title: "Define the feeling", note: "A few choices shape the entire signal path.", icon: Sparkles },
  { id: "voice", kicker: "02", title: "Choose the engine", note: "Start with a focused audio architecture.", icon: Cpu },
  { id: "controls", kicker: "03", title: "Shape the instrument", note: "Tune what musicians will touch.", icon: SlidersHorizontal },
  { id: "build", kicker: "04", title: "Listen & ship", note: "Audition the result, then export a clean build.", icon: Download },
] as const;

const moods = [
  { name: "Glass vocal", detail: "Precise pitch, soft edges", tone: "from-[#ffdbbd] to-[#f0864c]" },
  { name: "Warm tape", detail: "Compression with a little drag", tone: "from-[#d0e5d8] to-[#598a73]" },
  { name: "Night radio", detail: "Lo-fi color, gentle movement", tone: "from-[#cdd2f0] to-[#59639c]" },
];

function CitrusMark({ size = 34 }: { size?: number }) {
  return <div className="grid shrink-0 place-items-center rounded-[12px] bg-[#f46f36] shadow-[inset_0_-3px_0_rgba(113,36,10,.23)]" style={{ width: size, height: size }}>
    <div className="relative h-[62%] w-[62%] rounded-full border-[2px] border-[#452216]">
      <i className="absolute -left-[5px] top-[38%] h-[8px] w-[5px] rounded-l-sm bg-[#452216]" />
      <i className="absolute -right-[5px] top-[38%] h-[8px] w-[5px] rounded-r-sm bg-[#452216]" />
      <i className="absolute left-[31%] top-[-7px] h-[7px] w-[13px] -rotate-[38deg] rounded-[100%_0_100%_0] bg-[#81b47a]" />
    </div>
  </div>;
}

export function GuidedBuildFlow() {
  const [step, setStep] = useState(0);
  const [mood, setMood] = useState(0);
  const [audition, setAudition] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [toast, setToast] = useState("");
  const [pluginName, setPluginName] = useState("Velvet Pitch");
  const progress = useMemo(() => ((step + 1) / steps.length) * 100, [step]);
  const next = () => {
    if (step < steps.length - 1) setStep(step + 1);
    else { setToast("Build package ready in your downloads."); window.setTimeout(() => setToast(""), 2800); }
  };
  const active = steps[step];
  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f1e9] text-[#332b25] selection:bg-[#f9a476] selection:text-[#332b25]" style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap');
        .gb-ser { font-family: Fraunces, Georgia, serif; } .gb-mono { font-family: "DM Mono", monospace; }
        .gb-grid { background-image: linear-gradient(rgba(69,55,43,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(69,55,43,.045) 1px,transparent 1px); background-size: 26px 26px; }
        .gb-wave { background: repeating-linear-gradient(90deg,#f2743c 0 2px,transparent 2px 5px); mask-image: linear-gradient(90deg,transparent,black 10%,black 90%,transparent); }
        @keyframes gb-eq { 50% { transform: scaleY(.35) } } .gb-eq i { animation: gb-eq .8s ease-in-out infinite; transform-origin:center }
      `}</style>
      <header className="relative z-10 flex h-[68px] items-center justify-between border-b border-[#ded6c9] bg-[#faf7f1]/90 px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><CitrusMark /><div><div className="flex items-center gap-2"><span className="text-[15px] font-bold tracking-[-.04em]">ORANGEJUCE</span><span className="gb-mono rounded border border-[#e6b297] bg-[#fff0e7] px-1.5 py-0.5 text-[8px] font-medium tracking-[.12em] text-[#ad4d27]">DSP WORKBENCH</span></div><p className="gb-mono mt-0.5 text-[9px] tracking-wide text-[#82766a]">ONE PLUGIN, FROM THOUGHT TO BUILD</p></div></div>
        <div className="hidden items-center gap-5 md:flex"><button className="gb-mono flex items-center gap-1 text-[10px] text-[#71655a]"><CircleHelp className="h-3.5 w-3.5" /> HOW IT WORKS</button><div className="h-5 border-l border-[#ded6c9]" /><button onClick={() => setToast("Your project is saved locally.")} className="gb-mono rounded-full border border-[#d9cfc2] bg-[#fffdf8] px-3 py-1.5 text-[10px] font-medium text-[#4c4036]">SAVE DRAFT</button></div>
      </header>

      <main className="gb-grid relative mx-auto grid min-h-[calc(100dvh-68px)] max-w-[1440px] grid-cols-1 lg:grid-cols-[286px_minmax(0,1fr)_285px]">
        <aside className="border-b border-[#ded6c9] bg-[#eee8de]/80 px-5 py-6 lg:border-b-0 lg:border-r lg:px-7 lg:py-9">
          <p className="gb-mono text-[9px] font-medium tracking-[.18em] text-[#8b7d70]">BUILD PATH</p>
          <div className="relative mt-5 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible">
            <div className="absolute left-[17px] top-5 hidden h-[calc(100%-40px)] border-l border-[#d6cbbd] lg:block" />
            {steps.map((item, index) => { const Icon = item.icon; const isActive = index === step; const done = index < step; return <button key={item.id} onClick={() => setStep(index)} className={`relative z-10 flex min-w-[158px] items-center gap-3 rounded-xl p-2 text-left transition-all lg:w-full ${isActive ? "bg-[#fffaf3] shadow-[0_6px_16px_rgba(92,67,48,.08)]" : "hover:bg-[#f7f2ea]"}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${isActive ? "border-[#d95a2b] bg-[#ed6f36] text-white" : done ? "border-[#7fa383] bg-[#7fa383] text-white" : "border-[#cfc3b5] bg-[#eee8de] text-[#998c7f]"}`}>{done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}</span>
              <span><span className="gb-mono block text-[8px] tracking-widest text-[#a09487]">{item.kicker}</span><span className={`block text-[12px] font-semibold ${isActive ? "text-[#3b2b21]" : "text-[#71655a]"}`}>{item.title}</span></span>
            </button>})}
          </div>
          <div className="mt-7 hidden rounded-xl border border-[#ded2c4] bg-[#f7f2ea] p-3 lg:block"><div className="flex items-center gap-2"><FileAudio className="h-4 w-4 text-[#db6938]" /><span className="text-[11px] font-semibold">Local session</span></div><p className="gb-mono mt-2 text-[9px] leading-relaxed text-[#887b6e]">Everything stays in the workshop until you export.</p></div>
        </aside>

        <section className="flex min-w-0 flex-col px-5 py-8 md:px-10 md:py-12">
          <div className="mb-7 flex items-center justify-between"><span className="gb-mono text-[10px] tracking-[.15em] text-[#a6502c]">{active.kicker} / 04</span><span className="gb-mono text-[9px] text-[#8d8073]">{Math.round(progress)}% COMPLETE</span></div>
          <div className="h-1 overflow-hidden rounded-full bg-[#dfd6ca]"><div className="h-full rounded-full bg-[#eb713b] transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="mt-10 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-500" key={step}>
            <h1 className="gb-ser text-4xl leading-[.98] tracking-[-.055em] text-[#39291f] md:text-6xl">{active.title}</h1>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[#75685d]">{active.note}</p>

            {step === 0 && <div className="mt-9 space-y-6"><label className="block"><span className="gb-mono text-[9px] tracking-[.15em] text-[#887b7c]">PLUGIN NAME</span><input value={pluginName} onChange={e => setPluginName(e.target.value)} className="mt-2 block w-full border-b-2 border-[#b9aa9a] bg-transparent py-2 text-2xl font-semibold tracking-[-.035em] outline-none transition-colors focus:border-[#e36c37]" /></label><div><div className="mb-3 flex items-center justify-between"><span className="gb-mono text-[9px] tracking-[.15em] text-[#887b7c]">STARTING POINT</span><button onClick={() => setAdvanced(!advanced)} className="gb-mono flex items-center gap-1 text-[9px] text-[#b3542e]">DETAILS <ChevronDown className={`h-3 w-3 transition-transform ${advanced ? "rotate-180" : ""}`} /></button></div><div className="grid gap-2 sm:grid-cols-3">{moods.map((m, i) => <button onClick={() => setMood(i)} key={m.name} className={`rounded-xl border p-3 text-left transition-all ${mood === i ? "border-[#df6936] bg-[#fff7ef] shadow-sm" : "border-[#dbd1c5] bg-[#f9f5ee] hover:border-[#c9ad98]"}`}><span className={`mb-5 block h-2 w-full rounded-full bg-gradient-to-r ${m.tone}`} /><b className="block text-[12px]">{m.name}</b><small className="mt-1 block text-[10px] leading-snug text-[#88796e]">{m.detail}</small></button>)}</div>{advanced && <p className="mt-3 border-l-2 border-[#df8a61] pl-3 text-[11px] leading-relaxed text-[#796b60]">You can alter harmonic density, latency target, and musical scale after the first audition.</p>}</div></div>}
            {step === 1 && <div className="mt-9 space-y-3">{[["Pitch tracker", "Monophonic, low-latency estimation", "enabled"], ["Formant preserve", "Keeps the vocal character intact", "enabled"], ["Natural vibrato", "Reintroduces human motion after correction", "off"]].map(([name, detail, state]) => <button key={name} onClick={() => setToast(`${name} ${state === "enabled" ? "toggled" : "configured"}.`)} className="flex w-full items-center justify-between rounded-xl border border-[#dcd2c7] bg-[#fbf8f2] p-4 text-left hover:border-[#e29976]"><span><b className="text-[13px]">{name}</b><span className="mt-1 block text-[11px] text-[#85776b]">{detail}</span></span><span className={`h-5 w-9 rounded-full p-0.5 ${state === "enabled" ? "bg-[#df6d38]" : "bg-[#cfc4b7]"}`}><i className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${state === "enabled" ? "translate-x-4" : ""}`} /></span></button>)}</div>}
            {step === 2 && <div className="mt-9 rounded-2xl border border-[#d8cec1] bg-[#fbf8f2] p-5"><div className="flex items-center justify-between"><div><span className="gb-mono text-[9px] tracking-[.14em] text-[#956e5b]">CONTROL SURFACE</span><h3 className="mt-1 text-[16px] font-semibold">Three useful knobs. No clutter.</h3></div><Layers3 className="h-5 w-5 text-[#d46436]" /></div><div className="mt-8 grid grid-cols-3 gap-5">{[["Retune","18 ms"],["Humanize","42 %"],["Mix","100 %"]].map(([n,v],i) => <button key={n} onClick={() => setToast(`${n} control selected.`)} className="text-center"><span className="relative mx-auto block h-16 w-16 rounded-full border-[7px] border-[#d8cdbf] bg-[#493a31] shadow-[inset_0_0_0_3px_#746153]"><i className="absolute left-1/2 top-[5px] h-4 w-[2px] -translate-x-1/2 rounded bg-[#f69567]" style={{ transform: `translateX(-50%) rotate(${i * 25 - 20}deg)`, transformOrigin: "bottom" }} /></span><b className="mt-3 block text-[11px]">{n}</b><span className="gb-mono text-[9px] text-[#c05a30]">{v}</span></button>)}</div></div>}
            {step === 3 && <div className="mt-9 rounded-2xl border border-[#d6cabd] bg-[#332923] p-5 text-[#fcf3e8] shadow-[0_18px_35px_rgba(78,51,34,.17)]"><div className="flex items-start justify-between"><div><span className="gb-mono text-[9px] tracking-[.15em] text-[#ec9a70]">READY TO AUDITION</span><h3 className="gb-ser mt-1 text-2xl">“{pluginName}”</h3></div><span className="gb-mono rounded border border-[#8e6a57] px-2 py-1 text-[8px] text-[#f3c9ad]">VST3 · AU</span></div><div className="mt-8 flex items-center gap-4"><button onClick={() => setAudition(!audition)} className="grid h-12 w-12 place-items-center rounded-full bg-[#f17b44] text-[#3f2519]">{audition ? <Gauge className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}</button><div className="gb-wave h-10 flex-1 opacity-90" /><div className="gb-eq flex h-8 items-center gap-1">{[1,2,3,4,5].map(x => <i key={x} className="h-full w-1 bg-[#ed895c]" style={{ animationDelay: `${x * 80}ms`, animationPlayState: audition ? "running" : "paused" }} />)}</div></div><p className="mt-4 text-[11px] text-[#c9b6a7]">{audition ? "Monitoring the current build. Adjustments are reflected instantly." : "Press play to hear a 12-second vocal pass."}</p></div>}
          </div>
          <div className="mt-10 flex items-center gap-3"><button onClick={next} className="flex items-center gap-2 rounded-full bg-[#3d3028] px-5 py-3 text-[12px] font-semibold text-[#fff7eb] shadow-[0_5px_0_#201814] transition-transform hover:-translate-y-0.5 active:translate-y-0">{step === 3 ? <><Download className="h-4 w-4" /> EXPORT BUILD</> : <>CONTINUE <ArrowRight className="h-4 w-4" /></>}</button>{step > 0 && <button onClick={() => setStep(step - 1)} className="gb-mono px-3 py-2 text-[10px] text-[#847669]">BACK</button>}</div>
        </section>

        <aside className="border-t border-[#ded6c9] bg-[#f0ebe2]/85 p-5 lg:border-l lg:border-t-0 lg:p-7"><p className="gb-mono text-[9px] tracking-[.16em] text-[#8c7e71]">BUILD RECEIPT</p><div className="mt-5 rounded-xl border border-[#d7ccbf] bg-[#faf7f1] p-4"><div className="flex items-center gap-2"><AudioLines className="h-4 w-4 text-[#dc6635]" /><b className="text-[12px]">{pluginName}</b></div><div className="mt-4 space-y-3">{[["Character", moods[mood].name],["Engine", step > 1 ? "Pitch tracking + formant" : "Not selected yet"],["Controls", step > 2 ? "3 macro controls" : "Awaiting design"],["Target", "VST3 / AU"]].map(([l,v]) => <div key={l} className="flex justify-between gap-3 text-[10px]"><span className="text-[#8c7e71]">{l}</span><span className="text-right font-medium text-[#4b3c32]">{v}</span></div>)}</div></div><div className="mt-5 rounded-xl border border-dashed border-[#cfc2b4] p-3"><div className="flex items-center gap-2 text-[#765746]"><Terminal className="h-3.5 w-3.5" /><span className="gb-mono text-[9px]">LOCAL COMPILER</span></div><p className="mt-2 text-[10px] leading-relaxed text-[#88796d]">No cloud queue. Your signal architecture is compiled in this workspace.</p></div><button onClick={() => setToast("A build specialist has been notified.")} className="mt-5 flex items-center gap-1.5 text-[10px] font-semibold text-[#a44d2a]">ASK A SPECIALIST <ChevronRight className="h-3.5 w-3.5" /></button></aside>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#3c3028] px-4 py-2.5 text-[11px] text-[#fff5e9] shadow-xl">{toast}<button onClick={() => setToast("")} className="ml-3 align-middle text-[#dbb8a2]"><X className="inline h-3 w-3" /></button></div>}
    </div>
  );
}