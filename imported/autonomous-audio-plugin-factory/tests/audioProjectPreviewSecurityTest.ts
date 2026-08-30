import assert from "node:assert/strict";
import {
  compileAudioSoftwareProject,
  createTrustedPreviewModel,
  normalizeAudioSoftwareProjectCandidate,
  processTrustedPreviewSample,
  runTrustedFocusedSimulation,
} from "../src/audioProjects";

const utility = compileAudioSoftwareProject("Build an audio meter utility").project;
utility.codeAssets[0].source = "globalThis.__orangejuceInjected = true; export const createModel = () => ({ observe() { return { peak: 1, rms: 1 }; } });";
const normalized = normalizeAudioSoftwareProjectCandidate(utility);
assert.equal(normalized.validation.valid, true, "Structurally valid provider candidate should normalize");
assert.ok(normalized.project);
const before = (globalThis as Record<string, unknown>).__orangejuceInjected;
const result = runTrustedFocusedSimulation(normalized.project!);
assert.match(result, /Focused simulation/);
assert.equal((globalThis as Record<string, unknown>).__orangejuceInjected, before, "Project source must never execute in the app origin");

const mastering = compileAudioSoftwareProject("Build a mastering limiter chain").project;
const trusted = createTrustedPreviewModel(mastering);
assert.doesNotThrow(() => processTrustedPreviewSample(mastering, trusted, 0.5));
assert.throws(
  () => processTrustedPreviewSample(mastering, { process() { throw new Error("provider processor executed"); } }, 0.5),
  /Browser processor failed/,
  "Thrown processor errors must fail closed",
);
assert.throws(
  () => processTrustedPreviewSample(mastering, { process() { return Number.NaN; } }, 0.5),
  /non-finite/,
  "Non-finite processor output must fail closed",
);
assert.throws(
  () => processTrustedPreviewSample(mastering, {}, 0.5),
  /missing process/,
  "A missing processor method must not become passthrough",
);

console.log("audio project preview security tests passed");