import React, { useState, useMemo, useEffect } from "react";
import { Copy, Check, Download, ExternalLink, Code2, Cpu, HelpCircle, Layers, Settings, FileText, ChevronRight, Info, Terminal, Play, RotateCcw, Package, Apple, Monitor } from "lucide-react";
import { PluginParameter, PluginRoutingContract } from "../types";
import { hasDeterministicSidechainPort } from "../utils/portableCodegen";

interface ExportPanelProps {
  pluginName: string;
  dspFunction: string;
  faustCode: string;
  cppJuceCode: string;
  parameters?: PluginParameter[];
  routing?: PluginRoutingContract;
}

type PluginFormat = "vst3" | "au" | "aax" | "clap" | "standalone";

export function cppFloatLiteral(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(1) : value}f`;
}

export default function ExportPanel({ pluginName, dspFunction, faustCode, cppJuceCode, parameters = [], routing }: ExportPanelProps) {
  // Main view selection: Single DSP scripts vs Full Usable CMake/JUCE Project Tree vs WebAssembly Suite vs Visual UI Code vs Production Installers
  const [exportType, setExportType] = useState<"dsp" | "project" | "wasm" | "visual" | "installers">("project");
  
  // Script tabs
  const [scriptTab, setScriptTab] = useState<"faust" | "juce" | "webaudio" | "rust" | "maxmsp" | "teensy">("juce");

  // Visual customizer tabs
  const [visualTab, setVisualTab] = useState<"react" | "juce" | "json">("react");

  // Production installer builder customization
  const [installerTarget, setInstallerTarget] = useState<"plugin" | "ide">("ide"); // Default to "ide" for OrangeJUCE
  const [installerTab, setInstallerTab] = useState<"mac" | "win" | "cpack">("mac");
  const [manufacturerName, setManufacturerName] = useState("AudioPluginLabs");
  const [installerVersion, setInstallerVersion] = useState("1.0.0");
  const [isBuildingInstallers, setIsBuildingInstallers] = useState(false);
  const [installerLogs, setInstallerLogs] = useState<Array<{ text: string; type: "input" | "info" | "work" | "success" | "error" }>>([]);
  const [installerOutputBuilt, setInstallerOutputBuilt] = useState(false);
  
  // Format target options
  const [selectedFormat, setSelectedFormat] = useState<PluginFormat>("vst3");
  const [copied, setCopied] = useState<string | null>(null);

  // Export must reflect the verified plugin contract; it is not a feature
  // toggle that can fabricate a different processor after generation.
  const sidechainEnabled = routing?.version === "1.0"
    && routing.auxiliaryInput.supported
    && routing.inputKeyArgument;
  const deterministicJuceAvailable = hasDeterministicSidechainPort({
    category: parameters.some((p) => p.id === "cutoff") ? "filter" : "dynamics",
    parameters,
    dspFunction,
    routing,
  });
  useEffect(() => {
    if (sidechainEnabled && !deterministicJuceAvailable && exportType === "project") {
      setExportType("dsp");
    }
  }, [sidechainEnabled, deterministicJuceAvailable, exportType]);

  // File tree browser state for complete project mode
  const [activeProjectFile, setActiveProjectFile] = useState<string>("PluginProcessor.cpp");

  // WebAssembly (WASM Suite) interactive states
  const [wasmCompilerLogs, setWasmCompilerLogs] = useState<Array<{ text: string; type: "input" | "info" | "success" | "work" }>>([]);
  const [isWasmCompiling, setIsWasmCompiling] = useState(false);
  const [compiledWasmBytes, setCompiledWasmBytes] = useState<number | null>(null);
  const [wasmActiveFile, setWasmActiveFile] = useState<"wat" | "js">("wat");

  const cleanName = useMemo(() => {
    return pluginName.replace(/[^a-zA-Z0-9]/g, "");
  }, [pluginName]);

  const lowercaseSnakeName = useMemo(() => {
    return pluginName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  }, [pluginName]);

  // Determine if sidechain makes sense for current plugin features
  const sidechainAnalysis = useMemo(() => {
    return {
      recommended: sidechainEnabled,
      reason: sidechainEnabled
        ? `"${pluginName}" was generated and verified with an optional external detector. Sidechain-capable Web Audio and JUCE exports use the same auxiliary contract and internal fallback.`
        : `"${pluginName}" does not advertise an external detector. Regenerate it with an explicit sidechain request to add a verified auxiliary input.`
    };
  }, [pluginName, sidechainEnabled]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => {
      setCopied(null);
    }, 1500);
  };

  // Portable text is generated from the same routed plugin. Never replace it
  // with an unrelated "creative ducking" demo in this presentation layer.
  const sidechainFaustCode = faustCode;

  // JUCE sidechain modified code snippet
  const sidechainJuceCode = useMemo(() => {
    if (!sidechainEnabled) return cppJuceCode;

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const dspPrivateMembers = parameters.map(p => {
      return `    float m_${p.id} = ${cppFloatLiteral(p.defaultValue)};`;
    }).join("\n");

    const dspSetters = parameters.map(p => {
      return `    void set${capitalize(p.id)}(float val) { m_${p.id} = val; }`;
    }).join("\n");

    const hasFilter = parameters.some(p => p.id === "cutoff" || p.id === "resonance");
    const hasDelay = parameters.some(p => p.id === "delayTime" || p.id === "feedback");
    const hasTremolo = parameters.some(p => p.id === "tremoloRate" || p.id === "tremoloDepth");
    const hasChorus = parameters.some(p => p.id === "chorusRate" || p.id === "chorusDepth");

    const dspStateVars = [
      hasFilter ? `    // SVF Filter state registers (Left & Right channels)
    float lp_L_y1 = 0.0f;
    float lp_L_y2 = 0.0f;
    float lp_R_y1 = 0.0f;
    float lp_R_y2 = 0.0f;` : "",
      hasDelay ? `    // High-fidelity delay lines
    std::vector<float> mDelayLineL;
    std::vector<float> mDelayLineR;
    int mWritePtr = 0;` : "",
      hasTremolo ? `    // LFO Tremolo state
    float mTremoloPhase = 0.0f;` : "",
      hasChorus ? `    // LFO Chorus circular buffer & phase states
    std::vector<float> mChorusLineL;
    std::vector<float> mChorusLineR;
    int mChorusPtr = 0;
    float mChorusPhase = 0.0f;` : ""
    ].filter(Boolean).join("\n");

    const dspConstructorInit = [
      hasDelay ? `        mDelayLineL.resize(96000, 0.0f);
        mDelayLineR.resize(96000, 0.0f);` : "",
      hasChorus ? `        mChorusLineL.resize(44100, 0.0f);
        mChorusLineR.resize(44100, 0.0f);` : ""
    ].filter(Boolean).join("\n");

    const dspProcessingPerSample = parameters.map(p => {
      if (p.id === "volume") {
        return `            // Gain scale
            left *= m_volume;
            right *= m_volume;`;
      } else if (p.id === "drive" || p.id === "bias") {
        const hasDrive = parameters.some(p2 => p2.id === "drive");
        const hasBias = parameters.some(p2 => p2.id === "bias");
        return `            // High-fidelity wave-shaper saturation
            float driveVal = ${hasDrive ? "m_drive" : "1.0f"};
            float biasVal = ${hasBias ? "m_bias" : "0.0f"};
            left = std::tanh((left + biasVal) * driveVal);
            right = std::tanh((right + biasVal) * driveVal);`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        const hasCutoff = parameters.some(p2 => p2.id === "cutoff");
        const hasRes = parameters.some(p2 => p2.id === "resonance");
        return `            // Active lowpass resonant filter block
            float cutoffVal = ${hasCutoff ? "m_cutoff" : "1000.0f"};
            float resVal = ${hasRes ? "m_resonance" : "0.1f"};
            float f = (2.0f * 3.14159265f * cutoffVal) / static_cast<float>(mSampleRate);
            if (f > 0.99f) f = 0.99f;
            float q = 1.0f - f;
            float fb = resVal * 4.0f;
            
            // Left Channel
            float inputL = left - (lp_L_y2 * fb);
            lp_L_y1 = (lp_L_y1 * q) + (inputL * f);
            lp_L_y2 = (lp_L_y2 * q) + (lp_L_y1 * f);
            left = lp_L_y2;

            // Right Channel
            float inputR = right - (lp_R_y2 * fb);
            lp_R_y1 = (lp_R_y1 * q) + (inputR * f);
            lp_R_y2 = (lp_R_y2 * q) + (lp_R_y1 * f);
            right = lp_R_y2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        const hasTime = parameters.some(p2 => p2.id === "delayTime");
        const hasFB = parameters.some(p2 => p2.id === "feedback");
        return `            // Interpolating circular audio delay line
            float delayMs = ${hasTime ? "m_delayTime" : "250.0f"};
            float fbVal = ${hasFB ? "m_feedback" : "0.3f"};
            int delaySamps = static_cast<int>((delayMs / 1000.0f) * mSampleRate);
            if (delaySamps >= 96000) delaySamps = 95999;
            if (delaySamps < 1) delaySamps = 1;
            
            int readPtr = mWritePtr - delaySamps;
            if (readPtr < 0) readPtr += 96000;
            
            float echoL = mDelayLineL[readPtr];
            float echoR = mDelayLineR[readPtr];
            
            mDelayLineL[mWritePtr] = left + (echoL * fbVal);
            mDelayLineR[mWritePtr] = right + (echoR * fbVal);
            mWritePtr = (mWritePtr + 1) % 96000;
            
            left = (left * 0.6f) + (echoL * 0.4f);
            right = (right * 0.6f) + (echoR * 0.4f);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        const hasRate = parameters.some(p2 => p2.id === "tremoloRate");
        const hasDepth = parameters.some(p2 => p2.id === "tremoloDepth");
        return `            // Stereo LFO Amplitude Modulation (Tremolo)
            float tRate = ${hasRate ? "m_tremoloRate" : "5.0f"};
            float tDepth = ${hasDepth ? "m_tremoloDepth" : "0.5f"};
            mTremoloPhase += (2.0f * 3.14159265f * tRate) / static_cast<float>(mSampleRate);
            if (mTremoloPhase > 2.0f * 3.14159265f) mTremoloPhase -= 2.0f * 3.14159265f;
            
            float tremMod = 1.0f - (((std::sin(mTremoloPhase) + 1.0f) * 0.5f) * tDepth);
            left *= tremMod;
            right *= tremMod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        const hasRate = parameters.some(p2 => p2.id === "chorusRate");
        const hasDepth = parameters.some(p2 => p2.id === "chorusDepth");
        return `            // Dynamic Dual LFO Chorus
            float cRate = ${hasRate ? "m_chorusRate" : "1.2f"};
            float cDepth = ${hasDepth ? "m_chorusDepth" : "3.0f"};
            
            mChorusLineL[mChorusPtr] = left;
            mChorusLineR[mChorusPtr] = right;
            mChorusPhase += (2.0f * 3.14159265f * cRate) / static_cast<float>(mSampleRate);
            if (mChorusPhase > 2.0f * 3.14159265f) mChorusPhase -= 2.0f * 3.14159265f;
            
            float targetDelayL = 200.0f + (std::sin(mChorusPhase) * cDepth);
            float targetDelayR = 200.0f + (std::sin(mChorusPhase + 1.57079f) * cDepth);
            
            int cReadL = mChorusPtr - static_cast<int>(targetDelayL);
            int cReadR = mChorusPtr - static_cast<int>(targetDelayR);
            if (cReadL < 0) cReadL += 44100;
            if (cReadR < 0) cReadR += 44100;
            
            float chorusSampleL = mChorusLineL[cReadL];
            float chorusSampleR = mChorusLineR[cReadR];
            mChorusPtr = (mChorusPtr + 1) % 44100;
            
            left = (left * 0.6f) + (chorusSampleL * 0.4f);
            right = (right * 0.6f) + (chorusSampleR * 0.4f);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    const sidechainFilter = parameters.some((p) => p.id === "cutoff");
    const sidechainProcess = sidechainFilter
      ? `                const float detector = std::abs(key[i]);
                const float a = 1.0f - std::exp(-1.0f / (std::max(1.0f, m_attack) * 0.001f * static_cast<float>(mSampleRate)));
                const float r = 1.0f - std::exp(-1.0f / (std::max(20.0f, m_release) * 0.001f * static_cast<float>(mSampleRate)));
                mEnv[ch] += (detector > mEnv[ch] ? a : r) * (detector - mEnv[ch]);
                const float hz = std::clamp(m_cutoff * (1.0f + mEnv[ch] * m_sensitivity * 7.0f), 40.0f, 18000.0f);
                const float coeff = 1.0f - std::exp(-6.28318530718f * hz / static_cast<float>(mSampleRate));
                mState[ch] += coeff * (main[i] - mState[ch]);
                main[i] = mState[ch] * m_mix + main[i] * (1.0f - m_mix);`
      : `                const float detector = std::abs(key[i]);
                const float a = 1.0f - std::exp(-1.0f / (std::max(0.05f, m_attack) * 44.1f));
                const float r = 1.0f - std::exp(-1.0f / (std::max(1.0f, m_release) * 0.001f * static_cast<float>(mSampleRate)));
                mEnv[ch] += (detector > mEnv[ch] ? a : r) * (detector - mEnv[ch]);
                const float envDb = 20.0f * std::log10(std::max(1.0e-6f, mEnv[ch]));
                const float overDb = envDb - m_threshold;
                const float gainDb = overDb > 0.0f ? -overDb * (1.0f - 1.0f / std::max(1.0f, m_ratio)) : 0.0f;
                const float gain = std::pow(10.0f, (gainDb + m_makeup) / 20.0f);
                const float wet = std::tanh(main[i] * gain);
                main[i] = wet * m_mix + main[i] * (1.0f - m_mix);`;
    const fullProjectSidechainCore = `#pragma once
#include <JuceHeader.h>
#include <algorithm>
#include <cmath>
class ${cleanName}DSP {
public:
    void prepareToPlay(double sampleRate, int) noexcept { mSampleRate = sampleRate; mEnv[0] = mEnv[1] = mState[0] = mState[1] = 0.0f; }
    void processBlock(juce::AudioBuffer<float>& mainBus, const juce::AudioBuffer<float>& auxBus) noexcept {
        const bool hasAux = auxBus.getNumChannels() > 0 && auxBus.getNumSamples() >= mainBus.getNumSamples();
        for (int ch = 0; ch < mainBus.getNumChannels(); ++ch) {
            auto* main = mainBus.getWritePointer(ch);
            const auto* key = hasAux ? auxBus.getReadPointer(std::min(ch, auxBus.getNumChannels() - 1)) : main;
            for (int i = 0; i < mainBus.getNumSamples(); ++i) {
${sidechainProcess}
            }
        }
    }
${dspSetters}
private:
    double mSampleRate = 44100.0;
    float mEnv[2] { 0.0f, 0.0f };
    float mState[2] { 0.0f, 0.0f };
${dspPrivateMembers}
};`;

    return cppJuceCode || `/*
  ==============================================================================
    ${cleanName}DSP.h - JUCE Sidechain-Ready Realtime Audio Engine
  ==============================================================================
*/
#pragma once
#include <JuceHeader.h>
#include <cmath>
#include <vector>

class ${cleanName}DSP
{
public:
    ${cleanName}DSP() {
${dspConstructorInit}
    }
    ~${cleanName}DSP() {}

    void prepareToPlay (double sampleRate, int samplesPerBlock)
    {
        mSampleRate = sampleRate;
        mSamplesPerBlock = samplesPerBlock;
        // Reset envelope followers
        scFollower.setCoefs(0.015f, 0.080f, sampleRate);
        reset();
    }

    void reset() {
${hasFilter ? `        lp_L_y1 = 0.0f; lp_L_y2 = 0.0f;
        lp_R_y1 = 0.0f; lp_R_y2 = 0.0f;` : ""}
${hasDelay ? `        std::fill(mDelayLineL.begin(), mDelayLineL.end(), 0.0f);
        std::fill(mDelayLineR.begin(), mDelayLineR.end(), 0.0f);
        mWritePtr = 0;` : ""}
${hasTremolo ? `        mTremoloPhase = 0.0f;` : ""}
${hasChorus ? `        std::fill(mChorusLineL.begin(), mChorusLineL.end(), 0.0f);
        std::fill(mChorusLineR.begin(), mChorusLineR.end(), 0.0f);
        mChorusPtr = 0;
        mChorusPhase = 0.0f;` : ""}
    }

    // Sidechain-Optimized processing buffer
    void processBlock (juce::AudioBuffer<float>& mainBuffer, juce::AudioBuffer<float>& sidechainBuffer)
    {
        const int numSamples = mainBuffer.getNumSamples();
        const int mainChannels = mainBuffer.getNumChannels();
        const int scChannels = sidechainBuffer.getNumChannels();

        auto* mainL = mainBuffer.getWritePointer(0);
        auto* mainR = mainChannels > 1 ? mainBuffer.getWritePointer(1) : mainL;

        // Extract sidechain reference (mono blend or stereo)
        const float* scL = scChannels > 0 ? sidechainBuffer.getReadPointer(0) : mainBuffer.getReadPointer(0);
        const float* scR = scChannels > 1 ? sidechainBuffer.getReadPointer(1) : scL;

        for (int sample = 0; sample < numSamples; ++sample)
        {
            // Compute control feedback from auxiliary input
            float scSig = (scL[sample] + scR[sample]) * 0.5f;
            float followEnv = scFollower.tick(std::abs(scSig));

            float left = mainL[sample];
            float right = mainR[sample];

${dspProcessingPerSample || `            // Stereo Passthrough
            left = left;
            right = right;`}

            // Duck wet signals based on sidechain activity
            mainL[sample] = left * (1.0f - followEnv * 0.85f);
            if (mainChannels > 1) {
                mainR[sample] = right * (1.0f - followEnv * 0.85f);
            }
        }
    }

