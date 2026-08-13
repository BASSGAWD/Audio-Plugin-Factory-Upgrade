/**
 * Feature depth — the measurement that separates a COMPLETE plugin from a
 * minimal one.
 *
 * Functional fitness already asks "does this build do its family's job?"
 * A 3-knob compressor passes that: it compresses. But it has no attack and
 * no release, the two controls that most define how a compressor sounds, so
 * it still feels like a toy. Nothing measured that, so nothing pushed
 * against it — the recipe library averaged 3.9 controls per plugin and every
 * single recipe carried ZERO of its family's advanced controls.
 *
 * These checks prove the measurement is meaningful rather than a knob
 * counter: a real unit must beat a stripped one, the tiers must be weighted
 * so missing a CORE control hurts more than missing a nice-to-have, and
 * padding a plugin with unrelated knobs must NOT raise the score.
 */
import { measureFeatureDepth, formatManifestForPrompt, FEATURE_MANIFEST } from "../src/utils/featureManifest";
import { runQualityGate } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { refinementScore } from "../src/utils/refinementLoop";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, name = id): PluginParameter =>
  ({ id, name, min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "" } as PluginParameter);

/* ---- 1. A real unit beats a stripped one ---- */
{
  const stripped = measureFeatureDepth([P("threshold"), P("ratio"), P("makeup")], "dynamics")!;
  const real = measureFeatureDepth(
    [P("threshold"), P("ratio"), P("attack"), P("release"), P("knee"), P("makeup"), P("mix")],
    "dynamics"
  )!;
  check("dynamics: a full compressor scores high", real.score > 85, `${real.score}/100`);
  check("dynamics: the old 3-knob build scores far lower", stripped.score < real.score - 30, `stripped=${stripped.score} vs real=${real.score}`);
  check("dynamics: names the specific missing controls", stripped.missing.expected.includes("Attack") && stripped.missing.expected.includes("Release"), stripped.evidence);
}

/* ---- 2. Tier weighting: missing a CORE control must hurt more than
   missing an ADVANCED one -- otherwise the score is just a knob count. ---- */
{
  const full = ["cutoff", "resonance", "drive", "mix", "mode", "envAmount"];
  const noCore = measureFeatureDepth(full.filter((i) => i !== "cutoff").map((i) => P(i)), "filter")!;
  const noAdvanced = measureFeatureDepth(full.filter((i) => i !== "mode").map((i) => P(i)), "filter")!;
  check("filter: dropping a CORE control costs more than an ADVANCED one", noCore.score < noAdvanced.score - 10, `noCore=${noCore.score} vs noAdvanced=${noAdvanced.score}`);
}

/* ---- 3. Knob-spam does NOT raise the score. The manifest measures the
   family's real vocabulary, not parameter count. ---- */
{
  const honest = measureFeatureDepth([P("cutoff"), P("resonance"), P("drive"), P("mix")], "filter")!;
  const padded = measureFeatureDepth(
    [P("cutoff"), P("resonance"), P("drive"), P("mix"), P("wobble1"), P("wobble2"), P("wobble3"), P("sparkle"), P("vibe")],
    "filter"
  )!;
  check("filter: padding with unrelated knobs does not raise depth", padded.score === honest.score, `padded=${padded.score} honest=${honest.score} (5 extra knobs)`);
}

/* ---- 4. Alternate naming is recognized (a model writing "atk"/"rel"
   shouldn't be scored as if the controls were absent). ---- */
{
  const aliased = measureFeatureDepth([P("threshold"), P("ratio"), P("atk", "Atk"), P("rel", "Rel"), P("make_up", "Make Up")], "dynamics")!;
  check("dynamics: recognizes atk/rel/make_up aliases", aliased.present.expected.length === 3, `present=${aliased.present.expected.join(",")}`);
}

/* ---- 5. Families with no manifest return null, not a fake zero -- an
   unmeasured family must never be penalized as if it scored badly. ---- */
{
  check("utility has no manifest -> null, not 0", measureFeatureDepth([P("gain")], "utility") === null);
  check("null family -> null", measureFeatureDepth([P("gain")], null) === null);
}

