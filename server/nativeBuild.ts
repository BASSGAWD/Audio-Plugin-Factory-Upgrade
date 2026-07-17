import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { auditCppRealtimeSafety, formatCppAudit } from "../src/utils/cppAudit";

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
}

export interface NativePlugin {
  name: string;
  category?: string;
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

function generatePluginProcessorCpp(projectName: string, parameters: NativeParameter[]): string {
  const paramDefs = parameters
    .map(
      (p) =>
        `    layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID("${p.id}", 1), "${p.name}", juce::NormalisableRange<float>(${cppFloat(p.min)}, ${cppFloat(p.max)}), ${cppFloat(p.defaultValue)}));`
    )
    .join("\n");

  const paramReads = parameters
    .map((p) => `    params.${cppIdentifier(p.id)} = apvts.getRawParameterValue("${p.id}")->load();`)
    .join("\n");

  return `#include "PluginProcessor.h"
#include "PluginEditor.h"

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

void ${projectName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    Params params;
${paramReads}

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        auto* data = buffer.getWritePointer (channel);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            data[i] = mCore.processSample (data[i], params);
    }
}

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
}

function generatePluginEditorHeader(projectName: string): string {
  return `#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class ${projectName}AudioProcessorEditor : public juce::AudioProcessorEditor
{
public:
    explicit ${projectName}AudioProcessorEditor (${projectName}AudioProcessor&);
    ~${projectName}AudioProcessorEditor() override = default;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    ${projectName}AudioProcessor& processorRef;

    juce::OwnedArray<juce::Slider> sliders;
    juce::OwnedArray<juce::Label> labels;
    juce::OwnedArray<juce::AudioProcessorValueTreeState::SliderAttachment> attachments;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${projectName}AudioProcessorEditor)
};
`;
}

function generatePluginEditorCpp(
  projectName: string,
  parameters: NativeParameter[],
  customSkin?: NativePlugin["customSkin"]
): string {
  const bgColor = customSkin?.bgColor || "#12161D";
  const accentColor = customSkin?.accentColor || "#7C5CFF";
  const textColor = customSkin?.textColor || "#F4F7FB";

  const columns = Math.max(1, Math.min(4, parameters.length));
  const buildSliders = parameters
    .map(
      (p) => `    {
        auto* label = labels.add (new juce::Label ({}, "${p.name}"));
        label->setJustificationType (juce::Justification::centred);
        label->setColour (juce::Label::textColourId, juce::Colour::fromString ("ff${textColor.replace("#", "")}"));
        addAndMakeVisible (label);

        auto* slider = sliders.add (new juce::Slider (juce::Slider::RotaryHorizontalVerticalDrag, juce::Slider::TextBoxBelow));
        slider->setColour (juce::Slider::rotarySliderFillColourId, juce::Colour::fromString ("ff${accentColor.replace("#", "")}"));
        slider->setTextValueSuffix (" ${p.unit || ""}");
        addAndMakeVisible (slider);

        attachments.add (new juce::AudioProcessorValueTreeState::SliderAttachment (processorRef.apvts, "${p.id}", *slider));
    }`
    )
    .join("\n");

  return `#include "PluginEditor.h"

${projectName}AudioProcessorEditor::${projectName}AudioProcessorEditor (${projectName}AudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
${buildSliders}

    setSize (${Math.max(360, columns * 160)}, ${Math.max(220, Math.ceil(parameters.length / columns) * 160 + 60)});
}

void ${projectName}AudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour::fromString ("ff${bgColor.replace("#", "")}"));
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
      `Parameter ids (Params struct members): ${JSON.stringify(paramIds)}\n\nJS DSP function body:\n${plugin.dspFunction}`
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
  const cppAuditFindings = coreAudit.findings.map((f) => `[${f.severity}] ${f.message}`);
  console.log(`[native-build] ${formatCppAudit(coreAudit)}`);
  if (!coreAudit.realtimeSafe && dspTranslated) {
    const rt = `Translated C++ core is NOT real-time-safe (score ${coreAudit.score}/100): ${coreAudit.findings.filter((f) => f.severity === "critical").map((f) => f.message).join("; ")}`;
    warning = warning ? `${warning} ${rt}` : rt;
  }

  fs.writeFileSync(path.join(projectDir, "CMakeLists.txt"), generateCMakeLists(projectName, pluginCode));
  fs.writeFileSync(path.join(projectDir, "Source", "Parameters.h"), generateParametersHeader(plugin.parameters));
  fs.writeFileSync(path.join(projectDir, "Source", "dsp", "ProcessorCore.h"), generateProcessorCoreHeader(translation));
  fs.writeFileSync(
    path.join(projectDir, "Source", "dsp", "REALTIME_AUDIT.txt"),
    `${formatCppAudit(coreAudit)}\n\n${cppAuditFindings.length ? cppAuditFindings.join("\n") : "No heap allocation, locks, IO, or logging found in the audio path."}\n`
  );
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.h"), generatePluginProcessorHeader(projectName));
  fs.writeFileSync(path.join(projectDir, "Source", "PluginProcessor.cpp"), generatePluginProcessorCpp(projectName, plugin.parameters));
  fs.writeFileSync(path.join(projectDir, "Source", "PluginEditor.h"), generatePluginEditorHeader(projectName));
  fs.writeFileSync(
    path.join(projectDir, "Source", "PluginEditor.cpp"),
    generatePluginEditorCpp(projectName, plugin.parameters, plugin.customSkin)
  );
  // Manifest lets the compile-repair loop (and any later tooling) know the
  // parameter ids and project identity without re-parsing generated C++.
  fs.writeFileSync(
    path.join(projectDir, "build-manifest.json"),
    JSON.stringify({ projectName, slug, paramIds, dspTranslated }, null, 2)
  );

  return { projectDir, slug, projectName, dspTranslated, warning, cppRealtimeScore: coreAudit.score, cppAuditFindings };
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
    `Compiler errors:\n${errors.join("\n")}\n\nCurrent ProcessorCore.h:\n${current}`
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
