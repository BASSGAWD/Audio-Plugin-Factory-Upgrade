/**
 * Reference deviation — "does this novel build behave like a known-good
 * member of its family?"
 *
 * A candidate and its family's GOLDEN RECIPE (dspRecipes.ts) are run through
 * the SAME probe signals -- spectral shape on broadband noise, envelope
 * shape on an input-then-silence probe, plus a family-specific axis
 * (level-dependent gain for dynamics, harmonic generation for distortion/
 * saturator/amp_sim, tail persistence for reverb) -- and compared. This
 * catches classes of structural wrongness no single named-parameter check
 * can: a build that "doesn't look like a compressor at all" even though
 * every individual knob passed its own audibility/semantics test.
 *
 * Per project convention: measure the honest implementation AND a
 * deliberately broken counterpart, assert a DECISIVE gap -- and additionally
 * prove the measurement does NOT punish legitimate family diversity, using
 * this project's own alternate topologies (dspTopologies.ts) as real,
 * shipping "different but valid" designs. Relationships and gaps only, never
 * brittle absolute constants -- a concurrent agent is reworking the DSP
 * bodies these numbers come from.
 */
import { measureReferenceDeviation, runQualityGate } from "../src/utils/qualityGate";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ */
/* 1. Every golden recipe matches ITSELF perfectly (0 deviation)        */
/* ------------------------------------------------------------------ */
{
  // This loop's premise only holds for a recipe that IS its family's
  // designated golden reference (REFERENCE_RECIPE_ID_FOR_FAMILY in
  // qualityGate.ts) -- id-as-family only works because, for those recipes,
  // id and family happen to be the same string. tremolo, phaser, and
  // spectral_gate are real DSP_RECIPES entries within the "modulation"
  // family, but chorus (recipe id "modulation") remains the family's sole
  // golden reference, so none of "tremolo"/"phaser"/"spectral_gate" is a
  // valid PluginFamily and comparing e.g. tremolo's body against
  // ITSELF-as-"modulation" would actually compare it against chorus --
  // correctly nonzero deviation, not a bug. Covered instead by
  // recipeTest.ts (stability/audibility across the full param range) and
  // the tremolo-vs-chorus mechanism test there.
  const notAFamilyGoldenReference = new Set(["tremolo", "phaser", "spectral_gate"]);
  for (const r of DSP_RECIPES) {
    if (notAFamilyGoldenReference.has(r.id)) continue;
    const family = r.id === "synth" ? "synthesizer" : (r.id as any);
    const d = measureReferenceDeviation(r.body, r.parameters as PluginParameter[], family);
    check(`${r.id}: matches itself with zero deviation`, !!d && d.deviation === 0 && d.score === 100, d ? `dev=${d.deviation} score=${d.score}` : "null");
  }
}

/* ------------------------------------------------------------------ */
/* 2. Composite / no-single-reference families return null, not a fake  */
/*    comparison against an arbitrary single-stage recipe               */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  check("multiband_saturator has no single reference -> null", measureReferenceDeviation(golden.body, golden.parameters as PluginParameter[], "multiband_saturator") === null);
  check("hybrid_other has no single reference -> null", measureReferenceDeviation(golden.body, golden.parameters as PluginParameter[], "hybrid_other") === null);
  check("utility has no single reference -> null", measureReferenceDeviation(golden.body, golden.parameters as PluginParameter[], "utility") === null);
  check("null family -> null", measureReferenceDeviation(golden.body, golden.parameters as PluginParameter[], null) === null);
}

/* ------------------------------------------------------------------ */
/* 3. Legitimate alternate topologies are NOT punished as "broken"      */
/* ------------------------------------------------------------------ */
{
  let worstLegit = 100;
  let worstId = "";
  for (const t of DSP_TOPOLOGIES) {
    const d = measureReferenceDeviation(t.body, t.parameters as PluginParameter[], t.family);
    check(`${t.id}: a legitimate alternate topology measures`, !!d, "null");
    if (d && d.score < worstLegit) { worstLegit = d.score; worstId = t.id; }
    // A real, shipping, gate-verified design must never read as "shares
    // essentially nothing" with its own family's reference.
    check(`${t.id}: legitimate diversity stays well above the floor`, !!d && d.score >= 60, d ? `score=${d.score}` : "null");
  }
  console.log(`(worst legitimate topology: ${worstId} at ${worstLegit})`);
}