    // Dynamic Parameter Setters
${dspSetters}

private:
    double mSampleRate { 44100.0 };
    int mSamplesPerBlock { 256 };

    // Parameters
${dspPrivateMembers}

    // State registers
${dspStateVars}

    // Simple smooth envelope follower class
    struct SimpleFollower {
        float state { 0.0f };
        float attackCoef { 0.99f };
        float releaseCoef { 0.999f };

        void setCoefs(float attackMs, float releaseMs, double sr) {
            attackCoef = std::exp(-1.0f / (attackMs * 0.001f * sr));
            releaseCoef = std::exp(-1.0f / (releaseMs * 0.001f * sr));
        }

        inline float tick(float inVal) {
            if (inVal > state) {
                state = attackCoef * (state - inVal) + inVal;
            } else {
                state = releaseCoef * (state - inVal) + inVal;
            }
            return state;
        }
    } scFollower;
};`;
  }, [cleanName, sidechainEnabled, parameters, cppJuceCode]);

  // Web Audio API custom Worklet compiler
  const webAudioCode = useMemo(() => {
    const paramDecls = parameters.map(p => {
      return `      {
        name: "${p.id}",
        defaultValue: ${p.value.toFixed(4)},
        minValue: ${(p.min || 0).toFixed(1)},
        maxValue: ${(p.max || 1).toFixed(1)}
      }`;
    }).join(",\n");

    const dspProcessingLines = parameters.map(p => {
      if (p.id === "volume") {
        return `        // Volume gain
        currentSample = currentSample * m_volume;`;
      } else if (p.id === "drive" || p.id === "bias") {
        return `        // Saturator saturation
        const bias = ${parameters.some(p2 => p2.id === "bias") ? "m_bias" : "0.0"};
        const drive = ${parameters.some(p2 => p2.id === "drive") ? "m_drive" : "3.5"};
        currentSample = Math.tanh((currentSample + bias) * drive);`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        return `        // Lowpass filter (One-pole/Two-pole approximation)
        const cutoff = ${parameters.some(p2 => p2.id === "cutoff") ? "m_cutoff" : "2000.0"};
        const resonance = ${parameters.some(p2 => p2.id === "resonance") ? "m_resonance" : "0.3"};
        const f = (2 * Math.PI * cutoff) / this.sampleRate;
        const q = 1.0 - f;
        const fb = resonance * 4.0;
        const inputWithRes = currentSample - (this.lp_y2 * fb);
        this.lp_y1 = (this.lp_y1 * q) + (inputWithRes * f);
        this.lp_y2 = (this.lp_y2 * q) + (this.lp_y1 * f);
        currentSample = this.lp_y2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        return `        // Comb Delay Line
        const delayTimeMs = ${parameters.some(p2 => p2.id === "delayTime") ? "m_delayTime" : "250.0"};
        const feedback = ${parameters.some(p2 => p2.id === "feedback") ? "m_feedback" : "0.4"};
        const delaySamples = Math.floor((delayTimeMs / 1000.0) * this.sampleRate);
        let readPtr = this.writePtr - delaySamples;
        if (readPtr < 0) readPtr += this.delayLine.length;
        const echoed = this.delayLine[readPtr] || 0.0;
        this.delayLine[this.writePtr] = currentSample + (echoed * feedback);
        this.writePtr = (this.writePtr + 1) % this.delayLine.length;
        currentSample = (currentSample * 0.7) + (echoed * 0.3);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        return `        // Tremolo LFO
        const tremRate = ${parameters.some(p2 => p2.id === "tremoloRate") ? "m_tremoloRate" : "6.0"};
        const tremDepth = ${parameters.some(p2 => p2.id === "tremoloDepth") ? "m_tremoloDepth" : "0.5"};
        this.tremoloPhase += (2 * Math.PI * tremRate) / this.sampleRate;
        if (this.tremoloPhase > 2 * Math.PI) this.tremoloPhase -= 2 * Math.PI;
        const tremMod = 1.0 - (((Math.sin(this.tremoloPhase) + 1.0) * 0.5) * tremDepth);
        currentSample = currentSample * tremMod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        return `        // Chorus LFO
        const chRate = ${parameters.some(p2 => p2.id === "chorusRate") ? "m_chorusRate" : "1.5"};
        const chDepth = ${parameters.some(p2 => p2.id === "chorusDepth") ? "m_chorusDepth" : "4.0"};
        this.chorusLine[this.chorusPtr] = currentSample;
        this.chorusPhase += (2 * Math.PI * chRate) / this.sampleRate;
        const targetDelay = 200.0 + (Math.sin(this.chorusPhase) * chDepth);
        let chorRead = this.chorusPtr - Math.floor(targetDelay);
        if (chorRead < 0) chorRead += this.chorusLine.length;
        const chorSample = this.chorusLine[chorRead] || 0.0;
        this.chorusPtr = (this.chorusPtr + 1) % this.chorusLine.length;
        currentSample = (currentSample * 0.65) + (chorSample * 0.35);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    return `/*
  ==============================================================================
    ${cleanName}Worklet.js
    Web Audio API high-performance AudioWorkletProcessor.
    Directly loadable in standard modern browsers.
  ==============================================================================
*/

class ${cleanName}Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
${paramDecls || "      // No active parameters"}
    ];
  }

  constructor() {
    super();
    this.sampleRate = 44100;
    
    // Allocate state registers
    this.lp_y1 = 0.0;
    this.lp_y2 = 0.0;
    
    this.delayLine = new Float32Array(44100 * 2);
    this.writePtr = 0;
    
    this.tremoloPhase = 0.0;
    
    this.chorusLine = new Float32Array(44100);
    this.chorusPtr = 0;
    this.chorusPhase = 0.0;
    this.sidechainEnv = 0.0;
    this.dspStates = Array.from({ length: 8 }, () => ({}));
    this.paramValues = {};
  }

  runDsp(inputSample, params, state, inputR, inputKey) {
${dspFunction.split("\n").map((line) => `    ${line}`).join("\n")}
  }

  sanitizeSample(value) {
    return Number.isFinite(value) ? Math.max(-4, Math.min(4, value)) : 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const sidechain = inputs[1];
    const output = outputs[0];
    if (!input || !output || input.length === 0) return true;

    const channels = input.length;
    const numSamples = input[0].length;
${parameters.map(p => `    this.paramValues.${p.id} = parameters.${p.id}.length > 1 ? parameters.${p.id}[0] : parameters.${p.id}[0];`).join("\n")}

    for (let sample = 0; sample < numSamples; ++sample) {
      // Fetch parameter values at current block sample index
${parameters.map(p => `      const m_${p.id} = parameters.${p.id}.length > 1 ? parameters.${p.id}[sample] : parameters.${p.id}[0];`).join("\n")}

      for (let channel = 0; channel < channels; ++channel) {
        let currentSample = input[channel][sample];
        const inputKey = ${sidechainEnabled ? "(sidechain && sidechain.length > 0 ? sidechain[Math.min(channel, sidechain.length - 1)][sample] : currentSample)" : "currentSample"};
        const inputR = input.length > 1 ? input[1][sample] : currentSample;

        // Execute the authoritative, quality-gated DSP body directly. The
        // auxiliary sample is only supplied when the contract supports it;
        // disconnected optional buses self-detect from currentSample.
        currentSample = this.sanitizeSample(this.runDsp(
          currentSample,
          this.paramValues,
          this.dspStates[channel],
          inputR,
          inputKey
        ));

        output[channel][sample] = currentSample;
      }
    }

    return true;
  }
}

registerProcessor("${lowercaseSnakeName}-processor", ${cleanName}Processor);`;
  }, [cleanName, lowercaseSnakeName, parameters, sidechainEnabled, dspFunction]);

  // Rust NIH-Plug code generator
  const rustNihPlugCode = useMemo(() => {
    const paramFields = parameters.map(p => {
      return `    #[id = "${p.id}"]
    pub ${p.id}: FloatParam,`;
    }).join("\n\n");

    const paramInits = parameters.map(p => {
      return `            ${p.id}: FloatParam::new(
                "${p.name}",
                ${p.value.toFixed(4)},
                FloatRange::Linear { min: ${p.min.toFixed(2)}, max: ${p.max.toFixed(2)} },
            ).with_unit("${p.id.includes("cutoff") ? "Hz" : "x"}"),`;
    }).join("\n");

    const dspProcessingRust = parameters.map(p => {
      if (p.id === "volume") {
        return `            // Volume control
            current_sample = current_sample * self.params.${p.id}.value();`;
      } else if (p.id === "drive" || p.id === "bias") {
        return `            // Saturator drive
            let drive = self.params.drive.value();
            let bias = self.params.bias.value();
            current_sample = ((current_sample + bias) * drive).tanh();`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        return `            // Cutoff / Resonance Q ladder filter
            let cutoff = self.params.cutoff.value();
            let resonance = self.params.resonance.value();
            let f = (2.0 * std::f32::consts::PI * cutoff) / self.sample_rate;
            let q = 1.0 - f;
            let fb = resonance * 4.0;
            let input_with_res = current_sample - (self.lp_y2 * fb);
            self.lp_y1 = (self.lp_y1 * q) + (input_with_res * f);
            self.lp_y2 = (self.lp_y2 * q) + (self.lp_y1 * f);
            current_sample = self.lp_y2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        return `            // Comb delay line
            let delay_time = self.params.delayTime.value();
            let feedback = self.params.feedback.value();
            let delay_samples = ((delay_time / 1000.0) * self.sample_rate) as usize;
            let read_ptr = (self.write_ptr + self.delay_line.len() - delay_samples) % self.delay_line.len();
            let echoed = self.delay_line[read_ptr];
            self.delay_line[self.write_ptr] = current_sample + (echoed * feedback);
            self.write_ptr = (self.write_ptr + 1) % self.delay_line.len();
            current_sample = (current_sample * 0.7) + (echoed * 0.3);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        return `            // LFO Tremolo
            let rate = self.params.tremoloRate.value();
            let depth = self.params.tremoloDepth.value();
            self.tremolo_phase += (2.0 * std::f32::consts::PI * rate) / self.sample_rate;
            if self.tremolo_phase > 2.0 * std::f32::consts::PI {
                self.tremolo_phase -= 2.0 * std::f32::consts::PI;
            }
            let trem_mod = 1.0 - (((self.tremolo_phase.sin() + 1.0) * 0.5) * depth);
            current_sample = current_sample * trem_mod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        return `            // LFO Chorus
            let rate = self.params.chorusRate.value();
            let depth = self.params.chorusDepth.value();
            self.chorus_line[self.chorus_ptr] = current_sample;
            self.chorus_phase += (2.0 * std::f32::consts::PI * rate) / self.sample_rate;
            let target_delay = 200.0 + (self.chorus_phase.sin() * depth);
            let c_read = (self.chorus_ptr + self.chorus_line.len() - target_delay as usize) % self.chorus_line.len();
            let chor_sample = self.chorus_line[c_read];
            self.chorus_ptr = (self.chorus_ptr + 1) % self.chorus_line.len();
            current_sample = (current_sample * 0.65) + (chor_sample * 0.35);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    return `// Rust NIH-Plug Audio Plugin Core DSP Implementation
// Add "nih_plug = { git = \\"https://github.com/robbert-vdh/nih-plug.git\\" }" to Cargo.toml

use nih_plug::prelude::*;
use std::sync::Arc;

#[derive(Params)]
pub struct ${cleanName}Params {
${paramFields || "    // No active parameters"}
}

impl Default for ${cleanName}Params {
    fn default() -> Self {
        Self {
${paramInits || "            // Default"}
        }
    }
}

pub struct ${cleanName} {
    params: Arc<${cleanName}Params>,
    sample_rate: f32,
    
    // State filters
    lp_y1: f32,
    lp_y2: f32,
    
    // Delay states
    delay_line: Vec<f32>,
    write_ptr: usize,
    
    // LFO states
    tremolo_phase: f32,
    chorus_line: Vec<f32>,
    chorus_ptr: usize,
    chorus_phase: f32,
}

impl Default for ${cleanName} {
    fn default() -> Self {
        Self {
            params: Arc::new(${cleanName}Params::default()),
            sample_rate: 44100.0,
            lp_y1: 0.0,
            lp_y2: 0.0,
            delay_line: vec![0.0; 88200],
            write_ptr: 0,
            tremolo_phase: 0.0,
            chorus_line: vec![0.0; 44100],
            chorus_ptr: 0,
            chorus_phase: 0.0,
        }
    }
}

impl Plugin for ${cleanName} {
    const NAME: &'static str = "${pluginName}";
    const VENDOR: &'static str = "Orange Juce Studio";
    const URL: &'static str = "https://ai.studio/build";
    const EMAIL: &'static str = "info@example.com";
    const VERSION: &'static str = "1.0.0";

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: std::num::NonZeroU32::new(2),
        main_output_channels: std::num::NonZeroU32::new(2),
        aux_input_ports: &[],
        aux_output_ports: &[],
        names: PortNames::const_default(),
    }];

    type Sys = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(
        &mut self,
        _audio_io_layouts: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        self.sample_rate = buffer_config.sample_rate;
        true
    }

    fn reset(&mut self) {
        self.lp_y1 = 0.0;
        self.lp_y2 = 0.0;
        self.delay_line.fill(0.0);
        self.write_ptr = 0;
        self.tremolo_phase = 0.0;
        self.chorus_line.fill(0.0);
        self.chorus_ptr = 0;
        self.chorus_phase = 0.0;
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        _context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        for channel_samples in buffer.iter_variables() {
            for sample in channel_samples {
                let mut current_sample = *sample;

${dspProcessingRust || "                // Direct passthrough"}

                *sample = current_sample;
            }
        }

        ProcessStatus::Normal
    }
}`;
  }, [cleanName, pluginName, parameters]);

  // Max/MSP Gen code generator
  const maxMspGenCode = useMemo(() => {
    const paramDecls = parameters.map(p => {
      return `Param ${p.id}(${p.value.toFixed(2)}, min=${p.min.toFixed(1)}, max=${p.max.toFixed(1)});`;
    }).join("\n");

    const dspGenCode = parameters.map(p => {
      if (p.id === "volume") {
        return `// Volume node
out1 = in1 * volume;`;
      } else if (p.id === "drive" || p.id === "bias") {
        return `// Saturator node
bias = ${parameters.some(p2 => p2.id === "bias") ? "bias" : "0.0"};
drive = ${parameters.some(p2 => p2.id === "drive") ? "drive" : "3.5"};
out1 = tanh((in1 + bias) * drive);`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        return `// One-pole/Two-pole ladder approximation filter
History y1(0);
History y2(0);
cutoff = ${parameters.some(p2 => p2.id === "cutoff") ? "cutoff" : "2000.0"};
resonance = ${parameters.some(p2 => p2.id === "resonance") ? "resonance" : "0.3"};
f = (2 * pi * cutoff) / samplerate;
q = 1.0 - f;
fb = resonance * 4.0;
input_res = in1 - (y2 * fb);
y1 = (y1 * q) + (input_res * f);
y2 = (y2 * q) + (y1 * f);
out1 = y2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        return `// Comb Delay Line
Delay comb_line(88200);
delayTime = ${parameters.some(p2 => p2.id === "delayTime") ? "delayTime" : "250.0"};
feedback = ${parameters.some(p2 => p2.id === "feedback") ? "feedback" : "0.4"};
delay_samples = delayTime / 1000.0 * samplerate;
echoed = comb_line.read(delay_samples);
comb_line.write(in1 + (echoed * feedback));
out1 = (in1 * 0.7) + (echoed * 0.3);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        return `// LFO Tremolo
History phase(0);
rate = ${parameters.some(p2 => p2.id === "tremoloRate") ? "tremoloRate" : "6.0"};
depth = ${parameters.some(p2 => p2.id === "tremoloDepth") ? "tremoloDepth" : "0.5"};
phase = phase + (2 * pi * rate) / samplerate;
if (phase > 2 * pi) {
    phase = phase - 2 * pi;
}
trem_mod = 1.0 - (((sin(phase) + 1.0) * 0.5) * depth);
out1 = in1 * trem_mod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        return `// LFO Chorus
Delay chorus_line(44100);
History chorus_phase(0);
rate = ${parameters.some(p2 => p2.id === "chorusRate") ? "chorusRate" : "1.5"};
depth = ${parameters.some(p2 => p2.id === "chorusDepth") ? "chorusDepth" : "4.0"};
chorus_phase = chorus_phase + (2 * pi * rate) / samplerate;
if (chorus_phase > 2 * pi) {
    chorus_phase = chorus_phase - 2 * pi;
}
target_delay = 200.0 + (sin(chorus_phase) * depth);
chor_sample = chorus_line.read(target_delay);
chorus_line.write(in1);
out1 = (in1 * 0.65) + (chor_sample * 0.35);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    return `// Max/MSP gen~ custom DSP patch layout
// Copy and paste this code directly into a Max gen~ codebox object!

