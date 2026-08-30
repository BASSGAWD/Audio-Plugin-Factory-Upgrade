/**
 * audioProjectTruthfulnessTest.ts
 *
 * Tests for all five architect-review fixes:
 *
 * 1. Decision application: every structural/runtime decision changes the
 *    actual type-specific contract field, regenerates affected browser source,
 *    adds new static evidence, and the updated project passes validation.
 *
 * 2. Category revision: same project id is kept, prior measured/static
 *    evidence appears in conceptual (provenance), NOT in proven for the new
 *    category, and the new category has its own fresh proven evidence.
 *
 * 3. Classification persistence coherence: the wrapper format stores
 *    { projectId, kind, classification } and a helper rejects mismatched data.
 *
 * 4. DAW hydration adapter: dawProjectFromAudioProject produces a DawProject
 *    whose id is derived from the audio project id, track count matches,
 *    BPM matches, and buses include master + return.
 *
 * (Audition is a browser-only feature and is not testable in Node.)
 */

import assert from "node:assert/strict";
import {
  compileAudioSoftwareProject,
  updateBriefDecision,
  reviseAudioSoftwareProject,
  validateAudioSoftwareProject,
  classifyAudioSoftwarePrompt,
  promoteMeasuredEvidence,
  findPendingFixtureCheck,
  type AudioProjectKind,
  type AudioSoftwareProject,
  type ClassificationEvidence,
} from "../src/audioProjects";
import { resolveAuditionMode, shouldPromotePluginAudition } from "../src/components/AudioProjectCard";

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

// ============================================================
// 1. Decision application — structural contract mutations
// ============================================================

// --- instrument-polyphony ---
{
  const base = compileAudioSoftwareProject("Build a MIDI synthesizer instrument").project;
  if (base.kind !== "instrument") throw new Error("Expected instrument");
  assert.equal(base.midi.voices, 8, "Default instrument voices should be 8");

  const mono = updateBriefDecision(base, "instrument-polyphony", "Single note (monophonic)");
  assert.equal(validateAudioSoftwareProject(mono).valid, true, "Monophonic instrument must pass validation");
  if (mono.kind !== "instrument") throw new Error("Expected instrument after decision update");
  assert.equal(mono.midi.voices, 1, "Monophonic decision must set voices to 1");
  assert.ok(mono.codeAssets[0].source.includes("voices: 1"), "Browser model source must reflect voices=1");
  assert.ok(mono.brief.evidence.some(e => e.grade === "static" && /polyphony/i.test(e.check) && e.pass),
    "Static evidence for polyphony change must be added");
  // id is preserved
  assert.equal(mono.id, base.id, "Project id must be preserved after polyphony decision");

  const four = updateBriefDecision(base, "instrument-polyphony", "Up to 4 notes");
  if (four.kind !== "instrument") throw new Error("Expected instrument");
  assert.equal(four.midi.voices, 4, "Up to 4 notes decision must set voices to 4");
  assert.ok(four.codeAssets[0].source.includes("voices: 4"), "Browser model must reflect voices=4");
}

// --- sampler-pads ---
{
  const base = compileAudioSoftwareProject("Build an MPC drum pad sampler").project;
  if (base.kind !== "sampler") throw new Error("Expected sampler");
  assert.equal(base.pads.length, 4, "Default sampler should have 4 pads");

  const eight = updateBriefDecision(base, "sampler-pads", "8 pads");
  assert.equal(validateAudioSoftwareProject(eight).valid, true, "8-pad sampler must pass validation");
  if (eight.kind !== "sampler") throw new Error("Expected sampler");
  assert.equal(eight.pads.length, 8, "8-pads decision must result in 8 pads");
  assert.equal(eight.assets.length, 8, "8-pads decision must result in 8 assets");
  assert.ok(new Set(eight.assets.map(a => a.distinctFingerprint)).size === 8, "Assets must have distinct fingerprints");
  assert.ok(eight.brief.evidence.some(e => e.grade === "static" && /pad count/i.test(e.check) && e.pass),
    "Static evidence for pad count change must be added");
  assert.equal(eight.id, base.id, "Project id must be preserved after pad decision");

  const sixteen = updateBriefDecision(base, "sampler-pads", "16 pads");
  if (sixteen.kind !== "sampler") throw new Error("Expected sampler");
  assert.equal(sixteen.pads.length, 16, "16-pads decision must result in 16 pads");
}

// --- sequencer-steps ---
{
  const base = compileAudioSoftwareProject("Build a sixteen step sequencer").project;
  if (base.kind !== "sequencer") throw new Error("Expected sequencer");
  assert.equal(base.sequence.stepsPerBar, 16, "Default sequencer should have 16 steps");

  const eight = updateBriefDecision(base, "sequencer-steps", "8 steps");
  assert.equal(validateAudioSoftwareProject(eight).valid, true, "8-step sequencer must pass validation");
  if (eight.kind !== "sequencer") throw new Error("Expected sequencer");
  assert.equal(eight.sequence.stepsPerBar, 8, "8-steps decision must set stepsPerBar to 8");
  assert.ok(eight.codeAssets[0].source.includes("stepsPerBar: 8"), "Browser source must reflect 8 steps");
  assert.ok(eight.brief.evidence.some(e => e.grade === "static" && /step count/i.test(e.check) && e.pass));
  assert.equal(eight.id, base.id, "Project id must be preserved");

  const thirtyTwo = updateBriefDecision(base, "sequencer-steps", "32 steps");
  if (thirtyTwo.kind !== "sequencer") throw new Error("Expected sequencer");
  assert.equal(thirtyTwo.sequence.stepsPerBar, 32, "32-steps decision must set stepsPerBar to 32");
}

