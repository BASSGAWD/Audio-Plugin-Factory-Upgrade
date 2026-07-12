/**
 * Universal-coverage test for the offline builder: ANY prompt -- every
 * family, hybrids, and requests matching no known family at all -- must
 * compile into a complete plugin that clears the quality gate at >= 97 on
 * all four dimensions, with honest capability descriptions.
 */

import { buildOfflinePlugin, applyRelativeTweaks, isRelativeTweakRequest, derivePluginName } from "../src/utils/offlineBuilder";
import { processOfflineMessage } from "../src/utils/offlineEngine";
import { runQualityGate, formatBuildReport } from "../src/utils/qualityGate";
import { detectDesignAttributes } from "../src/utils/uiSpec";
import { runPluginDiagnostics } from "../src/utils/healthcheckRunner";
import { classifyPluginIntent } from "../src/utils/pluginSpec";
import { AudioPlugin } from "../src/types";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function toPlugin(prompt: string): { plugin: AudioPlugin; build: ReturnType<typeof buildOfflinePlugin> } {
  const build = buildOfflinePlugin(prompt);
  const plugin: AudioPlugin = {
    id: `test-${Date.now()}`,
    name: build.name,
    category: build.category,
    description: build.description,
    parameters: build.parameters,
    dspFunction: build.dspFunction,
    faustCode: "",
    cppJuceCode: "",
    createdAt: "",
  };
  return { plugin, build };
}

/* --------------------------------------------------------------- */
/* 1. Every family + hybrids + no-family oddballs clear the gate    */
/* --------------------------------------------------------------- */

const BUILD_PROMPTS: Array<{ prompt: string; expectFamily?: string }> = [
  { prompt: "make a lush hall reverb", expectFamily: "reverb" },
  { prompt: "give me a warm tape delay", expectFamily: "delay" },
  { prompt: "build a swirling chorus pedal", expectFamily: "modulation" },
  { prompt: "make a punchy glue compressor", expectFamily: "dynamics" },
  { prompt: "resonant lowpass filter sweep", expectFamily: "filter" },
  { prompt: "heavy fuzz distortion pedal", expectFamily: "distortion" },
  { prompt: "make me a drum pad sampler like an MPC", expectFamily: "sampler" },
  { prompt: "an octave-up pitch shifter", expectFamily: "pitch" },
  { prompt: "ambient drone synth pad", expectFamily: "synthesizer" },
  { prompt: "high gain metal guitar amp sim", expectFamily: "amp_sim" },
  { prompt: "warm tube saturator for the mix bus", expectFamily: "saturator" },
  { prompt: "a parametric EQ for tone shaping", expectFamily: "eq" },
  // Hybrid: EQ look, saturation behavior -> composed two-stage build
  { prompt: "an EQ where each band saturates", expectFamily: "multiband_saturator" },
  // Hybrid: delay + reverb wording -> composed
  { prompt: "a delay that blooms into a reverb wash" },
  // No known family at all -> generic character chain must still pass
  { prompt: "granular texture mangler" },
  { prompt: "something to give my podcast voice an expensive sheen" },
  { prompt: "underwater dream machine" },
  { prompt: "total chaos randomizer box" },
  // Flavored prompts (voicing must not break the gate)
  { prompt: "make a dark subtle reverb", expectFamily: "reverb" },
  { prompt: "extreme brutal endless feedback delay", expectFamily: "delay" },
  // Shimmer = reverb composed with an octave-up pitch stage
  { prompt: "make me a shimmer reverb", expectFamily: "reverb" },
];

for (const { prompt, expectFamily } of BUILD_PROMPTS) {
  const { plugin, build } = toPlugin(prompt);
  const diag = runPluginDiagnostics(plugin);
  const gate = runQualityGate(plugin, { family: build.family });
  const s = gate.scores;
  const minScore = Math.min(s.looks, s.performance, s.latency, s.musicality);
  const familyOk = expectFamily === undefined || build.family === expectFamily;
  const pass =
    diag.overallHealthStatus !== "CRITICAL" &&
    minScore >= 97 &&
    familyOk &&
    plugin.name.length > 0 &&
    plugin.description.length > 0 &&
    plugin.parameters.length >= 2;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"} "${prompt.slice(0, 44).padEnd(44)}" family=${build.family.padEnd(20)} health=${diag.overallHealthStatus.padEnd(8)} scores L${s.looks}/P${s.performance}/La${s.latency}/M${s.musicality}${familyOk ? "" : ` EXPECTED ${expectFamily}`}`
  );
}

