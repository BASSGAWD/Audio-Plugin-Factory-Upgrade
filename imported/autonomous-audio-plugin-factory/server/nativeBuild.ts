import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { auditCppRealtimeSafety, formatCppAudit, auditCppIdioms, formatCppIdiomAudit } from "../src/utils/cppAudit";
import { buildCppPatternContext, buildCppErrorPatternContext } from "../src/utils/cppPatterns";
import {
  KnobRenderStyle,
  PanelTextureStyle,
  KNOB_RECIPES,
  PANEL_TEXTURE_RECIPES,
  resolveKnobStyle,
  toJuceKnobPaintCode,
  toJucePanelPaintCode,
  resolvePanelStyle,
  resolveParamKnobStyle,
} from "../src/utils/uiRenderPatterns";
import { PluginRoutingContract, ResolvedUiContract } from "../src/types";
import { validateResolvedUiContract } from "../src/utils/semanticUi";
import { validateRoutingContract } from "../src/utils/sidechainContract";
import {
  canonicalVisualFamily,
  identityKnobStyle,
  identityPanelStyle,
  SUPPORTED_SOURCE_PLUGIN_FAMILIES,
  SUPPORTED_VISUAL_FAMILIES,
} from "../src/utils/visualIdentity";

// ---------------------------------------------------------------------------
// Real native VST3 build pipeline: turns an AudioPlugin JSON blob into an
// actual JUCE + CMake project on disk, then actually invokes cmake/the local
// compiler toolchain to produce a real .vst3 bundle. Nothing here is
// simulated -- every step below either writes real files or spawns a real
// process and reports what actually happened.
// ---------------------------------------------------------------------------

export interface NativeParameter {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  unit?: string;
  /** Styling data the client already sends on every request (see
   *  NativeBuildPanel.tsx posting the full PluginParameter[] array) but the
   *  server previously dropped at the type level -- generatePluginEditorCpp
   *  now reads these to select a real knob style / panel texture instead of
   *  rendering every control as one identical generic slider on a flat
   *  fill, regardless of what the web preview actually looks like. */
  controlType?: string;
  /** Discrete display choices, required for select controls. */
  choices?: string[];
  ampKnobStyle?: string;
  ampTolexPattern?: string;
  cabGrillStyle?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  uiRole?: string;
  uiGroup?: string;
  uiGroupLabel?: string;
}

export interface NativePlugin {
  name: string;
  category?: string;
  family?: string;
  /** Design attributes from the plugin's buildReport (e.g. "vintage",
   *  "futuristic", "clinical") -- lets knob/panel style resolution refine
   *  the category default toward how strongly this specific plugin claims
   *  to emulate real hardware vs. being an original modern algorithm. See
   *  ATTRIBUTE_KNOB_NUDGE / ATTRIBUTE_PANEL_NUDGE below. */
  attributes?: string[];
  parameters: NativeParameter[];
  dspFunction: string;
  customSkin?: {
    bgColor?: string;
    accentColor?: string;
    textColor?: string;
  };
  /** Validated renderer-neutral faceplate contract supplied by the gate. */
  resolvedUi?: ResolvedUiContract;
  routing?: PluginRoutingContract;
  instrument?: { voices: number; noteRange: [number, number] };
  sampler?: {
    pads: Array<{ id: string; midiNote: number; assetId: string }>;
    assets: Array<{ id: string; name: string; distinctFingerprint: string }>;
  };
}

/** The host-facing topology of a generated JUCE target. Keep this separate
 * from UI identity: a synth-styled effect still needs an audio input, while a
 * sampler must be advertised to the host as a MIDI-driven instrument. */
export interface NativeProjectTarget {
  kind: "audio-effect" | "instrument";
  engine: "effect" | "synthesizer" | "sampler";
  isSynth: boolean;
  needsMidiInput: boolean;
  hasMainInput: boolean;
  silenceInProducesSilence: boolean;
}

const AUDIO_EFFECT_TARGET: NativeProjectTarget = {
  kind: "audio-effect",
  engine: "effect",
  isSynth: false,
  needsMidiInput: false,
  hasMainInput: true,
  silenceInProducesSilence: true,
};

const SYNTHESIZER_TARGET: NativeProjectTarget = {
  kind: "instrument",
  engine: "synthesizer",
  isSynth: true,
  needsMidiInput: true,
  hasMainInput: false,
  // A host must continue calling an instrument for MIDI-driven output even
  // when its (nonexistent) audio input is silent.
  silenceInProducesSilence: false,
};

const SAMPLER_TARGET: NativeProjectTarget = {
  ...SYNTHESIZER_TARGET,
  engine: "sampler",
};

/** Resolve the native host contract from the source classification, not from
 * a display name or a UI metaphor. `family` is authoritative when present;
 * older saved projects without it retain the synthesizer category fallback. */
export function classifyNativeProjectTarget(plugin: Pick<NativePlugin, "family" | "category">): NativeProjectTarget {
  const family = plugin.family?.trim().toLowerCase();
  const category = plugin.category?.trim().toLowerCase();
  const unsupported = ["standalone", "sequencer", "mixer"];
  const requestedUnsupportedKind = unsupported.find((kind) => family === kind || category === kind);
  if (requestedUnsupportedKind) {
    throw new Error(`Unsupported native project target "${requestedUnsupportedKind}": only audio effects and MIDI instruments can be exported as VST3 plugins.`);
  }
  if (family === "sampler" || (!family && category === "sampler")) return SAMPLER_TARGET;
  if (family === "synthesizer" || (!family && category === "synthesizer")) return SYNTHESIZER_TARGET;
  return AUDIO_EFFECT_TARGET;
}

interface NativeControlDescriptor {
  parameter: NativeParameter;
  control: ResolvedUiContract["controls"][number] | undefined;
  controlType: string;
}

/** One normalization point shared by validation, APVTS declaration and
 * editor generation. Contract-bearing builds may not let parameter metadata
 * and renderer metadata independently choose different widget semantics. */
function describeNativeControls(parameters: NativeParameter[], resolvedUi?: ResolvedUiContract): NativeControlDescriptor[] {
  if (!resolvedUi) return parameters.map((parameter) => ({ parameter, control: undefined, controlType: parameter.controlType || "knob" }));
  return parameters.map((parameter) => {
    const matches = resolvedUi.controls.filter((control) => control.parameterId === parameter.id);
    if (matches.length !== 1) throw new Error(`Resolved UI must contain exactly one control for parameter: ${parameter.id}`);
    const control = matches[0];
    if (!parameter.controlType || parameter.controlType !== control.controlType) {
      throw new Error(`Parameter/control type mismatch for ${parameter.id}: ${parameter.controlType || "unset"} vs ${control.controlType}`);
    }
    if (control.controlType === "select" && (!parameter.choices || parameter.choices.length === 0)) {
      throw new Error(`Resolved select control requires choices: ${parameter.id}`);
    }
    return { parameter, control, controlType: control.controlType };
  });
}

export interface LocalLLMConfig {
  provider: "gemini" | "ollama" | "lm_studio";
  ollamaUrl: string;
  ollamaModel: string;
  lmStudioUrl: string;
  lmStudioModel: string;
}

// Deliberately kept OUTSIDE the project directory (process.cwd()): the dev
// server's Vite watcher watches the whole project tree, and writing a JUCE
// checkout plus build artifacts (thousands of files) into it triggers
// constant reload/restart churn. Living under the user's home directory
// keeps native build output well clear of that watcher.
const BUILD_ROOT = path.join(os.homedir(), ".audio-plugin-factory", "builds");
const scaffoldDirectories = new Map<string, string>();
function registerScaffoldDirectory(projectDir: string): string {
  const id = crypto.randomBytes(18).toString("hex");
  scaffoldDirectories.set(id, projectDir);
  return id;
}
/** Boundary for HTTP callers: opaque IDs only, never caller-selected paths. */
export function startNativeBuildForScaffold(scaffoldId: string, llmConfig?: LocalLLMConfig): string {
  const projectDir = scaffoldDirectories.get(scaffoldId);
  if (!projectDir || path.dirname(projectDir) !== BUILD_ROOT) throw new Error("Unknown native scaffold id.");
  return startNativeBuild(projectDir, llmConfig);
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "audio_plugin";
}

function pascalCase(slug: string): string {
  const name =
    slug
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "AudioPlugin";
  // This becomes a C++ class name (${projectName}AudioProcessor, etc.) and
  // the CMake project()/PLUGIN_NAME identifier -- both illegal if they start
  // with a digit (e.g. "8-pad sampler" -> slug "8_pad_sampler" -> "8PadSampler",
  // which fails to compile with cascading syntax errors from the very first
  // token). Prefix with a letter, matching cppIdentifier's guard for params.
  return /^[0-9]/.test(name) ? `Plugin${name}` : name;
}

// JUCE convention: 4 chars, first uppercase, at least one lowercase, deterministic per slug.
function pluginCodeFromSlug(slug: string): string {
  const hash = crypto.createHash("sha1").update(slug).digest();
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let code = String.fromCharCode(65 + (hash[0] % 26)); // uppercase first char
  for (let i = 1; i < 4; i++) code += letters[hash[i] % 26];
  return code;
}

function cppIdentifier(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return !cleaned || /^[0-9]/.test(cleaned) ? `p_${cleaned || "param"}` : cleaned;
}
function cppString(s: string): string { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " "); }
function safeHex(value: string | undefined, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value! : fallback;
}
function nativeTypeface(font: string | undefined): string {
  return font === "mono" ? "Courier New" : font === "serif" ? "Times New Roman" : "Arial";
}

/** Server boundary validation: never let UI metadata become arbitrary C++ or
 * silently claim parity when it doesn't describe this request's parameters. */
