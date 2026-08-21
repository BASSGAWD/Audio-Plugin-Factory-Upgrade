/**
 * The sidechain-engine contract:
 *
 *  1. BACKWARD COMPATIBILITY IS ABSOLUTE — every existing module (mono,
 *     stereo/mid-side, ping-pong) behaves byte-identically whether or not a
 *     5th `inputKey` argument is supplied at all: bodies that never
 *     reference it simply ignore it, exactly like inputR before it.
 *  2. comp_sidechain_ext gates at >= 97 with zero defects.
 *  3. It is a REAL external key, not a self-detecting compressor in
 *     disguise: gain reduction tracks the KEY signal's envelope, not the
 *     main signal's -- proven by holding the main signal at a CONSTANT
 *     level and toggling only the key between loud and quiet.
 *  4. Without a key connected, it falls back to ordinary self-detecting
 *     compression (inputKey undefined -> key = inputSample), so every
 *     existing render path (gate, functional fitness, reference deviation)
 *     measures it exactly like any other compressor.
 *  5. The research loop closes: sidechain-input is no longer blocked, is
 *     approvable, and approving it makes "a sidechain compressor" build it
 *     for real.
 */
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { runQualityGate } from "../src/utils/qualityGate";
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

const compile = (body: string) =>
  new Function("inputSample", "params", "state", "inputR", "inputKey", body) as (l: number, p: any, s: any, r?: number, k?: number) => number;
const defaults = (params: PluginParameter[]) => Object.fromEntries(params.map((p) => [p.id, p.defaultValue]));
const asPlugin = (id: string, family: any, params: PluginParameter[], body: string): AudioPlugin => ({
  id, name: id, category: familyToCategory(family), description: "",
  parameters: params.map((p) => ({ ...p, value: p.defaultValue })),
  dspFunction: body, faustCode: "", cppJuceCode: "", createdAt: "",
});