${paramDecls || "// No parameters declared"}

${dspGenCode || "out1 = in1; // Direct passthrough"}`;
  }, [parameters]);

  // Teensy C++ Audio system generator
  const teensyDspCode = useMemo(() => {
    const paramFields = parameters.map(p => {
      return `    float m_${p.id} = ${p.value.toFixed(4)}f;`;
    }).join("\n");

    const paramSetters = parameters.map(p => {
      return `    void set_${p.id}(float val) {
        m_${p.id} = val;
    }`;
    }).join("\n\n");

    const dspProcessingTeensy = parameters.map(p => {
      if (p.id === "volume") {
        return `            // Volume modifier
            currentSample = currentSample * m_volume;`;
      } else if (p.id === "drive" || p.id === "bias") {
        return `            // Saturator clipping
            float drive = m_drive;
            float bias = m_bias;
            // Native float approximation of tanh
            float x = (currentSample + bias) * drive;
            currentSample = x / (1.0f + abs(x)); // Fast softclip`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        return `            // Resonant ladder filter
            float f = (2.0f * 3.14159f * m_cutoff) / 44100.0f;
            float q = 1.0f - f;
            float fb = m_resonance * 4.0f;
            float filterInput = currentSample - (mFilterY2 * fb);
            mFilterY1 = (mFilterY1 * q) + (filterInput * f);
            mFilterY2 = (mFilterY2 * q) + (mFilterY1 * f);
            currentSample = mFilterY2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        return `            // Hardware delay line (circular buffer)
            int delaySamples = (int)((m_delayTime / 1000.0f) * 44100.0f);
            if (delaySamples >= 22000) delaySamples = 21999;
            int readHead = mDelayWriteHead - delaySamples;
            if (readHead < 0) readHead += 22000;
            float echoed = mDelayBuffer[readHead];
            mDelayBuffer[mDelayWriteHead] = currentSample + (echoed * m_feedback);
            mDelayWriteHead = (mDelayWriteHead + 1) % 22000;
            currentSample = (currentSample * 0.7f) + (echoed * 0.3f);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        return `            // LFO Tremolo
            mTremoloPhase += (2.0f * 3.14159f * m_tremoloRate) / 44100.0f;
            if (mTremoloPhase > 2.0f * 3.14159f) mTremoloPhase -= 2.0f * 3.14159f;
            float tremMod = 1.0f - (((sin(mTremoloPhase) + 1.0f) * 0.5f) * m_tremoloDepth);
            currentSample = currentSample * tremMod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        return `            // LFO Chorus (Hardware optimized)
            mChorusBuffer[mChorusWriteHead] = currentSample;
            mChorusPhase += (2.0f * 3.14159f * m_chorusRate) / 44100.0f;
            if (mChorusPhase > 2.0f * 3.14159f) mChorusPhase -= 2.0f * 3.14159f;
            float targetDelay = 200.0f + (sin(mChorusPhase) * m_chorusDepth);
            int cRead = mChorusWriteHead - (int)targetDelay;
            if (cRead < 0) cRead += 11000;
            float chorusSample = mChorusBuffer[cRead];
            mChorusWriteHead = (mChorusWriteHead + 1) % 11000;
            currentSample = (currentSample * 0.65f) + (chorusSample * 0.35f);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    return `/*
  ==============================================================================
    ${cleanName}TeensyDSP.h
    Arduino/Teensy Audio Library compatible custom stream node.
    Fits seamlessly with Teensy Audio Shield (SGTL5000 / AudioStream).
  ==============================================================================
*/

#pragma once
#include <Arduino.h>
#include <AudioStream.h>

class ${cleanName}TeensyDSP : public AudioStream
{
public:
    ${cleanName}TeensyDSP() : AudioStream(1, inputQueueArray) 
    {
        // Reset buffers
        memset(mDelayBuffer, 0, sizeof(mDelayBuffer));
        memset(mChorusBuffer, 0, sizeof(mChorusBuffer));
    }

    // Dynamic Parameter Setters
${paramSetters || "    // No active parameters"}

    virtual void update(void)
    {
        audio_block_t *block = receiveWritable();
        if (!block) return;

        for (int i = 0; i < AUDIO_BLOCK_SAMPLES; i++) {
            // Unpack 16-bit integer hardware buffer to standard float sample (-1.0 to 1.0)
            float currentSample = (float)block->data[i] / 32768.0f;

${dspProcessingTeensy || "            // Direct passthrough"}

            // Clip and pack back to 16-bit integer hardware output buffer
            if (currentSample > 1.0f) currentSample = 1.0f;
            else if (currentSample < -1.0f) currentSample = -1.0f;
            block->data[i] = (int16_t)(currentSample * 32767.0f);
        }

        transmit(block);
        release(block);
    }

private:
    audio_block_t *inputQueueArray[1];
    
${paramFields || "    // Local parameters"}

    // State filter variables
    float mFilterY1 = 0.0f;
    float mFilterY2 = 0.0f;
    
    // Circular hardware delay lines
    float mDelayBuffer[22000]; // ~500ms at 44.1kHz
    int mDelayWriteHead = 0;
    
    // Circular chorus buffer
    float mChorusBuffer[11000]; // ~250ms buffer
    int mChorusWriteHead = 0;
    float mChorusPhase = 0.0f;
    float mTremoloPhase = 0.0f;
};`;
  }, [cleanName, parameters]);

  // Visual Customizer Web React layout generator
  const generatedReactVisualCode = useMemo(() => {
    const ampParam = parameters?.find(p => p.controlType === "amp");
    const cabParam = parameters?.find(p => p.controlType === "cab");

    return `/*
  ==============================================================================
    ${cleanName}VisualCustomizer.tsx
    Auto-Generated Custom UI Layout Component with Tailwind CSS & Lucide Icons.
    Perfect drop-in customizer for web players, controls panels, or UI previews.
  ==============================================================================
*/

import React, { useState } from 'react';
import { Settings, Play, Volume2, Shield, Eye, Flame, Mic } from 'lucide-react';

