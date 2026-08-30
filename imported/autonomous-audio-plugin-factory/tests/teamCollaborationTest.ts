/**
 * Does the team actually work together?
 *
 * The user's complaint was "i dont see the team actually working together
 * its always just orchestrator" -- and they were right: the UI's
 * "Consulting Aero… Consulting Decibel…" checklist was a setInterval, and
 * none of the roster's prompts ever reached a model during a build.
 *
 * buildCrewTest.ts proves the REPORTING is honest (a fallback build no
 * longer looks like a successful one). This suite proves the thing under
 * the reporting: that a build really is a multi-worker pipeline with real
 * handoffs, not one call wearing five names. It drives the actual
 * runPlannedBuild with injected stub specialists, so the assertions are
 * about the real pipeline's behavior, not a mock of it.
 *
 * Decisive-gap standard (CLAUDE.md): each check is written so a
 * single-worker or fake pipeline would FAIL it -- notably, the DSP
 * Generator must be shown to actually RECEIVE the Parameter Architect's
 * output, which is the difference between collaboration and two unrelated
 * calls that happen to run in sequence.
 */
import { runPlannedBuild, PlannerWorkers } from "../src/utils/buildPlanner";
import { classifyPluginIntent } from "../src/utils/pluginSpec";
import { crewFromTrace } from "../src/utils/buildCrew";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { PluginParameter } from "../src/types";

/* The stub specialists return a REAL, gate-passing recipe rather than toy
 * DSP. That's deliberate: buildPlanner correctly throws away model output
 * that scores under the shipping floor and substitutes the deterministic
 * build, so a toy body would make every run look like a fallback and the
 * collaboration assertions below would be measuring nothing. Using genuine
 * DSP keeps the pipeline on its real success path, which is the path whose
 * handoffs this suite is about. */
const DELAY = DSP_RECIPES.find((r) => r.id === "delay")!;

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

const PROMPT = "a warm vintage tape delay";

