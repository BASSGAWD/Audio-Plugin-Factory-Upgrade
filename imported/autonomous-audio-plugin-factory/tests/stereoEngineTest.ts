/**
 * The stereo-engine contract:
 *
 *  1. BACKWARD COMPATIBILITY IS ABSOLUTE — every mono module behaves
 *     byte-identically: its left output ignores inputR entirely, it never
 *     sets state.outR, and the gate reports stereoOutput=false (dual-mono).
 *  2. Stereo modules (state.outR convention) gate at >= 97 with zero
 *     defects, report stereoOutput=true, and their Width knobs are honest
 *     (opening must not NARROW the image) and never misread as dead.
 *  3. Ping-pong actually alternates: first repeat left, second right.
 *  4. The research loop closes: mid-side and ping-pong are approvable, and
 *     approving ping-pong makes "a ping pong delay" build it for real.
 */
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { RESEARCH_CORPUS } from "../src/utils/researchCorpus";
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

const compile = (body: string) => new Function("inputSample", "params", "state", "inputR", body) as (l: number, p: any, s: any, r?: number) => number;
const defaults = (params: PluginParameter[]) => Object.fromEntries(params.map((p) => [p.id, p.defaultValue]));
const asPlugin = (id: string, family: any, params: PluginParameter[], body: string): AudioPlugin => ({
  id, name: id, category: familyToCategory(family), description: "",
  parameters: params.map((p) => ({ ...p, value: p.defaultValue })),
  dspFunction: body, faustCode: "", cppJuceCode: "", createdAt: "",
});

(async () => {
  /* ---- 1. Mono modules: byte-identical, no right channel ---- */
  const tape = DSP_RECIPES.find((r) => r.id === "delay")!;
  {
    const fn1 = compile(tape.body);
    const fn2 = compile(tape.body);
    const s1: any = {};
    const s2: any = {};
    const p = defaults(tape.parameters as any);
    let identical = true;
    for (let i = 0; i < 4410; i++) {
      const x = Math.sin(i * 0.05) * 0.3;
      // fn1 gets a wildly different right feed; fn2 gets none at all
      const a = fn1(x, p, s1, Math.sin(i * 0.11) * 0.9);
      const b = fn2(x, p, s2);
      if (a !== b) { identical = false; break; }
    }
    check("mono module's output ignores inputR completely", identical);
    check("mono module never sets state.outR", s1.outR === undefined && s2.outR === undefined);

    const gated = runQualityGate(asPlugin("tape", "delay", tape.parameters as any, tape.body), { family: "delay", prompt: "tape delay" });
    check("mono module reports stereoOutput=false", gated.report.stereoOutput === false);
    const min = Math.min(gated.scores.looks, gated.scores.performance, gated.scores.latency, gated.scores.musicality);
    check("mono module still ships at the floor through the stereo gate", min >= 97, `min=${min}`);
  }

  /* ---- 2. Stereo modules gate clean and report stereo ---- */
  for (const concept of ["mid-side", "ping-pong"]) {
    const entry = RESEARCH_CORPUS.find((e) => e.concept === concept)!;
    const m = entry.proposedModule!;
    const g = runQualityGate(asPlugin(concept, m.family, m.parameters as any, m.body), { family: m.family, prompt: m.title });
    const min = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
    const defects = g.report.deadParams.length + g.report.unstableParams.length + (g.report.semanticViolations?.length || 0);
    check(`${concept} ships at the floor with zero defects`, min >= 97 && defects === 0, `min=${min} defects=${defects} dead=${g.report.deadParams}`);
    check(`${concept} reports stereoOutput=true`, g.report.stereoOutput === true);
    check(`${concept} width knob verified audible (not dead)`, g.report.audibleParams.includes("width"));
    const widthCheck = g.report.semanticChecks?.find((c) => c.param === "width");
    check(`${concept} width honesty was measured`, !!widthCheck && widthCheck.ok, widthCheck?.detail || "no check ran");
  }

  /* ---- width really widens: interchannel diff grows min -> max ---- */
  {
    const m = RESEARCH_CORPUS.find((e) => e.concept === "mid-side")!.proposedModule!;
    const measure = (width: number) => {
      const fn = compile(m.body);
      const s: any = {};
      const p = { ...defaults(m.parameters as any), width };
      let diffSq = 0;
      for (let i = 0; i < 22050; i++) {
        const l = Math.sin(i * 0.05) * 0.3;
        const r = Math.sin((i + 97) * 0.05) * 0.3;
        const yl = fn(l, p, s, r);
        diffSq += (yl - s.outR) * (yl - s.outR);
      }
      return Math.sqrt(diffSq / 22050);
    };
    const narrow = measure(0);
    const wide = measure(2);
    check("mid-side width=0 collapses to mono", narrow < 1e-6, `diff=${narrow.toExponential(2)}`);
    check("mid-side width=2 is measurably wide", wide > 0.01, `diff=${wide.toFixed(4)}`);
  }

  /* ---- 3. Ping-pong genuinely alternates repeats L -> R ---- */
  {
    const m = RESEARCH_CORPUS.find((e) => e.concept === "ping-pong")!.proposedModule!;
    const fn = compile(m.body);
    const s: any = {};
    const p = { ...defaults(m.parameters as any), mix: 1, width: 1, time: 100, feedback: 0.8 };
    const d = Math.floor(100 * 44.1);
    const L: number[] = [];
    const R: number[] = [];
    for (let i = 0; i < d * 3 + 10; i++) {
      const x = i < 40 ? 0.5 : 0; // one short burst
      L.push(fn(x, p, s, x));
      R.push(s.outR);
    }
    const energy = (arr: number[], from: number) => arr.slice(from, from + 60).reduce((a, v) => a + Math.abs(v), 0);
    const firstL = energy(L, d);
    const firstR = energy(R, d);
    const secondL = energy(L, 2 * d);
    const secondR = energy(R, 2 * d);
    check("first repeat lands LEFT", firstL > firstR * 3, `L=${firstL.toFixed(3)} R=${firstR.toFixed(3)}`);
    check("second repeat lands RIGHT", secondR > secondL * 3, `L=${secondL.toFixed(3)} R=${secondR.toFixed(3)}`);
  }

  /* ---- 4. The research loop closes for stereo concepts ---- */
  const midSide = await runResearch("mid-side");
  check("mid-side research is APPROVABLE now (stereo engine landed)", isApprovable(midSide) && midSide.proposedModule?.verification.passes === true);

  const pingPong = await runResearch("ping-pong");
  check("ping-pong research is approvable", isApprovable(pingPong));
  approveResearch(pingPong.id);
  const build = buildOfflinePlugin("a ping pong delay");
  check("approved ping-pong is buildable by name", /ping-pong|cross-fed/i.test(build.description), build.description.slice(0, 80));
  const gatedBuild = runQualityGate(
    { id: "t", name: build.name, category: build.category, description: build.description, parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" },
    { family: build.family, prompt: "a ping pong delay" }
  );
  const gbMin = Math.min(gatedBuild.scores.looks, gatedBuild.scores.performance, gatedBuild.scores.latency, gatedBuild.scores.musicality);
  check("built ping-pong ships at the floor with stereo output", gbMin >= 97 && gatedBuild.report.stereoOutput === true, `min=${gbMin}`);

  console.log(failures === 0 ? "\nSTEREO ENGINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
