import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Clock3,
  Download,
  FileAudio,
  FolderArchive,
  MoreHorizontal,
  Pause,
  Play,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";

type Gate = "Audio" | "Metadata" | "Artwork" | "Approvals";

const initialGates: Record<Gate, boolean> = {
  Audio: true,
  Metadata: true,
  Artwork: false,
  Approvals: true,
};

const events = [
  ["14:32", "Jules Tan", "Approved arrangement & automation", "Production"],
  ["13:48", "Rae Ellis", "Approved vocal print", "Vocal"],
  ["12:17", "Mara Singh", "Resolved 01:17 balance note", "Mix"],
  ["11:06", "Owen James", "Submitted V12 release candidate", "Lead"],
];

export function ReleaseHandoffCommandCenter() {
  const [gates, setGates] = useState(initialGates);
  const [isPlaying, setIsPlaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const ready = useMemo(() => Object.values(gates).filter(Boolean).length, [gates]);

  const alert = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const toggleGate = (gate: Gate) => setGates((current) => ({ ...current, [gate]: !current[gate] }));

  return (
    <div className="min-h-[100dvh] bg-[#e8e5db] p-3 font-['DM_Sans',sans-serif] text-[#172b35] selection:bg-[#ffb54c] md:p-7">
      <main className="mx-auto max-w-[1380px] overflow-hidden rounded-[24px] border border-[#bec8c0] bg-[#f6f1e6] shadow-[0_26px_70px_rgba(32,54,58,.16)]">
        <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#cbd2c7] bg-[#edf0e8] px-5 py-4 md:px-8">
          <div className="flex items-center gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#173842] text-[#f7c35b] shadow-[inset_0_-3px_0_rgba(3,26,32,.28)]"><CircleDot className="h-5 w-5" /></div>
            <div>
              <div className="font-mono text-[9px] font-bold tracking-[.18em] text-[#60746f]">ORANGEJUCE / RELEASE OPS</div>
              <div className="mt-0.5 text-[15px] font-semibold tracking-[-.04em]">Final release command</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => alert("Archive bundle is preparing.")} className="flex items-center gap-2 rounded-lg border border-[#c4cdc3] bg-[#fbf8ef] px-3 py-2 font-mono text-[9px] font-bold tracking-[.09em] text-[#46605d]"><Download className="h-3.5 w-3.5" /> EXPORT</button>
            <div className="relative">
              <button onClick={() => setMenu(!menu)} className="grid h-9 w-9 place-items-center rounded-lg border border-[#c4cdc3] bg-[#fbf8ef] text-[#46605d]" aria-label="More options"><MoreHorizontal className="h-4 w-4" /></button>
              {menu && <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-[#c3ccc2] bg-[#fbf8ef] p-1.5 text-[11px] shadow-xl"><button onClick={() => { setMenu(false); alert("Share link copied."); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-[#e6ede7]">Copy secure review link</button><button onClick={() => { setMenu(false); alert("A fresh report was generated."); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-[#e6ede7]">Generate audit report</button></div>}
            </div>
          </div>
        </header>

        <section className="grid lg:grid-cols-[minmax(0,1fr)_370px]">
          <div className="border-b border-[#cbd2c7] lg:border-b-0 lg:border-r">
            <div className="relative overflow-hidden bg-[#173842] px-6 py-7 text-[#f8f3e7] md:px-9 md:py-9">
              <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full border-[28px] border-[#2f5960] opacity-65" />
              <div className="relative flex flex-wrap items-end justify-between gap-5">
                <div>
                  <div className="mb-3 flex items-center gap-2 font-mono text-[9px] font-bold tracking-[.17em] text-[#f5bd58]"><SlidersHorizontal className="h-4 w-4" /> CANDIDATE / VP-12</div>
                  <h1 className="max-w-xl text-[39px] font-semibold leading-[.9] tracking-[-.075em] md:text-[57px]">Velvet Pitch<br /><span className="text-[#f6bd58]">Humanize Window</span></h1>
                  <p className="mt-4 max-w-lg text-[13px] leading-relaxed text-[#c8d7d0]">One release candidate. Four operational gates. A live control surface for the people who have to ship it.</p>
                </div>
                <div className="rounded-2xl border border-[#527179] bg-[#214750] px-5 py-4">
                  <div className="font-mono text-[8px] tracking-[.15em] text-[#a9c1bb]">READINESS SCORE</div>
                  <div className="mt-1 text-[35px] font-semibold leading-none tracking-[-.08em]">{ready}<span className="text-[18px] text-[#9bb5ad]">/4</span></div>
                  <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-[#41636a]"><div className="h-full bg-[#f6bd58] transition-all duration-300" style={{ width: `${ready * 25}%` }} /></div>
                </div>
              </div>
            </div>

            <div className="px-6 py-7 md:px-9">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div><div className="font-mono text-[9px] font-bold tracking-[.15em] text-[#75877c]">RELEASE GATES</div><h2 className="mt-1 text-[22px] font-semibold tracking-[-.05em]">Clear the runway</h2></div>
                <span className={`rounded-full px-3 py-1.5 font-mono text-[9px] font-bold tracking-[.1em] ${ready === 4 ? "bg-[#d6e8d8] text-[#27704d]" : "bg-[#f8dfae] text-[#8a5813]"}`}>{ready === 4 ? "READY TO SEND" : `${4 - ready} BLOCKER OPEN`}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(gates) as Gate[]).map((gate, index) => {
                  const done = gates[gate];
                  const details = [
                    ["V12_MASTER.wav", "24-bit / 48 kHz · 174.8 MB"],
                    ["Release sheet verified", "ISRC · writers · territories"],
                    ["Cover package missing", "3000 × 3000 source required"],
                    ["2 sign-offs on record", "Jules Tan + Rae Ellis"],
                  ][index];
                  return <button key={gate} onClick={() => toggleGate(gate)} className={`group flex min-h-[112px] items-start gap-3 rounded-2xl border p-4 text-left transition duration-200 hover:-translate-y-0.5 ${done ? "border-[#bcd4c3] bg-[#edf4eb]" : "border-[#e3bd6e] bg-[#fff1d3]"}`}>
                    <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${done ? "bg-[#287354] text-[#f1f8ed]" : "bg-[#d68625] text-[#fff7e7]"}`}>{done ? <Check className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span>
                    <span><span className="flex items-center gap-2 text-[14px] font-semibold tracking-[-.025em]">{gate}<ChevronDown className="h-3.5 w-3.5 opacity-40 transition group-hover:translate-y-0.5" /></span><span className="mt-2 block text-[11px] font-medium text-[#49615a]">{details[0]}</span><span className="mt-0.5 block font-mono text-[8px] tracking-[.06em] text-[#78877e]">{details[1]}</span></span>
                  </button>;
                })}
              </div>
            </div>
          </div>

          <aside className="bg-[#e7ede6] p-6 md:p-8">
            <div className="flex items-start justify-between">
              <div><div className="font-mono text-[9px] font-bold tracking-[.15em] text-[#75877c]">FINAL PRINT</div><h2 className="mt-1 text-[21px] font-semibold tracking-[-.05em]">Listen, then launch.</h2></div>
              <FileAudio className="h-5 w-5 text-[#507168]" />
            </div>
            <div className="mt-5 rounded-2xl bg-[#f9f5eb] p-4 shadow-[0_8px_20px_rgba(48,74,63,.08)]">
              <div className="flex items-center justify-between font-mono text-[8px] tracking-[.1em] text-[#72827b]"><span>VELVET_PITCH_V12</span><span>03:42</span></div>
              <div className="mt-5 flex h-12 items-center gap-[3px]">{Array.from({ length: 60 }, (_, i) => <i key={i} className="w-full rounded-full bg-[#2e6d63]" style={{ height: `${10 + ((i * i * 7 + i * 11) % 33)}px`, opacity: i < 34 ? 0.9 : 0.35 }} />)}</div>
              <div className="mt-5 flex items-center gap-3"><button onClick={() => setIsPlaying(!isPlaying)} className="grid h-10 w-10 place-items-center rounded-full bg-[#173842] text-[#f6bd58]">{isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#d6ded6]"><div className="h-full w-[39%] bg-[#e49a2c]" /></div><span className="font-mono text-[9px] text-[#60766d]">{isPlaying ? "01:26" : "00:00"}</span></div>
            </div>
            <div className="mt-7 border-y border-[#c8d3ca] py-5">
              <div className="mb-4 flex items-center justify-between"><div className="font-mono text-[9px] font-bold tracking-[.14em] text-[#75877c]">SIGNAL LOG</div><span className="font-mono text-[8px] text-[#789087]">17 JUN / PDT</span></div>
              <div className="space-y-4">{events.map(([time, person, action, role]) => <div key={time} className="grid grid-cols-[38px_1fr] gap-3"><time className="font-mono text-[9px] text-[#59736a]">{time}</time><div className="border-l border-[#b8cbc1] pl-3"><div className="flex justify-between gap-2"><span className="text-[11px] font-semibold">{person}</span><span className="font-mono text-[8px] text-[#809087]">{role}</span></div><p className="mt-0.5 text-[10px] leading-relaxed text-[#647971]">{action}</p></div></div>)}</div>
            </div>
            <button onClick={() => ready === 4 ? alert("Handoff package sent to Northbridge Records.") : alert("Clear every release gate before sending.")} className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-mono text-[9px] font-bold tracking-[.11em] transition ${ready === 4 ? "bg-[#dd8f23] text-[#fff7e9] shadow-[inset_0_-3px_0_rgba(108,62,10,.23)]" : "bg-[#bcc7bf] text-[#687a72]"}`}><Send className="h-3.5 w-3.5" /> {ready === 4 ? "SEND HANDOFF" : "HANDOFF ON HOLD"}</button>
            <button onClick={() => alert("Release record opened.")} className="mt-3 flex w-full items-center justify-center gap-2 py-2 font-mono text-[9px] font-bold tracking-[.08em] text-[#42645b]"><FolderArchive className="h-3.5 w-3.5" /> OPEN RELEASE RECORD <ArrowUpRight className="h-3.5 w-3.5" /></button>
          </aside>
        </section>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#cbd2c7] bg-[#f0eee6] px-6 py-3 font-mono text-[8px] tracking-[.1em] text-[#73837a] md:px-9"><span className="flex items-center gap-2"><Archive className="h-3.5 w-3.5" /> IMMUTABLE RECORD · VP-12-RH</span><span>DESTINATION · NORTHBRIDGE RECORDS / RELEASE OPS</span></footer>
      </main>
      {notice && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#173842] px-4 py-2.5 text-[11px] text-[#f7f3e7] shadow-xl"><CircleCheck className="h-4 w-4 text-[#f6bd58]" />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X className="h-3.5 w-3.5 text-[#aec2bb]" /></button></div>}
    </div>
  );
}