export function validateNativePlugin(plugin: NativePlugin): void {
  if (!plugin || typeof plugin.name !== "string" || !Array.isArray(plugin.parameters) || typeof plugin.dspFunction !== "string") throw new Error("Invalid native plugin payload.");
  const target = classifyNativeProjectTarget(plugin);
  if (plugin.family !== undefined && !SUPPORTED_SOURCE_PLUGIN_FAMILIES.includes(plugin.family)) throw new Error("Unsupported native plugin family.");
  const ids = new Set<string>();
  for (const p of plugin.parameters) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.id) || ids.has(p.id)) throw new Error(`Unsafe or duplicate parameter id: ${p.id}`);
    ids.add(p.id);
    if (![p.min, p.max, p.defaultValue].every(Number.isFinite) || p.min > p.max) throw new Error(`Invalid parameter range: ${p.id}`);
  }
  for (const color of [plugin.customSkin?.bgColor, plugin.customSkin?.accentColor, plugin.customSkin?.textColor]) {
    if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Native theme colors must be #RRGGBB.");
  }
  const routingIssues = validateRoutingContract(plugin.routing, plugin.dspFunction);
  if (routingIssues.length) throw new Error(`Invalid routing contract: ${routingIssues.join("; ")}`);
  if (!target.hasMainInput && plugin.routing?.auxiliaryInput.supported) {
    throw new Error("Instrument targets cannot declare an audio sidechain input.");
  }
  if (plugin.instrument) {
    const [low, high] = plugin.instrument.noteRange || [];
    if (!Number.isInteger(plugin.instrument.voices) || plugin.instrument.voices < 1 || plugin.instrument.voices > 128
      || !Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 127 || low >= high) {
      throw new Error("Native instrument requires 1-128 voices and an ascending MIDI note range within 0-127.");
    }
  }
  if (plugin.sampler) {
    const assetIds = new Set(plugin.sampler.assets.map(asset => asset.id));
    const notes = new Set<number>();
    if (!plugin.sampler.assets.length || new Set(plugin.sampler.assets.map(asset => asset.id)).size !== plugin.sampler.assets.length
      || plugin.sampler.assets.some(asset => !asset.id || !asset.distinctFingerprint)
      || !plugin.sampler.pads.length
      || plugin.sampler.pads.some(pad => !Number.isInteger(pad.midiNote) || pad.midiNote < 0 || pad.midiNote > 127 || notes.has(pad.midiNote) || !assetIds.has(pad.assetId) || (notes.add(pad.midiNote), false))) {
      throw new Error("Native sampler requires unique MIDI pads linked to distinct declared assets.");
    }
  }
  if (plugin.resolvedUi) {
    const issues = validateResolvedUiContract(plugin.resolvedUi);
    if (issues.length) throw new Error(`Invalid resolved UI contract: ${issues.join("; ")}`);
    for (const color of [plugin.resolvedUi.theme.background, plugin.resolvedUi.theme.border, plugin.resolvedUi.theme.accent, plugin.resolvedUi.theme.text]) {
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Resolved UI contract contains an unsafe color.");
    }
    if (plugin.resolvedUi.controls.length !== plugin.parameters.length || plugin.resolvedUi.controls.some((c) => !ids.has(c.parameterId))) {
      throw new Error("Resolved UI contract does not match native parameters.");
    }
    const descriptors = describeNativeControls(plugin.parameters, plugin.resolvedUi);
    const expectedIdentityFamily = canonicalVisualFamily(plugin.family, plugin.category);
    if (plugin.resolvedUi.identityRecipe && (!SUPPORTED_VISUAL_FAMILIES.includes(plugin.resolvedUi.identityRecipe.family) || plugin.resolvedUi.identityRecipe.family !== expectedIdentityFamily)) {
      throw new Error("Visual identity recipe family does not match native plugin family.");
    }
    for (const descriptor of descriptors) {
      if (descriptor.controlType === "select" && (!Array.isArray(descriptor.parameter.choices) || descriptor.parameter.choices.some((choice) => typeof choice !== "string"))) {
        throw new Error(`Select parameter requires safe choices: ${descriptor.parameter.id}`);
      }
    }
  }
}

/** Valid C++ float literal: integers need the decimal point ("20f" is a
 *  compile error — C3688 — "20.0f" is not). */
function cppFloat(n: number): string {
  const v = Number(n) || 0;
  return `${v}${Number.isInteger(v) ? ".0" : ""}f`;
}

