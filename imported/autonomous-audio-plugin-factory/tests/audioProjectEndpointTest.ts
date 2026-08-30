import assert from "node:assert/strict";
import { AUDIO_SOFTWARE_PROJECT_VERSION, compileAudioSoftwareProject, updateBriefDecision, validateAudioSoftwareProject } from "../src/audioProjects";

// Exportable kinds default to "Browser prototype is enough", so a VST3 export
// requires selecting the export decision first. This helper mirrors what the UI
// does before offering the native scaffold action.
const ENABLE_VST3 = "Yes, scaffold a VST3 for JUCE compilation";
import {
  audioProjectProviderMessages,
  compileDeterministicAudioProject,
  finalizeAudioProjectGeneration,
  validateAudioProjectGenerationBody,
} from "../server/audioProjectGeneration";
import { audioProjectToNativePlugin } from "../server/audioProjectNative";

const request = validateAudioProjectGenerationBody({ prompt: "  Build a step sequencer  " });
assert.equal(request.prompt, "Build a step sequencer");
assert.throws(() => validateAudioProjectGenerationBody({ prompt: "" }), /prompt is required/i);
assert.throws(() => validateAudioProjectGenerationBody({ prompt: "effect", provider: "openai", model: "made-up" }), /unsupported managed provider or model/i);

const deterministic = compileDeterministicAudioProject("Build a mixer with two faders");
assert.equal(deterministic.source, "deterministic");
assert.equal(deterministic.project.kind, "mixer");
assert.equal(deterministic.validation.valid, true);
assert.deepEqual(deterministic.evidence, deterministic.project.brief.evidence);
assert.deepEqual(deterministic.limitations, deterministic.project.limitations);

const compilation = compileAudioSoftwareProject("Build an audio meter utility");
const messages = audioProjectProviderMessages("Build an audio meter utility", compilation);
assert.match(messages[0].content, new RegExp(`preserve contract version ${AUDIO_SOFTWARE_PROJECT_VERSION.replace(".", "\\.")}`, "i"));
assert.match(messages[0].content, /never claim VST3 support for sequencer, mixer, sampler, utility, or DAW/i);
assert.match(messages[0].content, /keep preview\.fidelity truthful/i);

const providerProject = JSON.parse(JSON.stringify(compilation.project));
providerProject.name = "Refined Meter";
const provider = finalizeAudioProjectGeneration(compilation, { project: providerProject });
assert.equal(provider.source, "provider");
assert.equal(provider.project.name, "Refined Meter");
assert.equal(provider.validation.valid, true);

const changedKind = JSON.parse(JSON.stringify(compilation.project));
changedKind.kind = "mixer";
const kindFallback = finalizeAudioProjectGeneration(compilation, { project: changedKind });
assert.equal(kindFallback.source, "deterministic-fallback");
assert.equal(kindFallback.project.kind, "utility");
assert.match(kindFallback.repairHistory.join(" "), /candidate rejected/i);

const invalid = finalizeAudioProjectGeneration(compilation, { project: { version: "1.0", kind: "utility" } });
assert.equal(invalid.source, "deterministic-fallback");
assert.equal(invalid.validation.valid, true);
assert.match(invalid.limitations.join(" "), /failed contract validation/i);

const failed = finalizeAudioProjectGeneration(compilation, undefined, "provider offline");
assert.equal(failed.source, "deterministic-fallback");
assert.match(failed.repairHistory.join(" "), /provider offline/i);

const instrument = updateBriefDecision(compileAudioSoftwareProject("Build a MIDI synthesizer instrument").project, "instrument-export", ENABLE_VST3);
const nativeInstrument = audioProjectToNativePlugin(instrument);
assert.equal(nativeInstrument.family, "synthesizer");
assert.equal(nativeInstrument.category, "synthesizer");
assert.deepEqual(nativeInstrument.instrument, { voices: 8, noteRange: [24, 108] });
const sampler = compileAudioSoftwareProject("Build an MPC pad sampler").project;
assert.throws(() => audioProjectToNativePlugin(sampler), /does not support VST3 export/i);
assert.throws(() => audioProjectToNativePlugin(compileAudioSoftwareProject("Build a step sequencer").project), /does not support VST3 export/i);
const legacyDsp = "return inputSample * params.drive;";
const legacy = updateBriefDecision(compileAudioSoftwareProject("Build a distortion effect", {
  id: "legacy-dsp", name: "Legacy DSP", parameters: [{ id: "drive", name: "Drive", min: 0, max: 2, defaultValue: 1 } as any], dspFunction: legacyDsp,
}).project, "effect-export", ENABLE_VST3);
assert.equal(audioProjectToNativePlugin(legacy).dspFunction, legacyDsp);
const unsafeIds = structuredClone(compileAudioSoftwareProject("Build a distortion effect").project);
unsafeIds.brief.controls = [
  { ...unsafeIds.brief.controls[0], id: "a-b" },
  { ...unsafeIds.brief.controls[0], id: "a_b" },
];
unsafeIds.brief.uiRoles = { "a-b": "primary", a_b: "primary" };
assert.equal(validateAudioSoftwareProject(unsafeIds).valid, false);
const invalidInstrument = structuredClone(instrument);
if (invalidInstrument.kind !== "instrument") throw new Error("Expected instrument");
invalidInstrument.midi.voices = Number.POSITIVE_INFINITY;
invalidInstrument.midi.noteRange = [128, 200];
assert.equal(validateAudioSoftwareProject(invalidInstrument).valid, false);
console.log("audio project endpoint tests passed");