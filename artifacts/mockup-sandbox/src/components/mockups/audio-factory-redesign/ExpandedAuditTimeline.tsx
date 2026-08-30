import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  FileAudio,
  GitCompareArrows,
  MessageSquareText,
  MoreHorizontal,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

type AuditKind = "approved" | "requested" | "submitted" | "edited";
type AuditEvent = {
  version: string;
  time: string;
  date: string;
  title: string;
  detail: string;
  person: string;
  initials: string;
  tone: string;
  kind: AuditKind;
  changes: string[];
};

const audit: AuditEvent[] = [
  { version: "V12", time: "14:32", date: "TODAY", title: "Arrangement approved", detail: "Sign-off recorded with no further notes.", person: "Jules Tan · Producer", initials: "JT", tone: "#66847b", kind: "approved", changes: ["Rise into chorus given more breath", "Automation pass retained"] },
  { version: "V12", time: "13:48", date: "TODAY", title: "Vocal treatment approved", detail: "Room sound retained; consonants stay clear.", person: "Rae Ellis · Vocal producer", initials: "RE", tone: "#c77a58", kind: "approved", changes: ["Room tone restored +1.5 dB", "De-esser threshold refined"] },
  { version: "V12", time: "12:17", date: "TODAY", title: "Mix balance changes requested", detail: "A note was anchored to the lift at 01:17.", person: "Mara Singh · Mix engineer", initials: "MS", tone: "#7477a3", kind: "requested", changes: ["Ease lift by a touch", "Inspect de-esser tail at 01:17"] },
  { version: "V12", time: "11:06", date: "TODAY", title: "Version 12 submitted", detail: "Review packet sent to four required reviewers.", person: "Owen James · Project lead", initials: "OJ", tone: "#30443c", kind: "submitted", changes: ["New vocal treatment", "Low-end cleanup", "Updated arrangement"] },
  { version: "V11", time: "YESTERDAY", date: "17:44", title: "Version 11 superseded", detail: "Replaced after a second vocal print was requested.", person: "Owen James · Project lead", initials: "OJ", tone: "#8b9282", kind: "edited", changes: ["Vocal print marked superseded", "Review set carried forward"] },
  { version: "V11", time: "YESTERDAY", date: "16:08", title: "Label A&R note added", detail: "“More room around the final phrase.”", person: "Ari Lemaire · Label A&R", initials: "AL", tone: "#aa9567", kind: "requested", changes: ["Final phrase ambience requested"] },
];

const kindMeta: Record<AuditKind, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  approved: { label: "APPROVED", icon: CheckCircle2, color: "#4c765e", bg: "#e5f0e4" },
  requested: { label: "CHANGES REQUESTED", icon: CircleAlert, color: "#a3543e", bg: "#faeae0" },
  submitted: { label: "SUBMITTED", icon: ArrowUpRight, color: "#536c67", bg: "#e5ece8" },
  edited: { label: "SUPERSEDED", icon: RotateCcw, color: "#88795a", bg: "#f4eedf" },
};