function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:cpp|c\+\+|h|hpp)?\n([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text.trim();
}

async function callLocalLLMServerSide(
  config: LocalLLMConfig,
  systemPrompt: string,
  userText: string
): Promise<string> {
  if (config.provider === "ollama") {
    const res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        options: { temperature: 0.1 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned status ${res.status}`);
    const data: any = await res.json();
    return data.message?.content || "";
  }

  if (config.provider === "lm_studio") {
    const res = await fetch(`${config.lmStudioUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.lmStudioModel,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LM Studio returned status ${res.status}`);
    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error(`Native build DSP translation requires a local provider (ollama/lm_studio), got "${config.provider}".`);
}

const DSP_TRANSLATION_SYSTEM_PROMPT = `You port real-time-audio JavaScript to C++20 for a JUCE plugin. You will be given:
1. The JS body of function(inputSample, params, state, inputR, inputKey) { ... return outputSample; } that has ALREADY been tested and works correctly in a browser. inputKey is the external sidechain detector sample; when no auxiliary bus is connected it equals inputSample.
2. The exact list of parameter ids available on "params" (a Params struct with a float member per id, same names).

Output ONLY the body of one C++ method with this exact signature (no class wrapper, no includes, no markdown fences, no commentary):
  float processSample(float inputSample, float inputKey, const Params& params) noexcept

Rules:
- All persistent state ("state.x" in the JS) becomes a private member variable of the enclosing class -- declare each one as a comment line "// MEMBER: <type> <name> = <initializer>;" immediately BEFORE the method body, one per line, so the caller can hoist them into the class. Then reference them directly by name (no "state." prefix) in the method body.
- Reference parameters as params.<id> (float), matching the JS params.<id> access exactly.
- No heap allocations, no exceptions, no STL containers, no locks, no logging inside the method body. Use fixed-size C-arrays for any buffers (e.g. float buf[8192];) declared as members, matching the JS array sizes.
- Preserve the exact math/algorithm from the JS -- this is a port, not a redesign.
- Clamp the return value the same way the JS does.`;

interface TranslationResult {
  memberDeclarations: string[];
  methodBody: string;
}

function parseTranslation(raw: string): TranslationResult {
  const cleaned = stripCodeFences(raw);
  const lines = cleaned.split("\n");
  const memberDeclarations: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*\/\/\s*MEMBER:\s*(.+)$/);
    if (m) {
      memberDeclarations.push(m[1].trim().replace(/;?\s*$/, ";"));
    } else {
      bodyLines.push(line);
    }
  }

  return { memberDeclarations, methodBody: bodyLines.join("\n").trim() };
}

function fallbackTranslation(plugin?: NativePlugin): TranslationResult {
  if (plugin?.routing?.auxiliaryInput.supported) {
    const filterLike = plugin.category === "filter";
    const ids = new Set(plugin.parameters.map((p) => p.id));
    const recognized = filterLike
      ? ["cutoff", "sensitivity", "attack", "release", "mix"].every((id) => ids.has(id)) && /\bmovingCutoff\b/.test(plugin.dspFunction)
      : ["threshold", "ratio", "attack", "release", "makeup", "mix"].every((id) => ids.has(id)) && /\blet comp = Math\.tanh\(inputSample \* g\)/.test(plugin.dspFunction);
    if (!recognized) {
      throw new Error("A faithful native sidechain port requires a working local translation model for this custom DSP; no substitute processor was emitted.");
    }
    if (filterLike) {
      return {
        memberDeclarations: ["float env = 0.0f;", "float lp = 0.0f;"],
        methodBody: `const float target = std::abs (inputKey);
const float attack = 1.0f - std::exp (-1.0f / (std::max (1.0f, params.attack) * 0.001f * static_cast<float> (mSampleRate)));
const float release = 1.0f - std::exp (-1.0f / (std::max (20.0f, params.release) * 0.001f * static_cast<float> (mSampleRate)));
env += (target > env ? attack : release) * (target - env);
const float movingCutoff = std::clamp (params.cutoff * (1.0f + env * params.sensitivity * 7.0f), 40.0f, 18000.0f);
const float coeff = 1.0f - std::exp (-6.28318530718f * movingCutoff / static_cast<float> (mSampleRate));
lp += coeff * (inputSample - lp);
return lp * params.mix + inputSample * (1.0f - params.mix);`,
      };
    }
    return {
      memberDeclarations: ["float env = 0.0f;"],
      methodBody: `const float detector = std::abs (inputKey);
const float attack = 1.0f - std::exp (-1.0f / (std::max (0.05f, params.attack) * 44.1f));
const float release = 1.0f - std::exp (-1.0f / (std::max (1.0f, params.release) * 0.001f * static_cast<float> (mSampleRate)));
env += (detector > env ? attack : release) * (detector - env);
const float envDb = 20.0f * std::log10 (std::max (1.0e-6f, env));
const float overDb = envDb - params.threshold;
const float gainDb = overDb > 0.0f ? -overDb * (1.0f - 1.0f / std::max (1.0f, params.ratio)) : 0.0f;
const float gain = std::pow (10.0f, (gainDb + params.makeup) / 20.0f);
const float compressed = std::tanh (inputSample * gain);
return compressed * params.mix + inputSample * (1.0f - params.mix);`,
    };
  }
  return {
    memberDeclarations: [],
    methodBody:
      "// NOTE: local-model DSP translation was unavailable or failed, so this is a\n" +
      "// transparent passthrough. Re-run the build once a local model (Ollama/LM Studio)\n" +
      "// is reachable to get a real port of the tested JS DSP into C++.\n" +
      "return inputSample;",
  };
}

function generateCMakeLists(projectName: string, pluginCode: string, target: NativeProjectTarget): string {
  return `cmake_minimum_required(VERSION 3.22)
project(${projectName} VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 7.0.12
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(${projectName}
    COMPANY_NAME "AudioFactory"
    PLUGIN_NAME "${projectName}"
    IS_SYNTH ${target.isSynth ? "TRUE" : "FALSE"}
    NEEDS_MIDI_INPUT ${target.needsMidiInput ? "TRUE" : "FALSE"}
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    FORMATS VST3
    PLUGIN_MANUFACTURER_CODE Afct
    PLUGIN_CODE ${pluginCode}
)

# Our sources include <JuceHeader.h>, which JUCE's CMake only produces when
# explicitly asked (fatal C1083 on every source file otherwise).
juce_generate_juce_header(${projectName})

target_sources(${projectName} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/LookAndFeel.cpp
)

target_compile_definitions(${projectName} PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(${projectName} PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_dsp
    juce::juce_gui_basics
    juce::juce_gui_extra
)
`;
}

function generateProcessorCoreHeader(translation: TranslationResult): string {
  const members = translation.memberDeclarations.map((d) => `    ${d}`).join("\n");
  return `// Auto-generated from the tested in-browser JS DSP function.
// Params is a plain struct (one float per plugin parameter, see PluginProcessor.h)
// so this method never allocates or touches a container in the hot path.
#pragma once

#include "../Parameters.h"
#include <algorithm>
#include <cmath>

class ProcessorCore
{
public:
    ProcessorCore() = default;

    void prepare(double sampleRate)
    {
        mSampleRate = sampleRate;
    }

    void reset()
    {
        // Persistent state members below are value-initialized at construction;
        // extend this if any of them need explicit reset-to-zero behaviour.
    }

    float processSample(float inputSample, const Params& params) noexcept
    {
        return processSample (inputSample, inputSample, params);
    }

    float processSample(float inputSample, float inputKey, const Params& params) noexcept
    {
${translation.methodBody.split("\n").map((l) => "        " + l).join("\n")}
    }

private:
    double mSampleRate = 44100.0;
${members}
};
`;
}

function generateParametersHeader(parameters: NativeParameter[]): string {
  const fields = parameters
    .map((p) => `    float ${cppIdentifier(p.id)} = ${cppFloat(p.defaultValue)};`)
    .join("\n");
  return `#pragma once

// One float per plugin parameter -- filled from the APVTS each block in
// PluginProcessor::processBlock and passed by const-ref into ProcessorCore,
// so the DSP core never touches JUCE APIs or allocates.
struct Params
{
${fields}
};
`;
}

function generatePluginProcessorHeader(projectName: string, target: NativeProjectTarget, plugin: NativePlugin): string {
  const sampleAssetCount = Math.max(1, plugin.sampler?.assets.length || 0);
  return `#pragma once
#include <JuceHeader.h>
#include <array>
#include <atomic>
#include <cmath>
#include "Parameters.h"
#include "dsp/ProcessorCore.h"

class ${projectName}AudioProcessor : public juce::AudioProcessor
{
public:
    static_assert (std::atomic<float>::is_always_lock_free, "Meter bridge requires lock-free float atomics");

    ${projectName}AudioProcessor();
    ~${projectName}AudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "${projectName}"; }
    bool acceptsMidi() const override { return ${target.needsMidiInput ? "true" : "false"}; }
    bool producesMidi() const override { return false; }
    bool silenceInProducesSilence() const { return ${target.silenceInProducesSilence ? "true" : "false"}; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override
    {
        if (auto state = apvts.copyState().createXml())
            copyXmlToBinary (*state, destData);
    }
    void setStateInformation (const void* data, int sizeInBytes) override
    {
        if (auto xml = getXmlFromBinary (data, sizeInBytes))
            apvts.replaceState (juce::ValueTree::fromXml (*xml));
    }

    juce::AudioProcessorValueTreeState apvts;
    void getMeterLevels (float& left, float& right) const noexcept
    {
        left = meterLevelLeft.load (std::memory_order_relaxed);
        right = meterLevelRight.load (std::memory_order_relaxed);
    }

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    ProcessorCore mCore;
${target.engine === "synthesizer" ? `    double currentSampleRate = 44100.0;
    std::array<float, 128> notePhases {};
    std::array<float, 128> noteVelocities {};
` : ""}${target.engine === "sampler" ? `    double currentSampleRate = 44100.0;
    std::array<float, 128> noteVelocities {};
    std::array<int, 128> samplePositions {};
    std::array<int, 128> noteAssetIndices {};
    std::array<std::array<float, 4096>, ${sampleAssetCount}> sampleTables {};
` : ""}    std::atomic<float> meterLevelLeft { 0.0f };
    std::atomic<float> meterLevelRight { 0.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${projectName}AudioProcessor)
};
`;
}

// Safety net emitted verbatim into every generated PluginProcessor.cpp,
// regardless of whether the DSP core translation succeeded, failed, or fell
// back to the passthrough placeholder: guarantees every sample written to
// the host's audio buffer is finite, denormal-free, and bounded. This is the
// last line of defense against a runaway filter, an unstable feedback path,
// or a divide-by-zero landing on a bad coefficient inside the (possibly
// LLM-translated) DSP core -- never a mixing/loudness decision, just a floor
// that a correctly behaving plugin should never actually hit. Kept as a
// small file-local free function (not a class method) so no header change is
// required to wire it in.
const SANITIZE_SAMPLE_HELPER = `namespace
{
    // Safety net: sanitizes a computed DSP output sample immediately before
    // it is written to the host's audio buffer.
    static inline float sanitizeSample (float x) noexcept
    {
        if (! std::isfinite (x))
            return 0.0f;

        if (std::abs (x) < 1.0e-30f)
            return 0.0f; // flush denormals to zero -- avoids FPU stalls on x86

        return juce::jlimit (-4.0f, 4.0f, x);
    }
}`;

/**
 * The processBlock definition, applying `sanitizeSample` to every computed
 * output sample -- for every channel (mono or stereo; the same guarded
 * write site handles both, since JUCE hands us N interleaved channel
 * pointers here) -- immediately at the point it becomes the buffer's output
 * value. Kept as its own function (rather than inlined into the bigger
 * template below) so it -- together with SANITIZE_SAMPLE_HELPER -- can be
 * audited in isolation via cppAudit's "full" context without the unrelated
 * `new` in createPluginFilter()'s factory function below tripping a
 * false-positive hot-path finding.
 */
function generateInstrumentProcessBlockFunction(projectName: string, paramReads: string, target: NativeProjectTarget, plugin: NativePlugin): string {
  const noteRange = plugin.instrument?.noteRange || [0, 127];
  const voiceLimit = plugin.instrument?.voices || 128;
  const voiceSample = target.engine === "sampler"
    ? `            const int position = samplePositions[static_cast<size_t> (note)];
            const int assetIndex = noteAssetIndices[static_cast<size_t> (note)];
            if (position >= 0 && assetIndex >= 0)
            {
                generated += sampleTables[static_cast<size_t> (assetIndex)][static_cast<size_t> (position)] * noteVelocities[static_cast<size_t> (note)];
                samplePositions[static_cast<size_t> (note)] = position + 1 < static_cast<int> (sampleTables[0].size()) ? position + 1 : -1;
            }`
    : `            const float velocity = noteVelocities[static_cast<size_t> (note)];
            if (velocity > 0.0f)
            {
                const float frequency = 440.0f * std::pow (2.0f, (static_cast<float> (note) - 69.0f) / 12.0f);
                generated += std::sin (notePhases[static_cast<size_t> (note)]) * velocity * 0.18f;
                notePhases[static_cast<size_t> (note)] = std::fmod (notePhases[static_cast<size_t> (note)] + juce::MathConstants<float>::twoPi * frequency / static_cast<float> (currentSampleRate), juce::MathConstants<float>::twoPi);
            }`;
  const noteOn = target.engine === "sampler"
    ? `            if (noteAssetIndices[static_cast<size_t> (note)] >= 0)
            {
                noteVelocities[static_cast<size_t> (note)] = message.getFloatVelocity();
                samplePositions[static_cast<size_t> (note)] = 0;
            }`
    : `            int activeVoices = 0;
            for (const float velocity : noteVelocities)
                activeVoices += velocity > 0.0f ? 1 : 0;
            if (note >= ${noteRange[0]} && note <= ${noteRange[1]}
                && (noteVelocities[static_cast<size_t> (note)] > 0.0f || activeVoices < ${voiceLimit}))
            {
                noteVelocities[static_cast<size_t> (note)] = message.getFloatVelocity();
                notePhases[static_cast<size_t> (note)] = 0.0f;
            }`;
  const noteOff = target.engine === "synthesizer"
    ? `        else if (message.isNoteOff())
            noteVelocities[static_cast<size_t> (juce::jlimit (0, 127, message.getNoteNumber()))] = 0.0f;`
    : "";
  return `void ${projectName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;
    Params params;
${paramReads}
    for (const auto metadata : midiMessages)
    {
        const auto message = metadata.getMessage();
        if (message.isNoteOn())
        {
            const int note = juce::jlimit (0, 127, message.getNoteNumber());
${noteOn}
        }
${noteOff}
    }

    buffer.clear();
    float blockPeak = 0.0f;
    for (int sampleIndex = 0; sampleIndex < buffer.getNumSamples(); ++sampleIndex)
    {
        float generated = 0.0f;
        for (int note = 0; note < 128; ++note)
        {
${voiceSample}
        }
        const float output = sanitizeSample (mCore.processSample (generated, params));
        blockPeak = juce::jmax (blockPeak, juce::jmin (1.0f, std::abs (output)));
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
            buffer.setSample (channel, sampleIndex, output);
    }
    meterLevelLeft.store (blockPeak, std::memory_order_relaxed);
    meterLevelRight.store (blockPeak, std::memory_order_relaxed);
}`;
}

function generateProcessBlockFunction(projectName: string, paramReads: string, sidechain: boolean, target: NativeProjectTarget, plugin: NativePlugin): string {
  if (target.kind === "instrument") return generateInstrumentProcessBlockFunction(projectName, paramReads, target, plugin);
  const busSetup = sidechain
    ? `    auto mainBuffer = getBusBuffer (buffer, true, 0);
    const bool sidechainConnected = getBusCount (true) > 1 && getBus (true, 1)->isEnabled();
    auto sidechainBuffer = sidechainConnected ? getBusBuffer (buffer, true, 1) : juce::AudioBuffer<float>();
`
    : target.hasMainInput ? `    auto mainBuffer = getBusBuffer (buffer, true, 0);
` : "";
  const keyRead = sidechain
    ? `            const float inputKey = sidechainConnected && sidechainBuffer.getNumChannels() > 0
                ? sidechainBuffer.getReadPointer (juce::jmin (channel, sidechainBuffer.getNumChannels() - 1))[i]
                : data[i];`
    : `            const float inputKey = data[i];`;
  const processCall = sidechain
    ? "mCore.processSample (data[i], inputKey, params)"
    : "mCore.processSample (data[i], params)";
  const channelCount = sidechain ? "mainBuffer.getNumChannels()" : "buffer.getNumChannels()";
  const sampleCount = sidechain ? "mainBuffer.getNumSamples()" : "buffer.getNumSamples()";
  const writeBuffer = sidechain ? "mainBuffer" : "buffer";
  return `void ${projectName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    float blockPeakLeft = 0.0f;
    float blockPeakRight = 0.0f;

    Params params;
${paramReads}
${busSetup}

    for (int channel = 0; channel < ${channelCount}; ++channel)
    {
        auto* data = ${writeBuffer}.getWritePointer (channel);
        for (int i = 0; i < ${sampleCount}; ++i)
        {
${keyRead}
            data[i] = sanitizeSample (${processCall});
            const float magnitude = juce::jmin (1.0f, std::abs (data[i]));
            if (channel == 0)
                blockPeakLeft = juce::jmax (blockPeakLeft, magnitude);
            else if (channel == 1)
                blockPeakRight = juce::jmax (blockPeakRight, magnitude);
        }
    }
    if (${channelCount} == 1)
        blockPeakRight = blockPeakLeft;
    meterLevelLeft.store (blockPeakLeft, std::memory_order_relaxed);
    meterLevelRight.store (blockPeakRight, std::memory_order_relaxed);
}`;
}

interface ProcessorCppResult {
  /** The full PluginProcessor.cpp source to write to disk. */
  cpp: string;
  /** SANITIZE_SAMPLE_HELPER + the processBlock function only -- the exact
   *  buffer-write site, isolated from the rest of the file so it can be
   *  audited for the safety-net guard without unrelated code (e.g. the
   *  factory function's legitimate one-time `new`) causing a false
   *  positive on the unrelated hot-path-hazard rules. */
  bufferWriteSite: string;
}

function generatePluginProcessorCpp(projectName: string, parameters: NativeParameter[], target: NativeProjectTarget, plugin: NativePlugin, resolvedUi?: ResolvedUiContract, routing?: PluginRoutingContract): ProcessorCppResult {
  const descriptors = describeNativeControls(parameters, resolvedUi);
  const paramDefs = descriptors
    .map(
      ({ parameter: p, controlType }) => {
        const id = cppString(p.id), name = cppString(p.name);
        if (controlType === "select") {
          const choices = (p.choices || []).map((choice) => `"${cppString(choice)}"`).join(", ");
          return `    layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID("${id}", 1), "${name}", juce::StringArray { ${choices} }, ${Math.max(0, Math.round(p.defaultValue))}));`;
        }
        if (controlType === "toggle" || controlType === "button" || controlType === "pad") {
          return `    layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID("${id}", 1), "${name}", ${p.defaultValue >= 0.5 ? "true" : "false"}));`;
        }
        return `    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID("${id}", 1), "${name}", juce::NormalisableRange<float>(${cppFloat(p.min)}, ${cppFloat(p.max)}), ${cppFloat(p.defaultValue)}));`;
      }
    )
    .join("\n");

  const paramReads = descriptors
    .map(({ parameter: p }) => `    params.${cppIdentifier(p.id)} = apvts.getRawParameterValue("${cppString(p.id)}")->load();`)
    .join("\n");

  const sidechain = target.hasMainInput && routing?.auxiliaryInput.supported === true && routing.inputKeyArgument === true;
  const processBlockFn = generateProcessBlockFunction(projectName, paramReads, sidechain, target, plugin);
  const samplerAssets = plugin.sampler?.assets.length
    ? plugin.sampler.assets
    : [{ id: "default-sample", name: "Default Sample", distinctFingerprint: "default-native-sample" }];
  const samplerFrequencies = samplerAssets.map(asset => {
    let hash = 2166136261;
    for (const char of asset.distinctFingerprint) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return 70 + (hash >>> 0) % 260;
  });
  const samplerAssetIndex = new Map(samplerAssets.map((asset, index) => [asset.id, index]));
  const samplerPads = plugin.sampler?.pads.length
    ? plugin.sampler.pads
    : [{ id: "default-pad", midiNote: 36, assetId: samplerAssets[0].id }];
  const samplerPadAssignments = samplerPads
    .map(pad => `    noteAssetIndices[${pad.midiNote}] = ${samplerAssetIndex.get(pad.assetId) ?? -1};`)
    .join("\n");
  const bufferWriteSite = `${SANITIZE_SAMPLE_HELPER}\n\n${processBlockFn}`;

  const cpp = `#include "PluginProcessor.h"
#include "PluginEditor.h"

${SANITIZE_SAMPLE_HELPER}

juce::AudioProcessorValueTreeState::ParameterLayout ${projectName}AudioProcessor::createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
${paramDefs}
    return layout;
}

