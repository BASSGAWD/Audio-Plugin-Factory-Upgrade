/**
 * CPU cost — reclaiming the dead `latency` dimension as real, measured
 * per-sample DSP cost.
 *
 * scoreLatency(generationMs) returns a flat 100 whenever generationMs is
 * undefined -- which is EVERY deterministic/offline build (buildOfflinePlugin
 * runs zero LLM calls, so it never has a generation wall-time). That means
 * one of the four headline dimensions carries zero information about the
 * plugin's own audio cost on the offline path: a per-sample-convolution
 * reverb and a one-pole filter score identically.
 *
 * measureCpuCost fills that gap by TIMING the DSP body (renderPass already
 * renders thousands of samples for every other measurement in this file, so
 * this is nearly free) -- deliberately INFORMATIONAL, per CLAUDE.md's
 * explicit guidance: wall-clock timing is noisy on a machine doing other
 * concurrent work, so a flaky headline score would be worse than the current
 * stable-but-uninformative 100. These tests prove two separate things:
 *   1. the measurement DISCRIMINATES (honest recipe vs a deliberately
 *      expensive per-sample body -- a decisive gap, not two equal scores),
 *   2. the headline `latency` score is completely UNTOUCHED by it, in both
 *      the light and the heavy case.
 */
import { measureCpuCost, runQualityGate, analyzeRealtimeSafety } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, min: number, max: number, def: number, unit = ""): PluginParameter =>
  ({ id, name: id, min, max, defaultValue: def, value: def, unit } as PluginParameter);

/* ------------------------------------------------------------------ */
/* 1. Every golden recipe is cheap and measures near-perfect            */
/* ------------------------------------------------------------------ */
{
  let worst = 100;
  let worstId = "";
  for (const r of DSP_RECIPES) {
    const c = measureCpuCost(r.body, r.parameters as PluginParameter[]);
    check(`${r.id}: CPU cost measured and cheap`, !!c && c.score >= 90, c ? `score=${c.score} ns/sample=${c.nsPerSample}` : "null");
    check(`${r.id}: no static real-time-safety issues`, !!c && c.staticIssues === "", c ? c.staticIssues : "null");
    if (c && c.score < worst) { worst = c.score; worstId = r.id; }
  }
  check("no golden recipe scores suspiciously low on CPU cost", worst >= 90, `worst=${worstId} (${worst})`);
}

/* ------------------------------------------------------------------ */
/* 2. A deliberately expensive per-sample body is caught, decisively    */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "filter")!;
  const honest = measureCpuCost(golden.body, golden.parameters as PluginParameter[]);
  check("honest filter measures", !!honest, "none");

  // A per-sample body doing real (if pointless) transcendental work in an
  // inner loop -- the "per-sample convolution vs one-pole" defect class
  // CLAUDE.md calls out explicitly. 8000 iterations of sin+sqrt is a huge,
  // stable multiple of a light DSP's cost -- robust to ordinary machine
  // noise (it would take an ~8000x system slowdown to erase this gap).
  const heavy = `let acc = 0;
for (let k = 0; k < 8000; k++) { acc += Math.sin(inputSample * 0.001 * k) * Math.sqrt(k + 1); }
return Math.tanh((inputSample + acc * 1e-6) * 0.5);`;
  const expensive = measureCpuCost(heavy, [P("x", 0, 1, 0)]);
  check("expensive per-sample body measures", !!expensive, "none");
  check(
    "expensive per-sample body scores decisively lower than an honest golden recipe",
    !!honest && !!expensive && expensive.score < honest.score - 50,
    `honest=${honest?.score} (${honest?.nsPerSample}ns) expensive=${expensive?.score} (${expensive?.nsPerSample}ns)`
  );
  check(
    "the expensive body's measured cost is a real multiple of the honest one's, not noise",
    !!honest && !!expensive && expensive.nsPerSample > honest.nsPerSample * 10,
    `honest=${honest?.nsPerSample}ns expensive=${expensive?.nsPerSample}ns`
  );
}

