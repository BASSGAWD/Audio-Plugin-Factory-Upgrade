/**
 * The build crew panel must report what ACTUALLY happened.
 *
 * The thing this replaces was a `setInterval` in App.tsx that advanced a
 * "Consulting Aero… Consulting Decibel…" checklist every 1400ms. Its defining
 * flaw was that its output was IDENTICAL whether the model did all the work,
 * some of it, or none of it -- so it wasn't reporting anything, it was
 * animating. None of those agents' prompts ever reached a model during a build.
 *
 * So the decisive gap here isn't "does it render" -- it's: does the panel's
 * content actually CHANGE with what the pipeline really did? A test that
 * passed under the old fake timer would be proving nothing, so every check
 * below is built around a real difference in outcome.
 */
import { crewFromTrace, crewSummary, CrewMember } from "../src/utils/buildCrew";
import { JobTrace } from "../src/utils/buildPlanner";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const job = (over: Partial<JobTrace> & { id: string }): JobTrace => ({
  title: "", worker: "DSP Generator", status: "passed", attempts: 1, ms: 12,
  confidence: 1, evidence: "", ...over,
});

/* A build where every model worker really produced something. */
const HEALTHY: JobTrace[] = [
  job({ id: "intent", worker: "Intent Architect", evidence: "" }),
  job({ id: "parameters", worker: "Parameter Agent", evidence: "7 controls" }),
  job({ id: "dsp_code", worker: "DSP Generator", evidence: "" }),
  job({ id: "validate", worker: "QA Agent", confidence: 1.0 }),
];

/* The very common real case: Ollama isn't serving the model, so every model
   call throws and buildPlanner's deterministic compiler covers for it. The
   OLD UI looked exactly the same as the healthy build above. */
const ALL_FALLBACK: JobTrace[] = [
  job({ id: "intent", worker: "Intent Architect", status: "fallback", evidence: "model unreachable" }),
  job({ id: "parameters", worker: "Deterministic Compiler", status: "fallback", evidence: "model unreachable" }),
  job({ id: "dsp_code", worker: "Deterministic Compiler", status: "fallback", evidence: "model unreachable" }),
  job({ id: "validate", worker: "QA Agent", confidence: 1.0 }),
];

/* ---- 1. THE decisive gap: healthy vs. all-fallback must not look alike ---- */
{
  const healthy = crewFromTrace(HEALTHY);
  const fallback = crewFromTrace(ALL_FALLBACK);

  const statuses = (c: CrewMember[]) => c.map((m) => `${m.name}:${m.status}`).join(",");
  check(
    "a healthy build and an all-fallback build produce DIFFERENT crew states",
    statuses(healthy) !== statuses(fallback),
    `healthy=[${statuses(healthy)}] fallback=[${statuses(fallback)}]`
  );
  check(
    "the summary line differs too (the old timer's did not)",
    crewSummary(healthy) !== crewSummary(fallback),
    `"${crewSummary(healthy)}" vs "${crewSummary(fallback)}"`
  );

  check(
    "healthy build: the model workers report done, not fallback",
    healthy.filter((m) => m.status === "done").length >= 3 && healthy.every((m) => m.status !== "fallback"),
    statuses(healthy)
  );
  check(
    "all-fallback build: model workers are marked fallback, NOT given checkmarks",
    fallback.filter((m) => m.status === "fallback").length === 3,
    statuses(fallback)
  );
  check(
    "all-fallback build says the deterministic compiler did it",
    /deterministic compiler/i.test(crewSummary(fallback)),
    crewSummary(fallback)
  );
}

/* ---- 2. Real per-worker detail comes from the trace, not a canned string ---- */
{
  const crew = crewFromTrace(HEALTHY);
  const haptic = crew.find((m) => m.name === "Haptic")!;
  check(
    "Haptic reports the REAL parameter count from the trace evidence",
    haptic.detail === "7 controls",
    `detail=${haptic.detail}`
  );

  // Same worker, different real evidence -> different reported detail.
  const other = crewFromTrace(HEALTHY.map((j) => (j.id === "parameters" ? { ...j, evidence: "3 controls" } : j)));
  check(
    "a different real result produces a different reported detail",
    other.find((m) => m.name === "Haptic")!.detail === "3 controls",
    "proves the detail tracks the trace rather than being hardcoded"
  );
}

/* ---- 3. The quality gate is labelled deterministic, not as an AI critic ---- */
{
  const crew = crewFromTrace(HEALTHY);
  const decibel = crew.find((m) => m.name === "Decibel")!;
  check("Decibel's job names the gate as deterministic", /deterministic/i.test(decibel.job), decibel.job);
  check("Decibel reports the real gate score", /gate 100\/100/.test(decibel.detail ?? ""), decibel.detail);
}

/* ---- 4. A repaired job is distinguishable from a clean pass ---- */
{
  const repaired = crewFromTrace(
    HEALTHY.map((j) => (j.id === "dsp_code" ? { ...j, status: "repaired" as const, attempts: 2 } : j))
  );
  const aero = repaired.find((m) => m.name === "Aero")!;
  check("a repaired job is reported as repaired, not as a clean pass", aero.status === "repaired", `status=${aero.status}`);
  check("the repair attempt count is real", /2 attempts/.test(aero.detail ?? ""), aero.detail);
}

/* ---- 5. A job the pipeline never ran is reported as skipped, not done ---- */
{
  const partial = crewFromTrace(HEALTHY.filter((j) => j.id !== "parameters"));
  const haptic = partial.find((m) => m.name === "Haptic")!;
  check("a job absent from the trace is skipped, never silently marked done", haptic.status === "skipped", `status=${haptic.status}`);
}

/* ---- 6. Nexus is not claimed as a builder it isn't ---- */
{
  const crew = crewFromTrace(HEALTHY);
  const nexus = crew.find((m) => m.agentId === "nexus");
  // Nexus owns the "intent" job only. The point is that it must not be
  // credited with jobs OTHER crew members really own -- writing the DSP
  // (Aero) or designing the controls (Haptic).
  check("Nexus is mapped to the intent job it really does", nexus?.job !== undefined && crew.filter((m) => m.agentId === "nexus").length === 1, nexus?.job);
  check(
    "Nexus is not also credited with the DSP or parameter jobs",
    crew.find((m) => m.name === "Aero")!.agentId === "aero" && crew.find((m) => m.name === "Haptic")!.agentId === "haptic",
    "those jobs belong to their own owners"
  );
}

console.log(failures === 0 ? "\nBUILD CREW: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