// --- mixer-channels ---
{
  const base = compileAudioSoftwareProject("Build a console mixer with buses").project;
  if (base.kind !== "mixer") throw new Error("Expected mixer");
  assert.equal(base.mixer.channels.length, 2, "Default mixer should have 2 channels");

  const four = updateBriefDecision(base, "mixer-channels", "4 channels");
  assert.equal(validateAudioSoftwareProject(four).valid, true, "4-channel mixer must pass validation");
  if (four.kind !== "mixer") throw new Error("Expected mixer");
  assert.equal(four.mixer.channels.length, 4, "4-channels decision must result in 4 channels");
  assert.ok(four.brief.evidence.some(e => e.grade === "static" && /channel count/i.test(e.check) && e.pass));
  assert.equal(four.id, base.id, "Project id must be preserved");

  const eight = updateBriefDecision(base, "mixer-channels", "8 channels");
  if (eight.kind !== "mixer") throw new Error("Expected mixer");
  assert.equal(eight.mixer.channels.length, 8, "8-channels decision must result in 8 channels");
}

// --- mixer-buses removed: browser source/simulation has no return-bus
//     processing, so a bus-count decision changes no runtime behaviour. It is
//     no longer an editable decision. ---
{
  const base = compileAudioSoftwareProject("Build a console mixer with buses").project;
  if (base.kind !== "mixer") throw new Error("Expected mixer");
  assert.ok(!base.brief.decisions.some(d => d.id === "mixer-buses"), "mixer-buses must not be an editable decision");
  assert.throws(() => updateBriefDecision(base, "mixer-buses", "Master only"), /not found/i, "mixer-buses handler must be gone");
}

// --- mastering-target: peak ceiling only (no LUFS claims). Each option maps to
//     an exact implemented dBFS ceiling the limiter clamps sample peaks to. ---
{
  const base = compileAudioSoftwareProject("Build a mastering limiter chain").project;
  if (base.kind !== "mastering") throw new Error("Expected mastering");
  // No LUFS language anywhere in the decision copy.
  const decision = base.brief.decisions.find(d => d.id === "mastering-target");
  assert.ok(decision, "mastering-target decision must exist");
  assert.ok(!/lufs/i.test(decision!.question), "mastering-target question must not mention LUFS");
  assert.ok(decision!.options.every(o => !/lufs/i.test(o)), "mastering-target options must not mention LUFS");

  const standard = updateBriefDecision(base, "mastering-target", "Standard (-1 dBFS)");
  if (standard.kind !== "mastering") throw new Error("Expected mastering");
  const standardCeiling = standard.brief.controls.find(c => c.id === "ceiling")?.defaultValue ?? 0;
  assert.equal(standardCeiling, -1, "Standard should set ceiling to -1 dBFS");
  assert.ok(standard.codeAssets[0].source.includes("ceilingDb = -1"), "Source must reflect -1 dBFS");
  assert.ok(standard.brief.evidence.some(e => e.grade === "static" && /ceiling/i.test(e.check) && e.pass));

  const conservative = updateBriefDecision(base, "mastering-target", "Conservative (-2 dBFS)");
  if (conservative.kind !== "mastering") throw new Error("Expected mastering");
  const conservativeCeiling = conservative.brief.controls.find(c => c.id === "ceiling")?.defaultValue ?? 0;
  assert.equal(conservativeCeiling, -2, "Conservative should set ceiling to -2 dBFS");

  const hot = updateBriefDecision(base, "mastering-target", "Hot (-0.3 dBFS)");
  if (hot.kind !== "mastering") throw new Error("Expected mastering");
  const hotCeiling = hot.brief.controls.find(c => c.id === "ceiling")?.defaultValue ?? 0;
  assert.equal(hotCeiling, -0.3, "Hot should set ceiling to -0.3 dBFS");
  assert.ok(hot.codeAssets[0].source.includes("ceilingDb = -0.3"), "Source must reflect -0.3 dBFS");
}

// --- utility-ballistics ---
{
  const base = compileAudioSoftwareProject("Build an audio meter utility").project;
  if (base.kind !== "utility") throw new Error("Expected utility");
  assert.equal(base.analyzer.ballisticsMs, 300, "Default ballistics should be 300ms");

  const slow = updateBriefDecision(base, "utility-ballistics", "Slow (program-level monitoring)");
  if (slow.kind !== "utility") throw new Error("Expected utility");
  assert.equal(slow.analyzer.ballisticsMs, 800, "Slow ballistics decision must set 800ms");
  assert.ok(slow.codeAssets[0].source.includes("ballisticsMs: 800"), "Source must reflect 800ms");
  assert.ok(slow.brief.evidence.some(e => e.grade === "static" && /ballistics/i.test(e.check) && e.pass));
  assert.equal(slow.id, base.id, "Project id must be preserved");

  const fast = updateBriefDecision(base, "utility-ballistics", "Fast (transient-catching)");
  if (fast.kind !== "utility") throw new Error("Expected utility");
  assert.equal(fast.analyzer.ballisticsMs, 50, "Fast ballistics decision must set 50ms");
}

