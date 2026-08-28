/**
 * Spec-first stage of the autonomous plugin factory harness.
 *
 * Core rule (from the harness design): natural language must NEVER go
 * directly to code. A request is first compiled into an AudioPluginSpec that
 * separates what the plugin LOOKS like (ui_metaphor) from what it actually
 * DOES to audio (dsp_identity). This is what keeps hybrid ideas -- "an EQ
 * where each node saturates its band" -- from collapsing into the closest
 * common category (a plain EQ).
 *
 * Pipeline:  prompt -> classifyPluginIntent (deterministic, instant)
 *                   -> generatePluginSpec  (local LLM refinement, optional)
 *                   -> formatSpecContext   (injected into the code-gen prompt)
 */

import { AudioPlugin } from "../types";
import { LLMConfig, callLocalLLM, isLocalProvider } from "./llmGateway";

export type PluginFamily =
  | "eq"
  | "filter"
  | "distortion"
  | "saturator"
  | "multiband_saturator"
  | "delay"
  | "reverb"
  | "modulation"
  | "dynamics"
  | "synthesizer"
  | "pitch"
  | "amp_sim"
  | "sampler"
  | "utility"
  | "hybrid_other";

export interface AudioPluginSpec {
  name: string;
  family: PluginFamily;
  /** What the interface should look like ("parametric_eq", "stompbox", "channel_strip", "simple_knobs"). */
  uiMetaphor: string;
  /** One sentence: what the plugin ACTUALLY does to the audio signal. */
  dspIdentity: string;
  /** True when looks and behavior come from different families. */
  hybrid: boolean;
  extraCapabilities: string[];
  /** One sentence restating the goal in engineering terms. */
  interpretedGoal: string;
  /** How this spec was produced. */
  source: "llm" | "heuristic";
}

/** Map a spec family onto the app's 7-value category enum. */
export function familyToCategory(family: PluginFamily): AudioPlugin["category"] {
  switch (family) {
    case "eq":
    case "filter":
      return "filter";
    case "distortion":
    case "saturator":
    case "multiband_saturator":
      return "distortion";
    case "delay":
      return "delay";
    case "reverb":
      return "reverb";
    case "modulation":
      return "modulation";
    case "dynamics":
      return "dynamics";
    case "synthesizer":
    case "pitch":
    case "sampler":
      return "synthesizer";
    case "amp_sim":
      return "distortion";
    default:
      return "filter";
  }
}

interface FamilySignal {
  family: PluginFamily;
  /** Matches when the request DESCRIBES this behavior. */
  behavior: RegExp;
  /** Matches when the request wants this LOOK ("EQ-style", "looks like a pedal"). */
  uiMetaphor: string;
}

