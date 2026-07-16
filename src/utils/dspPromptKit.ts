/**
 * Shared prompt-engineering kit for turning natural language into working DSP.
 *
 * Local models (Ollama / LM Studio) get much weaker guidance than the Gemini
 * cloud path did, which is the main reason NL->plugin quality was poor. This
 * module centralizes one precise contract for the generated dspFunction, a
 * worked example, the updatedPlugin JSON shape, and the amp/cab visual
 * component vocabulary -- so every generation path (chat, architect, repair)
 * speaks the same language.
 */

/**
 * The exact runtime contract for dspFunction. This is the part models get
 * wrong most often: wrong signature assumptions, allocations per-sample,
 * missing state init, unclamped output.
 */
export const DSP_CODING_RULES = `DSP FUNCTION CONTRACT -- the "dspFunction" string is the BODY of:
  function(inputSample, params, state, inputR) { ...; return outputSample; }
It runs once per audio sample at 44100 Hz in a real-time loop.
STEREO (opt-in): for mono effects, ignore inputR entirely and just return the sample.
For genuinely stereo effects (ping-pong, mid-side, width), read the right input as
  let inR = inputR !== undefined ? inputR : inputSample;
write the right output to state.outR EVERY sample, and return the left output.
Never set state.outR from a mono effect. Hard rules:
1. Initialize ALL persistent state exactly once:
   if (!state.init) { state.buf = new Float32Array(44100); state.ptr = 0; state.y1 = 0; state.init = true; }
   NEVER allocate arrays/objects outside that init guard -- per-sample allocation stutters audio.
2. Read every control as: let x = params.<id> !== undefined ? params.<id> : <defaultValue>;
   Only use parameter ids that appear in the "parameters" array you return.
3. inputSample is a number in [-1, 1]. Return a single finite number, soft-limited:
   return Math.tanh(y);  // or Math.max(-1, Math.min(1, y))
4. Guard the classic blowups: never divide by a value that can reach 0; clamp feedback
   coefficients below 1.0 (e.g. fb = Math.min(0.98, fb)); wrap ring-buffer indices with
   modulo; keep filter coefficients in stable ranges.
5. Real algorithms only -- biquads with proper RBJ coefficients, tanh/asymmetric
   waveshapers, interpolated delay lines, envelope followers with attack/release
   smoothing. No stubs, no "return inputSample" placeholders.

WORKED EXAMPLE (a valid dspFunction body for a resonant lowpass):
if (!state.init) { state.lp1 = 0; state.lp2 = 0; state.init = true; }
let cutoff = params.cutoff !== undefined ? params.cutoff : 1000;
let res = params.resonance !== undefined ? params.resonance : 0.3;
let g = Math.min(0.99, 2 * Math.PI * cutoff / 44100);
let fbk = res * (state.lp1 - state.lp2);
state.lp1 = state.lp1 + g * (inputSample - state.lp1 + fbk);
state.lp2 = state.lp2 + g * (state.lp1 - state.lp2);
return Math.tanh(state.lp2);`;

/**
 * Sound-quality guidance -- the difference between "compiles" and "sounds
 * good on first play". Models reliably produce technically-valid DSP that is
 * too quiet, too harsh, or clicks when knobs move; these rules fix that.
 */
export const SOUND_QUALITY_RULES = `SOUND QUALITY -- the plugin must sound GOOD immediately at default settings:
1. Gain staging: the processed output should be roughly as loud as the input at defaults.
   After heavy drive/distortion, compensate level back down; after filtering, don't leave the
   signal buried. Never return a near-silent or ear-splitting result at defaults.
2. Every effect that transforms the signal (delay, reverb, modulation, distortion) gets a
   "mix" (dry/wet, 0-1) parameter defaulting to a tasteful blend, and an output level control
   where useful. Pure utilities (EQ, compressor) can skip mix.
3. No zipper noise: smooth parameter-driven coefficients per sample instead of jumping,
   e.g. state.smoothCutoff += 0.001 * (cutoff - state.smoothCutoff);
4. Avoid harshness: soft-clip with tanh instead of hard clipping; roll off harsh highs after
   distortion with a gentle one-pole lowpass; keep resonance defaults moderate.
5. Defaults are the demo: choose defaultValue so the very first Play press sounds impressive
   and clearly demonstrates the effect -- audible but musical, not subtle to the point of
   sounding broken and not extreme to the point of noise.`;

