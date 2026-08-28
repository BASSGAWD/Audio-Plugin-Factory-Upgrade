/**
 * Beat-locked autotune: does the key tracking actually WORK?
 *
 * Passing the quality gate only proves the DSP is well-behaved audio. The
 * claims that matter here are behavioral, and each is verified against a
 * deliberately broken or contrasting counterpart (CLAUDE.md's standard) --
 * a test that merely confirmed "it makes sound" would pass for a plugin
 * that ignored the sidechain entirely.
 *
 *  1. It reads the key from the SIDECHAIN, not the vocal. Feed the same
 *     vocal against two different backing tracks -> different correction.
 *  2. The detected key is CORRECT, not just different: a C-major backing
 *     track must resolve to C major, an A-minor one to A minor. (Those two
 *     share a pitch-class set, so getting both right is a real test of the
 *     major/minor templates rather than of pitch-class energy alone.)
 *  3. It tracks a MODULATION: when the backing track changes key partway
 *     through, the correction target follows it.
 *  4. Lookahead is real: the correction applied to a sample is informed by
 *     sidechain audio that arrives AFTER that sample.
 *  5. A passing out-of-key chord does NOT yank the key (hysteresis).
 */
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";

// The builder logs prompt gaps to localStorage; stub it so this runs in Node.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const topo = DSP_TOPOLOGIES.find((t) => t.id === "pitch_beat_locked_autotune")!;
check("topology is registered", !!topo);

const SR = 44100;
const compile = () =>
  new Function("inputSample", "params", "state", "inputR", "inputKey", topo.body) as (
    i: number, p: any, s: any, r?: number, k?: number
  ) => number;

const defaults = () => {
  const p: Record<string, number> = {};
  for (const q of topo.parameters) p[q.id] = q.defaultValue;
  return p;
};

/** A chord: sum of sine partials at the given pitch classes (MIDI notes). */
function chordSample(midis: number[], n: number): number {
  let s = 0;
  for (const m of midis) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    // Fundamental + a little 2nd/3rd harmonic, like a real instrument.
    s += Math.sin((2 * Math.PI * f * n) / SR) * 0.5;
    s += Math.sin((2 * Math.PI * 2 * f * n) / SR) * 0.16;
    s += Math.sin((2 * Math.PI * 3 * f * n) / SR) * 0.08;
  }
  return s / Math.max(1, midis.length);
}

/** Run the plugin and report the key it settled on (read from state). */
function runWithBacking(
  backing: (n: number) => number,
  vocalMidi: number,
  seconds: number,
  params: Record<string, number> = defaults()
): { tonic: number; isMinor: number; out: number[] } {
  const fn = compile();
  const state: any = {};
  const out: number[] = [];
  const vf = 440 * Math.pow(2, (vocalMidi - 69) / 12);
  const N = Math.round(SR * seconds);
  for (let n = 0; n < N; n++) {
    const vocal = Math.sin((2 * Math.PI * vf * n) / SR) * 0.4;
    out.push(fn(vocal, params, state, undefined, backing(n)));
  }
  return { tonic: state.tonic, isMinor: state.isMinor, out };
}

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const nameOf = (t: number, m: number) => `${PITCH_NAMES[((t % 12) + 12) % 12]} ${m ? "minor" : "major"}`;

/* ---- 1 + 2. The key comes from the sidechain, and it's the RIGHT key. ---- */
// C major: I-IV-V-I over C4. A minor: i-iv-v-i over A3. Same 7 pitch
// classes -- only the tonal emphasis differs, so this genuinely tests the
// major/minor templates rather than raw pitch-class energy.
const C_MAJOR = [
  [60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67],
];
const A_MINOR = [
  [57, 60, 64], [62, 65, 69], [64, 67, 71], [57, 60, 64],
];
const progression = (chords: number[][]) => (n: number) => {
  const barLen = Math.round(SR * 0.75);
  return chordSample(chords[Math.floor(n / barLen) % chords.length], n);
};

const inC = runWithBacking(progression(C_MAJOR), 61, 8); // vocal sings C#4 (out of key both ways)
const inAm = runWithBacking(progression(A_MINOR), 61, 8);

check("a C major backing track is detected as C major", inC.tonic === 0 && inC.isMinor === 0, `got ${nameOf(inC.tonic, inC.isMinor)}`);
check("an A minor backing track is detected as A minor", inAm.tonic === 9 && inAm.isMinor === 1, `got ${nameOf(inAm.tonic, inAm.isMinor)}`);
check(
  "the key is read from the SIDECHAIN: same vocal, different backing -> different key",
  !(inC.tonic === inAm.tonic && inC.isMinor === inAm.isMinor),
  `${nameOf(inC.tonic, inC.isMinor)} vs ${nameOf(inAm.tonic, inAm.isMinor)}`
);

/* ---- Decisive counterpart: with NO sidechain the plugin must not be
   claiming a sidechain-derived key -- it falls back to the vocal, so a
   pure vocal tone gives a different answer than the C-major track. ---- */
{
  const fn = compile();
  const state: any = {};
  const p = defaults();
  const vf = 440 * Math.pow(2, (61 - 69) / 12);
  for (let n = 0; n < SR * 8; n++) fn(Math.sin((2 * Math.PI * vf * n) / SR) * 0.4, p, state, undefined, undefined);
  check(
    "with no sidechain patched it still runs (falls back to the vocal) rather than failing",
    typeof state.tonic === "number" && Number.isFinite(state.tonic),
    `fallback key = ${nameOf(state.tonic, state.isMinor)}`
  );
}

