/**
 * Per-family FEATURE MANIFEST — what controls a real unit of each family
 * actually has.
 *
 * Why this exists: the factory optimizes for what it measures, and until now
 * nothing measured AMBITION. The four headline scores saturate (a correct
 * build hits 100/100/100/100), and functional fitness only asks "does it do
 * its family's job?" — which a 3-knob compressor technically does. So there
 * was no gradient anywhere pointing toward depth, and the deterministic
 * recipes set a hard ceiling: 39 parameters across 10 recipes, averaging 3.9
 * controls per plugin. The shipped compressor was threshold + ratio + makeup
 * — no attack, no release, the two controls that most define how a
 * compressor SOUNDS.
 *
 * One manifest, four payoffs:
 *   1. Recipes have a target to grow toward (and a test that says when they
 *      fall short).
 *   2. `measureFeatureDepth()` scores coverage — informational, feeding
 *      `refinementScore()` so best-of-N PREFERS the richer build instead of
 *      being indifferent between a 3-knob and an 8-knob compressor.
 *   3. The LLM prompt can state the real vocabulary of each family instead
 *      of generic "add some parameters" guidance.
 *   4. The auto-generated manual writes itself: every entry already carries
 *      a one-sentence `purpose`, so documentation stops being a separate
 *      authoring problem.
 *
 * IMPORTANT — this cannot degrade into knob-spam. The existing quality gate
 * already measures every parameter for audibility and reports `deadParams`;
 * a control that does nothing is flagged and penalized. So the manifest can
 * only be satisfied by knobs that genuinely DO something. Depth and honesty
 * are enforced by two different mechanisms pulling in the same direction.
 */

import { PluginParameter } from "../types";
import { PluginFamily } from "./pluginSpec";

/** How central a control is to the family's identity. */
export type FeatureTier = "required" | "expected" | "advanced";

export interface FeatureSpec {
  /** Canonical parameter id a recipe or model should use. */
  id: string;
  name: string;
  /** ONE sentence, user-facing: what this control does and why you'd reach
   *  for it. This is the text the auto-generated manual renders verbatim. */
  purpose: string;
  tier: FeatureTier;
  /** Recognizes the control under alternate names a model might pick
   *  ("atk" for attack, "hpf" for a sidechain filter, ...). Matched against
   *  the parameter's id AND display name. */
  match: RegExp;
  /** Range hint so independently-generated builds converge on the same
   *  semantics rather than each inventing their own scale. */
  min?: number;
  max?: number;
  defaultValue?: number;
  unit?: string;
}

/**
 * The vocabulary of each family, as a real unit would have it. Tiers:
 *   required — without these it is not honestly a member of the family
 *   expected — a real unit has these; their absence is what reads as "thin"
 *   advanced — differentiators that separate a good unit from a basic one
 */