/**
 * Chat reply style -- plain, short, human. Users compare this app to
 * ChatGPT/Claude/Gemini; walls of jargon and persona theater read as noise.
 */
export const RESPONSE_STYLE_RULES = `REPLY STYLE for the "text" field:
- 2 to 5 short sentences, plain language, like a friendly engineer texting a musician.
- Say what you built or changed, then what the 2-3 most important knobs do. Suggest one thing
  to try ("push Feedback past 0.7 for self-oscillating trails").
- No headers, no bullet-point walls, no equations unless asked, no role-play, no restating
  the user's request back at them, and never paste the code into the text.`;

/**
 * Parameter design guidance -- ranges that feel right under a mouse.
 */
export const PARAMETER_DESIGN_RULES = `PARAMETER DESIGN:
- 3 to 7 parameters. Musician-friendly names ("Drive", "Air", "Stomp"), snake_case ids.
- Physically sensible ranges/units: frequency 20-20000 Hz, gain -24..24 dB, time 1-2000 ms,
  ratios/mix 0-1, feedback 0-0.98. defaultValue must sit at a musically useful spot.`;

/**
 * Amp/cab visual component vocabulary. This trio is also enforced
 * deterministically after generation (see qualityGate.ts
 * enforceFamilyRequirements) -- so an amp sim gets the amp head, cabinet, and
 * mic positioning every single time even if the model ignores this
 * instruction. The prompt guidance still matters: it's what makes the DSP
 * character and the widget styling (tolex, knobs, grill, colors) actually
 * match the request instead of being generic placeholders.
 */
export const AMP_CAB_SCHEMA_GUIDANCE = `GUITAR/BASS AMP SIMULATORS -- MANDATORY, not optional: whenever the request is for a guitar/bass amp, amplifier simulator, or "amp sim", you MUST include, in addition to the functional DSP parameter sliders (preamp drive, tone stack knobs, etc.), ALL THREE of:
- exactly one parameter with "controlType": "amp" (renders as a full amp head faceplate)
- exactly one parameter with "controlType": "cab" (renders as a speaker cabinet)
- exactly one parameter with "controlType": "mic" (renders as mic-on-cabinet positioning -- distance + off-axis)
This trio is REQUIRED on every amp sim, every time, even if the user only asked for "an amp" -- a real amp rig always has a head, a cab, and a mic on the cab. For each, also set:
- "customText": a fitting brand-style name for the amp/cab (e.g. "PLEXI 50W", "V30 SHREDHEAD MKII")
- "accentColor" (hex) matching the requested genre/mood
- for the "amp" one: "ampTolexPattern" (leather|carbon|tweed|wood|snakeskin|metalgrid), "ampKnobStyle" (chickenhead|silvercap|pointer|neonring|vintage), "ampChannelType" (clean|crunch|lead|modern), "ampTubeGlow" (true/false)
- for the "cab" one: "cabGrillStyle" (weave|metalgrid|stripes|pinstripe|retro), "cabSize" (1x12|2x12|4x12|8x10), "cabMicModel" (SM57|R-121|MD421|C414)
Pick these to match the mood -- e.g. a death metal amp should lean ampChannelType "modern", ampTolexPattern "metalgrid" or "carbon", cabGrillStyle "metalgrid", dark/red/black colors, and ampTubeGlow true. Set "category" to "distortion".
For non-amp plugins you may still vary "controlType" per parameter for a richer UI: "knob" (default for continuous values), "slider" (long-throw values like mix/level), "toggle" (on/off switches). Set fontStyle ("sans" | "mono" | "serif" | "grotesk" | "orbitron") and accent colors when the user asks for a specific look.`;

/**
 * Sampler/drum-pad vocabulary. The 8-pad grid is also enforced
 * deterministically after generation, so this instruction's job is getting
 * the underlying synthesis character right, not just the widget count.
 */
export const SAMPLER_SCHEMA_GUIDANCE = `SAMPLERS / DRUM PADS / MPC-STYLE BEAT MAKERS -- MANDATORY, not optional: whenever the request is for a sampler, drum pad, beat pad, MPC, or finger-drumming instrument, the UI MUST be an 8-pad trigger grid, never plain sliders. Include exactly 8 parameters named pad_1 through pad_8, each with "controlType": "pad", "min": 0, "max": 127, "unit": "vel" -- give at least pad_1 a nonzero defaultValue so the plugin is audible immediately without the user pressing anything. This app has NO file/sample loading: "sampler" here means an 8-voice SYNTHESIZED drum instrument -- each pad_N parameter, when nonzero, should continuously gate a distinct synthesized voice (a sine-based kick/tom, a smoothed-noise snare/hat/clap, etc.) for as long as it's held, all mixed together and soft-limited. Never claim to load real audio files. Set "category" to "synthesizer".`;