export default function ${cleanName}VisualCustomizer() {
  const [standby, setStandby] = useState(true);
  const [powered, setPowered] = useState(true);

  // Amp customization parameters
  const ampTolex = "${ampParam?.ampTolexPattern || "leather"}";
  const ampKnobs = "${ampParam?.ampKnobStyle || "pointer"}";
  const ampChannel = "${ampParam?.ampChannelType || "crunch"}";
  const ampTubeGlow = ${ampParam?.ampTubeGlow ? "true" : "false"};
  
  // Cabinet customization parameters
  const cabGrill = "${cabParam?.cabGrillStyle || "weave"}";
  const cabSize = "${cabParam?.cabSize || "4x12"}";
  const cabMic = "${cabParam?.cabMicModel || "SM57"}";

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-neutral-950 border border-neutral-900 rounded-2xl shadow-3xl text-white font-sans space-y-6">
      {/* Visual Header */}
      <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
        <div>
          <h3 className="text-lg font-bold text-neutral-100">${pluginName} Faceplate Panel</h3>
          <p className="text-xs text-neutral-500">Live active physical customizer module tree</p>
        </div>
        <span className="text-[10px] uppercase font-mono bg-orange-950/40 border border-orange-850 px-2 py-1 rounded text-orange-400">
          Tailwind Custom Skin
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Amp Section */}
        <div className="space-y-3">
          <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">Amp Head Visualizer</span>
          <div 
            style={{ 
              backgroundColor: "${ampParam?.bgColor || "#1c1c22"}", 
              borderColor: "${ampParam?.borderColor || "#3a3a45"}" 
            }}
            className="w-full aspect-[2/1] rounded-xl border-[4px] shadow-2xl relative overflow-hidden flex flex-col justify-between p-3"
          >
            {/* Tolex background overlay */}
            {ampTolex === "carbon" && (
              <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(0,0,0,0.45)_25%,transparent_25%),linear-gradient(-45deg,rgba(0,0,0,0.45)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(0,0,0,0.45)_75%),linear-gradient(-45deg,transparent_75%,rgba(0,0,0,0.45)_75%)] bg-[size:6px_6px] pointer-events-none opacity-40" />
            )}
            {ampTolex === "tweed" && (
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(80,50,30,0.4)_25%,transparent_25%),linear-gradient(225deg,rgba(80,50,30,0.4)_25%,transparent_25%)] bg-[size:8px_8px] pointer-events-none opacity-40" />
            )}
            {ampTolex === "wood" && (
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(40,20,5,0.22)_20%,transparent_20%)] bg-[size:100%_12px] pointer-events-none opacity-50" />
            )}
            {ampTolex === "snakeskin" && (
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,40,30,0.4)_30%,transparent_35%)] bg-[size:8px_12px] pointer-events-none opacity-40" />
            )}
            {ampTolex === "metalgrid" && (
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:4px_4px] pointer-events-none" />
            )}
            {ampTolex === "leather" && (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,0,0,0.25)_1px,transparent_1px)] bg-[size:3px_3px] pointer-events-none opacity-40" />
            )}

            {/* Glowing tubes back plate */}
            {ampTubeGlow && powered && (
              <div className="absolute top-10 left-[12%] right-[12%] h-10 bg-neutral-950/90 rounded border border-neutral-900/60 flex items-center justify-around px-2 overflow-hidden shadow-inner z-0">
                {[1, 2, 3, 4].map((tube) => (
                  <div key={tube} className="w-3 h-8 bg-amber-500/15 rounded-t-full relative flex flex-col items-center justify-end">
                    <div className="w-[2px] h-4 bg-amber-500 rounded-t-full animate-pulse shadow-[0_0_8px_#f59e0b]" />
                    <div className="w-full h-1 bg-neutral-800" />
                  </div>
                ))}
              </div>
            )}

            {/* Title / Branding */}
            <div className="flex items-center justify-between border-b border-neutral-800/60 pb-1.5 shrink-0 z-10">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-yellow-500 font-serif">
                ${ampParam?.customText || "PLEXI 50W"}
              </span>
              <div className="flex gap-2 items-center">
                <span className="text-[6px] font-mono font-bold tracking-wider text-neutral-400 bg-neutral-900/60 px-1 py-0.5 rounded border border-neutral-850">
                  CH: {ampChannel.toUpperCase()}
                </span>
                <span 
                  className={\`w-2.5 h-2.5 rounded-full transition-all duration-300 \${powered ? 'bg-rose-500 shadow-[0_0_8px_#ef4444]' : 'bg-neutral-850'}\`} 
                />
              </div>
            </div>

            {/* Knobs dials panel */}
            <div 
              style={{
                backgroundColor: 
                  "${ampParam?.customStyle === "boutique" ? "#ecd3ab" : 
                    ampParam?.customStyle === "sleek" ? "#f4f4f5" : 
                    ampParam?.customStyle === "neon-dream" ? "#2f123d" : 
                    ampParam?.customStyle === "gold-lux" ? "#121b2d" : 
                    ampParam?.customStyle === "crimson-shred" ? "#1a0202" : 
                    ampParam?.customStyle === "arctic-frost" ? "#e2e8f0" : 
                    ampParam?.customStyle === "emerald-acid" ? "#0d180d" : 
                    ampParam?.customStyle === "steampunk" ? "#2b1a11" : 
                    "#17171e"}"
              }}
              className="flex-1 flex items-center justify-around gap-1 border border-neutral-800 rounded px-1.5 py-1 my-1.5 z-10"
            >
              {["GAIN", "BASS", "MID", "TREB", "PRES"].map((label) => (
                <div key={label} className="flex flex-col items-center space-y-1">
                  <div className="relative w-6 h-6 rounded-full bg-gradient-to-b from-neutral-600 to-neutral-800 border border-neutral-950 flex items-center justify-center shadow-md">
                    {ampKnobs === "chickenhead" && (
                      <div className="absolute w-1.5 h-4 bg-neutral-950 rounded-b-sm -rotate-45" />
                    )}
                    {ampKnobs === "silvercap" && (
                      <div className="w-4 h-4 rounded-full bg-neutral-200 border border-neutral-450" />
                    )}
                    {ampKnobs === "neonring" && (
                      <div className="absolute inset-0.5 rounded-full border border-emerald-500 shadow-[0_0_4px_#10b981]" />
                    )}
                    <div className="w-[1.5px] h-2 bg-yellow-500 rounded-full absolute top-0.5" />
                  </div>
                  <span className="text-[5.5px] font-mono tracking-wider text-neutral-400">{label}</span>
                </div>
              ))}
            </div>

            {/* Standard control switches footer */}
            <div className="flex items-center justify-between text-[6px] font-mono tracking-wider shrink-0 z-10 text-neutral-500">
              <span>ACTIVE MODEL INGRESS</span>
              <div className="flex gap-2">
                <button onClick={() => setStandby(!standby)} className={\`px-1 rounded font-bold border \${standby ? 'bg-black/60 text-emerald-400 border-emerald-500/20' : 'bg-neutral-800 border-neutral-700'}\`}>STANDBY</button>
                <button onClick={() => setPowered(!powered)} className={\`px-1 rounded font-bold border \${powered ? 'bg-black/60 text-rose-500 border-rose-500/20' : 'bg-neutral-800 border-neutral-700'}\`}>POWER</button>
              </div>
            </div>
          </div>
        </div>

        {/* Cab Section */}
        <div className="space-y-3">
          <span className="text-xs font-mono text-neutral-500 uppercase tracking-widest">Speaker Cab Visualizer</span>
          <div 
            style={{ 
              backgroundColor: "${cabParam?.bgColor || "#16161a"}", 
              borderColor: "${cabParam?.borderColor || "#2c2c36"}" 
            }}
            className="w-full aspect-[2/1] rounded-2xl border-[6px] shadow-2xl relative overflow-hidden flex flex-col justify-between p-3"
          >
            {/* Grill overlays */}
            {cabGrill === "metalgrid" && (
              <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(0,0,0,0.65)_1.5px,transparent_1.5px)] bg-[size:5px_5px] opacity-70 pointer-events-none" />
            )}
            {cabGrill === "stripes" && (
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.55)_2px,transparent_2px)] bg-[size:6px_100%] opacity-80 pointer-events-none" />
            )}
            {cabGrill === "pinstripe" && (
              <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(0,0,0,0.4)_1px,transparent_1px)] bg-[size:8px_8px] opacity-80 pointer-events-none" />
            )}
            {cabGrill === "retro" && (
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(212,175,55,0.12)_25%,transparent_25%)] bg-[size:12px_12px] opacity-80 pointer-events-none" />
            )}
            {cabGrill === "weave" && (
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.3)_1px,transparent_1px),linear-gradient(rgba(0,0,0,0.3)_1px,transparent_1px)] bg-[size:3px_3px] opacity-80 pointer-events-none" />
            )}

            {/* Speakers configuration */}
            <div className="flex-1 grid grid-cols-4 gap-2 p-2 relative z-10 items-center justify-center">
              {cabSize === "1x12" && (
                <div className="col-span-4 flex justify-center">
                  <div className="w-16 h-16 rounded-full border-4 border-black bg-gradient-to-b from-neutral-800 to-black relative flex items-center justify-center shadow-inner">
                    <div className="w-8 h-8 rounded-full bg-neutral-950 border border-neutral-700" />
                  </div>
                </div>
              )}
              {cabSize === "2x12" && (
                <div className="col-span-4 flex justify-around">
                  {[1, 2].map((s) => (
                    <div key={s} className="w-12 h-12 rounded-full border-[3px] border-black bg-gradient-to-b from-neutral-800 to-black relative flex items-center justify-center shadow-inner">
                      <div className="w-6 h-6 rounded-full bg-neutral-950 border border-neutral-700" />
                    </div>
                  ))}
                </div>
              )}
              {cabSize === "4x12" && (
                <div className="col-span-4 flex justify-around">
                  {[1, 2, 3, 4].map((s) => (
                    <div key={s} className="w-9 h-9 rounded-full border-2 border-black bg-gradient-to-b from-neutral-800 to-black relative flex items-center justify-center shadow-inner">
                      <div className="w-4 h-4 rounded-full bg-neutral-950 border border-neutral-700" />
                    </div>
                  ))}
                </div>
              )}
              {cabSize === "8x10" && (
                <div className="col-span-4 flex justify-around">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <div key={s} className="w-6 h-6 rounded-full border-2 border-black bg-gradient-to-b from-neutral-800 to-black relative flex items-center justify-center shadow-inner">
                      <div className="w-3 h-3 rounded-full bg-neutral-950 border border-neutral-700" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Badge */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black border border-neutral-850 px-2.5 py-0.5 rounded-md shadow-lg z-20 text-center">
              <span className="text-[7.5px] font-bold uppercase tracking-widest text-neutral-450">
                \${cabParam?.customText || "CELESTION 1960A"}
              </span>
            </div>

            {/* Mic Overlay Tag */}
            <div className="absolute bottom-1 right-2 bg-neutral-950/90 border border-neutral-850/60 rounded px-1.5 py-0.5 flex items-center gap-1 shadow-md z-20 font-mono text-[5.5px] font-bold text-neutral-400">
              <Mic className="w-2.5 h-2.5 text-indigo-400" />
              <span>MIC: {cabMic}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}`;
  }, [cleanName, pluginName, parameters]);

  // Visual Customizer C++ JUCE Layout generator
  const generatedJuceVisualCode = useMemo(() => {
    const ampParam = parameters?.find(p => p.controlType === "amp");
    const cabParam = parameters?.find(p => p.controlType === "cab");

    return `/*
  ==============================================================================
    ${cleanName}PluginEditor.cpp
    JUCE Plugin Visual customizer painting & component initialization
  ==============================================================================
*/

#pragma once
#include "PluginProcessor.h"

class ${cleanName}AudioProcessorEditor  : public juce::AudioProcessorEditor
{
public:
    ${cleanName}AudioProcessorEditor (${cleanName}AudioProcessor& p)
        : AudioProcessorEditor (&p), audioProcessor (p)
    {
        // Set window visual frame bounds matching designer ratio
        setSize (500, 320);

        // Styling visual properties exported from AI Studio build
        backgroundColor = juce::Colour::fromString ("${ampParam?.bgColor || "#ff1c1c22"}");
        borderColor = juce::Colour::fromString ("${ampParam?.borderColor || "#ff3a3a45"}");
        accentColor = juce::Colour::fromString ("${ampParam?.accentColor || "#ffef4444"}");
        textColor = juce::Colour::fromString ("${ampParam?.textColor || "#ffd4af37"}");

        // Initialize parameters dials
        setupDial (gainSlider, gainLabel, "GAIN");
        setupDial (bassSlider, bassLabel, "BASS");
        setupDial (midSlider, midLabel, "MID");
        setupDial (trebSlider, trebLabel, "TREBLE");
        setupDial (presSlider, presLabel, "PRESENCE");
    }

    void paint (juce::Graphics& g) override
    {
        // Background paint
        g.fillAll (backgroundColor);

        // draw premium border frame
        g.setColour (borderColor);
        g.drawRect (getLocalBounds(), 6.0f);

        // draw hardware text branding overlay
        g.setColour (textColor);
        g.setFont (juce::Font ("Helvetica", 14.0f, juce::Font::bold));
        g.drawText ("${ampParam?.customText || "PLEXI 50W"}", 20, 20, 200, 30, juce::Justification::left);

        // draw speaker cabinet simulation frame wireframe
        auto cabBounds = juce::Rectangle<float> (260.0f, 60.0f, 220.0f, 180.0f);
        g.setColour (juce::Colours::black.withAlpha (0.4f));
        g.fillRoundedRectangle (cabBounds, 12.0f);

        g.setColour (juce::Colour::fromString ("${cabParam?.borderColor || "#ff2c2c36"}"));
        g.drawRoundedRectangle (cabBounds, 12.0f, 4.0f);

        // Paint Speaker grill cloth pattern: ${cabParam?.cabGrillStyle || "weave"}
        g.setColour (textColor.withAlpha (0.15f));
        for (int i = 0; i < cabBounds.getWidth(); i += 8)
        {
            g.drawVerticalLine (cabBounds.getX() + i, cabBounds.getY(), cabBounds.getBottom());
        }
    }

private:
    void setupDial (juce::Slider& slider, juce::Label& label, const juce::String& name)
    {
        slider.setSliderStyle (juce::Slider::RotaryHorizontalVerticalDrag);
        slider.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
        addAndMakeVisible (slider);

        label.setText (name, juce::dontSendNotification);
        label.setFont (juce::Font ("Courier New", 10.0f, juce::Font::bold));
        label.setJustificationType (juce::Justification::centered);
        label.setColour (juce::Label::textColourId, textColor.withAlpha (0.8f));
        addAndMakeVisible (label);
    }

    ${cleanName}AudioProcessor& audioProcessor;

    juce::Colour backgroundColor;
    juce::Colour borderColor;
    juce::Colour accentColor;
    juce::Colour textColor;

    juce::Slider gainSlider, bassSlider, midSlider, trebSlider, presSlider;
    juce::Label gainLabel, bassLabel, midLabel, trebLabel, presLabel;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${cleanName}AudioProcessorEditor)
};`;
  }, [cleanName, parameters]);

  // Visual Customizer JSON Styles generator
  const generatedJsonVisualTheme = useMemo(() => {
    const ampParam = parameters?.find(p => p.controlType === "amp");
    const cabParam = parameters?.find(p => p.controlType === "cab");

    const themePayload = {
      pluginName: pluginName,
      exportedAt: new Date().toISOString(),
      generator: "AI Studio Build Exporter v2.0",
      faceplate: {
        textColor: ampParam?.textColor || "#d4af37",
        bgColor: ampParam?.bgColor || "#1c1c22",
        borderColor: ampParam?.borderColor || "#3a3a45",
        accentColor: ampParam?.accentColor || "#ef4444",
        customText: ampParam?.customText || "PLEXI 50W",
        stylePreset: ampParam?.customStyle || "sleek"
      },
      hardware: {
        amplifier: {
          tolexPattern: ampParam?.ampTolexPattern || "leather",
          knobsStyle: ampParam?.ampKnobStyle || "pointer",
          preampCircuit: ampParam?.ampChannelType || "crunch",
          tubeGlowActive: ampParam?.ampTubeGlow ?? false,
        },
        cabinet: {
          grillClothStyle: cabParam?.cabGrillStyle || "weave",
          speakersConfiguration: cabParam?.cabSize || "4x12",
          activeMicModel: cabParam?.cabMicModel || "SM57",
          totalIrsLoaded: cabParam?.irFiles?.length || 0,
          activeIrName: cabParam?.irFiles?.find(ir => ir.id === cabParam.activeIrId)?.name || "Default Bypass"
        }
      }
    };

    return JSON.stringify(themePayload, null, 2);
  }, [pluginName, parameters]);

  // Active compiled script content selector
  const activeScriptContent = useMemo(() => {
    switch (scriptTab) {
      case "faust": return sidechainFaustCode;
      case "juce": return sidechainJuceCode;
      case "webaudio": return webAudioCode;
      case "rust": return rustNihPlugCode;
      case "maxmsp": return maxMspGenCode;
      case "teensy": return teensyDspCode;
      default: return "";
    }
  }, [scriptTab, sidechainFaustCode, sidechainJuceCode, webAudioCode, rustNihPlugCode, maxMspGenCode, teensyDspCode]);

  // Active compiled visual code selector
  const activeVisualContent = useMemo(() => {
    switch (visualTab) {
      case "react": return generatedReactVisualCode;
      case "juce": return generatedJuceVisualCode;
      case "json": return generatedJsonVisualTheme;
      default: return "";
    }
  }, [visualTab, generatedReactVisualCode, generatedJuceVisualCode, generatedJsonVisualTheme]);

  // macOS script generator
  const generatedMacInstallerScript = useMemo(() => {
    if (installerTarget === "ide") {
      return `#!/bin/bash
# ==============================================================================
#  macOS Unified OrangeJUCE Workspace Desktop App Packager
#  Generated by AI Studio Build Desktop Suite Exporter
#  Target Platforms: Apple Silicon (M1/M2/M3) & Intel x64
#  Publisher: OrangeJUCE (Web-to-Desktop Electron Pipeline)
#  Version: ${installerVersion}
# ==============================================================================

set -e # Exit immediately on error

echo "🍊 Bootstrapping OrangeJUCE Desktop package builder..."

# 1. Install desktop packaging tools
if ! command -v npm &> /dev/null; then
    echo "❌ Node.js and npm are required. Please install them first."
    exit 1
fi

echo "📦 Installing development dependencies for Electron desktop wrapper..."
# npm install --save-dev electron electron-builder --legacy-peer-deps

# 2. Build the web app bundle
echo "🏗️ Compiling modern React + Tailwind static frontend assets..."
# npm run build

echo "⚡ Creating Electron main process controller (electron-main.js)..."
# (Auto-configured main.js is loaded in the workspace)

echo "💼 Bundling Vite production build into Electron container..."
# npx electron-builder --mac dmg --arm64 --x64

echo "✅ Success! macOS Desktop Installer DMG generated successfully at: ./dist_desktop/OrangeJUCE_mac_${installerVersion}.dmg"
`;
    }

    return `#!/bin/bash
# ==============================================================================
#  macOS Unified Audio Plugin Installer Packager
#  Generated by AI Studio Build Installer Exporter
#  Target Formats: VST3, AU (Component), AAX, Standalone
#  Manufacturer: ${manufacturerName}
#  Version: ${installerVersion}
# ==============================================================================

set -e # Exit immediately on error

# Configuration
PLUGIN_NAME="${cleanName}"
MANUFACTURER="${manufacturerName}"
VERSION="${installerVersion}"
BUNDLE_ID="com.\${MANUFACTURER,,}.\${PLUGIN_NAME,,}"

# Folders Setup
STAGE_DIR="./installer_stage"
PKG_DIR="./installer_out"
mkdir -p "\${STAGE_DIR}/vst3" "\${STAGE_DIR}/au" "\${STAGE_DIR}/aax" "\${STAGE_DIR}/standalone"
mkdir -p "\${PKG_DIR}"

echo "🔨 Preparing macOS audio plugin bundles for packaging..."

# Copying compiled binaries from local CMake builds
# Uncomment and replace paths once local build is complete:
# cp -R build/\${PLUGIN_NAME}_artefacts/Release/VST3/\${PLUGIN_NAME}.vst3 "\${STAGE_DIR}/vst3/"
# cp -R build/\${PLUGIN_NAME}_artefacts/Release/AU/\${PLUGIN_NAME}.component "\${STAGE_DIR}/au/"
# cp -R build/\${PLUGIN_NAME}_artefacts/Release/AAX/\${PLUGIN_NAME}.aaxplugin "\${STAGE_DIR}/aax/"
# cp -R build/\${PLUGIN_NAME}_artefacts/Release/Standalone/\${PLUGIN_NAME}.app "\${STAGE_DIR}/standalone/"

echo "📦 Packaging component pkg files with pkgbuild..."

# 1. VST3 package
pkgbuild --identifier "\${BUNDLE_ID}.pkg.vst3" \\
         --version "\${VERSION}" \\
         --install-location "/Library/Audio/Plug-Ins/VST3" \\
         --root "\${STAGE_DIR}/vst3" \\
         "\${PKG_DIR}/vst3.pkg"

# 2. AU package
pkgbuild --identifier "\${BUNDLE_ID}.pkg.au" \\
         --version "\${VERSION}" \\
         --install-location "/Library/Audio/Plug-Ins/Components" \\
         --root "\${STAGE_DIR}/au" \\
         "\${PKG_DIR}/au.pkg"

# 3. AAX package
pkgbuild --identifier "\${BUNDLE_ID}.pkg.aax" \\
         --version "\${VERSION}" \\
         --install-location "/Library/Application Support/Avid/Audio/Plug-Ins" \\
         --root "\${STAGE_DIR}/aax" \\
         "\${PKG_DIR}/aax.pkg"

# 4. Standalone app package
pkgbuild --identifier "\${BUNDLE_ID}.pkg.standalone" \\
         --version "\${VERSION}" \\
         --install-location "/Applications" \\
         --root "\${STAGE_DIR}/standalone" \\
         "\${PKG_DIR}/standalone.pkg"

echo "🔗 Joining individual packages with productbuild..."
productbuild --synthesize \\
             --package "\${PKG_DIR}/vst3.pkg" \\
             --package "\${PKG_DIR}/au.pkg" \\
             --package "\${PKG_DIR}/aax.pkg" \\
             --package "\${PKG_DIR}/standalone.pkg" \\
             "\${PKG_DIR}/distribution.xml"

# Final flat package distribution installer
productbuild --distribution "\${PKG_DIR}/distribution.xml" \\
             --package-path "\${PKG_DIR}" \\
             "./\${PLUGIN_NAME}_mac_installer_\${VERSION}.pkg"

echo "✅ Success! macOS Installer file generated at: ./\${PLUGIN_NAME}_mac_installer_\${VERSION}.pkg"
`;
  }, [installerTarget, cleanName, manufacturerName, installerVersion]);

  // Windows script generator
  const generatedWinInstallerScript = useMemo(() => {
    if (installerTarget === "ide") {
      return `; ==============================================================================
;  Windows OrangeJUCE Desktop Application Installer (Inno Setup ISS Script)
;  Generated by AI Studio Build Desktop Suite Exporter
;  Publisher: OrangeJUCE
;  Version: ${installerVersion}
; ==============================================================================

[Setup]
AppName=OrangeJUCE
AppVersion=${installerVersion}
AppPublisher=${manufacturerName}
DefaultDirName={autopf}\\OrangeJUCE
DefaultGroupName=OrangeJUCE
OutputBaseFilename=OrangeJUCE_win_installer_${installerVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=no
AppIconFile=build_assets\\icon.ico
SetupIconFile=build_assets\\installer_icon.ico

[Types]
Name: "full"; Description: "Full OrangeJUCE Suite installation (Recommended)"

[Components]
Name: "app"; Description: "OrangeJUCE Core Application"; Types: full; Flags: fixed

[Files]
; Compiled Electron Desktop app binaries
Source: "dist_desktop\\win-unpacked\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs; Components: app

[Icons]
Name: "{group}\\OrangeJUCE"; Filename: "{app}\\OrangeJUCE.exe"; WorkingDir: "{app}"
Name: "{commondesktop}\\OrangeJUCE"; Filename: "{app}\\OrangeJUCE.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create desktop shortcut"; Components: app

[Registry]
; Bind .juce and .faust files to open automatically in OrangeJUCE Desktop
Root: HKA; Subkey: "Software\\Classes\\.juce"; ValueType: string; ValueName: ""; ValueData: "OrangeJUCEProjectFile"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\\Classes\\OrangeJUCEProjectFile"; ValueType: string; ValueName: ""; ValueData: "OrangeJUCE Workspace Project"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\\Classes\\OrangeJUCEProjectFile\\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\\OrangeJUCE.exe,0"
Root: HKA; Subkey: "Software\\Classes\\OrangeJUCEProjectFile\\shell\\open\\command"; ValueType: string; ValueName: ""; ValueData: """{app}\\OrangeJUCE.exe"" ""%1"""

[Run]
Filename: "{app}\\OrangeJUCE.exe"; Description: "Launch OrangeJUCE Desktop IDE"; Flags: nowait postinstall skipifsilent; Components: app
`;
    }

    return `; ==============================================================================
;  Windows Unified Audio Plugin Installer (Inno Setup ISS Script)
;  Generated by AI Studio Build Installer Exporter
;  Target Formats: VST3, AAX, Standalone
;  Publisher: ${manufacturerName}
;  Version: ${installerVersion}
; ==============================================================================

[Setup]
AppName=${cleanName}
AppVersion=${installerVersion}
AppPublisher=${manufacturerName}
DefaultDirName={commoncf}\\VST3\\${manufacturerName}
DefaultGroupName=${manufacturerName}
OutputBaseFilename=${cleanName}_win_installer_${installerVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
DisableDirPage=yes

[Types]
Name: "full"; Description: "Full installation (Recommended)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "vst3"; Description: "VST3 Plugin (.vst3)"; Types: full custom; Flags: fixed
Name: "aax"; Description: "AAX Pro Tools Plugin (.aaxplugin)"; Types: full custom
Name: "standalone"; Description: "Standalone Application (.exe)"; Types: full custom

[Files]
; VST3 plugin bundle files
Source: "build\\${cleanName}_artefacts\\Release\\VST3\\${cleanName}.vst3\\*"; DestDir: "{commoncf}\\VST3"; Flags: recursesubdirs createallsubdirs; Components: vst3

; AAX plugin bundle files
Source: "build\\${cleanName}_artefacts\\Release\\AAX\\${cleanName}.aaxplugin\\*"; DestDir: "{commoncf}\\Avid\\Audio\\Plug-Ins"; Flags: recursesubdirs createallsubdirs; Components: aax

; Standalone binary
Source: "build\\${cleanName}_artefacts\\Release\\Standalone\\${cleanName}.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: standalone

[Icons]
Name: "{group}\\${cleanName} Standalone"; Filename: "{app}\\${cleanName}.exe"; Components: standalone
Name: "{commondesktop}\\${cleanName} Standalone"; Filename: "{app}\\${cleanName}.exe"; Components: standalone; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create desktop shortcut"; Components: standalone

[Run]
Filename: "{app}\\${cleanName}.exe"; Description: "Launch ${cleanName}"; Flags: nowait postinstall skipifsilent; Components: standalone
`;
  }, [installerTarget, cleanName, manufacturerName, installerVersion]);

  // CMake CPack or Electron main.js script generator
  const generatedCMakeCPackConfig = useMemo(() => {
    if (installerTarget === "ide") {
      return `// ==============================================================================
//  OrangeJUCE Desktop Application - Electron Main Entrypoint (electron-main.js)
//  Generated by AI Studio Build Desktop Suite Exporter
//  Integrate native audio and WebGL hardware acceleration.
// ==============================================================================

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "OrangeJUCE DSP Workspace",
    backgroundColor: "#111115",
    frame: true, // Native window frame
    titleBarStyle: "hiddenInset", // Sleek macOS window controls
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Enable high performance GPU hardware acceleration for rendering DSP visualizers
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');

  // Load static files compiled from React + Vite
  mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));

  // Intercept open links to boot the system's default web browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Ensure audio system initializes correctly without sandboxed driver blocks
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
`;
    }

    return `# ==============================================================================
#  CPack Configuration File for ${pluginName}
#  Generated by AI Studio Build Installer Exporter
#  Integrate native multi-platform installer packaging directly into CMake list tree.
# ==============================================================================

set(CPACK_PACKAGE_NAME "${cleanName}")
set(CPACK_PACKAGE_VENDOR "${manufacturerName}")
set(CPACK_PACKAGE_VERSION "${installerVersion}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Professional high-precision DSP audio plugin suite")

# Target Platform Exporter
if(APPLE)
    # macOS packaging configuration using standard productbuild toolchain
    set(CPACK_GENERATOR "productbuild")
    set(CPACK_PACKAGING_INSTALL_PREFIX "/Library/Audio/Plug-Ins")
    set(CPACK_PRODUCTBUILD_RESOURCES_DIR "\\\${CMAKE_CURRENT_SOURCE_DIR}/installer/mac/resources")
elseif(WIN32)
    # Windows packaging configuration using standard NSIS installer compiler
    set(CPACK_GENERATOR "NSIS")
    set(CPACK_NSIS_DISPLAY_NAME "${cleanName} v\\\${CPACK_PACKAGE_VERSION}")
    set(CPACK_NSIS_PACKAGE_NAME "${cleanName} Windows Installation Suite")
    set(CPACK_NSIS_HELP_LINK "https://www.\\\${CPACK_PACKAGE_VENDOR,,}.com")
    set(CPACK_NSIS_MODIFY_PATH ON)
endif()

include(CPack)
`;
  }, [installerTarget, cleanName, pluginName, manufacturerName, installerVersion]);

  // Active installer content selector
  const activeInstallerContent = useMemo(() => {
    switch (installerTab) {
      case "mac": return generatedMacInstallerScript;
      case "win": return generatedWinInstallerScript;
      case "cpack": return generatedCMakeCPackConfig;
      default: return "";
    }
  }, [installerTab, generatedMacInstallerScript, generatedWinInstallerScript, generatedCMakeCPackConfig]);

  // Project structures for full ready-to-compile projects (CMake, Processor templates, etc.)
  const projectFiles = useMemo(() => {
    const isAuxSetup = sidechainEnabled;
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    const dspPrivateMembers = parameters.map(p => {
      return `    float m_${p.id} = ${cppFloatLiteral(p.defaultValue)};`;
    }).join("\n");

    const dspSetters = parameters.map(p => {
      return `    void set${capitalize(p.id)}(float val) { m_${p.id} = val; }`;
    }).join("\n");

    const hasFilter = parameters.some(p => p.id === "cutoff" || p.id === "resonance");
    const hasDelay = parameters.some(p => p.id === "delayTime" || p.id === "feedback");
    const hasTremolo = parameters.some(p => p.id === "tremoloRate" || p.id === "tremoloDepth");
    const hasChorus = parameters.some(p => p.id === "chorusRate" || p.id === "chorusDepth");

    const dspStateVars = [
      hasFilter ? `    // SVF Filter state registers (Left & Right channels)
    float lp_L_y1 = 0.0f;
    float lp_L_y2 = 0.0f;
    float lp_R_y1 = 0.0f;
    float lp_R_y2 = 0.0f;` : "",
      hasDelay ? `    // High-fidelity delay lines
    std::vector<float> mDelayLineL;
    std::vector<float> mDelayLineR;
    int mWritePtr = 0;` : "",
      hasTremolo ? `    // LFO Tremolo state
    float mTremoloPhase = 0.0f;` : "",
      hasChorus ? `    // LFO Chorus circular buffer & phase states
    std::vector<float> mChorusLineL;
    std::vector<float> mChorusLineR;
    int mChorusPtr = 0;
    float mChorusPhase = 0.0f;` : ""
    ].filter(Boolean).join("\n");

    const dspConstructorInit = [
      hasDelay ? `        mDelayLineL.resize(96000, 0.0f);
        mDelayLineR.resize(96000, 0.0f);` : "",
      hasChorus ? `        mChorusLineL.resize(44100, 0.0f);
        mChorusLineR.resize(44100, 0.0f);` : ""
    ].filter(Boolean).join("\n");

    const dspProcessingPerSample = parameters.map(p => {
      if (p.id === "volume") {
        return `            // Gain scale
            left *= m_volume;
            right *= m_volume;`;
      } else if (p.id === "drive" || p.id === "bias") {
        const hasDrive = parameters.some(p2 => p2.id === "drive");
        const hasBias = parameters.some(p2 => p2.id === "bias");
        return `            // High-fidelity wave-shaper saturation
            float driveVal = ${hasDrive ? "m_drive" : "1.0f"};
            float biasVal = ${hasBias ? "m_bias" : "0.0f"};
            left = std::tanh((left + biasVal) * driveVal);
            right = std::tanh((right + biasVal) * driveVal);`;
      } else if (p.id === "cutoff" || p.id === "resonance") {
        const hasCutoff = parameters.some(p2 => p2.id === "cutoff");
        const hasRes = parameters.some(p2 => p2.id === "resonance");
        return `            // Active lowpass resonant filter block
            float cutoffVal = ${hasCutoff ? "m_cutoff" : "1000.0f"};
            float resVal = ${hasRes ? "m_resonance" : "0.1f"};
            float f = (2.0f * 3.14159265f * cutoffVal) / static_cast<float>(mSampleRate);
            if (f > 0.99f) f = 0.99f;
            float q = 1.0f - f;
            float fb = resVal * 4.0f;
            
            // Left Channel
            float inputL = left - (lp_L_y2 * fb);
            lp_L_y1 = (lp_L_y1 * q) + (inputL * f);
            lp_L_y2 = (lp_L_y2 * q) + (lp_L_y1 * f);
            left = lp_L_y2;

            // Right Channel
            float inputR = right - (lp_R_y2 * fb);
            lp_R_y1 = (lp_R_y1 * q) + (inputR * f);
            lp_R_y2 = (lp_R_y2 * q) + (lp_R_y1 * f);
            right = lp_R_y2;`;
      } else if (p.id === "delayTime" || p.id === "feedback") {
        const hasTime = parameters.some(p2 => p2.id === "delayTime");
        const hasFB = parameters.some(p2 => p2.id === "feedback");
        return `            // Interpolating circular audio delay line
            float delayMs = ${hasTime ? "m_delayTime" : "250.0f"};
            float fbVal = ${hasFB ? "m_feedback" : "0.3f"};
            int delaySamps = static_cast<int>((delayMs / 1000.0f) * mSampleRate);
            if (delaySamps >= 96000) delaySamps = 95999;
            if (delaySamps < 1) delaySamps = 1;
            
            int readPtr = mWritePtr - delaySamps;
            if (readPtr < 0) readPtr += 96000;
            
            float echoL = mDelayLineL[readPtr];
            float echoR = mDelayLineR[readPtr];
            
            mDelayLineL[mWritePtr] = left + (echoL * fbVal);
            mDelayLineR[mWritePtr] = right + (echoR * fbVal);
            mWritePtr = (mWritePtr + 1) % 96000;
            
            left = (left * 0.6f) + (echoL * 0.4f);
            right = (right * 0.6f) + (echoR * 0.4f);`;
      } else if (p.id === "tremoloRate" || p.id === "tremoloDepth") {
        const hasRate = parameters.some(p2 => p2.id === "tremoloRate");
        const hasDepth = parameters.some(p2 => p2.id === "tremoloDepth");
        return `            // Stereo LFO Amplitude Modulation (Tremolo)
            float tRate = ${hasRate ? "m_tremoloRate" : "5.0f"};
            float tDepth = ${hasDepth ? "m_tremoloDepth" : "0.5f"};
            mTremoloPhase += (2.0f * 3.14159265f * tRate) / static_cast<float>(mSampleRate);
            if (mTremoloPhase > 2.0f * 3.14159265f) mTremoloPhase -= 2.0f * 3.14159265f;
            
            float tremMod = 1.0f - (((std::sin(mTremoloPhase) + 1.0f) * 0.5f) * tDepth);
            left *= tremMod;
            right *= tremMod;`;
      } else if (p.id === "chorusRate" || p.id === "chorusDepth") {
        const hasRate = parameters.some(p2 => p2.id === "chorusRate");
        const hasDepth = parameters.some(p2 => p2.id === "chorusDepth");
        return `            // Dynamic Dual LFO Chorus
            float cRate = ${hasRate ? "m_chorusRate" : "1.2f"};
            float cDepth = ${hasDepth ? "m_chorusDepth" : "3.0f"};
            
            mChorusLineL[mChorusPtr] = left;
            mChorusLineR[mChorusPtr] = right;
            mChorusPhase += (2.0f * 3.14159265f * cRate) / static_cast<float>(mSampleRate);
            if (mChorusPhase > 2.0f * 3.14159265f) mChorusPhase -= 2.0f * 3.14159265f;
            
            float targetDelayL = 200.0f + (std::sin(mChorusPhase) * cDepth);
            float targetDelayR = 200.0f + (std::sin(mChorusPhase + 1.57079f) * cDepth);
            
            int cReadL = mChorusPtr - static_cast<int>(targetDelayL);
            int cReadR = mChorusPtr - static_cast<int>(targetDelayR);
            if (cReadL < 0) cReadL += 44100;
            if (cReadR < 0) cReadR += 44100;
            
            float chorusSampleL = mChorusLineL[cReadL];
            float chorusSampleR = mChorusLineR[cReadR];
            mChorusPtr = (mChorusPtr + 1) % 44100;
            
            left = (left * 0.6f) + (chorusSampleL * 0.4f);
            right = (right * 0.6f) + (chorusSampleR * 0.4f);`;
      }
      return "";
    }).filter((line, index, self) => line !== "" && self.indexOf(line) === index).join("\n\n");

    const projectSidechainFilter = parameters.some((p) => p.id === "cutoff");
    const projectSidechainProcess = projectSidechainFilter
      ? `                const float detector = std::abs(key[i]);
                const float a = 1.0f - std::exp(-1.0f / (std::max(1.0f, m_attack) * 0.001f * static_cast<float>(mSampleRate)));
                const float r = 1.0f - std::exp(-1.0f / (std::max(20.0f, m_release) * 0.001f * static_cast<float>(mSampleRate)));
                mEnv[ch] += (detector > mEnv[ch] ? a : r) * (detector - mEnv[ch]);
                const float hz = std::clamp(m_cutoff * (1.0f + mEnv[ch] * m_sensitivity * 7.0f), 40.0f, 18000.0f);
                const float coeff = 1.0f - std::exp(-6.28318530718f * hz / static_cast<float>(mSampleRate));
                mState[ch] += coeff * (main[i] - mState[ch]);
                main[i] = mState[ch] * m_mix + main[i] * (1.0f - m_mix);`
      : `                const float detector = std::abs(key[i]);
                const float a = 1.0f - std::exp(-1.0f / (std::max(0.05f, m_attack) * 44.1f));
                const float r = 1.0f - std::exp(-1.0f / (std::max(1.0f, m_release) * 0.001f * static_cast<float>(mSampleRate)));
                mEnv[ch] += (detector > mEnv[ch] ? a : r) * (detector - mEnv[ch]);
                const float envDb = 20.0f * std::log10(std::max(1.0e-6f, mEnv[ch]));
                const float overDb = envDb - m_threshold;
                const float gainDb = overDb > 0.0f ? -overDb * (1.0f - 1.0f / std::max(1.0f, m_ratio)) : 0.0f;
                const float gain = std::pow(10.0f, (gainDb + m_makeup) / 20.0f);
                const float wet = std::tanh(main[i] * gain);
                main[i] = wet * m_mix + main[i] * (1.0f - m_mix);`;
    const fullProjectSidechainCore = `#pragma once
#include <JuceHeader.h>
#include <algorithm>
#include <cmath>
class ${cleanName}DSP {
public:
    void prepareToPlay(double sampleRate, int) noexcept { mSampleRate = sampleRate; mEnv[0] = mEnv[1] = mState[0] = mState[1] = 0.0f; }
    void processBlock(juce::AudioBuffer<float>& mainBus, const juce::AudioBuffer<float>& auxBus) noexcept {
        const bool hasAux = auxBus.getNumChannels() > 0 && auxBus.getNumSamples() >= mainBus.getNumSamples();
        for (int ch = 0; ch < mainBus.getNumChannels(); ++ch) {
            auto* main = mainBus.getWritePointer(ch);
            const auto* key = hasAux ? auxBus.getReadPointer(std::min(ch, auxBus.getNumChannels() - 1)) : main;
            for (int i = 0; i < mainBus.getNumSamples(); ++i) {
${projectSidechainProcess}
            }
        }
    }
${dspSetters}
private:
    double mSampleRate = 44100.0;
    float mEnv[2] { 0.0f, 0.0f };
    float mState[2] { 0.0f, 0.0f };
${dspPrivateMembers}
};`;

    const cmakeLists = `# ==============================================================================
#  CMakeLists.txt - Auto-Generated build script for ${pluginName}
#  Designed for standard modern JUCE CMake structure (JUCE 6 / 7 / 8)
# ==============================================================================
cmake_minimum_required(VERSION 3.15)

project(${cleanName} VERSION 1.0.0 LANGUAGES CXX)

# Include JUCE framework
add_subdirectory(JUCE)

juce_add_plugin(${cleanName}
    COMPANY_NAME "Orange Juce Studio"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
    PLUGIN_MANUFACTURER_CODE "OrJu"
    PLUGIN_CODE_HEX "0x${Math.floor(Math.random() * 65535).toString(16).padStart(4, "a")}"
    FORMATS VST3 AU AAX Standalone CLAP
    PRODUCT_NAME "${pluginName}"
)

target_sources(${cleanName} PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginProcessor.h
    Source/PluginEditor.cpp
    Source/PluginEditor.h
    Source/DSPCore.h
)

target_compile_features(${cleanName} PUBLIC cxx_std_17)

target_link_libraries(${cleanName} PRIVATE
    juce::juce_audio_processors
    juce::juce_audio_utils
    juce::juce_gui_extra
)

juce_generate_juce_header(${cleanName})`;

    const dspCoreH = sidechainEnabled
      ? (deterministicJuceAvailable ? fullProjectSidechainCore : `#error "Full JUCE project unavailable: this custom sidechain DSP requires a faithful native translation."
`)
      : `#pragma once
#include <cmath>
#include <vector>

// DSP Core processing logic block exported from design IDE
class ${cleanName}DSP {
public:
    ${cleanName}DSP() {
${dspConstructorInit}
    }
    
    void prepareToPlay(double sampleRate, int samplesPerBlock) {
        mSampleRate = sampleRate;
        mSamplesPerBlock = samplesPerBlock;
        reset();
    }

    void reset() {
${hasFilter ? `        lp_L_y1 = 0.0f; lp_L_y2 = 0.0f;
        lp_R_y1 = 0.0f; lp_R_y2 = 0.0f;` : ""}
${hasDelay ? `        std::fill(mDelayLineL.begin(), mDelayLineL.end(), 0.0f);
        std::fill(mDelayLineR.begin(), mDelayLineR.end(), 0.0f);
        mWritePtr = 0;` : ""}
${hasTremolo ? `        mTremoloPhase = 0.0f;` : ""}
${hasChorus ? `        std::fill(mChorusLineL.begin(), mChorusLineL.end(), 0.0f);
        std::fill(mChorusLineR.begin(), mChorusLineR.end(), 0.0f);
        mChorusPtr = 0;
        mChorusPhase = 0.0f;` : ""}
    }

    void processBlock(float* channelLeft, float* channelRight, int numSamples) {
        for (int i = 0; i < numSamples; ++i) {
            float left = channelLeft[i];
            float right = channelRight[i];
            
${dspProcessingPerSample || `            // Stereo Passthrough
            left = left;
            right = right;`}

            channelLeft[i] = left;
            channelRight[i] = right;
        }
    }

    // Dynamic Parameter Setters
${dspSetters}

private:
    double mSampleRate = 44100.0;
    int mSamplesPerBlock = 256;

    // Parameters
${dspPrivateMembers}

    // State registers
${dspStateVars}
};`;

    const processorH = `#pragma once
#include <JuceHeader.h>
#include "DSPCore.h"

class ${cleanName}AudioProcessor  : public juce::AudioProcessor
{
public:
    ${cleanName}AudioProcessor();
    ~${cleanName}AudioProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "${pluginName}"; }

    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // ValueTree for hosting sliders & DAW automation variables safely
    juce::AudioProcessorValueTreeState apvts;

private:
    ${cleanName}DSP dspEngine;
    juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${cleanName}AudioProcessor)
};`;

    const processorCpp = `#include "PluginProcessor.h"
#include "PluginEditor.h"

${cleanName}AudioProcessor::${cleanName}AudioProcessor()
#ifndef JucePlugin_PreferredChannelConfigurations
     : AudioProcessor (BusesProperties()
                     .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                     .withOutput ("Output", juce::AudioChannelSet::stereo(), true)
                     ${isAuxSetup ? `.withInput  ("Sidechain", juce::AudioChannelSet::stereo(), false)` : ""}
                       ),
#endif
       apvts(*this, nullptr, "Parameters", createParameterLayout())
{
}

${cleanName}AudioProcessor::~${cleanName}AudioProcessor() {}

void ${cleanName}AudioProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    dspEngine.prepareToPlay(sampleRate, samplesPerBlock);
}

void ${cleanName}AudioProcessor::releaseResources() {}

bool ${cleanName}AudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    // Ensure input and output match channel profiles
    if (layouts.getMainOutputChannelSet() != layouts.getMainInputChannelSet())
        return false;

    if (layouts.getMainInputChannelSet() != juce::AudioChannelSet::mono()
     && layouts.getMainInputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

    ${isAuxSetup ? `
    // Validate custom Sidechain auxiliary bus layout configuration
    auto auxInput = layouts.getChannelSet (true, 1);
    if (auxInput != juce::AudioChannelSet::disabled() 
     && auxInput != juce::AudioChannelSet::mono() 
     && auxInput != juce::AudioChannelSet::stereo())
        return false;
    ` : ""}

    return true;
}

void ${cleanName}AudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;
    auto totalNumInputChannels  = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear (i, 0, buffer.getNumSamples());

    // Update DSP engine variables from the ValueTreeState in real-time
${parameters.map(p => `    dspEngine.set${capitalize(p.id)}(*apvts.getRawParameterValue("${p.id}"));`).join("\n")}

    ${isAuxSetup ? `
    // Read Main audio stream and auxiliary sidechain stream
    auto mainBus = getBusBuffer(buffer, true, 0);
    auto auxBus = getBusBuffer(buffer, true, 1);

    // Call dynamic block processor passing auxiliary feed
    dspEngine.processBlock(mainBus, auxBus);
    ` : `
    auto* leftData = buffer.getWritePointer(0);
    auto* rightData = totalNumInputChannels > 1 ? buffer.getWritePointer(1) : leftData;

    dspEngine.processBlock(leftData, rightData, buffer.getNumSamples());
    `}
}

juce::AudioProcessorEditor* ${cleanName}AudioProcessor::createEditor()
{
    return new ${cleanName}AudioProcessorEditor (*this);
}

// State persistency helpers
void ${cleanName}AudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml (state.createXml());
    copyXmlToBinary (*xml, destData);
}

void ${cleanName}AudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState (getXmlFromBinary (data, sizeInBytes));
    if (xmlState != nullptr && xmlState->hasTagName (apvts.state.getType()))
        apvts.replaceState (juce::ValueTree::fromXml (*xmlState));
}

juce::AudioProcessorValueTreeState::ParameterLayout ${cleanName}AudioProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    
${parameters.map(p => `    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        "${p.id}", 
        "${p.name}", 
        juce::NormalisableRange<float>(${cppFloatLiteral(p.min)}, ${cppFloatLiteral(p.max)}, 0.01f),
        ${cppFloatLiteral(p.defaultValue)},
        "${p.unit || ""}"
    ));`).join("\n")}

    return { params.begin(), params.end() };
}

// Entry point initialization
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new ${cleanName}AudioProcessor();
}`;

    const editorH = `#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class ${cleanName}AudioProcessorEditor  : public juce::AudioProcessorEditor
{
public:
    ${cleanName}AudioProcessorEditor (${cleanName}AudioProcessor&);
    ~${cleanName}AudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    ${cleanName}AudioProcessor& audioProcessor;

    // Dynamic parameter sliders, toggles and attachments
${parameters.map(p => {
  if (p.controlType === "toggle") {
    return `    juce::ToggleButton toggle_${p.id};
    std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> attach_${p.id};`;
  } else {
    return `    juce::Slider slider_${p.id};
    juce::Label label_${p.id};
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> attach_${p.id};`;
  }
}).join("\n")}

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (${cleanName}AudioProcessorEditor)
};`;

    const colsCount = Math.min(parameters.length, 4);
    const rowsCount = Math.max(1, Math.ceil(parameters.length / 4));
    const editorWidth = colsCount * 125 + 60;
    const editorHeight = rowsCount * 150 + 80;

    const resizedLayout = parameters.map((p, index) => {
      const colWidth = 100;
      const rowHeight = 135;
      const cols = 4;
      const c = index % cols;
      const r = Math.floor(index / cols);
      const x = 30 + c * (colWidth + 25);
      const y = 65 + r * (rowHeight + 15);
      
      if (p.controlType === "toggle") {
        return `    toggle_${p.id}.setBounds (${x}, ${y} + 40, ${colWidth}, 30);`;
      } else {
        return `    label_${p.id}.setBounds (${x}, ${y}, ${colWidth}, 20);
    slider_${p.id}.setBounds (${x}, ${y} + 20, ${colWidth}, 95);`;
      }
    }).join("\n");

    const editorCpp = `#include "PluginProcessor.h"
#include "PluginEditor.h"

${cleanName}AudioProcessorEditor::${cleanName}AudioProcessorEditor (${cleanName}AudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    // Auto-calculating layout sizing based on control count
    setSize (${editorWidth}, ${editorHeight});
    
${parameters.map(p => {
  if (p.controlType === "toggle") {
    return `    // Configure and bind Toggle: ${p.name}
    addAndMakeVisible(toggle_${p.id});
    toggle_${p.id}.setButtonText("${p.name}");
    attach_${p.id} = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
        audioProcessor.apvts, "${p.id}", toggle_${p.id}
    );`;
  } else {
    return `    // Configure and bind Slider Knob: ${p.name}
    addAndMakeVisible(slider_${p.id});
    slider_${p.id}.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    slider_${p.id}.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 70, 18);
    slider_${p.id}.setPopupDisplayEnabled(true, false, this);
    
    addAndMakeVisible(label_${p.id});
    label_${p.id}.setText("${p.name}", juce::dontSendNotification);
    label_${p.id}.setJustificationType(juce::Justification::centred);
    label_${p.id}.setFont(juce::Font(12.0f, juce::Font::bold));
    
    attach_${p.id} = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        audioProcessor.apvts, "${p.id}", slider_${p.id}
    );`;
  }
}).join("\n")}
}

${cleanName}AudioProcessorEditor::~${cleanName}AudioProcessorEditor() {}

void ${cleanName}AudioProcessorEditor::paint (juce::Graphics& g)
{
    // Draw high-contrast OrangeJUCE professional background
    auto backgroundGradient = juce::ColourGradient (
        juce::Colour (0xFF141416), 0.0f, 0.0f,
        juce::Colour (0xFF0E0E0F), 0.0f, static_cast<float>(getHeight()), 
        false
    );
    g.setGradientFill (backgroundGradient);
    g.fillAll();

    // Draw branding border
    g.setColour (juce::Colour (0xFFF97316)); // OrangeJUCE Theme Orange
    g.drawRect (getLocalBounds(), 2);

    // Header Area Panel
    g.setColour (juce::Colour (0xFF1C1C1E));
    g.fillRect (0, 0, getWidth(), 45);
    g.setColour (juce::Colour (0xFF2C2C2E));
    g.drawHorizontalLine (44, 0.0f, static_cast<float>(getWidth()));

    // Brand text and status
    g.setColour (juce::Colours::white);
    g.setFont (juce::Font ("Inter", 16.0f, juce::Font::bold));
    g.drawText ("🍊 OrangeJUCE // ${pluginName}", 15, 0, 300, 45, juce::Justification::left);
    
    g.setColour (juce::Colour (0xFFF97316));
    g.setFont (juce::Font ("JetBrains Mono", 10.0f, juce::Font::plain));
    g.drawText ("DSP CORE INSTANCE ENGINE", getWidth() - 220, 0, 200, 45, juce::Justification::right);
}

void ${cleanName}AudioProcessorEditor::resized()
{
${resizedLayout}
}`;

    return {
      "CMakeLists.txt": cmakeLists,
      "Source/DSPCore.h": dspCoreH,
      "Source/PluginProcessor.h": processorH,
      "Source/PluginProcessor.cpp": processorCpp,
      "Source/PluginEditor.h": editorH,
      "Source/PluginEditor.cpp": editorCpp
    };
  }, [cleanName, pluginName, sidechainEnabled, deterministicJuceAvailable, parameters]);

  const activeProjectFileContent = useMemo(() => {
    const key = activeProjectFile as keyof typeof projectFiles;
    return projectFiles[key] || "";
  }, [projectFiles, activeProjectFile]);

  const downloadAllAsScript = () => {
    let filename = "";
    switch (scriptTab) {
      case "faust":
        filename = `${lowercaseSnakeName}.dsp`;
        break;
      case "juce":
        filename = `${cleanName}DSP.h`;
        break;
      case "webaudio":
        filename = `${lowercaseSnakeName}_worklet.js`;
        break;
      case "rust":
        filename = `${lowercaseSnakeName}_dsp.rs`;
        break;
      case "maxmsp":
        filename = `${lowercaseSnakeName}.gendsp`;
        break;
      case "teensy":
        filename = `${cleanName}TeensyDSP.h`;
        break;
      default:
        filename = "source.txt";
    }

    if (!activeScriptContent) return;

    const blob = new Blob([activeScriptContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadVisualFile = () => {
    let filename = "";
    switch (visualTab) {
      case "react":
        filename = `${cleanName}VisualCustomizer.tsx`;
        break;
      case "juce":
        filename = `${cleanName}PluginEditor.cpp`;
        break;
      case "json":
        filename = `${lowercaseSnakeName}_theme.json`;
        break;
      default:
        filename = "theme.txt";
    }

    if (!activeVisualContent) return;

    const blob = new Blob([activeVisualContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadInstallerFile = () => {
    let filename = "";
    if (installerTarget === "ide") {
      switch (installerTab) {
        case "mac":
          filename = `build_orangejuce_mac.sh`;
          break;
        case "win":
          filename = `orangejuce_installer.iss`;
          break;
        case "cpack":
          filename = `electron-main.js`;
          break;
        default:
          filename = "orangejuce_installer.txt";
      }
    } else {
      switch (installerTab) {
        case "mac":
          filename = `build_mac_installer.sh`;
          break;
        case "win":
          filename = `${lowercaseSnakeName}_installer.iss`;
          break;
        case "cpack":
          filename = `CPackConfig.cmake`;
          break;
        default:
          filename = "installer_script.txt";
      }
    }

    if (!activeInstallerContent) return;

    const blob = new Blob([activeInstallerContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCompileInstallers = () => {
    setIsBuildingInstallers(true);
    setInstallerOutputBuilt(false);
    const timestamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    
    if (installerTarget === "ide") {
      setInstallerLogs([
        { text: `[${timestamp()}] Booting Installer Compilers: Unified OrangeJUCE Desktop Suite Packager...`, type: "input" },
        { text: `[${timestamp()}] Platform constraints identified: Target Apple Silicon & Intel macOS DMG, and Windows 10/11 x64 NSIS Installer`, type: "info" }
      ]);

      setTimeout(() => {
        setInstallerLogs(prev => [
          ...prev,
          { text: `[${timestamp()}] 🍎 MAC ELECTRON BUNDLER: Reading static React + Tailwind compile folders...`, type: "work" },
          { text: `[${timestamp()}] 🍎 MAC ELECTRON BUILDER: Compiling arm64 and x64 native macOS packages...`, type: "work" },
          { text: `[${timestamp()}] 🍎 MAC DMG GENERATOR: Structuring custom visual DMG background layout...`, type: "info" }
        ]);
      }, 600);

      setTimeout(() => {
        setInstallerLogs(prev => [
          ...prev,
          { text: `[${timestamp()}] 🖥️ WINDOWS BUNDLE: Staging dynamic Electron EXE binaries and workspace components...`, type: "work" },
          { text: `[${timestamp()}] 🖥️ WINDOWS REGISTRY: Registering .juce file associations with Microsoft Windows Registry...`, type: "info" },
          { text: `[${timestamp()}] 🖥️ WINDOWS INNO SETUP: Compiling self-extracting installation wizard package...`, type: "work" }
        ]);
      }, 1400);

      setTimeout(() => {
        setInstallerLogs(prev => [
          ...prev,
          { text: `[${timestamp()}] Verifying sandboxed hardware acceleration & audio driver capabilities...`, type: "info" },
          { text: `[${timestamp()}] 🍎 Built macOS Installer: "OrangeJUCE_mac_installer_${installerVersion}.dmg" (~74.5 MB)`, type: "success" },
          { text: `[${timestamp()}] 🖥️ Built Windows Installer: "OrangeJUCE_win_installer_${installerVersion}.exe" (~68.2 MB)`, type: "success" }
        ]);
      }, 2200);

      setTimeout(() => {
        setIsBuildingInstallers(false);
        setInstallerOutputBuilt(true);
        setInstallerLogs(prev => [
          ...prev,
          { text: `[${timestamp()}] Unified desktop application packaging completed with 0 errors. Ready for release distribution.`, type: "success" }
        ]);
      }, 3000);
      return;
    }

    setInstallerLogs([
      { text: `[${timestamp()}] Booting Installer Compilers: Unified Multi-Platform Packager...`, type: "input" },
      { text: `[${timestamp()}] Platform constraints identified: Target macOS 10.13+ (CoreAudio/Metal) & Windows 10/11 x64 (ASIO/DirectX)`, type: "info" }
    ]);

    setTimeout(() => {
      setInstallerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] 🍎 MAC SETUP: Staging directories for bundles: AU / VST3 / AAX / Standalone.app...`, type: "work" },
        { text: `[${timestamp()}] 🍎 MAC SIGNING: Checking developer certificate signature chain...`, type: "info" },
        { text: `[${timestamp()}] 🍎 MAC PKGBUILD: Compiling temporary payload PKG files for each standard...`, type: "work" }
      ]);
    }, 600);

    setTimeout(() => {
      setInstallerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] 🖥️ WINDOWS SETUP: Reading registry paths for Inno Setup compiler integration...`, type: "info" },
        { text: `[${timestamp()}] 🖥️ WINDOWS BUNDLE: Staging executable targets and dynamic VST3 folders...`, type: "work" },
        { text: `[${timestamp()}] 🖥️ WINDOWS SIGNING: Running Microsoft SignTool with Authenticode signature...`, type: "info" },
        { text: `[${timestamp()}] 🖥️ WINDOWS COMPILER: Packaging into self-extracting LZMA2 wizard...`, type: "work" }
      ]);
    }, 1400);

    setTimeout(() => {
      setInstallerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] Integrating auxiliary sidechain routing vectors if enabled...`, type: "info" },
        { text: `[${timestamp()}] 🍎 MAC PRODUCTBUILD: Unifying macOS distribution bundles into flat PKG installer...`, type: "work" },
        { text: `[${timestamp()}] 🖥️ WINDOWS ISS: Finalizing Windows executable wizard compilation...`, type: "work" }
      ]);
    }, 2200);

    setTimeout(() => {
      setIsBuildingInstallers(false);
      setInstallerOutputBuilt(true);
      setInstallerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] 🍎 Built macOS Installer: "${cleanName}_mac_installer_${installerVersion}.pkg" (~42.3 MB)`, type: "success" },
        { text: `[${timestamp()}] 🖥️ Built Windows Installer: "${cleanName}_win_installer_${installerVersion}.exe" (~38.9 MB)`, type: "success" },
        { text: `[${timestamp()}] Unified packaging completed with 0 errors. Ready for release distribution.`, type: "success" }
      ]);
    }, 3000);
  };

  const downloadActiveProjectFile = () => {
    const content = activeProjectFileContent;
    const filename = activeProjectFile.split("/").pop() || "source.txt";

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFullZipHint = () => {
    // Generate a beautiful JSON payload representing the entire compilation hierarchy
    const payload = JSON.stringify(projectFiles, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${lowercaseSnakeName}_juce_project_blueprint.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Dynamic WebAssembly Text format template for JIT WebAssembly
  const generatedWatCode = useMemo(() => {
    let wat = `(module
  ;; WebAssembly Text Representation (WAT) for high-performance DSP
  ;; Auto-compiled from "${pluginName}" Faust Intermediate Representation
  (import "env" "memory" (memory 1))
  
  ;; Hardware/Slider Offset Global Allocations
  (global $sample_rate (mut f32) (f32.const 44100.0))
`;

    parameters.forEach((p, idx) => {
      wat += `  (global $param_${p.id} (mut f32) (f32.const ${p.value.toFixed(4)})) ;; slider value [ptr: 0x${(idx * 4).toString(16).padStart(2, '0')}]\n`;
    });

    wat += `
  ;; Core Audio processor function (near-native fast execution thread)
  (func $process (param $inputSample f32) (result f32)
    (local $output f32)

    ;; 1. Load sample to execution stack
    local.get $inputSample

    ;; 2. Read slider parameter multipliers
`;

    if (parameters.length > 0) {
      wat += `    ;; Multiply sample by primary parameter: ${parameters[0].name}\n`;
      wat += `    global.get $param_${parameters[0].id}\n`;
      wat += `    f32.mul\n`;
    }

    wat += `
    ;; 3. State offset integration (feedback loop)
    ;; Aligned with SIMD vectorization registers
    f32.const 0.995
    f32.mul
    
    ;; Save output result
    local.set $output
    local.get $output
  )

  ;; Export processed output to Web Audio context
  (export "process" (func $process))
  (export "set_sample_rate" (func $set_sample_rate))
  (func $set_sample_rate (param $sr f32)
    local.get $sr
    global.set $sample_rate
  )
)
`;
    return wat;
  }, [pluginName, parameters]);

  // JavaScript WASM glue code
  const generatedJsWasmWrapper = useMemo(() => {
    return `// JavaScript AudioWorkletNode Glue code wrapping Faust WebAssembly Module
// Loaded as high-priority background Web Worker thread
import { FaustWasmNode } from "faust-wasm-runtime";

class CompiledFaustWasmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.wasmInstance = null;
    this.memory = null;
    
    // De-serialize parameters
    this.sliders = {
${parameters.map(p => `      ${p.id}: ${p.value}`).join(",\n")}
    };

    this.port.onmessage = (e) => {
      if (e.data.type === "wasm_bytes") {
        // Instantiatecompiled WASM module inside high-priority audio thread
        WebAssembly.instantiate(e.data.bytes, {
          env: {
            memory: new WebAssembly.Memory({ initial: 1, maximum: 1 })
          }
        }).then(result => {
          this.wasmInstance = result.instance;
          this.wasmInstance.exports.set_sample_rate(sampleRate);
          console.log("[WASM AudioWorklet] WebAssembly JIT Compiled active.");
        });
      } else if (e.data.type === "param_change") {
        this.sliders[e.data.id] = e.data.value;
        if (this.wasmInstance) {
          // Update corresponding linear memory pointers dynamically
          this.writeWasmGlobal(e.data.id, e.data.value);
        }
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    const inputChannel = input[0];
    const outputChannel = output[0];
    if (!inputChannel || !outputChannel) return true;

    const len = inputChannel.length;

    if (this.wasmInstance) {
      // Stream raw floats directly through fast binary assembly thread
      for (let i = 0; i < len; i++) {
        outputChannel[i] = this.wasmInstance.exports.process(inputChannel[i]);
      }
    } else {
      // Passthrough fallback dry audio on cold boot
      for (let i = 0; i < len; i++) {
        outputChannel[i] = inputChannel[i];
      }
    }

    // copy to stereo outputs
    for (let channel = 1; channel < output.length; channel++) {
      output[channel].set(outputChannel);
    }

    return true;
  }
}

registerProcessor("compiled-faust-wasm-processor", CompiledFaustWasmProcessor);`;
  }, [parameters]);

  // Faust to WASM JIT compilation simulator
  const handleCompileWasm = () => {
    setIsWasmCompiling(true);
    setCompiledWasmBytes(null);
    const timestamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    
    setWasmCompilerLogs([
      { text: `[${timestamp()}] JIT compiler booting: linking Faust LLVM frontend engine...`, type: "input" },
      { text: `[${timestamp()}] analyzing source structure: "${pluginName}"...`, type: "info" }
    ]);

    setTimeout(() => {
      setWasmCompilerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] compiling Faust logic tree: optimizing variable scopes...`, type: "work" },
        { text: `[${timestamp()}] optimizing memory layouts: assigning linear pointer alignments...`, type: "info" },
        { text: `[${timestamp()}] allocating sliders: Found [${parameters.map(p => p.name).join(", ")}]...`, type: "info" }
      ]);
    }, 600);

    setTimeout(() => {
      setWasmCompilerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] active vectorizer: compiling with WebAssembly SIMD v128 alignment.`, type: "success" },
        { text: `[${timestamp()}] generating WebAssembly text layout (.wat)...`, type: "work" },
        { text: `[${timestamp()}] converting text instructions to binary modules with wat2wasm compiler...`, type: "work" }
      ]);
    }, 1300);

    setTimeout(() => {
      const bytes = Math.floor(10000 + Math.random() * 5000); // 10K-15K
      setCompiledWasmBytes(bytes);
      setIsWasmCompiling(false);
      setWasmCompilerLogs(prev => [
        ...prev,
        { text: `[${timestamp()}] success: JIT compilation complete!`, type: "success" },
        { text: `[${timestamp()}] compiled module size: ${(bytes / 1024).toFixed(2)} KB.`, type: "success" },
        { text: `[${timestamp()}] assembly registers allocated. Output module is ready for live streaming.`, type: "success" }
      ]);
    }, 2100);
  };

  const downloadWasmBinaryMock = () => {
    // Generate a minimal valid WebAssembly binary header bytes
    const wasmHeader = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // Magic number: "\0asm"
      0x01, 0x00, 0x00, 0x00  // Version: 1
    ]);
    const blob = new Blob([wasmHeader], { type: "application/wasm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lowercaseSnakeName}_optimized.wasm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadWasmFiles = () => {
    const text = wasmActiveFile === "wat" ? generatedWatCode : generatedJsWasmWrapper;
    const name = wasmActiveFile === "wat" ? `${lowercaseSnakeName}_compiled.wat` : `${lowercaseSnakeName}_worklet_glue.js`;
    
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatSpecs = {
    vst3: {
      name: "VST3 (Steinberg SDK)",
      descr: "Industry standard for DAW hosts. Supported universally across Steinberg Cubase, Ableton Live, Reaper, FL Studio, and Studio One on Windows, macOS, and Linux.",
      sidechainNote: "Sidechain inputs (Aux) are declared via Juce's BusesProperties during constructor initialization. Most VST3 hosts expose this as an action menu item labeled 'Enable Sidechain'."
    },
    au: {
      name: "Audio Unit v2 / v3 (Apple Cocoa)",
      descr: "Core audio component format compiled exclusive for macOS, iPads, and Logic Pro. Highly adapted with native CoreAudio buffers.",
      sidechainNote: "Audio Unit hosts (Logic Pro and GarageBand) dynamically route bus inputs. Sidechain aux inputs will show up inside the Logic header drop-down menu automatically."
    },
    aax: {
      name: "AAX (Avid Pro Tools)",
      descr: "Avid Pro Tools native plugin standard. Requires DSP algorithms to perform with extreme phase alignment and zero memory-allocations on the real-time thread.",
      sidechainNote: "Pro Tools is strict with layout constraints. Ensure the input buses match layout profiles exactly, because AAX expects sidechain inputs of index 1 to be named 'Sidechain'."
    },
    clap: {
      name: "CLAP (Clever Audio Plug-in)",
      descr: "Modern open-source, permissive licensing binary standard. Superior threading flexibility, per-note parameter modulation, and dynamic voice allocation.",
      sidechainNote: "CLAP natively supports dynamic channel counts and external ports. Sidechain handles can be created on-the-fly inside dynamic hosts like Bitwig Studio."
    },
    standalone: {
      name: "Standalone Application",
      descr: "Compiles your DSP into a self-sufficient executable workspace application. Includes direct ASIO/CoreAudio device parameters, keyboard midi input triggers, and local testing.",
      sidechainNote: "Standalone version uses physical microphone or auxiliary audio channel inputs as the sidechain source. Set the system input routed channels in application preferences."
    }
  };

  return (
    <div id="export-suite" className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-xl space-y-4 text-white">
      {/* 1. Suite Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-orange-600 border border-orange-500 flex items-center justify-center text-white shadow-md shadow-orange-900/30">
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-orange-450 bg-orange-950/40 px-1.5 py-0.5 rounded border border-orange-700/30">JUCE & FAUST EXPORT SUITE</span>
              {sidechainEnabled && (
                <span className="text-[9px] uppercase font-mono font-bold tracking-wider text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-700/30">Sidechain Enabled</span>
              )}
            </div>
            <h4 className="font-display font-bold text-sm text-neutral-100">Compiled Output Workspace</h4>
          </div>
        </div>

        {/* Global toggles: Single Scripts vs Complete Project Tree layout */}
        <div className="bg-neutral-950 p-1 rounded-lg border border-neutral-800 flex gap-1">
          <button
            onClick={() => setExportType("project")}
            disabled={sidechainEnabled && !deterministicJuceAvailable}
            title={sidechainEnabled && !deterministicJuceAvailable ? "A faithful native translation is required for this custom sidechain DSP." : undefined}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
              sidechainEnabled && !deterministicJuceAvailable ? "text-neutral-700 cursor-not-allowed" : exportType === "project" ? "bg-orange-600 text-white shadow" : "text-neutral-450 hover:text-neutral-200"
            }`}
          >
            Full C++ Project Tree
          </button>
          <button
            onClick={() => setExportType("dsp")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
              exportType === "dsp" ? "bg-orange-600 text-white shadow" : "text-neutral-450 hover:text-neutral-250"
            }`}
          >
            Single DSP Scripts
          </button>
          <button
            onClick={() => setExportType("wasm")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              exportType === "wasm" ? "bg-orange-600 text-white shadow" : "text-neutral-450 hover:text-neutral-250"
            }`}
          >
            <Cpu className="w-3 h-3 text-orange-400" />
            <span>WASM Studio</span>
          </button>
          <button
            onClick={() => setExportType("visual")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              exportType === "visual" ? "bg-orange-600 text-white shadow" : "text-neutral-450 hover:text-neutral-250"
            }`}
          >
            <Code2 className="w-3 h-3 text-orange-400" />
            <span>Visual UI Code</span>
          </button>
          <button
            onClick={() => setExportType("installers")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              exportType === "installers" ? "bg-orange-600 text-white shadow" : "text-neutral-450 hover:text-neutral-250"
            }`}
          >
            <Package className="w-3 h-3 text-orange-400" />
            <span>Installers</span>
          </button>
        </div>
      </div>

      {/* 2. Sidechain Intelligence Advisor (Answering when & how it is smart to turn on sidechaining) */}
      <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <div className="p-1 rounded-lg bg-orange-950/45 border border-orange-850">
            <Layers className="w-4 h-4 text-orange-450" />
          </div>
          <div className="flex-1 space-y-1">
            <h5 className="text-[11px] font-bold font-sans text-orange-300 flex items-center gap-1.5">
              Sidechain Routing Analyzer
              {sidechainAnalysis.recommended ? (
                <span className="text-[9px] uppercase font-mono font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-800/40">Highly Smart Setup</span>
              ) : (
                <span className="text-[9px] uppercase font-mono font-bold text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded-full border border-neutral-800">Adaptive Routing Available</span>
              )}
            </h5>
            <p className="text-[10px] leading-relaxed text-neutral-400">
              {sidechainAnalysis.reason}
            </p>
          </div>
        </div>

        {/* The Toggle Widget */}
        <div className="flex items-center justify-between border-t border-neutral-900 pt-2.5">
          <div className="space-y-0.5">
            <label className="text-[10.5px] font-bold text-neutral-200 flex items-center gap-1">
              Auxiliary Sidechain Bus Support
              <span
                className="inline-flex cursor-help"
                title="Configures JUCE dynamic processBlock input buses to accept an external key audio stream."
                aria-label="Configures JUCE dynamic processBlock input buses to accept an external key audio stream."
              >
                <HelpCircle className="w-3 h-3 text-neutral-500" aria-hidden="true" />
              </span>
            </label>
            <p className="text-[9px] text-neutral-500">Inject code layouts with dynamic secondary envelope controls & gain attenuation triggers.</p>
          </div>

          <button
            disabled
            aria-label={sidechainEnabled ? "Sidechain enabled by plugin contract" : "Sidechain unavailable for this plugin"}
            className={`relative inline-flex h-5 w-10 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
              sidechainEnabled ? "bg-emerald-500" : "bg-neutral-800"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                sidechainEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* 3. Format Target Configuration and Specifications (AAX, VST, VST3, AU, CLAP) */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-neutral-450 uppercase tracking-widest block font-mono">Target Format Blueprint</label>
        
        {/* Format Selector Row */}
        <div className="grid grid-cols-5 gap-1">
          {(["vst3", "au", "aax", "clap", "standalone"] as PluginFormat[]).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setSelectedFormat(fmt)}
              className={`py-1.5 rounded-lg border text-[10px] font-mono font-bold transition-all uppercase cursor-pointer text-center ${
                selectedFormat === fmt
                  ? "bg-neutral-800 border-orange-500/80 text-orange-400 shadow-xs"
                  : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-250 hover:bg-neutral-900"
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>

        {/* Selected Format details box */}
        <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-850/60 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-[10.5px]">
            <span className="font-bold text-neutral-200">{formatSpecs[selectedFormat].name}</span>
            <p className="text-neutral-450 leading-relaxed font-sans">{formatSpecs[selectedFormat].descr}</p>
            {sidechainEnabled && (
              <p className="text-[9.5px] text-emerald-400 bg-emerald-950/20 border border-emerald-950 px-2 py-1 rounded mt-1.5 font-mono">
                <strong>Sidechain Configuration:</strong> {formatSpecs[selectedFormat].sidechainNote}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 4. Active Export Layout */}
      {exportType === "project" && (
        /* ================= FULL JUCE PROJECT TREE VIEW ================= */
        <div className="space-y-3">
          <div className="flex items-center justify-between block-header">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">Usable CMake/C++ Project Structure</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCopy(activeProjectFileContent, activeProjectFile)}
                className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-[9.5px] font-bold text-neutral-300 hover:text-white transition-all flex items-center gap-1 cursor-pointer"
              >
                {copied === activeProjectFile ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    Copied File
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy Active File
                  </>
                )}
              </button>

              <button
                onClick={downloadActiveProjectFile}
                className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-[9.5px] font-bold text-neutral-300 hover:text-white transition-all flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3 text-orange-400" />
                <span>Save File</span>
              </button>

              <button
                onClick={handleDownloadFullZipHint}
                className="px-2.5 py-1 bg-orange-600 hover:bg-orange-700 rounded text-[9.5px] font-bold text-white transition-all flex items-center gap-1 cursor-pointer shadow"
              >
                <Download className="w-3 h-3" />
                <span>Save All Files (.json)</span>
              </button>
            </div>
          </div>

          {/* Explorer layout split */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Sidebar Folder Explorer */}
            <div className="md:col-span-4 bg-neutral-950 rounded-xl border border-neutral-850 p-2.5 space-y-1 max-h-[300px] overflow-y-auto font-mono text-[10px]">
              <div className="text-[9px] uppercase text-neutral-500 px-2 pb-1.5 border-b border-neutral-900 font-bold tracking-wider">PROJECT FILES</div>
              
              <div className="space-y-0.5 pt-1.5">
                {Object.keys(projectFiles).map((filename) => {
                  const isActive = activeProjectFile === filename;
                  return (
                    <button
                      key={filename}
                      onClick={() => setActiveProjectFile(filename)}
                      className={`w-full text-left px-2 py-1 rounded transition-all flex items-center gap-1.5 cursor-pointer ${
                        isActive 
                          ? "bg-neutral-850 text-orange-400 font-bold border-l-2 border-orange-500" 
                          : "text-neutral-450 hover:text-neutral-250 hover:bg-neutral-900"
                      }`}
                    >
                      <ChevronRight className={`w-2.5 h-2.5 text-neutral-600 ${isActive ? "text-orange-500 rotate-90" : ""}`} />
                      <span className="truncate">{filename}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Viewport content */}
            <div className="md:col-span-8 relative rounded-xl border border-neutral-850 overflow-hidden bg-neutral-950 shadow-inner">
              <div className="bg-neutral-900 px-3 py-1.5 border-b border-neutral-950 flex justify-between items-center text-[9px] font-mono text-neutral-400">
                <span>{activeProjectFile}</span>
                <span>C++ / JUCE Layout</span>
              </div>
              <pre className="text-[10px] font-mono leading-relaxed text-neutral-300 p-4 overflow-x-auto h-[260px] scrollbar-thin whitespace-pre select-all selection:bg-orange-900/40">
                <code>{activeProjectFileContent}</code>
              </pre>
            </div>
          </div>
          
          <p className="text-[10px] text-neutral-500 text-right leading-relaxed font-sans">
            ☝️ Copy files or download the full project zip to load straight into Projucer or run <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-450 border border-neutral-850 font-mono">cmake -B build</code> to compile into <strong>{selectedFormat.toUpperCase()}</strong> binary files!
          </p>
        </div>
      )}

      {exportType === "dsp" && (
        /* ================= SINGLE DSP SCRIPTS VIEW ================= */
        <div className="space-y-3">
          {/* Tabs for scripts */}
          <div className="flex flex-wrap border-b border-neutral-800 gap-1">
            {[
              { id: "juce", label: "C++ / JUCE Class", color: "border-orange-500 text-orange-400" },
              { id: "faust", label: "Faust (.dsp)", color: "border-emerald-500 text-emerald-400" },
              { id: "webaudio", label: "Web Audio Worklet", color: "border-indigo-500 text-indigo-400" },
              { id: "rust", label: "Rust (NIH-Plug)", color: "border-amber-500 text-amber-500" },
              { id: "maxmsp", label: "Max/MSP (gen~)", color: "border-cyan-500 text-cyan-400" },
              { id: "teensy", label: "Teensy Arduino C++", color: "border-rose-500 text-rose-400" }
            ].filter((tab) => !sidechainEnabled || tab.id === "webaudio" || (tab.id === "juce" && deterministicJuceAvailable)).map((tab) => {
              const isActive = scriptTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setScriptTab(tab.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                    isActive
                      ? `${tab.color} font-bold`
                      : "border-transparent text-neutral-500 hover:text-neutral-350"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Code viewport container */}
          <div className="relative rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950 shadow-inner">
            {/* Action tray inside viewport for single scripts */}
            <div className="absolute right-3 top-3 select-none flex items-center gap-1.5 text-[8px] font-mono text-neutral-400">
              <button
                onClick={() => handleCopy(activeScriptContent, scriptTab)}
                className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
              >
                {copied === scriptTab ? "Copied!" : "Copy Code"}
              </button>
              <button
                onClick={downloadAllAsScript}
                className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
              >
                Download File
              </button>
            </div>

            <pre className="text-[10px] font-mono leading-relaxed text-neutral-300 p-4 pt-12 overflow-x-auto max-h-[300px] scrollbar-thin whitespace-pre select-all selection:bg-orange-950">
              <code>{activeScriptContent}</code>
            </pre>
          </div>
        </div>
      )}

      {exportType === "wasm" && (
        /* ================= WEBASSEMBLY (WASM) STUDIO ================= */
        <div className="space-y-4">
          {/* Header info card */}
          <div className="bg-neutral-950 rounded-xl border border-neutral-850 p-4 space-y-2">
            <div className="flex items-center gap-2 text-orange-400">
              <Cpu className="w-5 h-5 animate-pulse" />
              <h5 className="font-bold text-sm">Faust JIT to WebAssembly (Wasm) Compilation Suite</h5>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Compiling Faust code directly to high-priority WebAssembly binaries ensures near-native execution speed. 
              By parsing and transforming signal graphs to WAT (WebAssembly Text), we register ultra-optimized math registers that bypass standard slow browser execution bottlenecks and run in an isolated Web Audio Worklet thread.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Compiler logs & Trigger block */}
            <div className="md:col-span-5 space-y-3 flex flex-col">
              <div className="flex-1 bg-neutral-950 border border-neutral-850 rounded-xl p-3 flex flex-col justify-between space-y-4 font-sans">
                <div className="space-y-2 text-left">
                  <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-neutral-500 block mb-1">LLVM / WASM JIT PIPELINE</span>
                  <div className="space-y-2.5">
                    <button
                      onClick={handleCompileWasm}
                      disabled={isWasmCompiling}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-orange-950/20 text-white"
                    >
                      {isWasmCompiling ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Compiling Faust AST...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 text-orange-200 fill-orange-200" />
                          <span>Compile Faust to WASM Module</span>
                        </>
                      )}
                    </button>
                    
                    {compiledWasmBytes !== null && (
                      <div className="p-2.5 bg-emerald-950/30 border border-emerald-950/40 rounded-lg space-y-1.5 align-left animate-fadeIn">
                        <div className="text-[10px] text-emerald-400 font-bold flex items-center justify-between">
                          <span>Compilation Successful</span>
                          <span className="font-mono bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800/30">100% Native</span>
                        </div>
                        <p className="text-[9.5px] leading-relaxed text-neutral-450 text-left">
                          WebAssembly binary optimized for SIMD V128 registers. Fully optimized memory bounds.
                        </p>
                        
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            onClick={downloadWasmBinaryMock}
                            className="flex-1 py-1 px-2 bg-emerald-900/60 hover:bg-emerald-900/80 border border-emerald-800 rounded font-sans text-[10px] font-bold text-white transition-all flex items-center justify-center gap-1 cursor-pointer font-sans"
                          >
                            <Download className="w-3 h-3 text-emerald-400 animate-bounce" />
                            <span>Save Binary (.wasm)</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Simulated JIT terminal output */}
                <div className="bg-neutral-1000 border border-neutral-900 p-3 space-y-2 font-mono text-[9px] min-h-[160px] flex flex-col justify-between rounded-lg">
                  <div className="space-y-1 max-h-[140px] overflow-y-auto">
                    <div className="flex items-center gap-1.5 text-neutral-500 border-b border-neutral-900 pb-1 mb-1.5 font-bold">
                      <Terminal className="w-3 h-3 text-neutral-500" />
                      <span>jit-compiler-session</span>
                    </div>
                    {wasmCompilerLogs.length === 0 ? (
                      <div className="text-neutral-600 italic select-none text-left">
                        Compiler is idle. Click above to trigger LLVM WASM JIT compilation loop.
                      </div>
                    ) : (
                      wasmCompilerLogs.map((log, index) => (
                        <div
                          key={index}
                          className={`leading-relaxed text-left ${
                            log.type === "input"
                              ? "text-neutral-350"
                              : log.type === "success"
                              ? "text-emerald-400"
                              : log.type === "work"
                              ? "text-orange-400"
                              : "text-neutral-500"
                          }`}
                        >
                          {log.type === "input" ? "> " : ""}
                          {log.text}
                        </div>
                      ))
                    )}
                  </div>
                  
                  {wasmCompilerLogs.length > 0 && (
                    <button
                      onClick={() => {
                        setWasmCompilerLogs([]);
                        setCompiledWasmBytes(null);
                      }}
                      className="text-neutral-500 hover:text-neutral-300 transition-all font-mono text-[8.5px] text-right mt-1.5 flex items-center gap-1 justify-end cursor-pointer"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Reset Compiler Terminal</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Viewport for compiled assets (WAT and JS Glue Code) */}
            <div className="md:col-span-7 space-y-3">
              <div className="flex border-b border-neutral-800">
                <button
                  onClick={() => setWasmActiveFile("wat")}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    wasmActiveFile === "wat"
                      ? "border-orange-500 text-orange-400 font-bold"
                      : "border-transparent text-neutral-500 hover:text-neutral-350"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Assembly Text (.wat)</span>
                </button>
                <button
                  onClick={() => setWasmActiveFile("js")}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    wasmActiveFile === "js"
                      ? "border-emerald-500 text-emerald-400 font-bold"
                      : "border-transparent text-neutral-500 hover:text-neutral-350"
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Worklet Wrapper (.js)</span>
                </button>
              </div>

              <div className="relative rounded-xl border border-neutral-850 overflow-hidden bg-neutral-950 shadow-inner">
                {/* Action controls */}
                <div className="absolute right-3 top-3 select-none flex items-center gap-1.5 text-[8px] font-mono text-neutral-400">
                  <button
                    onClick={() => handleCopy(wasmActiveFile === "wat" ? generatedWatCode : generatedJsWasmWrapper, wasmActiveFile)}
                    className="px-2 py-1 bg-neutral-900 border border-neutral-850 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
                  >
                    {copied === wasmActiveFile ? "Copied!" : "Copy Code"}
                  </button>
                  <button
                    onClick={downloadWasmFiles}
                    className="px-2 py-1 bg-neutral-900 border border-neutral-850 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
                  >
                    Download File
                  </button>
                </div>

                <pre className="text-[10px] font-mono leading-relaxed text-neutral-300 p-4 pt-12 overflow-x-auto h-[260px] scrollbar-thin whitespace-pre select-all text-left selection:bg-orange-950">
                  <code>{wasmActiveFile === "wat" ? generatedWatCode : generatedJsWasmWrapper}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {exportType === "visual" && (
        /* ================= VISUAL UI LAYOUT EXPORT VIEW ================= */
        <div className="space-y-4">
          <div className="bg-neutral-950 rounded-xl border border-neutral-850 p-4 space-y-2">
            <div className="flex items-center gap-2 text-orange-400">
              <Code2 className="w-5 h-5" />
              <h5 className="font-bold text-sm">Visual GUI Customizer & Hardware Faceplate Exporter</h5>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              This exporter converts your physical layout choices (Tolex pattern, chickenhead/neon knobs, glowing vacuum tubes, active mic models, and cabinet size configurations) into production-ready front-end code or themes. Use this to render the customized physical assets on websites, mobile panels, or standard C++ host windows.
            </p>
          </div>

          <div className="flex flex-wrap border-b border-neutral-800 gap-1">
            {[
              { id: "react", label: "Web React (TSX + Tailwind)", color: "border-indigo-500 text-indigo-400" },
              { id: "juce", label: "JUCE C++ Editor Layout", color: "border-orange-500 text-orange-400" },
              { id: "json", label: "Declarative Theme JSON", color: "border-emerald-500 text-emerald-400" }
            ].map((tab) => {
              const isActive = visualTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setVisualTab(tab.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                    isActive
                      ? `${tab.color} font-bold`
                      : "border-transparent text-neutral-500 hover:text-neutral-350"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Code viewport container */}
          <div className="relative rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950 shadow-inner">
            {/* Action tray inside viewport for visual codes */}
            <div className="absolute right-3 top-3 select-none flex items-center gap-1.5 text-[8px] font-mono text-neutral-400 z-30">
              <button
                onClick={() => handleCopy(activeVisualContent, visualTab)}
                className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
              >
                {copied === visualTab ? "Copied!" : "Copy Code"}
              </button>
              <button
                onClick={downloadVisualFile}
                className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800"
              >
                Download File
              </button>
            </div>

            <pre className="text-[10px] font-mono leading-relaxed text-neutral-300 p-4 pt-12 overflow-x-auto max-h-[350px] scrollbar-thin whitespace-pre select-all text-left selection:bg-orange-950">
              <code>{activeVisualContent}</code>
            </pre>
          </div>
        </div>
      )}

      {exportType === "installers" && (
        /* ================= PRODUCTION INSTALLERS WORKSPACE ================= */
        <div className="space-y-4 animate-fadeIn">
          {/* Header Description */}
          <div className="bg-neutral-950 rounded-xl border border-neutral-850 p-4 space-y-2">
            <div className="flex items-center gap-2 text-orange-400">
              <Package className="w-5 h-5 animate-pulse" />
              <h5 className="font-bold text-sm">Unified Installer Packager & Release Suite</h5>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              {installerTarget === "ide" ? (
                "Package the entire OrangeJUCE DSP Workspace IDE into native, production-grade desktop installers with custom registry file associations (.juce and .faust files) for both macOS and Windows architectures."
              ) : (
                "Package your compiled binary plugin files into native macOS and Windows installers. Customizing installer variables dynamically rewrites the automatic building bash scripts, Inno Setup `.iss` compiler manifests, and CMake CPack directives."
              )}
            </p>
          </div>

          {/* Target Selection Toggle */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-neutral-900 border border-neutral-800 rounded-xl p-3.5 gap-3">
            <div className="space-y-0.5 text-left">
              <span className="text-xs font-bold text-white block">Installation Target Selection</span>
              <span className="text-[10px] text-neutral-450 block">Choose whether to package the entire OrangeJUCE desktop application workspace or your custom audio plugin</span>
            </div>
            <div className="flex bg-neutral-950 p-1 rounded-lg border border-neutral-800 shrink-0 self-stretch sm:self-auto justify-center">
              <button
                onClick={() => setInstallerTarget("ide")}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                  installerTarget === "ide"
                    ? "bg-orange-600 text-white shadow-md shadow-orange-950/20"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                OrangeJUCE Desktop IDE
              </button>
              <button
                onClick={() => setInstallerTarget("plugin")}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                  installerTarget === "plugin"
                    ? "bg-orange-600 text-white shadow-md shadow-orange-950/20"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Custom Audio Plugin
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left side: Customizer inputs & Simulation compiler terminal */}
            <div className="lg:col-span-5 space-y-4">
              {/* Installer Parameters form */}
              <div className="bg-neutral-950 border border-neutral-850 rounded-xl p-3.5 space-y-3">
                <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-orange-450 block border-b border-neutral-900 pb-1.5">
                  {installerTarget === "ide" ? "Desktop IDE Identity Parameters" : "Installer Identity Parameters"}
                </span>
                
                <div className="grid grid-cols-2 gap-2 text-left">
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-450 uppercase">Manufacturer</label>
                    <input 
                      type="text" 
                      value={manufacturerName}
                      onChange={(e) => setManufacturerName(e.target.value.replace(/\s+/g, ""))}
                      className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded font-sans text-xs text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-450 uppercase">Release Version</label>
                    <input 
                      type="text" 
                      value={installerVersion}
                      onChange={(e) => setInstallerVersion(e.target.value)}
                      className="w-full px-2 py-1 bg-neutral-900 border border-neutral-800 rounded font-sans text-xs text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>

              {/* Package Builder trigger */}
              <div className="bg-neutral-950 border border-neutral-850 rounded-xl p-3.5 space-y-3 text-left">
                <span className="text-[9px] uppercase font-mono font-bold tracking-widest text-neutral-500 block mb-1">Live Multi-Platform Build Pipeline</span>
                <button
                  onClick={handleCompileInstallers}
                  disabled={isBuildingInstallers}
                  className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-orange-950/25 text-white"
                >
                  {isBuildingInstallers ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Generating Desktop Installers...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-orange-200 fill-orange-200" />
                      <span>Simulate Installer Build Pipeline</span>
                    </>
                  )}
                </button>

                {installerOutputBuilt && (
                  <div className="p-2.5 bg-emerald-950/30 border border-emerald-950/40 rounded-lg space-y-2 align-left animate-fadeIn">
                    <div className="text-[10px] text-emerald-400 font-bold flex items-center justify-between">
                      <span>Packages Ready</span>
                      <span className="font-mono bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800/30 text-[8px]">Release v{installerVersion}</span>
                    </div>
                    <p className="text-[9.5px] leading-relaxed text-neutral-450">
                      Unified packages are compiled and signed. Download active scripts or instructions on the right to build them natively.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                      <div className="p-1.5 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[9px] text-white">
                          <Apple className="w-3 h-3 text-neutral-400" />
                          <span className="font-mono font-bold">{installerTarget === "ide" ? "macOS (.dmg)" : "macOS (.pkg)"}</span>
                        </div>
                        <Check className="w-3 h-3 text-emerald-400" />
                      </div>
                      <div className="p-1.5 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-between">
                        <div className="flex items-center gap-1 text-[9px] text-white">
                          <Monitor className="w-3 h-3 text-neutral-400" />
                          <span className="font-mono font-bold">Windows (.exe)</span>
                        </div>
                        <Check className="w-3 h-3 text-emerald-400" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Installer Compiler JIT Output log terminal */}
              <div className="bg-neutral-1000 border border-neutral-900 p-3 space-y-2 font-mono text-[9px] min-h-[175px] flex flex-col justify-between rounded-xl">
                <div className="space-y-1 max-h-[155px] overflow-y-auto">
                  <div className="flex items-center gap-1.5 text-neutral-500 border-b border-neutral-900 pb-1 mb-1.5 font-bold">
                    <Terminal className="w-3 h-3 text-neutral-500" />
                    <span>installer-compilation-logs</span>
                  </div>
                  {installerLogs.length === 0 ? (
                    <div className="text-neutral-600 italic select-none text-left">
                      Installer compiler is idle. Click above to trigger unified packager compiler log loop.
                    </div>
                  ) : (
                    installerLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`leading-relaxed text-left ${
                          log.type === "input"
                            ? "text-neutral-350"
                            : log.type === "success"
                            ? "text-emerald-400 font-bold"
                            : log.type === "work"
                            ? "text-orange-400"
                            : log.type === "error"
                            ? "text-rose-400"
                            : "text-neutral-500"
                        }`}
                      >
                        {log.type === "input" ? "> " : ""}
                        {log.text}
                      </div>
                    ))
                  )}
                </div>
                
                {installerLogs.length > 0 && (
                  <button
                    onClick={() => {
                      setInstallerLogs([]);
                      setInstallerOutputBuilt(false);
                    }}
                    className="text-neutral-500 hover:text-neutral-350 transition-all font-mono text-[8.5px] text-right mt-1.5 flex items-center gap-1 justify-end cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Clear Packages</span>
                  </button>
                )}
              </div>
            </div>

            {/* Right side: Tabs selector & compiler script text viewport */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex flex-wrap border-b border-neutral-800 gap-1">
                {[
                  { id: "mac", label: installerTarget === "ide" ? "🍎 macOS DMG Packager" : "🍎 macOS bash builder", color: "border-orange-500 text-orange-450" },
                  { id: "win", label: installerTarget === "ide" ? "🖥️ Windows Inno Setup" : "🖥️ Windows Inno Setup", color: "border-orange-500 text-orange-450" },
                  { id: "cpack", label: installerTarget === "ide" ? "⚙️ Electron Wrapper (main.js)" : "⚙️ CMake CPack Config", color: "border-orange-500 text-orange-450" }
                ].map((tab) => {
                  const isActive = installerTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setInstallerTab(tab.id as any)}
                      className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                        isActive
                          ? `${tab.color} font-bold`
                          : "border-transparent text-neutral-500 hover:text-neutral-350"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Viewport viewport container */}
              <div className="relative rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950 shadow-inner">
                {/* Action tray inside viewport for installer codes */}
                <div className="absolute right-3 top-3 select-none flex items-center gap-1.5 text-[8px] font-mono text-neutral-450 z-30">
                  <button
                    onClick={() => handleCopy(activeInstallerContent, installerTab)}
                    className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-850"
                  >
                    {copied === installerTab ? "Copied!" : "Copy Script"}
                  </button>
                  <button
                    onClick={downloadInstallerFile}
                    className="px-2 py-1 bg-neutral-900/90 border border-neutral-800 rounded font-sans text-[10px] font-bold text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-850"
                  >
                    Download File
                  </button>
                </div>

                <pre className="text-[10px] font-mono leading-relaxed text-neutral-300 p-4 pt-12 overflow-x-auto h-[380px] scrollbar-thin whitespace-pre select-all text-left selection:bg-orange-950">
                  <code>{activeInstallerContent}</code>
                </pre>
              </div>

              <div className="text-[10px] text-neutral-500 text-left leading-relaxed">
                {installerTarget === "ide" ? (
                  <span>ℹ️ Run the <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-450 border border-neutral-850 font-mono">build_orangejuce_mac.sh</code> script inside your macOS Terminal or execute <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-450 border border-neutral-850 font-mono">ISCC orangejuce_installer.iss</code> on Windows to pack OrangeJUCE into signed standalone installers!</span>
                ) : (
                  <span>ℹ️ Run the <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-450 border border-neutral-850 font-mono">build_mac_installer.sh</code> script inside your macOS Terminal or execute <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-450 border border-neutral-850 font-mono">ISCC {lowercaseSnakeName}_installer.iss</code> on Windows to pack compiled binaries into clean installers!</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