/* --------------------------------------------------------------- */
/* 2. Honesty: never claim capabilities the engine does not have    */
/* --------------------------------------------------------------- */

const pitchBuild = buildOfflinePlugin("autotune my vocals");
check(
  "pitch build never claims pitch detection",
  /no real-time pitch detection/i.test(pitchBuild.description) &&
    !/elite.*pitch detection|autocorrelation.*(f0|tracking)|detects (the |your )?pitch/i.test(pitchBuild.description)
);
const samplerBuild = buildOfflinePlugin("make a sampler with drum pads");
check(
  "sampler build never claims file loading",
  !/loads? (wav|audio|sample files)/i.test(samplerBuild.description) &&
    /no audio-file loading/i.test(samplerBuild.description)
);

/* --------------------------------------------------------------- */
/* 3. Hybrid composition wiring                                     */
/* --------------------------------------------------------------- */

const hybrid = buildOfflinePlugin("an EQ where each band saturates");
check("hybrid composes two stages", /STAGE 1/.test(hybrid.dspFunction) && /STAGE 2/.test(hybrid.dspFunction));
check(
  "hybrid has no duplicate param ids",
  new Set(hybrid.parameters.map((p) => p.id)).size === hybrid.parameters.length,
  `ids=[${hybrid.parameters.map((p) => p.id)}]`
);

const genHybrid = buildOfflinePlugin("a synth pad drenched in reverb, hybrid of both");
if (/STAGE 1/.test(genHybrid.dspFunction)) {
  check(
    "generator stage always comes first in a hybrid",
    /STAGE 1:.*(?:oscillator|pad voice|synth)/i.test(genHybrid.dspFunction.split("STAGE 2")[0])
  );
}

// Shimmer: reverb + octave-up pitch stage, voiced subtle
const shimmer = buildOfflinePlugin("make me a shimmer reverb");
check("shimmer composes reverb + pitch stages", /STAGE 1/.test(shimmer.dspFunction) && /STAGE 2/.test(shimmer.dspFunction));
const shimmerPitch = shimmer.parameters.find((p) => p.id === "pitch");
const shimmerAmt = shimmer.parameters.find((p) => p.id === "mix2");
check("shimmer pitch defaults to +12 semitones", !!shimmerPitch && shimmerPitch.defaultValue === 12, `pitch=${shimmerPitch?.defaultValue}`);
check("shimmer blend voiced subtle", !!shimmerAmt && shimmerAmt.defaultValue === 0.35 && /shimmer/i.test(shimmerAmt!.name), `amt=${shimmerAmt?.defaultValue} name=${shimmerAmt?.name}`);
check("shimmer summary explains controls in plain language", /octave-up/i.test(shimmer.summary) && /dry\/wet balance/i.test(shimmer.summary));

/* --------------------------------------------------------------- */
/* 4. Flavor voicing                                                */
/* --------------------------------------------------------------- */

const darkVerb = buildOfflinePlugin("make a dark subtle reverb");
const mixParam = darkVerb.parameters.find((p) => p.id === "mix");
check("'subtle' lowers the mix default", !!mixParam && mixParam.defaultValue <= 0.3, `mix=${mixParam?.defaultValue}`);

const hugeVerb = buildOfflinePlugin("huge cathedral reverb");
const decayParam = hugeVerb.parameters.find((p) => p.id === "decay");
check("'huge' raises the decay default", !!decayParam && decayParam.defaultValue >= 0.7, `decay=${decayParam?.defaultValue}`);

/* --------------------------------------------------------------- */
/* 5. Naming                                                        */
/* --------------------------------------------------------------- */

check("name derived from prompt", derivePluginName("make a lush hall reverb", "reverb") === "Lush Hall Reverb");
check("empty prompt falls back to family label", derivePluginName("make me one", "reverb").length > 0);

/* --------------------------------------------------------------- */
/* 6. Relative tweaks vs rebuilds                                   */
/* --------------------------------------------------------------- */

check("'make it brighter' is a tweak, not a rebuild", isRelativeTweakRequest("make it brighter"));
check("'more feedback' is a tweak", isRelativeTweakRequest("more feedback please"));
check("'make a brighter reverb' is a rebuild (family keyword)", !isRelativeTweakRequest("make a brighter reverb"));