/**
 * One shared description of the updatedPlugin JSON payload, used by both
 * Ollama and LM Studio chat branches (previously two divergent copies).
 */
export const UPDATED_PLUGIN_JSON_CONTRACT = `Return ONLY a valid JSON object:
{
  "text": "conversational reply -- what you built/changed and what the main knobs do",
  "updatedPlugin": {
    "pluginName": "Creative Title",
    "category": "one of: distortion | delay | filter | synthesizer | dynamics | modulation | reverb",
    "description": "2-sentence marketing pitch",
    "parameters": [
      { "id": "drive", "name": "Drive", "min": 0, "max": 24, "defaultValue": 6, "unit": "dB", "controlType": "knob" },
      { "id": "mix", "name": "Mix", "min": 0, "max": 1, "defaultValue": 0.35, "unit": "ratio", "controlType": "slider" }
    ],
    "dspFunction": "<JS body per the DSP FUNCTION CONTRACT>"
  }
}
Every parameter MUST include "controlType": "knob" for continuous values, "slider" for mix/level/output
values, "toggle" for on/off switches. You may also set "accentColor" (hex) per parameter to match the
plugin's mood. Do NOT include faustCode or cppJuceCode -- portable code is generated separately at
export time; keeping it out of this response makes generation ~3x faster.
Set "updatedPlugin": null ONLY when the user is purely asking a question with no create/modify/fix intent.
When modifying an existing plugin, preserve unrelated working parameters and code.`;

/** Full system prompt body for local-model chat generation. */
export function buildLocalChatSystemPrompt(agentName: string, agentInstruction: string, compact: boolean): string {
  if (compact) {
    return `You are ${agentName}, an elite audio DSP engineer.
${UPDATED_PLUGIN_JSON_CONTRACT}
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}
${RESPONSE_STYLE_RULES}
${AMP_CAB_SCHEMA_GUIDANCE}
${SAMPLER_SCHEMA_GUIDANCE}`;
  }
  return `You are ${agentName}, an elite audio DSP engineer and conversational plugin creator.
Agent profile: ${agentInstruction}

${UPDATED_PLUGIN_JSON_CONTRACT}

${DSP_CODING_RULES}

${SOUND_QUALITY_RULES}

${RESPONSE_STYLE_RULES}

${PARAMETER_DESIGN_RULES}

${AMP_CAB_SCHEMA_GUIDANCE}

${SAMPLER_SCHEMA_GUIDANCE}`;
}

/**
 * Repair prompt: given code that failed compilation or blew up in simulation,
 * ask the model for a corrected full payload. The verifier feeds real
 * failure evidence in the user message.
 */
export const REPAIR_SYSTEM_PROMPT = `You are an elite audio DSP debugging engineer. You will receive a JS DSP function body that FAILED automated verification -- possible failure classes: syntax error, NaN/Infinity output, amplitude blowup, heavy DC offset, SILENT output at default settings, parameters that have no audible effect between min and max, or real-time-safety violations (per-sample allocation, console/JSON/timers in the audio path).
Fix the root cause while preserving the intended sound and all parameter ids. For silence: check gain staging and that the wet path actually reaches the return value. For dead parameters: the code must read params.<id> and the value must influence the output math.
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}
Return ONLY JSON: { "dspFunction": "<corrected JS body>", "explanation": "<one sentence on what was wrong>" }`;

/**
 * Export-time translation: called lazily when the user opens the Export tab,
 * instead of on every generation -- the single biggest latency win.
 */
export const TRANSLATE_PORTABLE_PROMPT = `You are an elite DSP engineer translating a working JavaScript per-sample audio processor into portable implementations. You will receive the JS function body (contract: function(inputSample, params, state) -> outputSample, 44100 Hz) and its parameter list.
Return ONLY JSON:
{
  "faustCode": "<complete valid Faust (.dsp) implementation: import(\\"stdfaust.lib\\"); hslider per parameter; process = ...;>",
  "cppJuceCode": "<complete real-time-safe JUCE C++ processor class implementing the same algorithm: no allocation in processBlock, parameter smoothing, prepare/reset handling>"
}
Match the JS algorithm's behavior faithfully, including parameter ranges and defaults.`;
