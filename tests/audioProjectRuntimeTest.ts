import assert from "node:assert/strict";
import { transform } from "esbuild";
import { compileAudioSoftwareProject, type AudioSoftwareProject } from "../src/audioProjects";

async function loadModel(project: AudioSoftwareProject): Promise<any> {
  const source = project.codeAssets.find(asset => asset.id === project.preview.entryAssetId)?.source;
  assert.ok(source, `Missing preview source for ${project.kind}`);
  const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const url = `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`;
  const module = await import(url);
  assert.equal(typeof module.createModel, "function");
  return module.createModel();
}

(async () => {
  const effect = await loadModel(compileAudioSoftwareProject("Build a distortion effect").project);
  assert.notEqual(effect.process(0.8), 0.8);
  assert.equal(effect.controls.mix, 0.5);

  const instrumentProject = compileAudioSoftwareProject("Build a MIDI synthesizer instrument").project;
  const instrument = await loadModel(instrumentProject);
  instrument.noteOn(69);
  instrument.processFrame();
  assert.notEqual(instrument.processFrame(), 0);
  instrument.noteOff(69);
  assert.equal(instrument.processFrame(), 0);
  assert.equal(instrument.contract.voices, instrumentProject.kind === "instrument" ? instrumentProject.midi.voices : -1);

  const samplerProject = compileAudioSoftwareProject("Build an MPC drum pad sampler").project;
  const sampler = await loadModel(samplerProject);
  sampler.triggerPad(36);
  assert.notEqual(sampler.processFrame(), 0);
  assert.deepEqual(sampler.assets.sort(), samplerProject.kind === "sampler" ? samplerProject.assets.map(asset => asset.id).sort() : []);

  const sequencerProject = compileAudioSoftwareProject("Build a sixteen step sequencer").project;
  const sequencer = await loadModel(sequencerProject);
  assert.equal(sequencer.eventsAtStep(0)[0].id, "event-0");
  assert.equal(sequencer.nextStep(15), 0);
  assert.equal(JSON.parse(sequencer.serialize()).bpm, sequencerProject.kind === "sequencer" ? sequencerProject.sequence.bpm : -1);

  const mixer = await loadModel(compileAudioSoftwareProject("Build a two channel mixer").project);
  assert.deepEqual(mixer.mix({ "channel-1": [1], "channel-2": [2] }, { "channel-1": 0.5, master: 0.5 }), [1.25]);
  assert.deepEqual(mixer.contract.channels.map((channel: any) => channel.busId), ["master", "master"]);

  const mastering = await loadModel(compileAudioSoftwareProject("Build a mastering limiter chain").project);
  assert.ok(Math.abs(mastering.process(4)) <= 10 ** (-1 / 20));
  assert.deepEqual(mastering.chain.map((stage: any) => stage.type), ["eq", "compressor", "limiter"]);

  const utilityProject = compileAudioSoftwareProject("Build an audio meter utility").project;
  const utility = await loadModel(utilityProject);
  const reading = utility.observe(0.5);
  assert.equal(reading.peak, 0.5);
  assert.equal(reading.rms, 0.5);
  assert.equal(utility.contract.sourceNodeId, utilityProject.kind === "utility" ? utilityProject.analyzer.sourceNodeId : "");

  console.log("audio project runtime tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});