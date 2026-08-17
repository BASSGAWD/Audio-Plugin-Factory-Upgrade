import { DSP_RECIPES, detectRecipe } from "../src/utils/dspRecipes";
import { runQualityGate, measureMusicality } from "../src/utils/qualityGate";
import { runPluginDiagnostics } from "../src/utils/healthcheckRunner";
import { AudioPlugin } from "../src/types";

let failures = 0;

for (const r of DSP_RECIPES) {
  const plugin: AudioPlugin = {
    id: r.id,
    name: r.title,
    category: r.id === "delay" ? "delay" : r.id === "reverb" ? "reverb" : r.id === "filter" ? "filter" : r.id === "dynamics" ? "dynamics" : r.id === "modulation" ? "modulation" : "distortion",
    description: "",
    parameters: r.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: r.body,
    faustCode: "",
    cppJuceCode: "",
    createdAt: "",
  };

  const diag = runPluginDiagnostics(plugin);
  const m = measureMusicality(r.body, plugin.parameters);
  const gate = runQualityGate(plugin);
  const s = gate.scores;
  const minScore = Math.min(s.looks, s.performance, s.latency, s.musicality);
  const pass = diag.overallHealthStatus !== "CRITICAL" && m.ok && minScore >= 97;
  if (!pass) failures++;

  console.log(`${pass ? "PASS" : "FAIL"} ${r.id.padEnd(11)} health=${diag.overallHealthStatus.padEnd(8)} gain=${m.gainOffsetDb.toFixed(1).padStart(6)}dB audible=[${m.audibleParams}] dead=[${m.deadParams}] scores L${s.looks}/P${s.performance}/La${s.latency}/M${s.musicality}${m.evidence ? " EVIDENCE: " + m.evidence : ""}`);
}

// Intent detection sanity
const probes: Array<[string, string | null]> = [
  ["give me a lush hall reverb with shimmer", "reverb"],
  ["warm tape delay with feedback", "delay"],
  ["a screaming fuzz pedal", "distortion"],
  ["classic 80s chorus for clean guitar", "modulation"],
  ["glue compressor for the drum bus", "dynamics"],
  ["acid resonant lowpass filter", "filter"],
  // Now matches the synth recipe (added later) -- previously expected null when no synth recipe existed
  ["a granular texture synthesizer", "synth"],
  // A prompt with no recognizable effect-family keywords should still match nothing
  ["make my computer sound better somehow", null],
  // Regression: tremolo and phaser used to fall through to the SAME
  // "modulation" catch-all as chorus (a shared regex matched all of
  // chorus|flang|phaser|vibrato|tremolo|modulat|wobble|ensemble|leslie|
  // rotary) -- structurally wrong, since neither is a delay-line effect.
  // Chorus/flanger/vibrato/ensemble genuinely ARE delay-line modulation, so
  // they stay routed to "modulation" on purpose -- only the two structurally
  // mismatched cases get their own recipe.
  ["a slow tremolo", "tremolo"],
  ["a sweeping phaser", "phaser"],
  ["MXR-style phase shift pedal", "phaser"],
];
for (const [prompt, expected] of probes) {
  const got = detectRecipe(prompt)?.id ?? null;
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} detect "${prompt}" -> ${got} (expected ${expected})`);
}

// Mechanistic distinction, not just a different id string: tremolo modulates
// AMPLITUDE (RMS should swing widely across one LFO cycle on a steady input);
// chorus modulates DELAY TIME (RMS should stay comparatively steady -- energy
// is conserved, just phase-shifted). If tremolo were still secretly wired
// through a delay line, this would fail even though detectRecipe passes.
{
  const tremolo = DSP_RECIPES.find((r) => r.id === "tremolo")!;
  const chorus = DSP_RECIPES.find((r) => r.id === "modulation")!;
  // A single pure tone is the WORST-case probe for this comparison: a delay
  // applied to one frequency is just a phase shift, and mixing a phase-
  // shifted sine with the dry sine produces its OWN large constructive/
  // destructive swings from comb-filtering -- a real, well-known chorus
  // characteristic, but one that would make this test's premise backwards.
  // A spectrally rich probe (three unrelated tones) is what actually
  // isolates the mechanism: gain modulation scales every component equally
  // regardless of how many there are, while comb-filtering interference
  // partially cancels across simultaneous, unrelated frequencies instead of
  // reinforcing uniformly the way it does for a single tone.
  const richTone = (i: number) => (Math.sin(2 * Math.PI * 220 * i / 44100) + Math.sin(2 * Math.PI * 587 * i / 44100) + Math.sin(2 * Math.PI * 1319 * i / 44100)) * 0.15;
  const rmsOverOneCycle = (recipe: typeof tremolo, rateHz: number): { min: number; max: number } => {
    const fn = new Function("inputSample", "params", "state", "inputR", recipe.body) as (i: number, p: any, s: any, r?: number) => number;
    const params: Record<string, number> = {};
    recipe.parameters.forEach((p) => (params[p.id] = p.id === "rate" ? rateHz : p.defaultValue));
    const state: any = {};
    const period = Math.round(44100 / rateHz);
    const chunks = 8;
    const chunkLen = Math.floor(period / chunks);
    let min = Infinity;
    let max = -Infinity;
    for (let c = 0; c < chunks; c++) {
      let sq = 0;
      for (let i = 0; i < chunkLen; i++) {
        const y = fn(richTone(c * chunkLen + i), params, state, undefined);
        sq += y * y;
      }
      const rms = Math.sqrt(sq / chunkLen);
      min = Math.min(min, rms);
      max = Math.max(max, rms);
    }
    return { min, max };
  };
  const tremRms = rmsOverOneCycle(tremolo, 4);
  const chorusRms = rmsOverOneCycle(chorus, 4);
  const tremSwing = tremRms.max - tremRms.min;
  const chorusSwing = chorusRms.max - chorusRms.min;
  const ok = tremSwing > chorusSwing * 2;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} tremolo genuinely modulates amplitude, not delay time  tremolo swing=${tremSwing.toFixed(3)} chorus swing=${chorusSwing.toFixed(3)}`);
}