export function ExpandedAuditTimeline() {
  const [selected, setSelected] = useState(2);
  const [compare, setCompare] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "V12" | "V11">("ALL");
  const [toast, setToast] = useState("");
  const [playing, setPlaying] = useState(false);
  const visible = useMemo(() => filter === "ALL" ? audit : audit.filter((event) => event.version === filter), [filter]);
  const active = audit[selected];
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <div className="min-h-[100dvh] bg-[#e8ece2] font-['DM_Sans',sans-serif] text-[#263a33] selection:bg-[#d97351] selection:text-[#fff9ed]">
      <header className="flex h-16 items-center justify-between border-b border-[#c4cec2] bg-[#f7f7ef] px-4 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#dd6d4c] shadow-[inset_0_-3px_0_rgba(101,45,30,.18)]"><span className="h-3.5 w-3.5 rounded-full border-2 border-[#243630]" /></div>
          <b className="text-[14px] tracking-[-.06em]">ORANGEJUCE <span className="ml-1 rounded border border-[#dbc3b0] bg-[#fff0e5] px-1.5 py-0.5 font-mono text-[8px] tracking-[.13em] text-[#a14d33]">DSP LAB</span></b>
          <span className="hidden border-l border-[#cbd3c8] pl-3 text-[11px] text-[#708078] md:block">Velvet Pitch <ChevronRight className="mx-1 inline h-3 w-3" /> audit timeline</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => notify("Audit link copied to clipboard.")} className="hidden items-center gap-2 rounded-lg border border-[#c5cec0] bg-[#fbfcf6] px-3 py-2 font-mono text-[9px] tracking-[.1em] text-[#43564e] sm:flex"><Copy className="h-3 w-3" /> SHARE AUDIT</button>
          <button onClick={() => notify("Timeline options opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c5cec0] bg-[#fbfcf6]" aria-label="Timeline options"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-4 py-5 md:px-7 md:py-7">
        <section className="overflow-hidden rounded-[22px] border border-[#bac7b9] bg-[#f7f7ef] shadow-[0_18px_45px_rgba(48,68,60,.11)]">
          <div className="relative overflow-hidden border-b border-[#c8d0c5] px-5 pb-5 pt-6 md:px-8">
            <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#e8c3a2]/45 blur-3xl" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div><div className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[.15em] text-[#a35b43]"><ShieldCheck className="h-3.5 w-3.5" /> GOVERNANCE / COMPLETE HISTORY</div><h1 className="text-[31px] font-semibold leading-none tracking-[-.065em] md:text-[43px]">Audit timeline</h1><p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[#6d7b73]">Every decision behind <b className="font-semibold text-[#43554d]">Velvet Pitch — Humanize Window</b>, expanded from submission to sign-off. Compare what changed between each print.</p></div>
              <div className="flex flex-wrap gap-2"><button onClick={() => notify("Audit record is being prepared as a PDF.")} className="flex items-center gap-2 rounded-xl border border-[#bbc7ba] bg-[#fbfcf5] px-3.5 py-2.5 font-mono text-[9px] tracking-[.1em] text-[#40534b]"><Download className="h-3.5 w-3.5" /> EXPORT AUDIT</button><button onClick={() => notify("Reminder sent to the open reviewer.")} className="flex items-center gap-2 rounded-xl bg-[#2b4139] px-4 py-2.5 font-mono text-[9px] tracking-[.1em] text-[#f4f3e9] shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]"><BellRing className="h-3.5 w-3.5" /> NUDGE OPEN REVIEW</button></div>
            </div>
            <div className="relative mt-7 grid grid-cols-2 overflow-hidden rounded-xl border border-[#cdd5c9] bg-[#edf0e8] md:grid-cols-4">
              {[["EVENTS", "06", "in record"], ["VERSION", "12", "current print"], ["SIGNED", "02", "of 04 reviewers"], ["OPEN", "02", "need resolution"]].map(([label, value, helper], index) => <div key={label} className={`px-4 py-3 ${index > 0 ? "border-l border-[#cdd5c9]" : ""}`}><span className="block font-mono text-[8px] tracking-[.12em] text-[#718077]">{label}</span><strong className="mt-1 block text-[23px] leading-none tracking-[-.06em]">{value}</strong><span className="mt-1 block text-[10px] text-[#718077]">{helper}</span></div>)}
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="p-4 md:p-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold tracking-[-.03em]">Version history</h2><span className="rounded-full bg-[#dce5da] px-2 py-0.5 font-mono text-[8px] tracking-[.1em] text-[#62746a]">6 EVENTS</span></div><p className="mt-1 text-[11px] text-[#7b8981]">A chronological chain of custody for every review action.</p></div><div className="flex items-center gap-2 rounded-lg border border-[#c8d1c5] bg-[#edf0e9] p-1"><SlidersHorizontal className="ml-1.5 h-3.5 w-3.5 text-[#718078]" />{(["ALL", "V12", "V11"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-2.5 py-1 font-mono text-[8px] tracking-[.1em] transition ${filter === item ? "bg-[#fffdf5] text-[#344940] shadow-sm" : "text-[#7b8981]"}`}>{item}</button>)}</div></div>
              <div className="relative">
                <div className="absolute bottom-7 left-[19px] top-7 w-px bg-[#c5d1c5]" />
                <div className="space-y-3">{visible.map((event) => { const index = audit.indexOf(event); const meta = kindMeta[event.kind]; const Icon = meta.icon; const isSelected = index === selected; return <article key={`${event.version}-${event.time}-${event.title}`} className={`relative flex gap-3 rounded-xl border p-3 transition md:gap-4 md:p-4 ${isSelected ? "border-[#b4c8b7] bg-[#fbfcf6] shadow-[0_5px_16px_rgba(61,89,75,.07)]" : "border-[#d1d8ce] bg-[#f3f5ee]"}`}><button onClick={() => setSelected(index)} className="z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-[#f7f7ef] text-[8px] font-bold text-[#fffaf0] shadow-sm" style={{ background: event.tone }} aria-label={`Select ${event.title}`}>{event.initials}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[8px] tracking-[.1em] text-[#a05a42]">{event.version}</span><span className="text-[9px] text-[#849087]">{event.date} · {event.time}</span><span className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[7px] tracking-[.08em]" style={{ color: meta.color, background: meta.bg }}><Icon className="h-3 w-3" /> {meta.label}</span></div><h3 className="mt-2 text-[13px] font-semibold tracking-[-.02em]">{event.title}</h3><p className="mt-1 text-[11px] leading-relaxed text-[#718078]">{event.detail}</p><div className="mt-2 flex items-center gap-1.5 text-[9px] text-[#829087]"><UserRound className="h-3 w-3" /> {event.person}</div>{isSelected && <div className="mt-3 border-t border-[#dce3d9] pt-3"><div className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#a35b43]"><GitCompareArrows className="h-3.5 w-3.5" /> WHAT CHANGED IN THIS EVENT</div><div className="mt-2 flex flex-wrap gap-1.5">{event.changes.map((change) => <span key={change} className="rounded-md border border-[#d1ddd0] bg-[#f1f5ed] px-2 py-1 text-[9px] text-[#5f7168]">{change}</span>)}</div></div>}</div><ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[#849087] transition ${isSelected ? "rotate-180" : ""}`} /></article> })}</div>
              </div>
            </section>

            <aside className="border-t border-[#cbd4c8] bg-[#eef1e9] lg:border-l lg:border-t-0">
              <div className="border-b border-[#cbd4c8] p-5"><div className="flex items-center justify-between"><div><span className="font-mono text-[8px] tracking-[.13em] text-[#a05a42]">VERSION COMPARISON</span><h2 className="mt-1 text-[14px] font-semibold tracking-[-.035em]">V12 against V11</h2></div><GitCompareArrows className="h-5 w-5 text-[#c66d4c]" /></div><div className="mt-4 flex items-center gap-2"><button onClick={() => setPlaying(!playing)} className="grid h-8 w-8 place-items-center rounded-full bg-[#dd704d] text-[#273931]" aria-label="Play current version"><Play className={`ml-0.5 h-3.5 w-3.5 fill-current ${playing ? "hidden" : ""}`} /><span className={`h-2.5 w-2.5 rounded-sm bg-[#273931] ${playing ? "" : "hidden"}`} /></button><div className="min-w-0 flex-1"><div className="flex h-6 items-end gap-px overflow-hidden">{Array.from({ length: 42 }, (_, i) => <span key={i} className="w-1 rounded-full bg-[#8da69a]" style={{ height: `${5 + ((i * 17 + i * i) % 18)}px`, opacity: .42 + ((i % 4) * .12) }} />)}</div><div className="mt-1 flex justify-between font-mono text-[8px] text-[#87948b]"><span>V12 · 03:42</span><span>V11 · 03:39</span></div></div></div></div>
              <div className="p-5"><button onClick={() => setCompare(!compare)} className="flex w-full items-center justify-between text-left"><span className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="h-4 w-4 text-[#bb694c]" /> Print delta</span><span className={`h-5 w-9 rounded-full p-1 transition ${compare ? "bg-[#2b4139]" : "bg-[#c8d1c5]"}`}><span className={`block h-3 w-3 rounded-full bg-[#f8f7ed] transition ${compare ? "translate-x-4" : ""}`} /></span></button>{compare && <div className="mt-5 space-y-2.5">{[["Vocal room tone", "+1.5 dB", "up"], ["Low-end energy", "-0.8 dB", "down"], ["Arrangement markers", "3 added", "up"], ["Runtime", "03:42", "up"]].map(([label, value, direction]) => <div key={label} className="flex items-center justify-between rounded-lg border border-[#d0d9ce] bg-[#f8f9f2] px-3 py-2.5"><span className="text-[10px] text-[#687970]">{label}</span><span className="flex items-center gap-1.5 font-mono text-[9px] text-[#4d6f5b]">{direction === "up" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />} {value}</span></div>)}</div>}<div className="mt-6 rounded-xl border border-[#d0d8cb] bg-[#f8f9f2] p-3"><div className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#a05a42]"><MessageSquareText className="h-3.5 w-3.5" /> SELECTED EVENT</div><p className="mt-2 text-[11px] leading-relaxed text-[#52635a]">“{active.detail}”</p><button onClick={() => notify(`Opening ${active.version} at ${active.time}.`)} className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#d6bca9] bg-[#fff4ea] px-2.5 py-1.5 font-mono text-[8px] tracking-[.08em] text-[#9d513a]"><ArrowUpRight className="h-3 w-3" /> OPEN EVENT CONTEXT</button></div><div className="mt-6 border-t border-[#ccd4c9] pt-4"><button onClick={() => notify("V11 comparison draft restored.")} className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#6f8076]"><RotateCcw className="h-3.5 w-3.5" /> RESTORE V11 AS COMPARISON</button></div></div>
            </aside>
          </div>
          <footer className="flex flex-col gap-3 border-t border-[#cbd4c8] bg-[#e4e9df] px-5 py-3 md:flex-row md:items-center md:justify-between"><span className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#6f7e75]"><Check className="h-3.5 w-3.5 text-[#557a63]" /> IMMUTABLE RECORD ENABLED · ALL TIMES LOCAL</span><button onClick={() => notify("Handoff summary prepared for the project channel.")} className="flex items-center gap-1.5 font-mono text-[8px] tracking-[.1em] text-[#a2533b]"><FileAudio className="h-3.5 w-3.5" /> PREPARE HANDOFF SUMMARY</button></footer>
        </section>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full bg-[#2b4139] px-4 py-2.5 text-[11px] text-[#f7f7ed] shadow-lg">{toast}<button onClick={() => setToast("")} className="ml-3 text-[#c7d3c7]" aria-label="Dismiss notification"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}