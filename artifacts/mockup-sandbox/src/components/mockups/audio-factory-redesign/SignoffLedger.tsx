import { useMemo, useState } from "react";
import {
  BellRing,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileAudio,
  Filter,
  History,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Send,
  ShieldCheck,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

type Decision = "APPROVED" | "CHANGES REQUESTED" | "PENDING";

type Reviewer = {
  initials: string;
  name: string;
  role: string;
  tone: string;
  decision: Decision;
  timestamp: string;
  note: string;
  scope: string;
};

const reviewers: Reviewer[] = [
  { initials: "JT", name: "Jules Tan", role: "Producer", tone: "#66847b", decision: "APPROVED", timestamp: "Today · 14:32", note: "The rise into the second chorus finally has breath. No further notes.", scope: "Arrangement" },
  { initials: "RE", name: "Rae Ellis", role: "Vocal producer", tone: "#c77a58", decision: "APPROVED", timestamp: "Today · 13:48", note: "V12 keeps the room sound without smearing the consonants. Signed.", scope: "Vocal treatment" },
  { initials: "MS", name: "Mara Singh", role: "Mix engineer", tone: "#7477a3", decision: "CHANGES REQUESTED", timestamp: "Today · 12:17", note: "At 01:17, ease the lift by a touch. The de-esser is catching the tail.", scope: "Mix balance" },
  { initials: "AL", name: "Ari Lemaire", role: "Label A&R", tone: "#aa9567", decision: "PENDING", timestamp: "Due today · 18:00", note: "Awaiting listening pass.", scope: "Release approval" },
];

const decisions: { at: string; event: string; detail: string; initials: string; tone: string; kind: "ok" | "note" | "sent" }[] = [
  { at: "14:32", event: "Approved V12", detail: "Arrangement sign-off recorded", initials: "JT", tone: "#66847b", kind: "ok" },
  { at: "13:48", event: "Approved V12", detail: "Vocal treatment sign-off recorded", initials: "RE", tone: "#c77a58", kind: "ok" },
  { at: "12:17", event: "Changes requested", detail: "Mix balance · marker at 01:17", initials: "MS", tone: "#7477a3", kind: "note" },
  { at: "11:06", event: "Version 12 submitted", detail: "Sent to 4 required reviewers", initials: "OJ", tone: "#30443c", kind: "sent" },
];

const decisionStyle: Record<Decision, { chip: string; icon: typeof CircleCheck; label: string }> = {
  APPROVED: { chip: "border-[#b8d0c0] bg-[#e8f0e6] text-[#426a57]", icon: CircleCheck, label: "Approved" },
  "CHANGES REQUESTED": { chip: "border-[#dfbea8] bg-[#f9ece2] text-[#a3543e]", icon: CircleAlert, label: "Changes requested" },
  PENDING: { chip: "border-[#ddcfa9] bg-[#f8f3e4] text-[#94733c]", icon: Clock3, label: "Pending" },
};

export function SignoffLedger() {
  const [filter, setFilter] = useState<"ALL" | "OPEN">("ALL");
  const [expanded, setExpanded] = useState("MS");
  const [toast, setToast] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const visibleReviewers = useMemo(() => filter === "ALL" ? reviewers : reviewers.filter((reviewer) => reviewer.decision !== "APPROVED"), [filter]);
  const approvedCount = reviewers.filter((reviewer) => reviewer.decision === "APPROVED").length;
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  return (
    <div className="min-h-[100dvh] bg-[#e8ece2] font-['DM_Sans',sans-serif] text-[#263a33] selection:bg-[#d97351] selection:text-[#fff9ed]">
      <header className="flex h-16 items-center justify-between border-b border-[#c4cec2] bg-[#f7f7ef] px-4 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#dd6d4c] shadow-[inset_0_-3px_0_rgba(101,45,30,.18)]">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[#243630]" />
          </div>
          <div className="min-w-0 leading-none">
            <b className="text-[14px] tracking-[-.06em]">ORANGEJUCE</b>
            <span className="ml-2 hidden rounded border border-[#dbc3b0] bg-[#fff0e5] px-1.5 py-0.5 font-mono text-[8px] tracking-[.13em] text-[#a14d33] sm:inline">DSP LAB</span>
          </div>
          <span className="hidden border-l border-[#cbd3c8] pl-3 text-[11px] text-[#708078] md:block">Velvet Pitch <ChevronRight className="mx-1 inline h-3 w-3" /> review ledger</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => notify("Share link copied to clipboard.")} className="hidden items-center gap-2 rounded-lg border border-[#c5cec0] bg-[#fbfcf6] px-3 py-2 font-mono text-[9px] tracking-[.1em] text-[#43564e] sm:flex"><Copy className="h-3 w-3" /> SHARE</button>
          <button onClick={() => notify("Ledger options opened.")} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c5cec0] bg-[#fbfcf6]" aria-label="Ledger options"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-7 md:py-7">
        <section className="overflow-hidden rounded-[22px] border border-[#bac7b9] bg-[#f7f7ef] shadow-[0_18px_45px_rgba(48,68,60,.11)]">
          <div className="relative overflow-hidden border-b border-[#c8d0c5] px-5 pb-5 pt-6 md:px-8">
            <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#e8c3a2]/45 blur-3xl" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[.15em] text-[#a35b43]"><ShieldCheck className="h-3.5 w-3.5" /> REVIEW GOVERNANCE / V12</div>
                <h1 className="text-[31px] font-semibold leading-none tracking-[-.065em] text-[#263c34] md:text-[43px]">Sign-off ledger</h1>
                <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-[#6d7b73]">A complete decision record for <b className="font-semibold text-[#43554d]">Velvet Pitch — Humanize Window</b>. Every mark is time-stamped, scoped, and kept with the version.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => notify("Exporting decision record as PDF.")} className="flex items-center gap-2 rounded-xl border border-[#bbc7ba] bg-[#fbfcf5] px-3.5 py-2.5 font-mono text-[9px] tracking-[.1em] text-[#40534b]"><Download className="h-3.5 w-3.5" /> EXPORT RECORD</button>
                <button onClick={() => notify("Ari has been reminded to complete their listening pass.")} className="flex items-center gap-2 rounded-xl bg-[#2b4139] px-4 py-2.5 font-mono text-[9px] tracking-[.1em] text-[#f4f3e9] shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]"><BellRing className="h-3.5 w-3.5" /> NUDGE OPEN REVIEW</button>
              </div>
            </div>
            <div className="relative mt-7 grid grid-cols-2 overflow-hidden rounded-xl border border-[#cdd5c9] bg-[#edf0e8] md:grid-cols-4">
              {[
                ["REQUIRED", "04", "reviewers"],
                ["SIGNED", `0${approvedCount}`, "decisions recorded"],
                ["OPEN", "02", "need resolution"],
                ["VERSION", "12", "submitted today"],
              ].map(([label, value, helper], index) => <div key={label} className={`px-4 py-3 ${index > 0 ? "border-l border-[#cdd5c9]" : ""}`}><span className="block font-mono text-[8px] tracking-[.12em] text-[#718077]">{label}</span><strong className="mt-1 block text-[23px] leading-none tracking-[-.06em]">{value}</strong><span className="mt-1 block text-[10px] text-[#718077]">{helper}</span></div>)}
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="p-4 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-.03em]">Reviewer decisions</h2>
                  <span className="rounded-full bg-[#dce5da] px-2 py-0.5 font-mono text-[8px] tracking-[.1em] text-[#62746a]">VERSION 12</span>
                </div>
                <div className="flex rounded-lg border border-[#c8d1c5] bg-[#edf0e9] p-1">
                  <Filter className="ml-1.5 mr-1 h-3.5 w-3.5 self-center text-[#718078]" />
                  {(["ALL", "OPEN"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-md px-2.5 py-1 font-mono text-[8px] tracking-[.1em] transition ${filter === item ? "bg-[#fffdf5] text-[#344940] shadow-sm" : "text-[#7b8981]"}`}>{item}</button>)}
                </div>
              </div>
              <div className="space-y-2">
                {visibleReviewers.map((reviewer) => {
                  const status = decisionStyle[reviewer.decision];
                  const Icon = status.icon;
                  const isOpen = expanded === reviewer.initials;
                  return <article key={reviewer.initials} className={`overflow-hidden rounded-xl border transition ${isOpen ? "border-[#b6c8b9] bg-[#fbfcf6]" : "border-[#d1d8ce] bg-[#f3f5ee]"}`}>
                    <button onClick={() => setExpanded(isOpen ? "" : reviewer.initials)} className="flex w-full items-center gap-3 px-3 py-3 text-left md:px-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[#f5f6ef] text-[9px] font-bold text-[#fffaf0]" style={{ background: reviewer.tone }}>{reviewer.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2"><b className="text-[12px]">{reviewer.name}</b><span className="text-[10px] text-[#74827a]">{reviewer.role}</span></span>
                        <span className="mt-1 block font-mono text-[8px] tracking-[.09em] text-[#829087]">{reviewer.scope.toUpperCase()} · {reviewer.timestamp}</span>
                      </span>
                      <span className={`hidden items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[8px] tracking-[.07em] sm:flex ${status.chip}`}><Icon className="h-3 w-3" /> {status.label.toUpperCase()}</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-[#718077] transition ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && <div className="border-t border-[#d6ddd2] bg-[#f9faf4] px-4 py-3 md:pl-[68px]">
                      <div className="flex gap-2.5"><MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#bb694c]" /><p className="max-w-2xl text-[12px] leading-relaxed text-[#52635a]">“{reviewer.note}”</p></div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {reviewer.decision === "CHANGES REQUESTED" && <button onClick={() => notify("Opening the mix note at 01:17.")} className="flex items-center gap-1.5 rounded-lg border border-[#d6bca9] bg-[#fff4ea] px-2.5 py-1.5 font-mono text-[8px] tracking-[.08em] text-[#9d513a]"><Play className="h-3 w-3 fill-current" /> OPEN MARKER 01:17</button>}
                        {reviewer.decision === "PENDING" && <button onClick={() => notify("Reminder sent to Ari Lemaire.")} className="flex items-center gap-1.5 rounded-lg border border-[#d7caab] bg-[#fff9e9] px-2.5 py-1.5 font-mono text-[8px] tracking-[.08em] text-[#90713f]"><Send className="h-3 w-3" /> SEND REMINDER</button>}
                        {reviewer.decision === "APPROVED" && <button onClick={() => notify("The approval certificate has been copied.")} className="flex items-center gap-1.5 rounded-lg border border-[#c6d6c7] bg-[#f0f6ed] px-2.5 py-1.5 font-mono text-[8px] tracking-[.08em] text-[#4e705d]"><CheckCheck className="h-3 w-3" /> COPY CERTIFICATE</button>}
                      </div>
                    </div>}
                  </article>;
                })}
              </div>
            </section>

            <aside className="border-t border-[#cbd4c8] bg-[#eef1e9] lg:border-l lg:border-t-0">
              <div className="border-b border-[#cbd4c8] p-5">
                <div className="flex items-center justify-between"><div><span className="font-mono text-[8px] tracking-[.13em] text-[#a05a42]">CURRENT OBJECT</span><h2 className="mt-1 text-[14px] font-semibold tracking-[-.035em]">Velvet Pitch / V12</h2></div><FileAudio className="h-5 w-5 text-[#c66d4c]" /></div>
                <div className="mt-4 rounded-xl border border-[#cbd4c8] bg-[#f9faf4] p-3">
                  <div className="flex items-center gap-3"><button onClick={() => notify("Preview playback started.")} className="grid h-8 w-8 place-items-center rounded-full bg-[#dd704d] text-[#273931]"><Play className="ml-0.5 h-3.5 w-3.5 fill-current" /></button><div className="min-w-0 flex-1"><div className="flex h-5 items-end gap-px overflow-hidden">{Array.from({ length: 38 }, (_, index) => <span key={index} className="w-1 rounded-full bg-[#8da69a]" style={{ height: `${4 + ((index * 19 + index * index) % 16)}px`, opacity: 0.45 + ((index % 4) * 0.12) }} />)}</div><div className="mt-1 flex justify-between font-mono text-[8px] text-[#87948b]"><span>01:17.2</span><span>03:42.0</span></div></div></div>
                </div>
              </div>
              <div className="p-5">
                <button onClick={() => setShowHistory(!showHistory)} className="flex w-full items-center justify-between text-left"><span className="flex items-center gap-2 text-[13px] font-semibold"><History className="h-4 w-4 text-[#70857b]" /> Decision history</span><ChevronDown className={`h-4 w-4 text-[#708078] transition ${showHistory ? "rotate-180" : ""}`} /></button>
                {showHistory && <ol className="mt-5 space-y-4">{decisions.map((item, index) => <li key={`${item.at}-${item.event}`} className="relative flex gap-3">{index < decisions.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%+7px)] w-px bg-[#c9d3c8]" />}<span className="z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-[#eef1e9] text-[7px] font-bold text-[#fffaf0]" style={{ background: item.tone }}>{item.initials}</span><div className="min-w-0 pt-0.5"><div className="flex items-baseline gap-2"><b className="text-[11px]">{item.event}</b><span className="font-mono text-[8px] text-[#849087]">{item.at}</span></div><p className="mt-0.5 text-[10px] text-[#718078]">{item.detail}</p></div></li>)}</ol>}
                <div className="mt-6 border-t border-[#ccd4c9] pt-4"><button onClick={() => notify("Version 11 has been restored as a comparison draft.")} className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#6f8076]"><Undo2 className="h-3.5 w-3.5" /> RESTORE PRIOR DECISION SET</button></div>
              </div>
            </aside>
          </div>
          <footer className="flex flex-col gap-3 border-t border-[#cbd4c8] bg-[#e4e9df] px-5 py-3 md:flex-row md:items-center md:justify-between">
            <span className="flex items-center gap-2 font-mono text-[8px] tracking-[.08em] text-[#6f7e75]"><Check className="h-3.5 w-3.5 text-[#557a63]" /> IMMUTABLE RECORD ENABLED · ALL TIMES LOCAL</span>
            <button onClick={() => notify("A review summary has been prepared for the project channel.")} className="flex items-center gap-1.5 font-mono text-[8px] tracking-[.1em] text-[#a2533b]"><UserRound className="h-3.5 w-3.5" /> PREPARE HANDOFF SUMMARY</button>
          </footer>
        </section>
      </main>
      {toast && <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center rounded-full bg-[#2b4139] px-4 py-2.5 text-[11px] text-[#f7f7ed] shadow-lg">{toast}<button onClick={() => setToast("")} className="ml-3 text-[#c7d3c7]" aria-label="Dismiss notification"><X className="h-3 w-3" /></button></div>}
    </div>
  );
}