const FAMILY_SIGNALS: FamilySignal[] = [
  // "amp\b" was removed from the generic distortion signal below so a guitar
  // amp request gets its own dedicated family instead of collapsing into a
  // plain fuzz/drive pedal -- amp_sim carries a mandatory UI enforcement
  // (amp head + cab + mic) that a generic distortion pedal does not.
  { family: "amp_sim", behavior: /amp\s*sim|amplifier\s*sim|guitar\s*amp|bass\s*amp|tube\s*amp|amp\s*head|head\s*(?:and|&|\+)\s*cab|cab(?:inet)?\s*sim|4x12|halfstack|half.?stack/i, uiMetaphor: "amp_head_and_cab" },
  // Also carries mandatory UI enforcement (an 8-pad grid) so a drum-pad/MPC
  // request never renders as plain sliders.
  { family: "sampler", behavior: /sampler|sample\s*pad|drum\s*pad|beat\s*pad|\bmpc\b|pad\s*machine|drum\s*machine|finger\s*drum|one-?shot\s*(?:pad|trigger)/i, uiMetaphor: "pad_grid" },
  { family: "eq", behavior: /\beq\b|equali[sz]er|parametric|graphic eq|band gain|tone.?shap/i, uiMetaphor: "parametric_eq" },
  // Instrument-defining families are checked before mood/character families
  // below (reverb, saturator, distortion) so a name like "synth" or "pitch"
  // wins ties against generic descriptive words a mood request also happens
  // to contain (e.g. "ambient drone SYNTH pad" must not lose to "ambien"
  // inside the reverb signal just because reverb appears earlier).
  { family: "synthesizer", behavior: /\bsynth(?:esizer)?\b|drone|generative|arpegg|oscillator/i, uiMetaphor: "synth_panel" },
  // "tuner"/"retune" were in the pitch RECIPE's own match regex but missing
  // here, so "a vocal tuner ..." classified as hybrid_other and never
  // reached the pitch family at all.
  { family: "pitch", behavior: /pitch|autotune|auto.?tune|harmoni[sz]er|octav|transpose|\btuner\b|\bretune\b/i, uiMetaphor: "vocal_processor" },
  { family: "saturator", behavior: /satur|tape warm|tube warm|harmonic|excite|analog warm/i, uiMetaphor: "vintage_unit" },
  { family: "distortion", behavior: /dist|fuzz|overdrive|drive\b|clip|crunch|bitcrush|lo.?fi/i, uiMetaphor: "stompbox" },
  { family: "delay", behavior: /delay|echo|slapback|ping.?pong|dub\b/i, uiMetaphor: "tape_machine" },
  { family: "reverb", behavior: /reverb|room|hall|plate|shimmer|ambien|cathedral/i, uiMetaphor: "rack_unit" },
  // "spectral"/"fft"/"frequency domain" added deliberately BEFORE dynamics
  // in this array: dynamics' own behavior regex matches bare `gate\b` (a
  // noise gate), so "a spectral gate effect" hits BOTH families -- the
  // multi-hit fallback below picks hits[0] in array order with no UI
  // marker present, and modulation sits earlier here, so "spectral" wins
  // as intended rather than the coincidental "gate" overlap.
  { family: "modulation", behavior: /chorus|flang|phaser|vibrato|tremolo|wobble|ensemble|rotary|spectral|\bfft\b|frequency.?domain/i, uiMetaphor: "pedal" },
  { family: "dynamics", behavior: /compress|limit|expand|gate\b|duck|squash|glue|punch/i, uiMetaphor: "channel_strip" },
  { family: "filter", behavior: /filter|cutoff|lowpass|highpass|bandpass|wah|resonan/i, uiMetaphor: "synth_panel" },
];

/** Phrases that mark the FOLLOWING family reference as a look, not a behavior. */
const UI_METAPHOR_MARKERS = /looks? like|styled? (?:like|as)|ui (?:of|like)|interface (?:of|like)|shaped like|appears? (?:like|as)|-style|disguised as/i;

/**
 * Per-family DSP identity for a single-family (non-hybrid) request. Most
 * families are self-describing, but a few carry a mandatory behavior that the
 * naive reading would flatten -- pitch especially, which must be a real tuner
 * (detect -> snap -> correct) and not degrade into a manual pitch shifter.
 */
function dspIdentityFor(family: PluginFamily): string {
  if (family === "pitch") {
    return "real-time pitch CORRECTION (autotune): detect the input's fundamental via autocorrelation, snap it to the selected key + scale, and resynthesize at the corrected pitch with formant preservation -- expose Key (with an Auto key-detect mode), Scale, Retune Speed, and Formant. This is a tuner, NOT a fixed/manual pitch shift.";
  }
  return `${family} processing as described`;
}

/**
 * Deterministic classification. Instant and offline; also the ground truth
 * fallback whenever the LLM spec stage is unavailable or returns junk.
 *
 * Hybrid rule: when the request matches multiple families, the family whose
 * keyword appears NEAR a "looks like"-marker is the UI metaphor, and the
 * other match is the real DSP identity. "An EQ where each band saturates"
 * therefore becomes family=multiband_saturator, uiMetaphor=parametric_eq.
 */
