import { classifyPluginIntent, familyToCategory } from "../src/utils/pluginSpec";
import { scoreRecipes } from "../src/utils/dspRecipes";
import { runQualityGate } from "../src/utils/qualityGate";
import { AudioPlugin } from "../src/types";

let failures = 0;
const check = (label: string, cond: boolean, extra?: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " -- " + extra : ""}`);
};

// --- Classification ---
const ampSpec = classifyPluginIntent("make me a guitar amp sim for metal");
check("amp sim classification: family", ampSpec.family === "amp_sim", `got ${ampSpec.family}`);
check("amp sim classification: category", familyToCategory(ampSpec.family) === "distortion", `got ${familyToCategory(ampSpec.family)}`);
check("amp sim: not misclassified as generic distortion", ampSpec.family !== "distortion");

const fuzzSpec = classifyPluginIntent("a screaming fuzz pedal for guitar");
check("plain fuzz pedal is NOT amp_sim", fuzzSpec.family === "distortion", `got ${fuzzSpec.family}`);

const samplerSpec = classifyPluginIntent("build me a drum sampler with an MPC style pad layout");
check("sampler classification: family", samplerSpec.family === "sampler", `got ${samplerSpec.family}`);
check("sampler classification: category", familyToCategory(samplerSpec.family) === "synthesizer", `got ${familyToCategory(samplerSpec.family)}`);

const bassAmpSpec = classifyPluginIntent("tube bass amp with a 4x12 cab");
check("bass amp classification: family", bassAmpSpec.family === "amp_sim", `got ${bassAmpSpec.family}`);

// --- Recipe routing ---
const ampScored = scoreRecipes("guitar amp sim", ampSpec);
check("amp_sim routes to distortion recipe", ampScored.some(s => s.recipe.id === "distortion"), `got ${ampScored.map(s=>s.recipe.id)}`);

const samplerScored = scoreRecipes("drum sampler pad", samplerSpec);
check("sampler routes to sampler recipe", samplerScored.some(s => s.recipe.id === "sampler"), `got ${samplerScored.map(s=>s.recipe.id)}`);

// --- Deterministic UI enforcement: amp_sim ---
const bareAmpPlugin: AudioPlugin = {
  id: "amp-test", name: "Test Amp", category: "distortion", description: "",
  parameters: [
    { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 10, value: 10, unit: "dB" },
    { id: "tone", name: "Tone", min: 500, max: 8000, defaultValue: 3000, value: 3000, unit: "Hz" },
  ],
  dspFunction: `let d = params.drive !== undefined ? params.drive : 10;\nlet g = Math.pow(10, d/20);\nreturn Math.tanh(inputSample * g) / Math.pow(g, 0.6);`,
  faustCode: "", cppJuceCode: "", createdAt: "",
};
const ampGate = runQualityGate(bareAmpPlugin, { family: "amp_sim" });
const hasAmp = ampGate.plugin.parameters.some(p => p.controlType === "amp");
const hasCab = ampGate.plugin.parameters.some(p => p.controlType === "cab");
const hasMic = ampGate.plugin.parameters.some(p => p.controlType === "mic");
check("amp_sim enforcement: amp widget injected", hasAmp);
check("amp_sim enforcement: cab widget injected", hasCab);
check("amp_sim enforcement: mic widget injected", hasMic);
check("amp_sim enforcement: model's own drive/tone knobs preserved", ampGate.plugin.parameters.some(p => p.id === "drive") && ampGate.plugin.parameters.some(p => p.id === "tone"));
const ampWidget = ampGate.plugin.parameters.find(p => p.controlType === "amp");
check("amp_sim enforcement: amp widget has tolex/knob/channel styling", !!(ampWidget?.ampTolexPattern && ampWidget?.ampKnobStyle && ampWidget?.ampChannelType));
check("amp_sim enforcement: no overlapping coordinates (amp/cab/mic all positioned)", ampGate.plugin.parameters.filter(p => ["amp","cab","mic"].includes(p.controlType||"")).every(p => p.x !== undefined && p.y !== undefined));

// Re-running the gate on an already-compliant amp plugin should NOT duplicate widgets
const alreadyCompliant = ampGate.plugin;
const ampGate2 = runQualityGate(alreadyCompliant, { family: "amp_sim" });
const ampCount2 = ampGate2.plugin.parameters.filter(p => p.controlType === "amp").length;
const cabCount2 = ampGate2.plugin.parameters.filter(p => p.controlType === "cab").length;
const micCount2 = ampGate2.plugin.parameters.filter(p => p.controlType === "mic").length;
check("amp_sim enforcement is idempotent (no duplicate amp)", ampCount2 === 1, `count=${ampCount2}`);
check("amp_sim enforcement is idempotent (no duplicate cab)", cabCount2 === 1, `count=${cabCount2}`);
check("amp_sim enforcement is idempotent (no duplicate mic)", micCount2 === 1, `count=${micCount2}`);

// --- Deterministic UI enforcement: sampler ---
const barePadPlugin: AudioPlugin = {
  id: "sampler-test2", name: "Test Sampler", category: "synthesizer", description: "",
  parameters: [
    { id: "pad_1", name: "Pad 1", min: 0, max: 127, defaultValue: 127, value: 127, unit: "vel", controlType: "pad" },
    { id: "pad_2", name: "Pad 2", min: 0, max: 127, defaultValue: 0, value: 0, unit: "vel", controlType: "pad" },
  ],
  dspFunction: `let sum = 0;\nif (params.pad_1) sum += 0.5;\nif (params.pad_2) sum += 0.3;\nreturn Math.tanh(sum);`,
  faustCode: "", cppJuceCode: "", createdAt: "",
};
const samplerGate = runQualityGate(barePadPlugin, { family: "sampler" });
const padCount = samplerGate.plugin.parameters.filter(p => p.controlType === "pad").length;
check("sampler enforcement: tops up to 8 pads", padCount === 8, `got ${padCount}`);
check("sampler enforcement: original pads preserved", samplerGate.plugin.parameters.some(p => p.id === "pad_1") && samplerGate.plugin.parameters.some(p => p.id === "pad_2"));
check("sampler enforcement: pads laid out in a grid (all positioned)", samplerGate.plugin.parameters.filter(p => p.controlType === "pad").every(p => p.x !== undefined && p.y !== undefined));

// Full sampler already has 8 -> no-op
const fullPadPlugin: AudioPlugin = {
  ...barePadPlugin,
  parameters: Array.from({ length: 8 }, (_, i) => ({
    id: `pad_${i+1}`, name: `Pad ${i+1}`, min: 0, max: 127, defaultValue: i===0?127:0, value: i===0?127:0, unit: "vel", controlType: "pad" as const,
  })),
};
const fullGate = runQualityGate(fullPadPlugin, { family: "sampler" });
check("sampler enforcement: already-full grid is untouched (still 8)", fullGate.plugin.parameters.filter(p => p.controlType === "pad").length === 8);

// --- No family passed: no enforcement side effects on unrelated plugins ---
const plainFilter: AudioPlugin = {
  id: "plain", name: "Plain Filter", category: "filter", description: "",
  parameters: [{ id: "cutoff", name: "Cutoff", min: 60, max: 12000, defaultValue: 1000, value: 1000, unit: "Hz" }],
  dspFunction: `let c = params.cutoff !== undefined ? params.cutoff : 1000;\nreturn Math.tanh(inputSample * (c/1000));`,
  faustCode: "", cppJuceCode: "", createdAt: "",
};
const plainGate = runQualityGate(plainFilter);
check("no family: no amp/cab/mic/pad injected into unrelated plugin", plainGate.plugin.parameters.every(p => !["amp","cab","mic","pad"].includes(p.controlType||"")));

console.log(failures === 0 ? "\nALL AMP/SAMPLER TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