// Regression bait for the phaser feedback-stability fix: reconstruct the OLD
// buggy tap (feeding the last stage's internal TDF2 state variable, state.ap4,
// straight back into the input) against the SAME body otherwise, and confirm
// it really did diverge -- this isn't a strawman, it's what shipped first and
// failed allRecipesTest.ts's own min/max parameter sweep. The divergence
// builds slowly (a resonant loop, not an instant blowup) -- confirmed by hand
// to first go non-finite around sample 39121 (~0.9s) at max feedback, so the
// window here is a full 2s to leave comfortable margin, not the ~100ms a
// quick probe would use elsewhere in this file.
{
  const phaser = DSP_RECIPES.find((r) => r.id === "phaser")!;
  const brokenBody = phaser.body.replace("Math.tanh(state.fbOut * feedback)", "state.ap4 * feedback").replace("state.fbOut = y4;\n", "");
  const runAtMaxFeedback = (body: string): boolean => {
    const fn = new Function("inputSample", "params", "state", "inputR", body) as (i: number, p: any, s: any, r?: number) => number;
    const params: Record<string, number> = { rate: 0.5, depth: 1, feedback: 0.9, mix: 0.5 };
    const state: any = {};
    for (let i = 0; i < 88200; i++) {
      const y = fn(Math.sin(2 * Math.PI * 220 * i / 44100) * 0.5, params, state, undefined);
      if (!Number.isFinite(y)) return false;
    }
    return true;
  };
  const brokenStable = runAtMaxFeedback(brokenBody);
  const fixedStable = runAtMaxFeedback(phaser.body);
  check("regression bait: the OLD feedback tap (internal TDF2 state, not the true output) really did diverge at max feedback", !brokenStable);
  check("the SHIPPED phaser stays finite across its full declared feedback range", fixedStable);
}

function check(label: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

console.log(failures === 0 ? "\nALL RECIPES + DETECTION PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