${projectName}AudioProcessor::${projectName}AudioProcessor()
    : AudioProcessor (BusesProperties()
${target.hasMainInput ? '                        .withInput ("Input", juce::AudioChannelSet::stereo())\n' : ""}${sidechain ? '                        .withInput ("Sidechain", juce::AudioChannelSet::stereo(), false)\n' : ""}                        .withOutput ("Output", juce::AudioChannelSet::stereo())),
      apvts (*this, nullptr, "PARAMETERS", createParameterLayout())
{
}

void ${projectName}AudioProcessor::prepareToPlay (double sampleRate, int)
{
    mCore.prepare (sampleRate);
    mCore.reset();
${target.engine === "synthesizer" ? `    currentSampleRate = sampleRate;
    notePhases.fill (0.0f);
    noteVelocities.fill (0.0f);
` : ""}${target.engine === "sampler" ? `    currentSampleRate = sampleRate;
    noteVelocities.fill (0.0f);
    samplePositions.fill (-1);
    noteAssetIndices.fill (-1);
${samplerPadAssignments}
    const std::array<float, ${Math.max(1, samplerFrequencies.length)}> sampleFrequencies { ${samplerFrequencies.length ? samplerFrequencies.map(value => `${value}.0f`).join(", ") : "92.0f"} };
    for (size_t assetIndex = 0; assetIndex < sampleTables.size(); ++assetIndex)
    {
        for (size_t i = 0; i < sampleTables[assetIndex].size(); ++i)
        {
            const float time = static_cast<float> (i) / static_cast<float> (currentSampleRate);
            const float envelope = std::exp (-time * (12.0f + static_cast<float> (assetIndex) * 3.0f));
            const float frequency = sampleFrequencies[assetIndex];
            sampleTables[assetIndex][i] = envelope * (0.75f * std::sin (juce::MathConstants<float>::twoPi * frequency * time)
                                                    + 0.25f * std::sin (juce::MathConstants<float>::twoPi * frequency * 2.0f * time));
        }
    }
` : ""}
}

bool ${projectName}AudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto mainOut = layouts.getChannelSet (false, 0);
    if (mainOut != juce::AudioChannelSet::mono() && mainOut != juce::AudioChannelSet::stereo())
        return false;
${target.hasMainInput ? `    const auto mainIn = layouts.getChannelSet (true, 0);
    if (mainIn != mainOut)
        return false;
` : ""}${sidechain ? `    const auto aux = layouts.getChannelSet (true, 1);
    if (! aux.isDisabled() && aux != juce::AudioChannelSet::mono() && aux != juce::AudioChannelSet::stereo())
        return false;
` : ""}    return true;
}

${processBlockFn}

juce::AudioProcessorEditor* ${projectName}AudioProcessor::createEditor()
{
    return new ${projectName}AudioProcessorEditor (*this);
}

// This creates the plugin's JUCE factory entry point.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ${projectName}AudioProcessor();
}
`;

  return { cpp, bufferWriteSite };
}

// (moved) The category/attribute -> knob & panel style selectors now live
// in src/utils/uiRenderPatterns.ts alongside the recipes they select from,
// so the WEB faceplate can share them -- previously only this C++ export
// path ever resolved a real panel material. Re-exported so existing
// importers of this module keep working unchanged.
export { resolvePanelStyle, resolveParamKnobStyle };


export function generateLookAndFeelHeader(): string {
  return `#pragma once
#include <JuceHeader.h>

// Draws every rotary slider from the SAME numeric recipes uiRenderPatterns.ts
// (the factory's shared knob-render knowledge base) uses to draw the web
// preview -- a per-instance property ("knobStyle", set on each juce::Slider
// via getProperties()) selects which recipe applies, JUCE's standard
// per-instance style-hint mechanism.
class StyledLookAndFeel : public juce::LookAndFeel_V4
{
public:
    explicit StyledLookAndFeel (juce::Colour accent, juce::String typeface = "Arial");

    void drawRotarySlider (juce::Graphics& g, int x, int y, int width, int height,
                            float sliderPosProportional, float rotaryStartAngle, float rotaryEndAngle,
                            juce::Slider& slider) override;
    juce::Font getLabelFont (juce::Label&) override;
    juce::Font getComboBoxFont (juce::ComboBox&) override;
    juce::Font getPopupMenuFont() override;
    void drawToggleButton (juce::Graphics&, juce::ToggleButton&, bool, bool) override;

private:
    juce::Colour accentColour;
    juce::String typefaceName;
};
`;
}

/** One generated class regardless of how many distinct knob styles a
 *  plugin actually uses -- keeps the compile-repair loop's job simpler
 *  (constant file/class count) versus one LookAndFeel subclass per style. */
export function generateLookAndFeelCpp(stylesInUse: KnobRenderStyle[], accentColorHex: string): string {
  // "modern_pointer" is always included as the safety-net fallback branch:
  // resolveParamKnobStyle only ever returns an unrecognized style if a
  // future style name is added to the type without a matching CATEGORY_
  // DEFAULT_KNOB_STYLE entry -- this branch means drawRotarySlider still
  // renders SOMETHING recognizable rather than an invisible slider.
  const unique = [...new Set<KnobRenderStyle>([...stylesInUse, "modern_pointer"])];
  const branches = unique.map((s) => toJuceKnobPaintCode(KNOB_RECIPES[s], s)).join("\n");
  return `#include "LookAndFeel.h"

StyledLookAndFeel::StyledLookAndFeel (juce::Colour accent, juce::String typeface)
    : accentColour (accent), typefaceName (typeface) {}

juce::Font StyledLookAndFeel::getLabelFont (juce::Label&) { return juce::Font (typefaceName, 13.0f, juce::Font::plain); }
juce::Font StyledLookAndFeel::getComboBoxFont (juce::ComboBox&) { return juce::Font (typefaceName, 13.0f, juce::Font::plain); }
juce::Font StyledLookAndFeel::getPopupMenuFont() { return juce::Font (typefaceName, 13.0f, juce::Font::plain); }

void StyledLookAndFeel::drawToggleButton (juce::Graphics& g, juce::ToggleButton& button, bool, bool)
{
    const auto box = juce::Rectangle<float> (2.0f, (button.getHeight() - 16.0f) * 0.5f, 16.0f, 16.0f);
    g.setColour (button.findColour (juce::ToggleButton::tickDisabledColourId));
    g.drawRoundedRectangle (box, 3.0f, 1.0f);
    if (button.getToggleState())
    {
        g.setColour (button.findColour (juce::ToggleButton::tickColourId));
        g.fillRoundedRectangle (box.reduced (3.0f), 2.0f);
    }
    g.setColour (button.findColour (juce::ToggleButton::textColourId));
    g.setFont (juce::Font (typefaceName, 13.0f, juce::Font::plain));
    g.drawText (button.getButtonText(), 24, 0, button.getWidth() - 24, button.getHeight(), juce::Justification::centredLeft);
}

void StyledLookAndFeel::drawRotarySlider (juce::Graphics& g, int x, int y, int width, int height,
                                          float sliderPosProportional, float rotaryStartAngle, float rotaryEndAngle,
                                          juce::Slider& slider)
{
    const juce::String style = slider.getProperties().getWithDefault ("knobStyle", "modern_pointer").toString();
${branches}
    if (style != "${unique.join(`" && style != "`)}")
    {
        // Unrecognized style tag -- fall back to the base LookAndFeel_V4
        // rotary slider rather than rendering nothing.
        juce::LookAndFeel_V4::drawRotarySlider (g, x, y, width, height, sliderPosProportional, rotaryStartAngle, rotaryEndAngle, slider);
    }
}
`;
}

export function generatePluginEditorHeader(projectName: string): string {
  return `#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "LookAndFeel.h"