// --- daw-tracks ---
{
  const base = compileAudioSoftwareProject("Build a multitrack DAW workstation").project;
  if (base.kind !== "daw") throw new Error("Expected daw");
  assert.equal(base.workstation.tracks, 2, "Default DAW should have 2 tracks");

  const four = updateBriefDecision(base, "daw-tracks", "4 tracks");
  assert.equal(validateAudioSoftwareProject(four).valid, true, "4-track DAW must pass validation");
  if (four.kind !== "daw") throw new Error("Expected daw");
  assert.equal(four.workstation.tracks, 4, "4-tracks decision must set workstation.tracks to 4");
  assert.ok(four.codeAssets[0].source.includes("tracks: 4"), "Source must reflect 4 tracks");
  assert.ok(four.brief.evidence.some(e => e.grade === "static" && /track count/i.test(e.check) && e.pass));
  assert.equal(four.id, base.id, "Project id must be preserved");

  const eight = updateBriefDecision(base, "daw-tracks", "8 tracks");
  if (eight.kind !== "daw") throw new Error("Expected daw");
  assert.equal(eight.workstation.tracks, 8, "8-tracks decision must set workstation.tracks to 8");
}

// --- Stale evidence is demoted to conceptual on repeat decision changes ---
{
  const base = compileAudioSoftwareProject("Build a sixteen step sequencer").project;
  const first = updateBriefDecision(base, "sequencer-steps", "8 steps");
  const second = updateBriefDecision(first, "sequencer-steps", "32 steps");
  if (second.kind !== "sequencer") throw new Error("Expected sequencer");
  assert.equal(second.sequence.stepsPerBar, 32, "Second decision must apply to 32 steps");
  // Old "8 steps" static evidence should be demoted to conceptual.
  const staleConceptual = second.brief.evidence.filter(e => e.grade === "conceptual" && /stale/i.test(e.detail));
  assert.ok(staleConceptual.length > 0, "Prior static evidence must be demoted to conceptual as stale");
  // Only one active static evidence for step count should remain.
  const activeStepEvidence = second.brief.evidence.filter(e => e.grade === "static" && /step count/i.test(e.check) && e.pass);
  assert.equal(activeStepEvidence.length, 1, "Only one active static step-count evidence must exist");
  assert.equal(validateAudioSoftwareProject(second).valid, true, "After double decision update must still pass validation");
}

// ============================================================
// 2. Category revision — same id, provenance not proven
// ============================================================
{
  const original = compileAudioSoftwareProject("Build an audio meter utility").project;
  const originalId = original.id;
  assert.ok(original.brief.evidence.some(e => e.pass && (e.grade === "measured" || e.grade === "static")),
    "Original project must have proven evidence");

  const { result, revision } = reviseAudioSoftwareProject(original, "effect");
  const revised = result.project;

  // Same project id
  assert.equal(revised.id, originalId, "Revised project must keep the same project id");

  // Prior measured/static evidence must NOT be carried into the new category as
  // "Carried over from the utility build" (the old wording). It must now appear
  // under conceptual provenance, not proven.
  const provenText = revised.brief.summary.proven.join(" ");
  assert.ok(
    !provenText.includes("Carried over from the"),
    "Prior evidence must not be listed as 'Carried over' in the new category's proven list",
  );
  assert.ok(
    !provenText.toLowerCase().includes("carried over"),
    "Prior evidence must not use 'carried over' wording in the new category's proven list",
  );

  // Prior evidence must appear in conceptual (as provenance).
  const conceptualText = revised.brief.summary.conceptual.join(" ");
  assert.ok(
    /provenance/i.test(conceptualText) || revision.preservedEvidence.length === 0,
    "Prior evidence must be preserved as conceptual provenance",
  );

  // The new category must have its own fresh proven evidence.
  assert.ok(revised.brief.summary.proven.length > 0, "New category must have its own proven evidence");

  // Revision metadata
  assert.equal(revision.fromKind, "utility", "Revision fromKind must be utility");
  assert.equal(revision.toKind, "effect", "Revision toKind must be effect");

  // The revised project passes validation.
  assert.equal(validateAudioSoftwareProject(revised).valid, true, "Revised project must pass validation");

  // Repair history records the revision.
  assert.ok(revised.repairHistory.some(h => /revised category/i.test(h)), "Repair history must record the revision");
  assert.ok(revised.repairHistory.some(h => /provenance/i.test(h) || /conceptual/i.test(h)), "Repair history must mention provenance");

  // Goal is preserved across revision.
  assert.ok(revised.brief.goal.length > 0, "Goal must survive the revision");
}

// Revision from effect to mixer — id must be kept.
{
  const effect = compileAudioSoftwareProject("Build a warm tape echo delay").project;
  const effectId = effect.id;
  const { result } = reviseAudioSoftwareProject(effect, "mixer");
  assert.equal(result.project.id, effectId, "Effect → mixer revision must keep the same project id");
  assert.equal(result.project.kind, "mixer", "Revised project must be kind=mixer");
  assert.equal(validateAudioSoftwareProject(result.project).valid, true, "Effect → mixer revision must pass validation");
}

// ============================================================
// 3. Classification persistence coherence helper
// ============================================================

/**
 * Simulates the load-time guard from App.tsx: only returns a classification
 * when the stored projectId and kind match the persisted project.
 */
function loadCoherentClassification(
  classificationRaw: string | null,
  projectRaw: string | null,
): ClassificationEvidence | null {
  if (!classificationRaw || !projectRaw) return null;
  try {
    const wrapper = JSON.parse(classificationRaw) as { projectId?: string; kind?: string; classification?: ClassificationEvidence };
    if (!wrapper || !wrapper.projectId || !wrapper.classification) return null;
    const projectData = JSON.parse(projectRaw) as { id?: string; kind?: string } | null;
    if (projectData?.id === wrapper.projectId && projectData?.kind === wrapper.kind) {
      return wrapper.classification;
    }
    return null; // mismatch → drop stale classification
  } catch {
    return null;
  }
}

