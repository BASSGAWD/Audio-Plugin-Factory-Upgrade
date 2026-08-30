import { CanvasNode, PluginParameter, AudioPlugin } from "../types";

export function compileCanvasToPlugin(
  pluginName: string,
  category: any,
  description: string,
  nodes: CanvasNode[]
): AudioPlugin {
  // 1. Gather all required active parameters based on nodes
  const parameters: PluginParameter[] = [];
  const paramMap = new Set<string>();

  const activeNodes = nodes.filter((n) => n.active);

  // Default definitions helper
  const addParam = (id: string, name: string, min: number, max: number, defVal: number, unit: string) => {
    if (!paramMap.has(id)) {
      paramMap.add(id);
      parameters.push({
        id,
        name,
        min,
        max,
        defaultValue: defVal,
        value: defVal,
        unit,
      });
    }
  };

  // Traversal to establish metadata parameters
  activeNodes.forEach((node) => {
    if (node.type === "gain") {
      addParam("volume", "Output Volume", 0.0, 1.5, node.settings.volume ?? 0.8, "x");
    } else if (node.type === "saturator") {
      addParam("drive", "Drive Boost", 1.0, 15.0, node.settings.drive ?? 3.5, "x");
      addParam("bias", "Saturator Bias", -0.5, 0.5, node.settings.bias ?? 0.0, "V");
    } else if (node.type === "ladder_filter") {
      addParam("cutoff", "Cutoff Freq", 80.0, 12000.0, node.settings.cutoff ?? 2000.0, "Hz");
      addParam("resonance", "Resonance Q", 0.0, 0.95, node.settings.resonance ?? 0.3, "%");
    } else if (node.type === "comb_delay") {
      addParam("delayTime", "Delay Time", 10.0, 1000.0, node.settings.time ?? 250.0, "ms");
      addParam("feedback", "Delay Feedback", 0.0, 0.95, node.settings.feedback ?? 0.4, "%");
    } else if (node.type === "tremolo") {
      addParam("tremoloRate", "LV-Tremolo Rate", 0.1, 15.0, node.settings.rate ?? 6.0, "Hz");
      addParam("tremoloDepth", "LV-Tremolo Depth", 0.0, 1.0, node.settings.depth ?? 0.5, "%");
    } else if (node.type === "chorus") {
      addParam("chorusRate", "Chorus Rate", 0.1, 5.0, node.settings.rate ?? 1.5, "Hz");
      addParam("chorusDepth", "Chorus Delay Dev", 1.0, 15.0, node.settings.depth ?? 4.0, "ms");
    }
  });

  // ---- II. JS DSP Function Assembly ----
  let jsBody = `// Autonomous DSP Signal Streamcompiled via Canvas-to-Code Panel\n`;
  jsBody += `let currentSample = inputSample;\n\n`;

  activeNodes.forEach((node) => {
    jsBody += `// --- Node Block: ${node.title} ---\n{\n`;
    if (node.type === "gain") {
      jsBody += `  let volume = params.volume !== undefined ? params.volume : 0.8;\n`;
      jsBody += `  currentSample = currentSample * volume;\n`;
    } else if (node.type === "saturator") {
      jsBody += `  let drive = params.drive !== undefined ? params.drive : 3.5;\n`;
      jsBody += `  let bias = params.bias !== undefined ? params.bias : 0.0;\n`;
      jsBody += `  currentSample = Math.tanh((currentSample + bias) * drive);\n`;
    } else if (node.type === "ladder_filter") {
      jsBody += `  if (!state.lp_y1) {\n`;
      jsBody += `    state.lp_y1 = 0.0;\n`;
      jsBody += `    state.lp_y2 = 0.0;\n`;
      jsBody += `  }\n`;
      jsBody += `  let cutoff = params.cutoff !== undefined ? params.cutoff : 2000.0;\n`;
      jsBody += `  let r = params.resonance !== undefined ? params.resonance : 0.3;\n`;
      jsBody += `  let f = (2 * Math.PI * cutoff) / 44100.0;\n`;
      jsBody += `  let q = 1.0 - f;\n`;
      jsBody += `  let fb = r * 4.0;\n`;
      jsBody += `  let inputWithRes = currentSample - (state.lp_y2 * fb);\n`;
      jsBody += `  state.lp_y1 = (state.lp_y1 * q) + (inputWithRes * f);\n`;
      jsBody += `  state.lp_y2 = (state.lp_y2 * q) + (state.lp_y1 * f);\n`;
      jsBody += `  currentSample = state.lp_y2;\n`;
    } else if (node.type === "comb_delay") {
      jsBody += `  if (!state.delayLine) {\n`;
      jsBody += `    state.delayLine = new Float32Array(44100 * 2);\n`;
      jsBody += `    state.writePtr = 0;\n`;
      jsBody += `  }\n`;
      jsBody += `  let delayTimeMs = params.delayTime !== undefined ? params.delayTime : 250.0;\n`;
      jsBody += `  let feedback = params.feedback !== undefined ? params.feedback : 0.4;\n`;
      jsBody += `  let delaySamples = Math.floor((delayTimeMs / 1000.0) * 44100);\n`;
      jsBody += `  let readPtr = state.writePtr - delaySamples;\n`;
      jsBody += `  if (readPtr < 0) readPtr += state.delayLine.length;\n`;
      jsBody += `  let echoed = state.delayLine[readPtr] || 0.0;\n`;
      jsBody += `  state.delayLine[state.writePtr] = currentSample + (echoed * feedback);\n`;
      jsBody += `  state.writePtr = (state.writePtr + 1) % state.delayLine.length;\n`;
      jsBody += `  currentSample = (currentSample * 0.7) + (echoed * 0.3);\n`;
    } else if (node.type === "tremolo") {
      jsBody += `  if (!state.tremolo_phase) {\n`;
      jsBody += `    state.tremolo_phase = 0.0;\n`;
      jsBody += `  }\n`;
      jsBody += `  let tremRate = params.tremoloRate !== undefined ? params.tremoloRate : 6.0;\n`;
      jsBody += `  let tremDepth = params.tremoloDepth !== undefined ? params.tremoloDepth : 0.5;\n`;
      jsBody += `  state.tremolo_phase += (2 * Math.PI * tremRate) / 44100.0;\n`;
      jsBody += `  if (state.tremolo_phase > 2 * Math.PI) state.tremolo_phase -= 2 * Math.PI;\n`;
      jsBody += `  let tremMod = 1.0 - (((Math.sin(state.tremolo_phase) + 1.0) * 0.5) * tremDepth);\n`;
      jsBody += `  currentSample = currentSample * tremMod;\n`;
    } else if (node.type === "chorus") {
      jsBody += `  if (!state.chorusLine) {\n`;
      jsBody += `    state.chorusLine = new Float32Array(44100);\n`;
      jsBody += `    state.chorusPtr = 0;\n`;
      jsBody += `    state.chorusPhase = 0.0;\n`;
      jsBody += `  }\n`;
      jsBody += `  state.chorusLine[state.chorusPtr] = currentSample;\n`;
      jsBody += `  let chRate = params.chorusRate !== undefined ? params.chorusRate : 1.5;\n`;
      jsBody += `  let chDepth = params.chorusDepth !== undefined ? params.chorusDepth : 4.0;\n`;
      jsBody += `  state.chorusPhase += (2 * Math.PI * chRate) / 44100.0;\n`;
      jsBody += `  let lfoVal = Math.sin(state.chorusPhase);\n`;
      jsBody += `  let targetDelay = 200.0 + (lfoVal * chDepth);\n`;
      jsBody += `  let chorRead = state.chorusPtr - Math.floor(targetDelay);\n`;
      jsBody += `  if (chorRead < 0) chorRead += state.chorusLine.length;\n`;
      jsBody += `  let chorSample = state.chorusLine[chorRead] || 0.0;\n`;
      jsBody += `  state.chorusPtr = (state.chorusPtr + 1) % state.chorusLine.length;\n`;
      jsBody += `  currentSample = (currentSample * 0.65) + (chorSample * 0.35);\n`;
    }
    jsBody += `}\n\n`;
  });

  jsBody += `return currentSample;`;

  // ---- III. Faust DSL Transpiler Assembly ----
  let faust = `declare name "${pluginName}";\n`;
  faust += `declare description "Modular Canvas Compiled Chain: ${description}";\n\n`;
  faust += `import("stdfaust.lib");\n\n`;

  // Append slider controls based on metadata parameters of compile
  parameters.forEach((p) => {
    faust += `${p.id} = hslider("${p.name}", ${p.defaultValue}, ${p.min}, ${p.max}, ${p.id.includes("cutoff") ? "1.0" : "0.01"});\n`;
  });

  faust += `\n`;

  // Module functional blocks in Faust
  let processChain = "process = ";
  let hasPreOutputBlock = false;

  activeNodes.forEach((node, idx) => {
    if (node.type === "gain") {
      faust += `gainEffect(x) = x * volume;\n`;
      processChain += (idx === 0 ? "" : " : ") + `gainEffect`;
      hasPreOutputBlock = true;
    } else if (node.type === "saturator") {
      faust += `saturator(x) = ma.tanh((x + bias) * drive);\n`;
      processChain += (idx === 0 ? "" : " : ") + `saturator`;
      hasPreOutputBlock = true;
    } else if (node.type === "ladder_filter") {
      faust += `ladderFilter(x) = x : fi.resonlp(cutoff, resonanceQ, 1.0) with {\n`;
      faust += `    resonanceQ = resonance * 10.0 + 0.1;\n`;
      faust += `};\n`;
      processChain += (idx === 0 ? "" : " : ") + `ladderFilter`;
      hasPreOutputBlock = true;
    } else if (node.type === "comb_delay") {
      faust += `delayLine(x) = x : + ~ *(feedback) : de.delay(44100 * 2, delaySamples) with {\n`;
      faust += `    delaySamples = delayTime / 1000.0 * 44100 : int;\n`;
      faust += `};\n`;
      faust += `delayMix(x) = (x * 0.7) + (delayLine(x) * 0.3);\n`;
      processChain += (idx === 0 ? "" : " : ") + `delayMix`;
      hasPreOutputBlock = true;
    } else if (node.type === "tremolo") {
      faust += `tremolo(x) = x * (1.0 - (oscPhase * tremoloDepth)) with {\n`;
      faust += `    oscPhase = (os.osc(tremoloRate) + 1.0) * 0.5;\n`;
      faust += `};\n`;
      processChain += (idx === 0 ? "" : " : ") + `tremolo`;
      hasPreOutputBlock = true;
    } else if (node.type === "chorus") {
      faust += `chorusCell(x) = (x * 0.65) + (de.delay(44100, MathDelay, x) * 0.35) with {\n`;
      faust += `    MathDelay = 200.0 + (os.osc(chorusRate) * chorusDepth);\n`;
      faust += `};\n`;
      processChain += (idx === 0 ? "" : " : ") + `chorusCell`;
      hasPreOutputBlock = true;
    }
  });

  if (!hasPreOutputBlock) {
    processChain += "_"; // identity wire
  }
  processChain += ";";
  faust += `\n${processChain}`;

  // ---- IV. JUCE C++ Engine Block ----
  const className = pluginName.trim().replace(/\s+/g, "");
  let cpp = `/*\n  ==============================================================================\n    ${className}DSP.h\n    Autonomous Canvas-to-Code Compiler Auto-generated Class\n  ==============================================================================\n*/\n\n`;
  cpp += `#pragma once\n#include <JuceHeader.h>\n#include <cmath>\n\n`;
  cpp += `class ${className}DSP\n{\npublic:\n`;
  cpp += `    ${className}DSP() {}\n`;
  cpp += `    ~${className}DSP() {}\n\n`;

  // prepareToPlay
  cpp += `    void prepareToPlay (double sampleRate, int samplesPerBlock)\n    {\n`;
  cpp += `        mSampleRate = sampleRate;\n`;
  
  if (activeNodes.some((n) => n.type === "comb_delay")) {
    cpp += `        mDelayBuffer.setSize (1, (int)(sampleRate * 2.0));\n`;
    cpp += `        mDelayBuffer.clear();\n`;
    cpp += `        mDelayWriteHead = 0;\n`;
  }
  if (activeNodes.some((n) => n.type === "chorus")) {
    cpp += `        mChorusBuffer.setSize (1, (int)(sampleRate * 1.0));\n`;
    cpp += `        mChorusBuffer.clear();\n`;
    cpp += `        mChorusWriteHead = 0;\n`;
    cpp += `        mChorusPhase = 0.0f;\n`;
  }
  if (activeNodes.some((n) => n.type === "ladder_filter")) {
    cpp += `        mFilterY1 = 0.0f;\n`;
    cpp += `        mFilterY2 = 0.0f;\n`;
  }
  if (activeNodes.some((n) => n.type === "tremolo")) {
    cpp += `        mTremoloPhase = 0.0f;\n`;
  }
  cpp += `    }\n\n`;

  // Set parameters method
  cpp += `    void updateParameters (\n`;
  const paramDecls = parameters.map((p) => `        float ${p.id}Val`).join(",\n");
  cpp += paramDecls + `)\n    {\n`;
  parameters.forEach((p) => {
    cpp += `        m_${p.id} = ${p.id}Val;\n`;
  });
  cpp += `    }\n\n`;

  // processSample loop
  cpp += `    float processSample (float inputSample)\n    {\n`;
  cpp += `        float currentSample = inputSample;\n\n`;

  activeNodes.forEach((node) => {
    cpp += `        // --- ${node.title} ---\n`;
    if (node.type === "gain") {
      cpp += `        currentSample = currentSample * m_volume;\n\n`;
    } else if (node.type === "saturator") {
      cpp += `        currentSample = std::tanh((currentSample + m_bias) * m_drive);\n\n`;
    } else if (node.type === "ladder_filter") {
      cpp += `        float f = (2.0f * (float)M_PI * m_cutoff) / (float)mSampleRate;\n`;
      cpp += `        float q = 1.0f - f;\n`;
      cpp += `        float fb = m_resonance * 4.0f;\n`;
      cpp += `        float filterInput = currentSample - (mFilterY2 * fb);\n`;
      cpp += `        mFilterY1 = (mFilterY1 * q) + (filterInput * f);\n`;
      cpp += `        mFilterY2 = (mFilterY2 * q) + (mFilterY1 * f);\n`;
      cpp += `        currentSample = mFilterY2;\n\n`;
    } else if (node.type === "comb_delay") {
      cpp += `        int delaySamples = (int)((m_delayTime / 1000.0f) * mSampleRate);\n`;
      cpp += `        int delayBufferLength = mDelayBuffer.getNumSamples();\n`;
      cpp += `        int readHead = mDelayWriteHead - delaySamples;\n`;
      cpp += `        if (readHead < 0) readHead += delayBufferLength;\n`;
      cpp += `        float delaySample = mDelayBuffer.getSample (0, readHead);\n`;
      cpp += `        mDelayBuffer.setSample (0, mDelayWriteHead, currentSample + (delaySample * m_feedback));\n`;
      cpp += `        mDelayWriteHead = (mDelayWriteHead + 1) % delayBufferLength;\n`;
      cpp += `        currentSample = (currentSample * 0.7f) + (delaySample * 0.3f);\n\n`;
    } else if (node.type === "tremolo") {
      cpp += `        mTremoloPhase += (2.0f * (float)M_PI * m_tremoloRate) / (float)mSampleRate;\n`;
      cpp += `        if (mTremoloPhase > 2.0f * (float)M_PI) mTremoloPhase -= 2.0f * (float)M_PI;\n`;
      cpp += `        float tremMod = 1.0f - (((std::sin(mTremoloPhase) + 1.5f) * 0.5f) * m_tremoloDepth);\n`;
      cpp += `        currentSample = currentSample * tremMod;\n\n`;
    } else if (node.type === "chorus") {
      cpp += `        mChorusBuffer.setSample (0, mChorusWriteHead, currentSample);\n`;
      cpp += `        mChorusPhase += (2.0f * (float)M_PI * m_chorusRate) / (float)mSampleRate;\n`;
      cpp += `        if (mChorusPhase > 2.0f * (float)M_PI) mChorusPhase -= 2.0f * (float)M_PI;\n`;
      cpp += `        float targetDelay = 200.0f + (std::sin(mChorusPhase) * m_chorusDepth);\n`;
      cpp += `        int chorusLen = mChorusBuffer.getNumSamples();\n`;
      cpp += `        int cRead = mChorusWriteHead - (int)targetDelay;\n`;
      cpp += `        if (cRead < 0) cRead += chorusLen;\n`;
      cpp += `        float chorusSample = mChorusBuffer.getSample (0, cRead);\n`;
      cpp += `        mChorusWriteHead = (mChorusWriteHead + 1) % chorusLen;\n`;
      cpp += `        currentSample = (currentSample * 0.65f) + (chorusSample * 0.35f);\n\n`;
    }
  });

  cpp += `        return currentSample;\n    }\n\n`;

  // Class Private members
  cpp += `private:\n`;
  cpp += `    double mSampleRate = 44100.0;\n\n`;

  // Mapped parameter floats
  parameters.forEach((p) => {
    cpp += `    float m_${p.id} = ${p.defaultValue.toFixed(4)}f;\n`;
  });

  cpp += `\n`;

  // Persistent processing variables
  if (activeNodes.some((n) => n.type === "comb_delay")) {
    cpp += `    juce::AudioBuffer<float> mDelayBuffer;\n`;
    cpp += `    int mDelayWriteHead = 0;\n`;
  }
  if (activeNodes.some((n) => n.type === "chorus")) {
    cpp += `    juce::AudioBuffer<float> mChorusBuffer;\n`;
    cpp += `    int mChorusWriteHead = 0;\n`;
    cpp += `    float mChorusPhase = 0.0f;\n`;
  }
  if (activeNodes.some((n) => n.type === "ladder_filter")) {
    cpp += `    float mFilterY1 = 0.0f;\n`;
    cpp += `    float mFilterY2 = 0.0f;\n`;
  }
  if (activeNodes.some((n) => n.type === "tremolo")) {
    cpp += `    float mTremoloPhase = 0.0f;\n`;
  }

  cpp += `};\n`;

  // Clean returning compiled Audio Plugin structure
  return {
    id: `canvas-plugin-${Date.now()}`,
    name: pluginName,
    category: category,
    description: description,
    parameters,
    dspFunction: jsBody,
    faustCode: faust,
    cppJuceCode: cpp,
    createdAt: new Date().toLocaleDateString(),
  };
}
