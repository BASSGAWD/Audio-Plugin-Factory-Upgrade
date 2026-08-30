import { useMemo, useState, type CSSProperties } from "react";
import { Activity, Check, ChevronDown, CircleHelp, Download, Play, RotateCcw, Save, SlidersHorizontal, X } from "lucide-react";
import "./CompactSignalFlowMatrix.css";

type Patch = { amount: number; color: string } | null;

const sources = [
  { id: "LFO", name: "TIDAL", color: "#e58251", rate: "0.18 HZ" },
  { id: "ENV", name: "SHARPEN", color: "#d2bd67", rate: "A 12 / R 640" },
  { id: "SEQ", name: "NIGHT", color: "#83b1b1", rate: "16 STEP" },
  { id: "MIDI", name: "PRESSURE", color: "#c19ac0", rate: "CH 01" },
  { id: "IN", name: "ROOM", color: "#d78b7a", rate: "−18.4 DB" },
];
const targets = ["PITCH", "SHAPE", "BIAS", "DRIVE", "TIME", "MIX", "PAN", "LEVEL"];
const initial: Patch[][] = [
  [{ amount: 48, color: "#e58251" }, { amount: 23, color: "#e58251" }, null, { amount: 17, color: "#e58251" }, { amount: 68, color: "#e58251" }, { amount: 38, color: "#e58251" }, { amount: 52, color: "#e58251" }, null],
  [{ amount: 17, color: "#d2bd67" }, { amount: 72, color: "#d2bd67" }, { amount: 61, color: "#d2bd67" }, { amount: 85, color: "#d2bd67" }, null, { amount: 24, color: "#d2bd67" }, null, { amount: 13, color: "#d2bd67" }],
  [{ amount: 32, color: "#83b1b1" }, null, { amount: 46, color: "#83b1b1" }, { amount: 21, color: "#83b1b1" }, { amount: 77, color: "#83b1b1" }, { amount: 54, color: "#83b1b1" }, { amount: 63, color: "#83b1b1" }, { amount: 40, color: "#83b1b1" }],
  [null, { amount: 19, color: "#c19ac0" }, null, null, { amount: 28, color: "#c19ac0" }, { amount: 65, color: "#c19ac0" }, { amount: 74, color: "#c19ac0" }, { amount: 58, color: "#c19ac0" }],
  [{ amount: 9, color: "#d78b7a" }, null, { amount: 18, color: "#d78b7a" }, { amount: 43, color: "#d78b7a" }, { amount: 35, color: "#d78b7a" }, { amount: 81, color: "#d78b7a" }, null, { amount: 49, color: "#d78b7a" }],
];