// Coherent: same id + kind → classification is returned.
{
  const proj = compileAudioSoftwareProject("Build a chorus effect processor").project;
  const cls = classifyAudioSoftwarePrompt("Build a chorus effect processor");
  const wrapper = JSON.stringify({ projectId: proj.id, kind: proj.kind, classification: cls });
  const result = loadCoherentClassification(wrapper, JSON.stringify(proj));
  assert.ok(result !== null, "Coherent classification must be returned");
  assert.equal(result!.kind, "effect", "Coherent classification kind must be effect");
}

// Incoherent: different project id → null (stale classification dropped).
{
  const proj1 = compileAudioSoftwareProject("Build a chorus effect processor").project;
  const proj2 = compileAudioSoftwareProject("Build a console mixer with buses").project;
  const cls = classifyAudioSoftwarePrompt("Build a chorus effect processor");
  const wrapper = JSON.stringify({ projectId: proj1.id, kind: proj1.kind, classification: cls });
  const result = loadCoherentClassification(wrapper, JSON.stringify(proj2));
  assert.equal(result, null, "Stale classification (mismatched project id) must be dropped");
}

// Incoherent: different kind (same id somehow) → null.
{
  const proj = compileAudioSoftwareProject("Build a chorus effect processor").project;
  const cls = classifyAudioSoftwarePrompt("Build a console mixer with buses");
  const wrapper = JSON.stringify({ projectId: proj.id, kind: "mixer" /* wrong */, classification: cls });
  const result = loadCoherentClassification(wrapper, JSON.stringify(proj));
  assert.equal(result, null, "Classification with wrong kind must be dropped");
}

// Old format (raw ClassificationEvidence, no projectId) → null.
{
  const proj = compileAudioSoftwareProject("Build a chorus effect processor").project;
  const cls = classifyAudioSoftwarePrompt("Build a chorus effect processor");
  const oldFormat = JSON.stringify(cls); // no projectId wrapper
  const result = loadCoherentClassification(oldFormat, JSON.stringify(proj));
  assert.equal(result, null, "Old-format raw classification must be dropped as incoherent");
}

// No stored classification → null.
assert.equal(loadCoherentClassification(null, "{}"), null, "Null classification input must return null");

// Questions are present only when classification is coherent.
{
  const ambiguousPrompt = "Build a mixer that is also a mastering limiter chain";
  const proj = compileAudioSoftwareProject(ambiguousPrompt).project;
  const cls = classifyAudioSoftwarePrompt(ambiguousPrompt);
  // Coherent → questions may be shown.
  const coherentWrapper = JSON.stringify({ projectId: proj.id, kind: proj.kind, classification: cls });
  const coherentResult = loadCoherentClassification(coherentWrapper, JSON.stringify(proj));
  assert.ok(coherentResult !== null, "Coherent classification must be returned for ambiguous prompt");
  // Incoherent → no questions rendered.
  const staleWrapper = JSON.stringify({ projectId: "some-other-id", kind: "effect", classification: cls });
  const staleResult = loadCoherentClassification(staleWrapper, JSON.stringify(proj));
  assert.equal(staleResult, null, "Stale classification must not render questions");
}

// ============================================================
// 4. DAW hydration adapter (Node-safe: no IndexedDB)
// ============================================================

// Import the model functions we need to test the adapter logic directly.
import { createProject, createTrack, appendAudit } from "../src/daw/model";

// Replicate the dawProjectFromAudioProject adapter logic for testability.
function buildDawProjectFromSource(source: { id: string; name: string; workstation: { tracks: number; buses: Array<{ id: string; kind: string }>; transportBpm: number } }) {
  const trackCount = Math.max(1, source.workstation.tracks);
  const bpm = source.workstation.transportBpm > 0 ? source.workstation.transportBpm : 120;
  const now = new Date().toISOString();
  const project = createProject(source.name, now);
  (project as { id: string }).id = `daw-derived-${source.id}`;
  if (project.transport.tempo.length > 0) project.transport.tempo[0].bpm = bpm;
  project.buses = [{ id: "master", kind: "master" as const, name: "Master", gain: 1, pan: 0, inserts: [] }];
  for (const bus of source.workstation.buses) {
    if (bus.kind === "return" && !project.buses.some(b => b.id === bus.id)) {
      project.buses.unshift({ id: bus.id, kind: "return" as const, name: bus.id, gain: 1, pan: 0, inserts: [] });
    }
  }
  if (!project.buses.some(b => b.id === "return-a")) {
    project.buses.unshift({ id: "return-a", kind: "return" as const, name: "Return A", gain: 1, pan: 0, inserts: [] });
  }
  const COLORS = ["#f97316", "#6366f1", "#22c55e", "#ec4899"];
  for (let i = 0; i < trackCount; i++) {
    const track = createTrack(`Audio ${i + 1}`, i, (COLORS[i % COLORS.length] ?? "#64748b") as `#${string}`);
    project.tracks.push(track);
    appendAudit(project, "track-created", `Created track ${track.name}`, { trackId: track.id }, now);
  }
  appendAudit(project, "project-created", `Hydrated from audio project ${source.id}`, { sourceId: source.id }, now);
  return project;
}