const tweakParams = [
  { id: "cutoff", name: "Cutoff", min: 60, max: 12000, defaultValue: 1400, value: 1400, unit: "Hz" },
  { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.3, value: 0.3, unit: "ratio" },
];
const tweakNotes = applyRelativeTweaks("make it brighter and wetter", tweakParams as any);
check("tweak raises cutoff", tweakParams[0].value > 1400, `cutoff=${tweakParams[0].value}`);
check("tweak raises mix", tweakParams[1].value > 0.3, `mix=${tweakParams[1].value}`);
check("tweak reports notes", tweakNotes.length === 2, `notes=${tweakNotes.length}`);

/* --------------------------------------------------------------- */
/* 7. processOfflineMessage integration                             */
/* --------------------------------------------------------------- */

const basePlugin: AudioPlugin = {
  id: "base",
  name: "Base",
  category: "filter",
  description: "",
  parameters: [{ id: "cutoff", name: "Cutoff", min: 60, max: 12000, defaultValue: 1400, value: 1400, unit: "Hz" }],
  dspFunction: "return inputSample;",
  faustCode: "",
  cppJuceCode: "",
  createdAt: "",
};

const buildMsg = processOfflineMessage("make a shimmer reverb", basePlugin);
check("offline chat builds a plugin for a build request", buildMsg.updatedPlugin !== null && /reverb/i.test(buildMsg.updatedPlugin!.description + buildMsg.updatedPlugin!.name));

const oddballMsg = processOfflineMessage("build me a granular texture mangler", basePlugin);
check("offline chat builds a plugin for an unknown-family request", oddballMsg.updatedPlugin !== null && (oddballMsg.updatedPlugin?.parameters.length || 0) >= 2);

const questionMsg = processOfflineMessage("why does my mix sound muddy?", basePlugin);
check("questions never replace the loaded plugin", questionMsg.updatedPlugin === null);

const tweakMsg = processOfflineMessage("make it brighter", basePlugin);
check(
  "tweak adjusts in place without replacing the DSP",
  tweakMsg.updatedPlugin !== null &&
    tweakMsg.updatedPlugin!.dspFunction === basePlugin.dspFunction &&
    tweakMsg.updatedPlugin!.parameters[0].value > 1400
);

const renameMsg = processOfflineMessage("rename to blue velvet echo", basePlugin);
check("rename still works", renameMsg.updatedPlugin !== null && renameMsg.updatedPlugin!.name === "Blue Velvet Echo");

// Critique gets a targeted, plugin-aware reply -- never the generic pitch
const critiqueMsg = processOfflineMessage("this isnt good", basePlugin);
check(
  "critique reply references the loaded plugin with concrete directions",
  critiqueMsg.updatedPlugin === null &&
    critiqueMsg.text.includes(basePlugin.name) &&
    /engine picker/i.test(critiqueMsg.text) &&
    !/What should we build\?/.test(critiqueMsg.text)
);
const betterMsg = processOfflineMessage("can we make it better", basePlugin);
check("'make it better' is treated as critique, not a rebuild", betterMsg.updatedPlugin === null && betterMsg.text.includes(basePlugin.name));

// Questions get an explainer of the CURRENT plugin
const knobQ = processOfflineMessage("what does the cutoff knob do", basePlugin);
check("question reply explains the loaded plugin's controls", knobQ.updatedPlugin === null && /Cutoff/.test(knobQ.text) && /range 60 to 12000/.test(knobQ.text));

// "how about / what about" phrasing still builds
const howAbout = processOfflineMessage("how about a slapback delay", basePlugin);
check("'how about a delay' is a build, not a question", howAbout.updatedPlugin !== null && /delay/i.test(howAbout.updatedPlugin!.name + howAbout.updatedPlugin!.description));

// "darker" raises damping on a reverb (damping is inverted brightness)
const verbParams = [
  { id: "damp", name: "Damping", min: 0, max: 0.9, defaultValue: 0.4, value: 0.4, unit: "ratio" },
];
applyRelativeTweaks("make it darker", verbParams as any);
check("'darker' raises damping on a reverb", verbParams[0].value > 0.4, `damp=${verbParams[0].value}`);

// Build summaries vary and read like a human wrote them
const s1 = buildOfflinePlugin("make a lush hall reverb").summary;
check("summary explains controls, not jargon-only", /tail rings out/i.test(s1) && /Not quite it\?/i.test(s1));
check("summary suggests working tweak words", /"longer"|"darker"|"drier"/.test(s1));

