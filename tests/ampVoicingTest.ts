/**
 * Real guitar-amp head/cab switching:
 *
 *  1. Every "amp" build has real headType/cabType select params (not just
 *     the cosmetic amp_head_auto/cabinet_auto faceplate swatches), and
 *     ships at the >= 97 floor with zero defects.
 *  2. voicingDifferentiation proves the DSP actually branches per choice --
 *     the decisive-gap pattern: a genuinely wired selector scores high, a
 *     selector that exists as a param but is never read by the DSP body
 *     (the exact "cosmetic label over one fixed circuit" bug this track
 *     fixes) scores ~0. A measurement that scores both the same would not
 *     be measuring anything (see CLAUDE.md's verification standard).
 *  3. editPass.ts's new additive primitive: "add another cabinet option"
 *     extends the existing plugin in place (same id, existing choices and
 *     every other param untouched, one new branch appended) instead of
 *     forcing a full rebuild for a one-word request.
 */
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate, measureVoicingDifferentiation } from "../src/utils/qualityGate";
import { runEditPass, pickVoicingExtension, extendVoicingOption } from "../src/utils/editPass";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function gated(prompt: string): { plugin: AudioPlugin; gate: ReturnType<typeof runQualityGate> } {
  const b = buildOfflinePlugin(prompt);
  const plugin: AudioPlugin = {
    id: "t", name: b.name, category: b.category, description: b.description,
    parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const gate = runQualityGate(plugin, { family: b.family, prompt });
  return { plugin: gate.plugin, gate };
}
const minScore = (g: { scores: { looks: number; performance: number; latency: number; musicality: number } }) =>
  Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);

(async () => {
  /* ---- 1. Real head/cab select params, gate-clean ---- */
  const { plugin: amp, gate } = gated("a crunchy vintage guitar amp with drive, tone, and level controls");
  const head = amp.parameters.find((p) => p.id === "headType");
  const cab = amp.parameters.find((p) => p.id === "cabType");
  check("amp build has a real headType select param", !!head && head.controlType === "select");
  check("amp build has a real cabType select param", !!cab && cab.controlType === "select");
  check("headType choices match its min..max span", !!head && head.choices?.length === head.max - head.min + 1, JSON.stringify(head?.choices));
  check("cabType choices match its min..max span", !!cab && cab.choices?.length === cab.max - cab.min + 1, JSON.stringify(cab?.choices));
  check("amp DSP body actually reads headType/cabType", amp.dspFunction.includes("params.headType") && amp.dspFunction.includes("params.cabType"));
  const defects = gate.report.deadParams.length + gate.report.unstableParams.length + (gate.report.semanticViolations?.length ?? 0);
  check("amp ships at the floor with zero defects", minScore(gate) >= 97 && defects === 0, `min=${minScore(gate)} defects=${defects}`);

  /* ---- 2. voicingDifferentiation: the decisive gap ---- */
  check("report carries a voicingDifferentiation entry for headType and cabType", (gate.report.voicingDifferentiation?.length ?? 0) === 2);
  const headDiff = gate.report.voicingDifferentiation?.find((v) => v.metric.includes("Amp Voicing"));
  const cabDiff = gate.report.voicingDifferentiation?.find((v) => v.metric.includes("Cabinet"));
  check("real headType branching scores decisively high", !!headDiff && headDiff.score >= 60, `score=${headDiff?.score}`);
  check("real cabType branching scores decisively high", !!cabDiff && cabDiff.score >= 60, `score=${cabDiff?.score}`);

  // The counterpart: a selector that EXISTS as a param (so it isn't caught
  // merely by featureManifest's presence check) but the DSP body never
  // reads -- the exact "cosmetic label over one fixed circuit" bug this
  // whole track exists to fix. Built by stripping every `params.headType`
  // read out of the real, working amp DSP (so it's otherwise identical --
  // this isn't a different, coincidentally-quieter plugin).
  const brokenBody = amp.dspFunction.replace(/params\.headType\s*!==\s*undefined\s*\?\s*params\.headType\s*:\s*1/, "1");
  check("setup: the broken fixture actually removed every real read", !brokenBody.includes("params.headType"));
  const brokenDiff = measureVoicingDifferentiation(brokenBody, amp.parameters, "headType");
  check(
    "a selector the DSP never reads scores ~0 -- not the same score as a real one",
    !!brokenDiff && brokenDiff.score <= 5 && (headDiff?.score ?? 0) - brokenDiff.score >= 55,
    `broken=${brokenDiff?.score} real=${headDiff?.score}`
  );

  /* ---- 3. Additive edit: "add another cabinet option" extends in place ---- */
  const beforeMax = cab!.max;
  const beforeChoices = [...(cab!.choices ?? [])];
  const editResult = await runEditPass(amp, { prompt: "add another cabinet option" });
  const editedCab = editResult.plugin.parameters.find((p) => p.id === "cabType");
  check(
    "edit: cabType gains exactly one more step",
    !!editedCab && editedCab.max === beforeMax + 1,
    `before=${beforeMax} after=${editedCab?.max}`
  );
  check(
    "edit: the new choice is appended, old choices untouched",
    !!editedCab && editedCab.choices?.length === beforeChoices.length + 1 && beforeChoices.every((c, i) => editedCab.choices![i] === c),
    JSON.stringify(editedCab?.choices)
  );
  check("edit: every original param id survives", amp.parameters.every((p) => editResult.plugin.parameters.some((q) => q.id === p.id)));
  check("edit: same plugin identity (additive, not a rebuild)", editResult.plugin.id === amp.id && editResult.plugin.name === amp.name);
  check("edit: still ships at the floor after extension", minScore(editResult.gate) >= 97, `min=${minScore(editResult.gate)}`);
  check("edit: change is reported honestly", editResult.changes.some((c) => /cabinet/i.test(c)));

  /* ---- 4. Same for "add another amp channel" (headType) ---- */
  const headEditResult = await runEditPass(amp, { prompt: "add another amp channel option" });
  const editedHead = headEditResult.plugin.parameters.find((p) => p.id === "headType");
  check(
    "edit: headType gains exactly one more step for the equivalent request",
    !!editedHead && editedHead.max === head!.max + 1,
    `before=${head!.max} after=${editedHead?.max}`
  );

  /* ---- 5. Doesn't misfire on a plugin with no headType/cabType at all ---- */
  const delayBuild = buildOfflinePlugin("a warm tape delay");
  check(
    "a non-amp plugin's headType/cabType-less params never trigger this primitive",
    pickVoicingExtension("add another cabinet option", delayBuild.parameters) === null
  );
  check(
    "extendVoicingOption itself refuses when the target param is absent",
    extendVoicingOption(delayBuild.dspFunction, delayBuild.parameters, "cab") === null
  );

  console.log(failures === 0 ? "\nAMP VOICING: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