// DAW project with 2 tracks, default BPM.
{
  const dawProject = compileAudioSoftwareProject("Build a multitrack DAW workstation").project;
  if (dawProject.kind !== "daw") throw new Error("Expected daw kind");
  const derived = buildDawProjectFromSource(dawProject);

  // id is stable and derived from the audio project id.
  assert.equal(derived.id, `daw-derived-${dawProject.id}`, "Derived DAW project id must be stable");
  // name matches the audio project.
  assert.equal(derived.name, dawProject.name, "Derived DAW project name must match");
  // Track count matches the workstation contract.
  assert.equal(derived.tracks.length, dawProject.workstation.tracks, "Track count must match workstation.tracks");
  // BPM matches.
  assert.equal(derived.transport.tempo[0]?.bpm, dawProject.workstation.transportBpm, "BPM must match workstation.transportBpm");
  // Must have a master bus.
  assert.ok(derived.buses.some(b => b.kind === "master"), "Derived project must have a master bus");
  // Must have a return bus.
  assert.ok(derived.buses.some(b => b.kind === "return"), "Derived project must have at least one return bus");
}

// DAW project with 8 tracks (after a decision update).
{
  const dawProject = compileAudioSoftwareProject("Build a multitrack DAW workstation").project;
  if (dawProject.kind !== "daw") throw new Error("Expected daw kind");
  const eightTrack = updateBriefDecision(dawProject, "daw-tracks", "8 tracks");
  if (eightTrack.kind !== "daw") throw new Error("Expected daw after decision update");
  const derived = buildDawProjectFromSource(eightTrack);
  assert.equal(derived.tracks.length, 8, "Derived project must have 8 tracks matching decision update");
  // Same audio project id → same derived DAW project id.
  assert.equal(derived.id, `daw-derived-${eightTrack.id}`, "Derived id must be stable after decision update (same audio project id)");
}

// Derived project id is deterministic for the same audio project id.
{
  const source = { id: "audio-project-daw-abc123", name: "My DAW", workstation: { tracks: 4, buses: [{ id: "master", kind: "master" }, { id: "return-a", kind: "return" }], transportBpm: 140 } };
  const a = buildDawProjectFromSource(source);
  const b = buildDawProjectFromSource(source);
  assert.equal(a.id, b.id, "Derived DAW project id must be deterministic for the same audio project id");
  assert.equal(a.transport.tempo[0]?.bpm, 140, "BPM must be 140 from source");
  assert.equal(a.tracks.length, 4, "Track count must be 4 from source");
}

// Different audio project ids → different derived DAW project ids.
{
  const source1 = { id: "audio-project-daw-111", name: "Session A", workstation: { tracks: 2, buses: [{ id: "master", kind: "master" }], transportBpm: 120 } };
  const source2 = { id: "audio-project-daw-222", name: "Session B", workstation: { tracks: 2, buses: [{ id: "master", kind: "master" }], transportBpm: 120 } };
  const d1 = buildDawProjectFromSource(source1);
  const d2 = buildDawProjectFromSource(source2);
  assert.notEqual(d1.id, d2.id, "Different audio project ids must produce different DAW project ids");
}

// ============================================================
// 5. Decision throws on unknown id
// ============================================================
{
  const proj = compileAudioSoftwareProject("Build a chorus effect processor").project;
  assert.throws(
    () => updateBriefDecision(proj, "nonexistent-decision-id", "anything"),
    /not found/i,
    "Updating a missing decision id must throw",
  );
}

// ============================================================
// 6. Every remaining decision option changes a CONTRACT/RUNTIME/TARGET
//    invariant — not merely evidence text. Metadata-only decisions were
//    removed, so this is the enforcement that they stay removed: for every
//    decision, at least two options must produce structurally different
//    projects (different invariant fingerprint).
// ============================================================

/**
 * Captures the observable, non-evidence invariants of a project so two option
 * selections can be compared. Deliberately EXCLUDES brief.evidence, summary
 * text, decisions, and repairHistory — a decision that only changes those is
 * metadata-only and must not exist.
 */
function invariantFingerprint(p: AudioSoftwareProject): string {
  const entrySource = p.codeAssets.find(a => a.id === p.preview.entryAssetId)?.source ?? "";
  const controlDefaults = p.brief.controls.map(c => `${c.id}=${c.defaultValue}`).join(",");
  const graph = `${p.brief.graph.nodes.map(n => n.id).sort().join("|")}//${p.brief.graph.routes.map(r => `${r.from}>${r.to}`).sort().join("|")}`;
  const targets = p.brief.targets.map(t => `${t.target}:${t.supported}:${t.stage}`).join(",");
  // Kind-specific structural fields.
  let structural = "";
  switch (p.kind) {
    case "instrument": structural = `voices=${p.midi.voices}`; break;
    case "sampler": structural = `pads=${p.pads.length};assets=${p.assets.length}`; break;
    case "sequencer": structural = `steps=${p.sequence.stepsPerBar}`; break;
    case "mixer": structural = `ch=${p.mixer.channels.length};bus=${p.mixer.buses.length}`; break;
    case "mastering": structural = `chain=${p.chain.map(s => s.type).join("-")}`; break;
    case "utility": structural = `ballistics=${p.analyzer.ballisticsMs}`; break;
    case "daw": structural = `tracks=${p.workstation.tracks}`; break;
    case "effect": structural = `mode=${p.processor.mode}`; break;
  }
  return [entrySource, controlDefaults, graph, targets, structural].join("§");
}