export function classifyPluginIntent(userPrompt: string): AudioPluginSpec {
  const hits = FAMILY_SIGNALS.filter((s) => s.behavior.test(userPrompt));

  if (hits.length === 0) {
    return {
      name: "Custom Processor",
      family: "hybrid_other",
      uiMetaphor: "simple_knobs",
      dspIdentity: "custom audio processing derived from the user's description",
      hybrid: false,
      extraCapabilities: [],
      interpretedGoal: userPrompt.slice(0, 160),
      source: "heuristic",
    };
  }

  if (hits.length === 1) {
    const only = hits[0];
    return {
      name: "",
      family: only.family,
      uiMetaphor: only.uiMetaphor,
      dspIdentity: dspIdentityFor(only.family),
      hybrid: false,
      extraCapabilities: [],
      interpretedGoal: userPrompt.slice(0, 160),
      source: "heuristic",
    };
  }

  // Multiple families matched: decide which one is only the LOOK.
  let uiFamily: FamilySignal | null = null;
  const markerMatch = userPrompt.match(UI_METAPHOR_MARKERS);
  if (markerMatch && markerMatch.index !== undefined) {
    // The family keyword closest AFTER the marker is the look.
    let bestDist = Infinity;
    for (const hit of hits) {
      const kw = userPrompt.slice(markerMatch.index).match(hit.behavior);
      if (kw && kw.index !== undefined && kw.index < bestDist) {
        bestDist = kw.index;
        uiFamily = hit;
      }
    }
  }
  // Without an explicit marker, EQ/filter UIs are the common disguise
  // ("an EQ that saturates each band") -- treat the tone-shaping family as
  // the look and the "active" family (saturation/dynamics/etc.) as behavior.
  if (!uiFamily) {
    uiFamily = hits.find((h) => h.family === "eq" || h.family === "filter") || null;
  }

  const behaviorHits = uiFamily ? hits.filter((h) => h !== uiFamily) : hits;
  const behavior = behaviorHits[0] || hits[0];

  const isEqSaturator =
    uiFamily !== null &&
    (uiFamily.family === "eq" || uiFamily.family === "filter") &&
    (behavior.family === "saturator" || behavior.family === "distortion");

  return {
    name: "",
    family: isEqSaturator ? "multiband_saturator" : behavior.family,
    uiMetaphor: uiFamily ? (uiFamily.family === "eq" ? "parametric_eq" : uiFamily.uiMetaphor) : behavior.uiMetaphor,
    dspIdentity: isEqSaturator
      ? "frequency-selective saturation: isolate each band, saturate it, blend back with the dry signal (NOT plain filter gain changes)"
      : `${behavior.family} processing presented through a ${uiFamily ? uiFamily.family : behavior.family}-style interface`,
    hybrid: uiFamily !== null && behaviorHits.length > 0,
    extraCapabilities: [],
    interpretedGoal: userPrompt.slice(0, 160),
    source: "heuristic",
  };
}

/** System prompt for the LLM refinement of the spec stage. */
export const SPEC_SYSTEM_PROMPT = `You are the intent-classification stage of an audio plugin factory. You NEVER write DSP code. You convert a natural-language plugin request into a strict JSON spec that separates what the plugin LOOKS like from what it actually DOES to audio.
Return ONLY JSON:
{
  "name": "Creative product-style title",
  "family": "one of: eq | filter | distortion | saturator | multiband_saturator | delay | reverb | modulation | dynamics | synthesizer | pitch | amp_sim | sampler | utility | hybrid_other",
  "uiMetaphor": "what the interface resembles, e.g. parametric_eq, stompbox, tape_machine, channel_strip, amp_head_and_cab, pad_grid, simple_knobs",
  "dspIdentity": "ONE sentence describing what it truly does to the signal",
  "hybrid": true when the look and the behavior come from different families,
  "extraCapabilities": ["non-DSP capabilities like preset_matching, image_import -- usually empty"],
  "interpretedGoal": "one sentence restating the request in engineering terms"
}
CRITICAL rule for hybrids -- never force the idea into the closest common category:
- "an EQ where each node saturates its band" -> family multiband_saturator, uiMetaphor parametric_eq, hybrid true. The DSP is band isolation + per-band waveshaping + blend, NOT filter gain changes.
- "a compressor that feels like tape" -> family dynamics with saturation coloring, hybrid true. Not a tape delay.
- "a delay that sounds underwater" -> family delay with lowpassed repeats, hybrid false (one family, flavored).
CRITICAL rule for two UI-mandatory families -- these ALWAYS get a specific fixed UI regardless of what else the request mentions:
- Any guitar/bass amp or amplifier simulator (family amp_sim) ALWAYS gets an amp head + a speaker cabinet + mic positioning on the cabinet -- every single time, never optional.
- Any sampler/drum-pad/MPC/beat-pad request (family sampler) ALWAYS gets an 8-pad trigger grid layout, never plain sliders.
CRITICAL rule for pitch/autotune (family pitch) -- an autotune/tuner request is pitch CORRECTION, not a manual pitch shift:
- The dspIdentity must be "detect the fundamental (autocorrelation), snap it to a selected key + scale, resynthesize at the corrected pitch with formant preservation" -- with a Key control that includes an Auto key-detect mode, plus Scale, Retune Speed, and Formant. Never reduce it to a single "Pitch Shift" knob.`;