/* ------------------------------------------------------------------ */
/* 4. Deliberately broken counterparts (per family) score decisively    */
/*    lower than EVERY legitimate topology of that family                */
/* ------------------------------------------------------------------ */
function worstLegitScoreFor(family: string): number {
  const scores = DSP_TOPOLOGIES.filter((t) => t.family === family).map(
    (t) => measureReferenceDeviation(t.body, t.parameters as PluginParameter[], t.family)?.score ?? 100
  );
  return scores.length > 0 ? Math.min(...scores) : 100;
}

{
  // Dynamics: a passthrough that ignores threshold/ratio/attack/release entirely.
  const dynGolden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  const brokenDyn = measureReferenceDeviation("return inputSample;", dynGolden.parameters as PluginParameter[], "dynamics");
  const dynFloor = worstLegitScoreFor("dynamics");
  check(
    "dynamics: an inert passthrough scores decisively below every legitimate compressor topology",
    !!brokenDyn && brokenDyn.score < dynFloor - 10,
    `broken=${brokenDyn?.score} worst-legit=${dynFloor}`
  );

  // Reverb: a near-instant blip with no real tail.
  const revGolden = DSP_RECIPES.find((r) => r.id === "reverb")!;
  const brokenReverbBody = `if (!state.init) { state.b = new Float32Array(64); state.p = 0; state.init = true; }
let wet = state.b[state.p] * 0.1;
state.b[state.p] = inputSample;
state.p = (state.p + 1) % 64;
return inputSample * 0.7 + wet * 0.3;`;
  const brokenRev = measureReferenceDeviation(brokenReverbBody, revGolden.parameters as PluginParameter[], "reverb");
  const revFloor = worstLegitScoreFor("reverb");
  check(
    "reverb: a near-instant blip scores decisively below every legitimate reverb topology",
    !!brokenRev && brokenRev.score < revFloor - 10,
    `broken=${brokenRev?.score} worst-legit=${revFloor}`
  );

  // Distortion: a clean gain stage that adds no harmonics at all.
  const distGolden = DSP_RECIPES.find((r) => r.id === "distortion")!;
  const brokenDistBody = `let drive = params.drive !== undefined ? params.drive : 8;
let mix = params.mix !== undefined ? params.mix : 1;
return inputSample * (0.9 + 0.0001 * (drive + mix));`;
  const brokenDist = measureReferenceDeviation(brokenDistBody, distGolden.parameters as PluginParameter[], "distortion");
  const distFloor = worstLegitScoreFor("distortion");
  check(
    "distortion: a clean gain stage scores decisively below every legitimate distortion topology",
    !!brokenDist && brokenDist.score < distFloor - 10,
    `broken=${brokenDist?.score} worst-legit=${distFloor}`
  );

  // Delay: no legitimate alternate topology of the SAME comb-delay
  // structure exists in the bank beyond delay_tape/delay_digital, but the
  // golden-vs-passthrough gap alone is decisive.
  const delayGolden = DSP_RECIPES.find((r) => r.id === "delay")!;
  const honestDelay = measureReferenceDeviation(delayGolden.body, delayGolden.parameters as PluginParameter[], "delay");
  const brokenDelay = measureReferenceDeviation("return inputSample;", delayGolden.parameters as PluginParameter[], "delay");
  check(
    "delay: an inert passthrough scores decisively below the golden reference itself",
    !!honestDelay && !!brokenDelay && brokenDelay.score < honestDelay.score - 25,
    `broken=${brokenDelay?.score} golden=${honestDelay?.score}`
  );

  // Filter: same shape of check -- no bank alternates for this family, so
  // compare directly against the golden recipe's own perfect self-match.
  const filterGolden = DSP_RECIPES.find((r) => r.id === "filter")!;
  const honestFilter = measureReferenceDeviation(filterGolden.body, filterGolden.parameters as PluginParameter[], "filter");
  const brokenFilterBody = `let mix = params.mix !== undefined ? params.mix : 1;
return inputSample;`;
  const brokenFilter = measureReferenceDeviation(brokenFilterBody, filterGolden.parameters as PluginParameter[], "filter");
  check(
    "filter: a passthrough that never filters scores decisively below the golden reference",
    !!honestFilter && !!brokenFilter && brokenFilter.score < honestFilter.score - 25,
    `broken=${brokenFilter?.score} golden=${honestFilter?.score}`
  );
}

