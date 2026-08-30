import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Crown, Utensils, Users, ChefHat, Check, Sparkles, Quote } from 'lucide-react';

const GRAY = '#C9C9C9';

/* ---------- Memphis SVG pattern helpers ---------- */
const Squiggle = ({ className = '', stroke = '#000', width = 6 }) => (
  <svg className={className} viewBox="0 0 200 40" fill="none" preserveAspectRatio="none">
    <path
      d="M0 20 Q 12.5 0, 25 20 T 50 20 T 75 20 T 100 20 T 125 20 T 150 20 T 175 20 T 200 20"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
    />
  </svg>
);

const Cross = ({ className = '', color = '#000' }) => (
  <svg className={className} viewBox="0 0 24 24">
    <rect x="9" y="0" width="6" height="24" fill={color} />
    <rect x="0" y="9" width="24" height="6" fill={color} />
  </svg>
);

const Triangle = ({ className = '', color = '#000' }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path d="M12 2 L23 22 H1 Z" fill={color} />
  </svg>
);

const HalfCircle = ({ className = '', color = '#000' }) => (
  <svg className={className} viewBox="0 0 24 12">
    <path d="M0 12 A12 12 0 0 1 24 12 Z" fill={color} />
  </svg>
);

export default function App() {
  const [frequency, setFrequency] = useState('monthly');
  const [amount, setAmount] = useState(60);
  const [custom, setCustom] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const tiers = [
    { value: 25, label: '$25', impact: '7 chef-grade meals' },
    { value: 60, label: '$60', impact: '1 family · full week' },
    { value: 120, label: '$120', impact: '2 families · full week' },
    { value: 250, label: '$250', impact: 'A month at the table' },
  ];

  const activeAmount = custom ? Number(custom) : amount;
  const mealsCount = Math.max(1, Math.round((activeAmount / 25) * 7));

  return (
    <div className="min-h-screen bg-white text-black overflow-x-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .display { font-family: 'Archivo Black', sans-serif; letter-spacing: -0.02em; }
            .hard { border: 3px solid #000; }
            .shadow-hard { box-shadow: 8px 8px 0 #000; }
            .shadow-hard-sm { box-shadow: 5px 5px 0 #000; }
            .shadow-hard-gray { box-shadow: 8px 8px 0 ${GRAY}; }
            .dots { background-image: radial-gradient(#000 2.4px, transparent 2.4px); background-size: 22px 22px; }
            .dots-white { background-image: radial-gradient(#fff 2.4px, transparent 2.4px); background-size: 22px 22px; }
            .dots-gray { background-image: radial-gradient(${GRAY} 2.6px, transparent 2.6px); background-size: 20px 20px; }
            .zigzag {
              background:
                linear-gradient(135deg, #000 25%, transparent 25%) -12px 0,
                linear-gradient(225deg, #000 25%, transparent 25%) -12px 0,
                linear-gradient(315deg, #000 25%, transparent 25%),
                linear-gradient(45deg, #000 25%, transparent 25%);
              background-size: 24px 24px;
              background-color: #fff;
            }
            .stripes { background: repeating-linear-gradient(45deg, #000 0 10px, #fff 10px 20px); }
            .stripes-gray { background: repeating-linear-gradient(-45deg, ${GRAY} 0 12px, #fff 12px 24px); }
            .ticker { animation: ticker 22s linear infinite; }
            @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
            .wobble:hover { transform: rotate(-1.2deg) translateY(-3px); }
            .card-t { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; }
            input::placeholder { color: #777; }
            ::selection { background: #000; color: #fff; }
            .grain {
              background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
            }
          `,
        }}
      />

      {/* ============ TOP BAR ============ */}
      <header className="hard border-t-0 border-x-0 bg-white sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-5 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="hard bg-black w-10 h-10 flex items-center justify-center shadow-hard-sm" style={{ boxShadow: `4px 4px 0 ${GRAY}` }}>
              <Crown className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="display text-lg md:text-xl tracking-tight">THE STANDING TABLE</span>
            <span className="hidden md:inline-block text-[11px] font-bold uppercase tracking-[0.25em] border-2 border-black px-2 py-1">
              Est. 1987 · 501(c)(3)
            </span>
          </div>
          <a
            href="#pledge"
            className="display hard bg-black text-white px-4 md:px-6 py-2.5 text-sm md:text-base hover:bg-white hover:text-black transition-colors shadow-hard-sm"
          >
            PLEDGE NOW
          </a>
        </div>
      </header>

      {/* ============ TICKER ============ */}
      <div className="bg-black text-white overflow-hidden border-b-[3px] border-black">
        <div className="ticker whitespace-nowrap py-2 flex">
          {[0, 1].map((i) => (
            <span key={i} className="display text-sm tracking-[0.2em] uppercase">
              {Array(6)
                .fill('2,481,906 meals delivered ◆ every household commands its table ◆ ')
                .join('')}
            </span>
          ))}
        </div>
      </div>

      {/* ============ BENTO GRID ============ */}
      <main className="max-w-[1400px] mx-auto px-5 md:px-8 py-10 md:py-14">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-7 auto-rows-[minmax(120px,auto)]">

          {/* ---- HERO ---- */}
          <motion.section
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="md:col-span-8 md:row-span-2 hard bg-white shadow-hard relative overflow-hidden p-7 md:p-12 grain"
          >
            {/* decorative shapes */}
            <div className="absolute top-6 right-8 w-24 h-24 rounded-full hard dots-gray hidden md:block" />
            <Cross className="absolute bottom-10 right-44 w-8 h-8 rotate-12 hidden md:block" color={GRAY} />
            <Triangle className="absolute top-10 right-44 w-10 h-10 -rotate-12 hidden lg:block" />
            <Squiggle className="absolute -bottom-1 left-0 w-full h-10" stroke={GRAY} width={7} />

            <p className="text-xs md:text-sm font-bold uppercase tracking-[0.35em] mb-5 flex items-center gap-3">
              <span className="inline-block w-8 h-[3px] bg-black" />
              The Sovereign Supper Fund
            </p>

            <h1 className="display text-[2.6rem] leading-[0.95] md:text-[5rem] md:leading-[0.92] max-w-[14ch]">
              EVERY FAMILY
              <br />
              DESERVES TO
              <br />
              <span className="relative inline-block">
                <span className="absolute -inset-x-2 inset-y-1 bg-black -rotate-1" aria-hidden />
                <span className="relative text-white px-2">RULE DINNER.</span>
              </span>
            </h1>

            <p className="mt-7 max-w-xl text-base md:text-lg font-medium leading-relaxed">
              The Standing Table delivers chef-composed meal kits — premium ingredients, exacting recipes,
              zero compromise — to households shut out of the grocery aisle. Your pledge sets the standard.
              We hold the line.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href="#pledge"
                className="display hard bg-black text-white px-7 py-4 text-base md:text-lg shadow-hard-gray inline-flex items-center gap-3 card-t wobble"
              >
                CLAIM YOUR SEAT <ArrowRight className="w-5 h-5" strokeWidth={3} />
              </a>
              <span className="text-sm font-bold uppercase tracking-widest border-b-[3px] border-black pb-1">
                94¢ of every dollar reaches the plate
              </span>
            </div>
          </motion.section>

          {/* ---- PATTERN / PHOTO CARD ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="md:col-span-4 md:row-span-2 hard shadow-hard relative overflow-hidden bg-black"
          >
            <img
              src="https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=900&h=1200&fit=crop"
              alt="Hands preparing a meal kit"
              className="absolute inset-0 w-full h-full object-cover grayscale contrast-125"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
            <div className="absolute top-0 left-0 right-0 h-10 stripes border-b-[3px] border-black" />
            <div className="absolute bottom-0 inset-x-0 p-6">
              <div className="hard bg-white p-4 shadow-hard-sm rotate-[-1.5deg]">
                <p className="display text-2xl">KIT Nº 412</p>
                <p className="text-sm font-semibold mt-1">
                  Charred citrus chicken, saffron rice, winter greens. Composed by chef Ada Moreno.
                  Delivered Thursday, eaten with authority.
                </p>
              </div>
            </div>
          </motion.div>

          {/* ---- STAT 1 ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="md:col-span-3 hard bg-black text-white shadow-hard p-6 relative overflow-hidden card-t wobble"
          >
            <div className="absolute -right-6 -top-6 w-28 h-28 dots-white opacity-40 rounded-full" />
            <Utensils className="w-7 h-7 mb-4" strokeWidth={2.5} />
            <p className="display text-4xl md:text-5xl">2.4M</p>
            <p className="mt-2 text-sm font-bold uppercase tracking-widest" style={{ color: GRAY }}>
              meals delivered since 1987
            </p>
          </motion.div>

          {/* ---- STAT 2 ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="md:col-span-3 hard bg-white shadow-hard p-6 relative overflow-hidden card-t wobble"
          >
            <Squiggle className="absolute top-3 right-4 w-20 h-5" stroke={GRAY} width={8} />
            <Users className="w-7 h-7 mb-4" strokeWidth={2.5} />
            <p className="display text-4xl md:text-5xl">38,200</p>
            <p className="mt-2 text-sm font-bold uppercase tracking-widest text-black/70">
              households fed weekly across 14 cities
            </p>
          </motion.div>

          {/* ---- STAT 3 ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="md:col-span-3 hard p-6 shadow-hard relative overflow-hidden card-t wobble"
            style={{ background: GRAY }}
          >
            <Triangle className="absolute -bottom-3 -right-2 w-20 h-20 rotate-12 opacity-30" />
            <ChefHat className="w-7 h-7 mb-4" strokeWidth={2.5} />
            <p className="display text-4xl md:text-5xl">112</p>
            <p className="mt-2 text-sm font-bold uppercase tracking-widest text-black/70">
              partner chefs composing every kit
            </p>
          </motion.div>

          {/* ---- DECOR TILE ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="md:col-span-3 hard shadow-hard relative overflow-hidden zigzag hidden md:flex items-center justify-center"
          >
            <div className="hard bg-white px-5 py-3 rotate-[-3deg] shadow-hard-sm">
              <p className="display text-xl whitespace-nowrap">NO. EMPTY. PLATES.</p>
            </div>
          </motion.div>

          {/* ---- PLEDGE / DONATION CARD ---- */}
          <motion.section
            id="pledge"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28 }}
            className="md:col-span-7 md:row-span-2 hard bg-white shadow-hard p-7 md:p-10 relative overflow-hidden grain"
          >
            <HalfCircle className="absolute top-0 right-12 w-20 h-10 rotate-180" color={GRAY} />
            <Cross className="absolute bottom-8 right-8 w-7 h-7 rotate-12 opacity-25" />

            <div className="flex items-center justify-between flex-wrap gap-4">
              <h2 className="display text-3xl md:text-4xl">SET YOUR PLEDGE</h2>
              {/* frequency toggle */}
              <div className="hard inline-flex bg-white shadow-hard-sm">
                {['monthly', 'once'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFrequency(f)}
                    className={`display px-5 py-2.5 text-sm transition-colors ${
                      frequency === f ? 'bg-black text-white' : 'bg-white text-black hover:bg-neutral-100'
                    } ${f === 'monthly' ? 'border-r-[3px] border-black' : ''}`}
                  >
                    {f === 'monthly' ? 'MONTHLY' : 'ONE-TIME'}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-3 text-sm font-semibold uppercase tracking-[0.2em] text-black/60">
              {frequency === 'monthly' ? 'A standing order. The strongest kind.' : 'A single decisive act.'}
            </p>

            {/* tiers */}
            <div className="mt-7 grid grid-cols-2 lg:grid-cols-4 gap-4">
              {tiers.map((t) => {
                const active = !custom && amount === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => {
                      setAmount(t.value);
                      setCustom('');
                    }}
                    className={`hard p-4 text-left card-t relative ${
                      active ? 'bg-black text-white shadow-hard-gray -translate-y-1' : 'bg-white shadow-hard-sm hover:-translate-y-1'
                    }`}
                  >
                    {active && (
                      <span className="absolute -top-3 -right-3 hard bg-white w-8 h-8 flex items-center justify-center">
                        <Check className="w-4 h-4 text-black" strokeWidth={4} />
                      </span>
                    )}
                    <p className="display text-2xl md:text-3xl">{t.label}</p>
                    <p className={`mt-1 text-xs font-bold uppercase tracking-wider ${active ? 'text-white/70' : 'text-black/60'}`}>
                      {t.impact}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* custom + impact line */}
            <div className="mt-6 grid md:grid-cols-2 gap-4 items-stretch">
              <div className="hard flex items-center shadow-hard-sm bg-white">
                <span className="display text-2xl px-4 border-r-[3px] border-black bg-black text-white self-stretch flex items-center">
                  $
                </span>
                <input
                  type="number"
                  min="1"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Name your own number"
                  className="w-full px-4 py-3 font-bold text-lg outline-none"
                />
              </div>
              <div className="hard p-3 px-4 flex items-center gap-3 stripes-gray">
                <div className="hard bg-white px-3 py-2 shadow-hard-sm">
                  <Sparkles className="w-5 h-5" strokeWidth={2.5} />
                </div>
                <p className="text-sm font-bold leading-snug bg-white hard px-3 py-1.5">
                  ${activeAmount || 0}
                  {frequency === 'monthly' ? '/mo' : ''} commands roughly{' '}
                  <span className="display">{isFinite(mealsCount) ? mealsCount : 0} meals</span> at the table.
                </p>
              </div>
            </div>

            {/* email + CTA */}
            {!submitted ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email) setSubmitted(true);
                }}
                className="mt-7 flex flex-col sm:flex-row gap-4"
              >
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com — we send orders, not noise"
                  className="hard flex-1 px-5 py-4 font-semibold text-base outline-none shadow-hard-sm focus:shadow-hard transition-shadow"
                />
                <button
                  type="submit"
                  className="display hard bg-black text-white px-8 py-4 text-lg shadow-hard-gray card-t wobble inline-flex items-center justify-center gap-3"
                >
                  PLEDGE ${activeAmount || 0}
                  {frequency === 'monthly' ? '/MO' : ''}
                  <ArrowRight className="w-5 h-5" strokeWidth={3} />
                </button>
              </form>
            ) : (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mt-7 hard bg-black text-white p-6 shadow-hard-gray flex items-center gap-4"
              >
                <div className="hard bg-white w-12 h-12 flex items-center justify-center shrink-0">
                  <Check className="w-6 h-6 text-black" strokeWidth={4} />
                </div>
                <p className="font-bold text-base md:text-lg">
                  Order received. Your pledge brief is en route to <span className="underline">{email}</span>.
                  Welcome to the standing table.
                </p>
              </motion.div>
            )}

            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-black/50">
              Tax-deductible · EIN 87-2204913 · Cancel any month, no questions asked
            </p>
          </motion.section>

          {/* ---- QUOTE CARD ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="md:col-span-5 hard bg-black text-white shadow-hard p-7 md:p-8 relative overflow-hidden"
          >
            <div className="absolute inset-x-0 top-0 h-3 stripes" />
            <Quote className="w-9 h-9 mb-4" fill="white" strokeWidth={0} />
            <p className="display text-xl md:text-2xl leading-snug">
              "MY KIDS THINK I HIRED A CHEF. I DIDN'T CORRECT THEM."
            </p>
            <p className="mt-4 text-sm font-bold uppercase tracking-[0.25em]" style={{ color: GRAY }}>
              Denise Okafor · Recipient household, Detroit · 14 months at the table
            </p>
            <Squiggle className="absolute bottom-3 right-6 w-28 h-6" stroke={GRAY} width={7} />
          </motion.div>

          {/* ---- HOW IT WORKS STRIP ---- */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.36 }}
            className="md:col-span-5 hard shadow-hard p-7 relative overflow-hidden"
            style={{ background: GRAY }}
          >
            <h3 className="display text-2xl mb-5">THE CHAIN OF COMMAND</h3>
            <ol className="space-y-4">
              {[
                ['01', 'You pledge. Monthly preferred — rulers think in eras, not evenings.'],
                ['02', 'Our chefs compose kits with the same suppliers as the city’s best kitchens.'],
                ['03', 'Families cook, plate, and own their dinner table. Every single week.'],
              ].map(([n, t]) => (
                <li key={n} className="flex gap-4 items-start">
                  <span className="display hard bg-black text-white w-10 h-10 flex items-center justify-center text-sm shrink-0">
                    {n}
                  </span>
                  <p className="font-semibold text-sm md:text-base bg-white hard px-3 py-2 shadow-hard-sm flex-1">{t}</p>
                </li>
              ))}
            </ol>
          </motion.div>
        </div>
      </main>

      {/* ============ FOOTER ============ */}
      <footer className="border-t-[3px] border-black bg-white">
        <div className="h-4 stripes border-b-[3px] border-black" />
        <div className="max-w-[1400px] mx-auto px-5 md:px-8 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="hard bg-black w-9 h-9 flex items-center justify-center">
              <Crown className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <p className="display text-lg">THE STANDING TABLE</p>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/60">
            © 1987–2025 The Standing Table Foundation · Charity Navigator ★★★★ · Audited annually, published proudly
          </p>
          <div className="flex gap-2">
            <Cross className="w-5 h-5" />
            <Triangle className="w-5 h-5" color={GRAY} />
            <div className="w-5 h-5 rounded-full bg-black" />
          </div>
        </div>
      </footer>
    </div>
  );
}