/**
 * Full spec stage: deterministic classification first, then (when a local
 * model is reachable) a fast LLM refinement that can catch phrasing the
 * keyword heuristics miss. The heuristic result is the safety net -- an LLM
 * answer is only accepted when structurally valid.
 */
export async function generatePluginSpec(userPrompt: string, config: LLMConfig): Promise<AudioPluginSpec> {
  const heuristic = classifyPluginIntent(userPrompt);

  if (!isLocalProvider(config)) return heuristic;

  try {
    const payload = await callLocalLLM({
      config,
      systemPrompt: SPEC_SYSTEM_PROMPT,
      userText: userPrompt,
      temperature: 0.2,
    });
    const validFamilies: PluginFamily[] = [
      "eq", "filter", "distortion", "saturator", "multiband_saturator", "delay",
      "reverb", "modulation", "dynamics", "synthesizer", "pitch", "amp_sim", "sampler",
      "utility", "hybrid_other",
    ];
    if (
      payload &&
      typeof payload.dspIdentity === "string" && payload.dspIdentity.trim() &&
      typeof payload.family === "string" && validFamilies.includes(payload.family as PluginFamily)
    ) {
      return {
        name: typeof payload.name === "string" ? payload.name : heuristic.name,
        family: payload.family as PluginFamily,
        uiMetaphor: typeof payload.uiMetaphor === "string" && payload.uiMetaphor ? payload.uiMetaphor : heuristic.uiMetaphor,
        dspIdentity: payload.dspIdentity,
        hybrid: !!payload.hybrid,
        extraCapabilities: Array.isArray(payload.extraCapabilities) ? payload.extraCapabilities.filter((c: any) => typeof c === "string") : [],
        interpretedGoal: typeof payload.interpretedGoal === "string" && payload.interpretedGoal ? payload.interpretedGoal : heuristic.interpretedGoal,
        source: "llm",
      };
    }
  } catch {
    // fall through to heuristic
  }
  return heuristic;
}

/** Compact spec block injected into the code-generation prompt. */
export function formatSpecContext(spec: AudioPluginSpec): string {
  const lines = [
    `[PLUGIN SPEC -- build EXACTLY this; do not drift toward a more common plugin type:`,
    `family: ${spec.family}${spec.hybrid ? " (HYBRID -- the look and the behavior are different families)" : ""}`,
    `ui metaphor (what it looks like): ${spec.uiMetaphor}`,
    `dsp identity (what it must DO to the audio): ${spec.dspIdentity}`,
    `goal: ${spec.interpretedGoal}`,
  ];
  if (spec.extraCapabilities.length > 0) {
    lines.push(`extra capabilities: ${spec.extraCapabilities.join(", ")}`);
  }
  lines.push(`Set the plugin "category" to "${familyToCategory(spec.family)}".]`);
  return lines.join("\n");
}

/**
 * Cheap gate: does this chat message actually ask for something to be built
 * or changed? Pure questions skip the spec stage entirely (zero latency
 * cost for conversation).
 */
export function looksLikeBuildRequest(userPrompt: string): boolean {
  if (/\b(make|build|create|design|generate|give me|i want|add|turn|change|tweak|fix|improve|more|less)\b/i.test(userPrompt)) return true;
  return FAMILY_SIGNALS.some((s) => s.behavior.test(userPrompt));
}