/* 7b. No-recipe prompts: primitive graph composer */
import("../src/utils/dspPrimitives").then(() => {});
const mangler = buildOfflinePlugin("granular texture mangler");
check("no-recipe: composes primitive stages", /STAGE 1/.test(mangler.dspFunction) && /STAGE 2/.test(mangler.dspFunction));
check("no-recipe: granular prompt gets pitch grains", /pitch shifter|rp1/.test(mangler.dspFunction), mangler.description.slice(0,80));
check("no-recipe: has a master mix", mangler.parameters.some(p => p.id === "mix"));
check("no-recipe: deterministic", buildOfflinePlugin("granular texture mangler").dspFunction === mangler.dspFunction);
const robot = buildOfflinePlugin("make a robotic metallic voice mangler");
check("no-recipe: robot prompt gets ring mod", robot.parameters.some(p => /^ringfreq/.test(p.id)), `params=[${robot.parameters.map(p => p.id)}]`);

/* --------------------------------------------------------------- */
/* 8. Gate hole regression: uncompilable code must score 0, not 100 */
/* --------------------------------------------------------------- */

const brokenPlugin: AudioPlugin = {
  ...basePlugin,
  id: "broken",
  dspFunction: "let mix = 1;\nlet mix = 2;\nreturn inputSample * mix;", // duplicate let -> SyntaxError
};
const brokenGate = runQualityGate(brokenPlugin);
check(
  "quality gate scores uncompilable DSP as musicality 0",
  brokenGate.scores.musicality === 0,
  `musicality=${brokenGate.scores.musicality}`
);
check(
  "build report on broken DSP: compiled=false, confidence=0",
  brokenGate.report.compiled === false && brokenGate.report.confidence === 0,
  `compiled=${brokenGate.report.compiled} conf=${brokenGate.report.confidence}`
);
check("build report never hides failure behind success text", /DID NOT COMPILE/.test(formatBuildReport(brokenGate.report)));

/* --------------------------------------------------------------- */
/* 8b. Architecture doc: UI spec, design attributes, build report   */
/* --------------------------------------------------------------- */

check("attribute detection: dreamy", detectDesignAttributes("a dreamy glass shimmer reverb")[0] === "dreamy");
check("attribute detection: aggressive", detectDesignAttributes("brutal metal amp").includes("aggressive"));
check("attribute detection: combines two", detectDesignAttributes("a dreamy but aggressive delay").length === 2);
check("attribute detection: none for plain prompts", detectDesignAttributes("a delay").length === 0);
check(
  "attribute detection: 'frozen' is dreamy, never minimal (zen substring)",
  JSON.stringify(detectDesignAttributes("shimmer reverb inspired by frozen cathedrals")) === JSON.stringify(["dreamy"])
);

const dreamyBuild = toPlugin("make a dreamy frozen cathedral shimmer reverb");
const dreamyGate = runQualityGate(dreamyBuild.plugin, { family: dreamyBuild.build.family, prompt: "make a dreamy frozen cathedral shimmer reverb", intent: "shimmer reverb" });
const r = dreamyGate.report;
check("report carries measured facts", r.compiled && r.audibleParams.length >= 3 && r.confidence >= 97, `conf=${r.confidence} audible=${r.audibleParams.length}`);
check("report carries design attributes", r.attributes.includes("dreamy"), `attrs=${r.attributes}`);
check("attribute theme applied to the faceplate", dreamyGate.plugin.customSkin?.bgColor === "#0d1020", `bg=${dreamyGate.plugin.customSkin?.bgColor}`);
check("primary controls ranked first in layout order", r.primaryControls.includes(dreamyGate.plugin.parameters[0].id), `first=${dreamyGate.plugin.parameters[0].id} primary=${r.primaryControls}`);
check("formatBuildReport reads as evidence", /verified audible/.test(formatBuildReport(r)) && /confidence \d+\/100/.test(formatBuildReport(r)));

/* --------------------------------------------------------------- */
/* 9. Spec classifier sanity for the routed prompts                 */
/* --------------------------------------------------------------- */

check("classifier still splits the EQ/saturator hybrid", classifyPluginIntent("an EQ where each band saturates").family === "multiband_saturator");

console.log(failures === 0 ? "\nOFFLINE BUILDER: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