export const FEATURE_MANIFEST: Partial<Record<PluginFamily, FeatureSpec[]>> = {
  dynamics: [
    { id: "threshold", name: "Threshold", tier: "required", match: /thresh/i, min: -48, max: 0, defaultValue: -24, unit: "dB",
      purpose: "The level the signal has to exceed before the compressor starts turning it down." },
    { id: "ratio", name: "Ratio", tier: "required", match: /ratio/i, min: 1, max: 20, defaultValue: 4, unit: ":1",
      purpose: "How hard it clamps once over the threshold — 4:1 means 4 dB in becomes 1 dB out." },
    { id: "attack", name: "Attack", tier: "expected", match: /attack|^atk$/i, min: 0.1, max: 100, defaultValue: 10, unit: "ms",
      purpose: "How quickly it grabs a loud sound. Fast tames transients; slow lets the initial hit punch through." },
    { id: "release", name: "Release", tier: "expected", match: /release|^rel$/i, min: 10, max: 1000, defaultValue: 150, unit: "ms",
      purpose: "How quickly it lets go once the signal drops. Too fast pumps audibly; too slow chokes the next note." },
    { id: "makeup", name: "Makeup", tier: "expected", match: /makeup|make.?up|out.?gain/i, min: 0, max: 24, defaultValue: 3, unit: "dB",
      purpose: "Adds back the level compression removed, so you can hear the effect without it just sounding quieter." },
    { id: "knee", name: "Knee", tier: "advanced", match: /knee/i, min: 0, max: 24, defaultValue: 6, unit: "dB",
      purpose: "Softens the transition into compression, so it eases in around the threshold instead of switching on abruptly." },
    { id: "mix", name: "Mix", tier: "advanced", match: /^mix$|blend|parallel|dry.?wet/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "Blends compressed with dry signal — parallel compression, which adds density while keeping the original dynamics." },
    { id: "scHpf", name: "SC HPF", tier: "advanced", match: /sidechain|side.?chain|sc.?hpf|sc.?filter|detector.?hpf/i, min: 20, max: 500, defaultValue: 80, unit: "Hz",
      purpose: "Stops bass from triggering the compressor, so kick and low end don't pump the whole mix down." },
  ],

  eq: [
    { id: "low", name: "Low", tier: "required", match: /^low$|low.?gain|bass/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Boosts or cuts the low end — weight and warmth." },
    { id: "mid", name: "Mid", tier: "required", match: /^mid$|mid.?gain/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Boosts or cuts the midrange, where most instruments' body and presence live." },
    { id: "high", name: "High", tier: "required", match: /^high$|high.?gain|treble/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Boosts or cuts the top end — air and brightness." },
    { id: "midFreq", name: "Mid Freq", tier: "expected", match: /mid.?freq/i, min: 250, max: 5000, defaultValue: 1200, unit: "Hz",
      purpose: "Moves the mid band to the exact frequency you want to shape." },
    { id: "output", name: "Output", tier: "expected", match: /output|^level$|^gain$|trim/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Compensates the overall level after boosting or cutting bands." },
    { id: "midQ", name: "Mid Q", tier: "advanced", match: /^q$|\bq\b|bandwidth|reson/i, min: 0.3, max: 8, defaultValue: 1, unit: "Q",
      purpose: "Narrows or widens the mid band — surgical notch versus broad tone shaping." },
    { id: "lowFreq", name: "Low Freq", tier: "advanced", match: /low.?freq/i, min: 40, max: 500, defaultValue: 120, unit: "Hz",
      purpose: "Sets where the low shelf takes hold." },
    { id: "highFreq", name: "High Freq", tier: "advanced", match: /high.?freq/i, min: 2000, max: 16000, defaultValue: 6000, unit: "Hz",
      purpose: "Sets where the high shelf takes hold." },
  ],

  filter: [
    { id: "cutoff", name: "Cutoff", tier: "required", match: /cutoff|^freq|frequency/i, min: 60, max: 12000, defaultValue: 1400, unit: "Hz",
      purpose: "The corner frequency — everything past it gets rolled off." },
    { id: "resonance", name: "Resonance", tier: "required", match: /reson|^q$/i, min: 0, max: 0.9, defaultValue: 0.4, unit: "ratio",
      purpose: "Emphasizes frequencies right at the cutoff, adding the vocal peak that makes filter sweeps sing." },
    { id: "drive", name: "Drive", tier: "expected", match: /drive|satur/i, min: 0, max: 24, defaultValue: 0, unit: "dB",
      purpose: "Saturates the filter, so pushing resonance gets thick and analog instead of thin and digital." },
    { id: "mix", name: "Mix", tier: "expected", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "Blends filtered with dry signal." },
    { id: "mode", name: "Mode", tier: "advanced", match: /mode|type|slope|shape/i, min: 0, max: 2, defaultValue: 0, unit: "",
      purpose: "Switches between lowpass, highpass, and bandpass response." },
    { id: "envAmount", name: "Env Amount", tier: "advanced", match: /env|follow|track|sweep/i, min: 0, max: 1, defaultValue: 0, unit: "ratio",
      purpose: "Lets the input's own level move the cutoff — the auto-wah effect." },
  ],

  distortion: [
    { id: "drive", name: "Drive", tier: "required", match: /drive|^gain$|dist|fuzz/i, min: 0, max: 24, defaultValue: 8, unit: "dB",
      purpose: "How hard the signal is pushed into the clipping stage — the main dirt control." },
    { id: "tone", name: "Tone", tier: "expected", match: /tone|bright|^lpf$|filter/i, min: 500, max: 12000, defaultValue: 4500, unit: "Hz",
      purpose: "Rolls off fizz above this point — the difference between cutting and harsh." },
    { id: "mix", name: "Mix", tier: "expected", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "Blends distorted with dry signal, keeping the original attack intact underneath." },
    { id: "output", name: "Output", tier: "expected", match: /output|^level$|master|volume/i, min: -24, max: 6, defaultValue: 0, unit: "dB",
      purpose: "Sets the final level, since heavy drive changes loudness a lot." },
    { id: "bias", name: "Bias", tier: "advanced", match: /bias|asym|symmetry/i, min: -1, max: 1, defaultValue: 0, unit: "ratio",
      purpose: "Offsets the waveform before clipping, generating even harmonics — the warm, tube-like flavor rather than fizzy odd ones." },
    { id: "character", name: "Character", tier: "advanced", match: /character|curve|type|stage|clip.?mode/i, min: 0, max: 3, defaultValue: 0, unit: "",
      purpose: "Selects the clipping curve — soft tube, harder transistor, or hard-clipped fuzz." },
    { id: "gate", name: "Gate", tier: "advanced", match: /gate|noise|squelch/i, min: -80, max: -20, defaultValue: -70, unit: "dB",
      purpose: "Silences hiss between notes, which high gain otherwise amplifies badly." },
  ],

  delay: [
    { id: "time", name: "Time", tier: "required", match: /time|delay(?!.*feed)|^ms$/i, min: 20, max: 1500, defaultValue: 350, unit: "ms",
      purpose: "How long before the echo returns." },
    { id: "feedback", name: "Feedback", tier: "required", match: /feedback|repeat|regen/i, min: 0, max: 0.95, defaultValue: 0.35, unit: "ratio",
      purpose: "How much of the echo feeds back in — one slap versus a long trailing cascade." },
    { id: "mix", name: "Mix", tier: "required", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 0.35, unit: "ratio",
      purpose: "Balance of echoes against the dry signal." },
    { id: "tone", name: "Tone", tier: "expected", match: /tone|damp|^lpf$|filter|dark/i, min: 500, max: 12000, defaultValue: 4000, unit: "Hz",
      purpose: "Darkens each successive repeat, so echoes fade back instead of cluttering the top end." },
    { id: "width", name: "Width", tier: "advanced", match: /width|stereo|ping.?pong|spread/i, min: 0, max: 1, defaultValue: 0, unit: "ratio",
      purpose: "Spreads repeats across the stereo field, bouncing them left to right." },
    { id: "wow", name: "Wow", tier: "advanced", match: /wow|flutter|warp|modul|tape/i, min: 0, max: 1, defaultValue: 0, unit: "ratio",
      purpose: "Wavers the delay time slightly, the pitch drift of tape that keeps long repeats from sounding sterile." },
  ],

  reverb: [
    { id: "decay", name: "Decay", tier: "required", match: /decay|size|time|room|rt60/i, min: 0, max: 1, defaultValue: 0.5, unit: "ratio",
      purpose: "How long the tail rings out — small room through long hall." },
    { id: "mix", name: "Mix", tier: "required", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 0.3, unit: "ratio",
      purpose: "How much reverb sits behind the dry signal." },
    { id: "damp", name: "Damping", tier: "expected", match: /damp|tone|^hf$|absorb/i, min: 0, max: 1, defaultValue: 0.4, unit: "ratio",
      purpose: "How fast highs decay relative to lows — soft furnishings versus bare tile." },
    { id: "predelay", name: "Pre-Delay", tier: "expected", match: /pre.?delay|pre.?dly/i, min: 0, max: 200, defaultValue: 20, unit: "ms",
      purpose: "Gap before the reverb starts, which keeps the dry source clear and defines room size." },
    { id: "width", name: "Width", tier: "advanced", match: /width|stereo|spread/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "How wide the tail spreads across the stereo image." },
    { id: "lowCut", name: "Low Cut", tier: "advanced", match: /low.?cut|^hpf$|high.?pass|rumble/i, min: 20, max: 500, defaultValue: 100, unit: "Hz",
      purpose: "Keeps low end out of the tail so the reverb doesn't muddy the mix." },
    { id: "modulation", name: "Modulation", tier: "advanced", match: /modul|chorus|shimmer|move/i, min: 0, max: 1, defaultValue: 0, unit: "ratio",
      purpose: "Gently moves the tail, preventing the metallic ringing a static reverb can develop." },
  ],

  modulation: [
    { id: "rate", name: "Rate", tier: "required", match: /rate|speed|^lfo$|freq/i, min: 0.05, max: 12, defaultValue: 0.8, unit: "Hz",
      purpose: "How fast the effect sweeps." },
    { id: "depth", name: "Depth", tier: "required", match: /depth|amount|intensity/i, min: 0, max: 1, defaultValue: 0.5, unit: "ratio",
      purpose: "How far the sweep travels — subtle shimmer through seasick warble." },
    { id: "mix", name: "Mix", tier: "expected", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 0.5, unit: "ratio",
      purpose: "Blend against dry — the interference between the two is what creates the swoosh." },
    { id: "feedback", name: "Feedback", tier: "advanced", match: /feedback|regen|resonance/i, min: 0, max: 0.9, defaultValue: 0, unit: "ratio",
      purpose: "Feeds output back in, sharpening a gentle chorus into a jet-plane flanger." },
    { id: "width", name: "Width", tier: "advanced", match: /width|stereo|spread|phase/i, min: 0, max: 1, defaultValue: 0.5, unit: "ratio",
      purpose: "Offsets the sweep between left and right for a wide stereo image." },
    { id: "shape", name: "Shape", tier: "advanced", match: /shape|wave|type|stages/i, min: 0, max: 3, defaultValue: 0, unit: "",
      purpose: "Selects the LFO waveform or stage count, changing the sweep's character." },
  ],

  pitch: [
    { id: "key", name: "Key", tier: "required", match: /^key$|root|tonic/i, min: 0, max: 12, defaultValue: 0, unit: "",
      purpose: "The key to snap to. Zero means auto-detect it from what you play." },
    { id: "scale", name: "Scale", tier: "required", match: /scale|mode/i, min: 0, max: 3, defaultValue: 1, unit: "",
      purpose: "Which notes are allowed — chromatic, major, minor, or pentatonic." },
    { id: "speed", name: "Retune Speed", tier: "required", match: /speed|retune|glide|time/i, min: 0, max: 100, defaultValue: 20, unit: "ms",
      purpose: "How fast it snaps to pitch. Zero is the hard robotic effect; higher slides naturally." },
    { id: "formant", name: "Formant", tier: "expected", match: /formant|gender|throat/i, min: -12, max: 12, defaultValue: 0, unit: "st",
      purpose: "Shifts vocal character independently of pitch — avoids chipmunk artifacts, or creates them deliberately." },
    { id: "mix", name: "Mix", tier: "expected", match: /^mix$|blend|dry.?wet/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "Blends corrected with original, for a natural half-corrected sound." },
    { id: "amount", name: "Amount", tier: "advanced", match: /amount|strength|depth/i, min: 0, max: 1, defaultValue: 1, unit: "ratio",
      purpose: "How completely it corrects — partial amounts keep human expression intact." },
  ],

  synthesizer: [
    { id: "freq", name: "Root Frequency", tier: "required", match: /freq|pitch|root|tune|note/i, min: 55, max: 880, defaultValue: 220, unit: "Hz",
      purpose: "The pitch the oscillators play." },
    { id: "level", name: "Level", tier: "required", match: /^level$|volume|amp|output|gain/i, min: 0, max: 1, defaultValue: 0.6, unit: "ratio",
      purpose: "Output volume of the voice." },
    { id: "cutoff", name: "Cutoff", tier: "expected", match: /cutoff|filter|brightness/i, min: 200, max: 8000, defaultValue: 2500, unit: "Hz",
      purpose: "Filters the oscillators — the main tone-shaping control on any synth." },
    { id: "detune", name: "Detune", tier: "expected", match: /detune|spread|unison|width/i, min: 0, max: 50, defaultValue: 12, unit: "cents",
      purpose: "Offsets the second oscillator slightly, creating the slow beating that makes a pad sound wide." },
    { id: "resonance", name: "Resonance", tier: "advanced", match: /reson|^q$|emphasis/i, min: 0, max: 0.9, defaultValue: 0.3, unit: "ratio",
      purpose: "Peaks the filter at its cutoff for a more vocal, singing character." },
    { id: "attack", name: "Attack", tier: "advanced", match: /attack|^atk$|fade.?in/i, min: 0, max: 2000, defaultValue: 200, unit: "ms",
      purpose: "How slowly the note fades in — instant for plucks, long for evolving pads." },
    { id: "release", name: "Release", tier: "advanced", match: /release|^rel$|fade.?out|decay/i, min: 0, max: 4000, defaultValue: 500, unit: "ms",
      purpose: "How long the note takes to fade away after it ends." },
  ],

  amp_sim: [
    { id: "gain", name: "Gain", tier: "required", match: /gain|drive|preamp/i, min: 0, max: 24, defaultValue: 12, unit: "dB",
      purpose: "Preamp drive — clean through fully saturated." },
    { id: "bass", name: "Bass", tier: "required", match: /bass|^low$/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Low end of the tone stack — chug and weight." },
    { id: "mid", name: "Mid", tier: "required", match: /^mid$|midrange/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Midrange of the tone stack. Scooping it gives modern metal; pushing it cuts through a mix." },
    { id: "treble", name: "Treble", tier: "required", match: /treble|^high$/i, min: -12, max: 12, defaultValue: 0, unit: "dB",
      purpose: "Top end of the tone stack — bite and attack." },
    { id: "presence", name: "Presence", tier: "expected", match: /presence|air|sparkle/i, min: 0, max: 10, defaultValue: 5, unit: "",
      purpose: "Upper-treble lift in the power amp, adding cut without the harshness of raw treble." },
    { id: "master", name: "Master", tier: "expected", match: /master|output|volume|^level$/i, min: 0, max: 10, defaultValue: 5, unit: "",
      purpose: "Power-amp level, which sets overall loudness independently of preamp gain." },
    { id: "gate", name: "Gate", tier: "advanced", match: /gate|noise|squelch/i, min: -80, max: -20, defaultValue: -70, unit: "dB",
      purpose: "Silences hiss and hum between riffs, essential at high gain." },
  ],
};

/** Does this parameter set contain the control described by `spec`? */
function findFeature(parameters: PluginParameter[], spec: FeatureSpec): PluginParameter | undefined {
  return parameters.find((p) => spec.match.test(p.id) || spec.match.test(p.name));
}

export interface FeatureDepth {
  /** 0-100 coverage of the family's real control vocabulary. */
  score: number;
  /** Controls present, by tier. */
  present: { required: string[]; expected: string[]; advanced: string[] };
  /** Controls a real unit of this family has, that this build lacks. */
  missing: { required: string[]; expected: string[]; advanced: string[] };
  /** Human-readable summary for the build report. */
  evidence: string;
}

/**
 * Score how completely a build covers its family's real control vocabulary.
 *
 * Weighting reflects what actually makes a plugin feel thin: missing a
 * REQUIRED control means it is barely the thing it claims to be, missing
 * EXPECTED controls is precisely the "works but feels minimal" complaint,
 * and ADVANCED controls are the differentiators — nice, never obligatory.
 *
 * Informational only. This never gates shipping; it ranks candidates inside
 * refinementScore() so the search prefers a richer build over a thin one
 * when both are correct.
 */
export function measureFeatureDepth(parameters: PluginParameter[], family: PluginFamily | null | undefined): FeatureDepth | null {
  if (!family) return null;
  const manifest = FEATURE_MANIFEST[family];
  if (!manifest || manifest.length === 0) return null;

  const present = { required: [] as string[], expected: [] as string[], advanced: [] as string[] };
  const missing = { required: [] as string[], expected: [] as string[], advanced: [] as string[] };

  for (const spec of manifest) {
    const hit = findFeature(parameters, spec);
    (hit ? present : missing)[spec.tier].push(spec.name);
  }

  const ratio = (tier: FeatureTier) => {
    const total = present[tier].length + missing[tier].length;
    return total === 0 ? 1 : present[tier].length / total;
  };

  const score = Math.round((ratio("required") * 0.4 + ratio("expected") * 0.45 + ratio("advanced") * 0.15) * 100);

  const parts: string[] = [
    `${present.required.length}/${present.required.length + missing.required.length} core`,
    `${present.expected.length}/${present.expected.length + missing.expected.length} expected`,
    `${present.advanced.length}/${present.advanced.length + missing.advanced.length} advanced`,
  ];
  const gaps = [...missing.required, ...missing.expected];
  const evidence =
    gaps.length > 0
      ? `covers ${parts.join(", ")} controls a real ${family} has — missing ${gaps.join(", ")}`
      : `covers ${parts.join(", ")} controls a real ${family} has`;

  return { score, present, missing, evidence };
}

/** Prompt-ready description of a family's control vocabulary, so the model
 *  is told what a real unit has instead of generic "add parameters" advice. */
export function formatManifestForPrompt(family: PluginFamily | null | undefined): string {
  if (!family) return "";
  const manifest = FEATURE_MANIFEST[family];
  if (!manifest || manifest.length === 0) return "";
  const line = (t: FeatureTier) =>
    manifest
      .filter((s) => s.tier === t)
      .map((s) => `${s.id} (${s.name}, ${s.unit || "—"}): ${s.purpose}`)
      .join("\n  - ");
  const required = line("required");
  const expected = line("expected");
  const advanced = line("advanced");
  return `CONTROL VOCABULARY for a ${family} — a real unit has these, and a build that ships only two or three of them reads as a toy. Every control you include must genuinely affect the audio (dead knobs are detected and rejected), so add a control only when you also implement it.
REQUIRED (without these it is not honestly a ${family}):
  - ${required}
EXPECTED (their absence is exactly what makes a plugin feel minimal):
  - ${expected}${advanced ? `\nADVANCED (differentiators — include what fits the request):\n  - ${advanced}` : ""}`;
}