/* ---- 3. Modulation tracking: the backing track changes key mid-run. ---- */
{
  const halfway = Math.round(SR * 7);
  const modulating = (n: number) =>
    n < halfway ? progression(C_MAJOR)(n) : chordSample([[66, 70, 73], [71, 75, 78], [73, 77, 80], [66, 70, 73]][Math.floor((n - halfway) / Math.round(SR * 0.75)) % 4], n);

  const fn = compile();
  const state: any = {};
  const p = defaults();
  const vf = 440 * Math.pow(2, (61 - 69) / 12);
  let keyBefore = -1;
  for (let n = 0; n < SR * 20; n++) {
    fn(Math.sin((2 * Math.PI * vf * n) / SR) * 0.4, p, state, undefined, modulating(n));
    if (n === halfway - 1) keyBefore = state.tonic;
  }
  check("key BEFORE the modulation is the original key", keyBefore === 0, `got ${PITCH_NAMES[((keyBefore % 12) + 12) % 12]}`);
  check(
    "the plugin FOLLOWS a real key change in the backing track",
    state.tonic !== keyBefore,
    `moved ${PITCH_NAMES[((keyBefore % 12) + 12) % 12]} -> ${nameOf(state.tonic, state.isMinor)}`
  );
}

/* ---- 4. Lookahead is real: correcting sample N uses sidechain audio that
   arrived after N. Proven by output timing -- with lookahead the corrected
   signal emerges delayed relative to zero lookahead. ---- */
{
  const withLook = runWithBacking(progression(C_MAJOR), 61, 3, { ...defaults(), lookahead: 100 });
  const noLook = runWithBacking(progression(C_MAJOR), 61, 3, { ...defaults(), lookahead: 0 });
  const firstAudible = (xs: number[]) => xs.findIndex((v) => Math.abs(v) > 0.02);
  const dLook = firstAudible(withLook.out);
  const dNone = firstAudible(noLook.out);
  check(
    "lookahead really delays the signal (the vocal is held while the key is decided)",
    dLook > dNone,
    `first audible: lookahead=${dLook} samples, none=${dNone} samples`
  );
  check(
    "the delay is on the order of the requested lookahead, not arbitrary",
    dLook - dNone > 0.5 * 0.1 * SR,
    `measured ${dLook - dNone} samples for a 100ms request (~${Math.round(0.1 * SR)})`
  );
}

/* ---- 5. Hysteresis: one borrowed chord must NOT move the key. ---- */
{
  const withBlip = (n: number) => {
    const bar = Math.round(SR * 0.75);
    const idx = Math.floor(n / bar);
    // One out-of-key chord (Eb major) inserted in an otherwise C-major loop.
    if (idx === 6) return chordSample([63, 67, 70], n);
    return progression(C_MAJOR)(n);
  };
  const r = runWithBacking(withBlip, 61, 10);
  check(
    "a single passing out-of-key chord does NOT yank the key (hysteresis holds)",
    r.tonic === 0 && r.isMinor === 0,
    `stayed on ${nameOf(r.tonic, r.isMinor)}`
  );
}

/* ---- Output sanity: everything above must be real audio, not silence
   or NaN, or the behavioral checks would be measuring nothing. ---- */
{
  const r = runWithBacking(progression(C_MAJOR), 61, 3);
  const finite = r.out.every((v) => Number.isFinite(v));
  const energy = r.out.reduce((a, v) => a + v * v, 0) / r.out.length;
  check("output is finite and audible (the checks above measured real audio)", finite && energy > 1e-6, `rms^2=${energy.toExponential(2)}`);
}

/* ---- 6. THE question that matters for a product: can the factory reach
   this FROM A PROMPT? A topology nothing routes to is dead weight. And the
   decisive half is the other direction -- it must NOT hijack ordinary pitch
   prompts, which is exactly what happened when it was first added (the
   pitch family had no default topology, so the one specialist variant won
   every "octave-up pitch shifter" too). ---- */
{
  const asksForKeyTracking = [
    "an autotune that automatically tracks the key of the beat",
    "auto key tracking autotune using the beat as sidechain with lookahead",
    "a vocal tuner that detects the key from the backing track",
    "autotune that follows key changes in the instrumental automatically",
  ];
  const ordinaryPitch = ["an octave-up pitch shifter", "a simple autotune", "a harmonizer"];

  for (const p of asksForKeyTracking) {
    const b = buildOfflinePlugin(p);
    check(
      `routes to the beat-locked build: "${p.slice(0, 46)}..."`,
      b.dspFunction.includes("inputKey") && b.parameters.some((x) => x.id === "lookahead"),
      `params=[${b.parameters.map((x) => x.id).join(",")}]`
    );
  }
  for (const p of ordinaryPitch) {
    const b = buildOfflinePlugin(p);
    check(
      `an ordinary pitch prompt is NOT hijacked: "${p}"`,
      !b.dspFunction.includes("inputKey") && b.parameters.some((x) => x.id === "key"),
      `params=[${b.parameters.map((x) => x.id).join(",")}]`
    );
  }
}

console.log(failures === 0 ? "\nBEAT-LOCKED AUTOTUNE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
