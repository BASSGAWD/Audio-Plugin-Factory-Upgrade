import { useMemo, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clock3, Copy,
  GitCompareArrows, Headphones, MessageSquareText, MoreHorizontal, Play,
  Send, Sparkles, Volume2, X,
} from "lucide-react";

const collaborators = [
  { initials: "MS", name: "Mara Singh", role: "Mix engineer", tone: "#e77c55" },
  { initials: "JT", name: "Jules Tan", role: "Sound designer", tone: "#7988bc" },
  { initials: "RE", name: "Rae Ellis", role: "Producer", tone: "#a4aa62" },
];

const notes = [
  { author: "Mara", initials: "MS", tone: "#e77c55", time: "12m", text: "The vowel lift feels right. Can we keep the original sibilance after 6k?", marker: "0:06.3", status: "open" },
  { author: "Jules", initials: "JT", tone: "#7988bc", time: "28m", text: "I pushed the humanize window a touch. A/B below has the less mechanical pass.", marker: "0:11.8", status: "compare" },
  { author: "Rae", initials: "RE", tone: "#a4aa62", time: "1h", text: "Approved from my side. This is the character we heard in the room.", marker: "0:17.2", status: "approved" },
];

export function CollaborativePluginReview() {
  const [playing, setPlaying] = useState(false);
  const [activeNote, setActiveNote] = useState(1);
  const [compare, setCompare] = useState(true);
  const [approved, setApproved] = useState(false);
  const [reply, setReply] = useState("");
  const [toast, setToast] = useState("");
  const bars = useMemo(() => Array.from({ length: 56 }, (_, i) => 20 + ((i * 19 + i * i * 3) % 66)), []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };
  const submitReply = () => {
    if (!reply.trim()) return;
    setReply("");
    notify("Reply added to the review lane.");
  };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#eef0e7] text-[#263530] selection:bg-[#e77c55] selection:text-[#fff8ef]" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Outfit:wght@400;500;600;700&display=swap');
      .cpr-mono{font-family:'DM Mono',monospace}.cpr-serif{font-family:'Instrument Serif',serif}.cpr-grid{background-image:linear-gradient(rgba(38,53,48,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(38,53,48,.055) 1px,transparent 1px);background-size:32px 32px}.cpr-wave span{transform-origin:center;animation:cpr-wave 1.15s ease-in-out infinite}@keyframes cpr-wave{50%{transform:scaleY(.42);opacity:.45}}.cpr-enter{animation:cpr-enter .55s both}@keyframes cpr-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <header className="flex h-16 items-center justify-between border-b border-[#cbd3c7] bg-[#f7f7f0] px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#e96e47] shadow-[inset_0_-3px_0_rgba(100,44,28,.18)]"><div className="h-3.5 w-3.5 rounded-full border-2 border-[#263530]" /></div>
          <div className="min-w-0 leading-none"><b className="text-[14px] tracking-[-.055em]">ORANGEJUCE</b><span className="cpr-mono ml-2 hidden rounded border border-[#dbbfad] bg-[#fff1e8] px-1.5 py-0.5 text-[8px] tracking-[.13em] text-[#a54b2c] sm:inline">DSP LAB</span></div>
          <span className="hidden border-l border-[#cbd3c8] pl-3 text-[11px] text-[#74817b] md:block">Velvet Pitch / review</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => notify("Mara, Jules, and Rae are active in this review.")} className="hidden p-2 text-[#68756f] md:block" aria-label="Review help"><CircleHelp className="h-4 w-4" /></button>
          <div className="hidden -space-x-2 sm:flex">{collaborators.map((person) => <span key={person.initials} title={person.name} className="grid h-7 w-7 place-items-center rounded-full border-2 border-[#f7f7f0] text-[8px] font-bold text-[#f7f7f0]" style={{ background: person.tone }}>{person.initials}</span>)}</div>
          <button onClick={() => notify("Share link copied to your clipboard.")} className="cpr-mono flex items-center gap-2 rounded-lg border border-[#c9d1c5] bg-[#fbfcf7] px-3 py-2 text-[9px] tracking-[.1em] text-[#44534d]"><Copy className="h-3 w-3" /> SHARE</button>
          <button onClick={() => notify("Project options opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c9d1c5] bg-[#fbfcf7]" aria-label="Project options"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="cpr-grid mx-auto grid min-h-[calc(100dvh-64px)] max-w-[1550px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_356px]">
        <section className="min-w-0 border-b border-[#ccd4c8] p-5 md:p-7 xl:border-b-0 xl:border-r">
          <div className="mx-auto max-w-[890px]">
            <div className="cpr-enter flex flex-wrap items-start justify-between gap-5">
              <div><p className="cpr-mono text-[9px] tracking-[.16em] text-[#758077]">LIVE PLUGIN WORKBENCH</p><h1 className="cpr-serif mt-1 text-4xl leading-none tracking-[-.04em] text-[#293a34] md:text-5xl">Velvet Pitch <em className="text-[#dc704d]">/ v12</em></h1><p className="mt-3 max-w-md text-sm leading-6 text-[#64736b]">A focused listening pass before the new vocal character goes to build.</p></div>
              <button onClick={() => { setApproved(!approved); notify(!approved ? "Version 12 marked approved." : "Approval reopened for review."); }} className={`cpr-mono flex items-center gap-2 rounded-lg border px-3 py-2 text-[9px] tracking-[.1em] transition ${approved ? "border-[#7e9851] bg-[#dfebc9] text-[#3e5735]" : "border-[#c8d2c3] bg-[#fafbf6] text-[#52625a]"}`}>{approved ? <CircleCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{approved ? "APPROVED" : "APPROVE V12"}</button>
            </div>

            <div className="cpr-enter mt-8 rounded-2xl border border-[#becbbd] bg-[#f9faf4]/90 p-4 shadow-[0_12px_30px_rgba(59,75,62,.06)]" style={{ animationDelay: "90ms" }}>
              <div className="flex items-center justify-between gap-3 border-b border-[#d9dfd5] pb-3">
                <div className="flex items-center gap-2"><span className="cpr-mono rounded bg-[#e6eddb] px-2 py-1 text-[8px] tracking-[.13em] text-[#50624a]">AUDITION</span><span className="text-[11px] text-[#6f7d75]">Etta vocal / chorus line</span></div>
                <button onClick={() => setCompare(!compare)} className={`cpr-mono flex items-center gap-1.5 text-[9px] tracking-[.08em] ${compare ? "text-[#a84c31]" : "text-[#718078]"}`}><GitCompareArrows className="h-3.5 w-3.5" /> {compare ? "A/B ON" : "A/B OFF"}</button>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_185px]">
                <div className="relative overflow-hidden rounded-xl border border-[#40564f] bg-[#192925] p-4">
                  <div className="mb-3 flex items-center justify-between"><span className="cpr-mono text-[8px] tracking-[.15em] text-[#b9c9bf]">{compare ? "VERSION 11  ←  →  VERSION 12" : "VERSION 12 · REVIEW PASS"}</span><span className="cpr-mono text-[8px] text-[#e3eee1]">{playing ? "PLAYING · 0:11" : "22 SEC LOOP"}</span></div>
                  <div className="cpr-wave flex h-24 items-center gap-[3px]">{bars.map((height, index) => <span key={index} className={`${index > 29 && compare ? "bg-[#d8df97]" : "bg-[#df7954]"} w-[3px] flex-1 rounded-full`} style={{ height: `${height}%`, animationDelay: `${index * 26}ms`, animationPlayState: playing ? "running" : "paused" }} />)}</div>
                  <div className="absolute bottom-0 left-[52%] top-7 w-px bg-[#f5ede0]/80"><span className="cpr-mono absolute -top-4 -translate-x-1/2 text-[7px] text-[#e5d9c9]">0:11.8</span></div>
                </div>
                <div className="rounded-xl border border-[#d4ddd0] bg-[#eef2e7] p-3">
                  <p className="cpr-mono text-[8px] tracking-[.14em] text-[#758071]">CURRENT CHANGE</p>
                  <p className="mt-2 text-[12px] font-semibold text-[#3d5149]">Humanize window</p>
                  <p className="mt-1 text-[11px] leading-4 text-[#69796f]">35% → <b className="text-[#d86646]">42%</b><br />Less locked. More breath.</p>
                  <button onClick={() => setPlaying(!playing)} className={`mt-3 grid h-9 w-9 place-items-center rounded-full ${playing ? "bg-[#cbdc91]" : "bg-[#e57750]"} text-[#293631]`} aria-label="Play audio">{playing ? <Headphones className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button>
                </div>
              </div>
            </div>

            <div className="cpr-enter mt-6 grid gap-4 md:grid-cols-[1.1fr_.9fr]" style={{ animationDelay: "150ms" }}>
              <div className="rounded-xl border border-[#c6d0c4] bg-[#f5f7ef] p-4"><div className="flex items-center justify-between"><p className="cpr-mono text-[9px] tracking-[.13em] text-[#68776e]">BUILD NOTES</p><Sparkles className="h-4 w-4 text-[#dd7653]" /></div><p className="mt-4 text-[14px] leading-6 text-[#44564e]">The tuning engine now lets consonants land before correction catches up.</p><button onClick={() => notify("Build notes copied.")} className="cpr-mono mt-4 text-[8px] tracking-[.12em] text-[#a34d34]">COPY FOR RELEASE →</button></div>
              <div className="rounded-xl border border-[#c6d0c4] bg-[#f5f7ef] p-4"><p className="cpr-mono text-[9px] tracking-[.13em] text-[#68776e]">REVIEW STATUS</p><div className="mt-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#e9c8b8] text-[#9d472e]"><MessageSquareText className="h-4 w-4" /></div><div><b className="text-sm">2 notes to clear</b><p className="text-[11px] text-[#748178]">1 decision is already approved</p></div></div></div>
            </div>
          </div>
        </section>

        <aside className="bg-[#e6eadf] xl:min-h-[calc(100dvh-64px)]">
          <div className="border-b border-[#c6d0c2] bg-[#edf0e7] px-5 py-4">
            <div className="flex items-center justify-between"><div><p className="cpr-mono text-[9px] tracking-[.15em] text-[#68776e]">COLLABORATOR LANE</p><h2 className="mt-1 text-lg font-semibold tracking-[-.04em]">Listening notes <span className="text-[#dc704d]">03</span></h2></div><button onClick={() => notify("Review filters opened.")} className="rounded-md border border-[#c5cec0] p-1.5 text-[#637269]" aria-label="Filter notes"><ChevronDown className="h-4 w-4" /></button></div>
            <div className="mt-3 flex items-center gap-2"><span className="cpr-mono rounded-full bg-[#273d37] px-2 py-1 text-[8px] tracking-[.1em] text-[#f4f4ea]">V12</span><ChevronRight className="h-3 w-3 text-[#87938a]" /><button onClick={() => setCompare(!compare)} className="cpr-mono flex items-center gap-1 text-[9px] tracking-[.09em] text-[#9d4d32]"><GitCompareArrows className="h-3 w-3" /> COMPARE V11</button></div>
          </div>
          <div className="max-h-[490px] overflow-y-auto p-3 xl:max-h-[calc(100dvh-250px)]">
            {notes.map((note, index) => <button key={note.author} onClick={() => { setActiveNote(index); notify(`Cue moved to ${note.marker}.`); }} className={`cpr-enter mb-2 w-full rounded-xl border p-3 text-left transition ${activeNote === index ? "border-[#da8b70] bg-[#fff4e9] shadow-[0_6px_14px_rgba(105,75,50,.08)]" : "border-transparent bg-[#f4f6ef] hover:border-[#cbd5c7]"}`} style={{ animationDelay: `${index * 70 + 160}ms` }}>
              <div className="flex items-start gap-2.5"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[8px] font-bold text-[#f8f7ee]" style={{ background: note.tone }}>{note.initials}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold">{note.author}</span><span className="cpr-mono text-[8px] text-[#839087]">{note.time}</span></div><p className="mt-1 text-[11px] leading-4 text-[#52635a]">{note.text}</p><div className="mt-2 flex items-center justify-between"><span className="cpr-mono rounded bg-[#e4e9de] px-1.5 py-0.5 text-[8px] text-[#5e7066]"><Volume2 className="mr-1 inline h-2.5 w-2.5" />{note.marker}</span>{note.status === "approved" ? <span className="cpr-mono flex items-center gap-1 text-[8px] text-[#66804c]"><Check className="h-3 w-3" /> APPROVED</span> : note.status === "compare" ? <span className="cpr-mono text-[8px] text-[#9e5439]">A/B READY</span> : <span className="cpr-mono text-[8px] text-[#a66c3e]">OPEN</span>}</div></div></div>
            </button>)}
          </div>
          <div className="border-t border-[#c6d0c2] bg-[#edf0e7] p-3">
            <div className="flex gap-2 rounded-xl border border-[#c5cec1] bg-[#fafbf5] p-1.5"><input value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitReply(); }} placeholder="Add a listening note…" className="min-w-0 flex-1 bg-transparent px-2 text-[11px] outline-none placeholder:text-[#909b90]" /><button onClick={submitReply} className="grid h-7 w-7 place-items-center rounded-lg bg-[#e57750] text-[#273830]" aria-label="Send listening note"><Send className="h-3.5 w-3.5" /></button></div>
            <div className="mt-2 flex items-center justify-between px-1"><span className="cpr-mono flex items-center gap-1 text-[8px] text-[#79857b]"><Clock3 className="h-3 w-3" /> synced 2m ago</span><button onClick={() => notify("All review notes marked read.")} className="cpr-mono text-[8px] tracking-[.08em] text-[#68776e]">MARK READ</button></div>
          </div>
        </aside>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full bg-[#273d37] px-4 py-2.5 text-[11px] text-[#f6f5ec] shadow-lg">{toast}<button onClick={() => setToast("")} className="ml-3 text-[#c7d3c7]" aria-label="Dismiss notification"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}