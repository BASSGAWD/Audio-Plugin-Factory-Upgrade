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
} from "../src/utils/uiRenderPatterns";

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
  ampKnobStyle?: string;
  ampTolexPattern?: string;
  cabGrillStyle?: string;
}

export interface NativePlugin {
  name: string;
  category?: string;
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
  return /^[0-9]/.test(cleaned) ? `p_${cleaned}` : cleaned;
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
1. The JS body of function(inputSample, params, state) { ... return outputSample; } that has ALREADY been tested and works correctly in a browser.
2. The exact list of parameter ids available on "params" (a Params struct with a float member per id, same names).

Output ONLY the body of one C++ method with this exact signature (no class wrapper, no includes, no markdown fences, no commentary):
  float processSample(float inputSample, const Params& params) noexcept

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

function fallbackTranslation(): TranslationResult {
  return {
    memberDeclarations: [],
    methodBody:
      "// NOTE: local-model DSP translation was unavailable or failed, so this is a\n" +
      "// transparent passthrough. Re-run the build once a local model (Ollama/LM Studio)\n" +
      "// is reachable to get a real port of the tested JS DSP into C++.\n" +
      "return inputSample;",
  };
}

function generateCMakeLists(projectName: string, pluginCode: string): string {
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
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
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

function generatePluginProcessorHeader(projectName: string): string {
  return `#pragma once
#include <JuceHeader.h>
#include <cmath>
#include "Parameters.h"
#include "dsp/ProcessorCore.h"

class ${projectName}AudioProcessor : public juce::AudioProcessor
{
public:
    ${projectName}AudioProcessor();
    ~${projectName}AudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "${projectName}"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
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

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    ProcessorCore mCore;

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
function generateProcessBlockFunction(projectName: string, paramReads: string): string {
  return `void ${projectName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    Params params;
${paramReads}

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* data = buffer.getWritePointer (channel);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            data[i] = sanitizeSample (mCore.processSample (data[i], params));
    }
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

function generatePluginProcessorCpp(projectName: string, parameters: NativeParameter[]): ProcessorCppResult {
  const paramDefs = parameters
    .map(
      (p) =>
        `    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID("${p.id}", 1), "${p.name}", juce::NormalisableRange<float>(${cppFloat(p.min)}, ${cppFloat(p.max)}), ${cppFloat(p.defaultValue)}));`
    )
    .join("\n");

  const paramReads = parameters
    .map((p) => `    params.${cppIdentifier(p.id)} = apvts.getRawParameterValue("${p.id}")->load();`)
    .join("\n");

  const processBlockFn = generateProcessBlockFunction(projectName, paramReads);
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
    : AudioProcessor (BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo())
                                        .withOutput ("Output", juce::AudioChannelSet::stereo())),
      apvts (*this, nullptr, "PARAMETERS", createParameterLayout())
{
}

void ${projectName}AudioProcessor::prepareToPlay (double sampleRate, int)
{
    mCore.prepare (sampleRate);
    mCore.reset();
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

// Coarse category -> a coherent DEFAULT knob/panel style for ordinary
// parameters (no explicit ampKnobStyle set). Deliberately one style per
// plugin, not one per knob -- matches the existing GUI philosophy rule
// ("one dominant accentColor, not a rainbow of per-knob colors") extended
// to knob CRAFT, not just color. Original style-family choices, not
// modeled on any specific commercial product's actual visual identity.
const CATEGORY_DEFAULT_KNOB_STYLE: Record<string, KnobRenderStyle> = {
  distortion: "chickenhead",
  delay: "vintage_amber",
  filter: "modern_pointer",
  synthesizer: "neonring",
  dynamics: "silvercap",
  modulation: "vintage_amber",
  reverb: "silvercap",
};
const CATEGORY_DEFAULT_PANEL_STYLE: Record<string, PanelTextureStyle> = {
  distortion: "carbon_weave",
  delay: "tweed_weave",
  filter: "matte_poly",
  synthesizer: "brushed_metal",
  dynamics: "brushed_metal",
  modulation: "leather_grain",
  reverb: "matte_poly",
};

// Research into professional plugin UI design converged on "skeuomorphism
// should scale with how strongly a plugin claims to emulate real hardware,
// independent of its DSP category" -- a "vintage tape echo" and a "modern
// digital delay algorithm" shouldn't automatically get the same knob/panel
// treatment just because both are category "delay". plugin.buildReport
// .attributes (dreamy/aggressive/vintage/futuristic/clinical/minimal/
// industrial/luxurious -- the SAME vocabulary GenerativeFaceplate.tsx's
// ATTRIBUTE_PATTERN already keys its generative-art pattern off) is an
// existing, already-populated signal that captures exactly this. Each
// category maps to exactly one plausible style today (confirmed: no small
// family of options to pick within), so an attribute match here is a real
// override of the category default, not a subtle nudge -- deliberate: it's
// what the underlying design principle actually calls for.
const ATTRIBUTE_KNOB_NUDGE: Partial<Record<string, KnobRenderStyle>> = {
  vintage: "vintage_amber",
  industrial: "chickenhead",
  futuristic: "neonring",
  clinical: "modern_pointer",
  minimal: "modern_pointer",
  luxurious: "silvercap",
};
const ATTRIBUTE_PANEL_NUDGE: Partial<Record<string, PanelTextureStyle>> = {
  vintage: "wood_grain",
  industrial: "carbon_weave",
  futuristic: "matte_poly",
  clinical: "matte_poly",
  minimal: "matte_poly",
  luxurious: "leather_grain",
};

export function resolvePanelStyle(category: string | undefined, attributes?: string[]): PanelTextureStyle {
  const categoryDefault = (category && CATEGORY_DEFAULT_PANEL_STYLE[category]) || "matte_poly";
  const nudge = attributes?.map((a) => ATTRIBUTE_PANEL_NUDGE[a]).find((s): s is PanelTextureStyle => Boolean(s));
  return nudge ?? categoryDefault;
}

/** ampKnobStyle (an explicit choice -- amp/cab widgets, or any control the
 *  model/UI explicitly styled) always wins. Otherwise: an attribute match
 *  overrides the plain category default (see ATTRIBUTE_KNOB_NUDGE doc
 *  above); with neither, every ordinary knob on the plugin shares one
 *  category-appropriate default, same "one dominant style" principle as the
 *  panel texture above. */
export function resolveParamKnobStyle(param: NativeParameter, category: string | undefined, attributes?: string[]): KnobRenderStyle {
  if (param.ampKnobStyle) return resolveKnobStyle(param.ampKnobStyle);
  const categoryDefault = (category && CATEGORY_DEFAULT_KNOB_STYLE[category]) || "modern_pointer";
  const nudge = attributes?.map((a) => ATTRIBUTE_KNOB_NUDGE[a]).find((s): s is KnobRenderStyle => Boolean(s));
  return nudge ?? categoryDefault;
}

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
    explicit StyledLookAndFeel (juce::Colour accent);

    void drawRotarySlider (juce::Graphics& g, int x, int y, int width, int height,
                            float sliderPosProportional, float rotaryStartAngle, float rotaryEndAngle,
                            juce::Slider& slider) override;

private:
    juce::Colour accentColour;
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

StyledLookAndFeel::StyledLookAndFeel (juce::Colour accent) : accentColour (accent) {}

void StyledLookAndFeel::drawRotarySlider (juce::Graphics& g, int x, int y, int width, int height,
                                          float sliderPosProportional, float, float,
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

    juce::OwnedArray<juce::Slider> sliders;
    juce::OwnedArray<juce::Label> labels;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::SliderAttachment> attachments;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${projectName}AudioProcessorEditor)
};
`;
}

export function generatePluginEditorCpp(
  projectName: string,
  parameters: NativeParameter[],
  customSkin?: NativePlugin["customSkin"],
  category?: string,
  attributes?: string[]
): string {
  const bgColor = customSkin?.bgColor || "#12161D";
  const accentColor = customSkin?.accentColor || "#7C5CFF";
  const textColor = customSkin?.textColor || "#F4F7FB";
  const panelRecipe = PANEL_TEXTURE_RECIPES[resolvePanelStyle(category, attributes)];

  const paramStyles = parameters.map((p) => resolveParamKnobStyle(p, category, attributes));

  const columns = Math.max(1, Math.min(4, parameters.length));
  const buildSliders = parameters
    .map(
      (p, i) => `    {
        auto* label = labels.add (new juce::Label ({}, "${p.name}"));
        label->setJustificationType (juce::Justification::centred);
        label->setColour (juce::Label::textColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        addAndMakeVisible (label);

        auto* slider = sliders.add (new juce::Slider (juce::Slider::RotaryHorizontalVerticalDrag, juce::Slider::TextBoxBelow));
        slider->getProperties().set ("knobStyle", "${paramStyles[i]}");
        slider->setColour (juce::Slider::rotarySliderFillColourId, juce::Colour::fromString ("ff${accentColor.replace("#", "")}"));
        slider->setTextValueSuffix (" ${p.unit || ""}");
        slider->setDoubleClickReturnValue (true, ${p.defaultValue});
        slider->setVelocityBasedMode (true);
        slider->setPopupDisplayEnabled (true, true, this);
        addAndMakeVisible (slider);

        attachments.add (new juce::AudioProcessorValueTreeState::SliderAttachment (processorRef.apvts, "${p.id}", *slider));
    }`
    )
    .join("\n");

  return `#include "PluginEditor.h"

${projectName}AudioProcessorEditor::${projectName}AudioProcessorEditor (${projectName}AudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p),
      styledLookAndFeel (juce::Colour::fromString ("ff${accentColor.replace("#", "")}"))
{
    setLookAndFeel (&styledLookAndFeel);

${buildSliders}

    setSize (${Math.max(360, columns * 160)}, ${Math.max(220, Math.ceil(parameters.length / columns) * 160 + 60)});
}

${projectName}AudioProcessorEditor::~${projectName}AudioProcessorEditor()
{
    setLookAndFeel (nullptr);
}

void ${projectName}AudioProcessorEditor::paint (juce::Graphics& g)
{
${toJucePanelPaintCode(panelRecipe, bgColor)}
}

void ${projectName}AudioProcessorEditor::resized()
{
    const int columns = ${columns};
    const int cellW = getWidth() / juce::jmax (1, columns);
    const int cellH = 160;

    for (int i = 0; i < sliders.size(); ++i)
    {
        const int col = i % columns;
        const int row = i / columns;
        juce::Rectangle<int> cell (col * cellW, row * cellH + 10, cellW, cellH);

        labels[i]->setBounds (cell.removeFromTop (20));
        sliders[i]->setBounds (cell.reduced (10));
    }
}
`;
}

export interface ScaffoldResult {
  projectDir: string;
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
    translation = fallbackTranslation();
    dspTranslated = false;
    warning = `DSP translation via local model failed (${err.message}); wrote a passthrough placeholder instead.`;
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
  const processorCpp = generatePluginProcessorCpp(projectName, plugin.parameters);
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

  fs.writeFileSync(path.join(projectDir, "CMakeLists.txt"), generateCMakeLists(projectName, pluginCode));
  fs.writeFileSync(path.join(projectDir, "Source", "Parameters.h"), generateParametersHeader(plugin.parameters));
  fs.writeFileSync(path.join(projectDir, "Source", "dsp", "ProcessorCore.h"), generateProcessorCoreHeader(translation));
  fs.writeFileSync(
    path.join(projectDir, "Source", "dsp", "REALTIME_AUDIT.txt"),
    `${formatCppAudit(coreAudit)}\n\n${cppAuditFindings.length ? cppAuditFindings.join("\n") : "No heap allocation, locks, IO, or logging found in the audio path, and the NaN/Inf/denormal safety-net guard is present at the buffer write."}\n\n` +
      `${formatCppIdiomAudit(idiomAudit)}\n\n${cppIdiomFindings.length ? cppIdiomFindings.join("\n") : "Parameters that drive filter coefficients are smoothed, and log/division are guarded."}\n`
  );
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.h"), generatePluginProcessorHeader(projectName));
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.cpp"), processorCpp.cpp);
  fs.writeFileSync(path.join(projectDir, "Source", "LookAndFeel.h"), generateLookAndFeelHeader());
  fs.writeFileSync(
    path.join(projectDir, "Source", "LookAndFeel.cpp"),
    generateLookAndFeelCpp(
      plugin.parameters.map((p) => resolveParamKnobStyle(p, plugin.category, plugin.attributes)),
      plugin.customSkin?.accentColor || "#7C5CFF"
    )
  );
  fs.writeFileSync(path.join(projectDir, "Source", "PluginEditor.h"), generatePluginEditorHeader(projectName));
  fs.writeFileSync(
    path.join(projectDir, "Source", "PluginEditor.cpp"),
    generatePluginEditorCpp(projectName, plugin.parameters, plugin.customSkin, plugin.category, plugin.attributes)
  );
  // Manifest lets the compile-repair loop (and any later tooling) know the
  // parameter ids and project identity without re-parsing generated C++.
  fs.writeFileSync(
    path.join(projectDir, "build-manifest.json"),
    JSON.stringify({ projectName, slug, paramIds, dspTranslated }, null, 2)
  );

  return {
    projectDir,
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
