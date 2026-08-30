import assert from "node:assert/strict";
import { buildThenAdaptEffect, compileAudioSoftwareProject, type LegacyPlugin } from "../src/audioProjects";

const prior: LegacyPlugin = {
  id: "prior-distortion",
  name: "Prior Distortion",
  parameters: [{ id: "drive", name: "Drive", min: 0, max: 2, defaultValue: 1 } as LegacyPlugin["parameters"][number]],
  dspFunction: "return Math.tanh(inputSample * params.drive);",
};
const newlyBuilt: LegacyPlugin = {
  id: "new-feedback-echo",
  name: "New Feedback Echo",
  parameters: [{ id: "feedback", name: "Feedback", min: 0, max: 0.95, defaultValue: 0.55 } as LegacyPlugin["parameters"][number]],
  dspFunction: "state.delayed = (state.delayed || 0) * params.feedback + inputSample; return state.delayed;",
};

let active = prior;
let buildResolved = false;
const project = await buildThenAdaptEffect(
  async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    active = newlyBuilt;
    buildResolved = true;
  },
  () => active,
  async plugin => {
    assert.equal(buildResolved, true, "Adaptation must wait for the delayed offline build");
    return compileAudioSoftwareProject("Build a feedback echo effect", plugin).project;
  },
);

assert.equal(project.kind, "effect");
if (project.kind !== "effect") throw new Error("Expected effect project");
assert.equal(project.processor.mode, "adapted-plugin");
assert.equal(project.processor.pluginId, newlyBuilt.id);
assert.deepEqual(project.processor.parameters, ["feedback"]);
assert.ok(
  project.codeAssets.find(asset => asset.id === project.processor.dspAssetId)?.source.includes(newlyBuilt.dspFunction),
  "The adapted DSP asset must contain the newly built plugin's processor body",
);
assert.notEqual(project.processor.pluginId, prior.id, "The prior active plugin must never be adapted");

const noBuildProject = await buildThenAdaptEffect(
  async () => {
    await Promise.resolve();
    // A chat response completed, but no plugin artifact was saved.
  },
  () => active,
  async plugin => compileAudioSoftwareProject("Build another feedback echo effect", plugin).project,
);
assert.equal(noBuildProject.kind, "effect");
if (noBuildProject.kind !== "effect") throw new Error("Expected effect project");
assert.equal(
  noBuildProject.processor.mode,
  "native-model",
  "A resolved request with no newly saved plugin must not adapt the prior active DSP",
);

console.log("audio project effect sequencing tests passed");