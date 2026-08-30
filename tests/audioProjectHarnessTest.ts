import assert from "node:assert/strict";
import {
  AUDIO_SOFTWARE_PROJECT_VERSION,
  classifyAudioSoftwarePrompt, compileAudioSoftwareProject, normalizeAudioSoftwareProjectCandidate,
  reviseAudioSoftwareProject, validateAudioSoftwareProject, type AudioProjectKind,
} from "../src/audioProjects";

const prompts: Record<AudioProjectKind, string> = {
  effect: "Build a chorus effect processor",
  instrument: "Build a MIDI synthesizer instrument",
  sampler: "Build an MPC drum pad sampler",
  sequencer: "Build a sixteen step sequencer",
  mixer: "Build a console mixer with buses",
  mastering: "Build a mastering limiter chain",
  utility: "Build an audio meter utility",
  daw: "Build a multitrack DAW workstation",
};
for (const [kind, prompt] of Object.entries(prompts) as [AudioProjectKind, string][]) {
  const result = compileAudioSoftwareProject(prompt);
  assert.equal(result.project.kind, kind);
  assert.equal(validateAudioSoftwareProject(result.project).valid, true);
  assert.ok(result.project.codeAssets[0].source.includes("createModel"));
  assert.ok(result.project.brief.targets.some(target => target.target === "browser" && target.supported && target.stage === "emitted"));
  assert.ok(result.project.codeAssets.some(asset => asset.id === result.project.preview.entryAssetId));
  for (const id of Object.keys(result.project.brief.uiRoles)) assert.ok(result.project.brief.controls.some(control => control.id === id));
}
const classified = classifyAudioSoftwarePrompt("Need a master bus mastering limiter");
assert.equal(classified.kind, "mastering");
assert.ok(classified.confidence > .6 && classified.matched.includes("mastering"));
const adapted = compileAudioSoftwareProject(prompts.effect, { id: "legacy", name: "Legacy", parameters: [], dspFunction: "return inputSample;" });
assert.equal(adapted.project.kind, "effect");
assert.equal(adapted.adaptedLegacyPlugin, true);
if (adapted.project.kind !== "effect") throw new Error("Expected adapted effect project");
const adaptedEffect = adapted.project;
assert.equal(adaptedEffect.codeAssets.some(asset => asset.id === adaptedEffect.processor.dspAssetId), true);
assert.equal(compileAudioSoftwareProject(prompts.mixer).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
assert.equal(compileAudioSoftwareProject(prompts.sequencer).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
assert.equal(compileAudioSoftwareProject(prompts.sampler).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
assert.equal(compileAudioSoftwareProject(prompts.utility).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
// The exportable kinds now default to "Browser prototype is enough", so the
// vst3 target starts unsupported/not-selected. Selecting the export decision
// flips it to an exportable scaffold target (covered in the export decision
// tests in audioProjectTruthfulnessTest).
assert.equal(compileAudioSoftwareProject(prompts.instrument).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
assert.equal(compileAudioSoftwareProject(prompts.effect).project.brief.targets.find(target => target.target === "vst3")?.stage, "unsupported");
assert.equal(compileAudioSoftwareProject(prompts.mastering).project.brief.targets.find(target => target.target === "vst3")?.supported, false);
assert.equal(compileAudioSoftwareProject(prompts.effect).project.id, compileAudioSoftwareProject(prompts.effect).project.id);
assert.notEqual(compileAudioSoftwareProject(prompts.effect).project.id, compileAudioSoftwareProject("Build a delay effect processor").project.id);
assert.equal(classifyAudioSoftwarePrompt("Build a synth, not a sampler").kind, "instrument");
const golden = compileAudioSoftwareProject(prompts.sampler).project;
const roundTrip = normalizeAudioSoftwareProjectCandidate(JSON.parse(JSON.stringify(golden)));
assert.equal(roundTrip.validation.valid, true);
const migrated = normalizeAudioSoftwareProjectCandidate({ ...golden, version: 1 });
assert.equal(migrated.project?.version, AUDIO_SOFTWARE_PROJECT_VERSION);
// A project persisted at 1.0 without the v1.1 fields still loads (persistence-safe normalization).
const legacyPersisted = JSON.parse(JSON.stringify(golden));
legacyPersisted.version = "1.0";
delete legacyPersisted.brief.goal;
delete legacyPersisted.brief.summary;
delete legacyPersisted.preview.fidelity;
const restored = normalizeAudioSoftwareProjectCandidate(legacyPersisted);
assert.equal(restored.validation.valid, true, restored.validation.issues.join("; "));
assert.equal(restored.project?.version, AUDIO_SOFTWARE_PROJECT_VERSION);
assert.equal(typeof restored.project?.brief.goal, "string");
assert.ok(Array.isArray(restored.project?.brief.summary.proven));
const brokenSampler = JSON.parse(JSON.stringify(golden)); brokenSampler.assets[1].distinctFingerprint = brokenSampler.assets[0].distinctFingerprint;
assert.equal(normalizeAudioSoftwareProjectCandidate(brokenSampler).validation.valid, false);
const brokenInstrument = compileAudioSoftwareProject(prompts.instrument).project; if (brokenInstrument.kind === "instrument") brokenInstrument.midi.noteRange = [80, 40];
assert.equal(validateAudioSoftwareProject(brokenInstrument).valid, false);
const brokenSequencer = compileAudioSoftwareProject(prompts.sequencer).project; if (brokenSequencer.kind === "sequencer") brokenSequencer.sequence.events[0].step = 99;
assert.equal(validateAudioSoftwareProject(brokenSequencer).valid, false);
const brokenMixer = compileAudioSoftwareProject(prompts.mixer).project; if (brokenMixer.kind === "mixer") brokenMixer.mixer.channels[0].busId = "missing";
assert.equal(validateAudioSoftwareProject(brokenMixer).valid, false);
const brokenMaster = compileAudioSoftwareProject(prompts.mastering).project; if (brokenMaster.kind === "mastering") brokenMaster.chain.pop();
assert.equal(validateAudioSoftwareProject(brokenMaster).valid, false);
const brokenUtility = compileAudioSoftwareProject(prompts.utility).project; if (brokenUtility.kind === "utility") brokenUtility.analyzer.ballisticsMs = 0;
assert.equal(validateAudioSoftwareProject(brokenUtility).valid, false);
assert.match(compileAudioSoftwareProject(prompts.utility).project.limitations.join(" "), /no truthful VST3 target/i);

// --- DAW starting point ---
const dawResult = compileAudioSoftwareProject(prompts.daw);
assert.equal(dawResult.project.kind, "daw");
assert.equal(validateAudioSoftwareProject(dawResult.project).valid, true);
assert.equal(dawResult.project.preview.model, "browser-workstation");
assert.equal(dawResult.project.preview.fidelity, "browser-workstation");
assert.equal(dawResult.project.brief.targets.find(t => t.target === "vst3")?.supported, false);
if (dawResult.project.kind === "daw") assert.ok(dawResult.project.workstation.buses.some(b => b.kind === "master"));

// --- Truthful preview fidelity mapping ---
assert.equal(compileAudioSoftwareProject(prompts.effect).project.preview.fidelity, "processor-audition");
assert.equal(compileAudioSoftwareProject(prompts.mastering).project.preview.fidelity, "processor-audition");
assert.equal(compileAudioSoftwareProject(prompts.instrument).project.preview.fidelity, "processor-audition");
assert.equal(compileAudioSoftwareProject(prompts.sampler).project.preview.fidelity, "focused-simulation");
assert.equal(compileAudioSoftwareProject(prompts.mixer).project.preview.fidelity, "focused-simulation");
// A project may not lie about fidelity.
const fakeFidelity = compileAudioSoftwareProject(prompts.mixer).project;
fakeFidelity.preview.fidelity = "processor-audition";
assert.equal(validateAudioSoftwareProject(fakeFidelity).valid, false);

// --- Capability summary: understood / changed / proven / conceptual / unsupported ---
const summary = compileAudioSoftwareProject(prompts.utility).project.brief.summary;
assert.ok(summary.understood.length > 0);
assert.ok(summary.proven.length > 0);
assert.ok(summary.conceptual.some(c => /preview/i.test(c)));
assert.ok(summary.unsupported.some(u => /native|vst3|export/i.test(u)));
// A project without VST3 that fails to disclose it under unsupported is invalid.
const hidesUnsupported = compileAudioSoftwareProject(prompts.mixer).project;
hidesUnsupported.brief.summary.unsupported = [];
assert.equal(validateAudioSoftwareProject(hidesUnsupported).valid, false);
// A summary may not claim a compiled binary that does not exist.
const liesNative = compileAudioSoftwareProject(prompts.effect).project;
liesNative.brief.summary.proven.push("Compiled binary produced and installed");
assert.equal(validateAudioSoftwareProject(liesNative).valid, false);

// --- Ambiguity and guided questions ---
const ambiguous = classifyAudioSoftwarePrompt("Build a mixer that is also a mastering limiter chain");
assert.equal(ambiguous.ambiguous, true);
assert.ok(ambiguous.questions.length > 0);
assert.ok(ambiguous.alternatives.length > 0);
assert.ok(ambiguous.questions[0].options.length >= 2);
// A clear prompt raises no confirmation question.
assert.equal(classifyAudioSoftwarePrompt(prompts.effect).ambiguous, false);
// An unreadable prompt asks the requester to pick a starting point.
const vague = classifyAudioSoftwarePrompt("do the thing please");
assert.ok(vague.questions.some(q => q.id === "pick-starting-point"));
// A plain-language goal infers a starting point instead of failing.
assert.equal(classifyAudioSoftwarePrompt("I want to make it loud and ready for release").kind, "mastering");

// --- Revising a category without losing validated evidence ---
const original = compileAudioSoftwareProject(prompts.utility).project;
const provenBefore = original.brief.evidence.filter(e => e.pass && (e.grade === "measured" || e.grade === "static")).length;
assert.ok(provenBefore > 0);
const revised = reviseAudioSoftwareProject(original, "effect");
assert.equal(revised.result.project.kind, "effect");
assert.equal(validateAudioSoftwareProject(revised.result.project).valid, true);
assert.equal(revised.revision.fromKind, "utility");
assert.equal(revised.revision.toKind, "effect");
assert.equal(revised.revision.preservedEvidence.length, provenBefore);
// Prior evidence goes into conceptual as provenance, NOT into proven with "carried over" wording.
assert.ok(
  revised.result.project.brief.summary.conceptual.some(c => /provenance/i.test(c)),
  "Prior evidence must appear in conceptual as provenance history",
);
assert.ok(
  !revised.result.project.brief.summary.proven.some(p => /carried over/i.test(p)),
  "Prior evidence must NOT appear in proven with 'carried over' wording",
);
assert.ok(revised.result.project.repairHistory.some(h => /revised category/i.test(h)));
// The original plain-language goal survives the revision.
assert.ok(revised.result.project.brief.goal.length > 0);

// ============================================================
// --- Explicit brief shape: audiences, workflows, interface, platforms, validation, decisions ---
// ============================================================
for (const [kindStr, prompt] of Object.entries(prompts) as [AudioProjectKind, string][]) {
  const p = compileAudioSoftwareProject(prompt).project;
  const b = p.brief;

  // audiences: non-empty array of non-empty strings
  assert.ok(Array.isArray(b.audiences) && b.audiences.length > 0, `${kindStr}: audiences must be non-empty`);
  assert.ok(b.audiences.every(a => typeof a === "string" && a.length > 0), `${kindStr}: every audience must be a non-empty string`);

  // workflows: non-empty array of non-empty strings
  assert.ok(Array.isArray(b.workflows) && b.workflows.length > 0, `${kindStr}: workflows must be non-empty`);
  assert.ok(b.workflows.every(w => typeof w === "string" && w.length > 0), `${kindStr}: every workflow must be a non-empty string`);

  // interfaceDescription: non-empty string
  assert.ok(typeof b.interfaceDescription === "string" && b.interfaceDescription.length > 0, `${kindStr}: interfaceDescription must be a non-empty string`);

  // interfaceRoles: object whose keys match control ids
  assert.ok(b.interfaceRoles && typeof b.interfaceRoles === "object", `${kindStr}: interfaceRoles must be an object`);
  for (const roleId of Object.keys(b.interfaceRoles)) {
    assert.ok(b.controls.some(c => c.id === roleId), `${kindStr}: interfaceRoles key "${roleId}" must match a control id`);
  }

  // platformTargets: non-empty array of non-empty strings mentioning "Browser"
  assert.ok(Array.isArray(b.platformTargets) && b.platformTargets.length > 0, `${kindStr}: platformTargets must be non-empty`);
  assert.ok(b.platformTargets.some(t => /browser/i.test(t)), `${kindStr}: platformTargets must mention the browser`);

  // validationRequirements: non-empty array of non-empty strings
  assert.ok(Array.isArray(b.validationRequirements) && b.validationRequirements.length > 0, `${kindStr}: validationRequirements must be non-empty`);
  assert.ok(b.validationRequirements.every(r => typeof r === "string" && r.length > 0), `${kindStr}: every validation requirement must be a non-empty string`);

  // decisions: non-empty array; each has id, question, options (array), and selected in options
  assert.ok(Array.isArray(b.decisions) && b.decisions.length > 0, `${kindStr}: decisions must be non-empty`);
  for (const decision of b.decisions) {
    assert.ok(typeof decision.id === "string" && decision.id.length > 0, `${kindStr}: decision id must be a non-empty string`);
    assert.ok(typeof decision.question === "string" && decision.question.length > 0, `${kindStr}: decision question must be a non-empty string`);
    assert.ok(Array.isArray(decision.options) && decision.options.length >= 2, `${kindStr}: decision options must have at least 2 entries`);
    assert.ok(decision.options.includes(decision.selected), `${kindStr}: decision selected must be one of the options`);
  }

  // Full validation must still pass with all the new fields present
  assert.equal(validateAudioSoftwareProject(p).valid, true, `${kindStr}: full validation failed`);
}

// --- Invalid brief shape is caught by validation ---
const badDecision = compileAudioSoftwareProject(prompts.effect).project;
// Corrupt a decision: selected value not in options
badDecision.brief.decisions[0] = { ...badDecision.brief.decisions[0], selected: "not-an-option" };
assert.equal(validateAudioSoftwareProject(badDecision).valid, false, "A decision with selected not in options must fail validation");

const noAudiences = compileAudioSoftwareProject(prompts.mixer).project;
noAudiences.brief.audiences = [];
assert.equal(validateAudioSoftwareProject(noAudiences).valid, false, "Empty audiences array must fail validation");

const noValidReqs = compileAudioSoftwareProject(prompts.utility).project;
noValidReqs.brief.validationRequirements = [];
assert.equal(validateAudioSoftwareProject(noValidReqs).valid, false, "Empty validationRequirements array must fail validation");

// ============================================================
// --- Per-kind contextual questions are always present (not only on ambiguity) ---
// ============================================================
// Every compiled project exposes at least one decision regardless of how clear the prompt is.
for (const [kindStr, prompt] of Object.entries(prompts) as [AudioProjectKind, string][]) {
  const p = compileAudioSoftwareProject(prompt).project;
  assert.ok(p.brief.decisions.length >= 1, `${kindStr}: must have at least 1 per-kind contextual decision`);
  // Questions are outcome-focused: they must mention the user's result, not implementation internals.
  // At minimum, each question ends with a "?" and contains plain words.
  for (const d of p.brief.decisions) {
    assert.ok(d.question.includes("?"), `${kindStr}: decision question "${d.question}" must be a question (contain "?")`);
    assert.ok(d.options.length >= 2, `${kindStr}: decision "${d.id}" must have at least 2 options`);
  }
}

// ============================================================
// --- Updating a brief decision preserves project id and evidence ---
// ============================================================
import { updateBriefDecision } from "../src/audioProjects";

const baseEffect = compileAudioSoftwareProject(prompts.effect).project;
const baseId = baseEffect.id;
const baseProven = baseEffect.brief.evidence.filter(e => e.pass && (e.grade === "measured" || e.grade === "static"));
assert.ok(baseEffect.brief.decisions.length > 0, "Effect project must have decisions");

const firstDecision = baseEffect.brief.decisions[0];
const alternativeOption = firstDecision.options.find(o => o !== firstDecision.selected);
assert.ok(alternativeOption !== undefined, "Effect must have at least one non-selected option");

const updated = updateBriefDecision(baseEffect, firstDecision.id, alternativeOption!);

// Project id is unchanged
assert.equal(updated.id, baseId, "Project id must be preserved after a brief decision update");

// Validated evidence: original evidence checks survive, and the decision update
// adds exactly one new static evidence item (so count is baseProven.length or
// baseProven.length + 1 depending on whether the check already existed).
const updatedProven = updated.brief.evidence.filter(e => e.pass && (e.grade === "measured" || e.grade === "static"));
assert.ok(updatedProven.length >= baseProven.length, "Evidence count must not decrease after a brief decision update");
for (const orig of baseProven) {
  // The original check either survives (still static) or was demoted to conceptual
  // and replaced by the new static evidence for the same check — so the check
  // itself must be present in one form or another.
  assert.ok(
    updated.brief.evidence.some(e => e.check === orig.check),
    `Evidence check "${orig.check}" must survive a decision update (in any grade)`,
  );
}

// The decision's selected value is updated
const updatedDecision = updated.brief.decisions.find(d => d.id === firstDecision.id);
assert.ok(updatedDecision, "The updated decision must still be in the brief");
assert.equal(updatedDecision!.selected, alternativeOption!, "The decision selected value must be updated");

// The change is recorded in the summary and repair history
assert.ok(updated.brief.summary.changed.some(c => c.includes(firstDecision.id)), "The decision change must appear in summary.changed");
assert.ok(updated.repairHistory.some(h => h.includes(firstDecision.id)), "The decision change must appear in repairHistory");

// The original project is not mutated
assert.equal(baseEffect.brief.decisions[0].selected, firstDecision.selected, "Original project must not be mutated");

// Trying to update a non-existent decision throws
assert.throws(() => updateBriefDecision(baseEffect, "nonexistent-id", "anything"), /not found/i, "Updating a missing decision id must throw");

// Updating a decision on a project that then fails validation is caught by validation
const badSelected = compileAudioSoftwareProject(prompts.instrument).project;
const instrumentDecision = badSelected.brief.decisions[0];
const validUpdate = updateBriefDecision(badSelected, instrumentDecision.id, instrumentDecision.options[1 % instrumentDecision.options.length]);
assert.equal(validateAudioSoftwareProject(validUpdate).valid, true, "A valid decision update must still pass validation");

// ============================================================
// --- Migration of a project stored without the new explicit brief fields ---
// ============================================================
const legacyNoBriefExtras = JSON.parse(JSON.stringify(compileAudioSoftwareProject(prompts.effect).project));
legacyNoBriefExtras.version = "1.0";
delete legacyNoBriefExtras.brief.audiences;
delete legacyNoBriefExtras.brief.workflows;
delete legacyNoBriefExtras.brief.interfaceDescription;
delete legacyNoBriefExtras.brief.interfaceRoles;
delete legacyNoBriefExtras.brief.platformTargets;
delete legacyNoBriefExtras.brief.validationRequirements;
delete legacyNoBriefExtras.brief.decisions;
delete legacyNoBriefExtras.brief.goal;
delete legacyNoBriefExtras.brief.summary;
delete legacyNoBriefExtras.preview.fidelity;

const migratedFull = normalizeAudioSoftwareProjectCandidate(legacyNoBriefExtras);
assert.equal(migratedFull.validation.valid, true, "Migration must produce a valid project: " + migratedFull.validation.issues.join("; "));
assert.equal(migratedFull.project?.version, AUDIO_SOFTWARE_PROJECT_VERSION, "Migrated project must have current version");
assert.ok(Array.isArray(migratedFull.project?.brief.audiences) && (migratedFull.project?.brief.audiences.length ?? 0) > 0, "Migrated audiences must be non-empty");
assert.ok(Array.isArray(migratedFull.project?.brief.workflows) && (migratedFull.project?.brief.workflows.length ?? 0) > 0, "Migrated workflows must be non-empty");
assert.ok(typeof migratedFull.project?.brief.interfaceDescription === "string" && migratedFull.project.brief.interfaceDescription.length > 0, "Migrated interfaceDescription must be non-empty");
assert.ok(Array.isArray(migratedFull.project?.brief.platformTargets) && (migratedFull.project?.brief.platformTargets.length ?? 0) > 0, "Migrated platformTargets must be non-empty");
assert.ok(Array.isArray(migratedFull.project?.brief.validationRequirements) && (migratedFull.project?.brief.validationRequirements.length ?? 0) > 0, "Migrated validationRequirements must be non-empty");
assert.ok(Array.isArray(migratedFull.project?.brief.decisions), "Migrated decisions must be an array (may be empty for old persisted projects)");

console.log("audio project harness tests passed");