(async () => {
  /* ---- 1. A real build runs MULTIPLE distinct specialists, and the DSP
   * worker genuinely receives the parameter worker's output. ---- */
  {
    const callOrder: string[] = [];
    // What the DSP worker was actually handed -- the crux of "collaboration".
    let dspSawParameters: PluginParameter[] | null = null;
    // A distinctively-NAMED control the Parameter Architect invents, so we
    // can prove this exact object travelled downstream rather than the DSP
    // worker independently guessing a plausible schema.
    const SIGNATURE_NAME = "Tape Wobble Depth";

    const workers: PlannerWorkers = {
      generatePluginMeta: async ({ prompt }) => {
        callOrder.push("parameters");
        check("Parameter Architect receives the user's real prompt", prompt === PROMPT, prompt);
        return {
          pluginName: "Tape Echo",
          description: "A warm tape delay with real wow and flutter.",
          reply: "Built it.",
          // Real, gate-passing schema -- with one control renamed so its
          // journey through the pipeline is traceable.
          parameters: DELAY.parameters.map((p) => (p.id === "wow" ? { ...p, name: SIGNATURE_NAME } : { ...p })),
        };
      },
      generateDspBody: async ({ parameters }) => {
        callOrder.push("dsp");
        dspSawParameters = parameters;
        return DELAY.body;
      },
    };

    const spec = classifyPluginIntent(PROMPT);
    const built = await runPlannedBuild(PROMPT, { spec, workers });

    check("more than one distinct specialist ran in a single build", new Set(callOrder).size >= 2, `called=[${callOrder}]`);
    check("they ran in pipeline order: controls designed BEFORE the DSP that uses them", callOrder.indexOf("parameters") < callOrder.indexOf("dsp"), `order=[${callOrder}]`);

    // THE handoff check. Two independent calls would fail this: the DSP
    // worker must receive the exact schema the parameter worker produced,
    // including the control it uniquely renamed.
    check(
      "the DSP Generator actually RECEIVES the Parameter Architect's schema (real handoff, not two unrelated calls)",
      !!dspSawParameters && (dspSawParameters as PluginParameter[]).some((p) => p.name === SIGNATURE_NAME),
      `dsp saw: [${(dspSawParameters as PluginParameter[] | null)?.map((p) => p.name).join(", ") ?? "nothing"}]`
    );

    // And the handoff must survive into the shipped plugin, not just the call.
    check(
      "the control named upstream survives into the finished plugin",
      built.plugin.parameters.some((p) => p.name === SIGNATURE_NAME),
      built.plugin.parameters.map((p) => p.name).join(", ")
    );

    // The deterministic gate is a real, separate stage that ran on the result.
    check("the quality gate really scored the collaborative result", typeof built.gate.scores.musicality === "number" && built.gate.scores.musicality > 0, JSON.stringify(built.gate.scores));

    /* The crew view of this same build must show the specialists as having
       genuinely contributed -- this is the link between "they collaborated"
       and "the UI says so honestly". */
    const crew = crewFromTrace(built.trace);
    const contributed = crew.filter((m) => m.status === "done" || m.status === "repaired");
    check("the crew panel reports multiple real contributors for a collaborative build", contributed.length >= 2, crew.map((m) => `${m.name}:${m.status}`).join(", "));
    check("no specialist is reported as a fallback when every worker really ran", crew.every((m) => m.status !== "fallback"), crew.map((m) => `${m.name}:${m.status}`).join(", "));
  }

  /* ---- 2. Decisive counterpart: when the specialists CANNOT run, the same
   * pipeline must be visibly different -- not silently identical, which is
   * exactly the failure the old fake timer had. ---- */
  {
    const failing: PlannerWorkers = {
      generatePluginMeta: async () => { throw new Error("model unreachable"); },
      generateDspBody: async () => { throw new Error("model unreachable"); },
    };
    const spec = classifyPluginIntent(PROMPT);
    const built = await runPlannedBuild(PROMPT, { spec, workers: failing });

    check("a build with no reachable specialists STILL produces a working plugin", built.plugin.dspFunction.length > 0);
    check("...and honestly reports that it fell back", built.usedFallback === true, `usedFallback=${built.usedFallback}`);

    const crew = crewFromTrace(built.trace);
    check(
      "the crew panel shows fallbacks, not a row of undeserved checkmarks",
      crew.some((m) => m.status === "fallback"),
      crew.map((m) => `${m.name}:${m.status}`).join(", ")
    );
  }

  /* ---- 3. The two runs above must be DISTINGUISHABLE. This is the single
   * assertion the deleted setInterval could never have passed. ---- */
  {
    const spec = classifyPluginIntent(PROMPT);
    const good = await runPlannedBuild(PROMPT, {
      spec,
      workers: {
        generatePluginMeta: async () => ({
          pluginName: "Tape Echo",
          description: "A warm tape delay with real wow and flutter.",
          reply: "Built it.",
          parameters: DELAY.parameters.map((p) => ({ ...p })),
        }),
        generateDspBody: async () => DELAY.body,
      },
    });
    const bad = await runPlannedBuild(PROMPT, {
      spec,
      workers: { generatePluginMeta: async () => { throw new Error("x"); }, generateDspBody: async () => { throw new Error("x"); } },
    });

    const sig = (t: ReturnType<typeof crewFromTrace>) => t.map((m) => m.status).join("|");
    check(
      "a collaborating build and a fallback build report DECISIVELY different crews",
      sig(crewFromTrace(good.trace)) !== sig(crewFromTrace(bad.trace)),
      `${sig(crewFromTrace(good.trace))}  vs  ${sig(crewFromTrace(bad.trace))}`
    );
    check("usedFallback distinguishes them at the pipeline level too", good.usedFallback !== bad.usedFallback, `${good.usedFallback} vs ${bad.usedFallback}`);
  }

  console.log(failures === 0 ? "\nTEAM COLLABORATION: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