class ${projectName}AudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit ${projectName}AudioProcessorEditor (${projectName}AudioProcessor&);
    ~${projectName}AudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    ${projectName}AudioProcessor& processorRef;
    StyledLookAndFeel styledLookAndFeel;
    juce::OwnedArray<StyledLookAndFeel> controlLookAndFeels;

    juce::OwnedArray<juce::Slider> sliders;
    juce::OwnedArray<juce::ToggleButton> toggles;
    juce::OwnedArray<juce::TextButton> pads;
    juce::OwnedArray<juce::Component> visualComponents;
    juce::OwnedArray<juce::GroupComponent> semanticGroups;
    juce::OwnedArray<juce::ComboBox> combos;
    juce::OwnedArray<juce::Label> labels;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::SliderAttachment> attachments;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::ButtonAttachment> buttonAttachments;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::ComboBoxAttachment> comboAttachments;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${projectName}AudioProcessorEditor)
};
`;
}

export function generatePluginEditorCpp(
  projectName: string,
  parameters: NativeParameter[],
  customSkin?: NativePlugin["customSkin"],
  category?: string,
  attributes?: string[],
  resolvedUi?: ResolvedUiContract,
  family?: string
): string {
  const bgColor = safeHex(resolvedUi?.theme.background || customSkin?.bgColor, "#12161D");
  const accentColor = safeHex(resolvedUi?.theme.accent || customSkin?.accentColor, "#7C5CFF");
  const textColor = safeHex(resolvedUi?.theme.text || customSkin?.textColor, "#F4F7FB");
  const identity = resolvedUi?.identityRecipe;
  const panelRecipe = PANEL_TEXTURE_RECIPES[identity ? identityPanelStyle(identity.panel) : resolvePanelStyle(category, attributes)];
  const meterRecipe = identity?.meter || "segmented-peak";
  const eqRecipe = identity?.eqMotion || "static";
  const hierarchyPaint = resolvedUi?.hierarchy.map((group, index) =>
    `    g.drawText ("${cppString(group.label)}", 8, ${8 + index * 14}, getWidth() - 16, 12, juce::Justification::left);`
  ).join("\n") || "";

  const descriptors = describeNativeControls(parameters, resolvedUi);
  const paramStyles = descriptors.map(({ parameter: p, control: c }) =>
    c?.style.knob ? identityKnobStyle(c.style.knob) : identity ? identityKnobStyle(identity.knob) : resolveParamKnobStyle(p, category, attributes));

  const columns = Math.max(1, Math.min(4, parameters.length));
  const fallbackRects = parameters.map((_, i) => ({
    x: 20 + (i % columns) * 150,
    y: 45 + Math.floor(i / columns) * 145,
    w: 140,
    h: 130,
  }));
  const controlRects = descriptors.map(({ parameter: p, control: c }, i) => ({
    x: Math.max(10, Math.round(c?.bounds.x ?? p.x ?? fallbackRects[i].x)),
    y: Math.max(34, Math.round(c?.bounds.y ?? p.y ?? fallbackRects[i].y)),
    w: Math.max(1, Math.round(c?.bounds.width ?? p.w ?? fallbackRects[i].w)),
    h: Math.max(1, Math.round(c?.bounds.height ?? p.h ?? fallbackRects[i].h)),
  }));
  const semanticGroupIds = [...new Set(parameters.map((p) => p.uiGroup).filter((v): v is string => !!v))];
  const parameterGroups = semanticGroupIds.map((id) => {
    const members = parameters.map((p, i) => ({ p, rect: controlRects[i] })).filter(({ p }) => p.uiGroup === id);
    const left = Math.min(...members.map(({ rect }) => rect.x)) - 8;
    const top = Math.min(...members.map(({ rect }) => rect.y)) - 22;
    const right = Math.max(...members.map(({ rect }) => rect.x + rect.w)) + 8;
    const bottom = Math.max(...members.map(({ rect }) => rect.y + rect.h)) + 8;
    return { label: members[0].p.uiGroupLabel || id, x: left, y: top, w: right - left, h: bottom - top };
  });
  const contractGroups = resolvedUi?.hierarchy.map((group) => {
    const members = descriptors.map((d, i) => ({ d, rect: controlRects[i] })).filter(({ d }) => group.parameterIds.includes(d.parameter.id));
    const left = Math.min(...members.map(({ rect }) => rect.x)) - 8;
    const top = Math.min(...members.map(({ rect }) => rect.y)) - 22;
    const right = Math.max(...members.map(({ rect }) => rect.x + rect.w)) + 8;
    const bottom = Math.max(...members.map(({ rect }) => rect.y + rect.h)) + 8;
    return { label: group.label, x: left, y: top, w: right - left, h: bottom - top };
  }) ?? [];
  const semanticGroups = parameterGroups.length ? parameterGroups : contractGroups;
  const visibleSemanticGroups = semanticGroups.length > 1 ? semanticGroups : [];
  const buildSemanticGroups = visibleSemanticGroups.map((group) => `    {
        auto* section = semanticGroups.add (new juce::GroupComponent ({}, "${cppString(group.label.toUpperCase())}"));
        section->setColour (juce::GroupComponent::outlineColourId, juce::Colour::fromString ("44${accentColor.replace("#", "")}"));
        section->setColour (juce::GroupComponent::textColourId, juce::Colour::fromString ("aa${textColor.replace("#", "")}"));
        addAndMakeVisible (section);
    }`).join("\n");
  const buildSliders = descriptors
    .map(
      ({ parameter: p, control: c, controlType: type }, i) => {
        const label = cppString(c?.accessibility.label || p.name);
        const suffix = cppString(p.unit || "");
        const controlAccent = safeHex(c?.style.accent, accentColor);
        const fontToken = c?.style.font || "sans";
        const typeface = nativeTypeface(fontToken);
        const pre = `    {
        auto* controlLaf = controlLookAndFeels.add (new StyledLookAndFeel (juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"), "${typeface}"));
        auto* label = labels.add (new juce::Label ({}, "${label}"));
        label->setLookAndFeel (controlLaf);
        label->setJustificationType (juce::Justification::centred);
        label->setColour (juce::Label::textColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        label->setFont (juce::Font ("${typeface}", 13.0f, juce::Font::plain));
        label->getProperties().set ("uiFont", "${fontToken}");
        label->setTitle ("${label}");
        addAndMakeVisible (label);
`;
        if (["meter", "eq", "amp", "cab", "mic", "mic_stand", "label", "waveform"].includes(type)) return `${pre}
        auto* visual = visualComponents.add (new RecipeVisualComponent (processorRef, "${cppString(type)}", "${cppString(type === "meter" ? meterRecipe : type === "eq" ? eqRecipe : identity?.hardwareMotif || "rack")}", juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"), ${cppFloat(identity?.animation.phase || 0.0)}, ${cppFloat(identity?.animation.tempo || 1.0)}, ${identity?.motionPolicy === "decorative" ? "true" : "false"}));
        visual->setName ("${cppString(type)}:${label}");
        visual->setInterceptsMouseClicks (false, false);
        addAndMakeVisible (visual);
    }`;
        if (type === "toggle") return `${pre}
        auto* toggle = toggles.add (new juce::ToggleButton ("${label}"));
        toggle->setLookAndFeel (controlLaf);
        toggle->setTitle ("${label}");
        toggle->setColour (juce::ToggleButton::tickColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));
        toggle->setColour (juce::ToggleButton::tickDisabledColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}").withAlpha (0.35f));
        toggle->setColour (juce::ToggleButton::textColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        toggle->getProperties().set ("uiFont", "${fontToken}");
        addAndMakeVisible (toggle);
        buttonAttachments.add (new juce::AudioProcessorValueTreeState::ButtonAttachment (processorRef.apvts, "${cppString(p.id)}", *toggle));
    }`;
        if (type === "button" || type === "pad") return `${pre}
        auto* pad = pads.add (new juce::TextButton ("${label}"));
        pad->setLookAndFeel (controlLaf);
        pad->setTitle ("${label}");
        pad->setColour (juce::TextButton::buttonColourId, juce::Colour::fromString ("66${controlAccent.replace("#", "")}"));
        pad->setColour (juce::TextButton::textColourOffId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        addAndMakeVisible (pad);
        buttonAttachments.add (new juce::AudioProcessorValueTreeState::ButtonAttachment (processorRef.apvts, "${cppString(p.id)}", *pad));
    }`;
        if (type === "select") return `${pre}
        auto* combo = combos.add (new juce::ComboBox());
        combo->setLookAndFeel (controlLaf);
        combo->setTitle ("${label}");
        combo->setColour (juce::ComboBox::backgroundColourId, juce::Colour::fromString ("ff${bgColor.replace("#", "")}"));
        combo->setColour (juce::ComboBox::outlineColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));
        combo->setColour (juce::ComboBox::textColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        combo->setColour (juce::ComboBox::arrowColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));
        combo->getProperties().set ("uiFont", "${fontToken}");
${(p.choices || []).map((choice, choiceIndex) => `        combo->addItem ("${cppString(choice)}", ${choiceIndex + 1});`).join("\n")}
        addAndMakeVisible (combo);
        comboAttachments.add (new juce::AudioProcessorValueTreeState::ComboBoxAttachment (processorRef.apvts, "${cppString(p.id)}", *combo));
    }`;
        return `${pre}
        auto* slider = sliders.add (new juce::Slider (juce::Slider::${type === "knob" ? "RotaryHorizontalVerticalDrag" : "LinearHorizontal"}, juce::Slider::TextBoxBelow));
        slider->setLookAndFeel (controlLaf);
        slider->getProperties().set ("knobStyle", "${paramStyles[i]}");
${type === "knob"
  ? `        slider->setColour (juce::Slider::rotarySliderFillColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));
        slider->setColour (juce::Slider::rotarySliderOutlineColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}").withAlpha (0.35f));
        slider->setColour (juce::Slider::thumbColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));`
  : `        slider->setColour (juce::Slider::trackColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));
        slider->setColour (juce::Slider::backgroundColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}").withAlpha (0.22f));
        slider->setColour (juce::Slider::thumbColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}"));`}
        slider->setColour (juce::Slider::textBoxTextColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        slider->setColour (juce::Slider::textBoxOutlineColourId, juce::Colour::fromString ("ff${controlAccent.replace("#", "")}").withAlpha (0.45f));
        slider->getProperties().set ("uiFont", "${fontToken}");
        slider->setTextValueSuffix (" ${suffix}");
        slider->setTitle ("${label}");
        slider->setDoubleClickReturnValue (true, ${p.defaultValue});
        slider->setVelocityBasedMode (true);
        slider->setPopupDisplayEnabled (true, true, this);
        addAndMakeVisible (slider);

        attachments.add (new juce::AudioProcessorValueTreeState::SliderAttachment (processorRef.apvts, "${cppString(p.id)}", *slider));
    }`;
      }
    )
    .join("\n");
  const paintedVisuals = descriptors.map(({ controlType: type }, i) => {
    const r = controlRects[i];
    if (type === "meter") return `    // Segmented meter, deliberately not a rotary slider.
    g.setColour (juce::Colours::black.withAlpha (0.38f)); g.fillRoundedRectangle (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(r.w)}, ${cppFloat(r.h)}, 5.0f);
    for (int segment = 0; segment < 12; ++segment) { g.setColour (segment < 8 ? juce::Colour::fromString ("cc${accentColor.replace("#", "")}") : juce::Colours::darkred); g.fillRect (${r.x + 12}, ${r.y + r.h - 16} - segment * ${Math.max(5, Math.floor((r.h - 24) / 12))}, ${Math.max(12, r.w - 24)}, 3); }`;
    if (type === "eq") return `    // Curve-led EQ monitor, deliberately not a rotary slider.
    g.setColour (juce::Colours::black.withAlpha (0.25f)); g.fillRoundedRectangle (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(r.w)}, ${cppFloat(r.h)}, 6.0f);
    g.setColour (juce::Colour::fromString ("cc${accentColor.replace("#", "")}")); juce::Path curve; curve.startNewSubPath (${cppFloat(r.x)}, ${cppFloat(r.y + r.h / 2)}); curve.cubicTo (${cppFloat(r.x + r.w * .25)}, ${cppFloat(r.y + r.h * .18)}, ${cppFloat(r.x + r.w * .62)}, ${cppFloat(r.y + r.h * .78)}, ${cppFloat(r.x + r.w)}, ${cppFloat(r.y + r.h * .36)}); g.strokePath (curve, juce::PathStrokeType (2.0f));`;
    if (type === "amp" || type === "cab") return `    // ${type} hardware faceplate.
    g.setColour (juce::Colours::black.withAlpha (0.42f)); g.fillRoundedRectangle (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(r.w)}, ${cppFloat(r.h)}, 8.0f);
    g.setColour (juce::Colour::fromString ("aa${accentColor.replace("#", "")}")); g.drawRoundedRectangle (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(r.w)}, ${cppFloat(r.h)}, 8.0f, 2.0f);`;
    if (type === "mic" || type === "mic_stand") return `    // Mic-position target.
    g.setColour (juce::Colours::black.withAlpha (0.35f)); g.fillEllipse (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(Math.min(r.w, r.h))}, ${cppFloat(Math.min(r.w, r.h))});
    g.setColour (juce::Colour::fromString ("cc${accentColor.replace("#", "")}")); g.drawEllipse (${cppFloat(r.x)}, ${cppFloat(r.y)}, ${cppFloat(Math.min(r.w, r.h))}, ${cppFloat(Math.min(r.w, r.h))}, 2.0f);`;
    return "";
  }).filter(Boolean).join("\n");
  const identityPlaquePaint = identity ? `    g.setColour (juce::Colour::fromString ("aa${textColor.replace("#", "")}"));
    g.setFont (juce::Font ("${nativeTypeface(resolvedUi?.theme.font)}", 10.0f, juce::Font::bold));
    g.drawText ("${cppString(identity.modelLabel)}", getWidth() - 220, getHeight() - 30, 200, 12, juce::Justification::right);
    g.setFont (juce::Font ("${nativeTypeface(resolvedUi?.theme.font)}", 8.0f, juce::Font::plain));
    g.drawText ("${cppString(identity.styleTokens.join(" / ").toUpperCase())}", getWidth() - 280, 16, 250, 10, juce::Justification::right);` : "";
  const visualTypes = new Set(["meter", "eq", "amp", "cab", "mic", "mic_stand", "label", "waveform"]);
  const collectionFor = (type: string) =>
    type === "toggle" ? "toggles" :
    type === "button" || type === "pad" ? "pads" :
    type === "select" ? "combos" :
    visualTypes.has(type) ? "visualComponents" : "sliders";
  const resizedControls = descriptors.map(({ controlType: type }, i) => {
    const r = controlRects[i];
    const collection = collectionFor(type);
    const nativeIndex = descriptors.slice(0, i).filter((d) => collectionFor(d.controlType) === collection).length;
    if (collection === "sliders") return `    {
        juce::Rectangle<int> cell (${r.x}, ${r.y}, ${r.w}, ${r.h});
        labels[${i}]->setBounds (cell.removeFromTop (20));
        sliders[${nativeIndex}]->setBounds (cell.reduced (8));
    }`;
    return `    labels[${i}]->setBounds (${r.x}, ${Math.max(0, r.y - 18)}, ${r.w}, 18);
    ${collection}[${nativeIndex}]->setBounds (${r.x}, ${r.y}, ${r.w}, ${r.h});`;
  }).join("\n");

  return `#include "PluginEditor.h"

// Visual identity recipe ${cppString(identity?.id || "legacy-derived")} (family=${cppString(identity?.family || family || category || "unknown")})
// This component is UI-only. Meter values are sampled from processor-owned
// atomics on this component's message-thread timer; the audio thread never
// calls into or retains a reference to an editor.
class RecipeVisualComponent final : public juce::Component, private juce::Timer
{
public:
    RecipeVisualComponent (${projectName}AudioProcessor& processorIn, juce::String typeIn, juce::String styleIn, juce::Colour accentIn, float phaseIn, float tempoIn, bool allowMotion)
        : processor (processorIn), type (std::move (typeIn)), style (std::move (styleIn)), accent (accentIn), phase (phaseIn), tempo (tempoIn), decorativeMotionAllowed (allowMotion)
    {
        if (type == "meter" || (allowMotion && type == "eq")) startTimerHz (24);
        setAccessible (true);
        setTitle (type + " visual, recipe " + style);
    }

    void paint (juce::Graphics& g) override
    {
        auto r = getLocalBounds().toFloat().reduced (2.0f);
        g.setColour (juce::Colours::black.withAlpha (0.52f)); g.fillRoundedRectangle (r, 6.0f);
        if (type == "amp" || type == "cab")
        {
            g.setColour (accent.withAlpha (0.55f)); g.drawRoundedRectangle (r, 7.0f, 2.0f);
            g.setColour (juce::Colours::black.withAlpha (0.5f)); g.fillRect (r.reduced (10.0f, 16.0f));
            g.setColour (accent.withAlpha (0.28f));
            if (style == "rack") for (float x = r.getX() + 12.0f; x < r.getRight() - 8.0f; x += 8.0f)
                g.drawVerticalLine ((int) x, r.getY() + 18.0f, r.getBottom() - 12.0f);
            else if (style == "pedal") g.fillRoundedRectangle (r.reduced (r.getWidth() * .2f, r.getHeight() * .25f), 12.0f);
            else if (style == "instrument") for (float y = r.getY() + 18.0f; y < r.getBottom() - 12.0f; y += 7.0f)
                g.drawHorizontalLine ((int) y, r.getX() + 10.0f, r.getRight() - 10.0f);
            else g.drawEllipse (r.reduced (r.getWidth() * .3f, r.getHeight() * .18f), 1.5f);
            return;
        }
        if (type == "meter" && style == "needle")
        {
            auto centre = juce::Point<float> (r.getCentreX(), r.getBottom() - 8.0f);
            g.setColour (juce::Colour (0xffd8c9a4)); g.fillRoundedRectangle (r, 5.0f);
            const float angle = juce::jmap (meterLeft, -1.05f, 1.05f);
            auto tip = centre.translated (std::sin (angle) * r.getWidth() * 0.32f, -std::cos (angle) * r.getHeight() * 0.62f);
            g.setColour (juce::Colour (0xff9b231b)); g.drawLine (juce::Line<float> (centre, tip), 2.0f);
            return;
        }
        if (type == "meter" && style == "plasma-bar")
        {
            g.setGradientFill ({ accent.withAlpha (0.35f), r.getBottomLeft(), juce::Colours::cyan.withAlpha (0.18f), r.getTopLeft(), false });
            auto levelBar = r.reduced (r.getWidth() * 0.35f, 6.0f); levelBar.setTop (levelBar.getBottom() - levelBar.getHeight() * juce::jmax (meterLeft, meterRight));
            g.fillRoundedRectangle (levelBar, 4.0f); return;
        }
        if (type == "meter" && style == "scope-stereo")
        {
            juce::Path p; p.startNewSubPath (r.getX(), r.getCentreY());
            for (float x = 0; x <= r.getWidth(); x += 3.0f)
                p.lineTo (r.getX() + x, r.getCentreY() + std::sin (x * 0.08f + phase) * r.getHeight() * 0.42f * (x < r.getWidth() * 0.5f ? meterLeft : meterRight));
            g.setColour (accent); g.strokePath (p, juce::PathStrokeType (1.8f)); return;
        }
        if (type == "meter")
        {
            const int litSegments = juce::jlimit (0, 12, (int) std::ceil (juce::jmax (meterLeft, meterRight) * 12.0f));
            for (int i = 0; i < 12; ++i) { const float alpha = i < litSegments ? 0.92f : 0.16f; g.setColour (i < 8 ? accent.withAlpha (alpha) : juce::Colours::darkred.withAlpha (alpha)); g.fillRect (r.getX() + 8.0f, r.getBottom() - 7.0f - i * juce::jmax (4.0f, r.getHeight() / 14.0f), r.getWidth() - 16.0f, 3.0f); }
            return;
        }
        if (type == "eq")
        {
            juce::Path p; p.startNewSubPath (r.getX(), r.getCentreY());
            const float idle = style == "static" ? 0.0f : std::sin (phase) * juce::jmin (2.5f, r.getHeight() * 0.03f);
            p.cubicTo (r.getX() + r.getWidth() * .25f, r.getY() + r.getHeight() * .2f + idle, r.getX() + r.getWidth() * .62f, r.getBottom() - r.getHeight() * .2f - idle, r.getRight(), r.getY() + r.getHeight() * .36f);
            g.setColour (accent); g.strokePath (p, juce::PathStrokeType (2.0f)); return;
        }
        g.setColour (accent.withAlpha (0.7f)); g.drawRoundedRectangle (r, 6.0f, 1.5f);
    }
private:
    void timerCallback() override
    {
        if (type == "meter")
            processor.getMeterLevels (meterLeft, meterRight);
        if (decorativeMotionAllowed)
            phase += 0.025f * tempo;
        repaint();
    }
    ${projectName}AudioProcessor& processor;
    juce::String type, style; juce::Colour accent;
    float phase, tempo, meterLeft = 0.0f, meterRight = 0.0f;
    bool decorativeMotionAllowed;
};

${projectName}AudioProcessorEditor::${projectName}AudioProcessorEditor (${projectName}AudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p),
      styledLookAndFeel (juce::Colour::fromString ("ff${accentColor.replace("#", "")}"))
{
    setLookAndFeel (&styledLookAndFeel);

${buildSemanticGroups}
${buildSliders}

    setSize (${resolvedUi ? resolvedUi.artboard.width : Math.max(360, ...controlRects.map((r) => r.x + r.w + 20))}, ${resolvedUi ? resolvedUi.artboard.height : Math.max(220, ...controlRects.map((r) => r.y + r.h + 20))});
}

${projectName}AudioProcessorEditor::~${projectName}AudioProcessorEditor()
{
    for (auto* slider : sliders) slider->setLookAndFeel (nullptr);
    for (auto* toggle : toggles) toggle->setLookAndFeel (nullptr);
    for (auto* pad : pads) pad->setLookAndFeel (nullptr);
    for (auto* combo : combos) combo->setLookAndFeel (nullptr);
    for (auto* label : labels) label->setLookAndFeel (nullptr);
    setLookAndFeel (nullptr);
}

void ${projectName}AudioProcessorEditor::paint (juce::Graphics& g)
{
${toJucePanelPaintCode(panelRecipe, bgColor)}
${hierarchyPaint}
${paintedVisuals}
${identityPlaquePaint}
}

void ${projectName}AudioProcessorEditor::resized()
{
${visibleSemanticGroups.map((group, i) => `    semanticGroups[${i}]->setBounds (${group.x}, ${group.y}, ${group.w}, ${group.h});`).join("\n")}
${resizedControls}
}
`;
}

export interface ScaffoldResult {
  projectDir: string;
  /** Opaque server-owned handle accepted by /api/native/build. */
  scaffoldId: string;
  slug: string;
  projectName: string;
  dspTranslated: boolean;
  warning?: string;
  /** Real-time-safety score (0-100) of the translated C++ DSP core. */
  cppRealtimeScore?: number;
  /** Concrete real-time-safety findings on the generated core. */
  cppAuditFindings?: string[];
  /** Idiom-presence score (0-100, informational) -- parameter smoothing,
   *  guarded division/log. Complements cppRealtimeScore's hazard-absence
   *  check; never gates shipping. */
  cppIdiomScore?: number;
  /** Concrete idiom findings on the generated core. */
  cppIdiomFindings?: string[];
}

export async function scaffoldNativeProject(plugin: NativePlugin, llmConfig: LocalLLMConfig): Promise<ScaffoldResult> {
  validateNativePlugin(plugin);
  const target = classifyNativeProjectTarget(plugin);
  const slug = slugify(plugin.name);
  const projectName = pascalCase(slug);
  const pluginCode = pluginCodeFromSlug(slug);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const projectDir = path.join(BUILD_ROOT, `${slug}-${stamp}`);

  fs.mkdirSync(path.join(projectDir, "Source", "dsp"), { recursive: true });

  const paramIds = plugin.parameters.map((p) => p.id);
  let translation: TranslationResult;
  let dspTranslated = true;
  let warning: string | undefined;

  if (plugin.routing?.auxiliaryInput.supported) {
    translation = fallbackTranslation(plugin);
    dspTranslated = false;
    warning = "Used the audited deterministic sidechain port; untrusted model-generated C++ is not executed or accepted for auxiliary-bus builds.";
  } else {
    console.log(`[native-build] Translating DSP for "${plugin.name}" via ${llmConfig.provider} (${llmConfig.provider === "ollama" ? llmConfig.ollamaModel : llmConfig.lmStudioModel})...`);
    const translationStarted = Date.now();
    try {
      const raw = await callLocalLLMServerSide(
        llmConfig,
        DSP_TRANSLATION_SYSTEM_PROMPT,
        `Parameter ids (Params struct members): ${JSON.stringify(paramIds)}\n\nJS DSP function body:\n${plugin.dspFunction}` +
          buildCppPatternContext(plugin.category, plugin.dspFunction)
      );
      translation = parseTranslation(raw);
      if (!translation.methodBody) throw new Error("Empty translation body returned by local model.");
      console.log(`[native-build] DSP translation finished in ${((Date.now() - translationStarted) / 1000).toFixed(1)}s.`);
    } catch (err: any) {
      console.error(`[native-build] DSP translation failed after ${((Date.now() - translationStarted) / 1000).toFixed(1)}s:`, err.message);
      translation = fallbackTranslation(plugin);
      dspTranslated = false;
      warning = `DSP translation via local model failed (${err.message}); wrote a passthrough placeholder instead.`;
    }
  }

  // Real-time-safety audit of the translated DSP core BEFORE it ships: a
  // local model can introduce a heap allocation / lock / IO call the JS
  // original never had. Reviewer-grade findings are written next to the code
  // and surfaced in the scaffold result; a non-safe core is flagged loudly.
  const coreAudit = auditCppRealtimeSafety(translation.methodBody, "core");

  // Positive-idiom check: presence of correct patterns (smoothing, guarded
  // division/log), not just absence of hazards. Informational only -- never
  // affects dspTranslated/warning the way the safety audit does.
  const idiomAudit = auditCppIdioms(translation.methodBody, plugin.parameters);
  const cppIdiomFindings = idiomAudit.findings.map((f) => `[core] [${f.severity}] [${f.dimension}] ${f.message}`);
  console.log(`[native-build] core idiom: ${formatCppIdiomAudit(idiomAudit)}`);

  // Second, independent check: the assembled PluginProcessor.cpp buffer-write
  // site MUST carry the NaN/Inf/denormal safety-net guard (see
  // generatePluginProcessorCpp) -- this is always emitted by the template
  // regardless of whether the DSP translation above succeeded, so this
  // should never actually fire against real output, but it exists so a
  // future template regression can't silently ship an unguarded buffer
  // write to a real DAW.
  const processorCpp = generatePluginProcessorCpp(projectName, plugin.parameters, target, plugin, plugin.resolvedUi, plugin.routing);
  const bufferWriteAudit = auditCppRealtimeSafety(processorCpp.bufferWriteSite, "full", { requireSafetyNet: true });

  const cppAuditFindings = [
    ...coreAudit.findings.map((f) => `[core] [${f.severity}] ${f.message}`),
    ...bufferWriteAudit.findings.map((f) => `[processBlock] [${f.severity}] ${f.message}`),
  ];
  console.log(`[native-build] core: ${formatCppAudit(coreAudit)}`);
  console.log(`[native-build] processBlock: ${formatCppAudit(bufferWriteAudit)}`);
  if (!coreAudit.realtimeSafe && dspTranslated) {
    const rt = `Translated C++ core is NOT real-time-safe (score ${coreAudit.score}/100): ${coreAudit.findings.filter((f) => f.severity === "critical").map((f) => f.message).join("; ")}`;
    warning = warning ? `${warning} ${rt}` : rt;
  }
  if (!bufferWriteAudit.realtimeSafe) {
    const rt = `Generated PluginProcessor.cpp is missing the mandatory NaN/Inf/denormal safety-net guard at the buffer write (score ${bufferWriteAudit.score}/100): ${bufferWriteAudit.findings.filter((f) => f.severity === "critical").map((f) => f.message).join("; ")}`;
    warning = warning ? `${warning} ${rt}` : rt;
  }

  fs.writeFileSync(path.join(projectDir, "CMakeLists.txt"), generateCMakeLists(projectName, pluginCode, target));
  fs.writeFileSync(path.join(projectDir, "Source", "Parameters.h"), generateParametersHeader(plugin.parameters));
  fs.writeFileSync(path.join(projectDir, "Source", "dsp", "ProcessorCore.h"), generateProcessorCoreHeader(translation));
  fs.writeFileSync(
    path.join(projectDir, "Source", "dsp", "REALTIME_AUDIT.txt"),
    `${formatCppAudit(coreAudit)}\n\n${cppAuditFindings.length ? cppAuditFindings.join("\n") : "No heap allocation, locks, IO, or logging found in the audio path, and the NaN/Inf/denormal safety-net guard is present at the buffer write."}\n\n` +
      `${formatCppIdiomAudit(idiomAudit)}\n\n${cppIdiomFindings.length ? cppIdiomFindings.join("\n") : "Parameters that drive filter coefficients are smoothed, and log/division are guarded."}\n`
  );
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.h"), generatePluginProcessorHeader(projectName, target, plugin));
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.cpp"), processorCpp.cpp);
  fs.writeFileSync(path.join(projectDir, "Source", "LookAndFeel.h"), generateLookAndFeelHeader());
  fs.writeFileSync(
    path.join(projectDir, "Source", "LookAndFeel.cpp"),
    generateLookAndFeelCpp(
      plugin.parameters.map((p) => resolveParamKnobStyle(p, plugin.category, plugin.attributes)),
      safeHex(plugin.resolvedUi?.theme.accent || plugin.customSkin?.accentColor, "#7C5CFF")
    )
  );
  fs.writeFileSync(path.join(projectDir, "Source", "PluginEditor.h"), generatePluginEditorHeader(projectName));
  fs.writeFileSync(
    path.join(projectDir, "Source", "PluginEditor.cpp"),
    generatePluginEditorCpp(projectName, plugin.parameters, plugin.customSkin, plugin.category, plugin.attributes, plugin.resolvedUi, plugin.family)
  );
  // Manifest lets the compile-repair loop (and any later tooling) know the
  // parameter ids and project identity without re-parsing generated C++.
  fs.writeFileSync(
    path.join(projectDir, "build-manifest.json"),
    JSON.stringify({ projectName, slug, paramIds, dspTranslated, resolvedUi: plugin.resolvedUi }, null, 2)
  );

  return {
    projectDir,
    scaffoldId: registerScaffoldDirectory(projectDir),
    slug,
    projectName,
    dspTranslated,
    warning,
    cppRealtimeScore: coreAudit.score,
    cppAuditFindings,
    cppIdiomScore: idiomAudit.idiomHealth,
    cppIdiomFindings,
  };
}

// ---------------------------------------------------------------------------
// Build execution: spawn real cmake configure + build, track progress in
// memory so the client can poll for a live log instead of a fake one.
// On compile failure the loop runs the architecture doc's cycle --
// analyze errors -> generate fixes (local LLM against the real compiler
// output) -> recompile -- and finally falls back to a guaranteed-compiling
// passthrough core so a working toolchain always yields a .vst3.
// ---------------------------------------------------------------------------

export interface BuildJob {
  id: string;
  projectDir: string;
  status: "running" | "success" | "failed";
  log: string[];
  vst3Path?: string;
  startedAt: number;
  finishedAt?: number;
  /** Number of compile passes actually run. */
  attempts: number;
  /** One honest entry per repair action taken between compile passes. */
  repairHistory: string[];
  /** True when the DSP core was replaced by the passthrough to get a compiling artifact. */
  usedPassthroughFallback: boolean;
}

const buildJobs = new Map<string, BuildJob>();

/**
 * Pull the actionable error lines out of raw cmake/compiler output.
 * Understands MSVC ("file(12,5): error C2065: ..."), GCC/Clang
 * ("file.h:12:5: error: ..."), linker ("error LNK2019"), and CMake
 * ("CMake Error at ...") formats. Lines touching our generated sources
 * (especially the DSP core, the only non-deterministic file) sort first.
 */
export function extractCompileErrors(log: string): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const isError =
      /\berror\s+C\d{4}\b/i.test(line) ||          // MSVC compile
      /\berror\s+LNK\d+\b/i.test(line) ||           // MSVC link
      /:\d+(?::\d+)?:\s*(?:fatal\s+)?error[:\s]/i.test(line) || // GCC/Clang
      /^CMake Error\b/i.test(line) ||
      /^\s*fatal error\b/i.test(line);
    if (!isError) continue;
    // Normalize duplicate diagnostics from parallel compiles of the same TU
    const key = line.replace(/^\s*\d+>\s*/, "").slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(key);
  }
  errors.sort((a, b) => {
    const score = (l: string) => (/ProcessorCore\.h/i.test(l) ? 0 : /Source[\\/]/i.test(l) ? 1 : 2);
    return score(a) - score(b);
  });
  return errors.slice(0, 12);
}

const CPP_REPAIR_SYSTEM_PROMPT = `You fix C++20 compile errors in the DSP core of a JUCE audio plugin. You will receive the current ProcessorCore.h and the REAL compiler error lines. The only part you may change is the DSP state members and the body of:
  float processSample(float inputSample, const Params& params) noexcept
Output ONLY (no markdown fences, no commentary):
- one line per state member as "// MEMBER: <type> <name> = <initializer>;"
- then the corrected method BODY (statements only, no signature, no class).
Rules: params.<id> members are floats; no heap allocation, no STL containers, no exceptions in the body; fixed-size C-array members for buffers; preserve the algorithm — fix ONLY what the errors indicate.`;

/** Ask the local model to fix the DSP core using real compiler errors, and
 *  rewrite Source/dsp/ProcessorCore.h. Returns a summary, or null when no
 *  usable fix came back. */
async function repairProcessorCore(
  projectDir: string,
  errors: string[],
  llmConfig: LocalLLMConfig
): Promise<string | null> {
  const corePath = path.join(projectDir, "Source", "dsp", "ProcessorCore.h");
  const current = fs.readFileSync(corePath, "utf8");
  const raw = await callLocalLLMServerSide(
    llmConfig,
    CPP_REPAIR_SYSTEM_PROMPT,
    `Compiler errors:\n${errors.join("\n")}\n\nCurrent ProcessorCore.h:\n${current}` + buildCppErrorPatternContext(errors)
  );
  const translation = parseTranslation(raw);
  if (!translation.methodBody || translation.methodBody.length < 10) return null;
  fs.writeFileSync(corePath, generateProcessorCoreHeader(translation));
  return `model rewrote the DSP core against ${errors.length} compiler error(s)`;
}

/**
 * When every configure attempt fails, diagnose WHY in user-actionable terms.
 * vswhere is the ground truth for MSVC ("Program Files\\Microsoft Visual
 * Studio" folders can exist as empty shells with no compiler in them —
 * observed live on this machine).
 */
function describeMissingToolchain(): string {
  let vsInstances = 0;
  try {
    const vswhere = path.join(
      process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
      "Microsoft Visual Studio", "Installer", "vswhere.exe"
    );
    if (fs.existsSync(vswhere)) {
      const out = require("node:child_process").execFileSync(vswhere, ["-products", "*", "-format", "json"], { encoding: "utf8", timeout: 15000 });
      vsInstances = (JSON.parse(out) as any[]).length;
    }
  } catch {
    // treat as unknown; the advice below still applies
  }
  if (vsInstances > 0) {
    return `[Visual Studio is installed but CMake could not use it — make sure the "Desktop development with C++" workload is installed via the Visual Studio Installer, then retry.]\n`;
  }
  return (
    `[No C++ compiler was found on this machine (vswhere reports no Visual Studio instances, and no nmake/g++ answered).\n` +
    ` To build real VST3s, install "Build Tools for Visual Studio 2022" with the "Desktop development with C++" workload:\n` +
    `   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"\n` +
    ` then retry this build — everything up to the compiler (project, CMake, DSP port, repair loop) already works.]\n`
  );
}

/**
 * Locate vcvars64.bat by scanning standard install paths directly — the
 * supported route when MSVC is on disk but the VS instance database is
 * broken (vswhere reports nothing, so cmake's VS generators can't find the
 * toolchain, yet cl.exe works fine once vcvars sets the environment).
 */
export function findVcvars64(): string | null {
  const roots = [process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", process.env.ProgramFiles || "C:/Program Files"];
  const years = ["2022", "18", "2019"];
  const editions = ["BuildTools", "Community", "Professional", "Enterprise"];
  for (const root of roots) {
    for (const year of years) {
      for (const edition of editions) {
        const candidate = path.join(root, "Microsoft Visual Studio", year, edition, "VC", "Auxiliary", "Build", "vcvars64.bat");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** The Ninja that ships inside the same VS install as vcvars64.bat. */
function findBundledNinja(vcvars64: string): string | null {
  // <install>/VC/Auxiliary/Build/vcvars64.bat -> <install>
  const installRoot = path.resolve(path.dirname(vcvars64), "..", "..", "..");
  const candidate = path.join(installRoot, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja", "ninja.exe");
  return fs.existsSync(candidate) ? candidate : null;
}

/** Replace the DSP core with the guaranteed-compiling passthrough. */
function writePassthroughCore(projectDir: string): void {
  fs.writeFileSync(
    path.join(projectDir, "Source", "dsp", "ProcessorCore.h"),
    generateProcessorCoreHeader(fallbackTranslation())
  );
}

function runCommand(cmd: string, args: string[], cwd: string, onData: (chunk: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    child.stdout.on("data", (d) => onData(d.toString()));
    child.stderr.on("data", (d) => onData(d.toString()));
    child.on("error", (err) => {
      onData(`\n[spawn error] ${err.message}\n`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function findVst3(buildDir: string): string | undefined {
  const stack = [buildDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase().endsWith(".vst3")) return full;
        stack.push(full);
      }
    }
  }
  return undefined;
}

export interface BuildPipelineOptions {
  /** Injectable process runner (tests replace the real cmake spawn). */
  run?: typeof runCommand;
  /** Injectable repair step; defaults to the local-LLM ProcessorCore repair. */
  repair?: (projectDir: string, errors: string[]) => Promise<string | null>;
  /** LLM repair passes before the passthrough fallback. Default 2. */
  maxRepairs?: number;
  /** vcvars64.bat path for the registration-bypass configure attempts;
   *  undefined = auto-detect, null = disable (tests). */
  vcvars?: string | null;
}

/**
 * The full compile -> analyze -> fix -> recompile pipeline. Exported (and
 * awaitable) so tests can drive it with fake runners; startNativeBuild wraps
 * it for the polling HTTP API. Rebuilds are incremental — JUCE object files
 * survive between passes, so repair passes recompile only our sources.
 */
export async function executeBuildPipeline(
  job: BuildJob,
  llmConfig?: LocalLLMConfig,
  opts: BuildPipelineOptions = {}
): Promise<void> {
  const run = opts.run ?? runCommand;
  const maxRepairs = opts.maxRepairs ?? 2;
  const repair =
    opts.repair ??
    (llmConfig && llmConfig.provider !== "gemini"
      ? (dir: string, errors: string[]) => repairProcessorCore(dir, errors, llmConfig)
      : undefined);
  const projectDir = job.projectDir;
  const append = (chunk: string) => {
    job.log.push(chunk);
  };

  const finish = (status: "success" | "failed") => {
    job.status = status;
    job.finishedAt = Date.now();
  };

  // ---- Configure: try generators in order, wiping the CMake cache between
  //      attempts — a failed generator otherwise poisons the cache and makes
  //      every later attempt fail with "does not match the generator used
  //      previously" (observed live with an NMake default pick).
  //      The vcvars attempts bypass VS instance registration entirely: MSVC
  //      can be fully on disk while vswhere reports nothing (observed live),
  //      and vcvars64 + Ninja/NMake still uses it.
  const vcvars = opts.vcvars === undefined ? findVcvars64() : opts.vcvars;
  const bundledNinja = vcvars ? findBundledNinja(vcvars) : null;

  interface ConfigureAttempt {
    label: string;
    /** Plain cmake args, or a full shell command string (vcvars wrapping). */
    args?: string[];
    shellCommand?: string;
    /** Env prefix future compile passes must reuse ("" = none). */
    envPrefix: string;
    /** Single-config generator: pass --build without --config. */
    singleConfig: boolean;
  }
  const configureAttempts: ConfigureAttempt[] = [
    { label: "default generator, x64", args: ["-B", "build", "-S", ".", "-A", "x64"], envPrefix: "", singleConfig: false },
    { label: "Visual Studio 17 2022, x64", args: ["-B", "build", "-S", ".", "-G", `"Visual Studio 17 2022"`, "-A", "x64"], envPrefix: "", singleConfig: false },
  ];
  if (vcvars) {
    const prefix = `call "${vcvars}" >nul && `;
    if (bundledNinja) {
      configureAttempts.push({
        label: "MSVC via vcvars64 + Ninja (registration bypass)",
        shellCommand: `${prefix}cmake -B build -S . -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM="${bundledNinja}"`,
        envPrefix: prefix,
        singleConfig: true,
      });
    }
    configureAttempts.push({
      label: "MSVC via vcvars64 + NMake (registration bypass)",
      shellCommand: `${prefix}cmake -B build -S . -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release`,
      envPrefix: prefix,
      singleConfig: true,
    });
  }
  configureAttempts.push({ label: "default generator, no arch flag", args: ["-B", "build", "-S", "."], envPrefix: "", singleConfig: false });

  let code = 1;
  let winner: ConfigureAttempt | null = null;
  for (let i = 0; i < configureAttempts.length && code !== 0; i++) {
    const attempt = configureAttempts[i];
    if (i > 0) {
      append(`\n[configure failed — wiping the CMake cache and retrying with ${attempt.label}]\n`);
      fs.rmSync(path.join(projectDir, "build", "CMakeCache.txt"), { force: true });
      fs.rmSync(path.join(projectDir, "build", "CMakeFiles"), { recursive: true, force: true });
    }
    if (attempt.shellCommand) {
      append(`> ${attempt.shellCommand}\n`);
      code = await run(attempt.shellCommand, [], projectDir, append);
    } else {
      append(`> cmake ${attempt.args!.join(" ")}\n`);
      code = await run("cmake", attempt.args!, projectDir, append);
    }
    if (code === 0) winner = attempt;
  }
  if (code !== 0 || !winner) {
    append(`\n[configure failed on every generator]\n${describeMissingToolchain()}`);
    return finish("failed");
  }

  // ---- Compile -> analyze -> fix -> recompile ----
  let repairsUsed = 0;
  for (;;) {
    job.attempts += 1;
    const logMark = job.log.length;
    if (winner.envPrefix) {
      const buildCmd = `${winner.envPrefix}cmake --build build${winner.singleConfig ? "" : " --config Release"}`;
      append(`\n> ${buildCmd}   [compile pass ${job.attempts}]\n`);
      code = await run(buildCmd, [], projectDir, append);
    } else {
      append(`\n> cmake --build build --config Release   [compile pass ${job.attempts}]\n`);
      code = await run("cmake", ["--build", "build", "--config", "Release"], projectDir, append);
    }

    if (code === 0) {
      const vst3Path = findVst3(path.join(projectDir, "build"));
      job.vst3Path = vst3Path;
      if (!vst3Path) append(`\n[build reported success but no .vst3 bundle was found under build/]\n`);
      return finish(vst3Path ? "success" : "failed");
    }

    const errors = extractCompileErrors(job.log.slice(logMark).join(""));
    append(`\n[compile pass ${job.attempts} failed — ${errors.length} error(s) extracted]\n${errors.map((e) => `  ${e}`).join("\n")}\n`);

    // Analyze -> generate fixes with the real compiler evidence.
    if (repair && repairsUsed < maxRepairs && errors.length > 0) {
      repairsUsed += 1;
      append(`\n[repair pass ${repairsUsed}/${maxRepairs}: sending errors + DSP core to the local model]\n`);
      try {
        const summary = await repair(projectDir, errors);
        if (summary) {
          job.repairHistory.push(`pass ${repairsUsed}: ${summary}`);
          append(`[repair applied: ${summary} — recompiling]\n`);
          continue;
        }
        job.repairHistory.push(`pass ${repairsUsed}: model returned no usable fix`);
        append(`[repair returned no usable fix]\n`);
      } catch (err: any) {
        job.repairHistory.push(`pass ${repairsUsed}: repair call failed (${err.message})`);
        append(`[repair call failed: ${err.message}]\n`);
      }
    }

    // Out of repairs: guarantee a compiling artifact with the passthrough
    // core (clearly flagged) — unless we already did that.
    if (!job.usedPassthroughFallback) {
      job.usedPassthroughFallback = true;
      job.repairHistory.push("final: DSP core replaced with the passthrough fallback so the bundle still builds");
      append(`\n[falling back to the guaranteed-compiling passthrough DSP core — the .vst3 will pass audio through unchanged; re-run the build with a local model available to port the real DSP]\n`);
      writePassthroughCore(projectDir);
      continue;
    }

    append(`\n[even the passthrough core failed to compile — the toolchain/JUCE setup itself is broken]\n`);
    return finish("failed");
  }
}

export function startNativeBuild(projectDir: string, llmConfig?: LocalLLMConfig): string {
  const id = crypto.randomUUID();
  const job: BuildJob = {
    id,
    projectDir,
    status: "running",
    log: [],
    startedAt: Date.now(),
    attempts: 0,
    repairHistory: [],
    usedPassthroughFallback: false,
  };
  buildJobs.set(id, job);
  void executeBuildPipeline(job, llmConfig);
  return id;
}

export function getBuildJob(id: string): BuildJob | undefined {
  return buildJobs.get(id);
}

/** Resolve an artifact only when it belongs to a completed, server-created
 * build. HTTP routes must never accept an arbitrary filesystem path. */
export function getCompletedBuildArtifact(buildId: string): string | undefined {
  if (!buildId || typeof buildId !== "string") return undefined;
  const job = buildJobs.get(buildId);
  if (!job || job.status !== "success" || !job.vst3Path) return undefined;
  const root = path.resolve(BUILD_ROOT) + path.sep;
  let artifact: string;
  try { artifact = fs.realpathSync(job.vst3Path); } catch { return undefined; }
  if (!artifact.startsWith(root) || !artifact.toLowerCase().endsWith(".vst3")) return undefined;
  return artifact;
}
