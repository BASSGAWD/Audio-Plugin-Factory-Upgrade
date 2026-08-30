import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Headphones,
  Heart,
  MessageCircle,
  Mic2,
  Pause,
  Play,
  Radio,
  Send,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";

type Gate = "Mastering" | "Artwork" | "Metadata" | "Label";
type GateStatus = "READY" | "LISTENING" | "HOLD";

const initialGates: Record<Gate, GateStatus> = {
  Mastering: "READY",
  Artwork: "HOLD",
  Metadata: "LISTENING",
  Label: "READY",
};

const listeners = [
  { initials: "MT", name: "Mara", role: "mix", note: "The low end feels like home.", color: "#d9795c", time: "14:32" },
  { initials: "RE", name: "Rae", role: "vocal", note: "Stem archive is tucked away.", color: "#d7a04d", time: "14:18" },
  { initials: "JT", name: "Jules", role: "A&R", note: "Listening from Brooklyn.", color: "#7ca89b", time: "14:07" },
];

export function ReleaseHandoffListeningLounge() {
  const [playing, setPlaying] = useState(false);
  const [gates, setGates] = useState(initialGates);
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(86);
  const [hearted, setHearted] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setSeconds((value) => (value >= 222 ? 0 : value + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  const readyCount = useMemo(() => Object.values(gates).filter((gate) => gate !== "HOLD").length, [gates]);
  const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };
  const toggleGate = (gate: Gate) => {
    setGates((current) => ({ ...current, [gate]: current[gate] === "HOLD" ? "READY" : "HOLD" }));
  };

  return (
    <div
      className="min-h-[100dvh] overflow-hidden bg-[#f2e8d8] px-3 py-4 font-['DM_Sans',sans-serif] text-[#322a28] md:px-8 md:py-8"
      style={{ backgroundImage: "radial-gradient(circle at 8% 8%, rgba(217,160,77,.22), transparent 25%), radial-gradient(circle at 92% 94%, rgba(124,168,155,.22), transparent 27%)" }}
    >
      <main className="mx-auto max-w-[1450px] overflow-hidden rounded-[28px] border border-[#d7c4ac] bg-[#fbf5eb] shadow-[0_24px_70px_rgba(87,55,37,.18)]">
        <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#e1d1bd] bg-[#fffaf2] px-5 py-4 md:px-8">
          <div className="flex items-center gap-4">
            <div className="relative grid h-10 w-10 place-items-center rounded-full bg-[#d9795c] text-[#fff8ed] shadow-[0_5px_14px_rgba(217,121,92,.25)]">
              <Radio className="h-5 w-5" />
              <i className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#fffaf2] bg-[#d7a04d]" />
            </div>
            <div>
              <p className="font-mono text-[9px] font-bold tracking-[.21em] text-[#a7836b]">ORANGEJUCE · LISTENING LOUNGE</p>
              <h1 className="mt-1 text-[15px] font-semibold tracking-[-.035em]">Release handoff · a room for the final listen</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[#ddc9ad] bg-[#fff8ec] px-3 py-2 font-mono text-[9px] tracking-[.1em] text-[#8f7665] sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d9795c]" /> 12 LISTENING
            </div>
            <button onClick={() => announce("A warm hello was sent to everyone in the room.")} className="flex items-center gap-2 rounded-lg border border-[#d7b99b] bg-[#f4e4ce] px-3 py-2 font-mono text-[9px] font-bold tracking-[.1em] text-[#67483c] transition hover:bg-[#eed6b8]">
              <MessageCircle className="h-3.5 w-3.5 text-[#c16c53]" /> SAY HELLO
            </button>
          </div>
        </header>

        <section className="grid xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 border-b border-[#e1d1bd] xl:border-b-0 xl:border-r">
            <div className="relative overflow-hidden border-b border-[#e1d1bd] bg-[#f7ebda] px-6 py-8 md:px-10 md:py-11">
              <div className="absolute -right-8 -top-16 h-64 w-64 rounded-full border border-[#d7a04d]/40" />
              <div className="absolute right-5 top-5 font-mono text-[9px] tracking-[.18em] text-[#ae8d75]">ROOM 04 / PDT</div>
              <div className="relative max-w-3xl">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d9795c]/40 bg-[#d9795c]/10 px-3 py-1 font-mono text-[9px] font-bold tracking-[.15em] text-[#b75f4c]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d9795c]" /> LIVE · SOFT OPEN</div>
                <h2 className="max-w-2xl font-['Space_Mono',monospace] text-3xl font-bold leading-[1.06] tracking-[-.075em] text-[#44322d] md:text-5xl">Velvet Pitch<br /><span className="text-[#c16c53]">sounds like a room full of friends.</span></h2>
                <p className="mt-5 max-w-xl text-[13px] leading-relaxed text-[#80695b]">Take a seat, listen closely, and leave a little signal for the artist. We are making the last handoff feel like a first play.</p>
              </div>
            </div>

            <div className="p-5 md:p-8">
              <div className="flex items-end justify-between gap-4">
                <div><p className="font-mono text-[9px] font-bold tracking-[.18em] text-[#a7836b]">THE CENTERPIECE</p><h3 className="mt-1 text-[22px] font-semibold tracking-[-.05em] text-[#44322d]">Press play, stay awhile.</h3></div>
                <div className="font-mono text-[10px] text-[#b66a53]">{readyCount}/4 GATES OPEN</div>
              </div>

              <div className="mt-6 rounded-2xl border border-[#d9c5ae] bg-[#fffaf1] p-4 shadow-[0_8px_22px_rgba(100,65,40,.06)] md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] tracking-[.12em] text-[#5f4c42]"><Headphones className="h-4 w-4 text-[#d7a04d]" /> VELVET_PITCH_FINAL_V12.WAV</div>
                  <span className="font-mono text-[9px] text-[#a58a76]">24-BIT / 48 KHZ · 03:42</span>
                </div>
                <div className="mt-7 flex h-16 items-center gap-[3px]">{Array.from({ length: 72 }, (_, i) => <i key={i} className="w-full rounded-full bg-[#7ca89b]" style={{ height: `${9 + ((i * i * 11 + i * 7) % 48)}px`, opacity: i < Math.round((seconds / 222) * 72) ? 0.95 : 0.2 }} />)}</div>
                <div className="mt-5 flex items-center gap-4">
                  <button onClick={() => setPlaying((value) => !value)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#d9795c] text-[#fff8ed] transition hover:scale-105" aria-label="Toggle track playback">{playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</button>
                  <div className="min-w-0 flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-[#eadaca]"><div className="h-full bg-[#d7a04d] transition-[width] duration-500" style={{ width: `${(seconds / 222) * 100}%` }} /></div></div>
                  <span className="font-mono text-[10px] text-[#80695b]">{formatTime(seconds)}</span><Volume2 className="h-4 w-4 text-[#9b8170]" />
                  <button onClick={() => { setHearted((value) => !value); announce(hearted ? "Your note was tucked away." : "Your heart is in the room."); }} aria-label="Leave a heart" className="text-[#d9795c] transition hover:scale-110">{hearted ? <Heart className="h-4 w-4 fill-current" /> : <Heart className="h-4 w-4" />}</button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {(Object.keys(gates) as Gate[]).map((gate) => {
                  const status = gates[gate];
                  return <button key={gate} onClick={() => toggleGate(gate)} className="group flex items-center justify-between rounded-xl border border-[#dfccb6] bg-[#fffaf1] px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-[#c8916a]">
                    <span><span className="block font-mono text-[9px] tracking-[.15em] text-[#ae8d75]">ROOM CHECK-IN</span><span className="mt-1 block text-[13px] font-semibold text-[#513d35]">{gate}</span></span>
                    <span className={`flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[.1em] ${status === "HOLD" ? "text-[#c26650]" : status === "LISTENING" ? "text-[#aa7d36]" : "text-[#5c9589]"}`}>{status === "HOLD" ? <Circle className="h-3 w-3 fill-current" /> : status === "LISTENING" ? <Sparkles className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{status}</span>
                  </button>;
                })}
              </div>
            </div>
          </div>

          <aside className="bg-[#fffaf2] p-5 md:p-7">
            <div className="flex items-center justify-between"><div><p className="font-mono text-[9px] font-bold tracking-[.16em] text-[#a7836b]">THE SOFA</p><h3 className="mt-1 text-[19px] font-semibold tracking-[-.05em] text-[#44322d]">Notes from the room</h3></div><Mic2 className="h-5 w-5 text-[#d7a04d]" /></div>
            <div className="mt-6 border-y border-[#e5d5c1] py-2">
              {listeners.map((listener) => <div key={listener.time} className="flex gap-3 border-b border-[#eee2d2] py-4 last:border-0"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[9px] font-bold text-[#fff8ed]" style={{ backgroundColor: listener.color }}>{listener.initials}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="text-[11px] font-semibold text-[#5a443a]">{listener.name} <span className="font-normal text-[#ae8d75]">· {listener.role}</span></span><time className="font-mono text-[9px] text-[#ae8d75]">{listener.time}</time></div><p className="mt-1 text-[11px] leading-relaxed text-[#80695b]">{listener.note}</p></div></div>)}
            </div>
            <div className="mt-6 rounded-xl border border-[#e1ccb1] bg-[#f8ead7] p-4">
              <div className="flex items-center gap-2 font-mono text-[9px] font-bold tracking-[.15em] text-[#b66a53]"><Sparkles className="h-3.5 w-3.5" /> A LITTLE NOTE</div>
              <p className="mt-3 text-[12px] leading-relaxed text-[#72584b]">Artwork is the last soft edge. We are waiting on the 3000 × 3000 export, then this one can leave the room.</p>
              <button onClick={() => announce("A gentle reminder was sent to the artwork desk.")} className="mt-4 flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[.1em] text-[#9a6e43] hover:text-[#c16c53]">SEND A GENTLE NUDGE <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <button onClick={() => readyCount === 4 ? announce("The final handoff is on its way to Northbridge Records.") : announce("The room is holding the handoff for the last check.")} className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-mono text-[10px] font-bold tracking-[.13em] transition ${readyCount === 4 ? "bg-[#d7a04d] text-[#44322d] hover:bg-[#e0b365]" : "bg-[#eadaca] text-[#a58a76]"}`}><Send className="h-4 w-4" /> {readyCount === 4 ? "SEND THE HANDOFF" : "ROOM · STILL LISTENING"}</button>
            <div className="mt-5 flex items-center justify-between font-mono text-[9px] tracking-[.1em] text-[#ae8d75]"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> 17 JUN · 14:36 PDT</span><span>VP-12-LR</span></div>
          </aside>
        </section>
      </main>
      {notice && <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d7b99b] bg-[#fff8ec] px-4 py-2.5 text-[11px] font-medium text-[#60483d] shadow-2xl"><Check className="h-4 w-4 text-[#6c9c8f]" /> {notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button></div>}
    </div>
  );
}