export function CompactSignalFlowMatrix() {
  const [patches, setPatches] = useState(initial);
  const [selected, setSelected] = useState<[number, number]>([2, 5]);
  const [monitoring, setMonitoring] = useState(true);
  const [saved, setSaved] = useState(true);
  const [note, setNote] = useState("");
  const patchCount = useMemo(() => patches.flat().filter(Boolean).length, [patches]);
  const announce = (text: string) => { setNote(text); window.setTimeout(() => setNote(""), 2200); };
  const toggle = (r: number, c: number) => {
    setSelected([r, c]);
    setPatches(current => current.map((row, ri) => row.map((patch, ci) => ri === r && ci === c ? (patch ? null : { amount: 42, color: sources[r].color }) : patch)));
    setSaved(false);
  };
  const reset = () => { setPatches(initial); setSaved(false); announce("Recalled the rehearsal map."); };
  const activeSource = sources[selected[0]];
  const activeTarget = targets[selected[1]];
  const selectedPatch = patches[selected[0]][selected[1]];

  return <div className="csm-shell csm-noise overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
    <div className="mx-auto max-w-[1170px]">
      <header className="mb-3 flex items-center justify-between rounded-xl border border-[#b9c0b1] bg-[#f5f1e6]/85 px-3 py-2.5 shadow-[0_8px_30px_rgba(45,62,53,.07)] sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e58251] text-[#28312b]"><Activity className="h-4 w-4" /></div>
          <div className="min-w-0"><div className="flex items-center gap-2"><strong className="text-[13px] tracking-[-.08em]">ORANGEJUCE</strong><span className="csm-mono rounded border border-[#e0bdab] bg-[#fff0e7] px-1 py-0.5 text-[8px] tracking-[.12em] text-[#aa5637]">PATCH LAB</span></div><p className="csm-mono mt-0.5 truncate text-[8px] tracking-[.06em] text-[#66756c]">TWO SIDES / ONE SIGNAL</p></div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-bold sm:flex ${saved ? "border-[#b8c9aa] bg-[#e8eedb] text-[#536a42]" : "border-[#e2c4a8] bg-[#faecdf] text-[#a4603d]"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{saved ? "SAVED" : "UNSAVED"}</span>
          <button onClick={() => { setSaved(true); announce("Patchbook saved locally."); }} className="grid h-8 w-8 place-items-center rounded-lg border border-[#bfc5b8] bg-[#fdf9ef] text-[#405149]" aria-label="Save patchbook"><Save className="h-3.5 w-3.5" /></button>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_224px]">
        <main className="overflow-hidden rounded-xl border border-[#465850] bg-[#21302b] shadow-[0_15px_35px_rgba(32,47,41,.17)]">
          <div className="flex items-center justify-between border-b border-[#465850] bg-[#26362f] px-3 py-2.5 sm:px-4">
            <div><p className="csm-mono text-[8px] tracking-[.18em] text-[#91a499]">ACTIVE PATCHBAY</p><h1 className="mt-0.5 text-[16px] font-bold tracking-[-.07em] text-[#edf0e8]">MODULATION <span className="text-[#e58251]">/</span> 08</h1></div>
            <div className="csm-mono flex items-center gap-2 text-[9px] text-[#c2ccc0]"><span className="csm-pulse h-2 w-2 rounded-full bg-[#e58251]" />{patchCount} ROUTES <ChevronDown className="h-3 w-3" /></div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[700px] p-3 sm:p-4">
              <div className="grid grid-cols-[112px_repeat(8,minmax(48px,1fr))] gap-1.5">
                <div className="flex items-end pb-1"><span className="csm-mono text-[8px] tracking-[.12em] text-[#83968b]">SOURCE / DEST</span></div>
                {targets.map((target, i) => <div key={target} className={`flex h-9 items-end justify-center border-b pb-1 ${selected[1] === i ? "border-[#e58251]" : "border-[#53645a]"}`}><span className="csm-mono text-[8px] tracking-[.06em] text-[#b8c5b9]">{target}</span></div>)}
                {sources.map((source, r) => <div className="contents" key={source.id}>
                  <div className={`flex h-[57px] items-center gap-2 rounded-md border px-2 ${selected[0] === r ? "border-[#83968b] bg-[#2b3d35]" : "border-[#3e5047] bg-[#1a2823]"}`}>
                    <span className="grid h-6 w-6 place-items-center rounded-full border text-[8px] font-bold" style={{ color: source.color, borderColor: source.color }}>{String(r + 1).padStart(2, "0")}</span>
                    <span className="min-w-0"><b className="block text-[9px] leading-none text-[#e1e8df]">{source.id} <em className="not-italic text-[#91a499]">{source.name}</em></b><small className="csm-mono mt-1 block text-[7px]" style={{ color: source.color }}>{source.rate}</small></span>
                  </div>
                  {patches[r].map((patch, c) => <button key={`${r}-${c}`} onClick={() => toggle(r, c)} aria-label={`Toggle ${source.id} to ${targets[c]}`} className={`csm-cell relative h-[57px] overflow-hidden rounded-md border ${selected[0] === r && selected[1] === c ? "border-[#dae5b7] bg-[#3b4d42]" : "border-[#3e5047] bg-[#1a2823]"}`}>
                    {patch && <span className={`csm-flow absolute inset-x-1.5 top-2 h-[2px] ${monitoring ? "" : "off"}`} style={{ "--route": patch.color } as CSSProperties} />}
                    {patch ? <span className="relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 bg-[#1c2b25] text-[8px] font-bold" style={{ color: patch.color, borderColor: patch.color, margin: "auto", transform: `scale(${.72 + patch.amount / 220})` }}>{patch.amount}</span> : <span className="relative z-10 mx-auto block h-1.5 w-1.5 rounded-full bg-[#53645a]" />}
                    {selected[0] === r && selected[1] === c && <Check className="absolute right-1 top-1 h-3 w-3 text-[#dbe7bd]" />}
                  </button>)}
                </div>)}
              </div>
            </div>
          </div>
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#465850] bg-[#1b2924] px-3 py-2 sm:px-4">
            <div className="flex gap-3">{sources.map(s => <span key={s.id} className="csm-mono flex items-center gap-1 text-[7px] text-[#aebbb0]"><i className="h-1.5 w-1.5 rounded-full" style={{ background:s.color }} />{s.id}</span>)}</div>
            <span className="csm-mono text-[7px] tracking-[.07em] text-[#7e9186]">CLICK CELL TO PATCH / UNPATCH</span>
          </div>
        </main>

        <aside className="flex flex-col gap-3">
          <section className="rounded-xl border border-[#b9c0b1] bg-[#f6f2e7] p-3 shadow-[0_8px_24px_rgba(45,62,53,.06)]">
            <div className="flex items-center justify-between"><span className="csm-mono text-[8px] tracking-[.14em] text-[#65766b]">ROUTE INSPECTOR</span><CircleHelp className="h-3.5 w-3.5 text-[#7f8e84]" /></div>
            <div className="mt-4 flex items-center justify-between"><div><b className="text-[18px] tracking-[-.09em]" style={{ color: activeSource.color }}>{activeSource.id}</b><p className="csm-mono text-[8px] text-[#708075]">{activeSource.name}</p></div><span className="text-[#809084]">→</span><div className="text-right"><b className="text-[18px] tracking-[-.09em]">{activeTarget}</b><p className="csm-mono text-[8px] text-[#708075]">DESTINATION</p></div></div>
            <div className="mt-4 rounded-lg border border-[#c4cabd] bg-[#e9e9de] p-2.5"><div className="flex justify-between"><span className="csm-mono text-[8px] text-[#6e7c72]">DEPTH</span><b className="csm-mono text-[10px]" style={{ color: activeSource.color }}>{selectedPatch ? `+${selectedPatch.amount}%` : "OFF"}</b></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#c9d0c3]"><div className="h-full rounded-full" style={{ width: `${selectedPatch?.amount ?? 0}%`, background: activeSource.color }} /></div></div>
          </section>
          <section className="rounded-xl border border-[#394c43] bg-[#2a3b33] p-3 text-[#ecf0e7]">
            <div className="flex items-center justify-between"><span className="csm-mono text-[8px] tracking-[.14em] text-[#adbcaf]">SIGNAL MONITOR</span><button onClick={() => setMonitoring(v => !v)} className={`rounded-full px-2 py-1 text-[8px] font-bold ${monitoring ? "bg-[#e58251] text-[#243029]" : "bg-[#52635a] text-[#dbe4d8]"}`}>{monitoring ? "LIVE" : "HOLD"}</button></div>
            <div className="mt-4 flex h-14 items-end gap-1 csm-meter">{[.3,.58,.82,.46,.95,.64,.4,.75,.52,.9,.37,.65].map((h, i) => <i key={i} className="block flex-1 rounded-t-sm bg-[#9fc1a2]" style={{ height:`${h * 100}%`, animationPlayState: monitoring ? "running" : "paused" }} />)}</div>
            <p className="csm-mono mt-3 text-[8px] text-[#9db0a2]">MOVING DASHES = ACTIVE VOLTAGE</p>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMonitoring(v => !v)} className="flex items-center justify-center gap-1.5 rounded-lg bg-[#e58251] px-2 py-2.5 text-[9px] font-bold text-[#233029]">{monitoring ? <X className="h-3 w-3" /> : <Play className="h-3 w-3" />}{monitoring ? "PAUSE" : "PLAY"}</button>
            <button onClick={reset} className="flex items-center justify-center gap-1.5 rounded-lg border border-[#aeb8aa] bg-[#f8f5eb] px-2 py-2.5 text-[9px] font-bold text-[#47594f]"><RotateCcw className="h-3 w-3" />RESET</button>
          </div>
        </aside>
      </div>
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[8px] text-[#65756c]"><p><span className="csm-mono mr-2 text-[#a85a3b]">TRACE NOTE</span>Routes remain visible while performing.</p><button onClick={() => announce("Export queue prepared.")} className="csm-mono flex items-center gap-1 text-[#8c5035]"><Download className="h-3 w-3" />EXPORT PATCH MAP</button></footer>
    </div>
    {note && <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#26372f] px-4 py-2 text-[10px] text-[#f4f1e7] shadow-lg"><SlidersHorizontal className="h-3 w-3 text-[#e58251]" />{note}<button onClick={() => setNote("")} aria-label="Dismiss"><X className="h-3 w-3" /></button></div>}
  </div>;
}