/* ---- 6. Every manifest entry carries a real one-sentence purpose. This is
   what the auto-generated manual renders, so an empty or stub purpose is a
   silent documentation hole. ---- */
{
  let bad: string[] = [];
  for (const [family, specs] of Object.entries(FEATURE_MANIFEST)) {
    for (const s of specs || []) {
      if (!s.purpose || s.purpose.length < 25 || !/[.!]$/.test(s.purpose)) bad.push(`${family}.${s.id}`);
    }
  }
  check("every manifest control has a complete purpose sentence", bad.length === 0, bad.join(", ") || "all documented");
}

/* ---- 7. The prompt text actually names the family's controls ---- */
{
  const text = formatManifestForPrompt("dynamics");
  check("prompt vocabulary names attack and release", /attack/i.test(text) && /release/i.test(text));
  check("prompt vocabulary warns against dead knobs", /dead knobs|genuinely affect/i.test(text));
  check("prompt vocabulary is empty for an unmanifested family", formatManifestForPrompt("utility") === "");
}

/* ---- 8. The shipped recipes actually satisfy their own manifests. This is
   the regression guard: it's what stops the library drifting back toward
   3-knob builds. ---- */
{
  const RECIPE_FAMILY: Record<string, string> = {
    reverb: "reverb", delay: "delay", modulation: "modulation", dynamics: "dynamics",
    eq: "eq", filter: "filter", distortion: "distortion", pitch: "pitch", synth: "synthesizer",
  };
  let total = 0, n = 0;
  const thin: string[] = [];
  for (const r of DSP_RECIPES) {
    const fam = RECIPE_FAMILY[r.id];
    if (!fam) continue;
    const params = r.parameters.map((p: any) => ({ ...p, value: p.defaultValue })) as PluginParameter[];
    const d = measureFeatureDepth(params, fam as any);
    if (!d) continue;
    total += d.score;
    n++;
    // Every recipe must at least carry its family's CORE vocabulary.
    if (d.missing.required.length > 0) thin.push(`${r.id} missing core: ${d.missing.required.join(",")}`);
  }
  check("every recipe carries its family's core controls", thin.length === 0, thin.join("; ") || "all complete");
  const mean = total / n;
  check("recipe library mean depth stays >= 78", mean >= 78, `mean=${mean.toFixed(1)}/100 across ${n} recipes`);
}

/* ---- 9. Depth ranks candidates without ever outranking correctness: a
   feature-rich build should beat a thin one, but a BROKEN rich build must
   still lose to a correct thin one. ---- */
{
  const mk = (recipeId: string): AudioPlugin => {
    const r = DSP_RECIPES.find((x) => x.id === recipeId)!;
    return {
      id: "t", name: r.id, category: "dynamics", description: "",
      parameters: r.parameters.map((p: any) => ({ ...p, value: p.defaultValue })),
      dspFunction: r.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
  };
  const rich = mk("dynamics");
  const thin: AudioPlugin = {
    ...rich,
    parameters: rich.parameters.filter((p) => ["threshold", "ratio", "makeup"].includes(p.id)),
  };
  const gRich = runQualityGate(rich, { family: "dynamics", prompt: "compressor" });
  const gThin = runQualityGate(thin, { family: "dynamics", prompt: "compressor" });
  check("gate reports featureDepth on the build report", typeof gRich.report.featureDepth?.score === "number", `${gRich.report.featureDepth?.score}`);
  check("richer build outranks the thin one in refinementScore", refinementScore(gRich) > refinementScore(gThin), `rich=${refinementScore(gRich).toFixed(1)} thin=${refinementScore(gThin).toFixed(1)}`);

  // A silent (broken) but feature-rich build must NOT beat a correct one.
  const brokenRich: AudioPlugin = { ...rich, dspFunction: "return 0;" };
  const gBroken = runQualityGate(brokenRich, { family: "dynamics", prompt: "compressor" });
  check("a BROKEN feature-rich build still loses to a correct thin one", refinementScore(gBroken) < refinementScore(gThin), `broken=${refinementScore(gBroken).toFixed(1)} thin=${refinementScore(gThin).toFixed(1)}`);
}

console.log(failures === 0 ? "\nFEATURE DEPTH: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