const kindDecisionOptions: Array<{ kind: AudioProjectKind; prompt: string; decisions: Array<{ id: string; options: string[] }> }> = [
  { kind: "instrument", prompt: "Build a MIDI synthesizer instrument", decisions: [
    { id: "instrument-polyphony", options: ["Single note (monophonic)", "Up to 4 notes", "Up to 8 notes"] },
    { id: "instrument-export", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"] },
  ]},
  { kind: "sampler", prompt: "Build an MPC drum pad sampler", decisions: [
    { id: "sampler-pads", options: ["4 pads (basic kit)", "8 pads", "16 pads"] },
  ]},
  { kind: "sequencer", prompt: "Build a sixteen step sequencer", decisions: [
    { id: "sequencer-steps", options: ["8 steps", "16 steps", "32 steps"] },
  ]},
  { kind: "mixer", prompt: "Build a console mixer with buses", decisions: [
    { id: "mixer-channels", options: ["2 channels", "4 channels", "8 channels"] },
  ]},
  { kind: "mastering", prompt: "Build a mastering limiter chain", decisions: [
    { id: "mastering-target", options: ["Standard (-1 dBFS)", "Conservative (-2 dBFS)", "Hot (-0.3 dBFS)"] },
    { id: "mastering-export", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"] },
  ]},
  { kind: "utility", prompt: "Build an audio meter utility", decisions: [
    { id: "utility-ballistics", options: ["Slow (program-level monitoring)", "Medium", "Fast (transient-catching)"] },
  ]},
  { kind: "daw", prompt: "Build a multitrack DAW workstation", decisions: [
    { id: "daw-tracks", options: ["2 tracks", "4 tracks", "8 tracks"] },
  ]},
  { kind: "effect", prompt: "Build a chorus effect processor", decisions: [
    // effect-character was removed: an adapted effect's audition delegates to
    // the loaded generated plugin, so tweaking the generic browser-model mix
    // did not change what the user heard. effect-export is the real decision.
    { id: "effect-export", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"] },
  ]},
];

for (const { kind, prompt, decisions } of kindDecisionOptions) {
  const base = compileAudioSoftwareProject(prompt).project;
  for (const { id, options } of decisions) {
    const fingerprints = new Set<string>();
    for (const option of options) {
      const updated = updateBriefDecision(base, id, option);
      const validation = validateAudioSoftwareProject(updated);
      assert.equal(
        validation.valid, true,
        `${kind} decision "${id}" = "${option}" must still pass validation: ${validation.issues.join("; ")}`,
      );
      assert.equal(updated.id, base.id, `${kind} decision "${id}" = "${option}" must preserve project id`);
      fingerprints.add(invariantFingerprint(updated));
    }
    // Every decision must be OBSERVABLE: at least two of its options must
    // produce structurally distinct projects (different invariant fingerprint).
    assert.ok(
      fingerprints.size >= 2,
      `Decision "${id}" is not observable — all ${options.length} options produced the same invariant fingerprint (metadata-only decisions are forbidden).`,
    );
  }
}

// ============================================================
// 7. VST3 export decisions flip the actual target invariant
// ============================================================
for (const [kind, prompt, decisionId] of [
  ["effect", "Build a chorus effect processor", "effect-export"],
  ["instrument", "Build a MIDI synthesizer instrument", "instrument-export"],
  ["mastering", "Build a mastering limiter chain", "mastering-export"],
] as const) {
  const base = compileAudioSoftwareProject(prompt).project;
  // Default is "Browser prototype is enough" → vst3 unsupported/not selected.
  const vst3Base = base.brief.targets.find(t => t.target === "vst3")!;
  assert.equal(vst3Base.supported, false, `${kind} default vst3 target must be unsupported`);
  assert.equal(vst3Base.stage, "unsupported", `${kind} default vst3 stage must be unsupported`);
  assert.ok(
    base.brief.summary.unsupported.some(u => /vst3|native|export/i.test(u)),
    `${kind} default must list VST3 as unsupported in the summary`,
  );

  // Selecting "Yes..." → exportable scaffold target.
  const wantVst3 = updateBriefDecision(base, decisionId, "Yes, scaffold a VST3 for JUCE compilation");
  const vst3Yes = wantVst3.brief.targets.find(t => t.target === "vst3")!;
  assert.equal(vst3Yes.supported, true, `${kind} "Yes" export must make vst3 supported`);
  assert.equal(vst3Yes.stage, "exportable", `${kind} "Yes" export must make vst3 exportable`);
  assert.ok(
    wantVst3.brief.platformTargets.some(t => /VST3 — scaffold available/i.test(t)),
    `${kind} "Yes" export must advertise the scaffold in platform targets`,
  );
  assert.ok(
    !wantVst3.brief.summary.unsupported.some(u => /vst3|native|export/i.test(u)),
    `${kind} "Yes" export must remove the VST3 unsupported line`,
  );
  assert.equal(validateAudioSoftwareProject(wantVst3).valid, true, `${kind} "Yes" export must pass validation`);

  // Switching back to "Browser prototype is enough" → unsupported/not-selected again.
  const backToBrowser = updateBriefDecision(wantVst3, decisionId, "Browser prototype is enough");
  const vst3Back = backToBrowser.brief.targets.find(t => t.target === "vst3")!;
  assert.equal(vst3Back.supported, false, `${kind} switching back must make vst3 unsupported`);
  assert.equal(vst3Back.stage, "unsupported", `${kind} switching back must make vst3 unsupported stage`);
  assert.equal(validateAudioSoftwareProject(backToBrowser).valid, true, `${kind} switch-back must pass validation`);
}

// ============================================================
// 8. Metadata-only decisions are removed from DECISIONS_BY_KIND
// ============================================================
const REMOVED_DECISION_IDS = [
  "sequencer-output", "utility-display", "effect-insert",
  "instrument-style", "sampler-kit", "daw-genre",
  "mixer-buses", "effect-character",
];
for (const [, prompt] of Object.entries(prompts)) {
  const proj = compileAudioSoftwareProject(prompt).project;
  for (const removed of REMOVED_DECISION_IDS) {
    assert.ok(
      !proj.brief.decisions.some(d => d.id === removed),
      `Metadata-only decision "${removed}" must be removed from the brief`,
    );
  }
  // Every category keeps at least one contextual decision.
  assert.ok(proj.brief.decisions.length >= 1, `${proj.kind} must keep at least one contextual decision`);
}

// ============================================================
// 9. Golden-fixture evidence starts CONCEPTUAL (not measured),
//    and promoteMeasuredEvidence upgrades it only after execution.
// ============================================================
for (const [, prompt] of Object.entries(prompts)) {
  const proj = compileAudioSoftwareProject(prompt).project;
  // No evidence item may be graded "measured" at compile time — nothing ran.
  const measured = proj.brief.evidence.filter(e => e.grade === "measured");
  assert.equal(measured.length, 0, `${proj.kind} must not claim any "measured" evidence before execution`);
  // The golden-fixture check must be present as a conceptual/pending item.
  const pending = proj.brief.evidence.find(e => e.grade === "conceptual" && /not yet executed/i.test(e.detail));
  assert.ok(pending, `${proj.kind} must carry a pending (conceptual) golden-fixture evidence item`);
  // "stable links" remains a truthful static check (validation really ran).
  assert.ok(
    proj.brief.evidence.some(e => e.grade === "static" && e.check === "stable links" && e.pass),
    `${proj.kind} "stable links" must remain a static (compile-time verified) check`,
  );

  // Promote after "executing" the fixture.
  const promoted = promoteMeasuredEvidence(proj, pending!.check, "Golden model fixture executed and measured within its declared contract.");
  const nowMeasured = promoted.brief.evidence.filter(e => e.grade === "measured");
  assert.equal(nowMeasured.length, 1, `${proj.kind} must have exactly one measured item after promotion`);
  assert.ok(
    promoted.brief.summary.proven.some(p => p.includes(pending!.check)),
    `${proj.kind} promoted fixture must appear in the proven summary`,
  );
  // Promotion is idempotent-safe: re-promoting a non-pending check is a no-op.
  const again = promoteMeasuredEvidence(promoted, "nonexistent-check", "x");
  assert.equal(again, promoted, "promoteMeasuredEvidence must return the same reference when nothing matches");
}

// ============================================================
// 10. Effect adaptation integration: echo / reverb prompts adapt the exact
//     legacy plugin and mark the project as an adapted-plugin effect, and the
//     audition eligibility helper delegates only to the loaded plugin (never
//     generic audio) — and disables audition when no plugin is loaded.
// ============================================================
const echoPlugin = {
  id: "plugin-slapback-echo",
  name: "Slapback Echo",
  parameters: [
    { id: "time_ms", name: "Time", min: 0, max: 1000, defaultValue: 120, value: 120, unit: "ms" },
    { id: "feedback", name: "Feedback", min: 0, max: 0.95, defaultValue: 0.4, value: 0.4, unit: "" },
    { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.35, value: 0.35, unit: "" },
  ],
  dspFunction: "state.buf = state.buf || new Array(48000).fill(0); return inputSample;",
};
const reverbPlugin = {
  id: "plugin-hall-reverb",
  name: "Hall Reverb",
  parameters: [
    { id: "size", name: "Size", min: 0, max: 1, defaultValue: 0.7, value: 0.7, unit: "" },
    { id: "damping", name: "Damping", min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "" },
    { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.4, value: 0.4, unit: "" },
  ],
  dspFunction: "return inputSample * 0.5;",
};

for (const [prompt, plugin] of [
  ["Synthesize a dual feedback slapback tape echo delay", echoPlugin],
  ["Build a lush hall reverb effect", reverbPlugin],
] as const) {
  const { project, adaptedLegacyPlugin } = compileAudioSoftwareProject(prompt, plugin);
  assert.equal(project.kind, "effect", `${plugin.name} adaptation must be an effect`);
  assert.equal(adaptedLegacyPlugin, true, `${plugin.name} must report adaptedLegacyPlugin=true`);
  if (project.kind !== "effect") throw new Error("expected effect");
  // Processor mode + plugin id + parameters match the EXACT plugin contract.
  assert.equal(project.processor.mode, "adapted-plugin", `${plugin.name} processor mode must be adapted-plugin`);
  assert.equal(project.processor.pluginId, plugin.id, `${plugin.name} processor.pluginId must match the plugin id`);
  assert.deepEqual(
    project.processor.parameters, plugin.parameters.map(p => p.id),
    `${plugin.name} processor parameters must match the plugin parameter ids exactly`,
  );
  // The adapted plugin's DSP is bundled as a code asset the processor points at.
  const dspAsset = project.codeAssets.find(a => a.id === project.processor.dspAssetId);
  assert.ok(dspAsset, `${plugin.name} adapted DSP asset must be present`);
  assert.ok(dspAsset!.source.includes(plugin.dspFunction), `${plugin.name} adapted DSP asset must embed the plugin's DSP`);
  // Controls mirror the plugin parameters (id + range).
  for (const param of plugin.parameters) {
    const control = project.brief.controls.find(c => c.id === param.id);
    assert.ok(control, `${plugin.name} must expose a control for parameter "${param.id}"`);
  }
  assert.equal(validateAudioSoftwareProject(project).valid, true, `${plugin.name} adapted project must pass validation`);

  // Audition eligibility: with a loaded plugin callback → delegate; without → unavailable (never generic).
  assert.equal(resolveAuditionMode(project, plugin.id, true), "plugin-delegate", `${plugin.name} with its matching loaded plugin must delegate audition`);
  assert.equal(resolveAuditionMode(project, undefined, false), "plugin-unavailable", `${plugin.name} without a loaded plugin must disable audition (never generic)`);
  assert.equal(resolveAuditionMode(project, "different-plugin", true), "plugin-unavailable", `${plugin.name} must not delegate to a mismatched loaded plugin`);
}

// A non-adapted effect (no legacy plugin) uses the processor-audition path.
{
  const generic = compileAudioSoftwareProject("Build a chorus effect processor").project;
  if (generic.kind !== "effect") throw new Error("expected effect");
  assert.equal(generic.processor.mode, "native-model", "no-plugin effect must be native-model");
  assert.equal(resolveAuditionMode(generic, undefined, false), "processor-audition", "native-model effect runs the processor audition");
  // Even if a plugin callback is present, a native-model effect is NOT a delegate
  // (only adapted-plugin effects delegate).
  assert.equal(resolveAuditionMode(generic, "some-plugin", true), "processor-audition", "native-model effect never delegates");
}

// Non-effect processor kinds run processor-audition; workflow kinds run focused-simulation.
assert.equal(resolveAuditionMode(compileAudioSoftwareProject("Build a MIDI synthesizer instrument").project, undefined, false), "processor-audition");
assert.equal(resolveAuditionMode(compileAudioSoftwareProject("Build a mastering limiter chain").project, undefined, false), "processor-audition");
assert.equal(resolveAuditionMode(compileAudioSoftwareProject("Build a console mixer with buses").project, undefined, false), "focused-simulation");
assert.equal(resolveAuditionMode(compileAudioSoftwareProject("Build a multitrack DAW workstation").project, undefined, false), "focused-simulation");
assert.equal(shouldPromotePluginAudition("started"), true, "Verified adapted-plugin start may promote evidence");
assert.equal(shouldPromotePluginAudition("stopped"), false, "Stopping adapted-plugin playback must not promote evidence");
assert.equal(shouldPromotePluginAudition("failed"), false, "Failed adapted-plugin start must not promote evidence");

// ============================================================
// 11. Preview-execution → evidence promotion wiring
//     Mirrors the production callback: the card reports a successful execution,
//     App promotes ONLY on an id match and persists. Never on mismatch, and
//     never when there is no pending fixture (already measured / stopped early).
// ============================================================

/**
 * Faithful re-implementation of App.handleAudioProjectPreviewMeasured used to
 * assert the promotion + persistence contract without a DOM. Returns the next
 * project and whether it was persisted.
 */
function applyPreviewMeasured(
  current: AudioSoftwareProject | null,
  reportedId: string,
  evidenceCheck: string,
  measuredDetail: string,
  persist: (p: AudioSoftwareProject) => void,
): AudioSoftwareProject | null {
  if (!current || current.id !== reportedId) return current;
  const promoted = promoteMeasuredEvidence(current, evidenceCheck, measuredDetail);
  if (promoted === current) return current;
  persist(promoted);
  return promoted;
}

{
  const base = compileAudioSoftwareProject("Build a chorus effect processor").project;
  const pendingCheck = findPendingFixtureCheck(base);
  assert.ok(pendingCheck, "A freshly compiled project must expose a pending fixture check");
  // The card would find exactly this check to report.
  assert.equal(
    base.brief.evidence.some(e => e.check === pendingCheck && e.grade === "conceptual"),
    true,
    "findPendingFixtureCheck must point at a conceptual (pending) evidence item",
  );

  // --- Happy path: id matches → promote + persist. ---
  let persisted: AudioSoftwareProject | null = null;
  const next = applyPreviewMeasured(base, base.id, pendingCheck!, "Processor audition ran to completion.", p => { persisted = p; });
  assert.notEqual(next, base, "Matching report must produce a promoted project");
  assert.ok(next && next.brief.evidence.some(e => e.check === pendingCheck && e.grade === "measured"), "Promotion must mark the fixture measured");
  assert.ok(persisted, "Matching promotion must persist the updated project");
  assert.equal((persisted as unknown as AudioSoftwareProject).id, base.id, "Persisted project keeps the same id");
  // After promotion there is no longer a pending fixture check.
  assert.equal(findPendingFixtureCheck(next!), undefined, "Promoted project has no pending fixture left");

  // --- Mismatched project id → NO promotion, NO persistence. ---
  let persisted2: AudioSoftwareProject | null = null;
  const unchanged = applyPreviewMeasured(base, "some-other-project-id", pendingCheck!, "should not apply", p => { persisted2 = p; });
  assert.equal(unchanged, base, "A mismatched id must leave the project untouched");
  assert.equal(persisted2, null, "A mismatched id must not persist anything");

  // --- Null current project → no-op. ---
  assert.equal(applyPreviewMeasured(null, base.id, pendingCheck!, "x", () => { throw new Error("must not persist"); }), null);

  // --- Already-measured (e.g. second successful audition) → no re-persist. ---
  let persisted3: AudioSoftwareProject | null = null;
  const again = applyPreviewMeasured(next!, next!.id, pendingCheck!, "second run", p => { persisted3 = p; });
  assert.equal(again, next, "A project with no pending fixture must not be re-promoted");
  assert.equal(persisted3, null, "No pending fixture means no re-persistence");
}

// findPendingFixtureCheck returns undefined once every kind's fixture is promoted.
for (const [, prompt] of Object.entries(prompts)) {
  const proj = compileAudioSoftwareProject(prompt).project;
  const check = findPendingFixtureCheck(proj);
  assert.ok(check, `${proj.kind} must expose a pending fixture check before execution`);
  const promoted = promoteMeasuredEvidence(proj, check!, "measured after execution");
  assert.equal(findPendingFixtureCheck(promoted), undefined, `${proj.kind} must have no pending fixture after promotion`);
}

console.log("audio project truthfulness tests passed");