/* ------------------------------------------------------------------ */
/* 5. Family-specific axes are gated to the families they're valid for  */
/* ------------------------------------------------------------------ */
{
  // A fuzz-style distortion's dramatically level-sensitive gain curve is
  // its CHARACTER, not a defect -- the level-dependent-gain axis must be
  // dynamics-only, or a legitimate, gate-verified fuzz topology would read
  // as "broken" for having strong fuzz character.
  const fuzz = DSP_TOPOLOGIES.find((t) => t.id === "dist_fuzz");
  if (fuzz) {
    const d = measureReferenceDeviation(fuzz.body, fuzz.parameters as PluginParameter[], "distortion");
    check("a legitimate fuzz topology is not penalized for its level-sensitive character", !!d && d.score >= 60, d ? `score=${d.score} — ${d.evidence}` : "null");
    check("the level-dependent-gain axis is absent from a distortion evidence string", !!d && !/level-gain/.test(d.evidence), d?.evidence);
  }
  // Symmetrically: a mastering/lookahead compressor's evidence should carry
  // the level-gain axis (it's the one family it applies to).
  const lookahead = DSP_TOPOLOGIES.find((t) => t.id === "comp_lookahead_master");
  if (lookahead) {
    const d = measureReferenceDeviation(lookahead.body, lookahead.parameters as PluginParameter[], "dynamics");
    check("dynamics evidence carries the level-dependent-gain axis", !!d && /level-gain/.test(d.evidence), d?.evidence);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Robustness: never crashes, never fabricates a comparison           */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  const broken = measureReferenceDeviation("this is not valid javascript {{{", golden.parameters as PluginParameter[], "dynamics");
  check("returns null for code that doesn't compile", broken === null);

  // The dynamics golden recipe is always audible on the noise probe, so a
  // silent candidate hits the "one silent, one not" branch, not "both
  // silent" -- correctly the starkest possible mismatch, not a trivial match.
  const oneSilent = measureReferenceDeviation("return 0;", golden.parameters as PluginParameter[], "dynamics");
  check("a silent candidate against an audible reference scores at the floor, not a trivial match", !!oneSilent && oneSilent.score === 0 && oneSilent.deviation === 2, oneSilent ? JSON.stringify(oneSilent) : "null");

  // Deviation must never exceed the documented 0..2 range regardless of how
  // pathological the candidate is.
  const wild = measureReferenceDeviation(
    `let acc = 0; for (let k = 0; k < 500; k++) acc += Math.sin(inputSample * k); return Math.tanh(acc);`,
    golden.parameters as PluginParameter[],
    "dynamics"
  );
  check("deviation is always clamped to the documented 0..2 range", !!wild && wild.deviation >= 0 && wild.deviation <= 2, wild ? String(wild.deviation) : "null");
}

/* ------------------------------------------------------------------ */
/* 7. Full-gate integration                                             */
/* ------------------------------------------------------------------ */
{
  const golden = DSP_RECIPES.find((r) => r.id === "dynamics")!;
  const plugin: AudioPlugin = {
    id: "t", name: "t", category: "dynamics", description: "",
    parameters: (golden.parameters as PluginParameter[]).map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: golden.body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const gate = runQualityGate(plugin, { family: "dynamics", prompt: "test compressor" });
  check("build report carries referenceDeviation", !!gate.report.referenceDeviation, JSON.stringify(gate.report.referenceDeviation));
  check("the golden recipe matches its own reference with a perfect score", gate.report.referenceDeviation?.score === 100, String(gate.report.referenceDeviation?.score));
  check("referenceDeviation note appears in the build transcript", gate.notes.some((n) => /Reference deviation/.test(n)));

  // Composite family: must be entirely absent, not present-with-nonsense.
  const composite: AudioPlugin = { ...plugin, category: "distortion" };
  const compositeGate = runQualityGate(composite, { family: "multiband_saturator", prompt: "test" });
  check("a composite family carries no referenceDeviation on the build report", compositeGate.report.referenceDeviation === undefined);

  // Never touches any headline dimension.
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  check("headline floor unaffected by reference deviation (informational only)", min >= 97, `min=${min}`);
}

console.log(failures === 0 ? "\nREFERENCE DEVIATION: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
