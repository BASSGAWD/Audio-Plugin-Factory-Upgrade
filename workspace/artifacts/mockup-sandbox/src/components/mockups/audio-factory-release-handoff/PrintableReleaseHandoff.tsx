import { useState } from "react";
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Copy,
  FileCheck2,
  FileText,
  Headphones,
  Music2,
  Printer,
  Send,
  ShieldCheck,
  Sparkles,
  Stamp,
  X,
} from "lucide-react";

const decisions = [
  { time: "11:06", title: "Version 12 submitted", owner: "Owen James · Project lead", note: "New vocal treatment, low-end cleanup, and updated arrangement delivered for final review.", type: "submitted" },
  { time: "12:17", title: "Mix balance adjustment raised", owner: "Mara Singh · Mix engineer", note: "Lift at 01:17 softened; de-esser tail inspected and resolved in the final print.", type: "resolved" },
  { time: "13:48", title: "Vocal treatment approved", owner: "Rae Ellis · Vocal producer", note: "Room tone retained at +1.5 dB. Consonant clarity approved for the release master.", type: "approved" },
  { time: "14:32", title: "Arrangement approved", owner: "Jules Tan · Producer", note: "Chorus rise retains additional breath. Automation pass accepted without further notes.", type: "approved" },
];

const handoff = [
  ["DELIVERY", "24-bit / 48 kHz WAV · stereo interleaved"],
  ["MASTER", "Velvet_Pitch_HumanizeWindow_V12_MASTER.wav"],
  ["RUNTIME", "03:42 · 174.8 MB"],
  ["DESTINATION", "Northbridge Records · release ops"],
];