(async () => {
  /* ---- 1. Backward compatibility: an unrelated 5th arg changes nothing ---- */
  const tape = DSP_RECIPES.find((r) => r.id === "delay")!;
  {
    const fn1 = compile(tape.body);
    const fn2 = compile(tape.body);
    const s1: any = {};
    const s2: any = {};
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = Math.sin(i * 0.037) * 0.5;
      // fn1 gets no 5th arg at all; fn2 gets a wildly different key every
      // sample -- a mono body must ignore both identically.
      const y1 = fn1(x, defaults(tape.parameters as any), s1);
      const y2 = fn2(x, defaults(tape.parameters as any), s2, undefined, Math.sin(i * 1.91) * 0.9);
      if (Math.abs(y1 - y2) > 1e-12) { identical = false; break; }
    }
    check("mono delay ignores inputKey entirely (byte-identical)", identical);
  }
  const midSide = DSP_TOPOLOGIES.find((t) => t.id === "comp_midside")!;
  {
    const fn1 = compile(midSide.body);
    const fn2 = compile(midSide.body);
    const s1: any = {};
    const s2: any = {};
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = Math.sin(i * 0.041) * 0.5;
      const r = Math.sin(i * 0.029) * 0.4;
      const y1 = fn1(x, defaults(midSide.parameters as any), s1, r);
      const y2 = fn2(x, defaults(midSide.parameters as any), s2, r, Math.sin(i * 2.3) * 0.9);
      if (Math.abs(y1 - y2) > 1e-12 || Math.abs((s1.outR ?? 0) - (s2.outR ?? 0)) > 1e-12) { identical = false; break; }
    }
    check("stereo mid-side ignores inputKey entirely (byte-identical, both channels)", identical);
  }

  /* ---- 2. comp_sidechain_ext ships at the floor ---- */
  const sc = DSP_TOPOLOGIES.find((t) => t.id === "comp_sidechain_ext")!;
  check("comp_sidechain_ext exists in the topology bank", !!sc);
  const gate = runQualityGate(asPlugin("t", sc.family, sc.parameters as any, sc.body), { family: sc.family, prompt: "sidechain input from an external key" });
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  const defects = gate.report.deadParams.length + gate.report.unstableParams.length + (gate.report.semanticViolations?.length || 0);
  check("comp_sidechain_ext ships at the floor with zero defects", min >= 97 && defects === 0, `min=${min} defects=${defects}`);
  check("comp_sidechain_ext's body actually reads inputKey", sc.body.includes("inputKey"));

  /* ---- 3. Real ducking: gain reduction tracks the KEY, not the main signal ----
   * The key must toggle on a period long enough for the Release time
   * constant to actually settle each phase (120ms default release here) --
   * a faster toggle just measures attack/release smoothing artifacts, not
   * whether the detector is keyed correctly. Verified empirically before
   * writing this: a 1000-sample (~23ms) toggle period gave a meaningless
   * 1.03x ratio; a 10000-sample (~227ms) period, comfortably longer than
   * the release time, gives a clean, decisive result. */
  {
    const fn = compile(sc.body);
    const state: any = {};
    const params = defaults(sc.parameters as any);
    const N = 200000;
    let sumLoud = 0, nLoud = 0, sumQuiet = 0, nQuiet = 0;
    for (let i = 0; i < N; i++) {
      // Main signal: CONSTANT amplitude throughout -- if ducking is real,
      // its output level must still change with the key, not the main.
      const main = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
      const keyPhaseLoud = Math.floor(i / 10000) % 2 === 0;
      const key = (keyPhaseLoud ? 0.8 : 0.01) * Math.sin((2 * Math.PI * 100 * i) / 44100);
      const out = fn(main, params, state, undefined, key);
      const phase = i % 20000;
      if (phase > 3000 && phase < 9000) { sumLoud += Math.abs(out); nLoud++; }
      if (phase > 13000 && phase < 19000) { sumQuiet += Math.abs(out); nQuiet++; }
    }
    const avgLoud = sumLoud / nLoud;
    const avgQuiet = sumQuiet / nQuiet;
    check(
      "main signal ducks when the KEY is loud, recovers when the key is quiet (main itself never changes level)",
      avgQuiet > avgLoud * 1.8,
      `avgWhenKeyLoud=${avgLoud.toFixed(4)} avgWhenKeyQuiet=${avgQuiet.toFixed(4)} ratio=${(avgQuiet / avgLoud).toFixed(2)}`
    );
  }

  /* ---- 4. No key connected -> falls back to ordinary self-detection ---- */
  {
    const fn1 = compile(sc.body);
    const fn2 = compile(sc.body);
    const s1: any = {};
    const s2: any = {};
    const params = defaults(sc.parameters as any);
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 8000 < 4000 ? 0.7 : 0.05) * Math.sin(i * 0.09);
      // fn1: no key arg at all. fn2: explicitly pass inputKey === inputSample
      // (the documented fallback value). Both must behave identically.
      const y1 = fn1(x, params, s1);
      const y2 = fn2(x, params, s2, undefined, x);
      if (Math.abs(y1 - y2) > 1e-9) { identical = false; break; }
    }
    check("with no key connected, behaves exactly like self-detecting compression", identical);
  }

  /* ---- 5. The research loop closes ---- */
  const research = await runResearch("sidechain-input");
  check("sidechain-input is no longer blocked", !research.conflicts.some((c) => c.severity === "blocking"));
  check("sidechain-input is approvable with a verified module", isApprovable(research) && research.proposedModule?.verification.passes === true);
  approveResearch(research.id);
  const build = buildOfflinePlugin("a sidechain compressor ducking the bass from the kick");
  check(
    "approved sidechain compressor is buildable by name",
    build.dspFunction.includes("inputKey"),
    build.description.slice(0, 90)
  );
  const builtGate = runQualityGate(
    { id: "t", name: build.name, category: build.category, description: build.description, parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" },
    { family: build.family, prompt: "a sidechain compressor ducking the bass from the kick" }
  );
  const builtMin = Math.min(builtGate.scores.looks, builtGate.scores.performance, builtGate.scores.latency, builtGate.scores.musicality);
  check("the built sidechain compressor ships at the floor", builtMin >= 97, `min=${builtMin}`);

  console.log(failures === 0 ? "\nSIDECHAIN ENGINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
