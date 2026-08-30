import { useState, useEffect, useRef } from 'react';
import { ArrowDownRight, ArrowUpRight, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const INK = '#161513';
const PAPER = '#F1EEE7';
const RED = '#E03A12';
const MUTE = '#8C867A';

const movements = [
  {
    id: '01',
    name: 'Breath',
    subtitle: 'The diaphragmatic foundation',
    duration: '12 min',
    level: 'Foundational',
    ratio: '4 : 4 : 6',
    summary:
      'Every regulated nervous system begins below the ribs. We train the diaphragm the way a typesetter trains the eye — slowly, exactly, until precision becomes instinct.',
    steps: [
      'Sit on the front third of a firm chair. Feet flat, knees over ankles.',
      'Place one hand on the sternum, one below the navel. Only the lower hand should move.',
      'Inhale through the nose for a count of four. Feel the abdomen press outward.',
      'Exhale for a count of six. Let the exhale be longer than feels necessary.',
    ],
  },
  {
    id: '02',
    name: 'Posture',
    subtitle: 'The seated architecture',
    duration: '18 min',
    level: 'Foundational',
    ratio: '90° / 90° / 90°',
    summary:
      'A spine is a column, and a column carries load best when stacked. We measure the seat the way a joiner measures a mortise — no approximation, no slouch disguised as ease.',
    steps: [
      'Elevate the hips one to two inches above the knees with a folded blanket.',
      'Stack ear over shoulder, shoulder over hip. Verify against a wall once per week.',
      'Soften the jaw and the space between the eyebrows. Tension hides in small places.',
      'Hold for eighteen minutes. Adjust once, deliberately, at the nine-minute mark.',
    ],
  },
  {
    id: '03',
    name: 'Attention',
    subtitle: 'Single-point focus',
    duration: '20 min',
    level: 'Intermediate',
    ratio: '1 object · ∞ returns',
    summary:
      'Attention is not gripped — it is placed, lost, and placed again. The repetition is the craft. Ten thousand returns to the breath are ten thousand small acts of repair.',
    steps: [
      'Choose one anchor: the cool air at the nostril, or the rise of the abdomen.',
      'When the mind departs — and it will — note "thinking" once, without commentary.',
      'Return the attention to the anchor. The return is the practice, not the staying.',
      'End by widening the field: sounds, weight, temperature. Then open the eyes.',
    ],
  },
  {
    id: '04',
    name: 'Rest',
    subtitle: 'Deliberate non-doing',
    duration: '25 min',
    level: 'All levels',
    ratio: '0 effort · full weight',
    summary:
      'Rest is engineered, not stumbled into. Lying down with intention is structurally different from collapse. We teach the body to give its full weight to the floor — and mean it.',
    summaryShort: 'Rest is engineered, not stumbled into.',
    steps: [
      'Lie supine. Heels mat-width apart, palms up, eight inches from the hips.',
      'Scan from the crown to the soles in thirty-second segments. Name each region silently.',
      'At each region, exhale and imagine the floor rising to meet it.',
      'Remain for twenty-five minutes. Set a bell — do not negotiate with the clock.',
    ],
  },
];

const library = [
  { no: '001', title: 'Box breathing for acute anxiety', field: 'Breathwork', time: '08:00', format: 'Audio guide' },
  { no: '002', title: 'The 4-7-8 protocol, measured correctly', field: 'Breathwork', time: '11:30', format: 'Audio guide' },
  { no: '003', title: 'Sitting without a cushion: chair-based posture', field: 'Posture', time: '14:00', format: 'Video study' },
  { no: '004', title: 'Body scanning for chronic rumination', field: 'Attention', time: '22:00', format: 'Audio guide' },
  { no: '005', title: 'Walking meditation: 40 steps, one corridor', field: 'Movement', time: '17:30', format: 'Field notes' },
  { no: '006', title: 'Yoga nidra for clinical insomnia', field: 'Rest', time: '32:00', format: 'Audio guide' },
  { no: '007', title: 'Noting practice: a vocabulary for the mind', field: 'Attention', time: '19:00', format: 'Essay' },
  { no: '008', title: 'The exhale as a parasympathetic lever', field: 'Breathwork', time: '09:45', format: 'Essay' },
];

const breathPhases = [
  { name: 'Inhale', count: 4, instruction: 'Through the nose. Quietly.' },
  { name: 'Hold', count: 7, instruction: 'Without gripping the throat.' },
  { name: 'Exhale', count: 8, instruction: 'Through the mouth. Audibly.' },
];

function BreathEngine() {
  const [running, setRunning] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [second, setSecond] = useState(1);
  const [cycles, setCycles] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setSecond((s) => {
        const phase = breathPhases[phaseIdx];
        if (s >= phase.count) {
          setPhaseIdx((p) => {
            const next = (p + 1) % breathPhases.length;
            if (next === 0) setCycles((c) => c + 1);
            return next;
          });
          return 1;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [running, phaseIdx]);

  const phase = breathPhases[phaseIdx];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between border-b border-[#F1EEE7]/20 pb-6">
        <div>
          <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/50">
            Instrument 01
          </p>
          <h3 className="mt-2 text-2xl font-medium tracking-tight text-[#F1EEE7]">
            The 4–7–8 counter
          </h3>
        </div>
        <button
          onClick={() => {
            setRunning((r) => !r);
            if (!running) {
              setPhaseIdx(0);
              setSecond(1);
            }
          }}
          className="mono text-[11px] tracking-[0.2em] uppercase border border-[#F1EEE7]/40 px-5 py-3 text-[#F1EEE7] hover:bg-[#E03A12] hover:border-[#E03A12] transition-colors duration-200"
        >
          {running ? 'Stop' : 'Begin'}
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center py-10">
        <div className="grid grid-cols-3 mono text-[11px] tracking-[0.2em] uppercase">
          {breathPhases.map((p, i) => (
            <div
              key={p.name}
              className={`pb-3 border-b transition-colors duration-300 ${
                i === phaseIdx && running
                  ? 'border-[#E03A12] text-[#E03A12]'
                  : 'border-[#F1EEE7]/15 text-[#F1EEE7]/40'
              }`}
            >
              {p.name} — {p.count}
            </div>
          ))}
        </div>

        <div className="flex items-end justify-between mt-8">
          <div className="overflow-hidden">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={`${phaseIdx}-${second}-${running}`}
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -30, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="text-[clamp(7rem,16vw,13rem)] leading-[0.85] font-medium tracking-[-0.04em] text-[#F1EEE7] tabular-nums"
              >
                {running ? second : '—'}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="text-right pb-3">
            <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/50">
              {running ? phase.name : 'Standing by'}
            </p>
            <p className="mt-1 text-sm text-[#F1EEE7]/70 max-w-[180px]">
              {running ? phase.instruction : 'Four cycles, twice daily. Morning and before sleep.'}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-[#F1EEE7]/20 pt-4 flex justify-between mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/50">
        <span>Cycles completed — {String(cycles).padStart(2, '0')}</span>
        <span>Target — 04</span>
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState(0);
  const [openRow, setOpenRow] = useState(null);
  const m = movements[active];

  return (
    <div style={{ backgroundColor: PAPER, color: INK }} className="font-sans antialiased">
      <link
        href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            * { box-sizing: border-box; }
            body { margin: 0; }
            .font-sans { font-family: 'Inter Tight', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
            .mono { font-family: 'IBM Plex Mono', monospace; }
            ::selection { background: ${RED}; color: ${PAPER}; }
            .hairline { border-color: rgba(22,21,19,0.25); }
            .row-hover { transition: background-color .18s ease, color .18s ease; }
            .row-hover:hover { background-color: ${INK}; color: ${PAPER}; }
            .row-hover:hover .row-mute { color: rgba(241,238,231,0.55); }
            html { scroll-behavior: smooth; }
            ::-webkit-scrollbar { width: 10px; }
            ::-webkit-scrollbar-track { background: ${PAPER}; }
            ::-webkit-scrollbar-thumb { background: ${INK}; }
          `,
        }}
      />

      {/* ───────── HEADER ───────── */}
      <header className="border-b border-[#161513] grid grid-cols-2 md:grid-cols-12">
        <div className="col-span-1 md:col-span-3 px-5 py-4 border-r border-[#161513]">
          <span className="text-lg font-semibold tracking-tight">Stillwerk</span>
          <span className="text-lg font-semibold tracking-tight" style={{ color: RED }}>.</span>
        </div>
        <div className="hidden md:flex md:col-span-5 px-5 py-4 border-r border-[#161513] items-center gap-8 mono text-[11px] tracking-[0.18em] uppercase">
          <a href="#method" className="hover:text-[#E03A12] transition-colors">Method</a>
          <a href="#instrument" className="hover:text-[#E03A12] transition-colors">Instrument</a>
          <a href="#library" className="hover:text-[#E03A12] transition-colors">Library</a>
          <a href="#colophon" className="hover:text-[#E03A12] transition-colors">Colophon</a>
        </div>
        <div className="hidden md:block md:col-span-2 px-5 py-4 border-r border-[#161513] mono text-[11px] tracking-[0.18em] uppercase text-[#161513]/60 self-center">
          Zürich · 47.37° N
        </div>
        <div className="col-span-1 md:col-span-2 px-5 py-4 flex items-center justify-between mono text-[11px] tracking-[0.18em] uppercase">
          <span>Field Guide № 01</span>
          <ArrowDownRight size={14} strokeWidth={1.5} />
        </div>
      </header>

      {/* ───────── HERO — split, type only ───────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 min-h-[92vh] border-b border-[#161513]">
        {/* LEFT — ink */}
        <div style={{ backgroundColor: INK, color: PAPER }} className="flex flex-col justify-between p-6 md:p-10 lg:border-r border-[#161513]">
          <div className="flex justify-between mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/50">
            <span>Mental health, practiced by hand</span>
            <span>A / 01</span>
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="text-[clamp(3.2rem,7.5vw,7.5rem)] leading-[0.94] font-semibold tracking-[-0.035em] my-14"
          >
            The mind
            <br />
            settles when
            <br />
            the body is
            <br />
            <span style={{ color: RED }}>taught how.</span>
          </motion.h1>

          <div className="grid grid-cols-2 gap-6 border-t border-[#F1EEE7]/20 pt-6">
            <p className="text-sm leading-relaxed text-[#F1EEE7]/70 max-w-[36ch]">
              An educational studio for breath, posture, attention and rest — built with the
              patience of a workshop, not the pace of an app.
            </p>
            <div className="mono text-[11px] tracking-[0.18em] uppercase text-[#F1EEE7]/50 text-right self-end">
              Est. 2017 — 41,000 hours taught
            </div>
          </div>
        </div>

        {/* RIGHT — paper */}
        <div className="flex flex-col justify-between p-6 md:p-10 border-t lg:border-t-0 border-[#161513]">
          {/* index */}
          <div className="grid grid-cols-4 border-b border-[#161513]">
            {movements.map((mv, i) => (
              <a
                key={mv.id}
                href="#method"
                onClick={() => setActive(i)}
                className="group py-4 pr-3 border-r last:border-r-0 hairline"
              >
                <p className="mono text-[11px] tracking-[0.18em]" style={{ color: RED }}>
                  {mv.id}
                </p>
                <p className="mt-1 text-sm font-medium group-hover:translate-x-1 transition-transform duration-200">
                  {mv.name}
                </p>
              </a>
            ))}
          </div>

          <div className="my-10">
            <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#161513]/50 mb-5">
              Manifesto, abridged
            </p>
            <p className="text-[clamp(1.35rem,2.2vw,1.9rem)] leading-[1.3] font-medium tracking-[-0.01em] max-w-[34ch]">
              We do not promise calm. We teach the measurable mechanics that produce it — one
              breath ratio, one degree of posture, one returned attention at a time. Precision is
              the kindest thing we know.
            </p>
            <p className="mt-6 text-sm leading-relaxed text-[#161513]/65 max-w-[52ch]">
              Stillwerk is the contemplative wing of the Meridian Mental Health Collective.
              Every protocol below is reviewed by clinical psychologists and senior teachers,
              revised quarterly, and versioned like a tool that must not fail.
            </p>
          </div>

          <div className="grid grid-cols-2 border-t border-[#161513]">
            <a
              href="#method"
              className="group flex items-center justify-between py-5 pr-5 border-r hairline"
            >
              <span className="text-sm font-medium">Begin the practice</span>
              <ArrowDownRight size={18} strokeWidth={1.5} className="group-hover:translate-x-1 group-hover:translate-y-1 transition-transform" style={{ color: RED }} />
            </a>
            <a href="#library" className="group flex items-center justify-between py-5 pl-5">
              <span className="text-sm font-medium">Browse the library</span>
              <ArrowUpRight size={18} strokeWidth={1.5} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" style={{ color: RED }} />
            </a>
          </div>
        </div>
      </section>

      {/* ───────── TICKER STRIP ───────── */}
      <div className="border-b border-[#161513] py-3 px-6 md:px-10 flex flex-wrap gap-x-10 gap-y-2 mono text-[11px] tracking-[0.2em] uppercase text-[#161513]/60">
        <span>Inhale 4</span>
        <span style={{ color: RED }}>·</span>
        <span>Hold 7</span>
        <span style={{ color: RED }}>·</span>
        <span>Exhale 8</span>
        <span style={{ color: RED }}>·</span>
        <span>Repeat until the nervous system believes you</span>
      </div>

      {/* ───────── METHOD — interactive split ───────── */}
      <section id="method" className="border-b border-[#161513]">
        <div className="grid grid-cols-1 md:grid-cols-12 border-b border-[#161513]">
          <div className="md:col-span-3 px-6 md:px-10 py-6 md:border-r border-[#161513]">
            <p className="mono text-[11px] tracking-[0.2em] uppercase" style={{ color: RED }}>
              Section B
            </p>
          </div>
          <div className="md:col-span-9 px-6 md:px-10 py-6">
            <h2 className="text-[clamp(2rem,4vw,3.5rem)] font-semibold tracking-[-0.03em] leading-none">
              The method, in four movements
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* selector — paper */}
          <div className="lg:border-r border-[#161513]">
            {movements.map((mv, i) => (
              <button
                key={mv.id}
                onClick={() => setActive(i)}
                className={`w-full text-left flex items-baseline gap-6 px-6 md:px-10 py-7 border-b last:border-b-0 border-[#161513] transition-colors duration-200 ${
                  active === i ? 'bg-[#161513] text-[#F1EEE7]' : 'hover:bg-[#161513]/5'
                }`}
              >
                <span
                  className="mono text-sm tracking-[0.1em]"
                  style={{ color: active === i ? RED : 'rgba(22,21,19,0.45)' }}
                >
                  {mv.id}
                </span>
                <span className="text-[clamp(1.6rem,3vw,2.6rem)] font-semibold tracking-[-0.02em] leading-none">
                  {mv.name}
                </span>
                <span
                  className={`ml-auto mono text-[11px] tracking-[0.18em] uppercase ${
                    active === i ? 'text-[#F1EEE7]/50' : 'text-[#161513]/40'
                  }`}
                >
                  {mv.duration}
                </span>
              </button>
            ))}
            <div className="px-6 md:px-10 py-8 hidden lg:block">
              <p className="text-sm leading-relaxed text-[#161513]/60 max-w-[46ch]">
                Each movement is taught as a discrete skill, then assembled into a daily
                forty-minute sitting. Most students reach a stable practice in six weeks of
                honest repetition.
              </p>
            </div>
          </div>

          {/* detail — red panel */}
          <div style={{ backgroundColor: RED, color: PAPER }} className="border-t lg:border-t-0 border-[#161513]">
            <AnimatePresence mode="wait">
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="h-full flex flex-col p-6 md:p-10"
              >
                <div className="flex justify-between items-start border-b border-[#F1EEE7]/30 pb-6">
                  <div>
                    <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/70">
                      Movement {m.id}
                    </p>
                    <h3 className="mt-2 text-3xl md:text-4xl font-semibold tracking-[-0.02em]">
                      {m.subtitle}
                    </h3>
                  </div>
                  <span className="mono text-[11px] tracking-[0.18em] uppercase border border-[#F1EEE7]/50 px-3 py-2">
                    {m.level}
                  </span>
                </div>

                <p className="py-7 text-base md:text-lg leading-relaxed max-w-[52ch]">
                  {m.summary}
                </p>

                <div className="border-t border-[#F1EEE7]/30">
                  {m.steps.map((s, i) => (
                    <div key={i} className="grid grid-cols-[3rem_1fr] gap-4 py-4 border-b border-[#F1EEE7]/30">
                      <span className="mono text-[11px] tracking-[0.15em] pt-[3px]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <p className="text-sm md:text-[15px] leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-7 flex justify-between mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/80">
                  <span>Ratio — {m.ratio}</span>
                  <span>Duration — {m.duration}</span>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ───────── INSTRUMENT — breath counter split ───────── */}
      <section id="instrument" className="grid grid-cols-1 lg:grid-cols-2 border-b border-[#161513]">
        <div className="p-6 md:p-10 lg:border-r border-[#161513] flex flex-col">
          <p className="mono text-[11px] tracking-[0.2em] uppercase" style={{ color: RED }}>
            Section C
          </p>
          <h2 className="mt-6 text-[clamp(2rem,4vw,3.5rem)] font-semibold tracking-[-0.03em] leading-[1.02] max-w-[16ch]">
            A counter, not a chime. A tool, not an ambience.
          </h2>
          <p className="mt-8 text-sm leading-relaxed text-[#161513]/65 max-w-[52ch]">
            The 4–7–8 pattern lengthens the exhale relative to the inhale, which mechanically
            engages the parasympathetic nervous system. It is not mystical. It is plumbing —
            done well, with attention, twice a day.
          </p>
          <div className="mt-auto pt-10 grid grid-cols-3 border-t border-[#161513]">
            {[
              ['72%', 'Report lower acute anxiety after 14 days'],
              ['2×', 'Daily — morning and before sleep'],
              ['04', 'Cycles per sitting, never rushed'],
            ].map(([n, l], i) => (
              <div key={i} className={`py-5 ${i < 2 ? 'border-r hairline pr-4' : ''} ${i > 0 ? 'pl-4' : ''}`}>
                <p className="text-3xl md:text-4xl font-semibold tracking-[-0.03em]">{n}</p>
                <p className="mt-2 mono text-[10px] tracking-[0.14em] uppercase text-[#161513]/55 leading-relaxed">
                  {l}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: INK }} className="p-6 md:p-10 border-t lg:border-t-0 border-[#161513] min-h-[70vh]">
          <BreathEngine />
        </div>
      </section>

      {/* ───────── LIBRARY ───────── */}
      <section id="library" className="border-b border-[#161513]">
        <div className="grid grid-cols-1 md:grid-cols-12 border-b border-[#161513]">
          <div className="md:col-span-3 px-6 md:px-10 py-6 md:border-r border-[#161513]">
            <p className="mono text-[11px] tracking-[0.2em] uppercase" style={{ color: RED }}>
              Section D
            </p>
          </div>
          <div className="md:col-span-9 px-6 md:px-10 py-6 flex items-baseline justify-between">
            <h2 className="text-[clamp(2rem,4vw,3.5rem)] font-semibold tracking-[-0.03em] leading-none">
              The open library
            </h2>
            <span className="mono text-[11px] tracking-[0.18em] uppercase text-[#161513]/50 hidden md:block">
              08 of 142 entries
            </span>
          </div>
        </div>

        <div>
          {library.map((row, i) => (
            <div key={row.no} className="border-b last:border-b-0 border-[#161513]">
              <button
                onClick={() => setOpenRow(openRow === i ? null : i)}
                className="row-hover w-full grid grid-cols-12 items-baseline px-6 md:px-10 py-5 text-left"
              >
                <span className="col-span-2 md:col-span-1 mono text-[11px] tracking-[0.15em] row-mute text-[#161513]/45">
                  {row.no}
                </span>
                <span className="col-span-10 md:col-span-6 text-base md:text-xl font-medium tracking-[-0.01em] pr-4">
                  {row.title}
                </span>
                <span className="hidden md:block md:col-span-2 mono text-[11px] tracking-[0.15em] uppercase row-mute text-[#161513]/45">
                  {row.field}
                </span>
                <span className="hidden md:block md:col-span-2 mono text-[11px] tracking-[0.15em] uppercase row-mute text-[#161513]/45">
                  {row.format}
                </span>
                <span className="hidden md:flex md:col-span-1 items-center justify-end gap-3 mono text-[11px] tracking-[0.15em]">
                  {row.time}
                  {openRow === i ? <Minus size={14} strokeWidth={1.5} /> : <Plus size={14} strokeWidth={1.5} />}
                </span>
              </button>
              <AnimatePresence>
                {openRow === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 md:px-10 pb-6 pt-1 grid md:grid-cols-12 gap-4">
                      <p className="md:col-start-2 md:col-span-6 text-sm leading-relaxed text-[#161513]/65">
                        A guided, step-by-step protocol from the Stillwerk teaching staff.
                        Reviewed by the Meridian clinical board, version 3.2 — last revised
                        January 2025. Free, always, with a transcript and printable card.
                      </p>
                      <a
                        href="#"
                        className="md:col-span-3 md:col-start-9 self-start inline-flex items-center gap-2 mono text-[11px] tracking-[0.18em] uppercase border border-[#161513] px-4 py-3 hover:bg-[#E03A12] hover:border-[#E03A12] hover:text-[#F1EEE7] transition-colors"
                      >
                        Open the guide <ArrowUpRight size={13} strokeWidth={1.5} />
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── FOOTER ───────── */}
      <footer id="colophon" style={{ backgroundColor: INK, color: PAPER }}>
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="p-6 md:p-10 lg:border-r border-[#F1EEE7]/20">
            <h2 className="text-[clamp(2.4rem,5vw,4.5rem)] font-semibold tracking-[-0.035em] leading-[0.98]">
              Practice is a craft.
              <br />
              <span style={{ color: RED }}>Begin yours carefully.</span>
            </h2>
            <a
              href="#"
              className="mt-10 inline-flex items-center gap-3 mono text-[11px] tracking-[0.2em] uppercase border border-[#F1EEE7]/50 px-6 py-4 hover:bg-[#E03A12] hover:border-[#E03A12] transition-colors"
            >
              Reserve an introduction sitting <ArrowUpRight size={14} strokeWidth={1.5} />
            </a>
          </div>
          <div className="grid grid-cols-2 border-t lg:border-t-0 border-[#F1EEE7]/20">
            <div className="p-6 md:p-10 border-r border-[#F1EEE7]/20">
              <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/45 mb-5">Studio</p>
              {['Method', 'Instrument', 'Library', 'Teachers', 'Clinical board'].map((l) => (
                <a key={l} href="#" className="block py-1.5 text-sm text-[#F1EEE7]/80 hover:text-[#E03A12] transition-colors">
                  {l}
                </a>
              ))}
            </div>
            <div className="p-6 md:p-10">
              <p className="mono text-[11px] tracking-[0.2em] uppercase text-[#F1EEE7]/45 mb-5">Contact</p>
              <p className="text-sm text-[#F1EEE7]/80 leading-relaxed">
                Sihlquai 131
                <br />
                8005 Zürich
                <br />
                <span className="text-[#F1EEE7]/50">—</span>
                <br />
                hello@stillwerk.studio
                <br />
                +41 44 210 33 18
              </p>
            </div>
          </div>
        </div>
        <div className="border-t border-[#F1EEE7]/20 px-6 md:px-10 py-4 flex flex-wrap justify-between gap-3 mono text-[10px] tracking-[0.18em] uppercase text-[#F1EEE7]/40">
          <span>© 2025 Stillwerk Institut — Meridian Mental Health Collective</span>
          <span>Set in Inter Tight & IBM Plex Mono</span>
          <span>Field Guide № 01 / Rev. 3.2</span>
        </div>
      </footer>
    </div>
  );
}