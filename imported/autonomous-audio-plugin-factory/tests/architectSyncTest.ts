/**
 * Architect sync: "Spec & Code Architect" must reflect whatever was actually
 * just built, not stay stuck on whatever it last generated itself. User:
 * "when a plug in is created the other pages should reflect what was built"
 * / "it doesnt seem like Spec & Code Architect follows".
 *
 * Decisive-gap standard: two DIFFERENT plugins must produce DIFFERENT
 * derived prompt/specs/code (today, before this fix, Architect showed the
 * SAME thing -- whatever it last generated -- regardless of which plugin was
 * actually loaded). And nothing here may be invented: every spec detail must
 * trace to a real field on the plugin, so a plugin with no evidence for a
 * given card must not get a fabricated one.
 */
import { deriveArchitectSyncFromPlugin } from "../src/utils/architectSync";
import { AudioPlugin } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const base: AudioPlugin = {
  id: "p1",
  name: "Tape Delay",
  category: "delay",
  description: "warm vintage tape delay with flutter",
  parameters: [
    { id: "time", name: "Time", min: 0, max: 2000, defaultValue: 350, unit: "ms", value: 350 } as any,
    { id: "feedback", name: "Feedback", min: 0, max: 1, defaultValue: 0.4, unit: "ratio", value: 0.4 } as any,
  ],
  dspFunction: "return inputSample * 0.5;",
  faustCode: "",
  cppJuceCode: "",
  createdAt: "2026-01-01",
  family: "delay",
  quality: { looks: 100, performance: 100, latency: 100, musicality: 98 },
  buildReport: {
    intent: "warm vintage tape delay with flutter",
    attributes: ["vintage", "tape"],
    layout: "grid",
    primaryControls: ["time", "feedback"],
    secondaryControls: [],
    compiled: true,
    scores: { looks: 100, performance: 100, latency: 100, musicality: 98 },
    audibleParams: ["time", "feedback"],
    deadParams: [],
    unstableParams: [],
    engineeringChoice: { topology: "tape_delay", rationale: "wow/flutter modeled with a modulated delay line", evidence: ["prompt said 'tape'", "prompt said 'vintage'"] },
  } as any,
};

/* ---- 1. Basic derivation carries the real prompt, specs, params, code ---- */
{
  const r = deriveArchitectSyncFromPlugin(base);
  check("prompt comes from buildReport.intent", r.prompt === "warm vintage tape delay with flutter", r.prompt);
  check("parameters carried through unchanged", r.parameters.length === 2 && r.parameters[0].id === "time");
  check("code is the plugin's actual dspFunction", r.code === base.dspFunction);
  check("at least one spec card produced", r.specs.length > 0, `${r.specs.length} cards`);
  const topoCard = r.specs.find((s) => s.title === "Family & Topology");
  check("topology card names the REAL engineering choice", !!topoCard && topoCard.details.some((d) => d.includes("tape_delay")), topoCard?.details.join(" | "));
  check("topology card carries the real evidence, not invented text", !!topoCard && topoCard.details.some((d) => d.includes("prompt said 'tape'")));
  const paramCard = r.specs.find((s) => s.title === "Parameters");
  check("parameter card lists the real controls", !!paramCard && paramCard.details.some((d) => d.startsWith("Time:")));
  const qualityCard = r.specs.find((s) => s.title === "Quality & Fitness");
  check("quality card carries the real scores", !!qualityCard && qualityCard.details.some((d) => d.includes("Musicality 98")));
}

/* ---- 2. THE decisive check: two different plugins -> different sync ---- */
{
  const other: AudioPlugin = {
    ...base,
    id: "p2",
    name: "Bit Crusher",
    category: "distortion",
    family: "distortion",
    description: "harsh digital bitcrush",
    parameters: [{ id: "bits", name: "Bit Depth", min: 1, max: 16, defaultValue: 8, unit: "bit", value: 8 } as any],
    dspFunction: "return Math.round(inputSample * 8) / 8;",
    buildReport: {
      ...(base.buildReport as any),
      intent: "harsh digital bitcrush",
      engineeringChoice: { topology: "bit_crusher", rationale: "sample-and-hold quantization for real aliasing", evidence: ["prompt said 'digital'"] },
    },
  };
  const rA = deriveArchitectSyncFromPlugin(base);
  const rB = deriveArchitectSyncFromPlugin(other);
  check("different plugins produce different prompts", rA.prompt !== rB.prompt, `"${rA.prompt}" vs "${rB.prompt}"`);
  check("different plugins produce different code", rA.code !== rB.code);
  check(
    "different plugins produce different topology evidence",
    JSON.stringify(rA.specs.find((s) => s.title === "Family & Topology")) !== JSON.stringify(rB.specs.find((s) => s.title === "Family & Topology"))
  );
}

/* ---- 3. Sparse plugin: no invented cards for evidence that doesn't exist ---- */
{
  const sparse: AudioPlugin = {
    id: "p3",
    name: "Old Save",
    category: "filter",
    description: "",
    parameters: [],
    dspFunction: "return inputSample;",
    faustCode: "",
    cppJuceCode: "",
    createdAt: "2020-01-01",
    // No family, no quality, no buildReport at all -- an old save from
    // before these fields existed.
  };
  const r = deriveArchitectSyncFromPlugin(sparse);
  check("no Quality & Fitness card when there's no evidence for it", !r.specs.some((s) => s.title === "Quality & Fitness"));
  check("no Build Evidence card when there's no evidence for it", !r.specs.some((s) => s.title === "Build Evidence"));
  check("no Parameters card when there are no parameters", !r.specs.some((s) => s.title === "Parameters"));
  check("falls back to name when there's no intent or description", r.prompt === "Old Save", r.prompt);
  const topoCard = r.specs.find((s) => s.title === "Family & Topology");
  check("topology card still renders, honestly saying it's the default", !!topoCard && topoCard.details.some((d) => /default/i.test(d)), topoCard?.details.join(" | "));
}

console.log(failures === 0 ? "\nARCHITECT SYNC: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
