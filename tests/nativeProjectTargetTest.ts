import fs from "node:fs";
import path from "node:path";
import {
  classifyNativeProjectTarget,
  scaffoldNativeProject,
  validateNativePlugin,
} from "../server/nativeBuild";

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};

const llm = {
  provider: "ollama" as const,
  ollamaUrl: "http://127.0.0.1:1",
  ollamaModel: "none",
  lmStudioUrl: "http://127.0.0.1:1",
  lmStudioModel: "none",
};
const parameter = { id: "level", name: "Level", min: 0, max: 1, defaultValue: 0.5 };

async function scaffold(family: string, category: string) {
  return scaffoldNativeProject({
    name: `${family} target contract`,
    family,
    category,
    parameters: [parameter],
    dspFunction: "return inputSample;",
  }, llm);
}

async function generatedSources(family: string, category: string) {
  const result = await scaffold(family, category);
  try {
    return {
      cmake: fs.readFileSync(path.join(result.projectDir, "CMakeLists.txt"), "utf8"),
      header: fs.readFileSync(path.join(result.projectDir, "Source", "PluginProcessor.h"), "utf8"),
      processor: fs.readFileSync(path.join(result.projectDir, "Source", "PluginProcessor.cpp"), "utf8"),
    };
  } finally {
    fs.rmSync(result.projectDir, { recursive: true, force: true });
  }
}

(async () => {
  const effect = await generatedSources("dynamics", "dynamics");
  check("effect CMake remains an audio effect",
    effect.cmake.includes("IS_SYNTH FALSE") && effect.cmake.includes("NEEDS_MIDI_INPUT FALSE"));
  check("effect processor has a matched audio input/output contract",
    effect.processor.includes('.withInput ("Input", juce::AudioChannelSet::stereo())') &&
    effect.processor.includes('.withOutput ("Output", juce::AudioChannelSet::stereo())') &&
    effect.processor.includes("if (mainIn != mainOut)") &&
    effect.header.includes("bool acceptsMidi() const override { return false; }") &&
    effect.header.includes("bool silenceInProducesSilence() const { return true; }"));

  const instrument = await generatedSources("synthesizer", "synthesizer");
  check("synth CMake advertises a MIDI instrument",
    instrument.cmake.includes("IS_SYNTH TRUE") && instrument.cmake.includes("NEEDS_MIDI_INPUT TRUE"));
  check("synth processor has output-only, non-silent input behavior",
    !instrument.processor.includes('.withInput ("Input"') &&
    instrument.processor.includes('.withOutput ("Output", juce::AudioChannelSet::stereo())') &&
    !instrument.processor.includes("const auto mainIn") &&
    instrument.header.includes("bool acceptsMidi() const override { return true; }") &&
    instrument.header.includes("bool silenceInProducesSilence() const { return false; }"));
  check("synth consumes MIDI notes and renders oscillator voices",
    instrument.processor.includes("for (const auto metadata : midiMessages)") &&
    instrument.processor.includes("message.isNoteOn()") &&
    instrument.processor.includes("noteVelocities") &&
    instrument.processor.includes("std::sin (notePhases") &&
    instrument.processor.includes("mCore.processSample (generated, params)") &&
    instrument.processor.includes("buffer.setSample"));

  const sampler = await generatedSources("sampler", "synthesizer");
  check("sampler follows the same MIDI instrument target contract",
    sampler.cmake.includes("IS_SYNTH TRUE") && sampler.cmake.includes("NEEDS_MIDI_INPUT TRUE") &&
    !sampler.processor.includes('.withInput ("Input"'));
  check("sampler renders a prepared one-shot table from MIDI triggers",
    sampler.header.includes("sampleTables") &&
    sampler.processor.includes("sampleTables[assetIndex][i] = envelope") &&
    sampler.processor.includes("samplePositions") &&
    sampler.processor.includes("noteAssetIndices[36] = 0") &&
    sampler.processor.includes("message.isNoteOn()") &&
    sampler.processor.includes("generated += sampleTables"));

  for (const kind of ["standalone", "sequencer", "mixer"]) {
    let rejected = false;
    try {
      validateNativePlugin({ name: kind, family: kind, parameters: [parameter], dspFunction: "return inputSample;" });
    } catch (error) {
      rejected = error instanceof Error && error.message.includes(`Unsupported native project target "${kind}"`);
    }
    check(`${kind} requests are rejected as unsupported native targets`, rejected);
  }

  check("legacy synthesizer category remains an instrument",
    classifyNativeProjectTarget({ category: "synthesizer" }).kind === "instrument");
  check("native boundary rejects invalid synth voice and note bounds", (() => {
    try {
      validateNativePlugin({
        name: "Invalid Synth",
        family: "synthesizer",
        category: "synthesizer",
        parameters: [parameter],
        dspFunction: "return inputSample;",
        instrument: { voices: 129, noteRange: [128, 200] },
      });
      return false;
    } catch (error) {
      return /1-128 voices/.test(String(error));
    }
  })());
  check("processor, mastering, and effect categories remain audio effects",
    ["processor", "mastering", "effect"].every((category) =>
      classifyNativeProjectTarget({ category }).kind === "audio-effect"));
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nNATIVE PROJECT TARGET: ALL CHECKS PASS");
  process.exit(failures ? 1 : 0);
})();