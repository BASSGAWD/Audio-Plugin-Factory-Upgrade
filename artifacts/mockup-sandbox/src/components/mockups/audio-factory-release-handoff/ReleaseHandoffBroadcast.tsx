import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Headphones,
  MessageCircle,
  Mic2,
  Pause,
  Play,
  Radio,
  Send,
  Volume2,
  X,
} from "lucide-react";

type Department = "Mastering" | "Artwork" | "Metadata" | "Label";

const initialStatus: Record<Department, "LIVE" | "READY" | "HOLD"> = {
  Mastering: "READY",
  Artwork: "HOLD",
  Metadata: "READY",
  Label: "LIVE",
};

const crew = [
  { initials: "MT", name: "Mara · Mix", note: "Print confirmed at -9 LUFS.", tone: "#f06445", time: "14:32" },
  { initials: "RE", name: "Rae · Vocal", note: "Stem archive is synced.", tone: "#efb94c", time: "14:18" },
  { initials: "JT", name: "Jules · A&R", note: "Listening from Brooklyn.", tone: "#78b8ac", time: "14:07" },
  { initials: "OL", name: "Owen · Lead", note: "V12 is on-air for review.", tone: "#c88da7", time: "13:55" },
];

export function ReleaseHandoffBroadcast() {
  const [playing, setPlaying] = useState(false);
  const [statuses, setStatuses] = useState(initialStatus);
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(86);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setSeconds((value) => (value >= 222 ? 0 : value + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const clearCount = useMemo(() => Object.values(statuses).filter((status) => status !== "HOLD").length, [statuses]);
  const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };
  const resolve = (department: Department) => {
    setStatuses((current) => ({ ...current, [department]: current[department] === "HOLD" ? "READY" : "HOLD" }));
  };

  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#081112] px-3 py-4 font-['DM_Sans',sans-serif] text-[#eee7d7] md:px-8 md:py-8" style={{ backgroundImage: "radial-gradient(circle at 90% 4%, rgba(239,185,76,.13), transparent 25%), radial-gradient(circle at 10% 95%, rgba(73,143,134,.14), transparent 27%)" }}>
      <main className="mx-auto max-w-[1450px] overflow-hidden rounded-[28px] border border-[#344343] bg-[#101a1b] shadow-[0_28px_80px_rgba(0,0,0,.45)]">
        <header className="flex min-h-[75px] flex-wrap items-center justify-between gap-4 border-b border-[#334141] bg-[#121d1d] px-5 py-4 md:px-8">
          <div className="flex items-center gap-4">
            <div className="relative grid h-10 w-10 place-items-center rounded-full border border-[#e6af4b]/50 bg-[#e6af4b] text-[#152021]"><Radio className="h-5 w-5" /><i className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#121d1d] bg-[#f06445]" /></div>
            <div>
              <p className="font-mono text-[9px] font-bold tracking-[.21em] text-[#8ca6a0]">ORANGEJUCE BROADCAST CONTROL</p>
              <h1 className="mt-1 text-[15px] font-semibold tracking-[-.035em]">Release handoff · live crew channel</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#405351] px-3 py-2 font-mono text-[9px] tracking-[.1em] text-[#9eada4] sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f06445]" /> 12 LISTENING</div>
            <button onClick={() => announce("Crew ping sent to the release channel.")} className="flex items-center gap-2 rounded-lg border border-[#49615c] bg-[#1a2929] px-3 py-2 font-mono text-[9px] font-bold tracking-[.1em] text-[#e8e0c9] transition hover:bg-[#243737]"><BellRing className="h-3.5 w-3.5 text-[#efb94c]" /> PING CREW</button>
          </div>
        </header>

        <section className="grid xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 border-b border-[#334141] xl:border-b-0 xl:border-r">
            <div className="relative overflow-hidden border-b border-[#334141] bg-[#152323] px-6 py-8 md:px-10 md:py-11">
              <div className="absolute right-[-45px] top-[-72px] h-64 w-64 rounded-full border border-[#d69f3e]/30" />
              <div className="absolute right-4 top-5 font-mono text-[9px] tracking-[.18em] text-[#75928c]">CHANNEL 04 / PDT</div>
              <div className="relative max-w-3xl">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#e85e49]/40 bg-[#e85e49]/10 px-3 py-1 font-mono text-[9px] font-bold tracking-[.15em] text-[#ff917e]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f06445]" /> ON AIR · HANDOFF WINDOW</div>
                <h2 className="max-w-2xl font-['Space_Mono',monospace] text-3xl font-bold leading-[1.06] tracking-[-.075em] text-[#f2ead9] md:text-5xl">Velvet Pitch<br /><span className="text-[#efb94c]">is ready for its audience.</span></h2>
                <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-[#aebdb4]">A shared release desk for the people still listening closely. Resolve the last hold, then push the final print to Northbridge.</p>
              </div>
            </div>

            <div className="p-5 md:p-8">
              <div className="flex items-end justify-between gap-4">
                <div><p className="font-mono text-[9px] font-bold tracking-[.18em] text-[#819d96]">LIVE RELEASE FEED</p><h3 className="mt-1 text-[22px] font-semibold tracking-[-.05em]">The room is listening.</h3></div>
                <div className="font-mono text-[10px] text-[#e7b84e]">{clearCount}/4 GATES CLEAR</div>
              </div>

              <div className="mt-6 rounded-2xl border border-[#3a4c4a] bg-[#0b1415] p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] tracking-[.12em] text-[#c9d2c8]"><Headphones className="h-4 w-4 text-[#efb94c]" /> VELVET_PITCH_FINAL_V12.WAV</div>
                  <span className="font-mono text-[9px] text-[#78918c]">24-BIT / 48 KHZ · 03:42</span>
                </div>
                <div className="mt-7 flex h-16 items-center gap-[3px]">{Array.from({ length: 72 }, (_, i) => <i key={i} className="w-full rounded-full bg-[#78b8ac]" style={{ height: `${9 + ((i * i * 11 + i * 7) % 48)}px`, opacity: i < Math.round((seconds / 222) * 72) ? 0.95 : 0.2 }} />)}</div>
                <div className="mt-5 flex items-center gap-4">
                  <button onClick={() => setPlaying((value) => !value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#efb94c] text-[#152021] transition hover:scale-105" aria-label="Toggle track playback">{playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button>
                  <div className="min-w-0 flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-[#263837]"><div className="h-full bg-[#efb94c] transition-[width] duration-500" style={{ width: `${(seconds / 222) * 100}%` }} /></div></div>
                  <span className="font-mono text-[10px] text-[#afc0b7]">{formatTime(seconds)}</span>
                  <Volume2 className="h-4 w-4 text-[#88a59e]" />
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {(Object.keys(statuses) as Department[]).map((department) => {
                  const status = statuses[department];
                  return <button key={department} onClick={() => resolve(department)} className="group flex items-center justify-between rounded-xl border border-[#354846] bg-[#172323] px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#68847c]">
                    <span><span className="block font-mono text-[9px] tracking-[.15em] text-[#829c95]">RELEASE GATE</span><span className="mt-1 block text-[13px] font-semibold">{department}</span></span>
                    <span className={`flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[.1em] ${status === "HOLD" ? "text-[#ff8d78]" : "text-[#9bd2c7]"}`}>{status === "HOLD" ? <Circle className="h-3 w-3 fill-current" /> : <Check className="h-3.5 w-3.5" />}{status}</span>
                  </button>;
                })}
              </div>
            </div>
          </div>

          <aside className="bg-[#121d1d] p-5 md:p-7">
            <div className="flex items-center justify-between"><div><p className="font-mono text-[9px] font-bold tracking-[.16em] text-[#819d96]">REMOTE DESK</p><h3 className="mt-1 text-[19px] font-semibold tracking-[-.05em]">Signal from the crew</h3></div><MessageCircle className="h-5 w-5 text-[#efb94c]" /></div>
            <div className="mt-6 border-y border-[#324240] py-2">
              {crew.map((member) => <div key={member.time} className="flex gap-3 border-b border-[#283737] py-4 last:border-0"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[9px] font-bold text-[#152021]" style={{ backgroundColor: member.tone }}>{member.initials}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="text-[11px] font-semibold">{member.name}</span><time className="font-mono text-[9px] text-[#749089]">{member.time}</time></div><p className="mt-1 text-[11px] leading-relaxed text-[#9db1a9]">{member.note}</p></div></div>)}
            </div>
            <div className="mt-6 rounded-xl border border-[#40504b] bg-[#172323] p-4">
              <div className="flex items-center gap-2 font-mono text-[9px] font-bold tracking-[.15em] text-[#efb94c]"><Mic2 className="h-3.5 w-3.5" /> BROADCAST NOTE</div>
              <p className="mt-3 text-[12px] leading-relaxed text-[#b7c5bd]">Artwork still needs a final export at 3000 × 3000. Everything else is in the destination bundle.</p>
              <button onClick={() => announce("Artwork owner has been asked for a new export.")} className="mt-4 flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[.1em] text-[#a8d3c9] hover:text-[#efb94c]">REQUEST UPDATE <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <button onClick={() => clearCount === 4 ? announce("Final handoff sent to Northbridge Records.") : announce("Broadcast is holding for the final gate.")} className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-mono text-[10px] font-bold tracking-[.13em] transition ${clearCount === 4 ? "bg-[#efb94c] text-[#152021] hover:bg-[#f7c969]" : "bg-[#293938] text-[#849b94]"}`}><Send className="h-4 w-4" /> {clearCount === 4 ? "SEND FINAL HANDOFF" : "ON AIR · HOLDING"}</button>
            <div className="mt-5 flex items-center justify-between font-mono text-[9px] tracking-[.1em] text-[#718b85]"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> 17 JUN · 14:36 PDT</span><span>VP-12-RH</span></div>
          </aside>
        </section>
      </main>
      {notice && <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#536b65] bg-[#eae0c9] px-4 py-2.5 text-[11px] font-medium text-[#162121] shadow-2xl"><Check className="h-4 w-4 text-[#167565]" /> {notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button></div>}
    </div>
  );
}