/* ------------------------------------------------------------------ */
/* 3. Static real-time-safety findings are folded in                    */
/* ------------------------------------------------------------------ */
{
  const clean = `if (!state.init) { state.buf = new Float32Array(64); state.init = true; }
return Math.tanh(inputSample * 0.5 + state.buf[0] * 0);`;
  const unguarded = `let buf = new Float32Array(64);
return Math.tanh(inputSample * 0.5 + buf[0] * 0);`;
  const cClean = measureCpuCost(clean, [P("x", 0, 1, 0)]);
  const cUnguarded = measureCpuCost(unguarded, [P("x", 0, 1, 0)]);
  check("unguarded per-sample allocation is flagged in staticIssues", !!cUnguarded && cUnguarded.staticIssues.length > 0, cUnguarded?.staticIssues || "none");
  check("clean code carries no static issues", !!cClean && cClean.staticIssues === "");
  check(
    "an unsafe body never scores HIGHER than an equally-cheap clean one",
    !!cClean && !!cUnguarded && cUnguarded.score <= cClean.score,
    `clean=${cClean?.score} unguarded=${cUnguarded?.score}`
  );
  // Cross-check against the static analyzer directly -- staticIssues should
  // be exactly what analyzeRealtimeSafety itself reports, not a paraphrase.
  const direct = analyzeRealtimeSafety(unguarded);
  check("staticIssues matches analyzeRealtimeSafety's own evidence", cUnguarded?.staticIssues === direct.evidence);
}

/* ------------------------------------------------------------------ */
/* 4. Robustness: never measures code that doesn't compile              */
/* ------------------------------------------------------------------ */
{
  const broken = measureCpuCost("this is not valid javascript {{{", [P("x", 0, 1, 0)]);
  check("returns null for code that doesn't compile", broken === null);

  const throws = measureCpuCost("throw new Error('nope');", [P("x", 0, 1, 0)]);
  check("returns null for code that throws on every sample", throws === null);
}

/* ------------------------------------------------------------------ */
/* 5. The headline `latency` score is completely UNTOUCHED               */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "filter")!;
  const lightPlugin: AudioPlugin = {
    id: "t", name: "t", category: "filter", description: "",
    parameters: (golden.parameters as PluginParameter[]).map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: golden.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const heavyBody = `if (!state.init) { state.init = true; }
let acc = 0;
for (let k = 0; k < 8000; k++) { acc += Math.sin(inputSample * 0.001 * k) * Math.sqrt(k + 1); }
return Math.tanh((inputSample + acc * 1e-6) * 0.5);`;
  const heavyPlugin: AudioPlugin = {
    id: "t2", name: "t2", category: "filter", description: "",
    parameters: [{ ...P("x", 0, 1, 0), value: 0 }],
    dspFunction: heavyBody, faustCode: "", cppJuceCode: "", createdAt: "",
  };

  const lightGate = runQualityGate(lightPlugin, { family: "filter", prompt: "light" });
  const heavyGate = runQualityGate(heavyPlugin, { family: "filter", prompt: "heavy" });

  check("light build's headline latency is the deterministic-path 100", lightGate.scores.latency === 100, `latency=${lightGate.scores.latency}`);
  check("heavy build's headline latency is STILL the deterministic-path 100", heavyGate.scores.latency === 100, `latency=${heavyGate.scores.latency}`);
  check(
    "yet the two builds' informational cpuCost scores differ decisively",
    !!lightGate.report.cpuCost && !!heavyGate.report.cpuCost && heavyGate.report.cpuCost.score < lightGate.report.cpuCost.score - 50,
    `light=${lightGate.report.cpuCost?.score} heavy=${heavyGate.report.cpuCost?.score}`
  );
  // generationMs supplied (the online path) must ALSO be unaffected by cpuCost.
  const onlineGate = runQualityGate(heavyPlugin, { family: "filter", prompt: "heavy", generationMs: 5000 });
  check("supplying generationMs scores latency from wall-time alone, still ignoring cpuCost", onlineGate.scores.latency === 100, `latency=${onlineGate.scores.latency}`);
}

/* ------------------------------------------------------------------ */
/* 6. Full-gate integration: cpuCost lands in the build report          */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  const plugin: AudioPlugin = {
    id: "t", name: "t", category: "dynamics", description: "",
    parameters: (golden.parameters as PluginParameter[]).map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: golden.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const gate = runQualityGate(plugin, { family: "dynamics", prompt: "test compressor" });
  check("build report carries cpuCost", !!gate.report.cpuCost, JSON.stringify(gate.report.cpuCost));
  check("cpuCost score is in 0-100 range", !!gate.report.cpuCost && gate.report.cpuCost.score >= 0 && gate.report.cpuCost.score <= 100);
  check("cpuCost note appears in the build transcript", gate.notes.some((n) => /CPU cost/.test(n)), gate.notes.filter((n) => /CPU/.test(n)).join(" | "));

  // A fatal (non-compiling) build must never attempt to time anything.
  const brokenPlugin: AudioPlugin = { ...plugin, dspFunction: "this is not valid javascript {{{" };
  const brokenGate = runQualityGate(brokenPlugin, { family: "dynamics", prompt: "broken" });
  check("a build that fails to compile carries no cpuCost", brokenGate.report.cpuCost === undefined, JSON.stringify(brokenGate.report.cpuCost));
}

console.log(failures === 0 ? "\nCPU COST: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