export function PrintableReleaseHandoff() {
  const [toast, setToast] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({
    master: true,
    metadata: true,
    approval: true,
    assets: false,
  });

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const printReport = () => {
    notify("Print dialogue opened for the release handoff.");
    window.setTimeout(() => window.print(), 120);
  };

  const toggle = (item: string) => setChecked((current) => ({ ...current, [item]: !current[item] }));

  return (
    <div className="min-h-[100dvh] bg-[#d9ddd3] px-3 py-4 font-['DM_Sans',sans-serif] text-[#26362f] selection:bg-[#e47750] selection:text-[#fff8ed] md:px-8 md:py-8">
      <div className="mx-auto max-w-[1160px]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#da6d4d] shadow-[inset_0_-3px_0_rgba(92,44,30,.18)]"><span className="h-4 w-4 rounded-full border-2 border-[#293b33]" /></div>
            <div><div className="font-semibold text-[14px] tracking-[-.06em]">ORANGEJUCE <span className="ml-1 rounded border border-[#dcc3ae] bg-[#fbecdf] px-1.5 py-0.5 font-mono text-[8px] tracking-[.12em] text-[#a45438]">DSP LAB</span></div><div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#718078]">Velvet Pitch <ChevronRight className="h-3 w-3" /> release handoff</div></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => notify("Share link copied to your clipboard.")} className="flex items-center gap-2 rounded-lg border border-[#b8c4b7] bg-[#f5f6ef] px-3 py-2 font-mono text-[9px] tracking-[.1em] text-[#43564e]"><Copy className="h-3.5 w-3.5" /> COPY LINK</button>
            <button onClick={printReport} className="flex items-center gap-2 rounded-lg bg-[#2b4139] px-3.5 py-2 font-mono text-[9px] tracking-[.1em] text-[#fbf8ed] shadow-[inset_0_-2px_0_rgba(0,0,0,.18)]"><Printer className="h-3.5 w-3.5" /> PRINT REPORT</button>
          </div>
        </header>

        <main className="overflow-hidden border border-[#b7c1b4] bg-[#f8f5eb] shadow-[0_24px_60px_rgba(48,63,54,.18)] print:border-0 print:shadow-none">
          <section className="relative overflow-hidden border-b-[5px] border-[#de7350] px-6 pb-7 pt-7 md:px-10 md:pb-8 md:pt-9">
            <div className="absolute right-0 top-0 h-40 w-64 bg-[radial-gradient(circle_at_top_right,_#ead5b3_0,_transparent_70%)] opacity-80" />
            <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-start">
              <div>
                <div className="mb-4 flex items-center gap-2 font-mono text-[9px] tracking-[.16em] text-[#a4573d]"><FileCheck2 className="h-4 w-4" /> RELEASE HANDOFF / FINAL RECORD</div>
                <h1 className="max-w-xl text-[38px] font-semibold leading-[.92] tracking-[-.075em] text-[#283a32] md:text-[56px]">Velvet Pitch<br /><span className="text-[#d96648]">Humanize Window</span></h1>
                <p className="mt-4 max-w-lg text-[13px] leading-relaxed text-[#65736b]">A signed, release-ready account of the final print. Prepared for delivery, archive, and everyone who needs to know exactly what changed.</p>
              </div>
              <div className="min-w-[204px] border-l border-[#ccd2c4] pl-5 font-mono text-[9px] tracking-[.08em] text-[#6e7c73]">
                <div className="flex items-center gap-2 text-[#4b765d]"><CheckCircle2 className="h-4 w-4" /> RELEASE STATUS</div>
                <div className="mt-2 text-[23px] font-semibold tracking-[-.08em] text-[#31493e]">APPROVED</div>
                <div className="mt-3 border-t border-[#d8ddcf] pt-3 leading-5">REPORT ID · VP-12-RH<br />ISSUED · 17 JUN 2024, 14:40<br />LOCAL TIME · LOS ANGELES</div>
              </div>
            </div>
          </section>

          <section className="grid border-b border-[#c9d0c3] md:grid-cols-[1.35fr_.65fr]">
            <div className="border-b border-[#c9d0c3] px-6 py-6 md:border-b-0 md:border-r md:px-10">
              <div className="mb-4 flex items-center justify-between"><h2 className="font-mono text-[9px] tracking-[.15em] text-[#a4573d]">PRINT SPECIFICATION</h2><Music2 className="h-4 w-4 text-[#70897d]" /></div>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{handoff.map(([label, value]) => <div key={label}><div className="font-mono text-[8px] tracking-[.12em] text-[#819087]">{label}</div><div className="mt-1 text-[12px] font-medium leading-snug text-[#3c5147]">{value}</div></div>)}</div>
            </div>
            <div className="bg-[#e9eee4] px-6 py-6 md:px-7">
              <div className="flex items-center gap-2 font-mono text-[9px] tracking-[.15em] text-[#a4573d]"><Headphones className="h-4 w-4" /> FINAL PRINT</div>
              <div className="mt-4 flex h-11 items-center gap-1 overflow-hidden">{Array.from({ length: 52 }, (_, index) => <span key={index} className="w-1 rounded-full bg-[#648778]" style={{ height: `${8 + ((index * 29 + index * index) % 31)}px`, opacity: 0.45 + (index % 4) * 0.13 }} />)}</div>
              <div className="mt-3 flex justify-between font-mono text-[8px] tracking-[.08em] text-[#75847c]"><span>00:00</span><span>03:42</span></div>
            </div>
          </section>

          <section className="grid lg:grid-cols-[1.25fr_.75fr]">
            <div className="px-6 py-7 md:px-10">
              <div className="mb-6 flex items-end justify-between gap-4"><div><div className="font-mono text-[9px] tracking-[.15em] text-[#a4573d]">DECISION TRAIL</div><h2 className="mt-1 text-[20px] font-semibold tracking-[-.05em]">Final review, resolved.</h2></div><span className="rounded-full border border-[#bfcbbd] bg-[#edf2e8] px-2 py-1 font-mono text-[8px] tracking-[.1em] text-[#597364]">V12 · 4 EVENTS</span></div>
              <div className="relative space-y-0 before:absolute before:bottom-5 before:left-[7px] before:top-5 before:w-px before:bg-[#c6d1c3]">
                {decisions.map((decision, index) => {
                  const approved = decision.type === "approved";
                  return <article key={decision.title} className="relative grid gap-3 border-b border-[#dde2d7] py-4 last:border-b-0 sm:grid-cols-[42px_1fr_auto] sm:gap-4">
                    <div className={`z-10 grid h-[15px] w-[15px] place-items-center rounded-full ring-4 ring-[#f8f5eb] ${approved ? "bg-[#5f8870]" : decision.type === "resolved" ? "bg-[#d87854]" : "bg-[#738980]"}`}>{approved && <Check className="h-2.5 w-2.5 text-[#f9f6ec]" />}</div>
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-[13px] font-semibold tracking-[-.025em]">{decision.title}</h3>{decision.type === "resolved" && <span className="flex items-center gap-1 rounded bg-[#fae6dc] px-1.5 py-0.5 font-mono text-[7px] tracking-[.08em] text-[#a5523b]"><CircleAlert className="h-2.5 w-2.5" /> RESOLVED</span>}{approved && <span className="flex items-center gap-1 rounded bg-[#e3efe2] px-1.5 py-0.5 font-mono text-[7px] tracking-[.08em] text-[#4a7259]"><CheckCircle2 className="h-2.5 w-2.5" /> APPROVED</span>}</div><p className="mt-1 text-[11px] leading-relaxed text-[#6d7b73]">{decision.note}</p><p className="mt-2 font-mono text-[8px] tracking-[.04em] text-[#89958d]">{decision.owner}</p></div>
                    <time className="font-mono text-[9px] tracking-[.08em] text-[#7b8a81]">{index === 0 ? "17 JUN · " : ""}{decision.time}</time>
                  </article>;
                })}
              </div>
              <div className="mt-6 flex items-center gap-2 border-l-2 border-[#d97050] bg-[#f4eee3] px-3 py-2.5 text-[11px] leading-relaxed text-[#66756c]"><Sparkles className="h-4 w-4 shrink-0 text-[#c66c4e]" /> No open review notes remain. The V12 print is the sole release candidate.</div>
            </div>

            <aside className="border-t border-[#c9d0c3] bg-[#eff2e9] px-6 py-7 md:px-8 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between"><div><div className="font-mono text-[9px] tracking-[.15em] text-[#a4573d]">HANDOFF CONTROL</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-.05em]">Release checklist</h2></div><Clipboard className="h-5 w-5 text-[#71897e]" /></div>
              <div className="mt-5 space-y-2">{[
                ["master", "Master file attached", "V12 final WAV"],
                ["metadata", "Metadata verified", "ISRC, writers, artwork"],
                ["approval", "Approvals recorded", "Producer + vocal"],
                ["assets", "Ops package sent", "Ready when scheduled"],
              ].map(([id, label, detail]) => <button key={id} onClick={() => toggle(id)} className="flex w-full items-center gap-3 rounded-lg border border-[#cad4c7] bg-[#f9f9f2] p-3 text-left transition hover:-translate-y-px"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked[id] ? "border-[#5c8069] bg-[#638b72] text-[#f8f6ed]" : "border-[#aebcaf] bg-[#f7f7ef] text-transparent"}`}><Check className="h-3 w-3" /></span><span><span className="block text-[11px] font-semibold">{label}</span><span className="mt-0.5 block font-mono text-[8px] tracking-[.04em] text-[#809087]">{detail}</span></span></button>)}</div>
              <div className="mt-6 border-y border-[#ccd4c9] py-5"><div className="flex items-center gap-2 font-mono text-[9px] tracking-[.12em] text-[#577565]"><ShieldCheck className="h-4 w-4" /> SIGN-OFF RECORD</div><div className="mt-3 space-y-2 text-[11px] text-[#5f7168]"><div className="flex justify-between"><span>Jules Tan</span><span className="font-mono text-[8px]">14:32 · APPROVED</span></div><div className="flex justify-between"><span>Rae Ellis</span><span className="font-mono text-[8px]">13:48 · APPROVED</span></div></div></div>
              <button onClick={() => notify("Release package sent to Northbridge Records.")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d96f4d] px-4 py-3 font-mono text-[9px] tracking-[.1em] text-[#fff8ee] shadow-[inset_0_-2px_0_rgba(105,48,32,.22)]"><Send className="h-3.5 w-3.5" /> SEND HANDOFF PACKAGE</button>
            </aside>
          </section>

          <footer className="flex flex-col gap-3 border-t border-[#c9d0c3] bg-[#e0e6dc] px-6 py-4 text-[9px] text-[#66776d] md:flex-row md:items-center md:justify-between md:px-10">
            <div className="flex items-center gap-2 font-mono tracking-[.08em]"><Stamp className="h-4 w-4 text-[#597b66]" /> IMMUTABLE RELEASE RECORD · VP-12-RH</div>
            <div className="flex items-center gap-3"><button onClick={() => notify("Archive bundle queued for download.")} className="flex items-center gap-1.5 font-mono tracking-[.08em] text-[#526d60]"><ArrowDownToLine className="h-3.5 w-3.5" /> DOWNLOAD ARCHIVE</button><span className="hidden md:block">·</span><span className="font-mono tracking-[.06em]">ORANGEJUCE DSP LAB</span></div>
          </footer>
        </main>
      </div>
      {toast && <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center rounded-full bg-[#2b4139] px-4 py-2.5 text-[11px] text-[#f8f5eb] shadow-lg print:hidden">{toast}<button onClick={() => setToast("")} className="ml-3 text-[#c7d3c7]" aria-label="Dismiss notification"><X className="h-3.5 w-3.5" /></button></div>}
    </div>
  );
}