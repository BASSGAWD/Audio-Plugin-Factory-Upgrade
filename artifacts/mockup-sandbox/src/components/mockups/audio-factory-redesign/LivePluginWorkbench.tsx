import { useMemo, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, CircleHelp, Code2, Download, Headphones,
  MoreHorizontal, Play, RotateCcw, SlidersHorizontal, Sparkles, Volume2, X,
} from "lucide-react";

const characters = [
  { name: "Glass vocal", sub: "Clean edges · lifted air", color: "#ff8d5c" },
  { name: "Warm tape", sub: "Soft drag · rounded tone", color: "#b7bc74" },
  { name: "Night radio", sub: "Narrowband · low glow", color: "#8189bf" },
];

const stages = ["Brief", "Engine", "Macros", "Build"];

export function LivePluginWorkbench() {
  const [name, setName] = useState("Velvet Pitch");
  const [character, setCharacter] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState("");
  const [amount, setAmount] = useState(64);
  const [humanize, setHumanize] = useState(35);
  const [mix, setMix] = useState(92);
  const [advanced, setAdvanced] = useState(false);
  const active = characters[character];
  const signalBars = useMemo(() => Array.from({ length: 38 }, (_, i) => 18 + ((i * 13 + i * i * 5) % 68)), []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };
  const editName = (value: string) => { setName(value); setSaved(false); };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#eef0e7] text-[#243331] selection:bg-[#e77851] selection:text-[#fff7ed]" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Outfit:wght@400;500;600;700&display=swap');
        .lpw-mono{font-family:'DM Mono',monospace}.lpw-serif{font-family:'Instrument Serif',serif}
        .lpw-grid{background-image:linear-gradient(rgba(38,55,51,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(38,55,51,.055) 1px,transparent 1px);background-size:32px 32px}
        .lpw-wave span{animation:lpw-breathe 1.2s ease-in-out infinite;transform-origin:center}
        @keyframes lpw-breathe{50%{transform:scaleY(.38);opacity:.55}}
      `}</style>

      <header className="flex h-16 items-center justify-between border-b border-[#ccd3c7] bg-[#f7f7f0] px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#e96e47] shadow-[inset_0_-3px_0_rgba(100,44,28,.18)]"><div className="h-3.5 w-3.5 rounded-full border-2 border-[#243331]" /></div>
          <div className="leading-none"><b className="text-[14px] tracking-[-.05em]">ORANGEJUCE</b><span className="lpw-mono ml-2 rounded border border-[#dbbfad] bg-[#fff1e8] px-1.5 py-0.5 text-[8px] tracking-[.13em] text-[#a54b2c]">DSP LAB</span></div>
          <span className="hidden border-l border-[#cbd3c8] pl-3 text-[11px] text-[#74817b] sm:block">New instrument</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => notify("Shortcuts: space to audition, ⌘S to save.")} className="hidden p-2 text-[#68756f] md:block"><CircleHelp className="h-4 w-4" /></button>
          <button onClick={() => { setSaved(true); notify("Workspace saved locally."); }} className="lpw-mono flex items-center gap-2 rounded-lg border border-[#c9d1c5] bg-[#fbfcf7] px-3 py-2 text-[9px] tracking-[.1em] text-[#44534d]"><i className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-[#90a453]" : "bg-[#e36c47]"}`} />{saved ? "SAVED" : "SAVE"}</button>
          <button onClick={() => notify("Project options opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c9d1c5] bg-[#fbfcf7]"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="lpw-grid mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1500px] grid-cols-1 lg:grid-cols-[minmax(350px,.84fr)_minmax(480px,1.16fr)]">
        <section className="border-b border-[#ccd3c7] bg-[#f7f7f0]/75 p-5 md:p-8 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between">
            <div><p className="lpw-mono text-[9px] tracking-[.18em] text-[#8b9183]">GUIDED BUILD / 01</p><h1 className="lpw-serif mt-1 text-[35px] leading-none tracking-[-.045em] text-[#273532] md:text-[45px]">Name the feeling.</h1></div>
            <span className="grid h-9 w-9 place-items-center rounded-full border border-[#d7a68d] bg-[#fff0e6] text-[#be5937]"><Sparkles className="h-4 w-4" /></span>
          </div>

          <div className="mt-7 flex items-center gap-1.5">
            {stages.map((stage, index) => <button key={stage} onClick={() => notify(`${stage} is available once the brief is set.`)} className="group flex items-center gap-2">
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[8px] ${index === 0 ? "bg-[#2d423d] text-[#f8f5ec]" : "border border-[#bfc9bb] bg-[#f7f7f0] text-[#819087]"}`}>{index === 0 ? <Check className="h-3 w-3" /> : index + 1}</span>
              <span className={`hidden text-[10px] font-medium sm:block ${index === 0 ? "text-[#31453f]" : "text-[#89938b]"}`}>{stage}</span>
              {index !== stages.length - 1 && <i className="mx-1 h-px w-3 bg-[#cbd3c8] sm:w-5" />}
            </button>)}
          </div>

          <div className="mt-8 space-y-7">
            <label className="block"><span className="lpw-mono text-[9px] tracking-[.16em] text-[#7d8981]">PLUGIN NAME</span><input value={name} onChange={(event) => editName(event.target.value)} className="mt-2 w-full border-b-2 border-[#aebaae] bg-transparent pb-2 text-[23px] font-semibold tracking-[-.045em] outline-none transition-colors focus:border-[#e36f4c]" /></label>
            <div>
              <div className="mb-3 flex items-center justify-between"><span className="lpw-mono text-[9px] tracking-[.16em] text-[#7d8981]">STARTING CHARACTER</span><button onClick={() => setAdvanced(!advanced)} className="lpw-mono flex items-center gap-1 text-[9px] text-[#a95233]">DETAILS <ChevronDown className={`h-3 w-3 transition-transform ${advanced ? "rotate-180" : ""}`} /></button></div>
              <div className="space-y-2">{characters.map((item, index) => <button key={item.name} onClick={() => { setCharacter(index); setSaved(false); }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${character === index ? "border-[#dc805e] bg-[#fff4ed] shadow-[0_5px_13px_rgba(103,78,54,.07)]" : "border-[#d4dbd0] bg-[#fbfcf7] hover:border-[#abb9ab]"}`}>
                <span className="h-9 w-1.5 rounded-full" style={{ background: item.color }} /><span className="min-w-0 flex-1"><b className="block text-[12px]">{item.name}</b><small className="block text-[10px] text-[#75817a]">{item.sub}</small></span><span className={`grid h-4 w-4 place-items-center rounded-full border ${character === index ? "border-[#dc7550] bg-[#e86e49] text-white" : "border-[#bdc7bc]"}`}>{character === index && <Check className="h-2.5 w-2.5" />}</span>
              </button>)}</div>
              {advanced && <p className="mt-3 border-l-2 border-[#dfa07f] pl-3 text-[11px] leading-relaxed text-[#6e7c74]">The character seeds correction behavior, movement depth and default macro ranges. Every value remains adjustable.</p>}
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between border-t border-[#d4dbd0] pt-5"><p className="text-[11px] text-[#75817a]">Changes appear in the live unit.</p><button onClick={() => notify("Engine stage unlocked.")} className="flex items-center gap-2 rounded-full bg-[#2d423d] px-4 py-2.5 text-[10px] font-semibold text-[#f8f5ec] shadow-[0_4px_0_#172923]">NEXT: ENGINE <ChevronRight className="h-3.5 w-3.5" /></button></div>
        </section>

        <section className="bg-[#dfe6dd]/70 p-4 md:p-7">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#e4774f]" /><span className="lpw-mono text-[9px] tracking-[.16em] text-[#607069]">LIVE PLUGIN PREVIEW</span></div><button onClick={() => { setAmount(64); setHumanize(35); setMix(92); notify("Preview controls reset."); }} className="lpw-mono flex items-center gap-1 text-[9px] text-[#6e7b74]"><RotateCcw className="h-3 w-3" /> RESET</button></div>
          <div className="overflow-hidden rounded-[22px] border border-[#53665e] bg-[#1f302d] text-[#eaf0e8] shadow-[0_22px_38px_rgba(45,65,59,.2)]">
            <div className="flex items-center justify-between border-b border-[#4a5e56] bg-[#2b413c] px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-md bg-[#e5724d] text-[#24332f]"><Volume2 className="h-3.5 w-3.5" /></span><b className="text-[12px] tracking-[-.03em]">{name || "Untitled plugin"}</b></div><div className="lpw-mono flex items-center gap-3 text-[8px] tracking-[.12em] text-[#adbbb4]"><span>VST3</span><span>AU</span><span className="rounded bg-[#40534d] px-1.5 py-1 text-[#dfedce]">READY</span></div></div>
            <div className="p-4 md:p-6">
              <div className="flex items-start justify-between"><div><p className="lpw-mono text-[8px] tracking-[.16em] text-[#a4b3ab]">VOICE CORRECTOR</p><h2 className="mt-1 text-[19px] font-medium tracking-[-.04em]">{active.name}</h2></div><button onClick={() => setPlaying(!playing)} className={`grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-95 ${playing ? "bg-[#cbdc91] text-[#26352f]" : "bg-[#e57750] text-[#293631]"}`}>{playing ? <Headphones className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button></div>
              <div className="mt-5 rounded-xl border border-[#435951] bg-[#192925] p-3"><div className="mb-2 flex justify-between"><span className="lpw-mono text-[8px] tracking-[.13em] text-[#a8b7ae]">INPUT MONITOR</span><span className="lpw-mono text-[8px] text-[#d8e6d5]">{playing ? "PLAYING · 0:07" : "12 SEC VOCAL PASS"}</span></div><div className="lpw-wave flex h-14 items-center gap-[3px] overflow-hidden">{signalBars.map((height, i) => <span key={i} className="w-[3px] flex-1 rounded-full bg-[#df7954]" style={{ height: `${height}%`, animationDelay: `${i * 35}ms`, animationPlayState: playing ? "running" : "paused" }} />)}</div></div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[["RETUNE", amount, setAmount, "ms"], ["HUMANIZE", humanize, setHumanize, "%"], ["MIX", mix, setMix, "%"]].map(([label, value, setter, unit], i) => <div key={String(label)} className="text-center"><button onClick={() => notify(`${String(label).toLowerCase()} is mapped to Macro ${i + 1}.`)} className="relative mx-auto grid h-16 w-16 place-items-center rounded-full border-[6px] border-[#53655e] bg-[#14221f] shadow-[inset_0_0_0_2px_#263a35]"><i className="absolute top-[3px] h-4 w-[2px] rounded bg-[#e78059]" style={{ transform: `rotate(${Number(value) * 2.1 - 105}deg)`, transformOrigin: "bottom center" }} /><span className="lpw-mono mt-5 text-[10px]">{String(value)}<small className="ml-0.5 text-[7px] text-[#9aaba2]">{String(unit)}</small></span></button><label className="mt-2 block text-[9px] font-semibold tracking-[.1em] text-[#bfcec6]">{String(label)}<input aria-label={String(label)} type="range" min="0" max="100" value={Number(value)} onChange={(e) => { (setter as (v: number) => void)(Number(e.target.value)); setSaved(false); }} className="mt-1 block h-1 w-full cursor-pointer accent-[#e77c55]" /></label></div>)}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#40554e] pt-3"><span className="lpw-mono text-[8px] text-[#99aaa2]">LATENCY 8.2ms</span><button onClick={() => notify("Macro map opened.")} className="flex items-center gap-1 text-[9px] text-[#d4e2d2]"><SlidersHorizontal className="h-3 w-3" /> EDIT MACROS</button></div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c5d0c4] bg-[#f7f8f1]/80 px-4 py-3"><div className="flex items-center gap-2"><Code2 className="h-4 w-4 text-[#667c65]" /><p className="text-[10px] text-[#607069]">Architecture updates while you design.</p></div><button onClick={() => notify("Build package is staged for export.")} className="lpw-mono flex items-center gap-1 rounded-md bg-[#e8f0dc] px-2.5 py-1.5 text-[9px] font-medium text-[#4a6246]"><Download className="h-3 w-3" /> STAGE BUILD</button></div>
        </section>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full bg-[#273d37] px-4 py-2.5 text-[11px] text-[#f6f5ec] shadow-lg">{toast}<button onClick={() => setToast("")} className="ml-3 text-[#c7d3c7]"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}