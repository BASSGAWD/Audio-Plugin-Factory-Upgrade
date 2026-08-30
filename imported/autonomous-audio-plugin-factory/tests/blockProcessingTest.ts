/**
 * Block/FFT processing inside the per-sample contract:
 *
 *  1. Both formerly-blocked concepts (convolution, spectral) now gate at
 *     >= 97 with zero defects and produce genuine output.
 *  2. The streaming STFT actually RECONSTRUCTS: at threshold=0, tilt=0,
 *     mix=1 the spectral processor returns the input delayed by one block
 *     (Hann/50% COLA identity), and its knobs measurably change the spectrum.
 *  3. Convolution produces a real decaying tail from an impulse, and its
 *     Size knob lengthens that tail.
 *  4. Neither allocates outside its init guard (real-time safety = 100).
 *  5. The research loop closes: both approvable and buildable by name.
 */
import { RESEARCH_CORPUS } from "../src/utils/researchCorpus";
import { runQualityGate, analyzeRealtimeSafety } from "../src/utils/qualityGate";
import { familyToCategory } from "../src/utils/pluginSpec";
import { runResearch, approveResearch, isApprovable } from "../src/utils/researchEngine";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

const compile = (body: string) => new Function("inputSample", "params", "state", "inputR", body) as (l: number, p: any, s: any, r?: number) => number;
const defaults = (params: PluginParameter[]) => Object.fromEntries(params.map((p) => [p.id, p.defaultValue]));
const entry = (concept: string) => RESEARCH_CORPUS.find((e) => e.concept === concept)!;

(async () => {
  /* ---- 1. Both gate clean ---- */
  for (const concept of ["convolution", "spectral-processing"]) {
    const m = entry(concept).proposedModule!;
    const plugin: AudioPlugin = {
      id: concept, name: m.title, category: familyToCategory(m.family), description: "",
      parameters: m.parameters.map((p) => ({ ...p, value: p.defaultValue })),
      dspFunction: m.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const g = runQualityGate(plugin, { family: m.family, prompt: m.title });
    const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
    const defects = g.report.deadParams.length + g.report.unstableParams.length + (g.report.semanticViolations?.length || 0);
    check(`${concept} ships at the floor with zero defects`, min >= 97 && defects === 0, `min=${min} defects=${defects} dead=${g.report.deadParams}`);
    check(`${concept} is real-time safe (init-guarded allocations)`, analyzeRealtimeSafety(m.body).score === 100, `${analyzeRealtimeSafety(m.body).evidence}`);
  }

  /* ---- 2. STFT reconstructs (COLA identity) + knobs move the spectrum ---- */
  {
    const m = entry("spectral-processing").proposedModule!;
    const fn = compile(m.body);
    const s: any = {};
    const p = { threshold: 0, tilt: 0, mix: 1 };
    const IN: number[] = [];
    const OUT: number[] = [];
    for (let i = 0; i < 4096; i++) {
      const x = Math.sin(2 * Math.PI * 500 * i / 44100) * 0.4;
      IN.push(x);
      OUT.push(fn(x, p, s));
    }
    // Find the block latency by best cross-correlation of the tanh-linear region.
    let bestLag = -1, bestErr = Infinity;
    for (let lag = 100; lag <= 400; lag++) {
      let err = 0, n = 0;
      for (let i = 2000; i < 3000; i++) { const d = OUT[i] - IN[i - lag]; err += d * d; n++; }
      err /= n;
      if (err < bestErr) { bestErr = err; bestLag = lag; }
    }
    check("STFT identity reconstructs the input (delayed)", bestErr < 1e-3, `lag=${bestLag} err=${bestErr.toExponential(2)}`);
    check("reconstruction latency is about one block (256)", bestLag >= 200 && bestLag <= 300, `lag=${bestLag}`);

    // The gate proves audibility by per-sample DIFFERENCE, not RMS: a spectral
    // gate strips quiet noise bins while the dominant tone keeps RMS ~constant,
    // yet the waveform clearly changes. Measure that difference the same way.
    const render = (params: any) => {
      const st: any = {};
      const buf: number[] = [];
      for (let i = 0; i < 8192; i++) {
        let h = (i * 2654435761) | 0; h ^= h >>> 15;
        const x = Math.sin(2 * Math.PI * 400 * i / 44100) * 0.3 + (h / 2147483648) * 0.15;
        buf.push(fn(x, params, st));
      }
      return buf;
    };
    const openGate = render({ threshold: 0, tilt: 0, mix: 1 });
    const closedGate = render({ threshold: 0.5, tilt: 0, mix: 1 });
    let diff = 0;
    for (let i = 512; i < 8192; i++) diff += Math.abs(openGate[i] - closedGate[i]);
    diff /= 7680;
    check("spectral gate threshold is audible (removes bins)", diff > 0.003, `mean|diff|=${diff.toFixed(4)}`);
  }

  /* ---- 3. Convolution: impulse yields a decaying tail; Size lengthens it ---- */
  {
    const m = entry("convolution").proposedModule!;
    const tailLen = (size: number) => {
      const fn = compile(m.body);
      const s: any = {};
      const p = { ...defaults(m.parameters as any), size, mix: 1, decay: 0.9 };
      let lastAudible = 0;
      for (let i = 0; i < 1200; i++) {
        const x = i === 0 ? 1 : 0; // unit impulse
        const y = Math.abs(fn(x, p, s));
        if (y > 0.001) lastAudible = i;
      }
      return lastAudible;
    };
    const shortTail = tailLen(0.15);
    const longTail = tailLen(1);
    check("convolution impulse produces a tail", longTail > 100, `tail=${longTail}`);
    check("larger Size lengthens the tail", longTail > shortTail * 1.5, `short=${shortTail} long=${longTail}`);
  }

  /* ---- 5. Research loop closes for both ---- */
  const conv = await runResearch("convolution");
  check("convolution is approvable", isApprovable(conv) && conv.proposedModule?.verification.passes === true);
  approveResearch(conv.id);
  const convBuild = buildOfflinePlugin("a convolution reverb");
  check("approved convolution is buildable by name", /convolution|impulse|FIR/i.test(convBuild.description), convBuild.description.slice(0, 80));

  const spec = await runResearch("spectral-processing");
  check("spectral is approvable", isApprovable(spec) && spec.proposedModule?.verification.passes === true);
  approveResearch(spec.id);
  const specBuild = buildOfflinePlugin("a spectral gate effect");
  check("approved spectral processor is buildable by name", /spectral|STFT|FFT/i.test(specBuild.description), specBuild.description.slice(0, 80));

  console.log(failures === 0 ? "\nBLOCK PROCESSING: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
