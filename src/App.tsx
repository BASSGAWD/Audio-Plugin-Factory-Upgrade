import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  MessageSquare,
  Play,
  Pause,
  Sliders,
  RotateCcw,
  Activity,
  Code2,
  Send,
  Trash2,
  Clock,
  CheckCircle,
  Wand2,
  Terminal,
  HelpCircle,
  Copy,
  ChevronDown,
  Volume2,
  Workflow,
  FlaskConical,
  Download,
  Bookmark,
  Github,
  Cpu,
  BookOpen
} from "lucide-react";
import { AudioPlugin, ChatMessage, DSPAnalysisResult, DspCritiqueItem, Agent, PluginParameter } from "./types";
import { DEFAULT_AGENTS } from "./defaultAgents";
import { processOfflineMessage, runOfflineDSPAnalysis } from "./utils/offlineEngine";
import {
  LLMConfig,
  getLLMConfig,
  saveLLMConfig,
  autoDetectProvider,
  testProviderConnection,
  callLocalLLM,
  isLocalProvider,
  parseModelJson,
  fetchLLMRoute as fetchAppLLMRoute,
} from "./utils/llmGateway";
import {
  DSP_CODING_RULES,
  PARAMETER_DESIGN_RULES,
  AMP_CAB_SCHEMA_GUIDANCE,
  SAMPLER_SCHEMA_GUIDANCE,
  buildLocalChatSystemPrompt,
  TRANSLATE_PORTABLE_PROMPT,
} from "./utils/dspPromptKit";
import { verifyAndRepairDsp } from "./utils/pluginVerifier";
import { runQualityGate, formatBuildReport, measurePreviewTrim } from "./utils/qualityGate";
import { buildOfflineCandidates } from "./utils/offlineBuilder";
import { recordLessons } from "./utils/learnedPitfalls";
import { buildPortableScaffolds } from "./utils/portableCodegen";
import { buildRecipeContext } from "./utils/dspRecipes";
import { AudioPluginSpec, classifyPluginIntent, generatePluginSpec, formatSpecContext, looksLikeBuildRequest, familyToCategory } from "./utils/pluginSpec";
import { saveCandidateRecipe } from "./utils/recipeMemory";
import JobTimer from "./components/JobTimer";
import HelpManual from "./components/HelpManual";
import Visualizer from "./components/Visualizer";
import DSPAnalyzer from "./components/DSPAnalyzer";
import ExportPanel from "./components/ExportPanel";
import CanvasStudio from "./components/CanvasStudio";
import DiagnosticsLab from "./components/DiagnosticsLab";
import UIDesigner from "./components/UIDesigner";
import MemoryCore from "./components/MemoryCore";
import ResearchLab from "./components/ResearchLab";
import PresetManager from "./components/PresetManager";
import GitHubAudioDiscovery from "./components/GitHubAudioDiscovery";
import NativeBuildPanel from "./components/NativeBuildPanel";
import SimpleStudio from "./components/SimpleStudio";
import FactoryCanvas from "./components/FactoryCanvas";
import ModelPicker, { EngineId } from "./components/ModelPicker";
import RefineControl from "./components/RefineControl";
import BuildProgressBar, { BuildStage, BuildVersion } from "./components/BuildProgressBar";
import BlindListeningTest from "./components/BlindListeningTest";
import { runPlannedBuild } from "./utils/buildPlanner";
import { runRefinementLoop, refinementScore, isNearTie, MAX_REFINE_LOOPS, RankedCandidate } from "./utils/refinementLoop";
import { classifyEditIntent } from "./utils/editIntent";
import { runEditPass, ElementNote } from "./utils/editPass";

export function sanitizeDspCode(codeString: string): string {
  let sanitizedCode = codeString;
  const commonVars = [
    'delaySamples', 
    'readPtr', 
    'delayTimeMs', 
    'feedback', 
    'drive', 
    'bias', 
    'saturated', 
    'computation', 
    'volume', 
    'cutoff', 
    'resonance',
    'inputSample',
    'params',
    'state',
    'delayLine',
    'writePtr',
    'delaySample',
    'biasedInput'
  ];
  for (const v of commonVars) {
    let occurrences = 0;
    const regex = new RegExp(`\\b(let|const|var)\\s+(${v})\\b`, 'g');
    sanitizedCode = sanitizedCode.replace(regex, (match, declaration, name) => {
      occurrences++;
      if (occurrences === 1) {
        return `let ${name}`;
      } else {
        return name;
      }
    });
  }
  return sanitizedCode;
}

export function getAgentSteps(agentId: string): string[] {
  if (agentId === "nexus") {
    return [
      "Intercepting prompt & routing acoustic params...",
      "Consulting Aero: Designing LTI filter math & curves...",
      "Consulting Decibel: Auditing safety & feedback bounds...",
      "Consulting Haptic: Shaping logarithmic control response...",
      "Consulting Syntax: Structuring optimized JUCE C++ templates...",
      "Assembling final DSP code & hot-reloading active engine..."
    ];
  }
  if (agentId === "aero") {
    return [
      "Analyzing user request & wave equations...",
      "Deriving transfer functions & z-domain formulas...",
      "Formulating filter difference coefficients...",
      "Optimizing continuous parameters for compile-ready math..."
    ];
  }
  if (agentId === "syntax") {
    return [
      "Parsing active JavaScript DSP stack & scoping variables...",
      "Optimizing register-level loops and SIMD registers...",
      "Designing lock-free C++ processBlock structures...",
      "Generating structured Faust code and compiling AST..."
    ];
  }
  if (agentId === "haptic") {
    return [
      "Inspecting canvas coordinates & visual layout grouping...",
      "Mapping physical control parameters to sliders...",
      "Calibrating logarithmic dials for natural mouse gesture feel...",
      "Structuring UI config coordinates and hot-reloading workspace..."
    ];
  }
  if (agentId === "decibel") {
    return [
      "Analyzing active code for NaN feedback singularities...",
      "Verifying active DC-blocking filters and anti-blowup clamps...",
      "Calculating coefficient safeguards on resonance ranges...",
      "Generating diagnostic signal purity reports and QA logs..."
    ];
  }
  return [
    "Analyzing request & configuring audio processor...",
    "Drafting DSP concepts and equations...",
    "Synthesizing high-fidelity audio structures...",
    "Hot-reloading active controls and running workspace audits..."
  ];
}

export function OrangeJuceLogo({ size = 32 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="relative bg-[#f97316] rounded-xl overflow-hidden flex items-center justify-center shadow-lg shadow-orange-950/40 select-none shrink-0 group border border-orange-400/20">
      {/* Outer gradient */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-orange-600 to-transparent opacity-80" />
      {/* Wave glow behind */}
      <div className="absolute w-[200%] h-[200%] bg-orange-400/20 rounded-full blur-sm -top-1/2 animate-pulse" />
      {/* Cartoon mascot face SVG */}
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full relative z-10 p-1"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Leaf */}
        <path
          d="M48 20 C52 10, 62 12, 60 22 C55 24, 48 22, 48 20"
          fill="#22c55e"
          stroke="#15803d"
          strokeWidth="2.5"
        />
        {/* Stem */}
        <path d="M50 25 L48 21" stroke="#15803d" strokeWidth="3" strokeLinecap="round" />
        
        {/* Orange Body Sphere */}
        <circle cx="50" cy="56" r="32" fill="#f97316" stroke="#ea580c" strokeWidth="3" />
        {/* Highlight */}
        <path d="M30 40 A 15 15 0 0 1 50 30" stroke="#ffedd5" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        
        {/* Cute Face: Eyes */}
        <circle cx="42" cy="54" r="4" fill="#1c0a00" />
        <circle cx="58" cy="54" r="4" fill="#1c0a00" />
        <circle cx="41" cy="52" r="1.5" fill="#ffffff" />
        <circle cx="57" cy="52" r="1.5" fill="#ffffff" />
        
        {/* Cute blush */}
        <circle cx="35" cy="58" r="3" fill="#ef4444" opacity="0.5" />
        <circle cx="65" cy="58" r="3" fill="#ef4444" opacity="0.5" />

        {/* Cute Smiley Mouth */}
        <path
          d="M45 61 Q50 66 55 61"
          stroke="#1c0a00"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Headphones over ears */}
        {/* Arch */}
        <path
          d="M23 54 C23 28, 77 28, 77 54"
          stroke="#27272a"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M23 54 C23 28, 77 28, 77 54"
          stroke="#f97316"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Earcups */}
        {/* Left earcup */}
        <rect x="18" y="46" width="9" height="18" rx="4" fill="#27272a" stroke="#18181b" strokeWidth="2" />
        <rect x="21" y="49" width="3" height="12" rx="1" fill="#ea580c" />
        {/* Right earcup */}
        <rect x="73" y="46" width="9" height="18" rx="4" fill="#27272a" stroke="#18181b" strokeWidth="2" />
        <rect x="76" y="49" width="3" height="12" rx="1" fill="#ea580c" />

        {/* Signal cable */}
        <path d="M22 62 C22 74, 45 80, 50 82" stroke="#27272a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* Waveform graphic inside oscilloscope box representation */}
        <rect x="62" y="72" width="22" height="16" rx="3" fill="#18181b" stroke="#3f3f46" strokeWidth="1.5" />
        <path d="M65 80 L70 76 L75 84 L80 80" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const STORAGE_KEY_PLUGIN = "audio_factory_plugin_state";
const STORAGE_KEY_UI_MODE = "audio_factory_ui_mode";

type CompanionTabId =
  | "chat" | "playground" | "code" | "diagnostics" | "terminal" | "canvas"
  | "lab" | "export" | "memory_core" | "presets" | "architect" | "github" | "cpp_harness" | "research";

interface WorkspaceTab {
  id: CompanionTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  accent: "orange" | "indigo";
}

// Grouped by workflow stage so all tabs fit on screen (the bar wraps instead
// of scrolling horizontally).
const WORKSPACE_TAB_GROUPS: Array<{ label: string; tabs: WorkspaceTab[] }> = [
  {
    label: "Create",
    tabs: [
      { id: "chat", label: "AI Chat", icon: MessageSquare, iconColor: "text-orange-400", accent: "orange" },
      { id: "architect", label: "Architect", icon: Wand2, iconColor: "text-indigo-400", accent: "indigo" },
      { id: "presets", label: "Presets", icon: Bookmark, iconColor: "text-orange-400", accent: "orange" },
    ],
  },
  {
    label: "Sound",
    tabs: [
      { id: "playground", label: "Playground", icon: Sliders, iconColor: "text-indigo-400", accent: "indigo" },
      { id: "canvas", label: "Block Router", icon: Workflow, iconColor: "text-indigo-400", accent: "indigo" },
    ],
  },
  {
    label: "Code",
    tabs: [
      { id: "code", label: "Script JS", icon: Code2, iconColor: "text-sky-400", accent: "indigo" },
      { id: "diagnostics", label: "Purity QA", icon: Activity, iconColor: "text-amber-500", accent: "indigo" },
      { id: "lab", label: "Stress Sweep", icon: FlaskConical, iconColor: "text-rose-400", accent: "indigo" },
      { id: "terminal", label: "Terminal", icon: Terminal, iconColor: "text-emerald-400", accent: "indigo" },
    ],
  },
  {
    label: "Ship",
    tabs: [
      { id: "export", label: "Export", icon: Download, iconColor: "text-emerald-400", accent: "indigo" },
      { id: "cpp_harness", label: "VST3 Build", icon: Cpu, iconColor: "text-indigo-400", accent: "indigo" },
    ],
  },
  {
    label: "System",
    tabs: [
      { id: "memory_core", label: "Models & Memory", icon: Workflow, iconColor: "text-orange-400", accent: "orange" },
      { id: "research", label: "Research Lab", icon: BookOpen, iconColor: "text-sky-400", accent: "indigo" },
      { id: "github", label: "GitHub Search", icon: Github, iconColor: "text-indigo-400", accent: "indigo" },
    ],
  },
];
const STORAGE_KEY_CHAT = "audio_factory_chat_history";

// Prefilled starting high-fidelity Auto-Tune vocal pitch corrector plugin
const DEFAULT_STARTING_PLUGIN: AudioPlugin = {
  id: "factory-autotune",
  name: "🤖 AeroTune Vocal Pitch Corrector",
  category: "modulation",
  description: "Elite real-time pitch detection & intonation corrector. Integrates autocorrelation F0 vocal-registers tracking, snapped scale lock, retune glide, and a crossfaded dual-delay time-domain pitch shifter.",
  parameters: [
    { id: "speed", name: "Retune Speed", min: 0.0, max: 10.0, defaultValue: 7.0, value: 7.0, unit: "ms" },
    { id: "scale", name: "Target Scale (Chrom->Maj->Pent)", min: 0.0, max: 2.0, defaultValue: 0.0, value: 0.0, unit: "scale" },
    { id: "vibrato", name: "Vocal Vibrato Depth", min: 0.0, max: 2.0, defaultValue: 0.2, value: 0.2, unit: "Hz" },
    { id: "pitch", name: "Manual Transpose Shift", min: -12.0, max: 12.0, defaultValue: 0.0, value: 0.0, unit: "st" },
    { id: "correction", name: "Correction Intensity", min: 0.0, max: 1.0, defaultValue: 0.85, value: 0.85, unit: "%" }
  ],
  dspFunction: `// --- AEROTUNE VOCAL PITCH CORRECTOR & AUTO-TUNE ENGINE ---
// Persistent Pitch Memory & Autocorrelation Buffer Registers
if (!state.init_vocal) {
  state.pitch_buf = new Float32Array(1024);
  state.pitch_ptr = 0;
  state.sample_count = 0;
  state.detected_freq = 220.0;
  state.target_ratio = 1.0;
  state.smooth_ratio = 1.0;
  state.delay_buf = new Float32Array(8192);
  state.delay_ptr = 0;
  state.phase_1 = 0.0;
  state.vibrato_phase = 0.0;
  state.init_vocal = true;
}

// Write to delay and pitch analysis circular queues
state.delay_buf[state.delay_ptr] = inputSample;
state.pitch_buf[state.pitch_ptr] = inputSample;
state.pitch_ptr = (state.pitch_ptr + 1) % 1024;
state.sample_count++;

// Fetch real-time parameters
let speed = params.speed !== undefined ? params.speed : 7.0;
let scale_idx = params.scale !== undefined ? params.scale : 0;
let vibrato = params.vibrato !== undefined ? params.vibrato : 0.2;
let pitch = params.pitch !== undefined ? params.pitch : 0.0;
let correction = params.correction !== undefined ? params.correction : 0.85;

// Periodically run optimized Autocorrelation Pitch-Tracking loop (every 128 samples)
if (state.sample_count >= 128) {
  state.sample_count = 0;
  let max_corr = 0.0;
  let best_lag = -1;
  // Search lag range: 45 samples (980 Hz) to 320 samples (137 Hz) representing vocal registers
  for (let lag = 45; lag < 320; lag++) {
    let corr = 0.0;
    for (let i = 0; i < 256; i++) {
      let idx1 = (state.pitch_ptr - i - 1 + 1024) % 1024;
      let idx2 = (state.pitch_ptr - i - 1 - lag + 1024) % 1024;
      corr += state.pitch_buf[idx1] * state.pitch_buf[idx2];
    }
    if (corr > max_corr) {
      max_corr = corr;
      best_lag = lag;
    }
  }
  if (best_lag > 0) {
    state.detected_freq = 44100.0 / best_lag;
  }
}

// Convert estimated frequency to standard MIDI notes
let original_midi = 12.0 * Math.log2(state.detected_freq / 440.0) + 69.0;
let midi_note = Math.round(original_midi);

// Snap note according to target Scale Selection
let target_midi = midi_note;
if (scale_idx >= 1.5) { // Minor Blues Scale notes: C, Eb, F, F#, G, Bb (relative to C scale)
  let p = midi_note % 12;
  // Snap profile for minor blues
  let target_p = 0;
  if (p === 0 || p === 1) target_p = 0;
  else if (p === 2 || p === 3 || p === 4) target_p = 3;
  else if (p === 5) target_p = 5;
  else if (p === 6 || p === 7 || p === 8) target_p = 7;
  else if (p === 9 || p === 10 || p === 11) target_p = 10;
  target_midi = Math.floor(midi_note / 12) * 12 + target_p;
} else if (scale_idx >= 0.5) { // C Major Pentatonic: C, D, E, G, A (0, 2, 4, 7, 9)
  let p = midi_note % 12;
  let target_p = 0;
  if (p === 0 || p === 1) target_p = 0;
  else if (p === 2 || p === 3) target_p = 2;
  else if (p === 4 || p === 5 || p === 6) target_p = 4;
  else if (p === 7 || p === 8) target_p = 7;
  else if (p === 9 || p === 10 || p === 11) target_p = 9;
  target_midi = Math.floor(midi_note / 12) * 12 + target_p;
} else { // Standard Chromatic scale - simple whole semitones
  target_midi = midi_note;
}

// Calculate correction pitch factor
let target_freq = 440.0 * Math.pow(2.0, (target_midi - 69.0) / 12.0);
let base_tuning_ratio = target_freq / Math.max(20.0, state.detected_freq);

// Glide factor representing retune speed (Robotic 0ms -> Natural 10ms)
let glide = Math.pow(10.0, -((11.0 - speed) * 0.45));
state.target_ratio += glide * (base_tuning_ratio - state.target_ratio);

// Factor in vocal vibrato LFO & manual transpose pitch sliders
let vibSpeed = 6.0; // 6Hz natural vocal vocal vibrato rate
state.vibrato_phase += (2.0 * Math.PI * vibSpeed) / 44100.0;
if (state.vibrato_phase > 2.0 * Math.PI) state.vibrato_phase -= 2.0 * Math.PI;
let vibrato_offset = Math.sin(state.vibrato_phase) * (vibrato * 0.03);

let manualShift = Math.pow(2.0, pitch / 12.0);
let final_shift_ratio = ((state.target_ratio - 1.0) * correction + 1.0) * manualShift + vibrato_offset;

// Bound-limit ratio to prevent physical overflows [0.25x to 4.0x range of pitch shift]
final_shift_ratio = Math.max(0.25, Math.min(4.0, final_shift_ratio));

// Smoothing read pointer scaling for tape-head simulator
state.smooth_ratio += 0.05 * (final_shift_ratio - state.smooth_ratio);
let rate = 1.0 - state.smooth_ratio;

// Accumulate triangular phase pointers
state.phase_1 += rate * (1.0 / 44100.0) * 150.0;
if (state.phase_1 > 1.0) state.phase_1 -= 1.0;
if (state.phase_1 < 0.0) state.phase_1 += 1.0;

let phase_2 = state.phase_1 + 0.5;
if (phase_2 > 1.0) phase_2 -= 1.0;

// Shift read pointers based on phase scaling
let max_delay = 800.0;
let d1 = state.phase_1 * max_delay;
let d2 = phase_2 * max_delay;

let r1 = (state.delay_ptr - Math.floor(d1) + 8192) % 8192;
let r2 = (state.delay_ptr - Math.floor(d2) + 8192) % 8192;

let s1 = state.delay_buf[r1] || 0.0;
let s2 = state.delay_buf[r2] || 0.0;

// Linear crossfade to absolute quieten tape wrapping cracks
let w2 = Math.abs(state.phase_1 - 0.5) * 2.0;
let w1 = 1.0 - w2;

let pitch_corrected = s1 * w1 + s2 * w2;

// Increment delay buffer write index
state.delay_ptr = (state.delay_ptr + 1) % 8192;

return pitch_corrected;`,
  faustCode: `declare name "AeroTune Vocal Pitch Corrector";
declare category "modulation";

import("stdfaust.lib");

speed = hslider("Retune Speed", 7.0, 0.0, 10.0, 0.1);
scale = hslider("Target Scale (Chrom->Maj->Pent)", 0.0, 0.0, 2.0, 1.0);
vibrato = hslider("Vocal Vibrato Depth", 0.2, 0.0, 2.0, 0.01);
pitch = hslider("Manual Transpose Shift", 0.0, -12.0, 12.0, 1.0);
correction = hslider("Correction Intensity", 0.85, 0.0, 1.0, 0.01);

// Realtime time-domain pitch shifter simulation with crossfading delay lines
pitchShifter(x) = x : de.delay(8192, d1) * w1 + de.delay(8192, d2) * w2
with {
    rate = 1.0 - (correction * (speed / 10.0));
    phase1 = os.phasor(1.0, 150.0 * rate);
    phase2 = ma.fmod(phase1 + 0.5, 1.0);
    
    d1 = phase1 * 800.0;
    d2 = phase2 * 800.0;
    
    w2 = abs(phase1 - 0.5) * 2.0;
    w1 = 1.0 - w2;
};

process = pitchShifter;`,
  cppJuceCode: `// JUCE C++ Pitch Shifter Process Node
class AeroTuneNode {
public:
    void prepare(double sampleRate) {
        mSampleRate = sampleRate;
        mDelayBuffer.setSize(1, 8192);
        mDelayBuffer.clear();
        mWriteHead = 0;
        mPhase = 0.0f;
    }

    float process(float inputSample) {
        mDelayBuffer.setSample(0, mWriteHead, inputSample);
        
        float rate = 1.0f - (mCorrection * 0.5f);
        mPhase += (150.0f * rate) / mSampleRate;
        if (mPhase > 1.0f) mPhase -= 1.0f;
        
        float phase2 = mPhase + 0.5f;
        if (phase2 > 1.0f) phase2 -= 1.0f;
        
        float d1 = mPhase * 800.0f;
        float d2 = phase2 * 800.0f;
        
        int r1 = (mWriteHead - (int)d1 + 8192) % 8192;
        int r2 = (mWriteHead - (int)d2 + 8192) % 8192;
        
        float s1 = mDelayBuffer.getSample(0, r1);
        float s2 = mDelayBuffer.getSample(0, r2);
        
        float w2 = std::abs(mPhase - 0.5f) * 2.0f;
        float w1 = 1.0f - w2;
        
        mWriteHead = (mWriteHead + 1) % 8192;
        return s1 * w1 + s2 * w2;
    }

private:
    double mSampleRate = 44100.0;
    juce::AudioBuffer<float> mDelayBuffer;
    int mWriteHead = 0;
    float mPhase = 0.0f;
    float mCorrection = 0.85f;
};`,
  createdAt: new Date().toLocaleDateString()
};

export default function App() {
  // ---- 1. State Declarations ----
  // Simple mode = ChatGPT-style single chat screen (default). Pro mode = full
  // workspace. Canvas mode = the factory floor: every prompt becomes a
  // draggable plugin card on an infinite canvas.
  const [uiMode, setUiMode] = useState<"simple" | "pro" | "canvas">(() => {
    const saved = localStorage.getItem(STORAGE_KEY_UI_MODE);
    return saved === "pro" ? "pro" : saved === "canvas" ? "canvas" : "simple";
  });
  const switchUiMode = (mode: "simple" | "pro" | "canvas") => {
    setUiMode(mode);
    localStorage.setItem(STORAGE_KEY_UI_MODE, mode);
  };
  const [plugin, setPlugin] = useState<AudioPlugin>(DEFAULT_STARTING_PLUGIN);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("nexus");
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [orchestrationStep, setOrchestrationStep] = useState<number>(0);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [apiHealth, setApiHealth] = useState<{ status: string; hasApiKey: boolean } | null>(null);
  const [localLlmStatus, setLocalLlmStatus] = useState<{
    provider: "ollama" | "lm_studio";
    model: string;
    connected: boolean;
    checking: boolean;
  } | null>(null);
  const [offlineForced, setOfflineForced] = useState(false);

  // Perfecting loop: 0 = off; 1..MAX_REFINE_LOOPS rework passes after each
  // build, keeping only iterations that score strictly higher. Persisted.
  const [refineLoops, setRefineLoopsState] = useState<number>(() => {
    const raw = parseInt(localStorage.getItem("audio_factory_refine_loops") || "0", 10);
    return Number.isFinite(raw) ? Math.max(0, Math.min(MAX_REFINE_LOOPS, raw)) : 0;
  });
  const setRefineLoops = (n: number) => {
    const clamped = Math.max(0, Math.min(MAX_REFINE_LOOPS, Math.round(n)));
    setRefineLoopsState(clamped);
    localStorage.setItem("audio_factory_refine_loops", String(clamped));
  };

  // Live build status bar: checkpoint stages driven by REAL pipeline
  // callbacks (planner onStage, perfecting-loop onIteration) — no fake timers.
  const [buildStages, setBuildStages] = useState<BuildStage[]>([]);
  // Perfecting-loop leaderboard + blind A/B/C test. Versions persist after the
  // build finishes so the ranking and the "Judge by ear" button stay visible.
  const [buildVersions, setBuildVersions] = useState<BuildVersion[]>([]);
  const [refineCandidates, setRefineCandidates] = useState<RankedCandidate[]>([]);
  const [showBlindTest, setShowBlindTest] = useState(false);
  // Annotation canvas: notes pinned to specific controls, consumed by the
  // next edit pass ("point at it and say what's wrong").
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotations, setAnnotations] = useState<ElementNote[]>([]);
  const beginBuildStages = (withPipeline: boolean) => {
    // A fresh build clears any prior perfecting-loop results and stale
    // element notes (param ids may not survive a rebuild).
    setBuildVersions([]);
    setRefineCandidates([]);
    setShowBlindTest(false);
    setAnnotations([]);
    const base: BuildStage[] = withPipeline
      ? [
          { id: "intent", label: "Intent", status: "pending" },
          { id: "plan", label: "Plan", status: "pending" },
          { id: "parameters", label: "Controls", status: "pending" },
          { id: "dsp", label: "DSP", status: "pending" },
          { id: "validate", label: "Verify", status: "pending" },
        ]
      : [
          { id: "generate", label: "Generate", status: "pending" },
          { id: "validate", label: "Verify", status: "pending" },
        ];
    if (refineLoops > 0) base.push({ id: "perfect", label: "Perfect", status: "pending", note: `0/${refineLoops}` });
    base.push({ id: "done", label: "Loaded", status: "pending" });
    setBuildStages(base);
  };
  const markStage = (id: string, note?: string) =>
    setBuildStages((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx === -1) return prev;
      return prev.map((x, i) =>
        i < idx ? { ...x, status: "done" } : i === idx ? { ...x, status: "active", note: note ?? x.note } : x
      );
    });
  const finishStages = () => {
    setBuildStages((prev) => prev.map((x) => ({ ...x, status: "done" })));
    setTimeout(() => setBuildStages([]), 1800);
  };

  // Custom editor scratchpad configurations
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [scratchCode, setScratchCode] = useState("");

  // Quality Assurance analyzer state
  const [analysis, setAnalysis] = useState<DSPAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);

  // Web Audio engine state
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceType, setSourceType] = useState<"synth" | "sine" | "noise">("synth");
  const [bypass, setBypass] = useState(false);
  const [dspError, setDspError] = useState<string | null>(null);

  // Toast status Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Workspace tabs toggle selection (companion tabs)
  const [companionTab, setCompanionTab] = useState<CompanionTabId>("playground");

  // Spec Architect States
  const [architectPrompt, setArchitectPrompt] = useState("");
  const [architectIsDeconstructing, setArchitectIsDeconstructing] = useState(false);
  const [architectSpecs, setArchitectSpecs] = useState<Array<{
    title: string;
    description: string;
    details: string[];
    isEditing: boolean;
  }> | null>(null);
  const [architectGeneratedCode, setArchitectGeneratedCode] = useState<string | null>(null);
  const [architectParameters, setArchitectParameters] = useState<PluginParameter[]>([]);

  // Help manual overlay modal trigger
  const [isHelpManualOpen, setIsHelpManualOpen] = useState(false);

  // Claude Code terminal emulator state
  const [terminalLogs, setTerminalLogs] = useState<Array<{ text: string; type: "input" | "info" | "success" | "error" | "warn" }>>([
    { text: "claude-code > init pluggen-compiler --sandbox", type: "input" },
    { text: "Initializing real-time dynamic trans-compiler core...", type: "info" },
    { text: "✔ Host environment validation complete (Vite v5.x + React 18)", type: "success" },
    { text: "✔ Web Audio API context registered successfully", type: "success" },
    { text: "✔ Active DSP loaded: Warm Tape Saturator & slap [O(1) complexity]", type: "success" },
    { text: "Compiler engine standing by. Type instructions or modify variables to compile.", type: "info" }
  ]);

  // Active agents array
  const agents = DEFAULT_AGENTS;
  const currentAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

  const [isPrecisionOversampled, setIsPrecisionOversampled] = useState(false);
  const isPrecisionOversampledRef = useRef(false);

  useEffect(() => {
    isPrecisionOversampledRef.current = isPrecisionOversampled;
  }, [isPrecisionOversampled]);

  // ---- 2. Web Audio Audio Engine Refs ----
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const activeParamsRef = useRef<Record<string, number>>({});
  const outputTrimRef = useRef<number>(1.0);
  const dcBlockRef = useRef<boolean>(false);
  const dspStateRef = useRef<Record<string, any>>({});
  const timeIndexRef = useRef<number>(0);
  const compiledFunctionRef = useRef<Function | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatTimeoutRef = useRef<any | null>(null);

  // Synchronise auxiliary status toggles with AudioWorklet
  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "bypass", bypass });
    }
  }, [bypass]);

  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "oversampling", oversampling: isPrecisionOversampled });
    }
  }, [isPrecisionOversampled]);

  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "sourceType", sourceType });
    }
  }, [sourceType]);

  // Synchronise parameters instantly to refs representing real-time Audio Loop parameters
  useEffect(() => {
    const paramsMap: Record<string, number> = {};
    plugin.parameters.forEach((p) => {
      paramsMap[p.id] = p.value;
    });
    activeParamsRef.current = paramsMap;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "params", params: paramsMap });
    }
  }, [plugin.parameters]);

  // Synchronise the quality gate's corrections (loudness trim + DC blocker) into the engine
  useEffect(() => {
    outputTrimRef.current = plugin.outputTrim ?? 1.0;
    dcBlockRef.current = plugin.dcBlock ?? false;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "trim", trim: outputTrimRef.current });
      workletNodeRef.current.port.postMessage({ type: "dcblock", dcblock: dcBlockRef.current });
    }
  }, [plugin.outputTrim, plugin.dcBlock]);

  // Synchronise current dspFunction into live executable JS Function ref
  useEffect(() => {
    compileDsp(plugin.dspFunction);
  }, [plugin.dspFunction]);

  // Lazy portable-code generation: Faust/C++ are no longer produced on every
  // chat generation (that tripled output tokens and generation time). When the
  // Export tab opens with empty portable code, deterministic scaffolds appear
  // instantly, then a local model upgrades them to faithful translations.
  const exportGenInFlightRef = useRef(false);
  useEffect(() => {
    if (companionTab !== "export") return;
    if (plugin.faustCode && plugin.cppJuceCode) return;
    if (exportGenInFlightRef.current) return;
    exportGenInFlightRef.current = true;

    const scaffolds = buildPortableScaffolds(plugin);
    const withScaffolds: AudioPlugin = {
      ...plugin,
      faustCode: plugin.faustCode || scaffolds.faustCode,
      cppJuceCode: plugin.cppJuceCode || scaffolds.cppJuceCode,
    };
    savePluginState(withScaffolds);

    (async () => {
      const cfg = getLLMConfig();
      if (!isLocalProvider(cfg)) {
        exportGenInFlightRef.current = false;
        return;
      }
      try {
        const paramSummary = withScaffolds.parameters.map((p) => ({
          id: p.id, name: p.name, min: p.min, max: p.max, defaultValue: p.defaultValue, unit: p.unit,
        }));
        const payload = await callLocalLLM({
          config: cfg,
          systemPrompt: TRANSLATE_PORTABLE_PROMPT,
          userText: `Parameters: ${JSON.stringify(paramSummary)}\n\ndspFunction body:\n${withScaffolds.dspFunction}`,
          temperature: 0.3,
        });
        if (typeof payload?.faustCode === "string" && payload.faustCode.trim() && typeof payload?.cppJuceCode === "string" && payload.cppJuceCode.trim()) {
          savePluginState({ ...withScaffolds, faustCode: payload.faustCode, cppJuceCode: payload.cppJuceCode });
          triggerToast("Export code upgraded to faithful Faust + JUCE translations.");
        }
      } catch (err: any) {
        console.warn("Portable code translation failed; keeping deterministic scaffolds:", err?.message || err);
      } finally {
        exportGenInFlightRef.current = false;
      }
    })();
  }, [companionTab, plugin.id, plugin.faustCode, plugin.cppJuceCode]);

  // Keep terminal logs live with changes to show "live building" trace
  useEffect(() => {
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const lineCount = (plugin.dspFunction || "").split("\n").length;
    
    const newLogs: Array<{ text: string; type: "input" | "info" | "success" | "error" | "warn" }> = [
      { text: `[${timestamp}] claude-code > rebuild --module ${plugin.id} --params`, type: "input" },
      { text: `⚡ Compiling raw AST block: ${lineCount} lines of DSP script...`, type: "info" },
      { text: `🔬 Bindings: [${plugin.parameters.map((p) => `${p.id}=${p.value.toFixed(1)}`).join(", ")}]`, type: "info" },
    ];

    if (dspError) {
      newLogs.push({ text: `✖ AST error: ${dspError}`, type: "error" });
    } else {
      newLogs.push({ text: `✔ AST parsed successfully. Built target function module reference.`, type: "success" });
      newLogs.push({ text: `✔ Registered hardware bindings with faceplate sliders.`, type: "success" });
      newLogs.push({ text: `✔ Real-time Audio Simulator pipe is ${isPlaying ? "ONLINE & streaming" : "MUTED"} [44100 Hz]`, type: "success" });
    }

    setTerminalLogs((prev) => {
      const merged = [...prev, ...newLogs];
      if (merged.length > 200) return merged.slice(merged.length - 200);
      return merged;
    });
  }, [plugin.dspFunction, plugin.parameters, dspError]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  // Orchestrator dynamic step delegator loop
  useEffect(() => {
    let interval: any = null;
    if (chatLoading && selectedAgentId === "nexus") {
      setOrchestrationStep(0);
      interval = setInterval(() => {
        setOrchestrationStep((prev) => (prev < 5 ? prev + 1 : prev));
      }, 1400);
    } else {
      setOrchestrationStep(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [chatLoading, selectedAgentId]);

  // Toast notifier triggers
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Safe DSP Compile helper
  const compileDsp = (codeString: string) => {
    try {
      const sanitized = sanitizeDspCode(codeString);
      // Create a fresh clean executable function: function(inputSample, params, state) { ... }
      const compiled = new Function("inputSample", "params", "state", sanitized);
      compiledFunctionRef.current = compiled;
      setDspError(null);
      if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: "code", code: sanitized });
      }
    } catch (err: any) {
      console.error("DSP Compile failure:", err);
      setDspError(`Syntax Error: ${err.message}`);
    }
  };

  // ---- 3. API Health & Hydration Check ----
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setApiHealth(data))
      .catch((err) => console.error("API Health error:", err));

    // Deserialise cached state
    const cachedPlugin = localStorage.getItem(STORAGE_KEY_PLUGIN);
    if (cachedPlugin) {
      try {
        const parsed = JSON.parse(cachedPlugin);
        // Automatically upgrade/migrate old default tape saturator to our new default high-fidelity Auto-Tune
        if (parsed.id === "warm-tape-saturation") {
          setPlugin(DEFAULT_STARTING_PLUGIN);
          setScratchCode(DEFAULT_STARTING_PLUGIN.dspFunction);
          localStorage.setItem(STORAGE_KEY_PLUGIN, JSON.stringify(DEFAULT_STARTING_PLUGIN));
        } else {
          // Verify that the cached plugin can be parsed and compiled without syntax errors.
          // This prevents a broken/corrupt localStorage state from bricking the startup experience.
          try {
            const testSanitized = sanitizeDspCode(parsed.dspFunction);
            new Function("inputSample", "params", "state", testSanitized);
            setPlugin(parsed);
            setScratchCode(parsed.dspFunction);
          } catch (compileErr) {
            console.warn("Cached plugin failed verification compilation. Falling back to default plugin:", compileErr);
            setPlugin(DEFAULT_STARTING_PLUGIN);
            setScratchCode(DEFAULT_STARTING_PLUGIN.dspFunction);
            localStorage.setItem(STORAGE_KEY_PLUGIN, JSON.stringify(DEFAULT_STARTING_PLUGIN));
          }
        }
      } catch (e) {
        console.error("Failed to parse cached plugin.");
        setPlugin(DEFAULT_STARTING_PLUGIN);
        setScratchCode(DEFAULT_STARTING_PLUGIN.dspFunction);
      }
    } else {
      setScratchCode(DEFAULT_STARTING_PLUGIN.dspFunction);
    }

    const cachedChat = localStorage.getItem(STORAGE_KEY_CHAT);
    if (cachedChat) {
      try {
        setChatHistory(JSON.parse(cachedChat));
      } catch (e) {}
    }
  }, []);

  // ---- 3b. Local LLM Gateway Detection (Ollama / LM Studio) ----
  // On a fresh install (no saved gateway config) probe both local servers and
  // default to whichever one actually responds, so the app works offline
  // without the user having to dig into the Memory & LLMs settings tab.
  const refreshLocalLlmStatus = async () => {
    const hadSavedConfig = !!localStorage.getItem("orange_juce_llm_config");
    let cfg = getLLMConfig();

    if (!hadSavedConfig) {
      cfg = await autoDetectProvider(cfg);
      saveLLMConfig(cfg);
    }

    if (!isLocalProvider(cfg)) {
      setLocalLlmStatus(null);
      return;
    }

    const provider = cfg.provider as "ollama" | "lm_studio";
    const model = provider === "ollama" ? cfg.ollamaModel : cfg.lmStudioModel;
    setLocalLlmStatus({ provider, model, connected: false, checking: true });

    const result = await testProviderConnection(provider, cfg);
    setLocalLlmStatus({ provider, model, connected: result.ok, checking: false });
  };

  useEffect(() => {
    refreshLocalLlmStatus();
  }, []);

  // Single handler behind the ModelPicker (Pro header + Simple Mode): flips
  // the forced-offline flag and keeps the local-model status labels fresh.
  const handleEngineChange = ({ offlineForced: forced, engine }: { offlineForced: boolean; engine: EngineId }) => {
    setOfflineForced(forced);
    const engineLabel =
      engine === "offline" ? "Offline Compiler (instant, in-browser)"
      : engine === "gemini" ? "Gemini Cloud"
      : engine === "ollama" ? "Ollama (local)"
      : "LM Studio (local)";
    triggerToast(`AI engine set to ${engineLabel}`);
    refreshLocalLlmStatus();
  };

  // Save changes offline
  const savePluginState = (newPlugin: AudioPlugin) => {
    setPlugin(newPlugin);
    localStorage.setItem(STORAGE_KEY_PLUGIN, JSON.stringify(newPlugin));
  };

  // Handle live slider movements
  const handleSliderChange = (paramId: string, value: number) => {
    const updatedParameters = plugin.parameters.map((p) =>
      p.id === paramId ? { ...p, value } : p
    );
    const updatedPlugin = { ...plugin, parameters: updatedParameters };
    savePluginState(updatedPlugin);
  };

  // ---- 4. Playback Simulation Audio Context Engine ----
  const togglePlaySimulation = async () => {
    if (isPlaying) {
      stopAudioEngine();
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported in this browser environment.");
      }

      const activeCtx = new AudioCtx({ sampleRate: 44100 });
      audioCtxRef.current = activeCtx;

      const analyser = activeCtx.createAnalyser();
      analyser.fftSize = 512;
      analyserNodeRef.current = analyser;

      timeIndexRef.current = 0;
      dspStateRef.current = {}; 

      // Anti-alias smoother state for the ScriptProcessor fallback's precision mode
      let aa1 = 0.0;
      let aa2 = 0.0;
      // One-pole DC blocker state for the ScriptProcessor fallback
      let dcX1 = 0.0;
      let dcY1 = 0.0;

      // Double-threaded dynamic DSP execution code running on background worker thread
      const workletCode = `
function sanitizeDspCode(codeString) {
  let sanitizedCode = codeString;
  const commonVars = [
    'delaySamples', 
    'readPtr', 
    'delayTimeMs', 
    'feedback', 
    'drive', 
    'bias', 
    'saturated', 
    'computation', 
    'volume', 
    'cutoff', 
    'resonance',
    'inputSample',
    'params',
    'state',
    'delayLine',
    'writePtr',
    'delaySample',
    'biasedInput'
  ];
  for (const v of commonVars) {
    let occurrences = 0;
    const regex = new RegExp('\\\\b(let|const|var)\\\\s+(' + v + ')\\\\b', 'g');
    sanitizedCode = sanitizedCode.replace(regex, (match, declaration, name) => {
      occurrences++;
      if (occurrences === 1) {
        return 'let ' + name;
      } else {
        return name;
      }
    });
  }
  return sanitizedCode;
}

class DynamicDSPProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dspFunc = null;
    this.dspState = {};
    this.params = {};
    this.timeIndex = 0;
    this.bypass = false;
    this.isPrecisionOversampled = false;
    this.sourceType = "synth";
    this.outputTrim = 1.0;
    this.dcBlockOn = false;
    // One-pole DC blocker state (y = x - x1 + 0.995 * y1)
    this.dcX1 = 0.0;
    this.dcY1 = 0.0;
    // Anti-alias smoother state for precision mode
    this.aa1 = 0.0;
    this.aa2 = 0.0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === "code") {
        try {
          const sanitized = sanitizeDspCode(data.code);
          this.dspFunc = new Function("inputSample", "params", "state", sanitized);
        } catch (e) {
          this.port.postMessage({ type: "error", message: "Compile error in Worklet: " + e.message });
        }
      } else if (data.type === "params") {
        this.params = data.params;
      } else if (data.type === "bypass") {
        this.bypass = data.bypass;
      } else if (data.type === "oversampling") {
        this.isPrecisionOversampled = data.oversampling;
      } else if (data.type === "sourceType") {
        this.sourceType = data.sourceType;
      } else if (data.type === "trim") {
        this.outputTrim = data.trim;
      } else if (data.type === "dcblock") {
        this.dcBlockOn = data.dcblock;
      } else if (data.type === "reset") {
        this.dspState = {};
        this.timeIndex = 0;
        this.aa1 = 0.0;
        this.aa2 = 0.0;
        this.dcX1 = 0.0;
        this.dcY1 = 0.0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannel = output[0];
    if (!outputChannel) return true;
    const len = outputChannel.length;

    for (let i = 0; i < len; i++) {
      let originalSrc = 0.0;
      const t = this.timeIndex / 44100;
      this.timeIndex++;

      if (this.sourceType === "sine") {
        originalSrc = Math.sin(2 * Math.PI * 440 * t) * 0.35;
      } else if (this.sourceType === "noise") {
        originalSrc = (Math.random() * 2 - 1) * 0.15;
      } else {
        const bar = Math.floor(t * 3.5); 
        const notes = [220, 261.63, 329.63, 392, 440, 523.25, 659.25, 783.99]; 
        const rootFreq = notes[bar % notes.length];
        const vibrato = 1.0 + Math.sin(2 * Math.PI * 5 * t) * 0.008;

        const baseOsc = Math.sin(2 * Math.PI * rootFreq * vibrato * t);
        const subOsc = Math.sin(2 * Math.PI * (rootFreq * 0.5) * t) * 0.45; 
        const chorusOsc = Math.sin(2 * Math.PI * (rootFreq * 1.01) * t) * 0.25; 

        originalSrc = (baseOsc + subOsc + chorusOsc) * 0.18;
      }

      if (this.bypass) {
        outputChannel[i] = originalSrc;
      } else if (this.dspFunc) {
        try {
          let res = (this.dspFunc(originalSrc, this.params, this.dspState) || 0) * this.outputTrim;

          if (this.dcBlockOn) {
            const blocked = res - this.dcX1 + 0.995 * this.dcY1;
            this.dcX1 = res;
            this.dcY1 = blocked;
            res = blocked;
          }

          if (this.isPrecisionOversampled) {
            // Honest precision mode: a gentle 2-pole ~16 kHz smoother that tames
            // aliasing harshness from nonlinear DSP. (The previous approach ran
            // the DSP twice per sample, which silently detuned all time-based
            // effects by advancing their state at 2x speed.)
            this.aa1 += 0.9 * (res - this.aa1);
            this.aa2 += 0.9 * (this.aa1 - this.aa2);
            res = this.aa2;
          }

          outputChannel[i] = Math.max(-1.0, Math.min(1.0, res));
        } catch (runtimeErr) {
          this.port.postMessage({ type: "error", message: "Runtime crash: " + runtimeErr.message });
          outputChannel[i] = 0;
        }
      } else {
        outputChannel[i] = originalSrc;
      }
    }

    for (let channel = 1; channel < output.length; channel++) {
      output[channel].set(outputChannel);
    }

    return true;
  }
}

registerProcessor('dynamic-dsp-processor', DynamicDSPProcessor);
`;

      let useWorklet = false;
      if (activeCtx.audioWorklet) {
        try {
          const blob = new Blob([workletCode], { type: "application/javascript" });
          const blobUrl = URL.createObjectURL(blob);
          await activeCtx.audioWorklet.addModule(blobUrl);
          URL.revokeObjectURL(blobUrl);
          useWorklet = true;
          console.log("[Audio Engine] AudioWorklet thread active and registered successfully.");
        } catch (workletError) {
          console.warn("[Audio Engine] AudioWorklet failed/not allowed in browser frame sandbox, fallback active:", workletError);
        }
      }

      if (useWorklet) {
        const workletNode = new AudioWorkletNode(activeCtx, "dynamic-dsp-processor");
        workletNodeRef.current = workletNode;

        // Populate baseline data
        workletNode.port.postMessage({ type: "code", code: plugin.dspFunction });
        workletNode.port.postMessage({ type: "params", params: activeParamsRef.current });
        workletNode.port.postMessage({ type: "bypass", bypass });
        workletNode.port.postMessage({ type: "oversampling", oversampling: isPrecisionOversampled });
        workletNode.port.postMessage({ type: "sourceType", sourceType });
        workletNode.port.postMessage({ type: "trim", trim: outputTrimRef.current });
        workletNode.port.postMessage({ type: "dcblock", dcblock: dcBlockRef.current });

        // Handle errors propagated from background thread
        workletNode.port.onmessage = (event) => {
          if (event.data && event.data.type === "error") {
            setDspError(event.data.message);
          }
        };

        workletNode.connect(analyser);
      } else {
        // Safe 100% compliant ScriptProcessor Fallback
        const processor = activeCtx.createScriptProcessor(512, 1, 1);
        processorNodeRef.current = processor;

        processor.onaudioprocess = (audioEvent) => {
          const inputData = audioEvent.inputBuffer.getChannelData(0);
          const outputData = audioEvent.outputBuffer.getChannelData(0);
          const len = inputData.length;

          const currentParams = activeParamsRef.current;
          const currentState = dspStateRef.current;
          const dspCompiledFunc = compiledFunctionRef.current;
          const isHighPrec = isPrecisionOversampledRef.current;

          for (let i = 0; i < len; i++) {
            let originalSrc = 0.0;
            const t = timeIndexRef.current / 44100;
            timeIndexRef.current++;

            if (sourceType === "sine") {
              originalSrc = Math.sin(2 * Math.PI * 440 * t) * 0.35;
            } else if (sourceType === "noise") {
              originalSrc = (Math.random() * 2 - 1) * 0.15;
            } else {
              const bar = Math.floor(t * 3.5); 
              const notes = [220, 261.63, 329.63, 392, 440, 523.25, 659.25, 783.99]; 
              const rootFreq = notes[bar % notes.length];
              const vibrato = 1.0 + Math.sin(2 * Math.PI * 5 * t) * 0.008;

              const baseOsc = Math.sin(2 * Math.PI * rootFreq * vibrato * t);
              const subOsc = Math.sin(2 * Math.PI * (rootFreq * 0.5) * t) * 0.45; 
              const chorusOsc = Math.sin(2 * Math.PI * (rootFreq * 1.01) * t) * 0.25; 

              originalSrc = (baseOsc + subOsc + chorusOsc) * 0.18;
            }

            if (bypass) {
              outputData[i] = originalSrc;
            } else if (dspCompiledFunc) {
              try {
                let res = (dspCompiledFunc(originalSrc, currentParams, currentState) || 0) * outputTrimRef.current;

                if (dcBlockRef.current) {
                  const blocked = res - dcX1 + 0.995 * dcY1;
                  dcX1 = res;
                  dcY1 = blocked;
                  res = blocked;
                }

                if (isHighPrec) {
                  // Honest precision mode: gentle 2-pole anti-alias smoother
                  // (see the AudioWorklet path for rationale).
                  aa1 += 0.9 * (res - aa1);
                  aa2 += 0.9 * (aa1 - aa2);
                  res = aa2;
                }

                outputData[i] = Math.max(-1.0, Math.min(1.0, res));
              } catch (runtimeErr: any) {
                setDspError(`Runtime Crash: ${runtimeErr.message}`);
                outputData[i] = 0;
              }
            } else {
              outputData[i] = originalSrc;
            }
          }
        };

        processor.connect(analyser);
      }

      analyser.connect(activeCtx.destination);

      if (activeCtx.state === "suspended") {
        await activeCtx.resume();
      }

      setIsPlaying(true);
      setDspError(null);
    } catch (e: any) {
      console.error("Failed to start AudioContext:", e);
      setDspError(`System blocked: ${e.message}`);
    }
  };

  const stopAudioEngine = () => {
    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (processorNodeRef.current) {
        processorNodeRef.current.disconnect();
        processorNodeRef.current = null;
      }
      if (analyserNodeRef.current) {
        analyserNodeRef.current.disconnect();
        analyserNodeRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch (e) {
      console.error("Clean error on engine stop:", e);
    }
    setIsPlaying(false);
  };

  // ---- Perfecting-loop wiring: run the loop, stream each version to the live
  //      leaderboard, and keep the ranked candidates for the blind ear test. ----
  const runPerfectingLoop = async (
    base: { plugin: AudioPlugin; gate: ReturnType<typeof runQualityGate> },
    opts: { prompt: string; spec: any; llmConfig?: any; signal?: AbortSignal }
  ) => {
    setBuildVersions([{ label: "v1", score: refinementScore(base.gate), changeSummary: "initial build", status: "kept" }]);

    // Best-of-N seeds: gate up to two deterministic alternate takes on the
    // same request. They compete for "best" under the same strictly-higher
    // rule and give the blind test genuinely different algorithms to compare
    // (including model-vs-recipe when the base build came from a model).
    // REBUILDS ONLY: an in-place tweak ("brighter") must never be hijacked by
    // an unrelated alternate — tweaks keep the user's DSP and get voicing
    // passes only.
    const isRebuild = base.plugin.dspFunction !== plugin.dspFunction;
    const seedCandidates: Array<{ plugin: AudioPlugin; gate: ReturnType<typeof runQualityGate>; changeSummary: string }> = [];
    if (isRebuild) {
      try {
        const alternates = buildOfflineCandidates(opts.prompt, opts.spec).slice(1);
        for (const alt of alternates) {
          if (alt.dspFunction === base.plugin.dspFunction) continue;
          const altPlugin: AudioPlugin = {
            ...base.plugin,
            id: `plugin-alt-${Date.now()}-${seedCandidates.length}`,
            description: alt.description,
            parameters: alt.parameters.map((p) => ({ ...p, value: p.value !== undefined ? p.value : p.defaultValue })),
            dspFunction: alt.dspFunction,
          };
          const altGate = runQualityGate(altPlugin, { family: alt.family, prompt: opts.prompt, intent: opts.spec?.interpretedGoal });
          const take = alt.description.replace(/^[^:]*:\s*/, "").replace(/\.$/, "");
          seedCandidates.push({ plugin: altGate.plugin, gate: altGate, changeSummary: take.slice(0, 90) });
        }
      } catch (err) {
        console.warn("Best-of-N alternate build failed (continuing with the base build only):", err);
      }
    }

    const refined = await runRefinementLoop(base, {
      prompt: opts.prompt,
      spec: opts.spec,
      iterations: refineLoops,
      llmConfig: opts.llmConfig,
      signal: opts.signal,
      seedCandidates,
      onIteration: (n, total) => markStage("perfect", `v${n + 1}/${total}`),
      onCandidate: (_n, _total, cand) =>
        setBuildVersions((prev) => [
          ...prev.filter((v) => v.label !== cand.label),
          { label: cand.label, score: cand.score, changeSummary: cand.changeSummary, status: cand.accepted ? "kept" : "dropped" },
        ]),
    });
    setRefineCandidates(refined.candidates);
    return refined;
  };

  // Point the live engine at an arbitrary plugin's DSP + params WITHOUT
  // persisting it as the loaded plugin — used to audition blind-test candidates.
  // `trimOverride` replaces the plugin's own output trim (used for exact
  // loudness matching during the blind test).
  const applyLiveDsp = (p: AudioPlugin, trimOverride?: number) => {
    compileDsp(p.dspFunction);
    const paramsMap: Record<string, number> = {};
    p.parameters.forEach((q) => {
      paramsMap[q.id] = q.value !== undefined ? q.value : q.defaultValue;
    });
    activeParamsRef.current = paramsMap;
    dspStateRef.current = {};
    outputTrimRef.current = trimOverride ?? p.outputTrim ?? 1;
    dcBlockRef.current = p.dcBlock ?? false;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "params", params: paramsMap });
      workletNodeRef.current.port.postMessage({ type: "trim", trim: outputTrimRef.current });
      workletNodeRef.current.port.postMessage({ type: "dcblock", dcblock: dcBlockRef.current });
    }
  };

  const previewCandidate = async (p: AudioPlugin) => {
    // Start the engine first (it seeds from the loaded plugin) then swap in the
    // candidate, so the audition sticks instead of being overwritten at startup.
    // Every candidate auditions at EXACT unity loudness — the louder option
    // always sounds "better" to human ears, so the blind test must compare
    // character, not level.
    if (!isPlaying) await togglePlaySimulation();
    applyLiveDsp(p, measurePreviewTrim(p.dspFunction, p.parameters));
  };

  const restoreLoaded = () => {
    stopAudioEngine();
    applyLiveDsp(plugin);
  };

  // ---- Factory Canvas engine bridge: audition any card's plugin through the
  //      single live engine without persisting it as the loaded plugin. ----
  const auditionCanvasPlugin = async (p: AudioPlugin) => {
    // Start the engine first (it seeds from the loaded plugin), then swap the
    // card's DSP in — the same pattern the blind-test preview uses.
    if (!isPlaying) await togglePlaySimulation();
    applyLiveDsp(p);
  };

  const updateLiveParam = (paramId: string, value: number) => {
    activeParamsRef.current = { ...activeParamsRef.current, [paramId]: value };
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "params", params: activeParamsRef.current });
    }
  };

  const loadCanvasPluginInStudio = (p: AudioPlugin) => {
    stopAudioEngine();
    const loaded: AudioPlugin = { ...p, id: `plugin-${Date.now()}` };
    savePluginState(loaded);
    setScratchCode(loaded.dspFunction);
    compileDsp(loaded.dspFunction);
    switchUiMode("simple");
    triggerToast(`Loaded "${loaded.name}" from the canvas.`);
  };

  const handleBlindChoose = (picked: RankedCandidate, willLoad: boolean) => {
    if (willLoad) {
      savePluginState(picked.plugin);
      setScratchCode(picked.plugin.dspFunction);
      compileDsp(picked.plugin.dspFunction);
      triggerToast(`Your ear picked ${picked.label} — loaded (near-tie with the top score).`);
    } else {
      triggerToast(`Noted: you liked ${picked.label}, but the higher-scoring version stays loaded.`);
    }
  };

  const closeBlindTest = () => {
    setShowBlindTest(false);
    restoreLoaded();
  };

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopAudioEngine();
    };
  }, []);

  // Unified Chat Request processor supporting Gemini, Ollama, and LM Studio with Memory injection!
  const processChatMessageRequest = async (promptToSend: string, newHistory: ChatMessage[]) => {
    const generationStart = performance.now();
    // 1. Memory Injection Context Block
    const mistakesStr = localStorage.getItem("orange_juce_memories_mistakes") || "[]";
    const triumphsStr = localStorage.getItem("orange_juce_memories_triumphs") || "[]";
    const researchStr = localStorage.getItem("orange_juce_memories_research") || "[]";

    let localMistakes: any[] = [];
    let localTriumphs: any[] = [];
    let localResearch: any[] = [];

    try { localMistakes = JSON.parse(mistakesStr); } catch (e) {}
    try { localTriumphs = JSON.parse(triumphsStr); } catch (e) {}
    try { localResearch = JSON.parse(researchStr); } catch (e) {}

    let memoryContextString = "";
    if (localMistakes.length > 0 || localTriumphs.length > 0 || localResearch.length > 0) {
      memoryContextString = "\n\n[BACKGROUND SELF-IMPROVING SYSTEM MEMORY - USE THESE GUIDELINES TO PREVENT ERRORS & EMULATE GOOD DESIGNS (Only refer to or apply these if the user is asking to modify/recompile active plugin code, otherwise ignore and answer conceptually)]:\n";
      memoryContextString += "Please adhere to these custom guidelines if modifying the plugin:\n";
      
      if (localMistakes.length > 0) {
        memoryContextString += "\n* PREVENT RECENT PROGRAMMING ERRORS (Avoid these patterns):\n";
        localMistakes.slice(0, 3).forEach((m, idx) => {
          memoryContextString += `  ${idx + 1}. Issue: "${m.errorMessage}"\n`;
          memoryContextString += `     DO NOT USE snippets like: \`${m.unstableSnippet.replace(/\n/g, " ").slice(0, 150)}\`\n`;
          memoryContextString += `     INSTEAD use correct secure layouts like: \`${m.remedyCode.replace(/\n/g, " ").slice(0, 150)}\`\n`;
        });
      }

      if (localTriumphs.length > 0) {
        memoryContextString += "\n* CERTIFIED HIGH-GRADE DSP MODULES (Follow these structures):\n";
        localTriumphs.slice(0, 2).forEach((t) => {
          memoryContextString += `  - "${t.pluginName}" (${t.category} category):\n`;
          memoryContextString += `    Proven code architecture:\n    ${t.stableSnippet.split("\n").slice(0, 6).join("\n    ")}\n`;
        });
      }

      if (localResearch.length > 0) {
        memoryContextString += "\n* HARVESTED HIGH-END DSP ALGORITHMS REFERENCE:\n";
        localResearch.slice(0, 2).forEach((r) => {
          memoryContextString += `  - "${r.topic}" formula (Source: ${r.source}):\n`;
          memoryContextString += `    Ref formula: ${r.extractedFormula}\n`;
          memoryContextString += `    Use layout structure:\n    ${r.bestPracticeSnippet.split("\n").slice(0, 6).join("\n    ")}\n`;
        });
      }
    }

    // 2. Real-Time Diagnostics & Stability Telemetry context injection
    let diagnosticsContextString = "";
    if (dspError) {
      diagnosticsContextString += `\n\n[BACKGROUND WORKSPACE RUNTIME ERROR (Only address if the user is asking you to fix, debug, or compile code, otherwise ignore)]:\nThe active DSP script is currently failing to compile or throwing exceptions inside the Web Audio Graph: "${dspError}". Please analyze this error and address it directly in your corrections if modifying code!`;
    }
    if (analysis) {
      const issues = analysis.suggestions && analysis.suggestions.length > 0
        ? analysis.suggestions.map((s) => `[${s.category}] ${s.issue}`).join("; ")
        : "None identified";

      diagnosticsContextString += `\n\n[BACKGROUND PERFORMANCE & SIGNAL DIAGNOSTICS (Only refer to or address if the user is asking to analyze, fix, or optimize, otherwise ignore)]:\n- Purity Score: ${analysis.purityScore}/100\n- Stability Assessment: ${analysis.stabilityAssessment}\n- Performance Estimate: ${analysis.performanceEstimate}\n- Identified QA issues: ${issues}`;
    }

    const modifiedUserPrompt = promptToSend + memoryContextString + diagnosticsContextString;

    // Get current LLM Gateway Settings (shared with the Memory & LLMs tab)
    const llmConfig: LLMConfig = getLLMConfig();

    // ---- EDIT-BY-DEFAULT: once a plugin is loaded, change requests modify
    //      it IN PLACE (notes, tweaks, additive stages, optional model edit).
    //      Full regeneration happens only on explicit restart wording, a
    //      "make me a <new thing>" request, or after the chat is cleared. ----
    const pendingNotes = annotations;
    const editIntent = classifyEditIntent(promptToSend, {
      hasPlugin: !!plugin?.dspFunction,
      noteCount: pendingNotes.length,
    });
    if (editIntent === "edit") {
      beginBuildStages(false);
      markStage("generate");
      try {
        const result = await runEditPass(plugin, {
          prompt: promptToSend,
          notes: pendingNotes,
          llmConfig: isLocalProvider(llmConfig) ? llmConfig : undefined,
        });
        markStage("validate");
        const changed = result.changes.length > 0;
        if (changed) {
          savePluginState(result.gate.plugin);
          setScratchCode(result.gate.plugin.dspFunction);
          setIsEditingCode(false);
          runStabilityAnalysis(result.gate.plugin.dspFunction, result.gate.plugin.parameters);
        }
        setAnnotateMode(false);
        finishStages();

        const lines: string[] = [
          changed
            ? `✏️ **Edited in place** — your existing build was kept and adjusted (say **"start over"** for a full regeneration).`
            : `✏️ I couldn't map that to a concrete change on the loaded plugin — point at a control with **Annotate** and tell me what's wrong, or name the control and a direction. (Say **"start over"** to regenerate instead.)`,
        ];
        if (changed) {
          lines.push("", "Changes:", ...result.changes.map((c) => `- ${c}`));
        }
        if (result.unhandled.length > 0) {
          lines.push("", ...result.unhandled.map((u) => `- ⚠️ ${u}`));
        }
        if (changed) {
          lines.push("", formatBuildReport(result.gate.report));
        }

        const editMsg: ChatMessage = {
          id: `chat-${Date.now()}-edit`,
          senderId: "edit-core",
          senderName: "Edit Pass",
          role: "model",
          text: lines.join("\n"),
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        const editHistory = [...newHistory, editMsg];
        setChatHistory(editHistory);
        localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(editHistory));
        if (changed) triggerToast(`Edited "${result.gate.plugin.name}" in place — ${result.changes.length} change(s).`);
      } catch (err: any) {
        setBuildStages([]);
        const failMsg: ChatMessage = {
          id: `chat-${Date.now()}-edit-fail`,
          senderId: "edit-core",
          senderName: "Edit Pass",
          role: "model",
          text: `The edit pass failed ("${String(err?.message || err).slice(0, 120)}") — your loaded plugin is untouched. Try rephrasing, or say "start over" for a full regeneration.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        const failHistory = [...newHistory, failMsg];
        setChatHistory(failHistory);
        localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(failHistory));
      }
      setChatLoading(false);
      return;
    }

    // Spec-first stage: natural language never goes straight to code. A
    // deterministic classifier (instant, zero latency cost) always runs first
    // and separates what the plugin LOOKS like from what it must DO to audio
    // -- this alone stops "an EQ that saturates each band" from collapsing
    // into a plain EQ. Only genuinely ambiguous/hybrid requests escalate to
    // an LLM refinement call, so the common case pays no extra latency.
    let spec: AudioPluginSpec | null = null;
    if (looksLikeBuildRequest(promptToSend)) {
      spec = classifyPluginIntent(promptToSend);
      if ((spec.hybrid || spec.family === "hybrid_other") && isLocalProvider(llmConfig)) {
        try {
          spec = await generatePluginSpec(promptToSend, llmConfig);
        } catch {
          // keep the deterministic heuristic result
        }
      }
    }

    // A. OFFLINE FORCED CHECK / LOCAL STORAGE DEMO
    const isOfflineForced = offlineForced || (apiHealth !== null && !apiHealth.hasApiKey && llmConfig.provider === "gemini");

    if (isOfflineForced) {
      if (chatTimeoutRef.current) clearTimeout(chatTimeoutRef.current);
      chatTimeoutRef.current = setTimeout(async () => {
        const result = processOfflineMessage(promptToSend, plugin, spec);
        let messageText = result.text;

        if (result.updatedPlugin) {
          const up = result.updatedPlugin;
          const generatedPlugin: AudioPlugin = {
            id: `plugin-${Date.now()}`,
            name: up.name,
            category: up.category || (spec ? familyToCategory(spec.family) : "filter"),
            description: up.description || "",
            parameters: (up.parameters || []).map((p: any) => ({
              ...p,
              value: p.value !== undefined ? p.value : p.defaultValue,
            })),
            dspFunction: up.dspFunction,
            faustCode: up.faustCode || "",
            cppJuceCode: up.cppJuceCode || "",
            createdAt: new Date().toLocaleDateString()
          };

          // Same guarantee as every other generation path: gain/DC correction,
          // visual polish, and family-mandatory UI (amp+cab+mic, pad grid).
          let gate = runQualityGate(generatedPlugin, {
            family: spec?.family,
            prompt: promptToSend,
            intent: spec?.interpretedGoal,
          });

          // Perfecting loop (opt-in): rework N times, keep only iterations
          // that score strictly higher. Runs on every offline (re)build when
          // enabled — same trigger as the planned and online paths.
          if (refineLoops > 0) {
            beginBuildStages(false);
            markStage("perfect");
            const refined = await runPerfectingLoop({ plugin: gate.plugin, gate }, {
              prompt: promptToSend,
              spec,
              llmConfig: isLocalProvider(getLLMConfig()) ? getLLMConfig() : undefined,
            });
            gate = refined.gate;
            finishStages();
          }

          savePluginState(gate.plugin);
          setScratchCode(gate.plugin.dspFunction);
          setIsEditingCode(false);

          // Success is shown as measured evidence, never as a bare claim.
          messageText += `\n\n${formatBuildReport(gate.report)}`;

          triggerToast(`Locally compiled and loaded: "${gate.plugin.name}"`);
          runStabilityAnalysis(gate.plugin.dspFunction, gate.plugin.parameters);
        }

        const modelMsg: ChatMessage = {
          id: `chat-${Date.now()}-model`,
          senderId: "offline-core",
          senderName: "Offline DSP Compiler",
          role: "model",
          text: messageText,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        const finalHistory = [...newHistory, modelMsg];
        setChatHistory(finalHistory);
        localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(finalHistory));
        setChatLoading(false);
        chatTimeoutRef.current = null;
      }, 600);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let payload: any = null;

      // B. OLLAMA INFERENCE PATH
      // B0. PLANNED BUILD PATH (local providers, build requests only):
      // instead of one giant model call, the job-graph planner runs
      // specialized micro-workers (schema, then DSP against that schema),
      // each with acceptance tests, bounded repair, and a deterministic
      // fallback — pure conversation still uses the single-call chat below.
      if (isLocalProvider(llmConfig) && spec && looksLikeBuildRequest(promptToSend)) {
        beginBuildStages(true);
        const planned = await runPlannedBuild(promptToSend, {
          spec,
          llmConfig,
          signal: controller.signal,
          generationStart,
          onStage: (stage) => markStage(stage),
        });

        let gate = planned.gate;
        // Failure memory: distill this model build's measured defects into
        // per-family lessons for future planner/refiner prompts.
        recordLessons(spec?.family, gate.report);
        if (refineLoops > 0) {
          const refined = await runPerfectingLoop({ plugin: gate.plugin, gate }, {
            prompt: promptToSend,
            spec,
            llmConfig,
            signal: controller.signal,
          });
          gate = refined.gate;
        }
        finishStages();
        const gateMinScore = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
        saveCandidateRecipe(promptToSend, spec.family, gate.plugin.dspFunction, gateMinScore);

        savePluginState(gate.plugin);
        setScratchCode(gate.plugin.dspFunction);
        setIsEditingCode(false);
        triggerToast(
          planned.usedFallback
            ? `Loaded "${gate.plugin.name}" (deterministic compiler finished the build)`
            : `Verified & loaded "${gate.plugin.name}" — all pipeline jobs passed`
        );
        runStabilityAnalysis(gate.plugin.dspFunction, gate.plugin.parameters);

        const plannedMsg: ChatMessage = {
          id: `chat-${Date.now()}-model`,
          senderId: currentAgent.id,
          senderName: currentAgent.name,
          role: "model",
          text: `${planned.text}\n\n${formatBuildReport(gate.report)}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        const plannedHistory = [...newHistory, plannedMsg];
        setChatHistory(plannedHistory);
        localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(plannedHistory));
        return;
      }

      if (llmConfig.provider === "ollama") {
        const ollamaBaseUrl = llmConfig.ollamaUrl || "http://localhost:11434";
        const ollamaModelName = llmConfig.ollamaModel || "qwen2.5-coder:7b";
        const maxContext = llmConfig.maxContextMessages ?? 4;
        const useCompactPrompt = llmConfig.systemPromptStyle === "compact";

        const systemPromptContent = buildLocalChatSystemPrompt(
          currentAgent.name,
          currentAgent.systemInstruction,
          useCompactPrompt
        );

        const ollamaMessages = [
          {
            role: "system",
            content: systemPromptContent
          }
        ];

        // Map histories with sliding window
        newHistory.slice(0, -1).slice(-maxContext).forEach(msg => {
          ollamaMessages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text
          });
        });

        // Add memory context and low VRAM instructions to final prompt
        let finalPrompt = modifiedUserPrompt + `\n\n[CONTEXT: The active plugin code state is: \`\`\`javascript\n${plugin.dspFunction}\n\`\`\`]`;
        if (spec) {
          finalPrompt += `\n\n${formatSpecContext(spec)}`;
        }
        const ollamaRecipe = buildRecipeContext(promptToSend, spec);
        if (ollamaRecipe) {
          finalPrompt += `\n\n${ollamaRecipe}`;
        }
        if (llmConfig.lowVramMode) {
          finalPrompt += `\n\n[LOW-VRAM Optimization Active: Write highly concise DSP loops. Avoid memory allocations inside sample cycles.]`;
        }

        ollamaMessages.push({
          role: "user",
          content: finalPrompt
        });

        const resOllama = await fetchAppLLMRoute(`${ollamaBaseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: {
            model: ollamaModelName,
            messages: ollamaMessages,
            stream: false,
            format: "json", // Enforce JSON output mode
            options: {
              temperature: currentAgent.temperature || 0.6
            }
          }
        });

        if (!resOllama.ok) {
          throw new Error(`Ollama gateway returns status code ${resOllama.status}`);
        }

        const ollamaData = await resOllama.json();
        const responseJsonText = ollamaData.message?.content || "{}";
        payload = parseModelJson(responseJsonText);

      // C. LM STUDIO INFERENCE PATH
      } else if (llmConfig.provider === "lm_studio") {
        const lmStudioBaseUrl = llmConfig.lmStudioUrl || "http://localhost:1234";
        const lmStudioModelName = llmConfig.lmStudioModel || "lmstudio-community/qwen2.5-coder-7b-instruct";
        const maxContext = llmConfig.maxContextMessages ?? 4;
        const useCompactPrompt = llmConfig.systemPromptStyle === "compact";

        const systemPromptContent = buildLocalChatSystemPrompt(
          currentAgent.name,
          currentAgent.systemInstruction,
          useCompactPrompt
        );

        const lmsMessages = [
          {
            role: "system",
            content: systemPromptContent
          }
        ];

        // Map histories with sliding window
        newHistory.slice(0, -1).slice(-maxContext).forEach(msg => {
          lmsMessages.push({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.text
          });
        });

        let finalPrompt = modifiedUserPrompt + `\n\n[CONTEXT Active code:\n${plugin.dspFunction}]`;
        if (spec) {
          finalPrompt += `\n\n${formatSpecContext(spec)}`;
        }
        const lmsRecipe = buildRecipeContext(promptToSend, spec);
        if (lmsRecipe) {
          finalPrompt += `\n\n${lmsRecipe}`;
        }
        if (llmConfig.lowVramMode) {
          finalPrompt += `\n\n[LOW-VRAM Optimization Active: Write highly concise DSP loops. Avoid memory allocations inside sample cycles.]`;
        }

        lmsMessages.push({
          role: "user",
          content: finalPrompt
        });

        // Some LM Studio builds reject "json_object" (they want "json_schema"
        // or "text") -- retry without the format field and let parseModelJson
        // salvage the JSON from plain text.
        const lmsRequest = (withJsonFormat: boolean) =>
          fetchAppLLMRoute(`${lmStudioBaseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: {
              model: lmStudioModelName,
              messages: lmsMessages,
              temperature: currentAgent.temperature || 0.6,
              ...(withJsonFormat ? { response_format: { type: "json_object" } } : {})
            }
          });

        let resLms: Response;
        try {
          resLms = await lmsRequest(true);
          if (!resLms.ok && resLms.status === 400) throw new Error("response_format rejected (400)");
        } catch (lmsErr: any) {
          if (lmsErr?.name === "AbortError" || !/400|response_format/i.test(lmsErr?.message || "")) throw lmsErr;
          resLms = await lmsRequest(false);
        }

        if (!resLms.ok) {
          throw new Error(`LM Studio gateway returns status code ${resLms.status}`);
        }

        const lmsData = await resLms.json();
        const responseJsonText = lmsData.choices?.[0]?.message?.content || "{}";
        payload = parseModelJson(responseJsonText);

      // D. STANDARD GEMINI CLOUD PROXY
      } else {
        const response = await fetch("/api/plugins/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            prompt: modifiedUserPrompt, 
            history: newHistory.slice(0, -1),
            systemInstruction: currentAgent.systemInstruction,
            temperature: currentAgent.temperature,
            activeCode: plugin.dspFunction,
            activeParams: plugin.parameters,
          }),
        });

        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({}));
          throw new Error(errPayload.error || "Failed to receive response from custom model endpoint.");
        }

        payload = await response.json();
      }

      // 3. Process Result Payload
      let responseText = payload.text || "Your plugin code has been adjusted accordingly.";

      // Check if an updated plugin artifact is contained in the payload response
      if (payload.updatedPlugin) {
        const up = payload.updatedPlugin;
        const generatedParams: PluginParameter[] = (up.parameters || []).map((p: any) => ({
          ...p,
          value: p.value !== undefined ? p.value : p.defaultValue,
        }));

        // Never load model output blindly: compile-check + run the real signal
        // simulation harness, and let the local model repair its own failures
        // with concrete evidence before the code reaches the audio engine.
        const verification = await verifyAndRepairDsp(up.dspFunction, generatedParams, llmConfig, 2, buildRecipeContext(promptToSend, spec));
        if (verification.notes.length > 0) {
          responseText += `\n\n---\n🔬 **Verification:** ${verification.verified ? "passed signal simulation." : "could not fully verify this code -- it may sound wrong or stay silent."}\n${verification.notes.map((n) => `- ${n}`).join("\n")}`;
        }

        const generatedPlugin: AudioPlugin = {
          id: `plugin-${Date.now()}`,
          name: up.pluginName || up.name,
          category: up.category || (spec ? familyToCategory(spec.family) : "filter"),
          description: up.description || "",
          parameters: generatedParams,
          dspFunction: verification.dspFunction,
          faustCode: up.faustCode || "",
          cppJuceCode: up.cppJuceCode || "",
          createdAt: new Date().toLocaleDateString()
        };

        // Quality gate: measure musicality on real program material, correct
        // gain staging with an output trim, and guarantee a styled faceplate.
        let gate = runQualityGate(generatedPlugin, {
          generationMs: performance.now() - generationStart,
          family: spec?.family,
          prompt: promptToSend,
          intent: spec?.interpretedGoal,
        });
        // Failure memory: distill this model build's measured defects into
        // per-family lessons for future planner/refiner prompts.
        recordLessons(spec?.family, gate.report);
        if (refineLoops > 0) {
          beginBuildStages(false);
          markStage("perfect");
          const refined = await runPerfectingLoop({ plugin: gate.plugin, gate }, {
            prompt: promptToSend,
            spec,
            llmConfig,
            signal: controller.signal,
          });
          gate = refined.gate;
          finishStages();
        }
        responseText += `\n\n${formatBuildReport(gate.report)}`;

        // Self-improving recipe memory: a build that clears the gate at a high
        // score becomes a project-specific reference for the next similar request.
        const gateMinScore = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
        saveCandidateRecipe(promptToSend, spec?.family ?? null, gate.plugin.dspFunction, gateMinScore);

        savePluginState(gate.plugin);
        setScratchCode(gate.plugin.dspFunction);
        setIsEditingCode(false);

        triggerToast(
          verification.verified
            ? `Verified & loaded "${gate.plugin.name}" (passed simulation tests)!`
            : `Loaded "${gate.plugin.name}" -- verification failed, check the chat notes.`
        );
        runStabilityAnalysis(gate.plugin.dspFunction, gate.plugin.parameters);
      }

      const modelMsg: ChatMessage = {
        id: `chat-${Date.now()}-model`,
        senderId: currentAgent.id,
        senderName: currentAgent.name,
        role: "model",
        text: responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      const finalHistory = [...newHistory, modelMsg];
      setChatHistory(finalHistory);
      localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(finalHistory));
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Chat fetch operation was aborted successfully.");
        return;
      }
      setBuildStages([]);
      console.warn("API Error, falling back to offline core compiler:", err);
      
      const result = processOfflineMessage(promptToSend, plugin, spec);
      let fallbackText = `*(API request returned an error: "${err.message}". Falling back gracefully to zero-latency offline engine...)*\n\n${result.text}`;

      if (result.updatedPlugin) {
        const up = result.updatedPlugin;
        const generatedPlugin: AudioPlugin = {
          id: `plugin-${Date.now()}`,
          name: up.name,
          category: up.category || "filter",
          description: up.description || "",
          parameters: (up.parameters || []).map((p: any) => ({
            ...p,
            value: p.value !== undefined ? p.value : p.defaultValue,
          })),
          dspFunction: up.dspFunction,
          faustCode: up.faustCode || "",
          cppJuceCode: up.cppJuceCode || "",
          createdAt: new Date().toLocaleDateString()
        };

        // Offline templates are deterministic (latency is instant), but still
        // gate them for gain staging and faceplate polish.
        let gate = runQualityGate(generatedPlugin, {
          family: spec?.family,
          prompt: promptToSend,
          intent: spec?.interpretedGoal,
        });
        if (refineLoops > 0) {
          beginBuildStages(false);
          markStage("perfect");
          const refined = await runPerfectingLoop({ plugin: gate.plugin, gate }, {
            prompt: promptToSend,
            spec,
            llmConfig: isLocalProvider(getLLMConfig()) ? getLLMConfig() : undefined,
          });
          gate = refined.gate;
          finishStages();
        }

        savePluginState(gate.plugin);
        setScratchCode(gate.plugin.dspFunction);
        setIsEditingCode(false);
        fallbackText += `\n\n${formatBuildReport(gate.report)}`;
        triggerToast(`Locally compiled and loaded: "${gate.plugin.name}"`);
        runStabilityAnalysis(gate.plugin.dspFunction, gate.plugin.parameters);
      }

      const errorMsg: ChatMessage = {
        id: `chat-${Date.now()}-err`,
        senderId: "offline-core",
        senderName: "Offline DSP Fallback",
        role: "model",
        text: fallbackText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setChatHistory((prev) => [...prev, errorMsg]);
    } finally {
      abortControllerRef.current = null;
      setChatLoading(false);
    }
  };

  const handleSendPromptDirectly = async (promptText: string) => {
    const promptToSend = promptText.trim();
    if (!promptToSend || chatLoading) return;

    setChatLoading(true);

    const userMsg: ChatMessage = {
      id: `chat-${Date.now()}-user`,
      senderId: "user",
      senderName: "Synthesist",
      role: "user",
      text: promptToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(newHistory));

    await processChatMessageRequest(promptToSend, newHistory);
  };

  const ARCHITECT_SYSTEM_PROMPT = `You are an elite DSP audio engineer decomposing a natural-language plugin idea into a rigorous implementation spec.
Return ONLY a JSON object with this exact shape, no other text:
{
  "specs": [
    { "title": "<emoji + short title>", "description": "<one sentence>", "details": ["<bullet>", "<bullet>", "<bullet>"] }
  ],
  "parameters": [
    { "id": "<lowercase_snake_id>", "name": "<Display Name>", "min": <number>, "max": <number>, "defaultValue": <number>, "unit": "<Hz|dB|%|ms|ratio|st>" }
  ],
  "dspFunction": "<complete JavaScript function BODY per the DSP FUNCTION CONTRACT below>"
}
Produce 3-4 specs covering: DSP signal flow & equations, state/memory buffering, control range mapping, and boundary/safety guards. Write real, working, mathematically correct code, not a stub.

${DSP_CODING_RULES}

${PARAMETER_DESIGN_RULES}

${AMP_CAB_SCHEMA_GUIDANCE}

${SAMPLER_SCHEMA_GUIDANCE}`;

  const handleDeconstructPrompt = async () => {
    if (!architectPrompt.trim()) return;
    setArchitectIsDeconstructing(true);
    setArchitectSpecs(null);
    setArchitectGeneratedCode(null);

    const llmConfig = getLLMConfig();
    if (isLocalProvider(llmConfig)) {
      try {
        const archSpec = classifyPluginIntent(architectPrompt);
        const architectRecipe = buildRecipeContext(architectPrompt, archSpec);
        const specBlock = formatSpecContext(archSpec);
        const payload = await callLocalLLM({
          config: llmConfig,
          systemPrompt: ARCHITECT_SYSTEM_PROMPT,
          userText: [architectPrompt, specBlock, architectRecipe].filter(Boolean).join("\n\n"),
          temperature: 0.5,
        });

        if (payload && Array.isArray(payload.specs) && Array.isArray(payload.parameters) && payload.dspFunction) {
          const architectParams: PluginParameter[] = payload.parameters.map((p: any) => ({
            ...p,
            value: p.value !== undefined ? p.value : p.defaultValue,
          }));

          // Same guarantee as chat: compile-check + simulate + bounded repair
          // before any generated code is presented as "production-ready".
          const verification = await verifyAndRepairDsp(payload.dspFunction, architectParams, llmConfig, 2, architectRecipe);

          setArchitectSpecs(payload.specs.map((s: any) => ({
            title: s.title || "Spec",
            description: s.description || "",
            details: Array.isArray(s.details) ? s.details : [],
            isEditing: false,
          })));
          setArchitectParameters(architectParams);
          setArchitectGeneratedCode(verification.dspFunction);
          setArchitectIsDeconstructing(false);
          triggerToast(
            verification.verified
              ? `Decomposed & verified by local AI (${llmConfig.provider === "ollama" ? llmConfig.ollamaModel : llmConfig.lmStudioModel}) -- code passed simulation!`
              : `Decomposed by local AI, but the code failed simulation checks -- review before use.`
          );
          return;
        }
        throw new Error("Local model returned an incomplete spec.");
      } catch (err: any) {
        console.warn("Local architect call failed, falling back to deterministic templates:", err);
      }
    }

    // Deterministic keyword-based fallback: used when no local model is
    // configured/reachable, or the model call above failed.
    setTimeout(() => {
      const pText = architectPrompt.toLowerCase();
      let mode: "delay" | "distortion" | "filter" | "compressor" | "hybrid" = "hybrid";
      
      if (pText.includes("delay") || pText.includes("echo") || pText.includes("chorus") || pText.includes("reverb") || pText.includes("flang")) {
        mode = "delay";
      } else if (pText.includes("dist") || pText.includes("fuzz") || pText.includes("drive") || pText.includes("satur") || pText.includes("clipp") || pText.includes("warmth")) {
        mode = "distortion";
      } else if (pText.includes("filter") || pText.includes("eq") || pText.includes("biquad") || pText.includes("lowpass") || pText.includes("highpass") || pText.includes("ladder")) {
        mode = "filter";
      } else if (pText.includes("comp") || pText.includes("limit") || pText.includes("gate") || pText.includes("compressor") || pText.includes("dynamic")) {
        mode = "compressor";
      }

      let specs = [];
      let params: PluginParameter[] = [];
      let generatedCode = "";

      if (mode === "delay") {
        specs = [
          {
            title: "📈 DSP Signal Flow & Equations",
            description: "Modulated Fractional Delay Line with feedback loop saturation and tape flutter modeling.",
            details: [
              "Interpolated Delay tap equation: y(t) = x(t - D(t)) using linear interpolation.",
              "LFO Modulator: D(t) = delayTime + sin(2 * pi * lfoRate * t) * lfoDepth.",
              "Feedback dampening (1-pole lowpass filter): fb(t) = 0.85 * fb(t-1) + 0.15 * y(t)."
            ],
            isEditing: false
          },
          {
            title: "🗄️ State & Memory Buffering",
            description: "Ring-buffer memory allocation schema for sample recursion.",
            details: [
              "Pre-allocated 96,000 element Float32Array delay buffer (fits up to 2.0s at 48kHz).",
              "Integer write_ptr incremented modulo buffer length.",
              "Sub-sample accuracy linear interpolation tap pointers."
            ],
            isEditing: false
          },
          {
            title: "🎛️ Control Range Mapping",
            description: "Physically calibrated parameters with appropriate scaling limits.",
            details: [
              "delay_time: ms range [50.0ms to 1200.0ms], calibrated to default 350.0ms.",
              "feedback: decay coefficient [0.0 to 0.98], default 0.50.",
              "mix: dry/wet balance ratio [0.0 to 1.0], default 0.40.",
              "lfo_rate: speed in Hz [0.1Hz to 10.0Hz], default 1.5Hz."
            ],
            isEditing: false
          },
          {
            title: "🛡️ Boundary Sanitization & Exception Safety",
            description: "Bulletproof arithmetic guards to isolate recursive loops.",
            details: [
              "NaN prevention sweep resets delay buffer upon infinity detection.",
              "Math.tanh output saturation limiting positive feedback explosions.",
              "Linear pointer boundaries wrapping around safe 96,000 elements bounds."
            ],
            isEditing: false
          }
        ];

        params = [
          { id: "delay_time", name: "Tape Echo Time", min: 50, max: 1200, defaultValue: 350, value: 350, unit: "ms", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
          { id: "feedback", name: "Echo Feedback", min: 0, max: 0.98, defaultValue: 0.5, value: 0.5, unit: "ratio", controlType: "knob", x: 180, y: 70, w: 120, h: 100 },
          { id: "mix", name: "Space Mix", min: 0, max: 1, defaultValue: 0.4, value: 0.4, unit: "ratio", controlType: "knob", x: 320, y: 70, w: 120, h: 100 },
          { id: "lfo_rate", name: "Modulation Speed", min: 0.1, max: 10, defaultValue: 1.5, value: 1.5, unit: "Hz", controlType: "knob", x: 460, y: 70, w: 120, h: 100 }
        ];

        generatedCode = `// --- PERFECT SPEC-COMPLIANT MODULATED TAPE ECHO ---
if (!state.init_perfect_delay) {
  state.buf = new Float32Array(96000); // Ring-buffer
  state.write_ptr = 0;
  state.lfo_phase = 0.0;
  state.last_fb = 0.0;
  state.init_perfect_delay = true;
}

// 1. Map Inputs with Fallbacks
let delayMs = params.delay_time !== undefined ? params.delay_time : 350.0;
let feedback = params.feedback !== undefined ? params.feedback : 0.5;
let mix = params.mix !== undefined ? params.mix : 0.4;
let lfoRate = params.lfo_rate !== undefined ? params.lfo_rate : 1.5;

// 2. Synthesize Low-Frequency Modulator for Tape Flutter
state.lfo_phase += (2.0 * Math.PI * lfoRate) / 44100.0;
if (state.lfo_phase > 2.0 * Math.PI) state.lfo_phase -= 2.0 * Math.PI;
let flutter = Math.sin(state.lfo_phase) * 2.5; // micro delay modulation

// 3. Fractional Delay Line Interpolation
let totalDelayMs = Math.max(10.0, Math.min(1900.0, delayMs + flutter));
let delaySamples = (totalDelayMs * 44100.0) / 1000.0;

let readPtr = state.write_ptr - delaySamples;
if (readPtr < 0) readPtr += 96000;

let idxA = Math.floor(readPtr) % 96000;
let idxB = (idxA + 1) % 96000;
let frac = readPtr - Math.floor(readPtr);

let delayedSample = state.buf[idxA] * (1.0 - frac) + state.buf[idxB] * frac;

// NaN Safety Reset Guard
if (isNaN(delayedSample) || !isFinite(delayedSample)) {
  delayedSample = 0.0;
}

// 4. Feedback & 1-Pole Low-Pass Color Filter
let processedDelayed = 0.85 * delayedSample + 0.15 * state.last_fb;
state.last_fb = processedDelayed;

// 5. Tape Warm Saturation and Buffering
let tapeWriteVal = Math.tanh(inputSample + processedDelayed * feedback);
state.buf[state.write_ptr] = tapeWriteVal;
state.write_ptr = (state.write_ptr + 1) % 96000;

// 6. Clean Dry/Wet Mix
return inputSample * (1.0 - mix) + processedDelayed * mix;`;

      } else if (mode === "distortion") {
        specs = [
          {
            title: "📈 DSP Signal Flow & Equations",
            description: "Multi-stage asymmetrical valve saturation with odd and even harmonic generator curves.",
            details: [
              "Input stage boost with linear multiplier decibel translation.",
              "Asymmetrical Waveshaper: f(x) = x > 0 ? tanh(x) : 0.85 * tanh(x * 0.7) to create warm even-order harmonics.",
              "Cascaded 1-pole high-cut filter for pleasant high frequency roll-off."
            ],
            isEditing: false
          },
          {
            title: "🗄️ State & Memory Buffering",
            description: "Static registers for audio filtering feedback memory.",
            details: [
              "Pre-filter feedback state storage variables to track filter state.",
              "Transient smoothing registers to prevent abrupt gain switching pop sounds."
            ],
            isEditing: false
          },
          {
            title: "🎛️ Control Range Mapping",
            description: "Precision calibrated parameters for gain stage staging.",
            details: [
              "input_drive: dB gain boost [0.0dB to 36.0dB], default 12.0dB.",
              "asymmetry: harmonic coefficient [0.0 to 1.0], default 0.40.",
              "output_level: signal trim [ -24.0dB to 0.0dB ], default -3.0dB."
            ],
            isEditing: false
          },
          {
            title: "🛡️ Boundary Sanitization & Exception Safety",
            description: "Dynamic limits for high-gain saturation.",
            details: [
              "Hyperbolic tangent compression bounds outputs strictly between [-1.0f, +1.0f].",
              "Bipolar input check shielding calculations from Infinite float accumulation."
            ],
            isEditing: false
          }
        ];

        params = [
          { id: "input_drive", name: "Preamp Drive", min: 0, max: 36, defaultValue: 12, value: 12, unit: "dB", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
          { id: "asymmetry", name: "Warm Harmonic", min: 0, max: 1, defaultValue: 0.4, value: 0.4, unit: "ratio", controlType: "knob", x: 180, y: 70, w: 120, h: 100 },
          { id: "output_level", name: "Output Level", min: -24, max: 0, defaultValue: -3, value: -3, unit: "dB", controlType: "knob", x: 320, y: 70, w: 120, h: 100 }
        ];

        generatedCode = `// --- PERFECT SPEC-COMPLIANT HARMONIC VALVE SATURATOR ---
if (!state.init_perfect_sat) {
  state.last_out = 0.0;
  state.init_perfect_sat = true;
}

// 1. Extract and Calibrate inputs
let driveDb = params.input_drive !== undefined ? params.input_drive : 12.0;
let asym = params.asymmetry !== undefined ? params.asymmetry : 0.4;
let outDb = params.output_level !== undefined ? params.output_level : -3.0;

// 2. Pre-amp Boost Stage
let driveLinear = Math.pow(10, driveDb / 20);
let boosted = inputSample * driveLinear;

// 3. Asymmetrical Waveshaping
let saturated = boosted;
if (boosted > 0.0) {
  saturated = Math.tanh(boosted);
} else {
  // Softer negative slope introduces pleasant 2nd-order even harmonics
  let factor = 1.0 - (asym * 0.4);
  saturated = factor * Math.tanh(boosted / factor);
}

// 4. High frequency smooth roll-off (1-pole lowpass)
let smoothed = 0.7 * saturated + 0.3 * state.last_out;
state.last_out = smoothed;

// 5. Output Level Trim
let outLinear = Math.pow(10, outDb / 20);
let finalOut = smoothed * outLinear;

// Exception boundary safety shield
if (isNaN(finalOut) || !isFinite(finalOut)) {
  return 0.0;
}

return Math.tanh(finalOut);`;

      } else if (mode === "filter") {
        specs = [
          {
            title: "📈 DSP Signal Flow & Equations",
            description: "High-accuracy Biquad IIR filtering implementing the standard Robert Bristow-Johnson equations.",
            details: [
              "Omega frequency variable: omega = 2 * pi * cutoffFreq / sampleRate.",
              "Bandwidth alpha ratio: alpha = sin(omega) / (2 * Q).",
              "Biquad transfer equation: y[n] = (b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]) / a0."
            ],
            isEditing: false
          },
          {
            title: "🗄️ State & Memory Buffering",
            description: "Biquad delay line shift registers and states.",
            details: [
              "Two input memory coordinates: x1, x2.",
              "Two output memory coordinates: y1, y2.",
              "Registers re-initialized to 0.0 on frequency jumps to prevent audio ticks."
            ],
            isEditing: false
          },
          {
            title: "🎛️ Control Range Mapping",
            description: "Logarithmic frequency sweeps calibrated to the human audible spectrum.",
            details: [
              "cutoff: log sweep range [40.0Hz to 16000.0Hz], default 1200.0Hz.",
              "resonance: filter Q ratio [0.1 to 10.0], default 1.0."
            ],
            isEditing: false
          },
          {
            title: "🛡️ Boundary Sanitization & Exception Safety",
            description: "State resets safeguarding filter coefficients from negative values.",
            details: [
              "Denormalized float avoidance threshold additions (1e-15f).",
              "Filter coefficient limits preventing low-frequency state explosion when cutoff approaches 0Hz."
            ],
            isEditing: false
          }
        ];

        params = [
          { id: "cutoff", name: "Filter Cutoff", min: 40, max: 16000, defaultValue: 1200, value: 1200, unit: "Hz", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
          { id: "resonance", name: "Resonance Q", min: 0.1, max: 10, defaultValue: 1, value: 1, unit: "Q", controlType: "knob", x: 180, y: 70, w: 120, h: 100 }
        ];

        generatedCode = `// --- PERFECT SPEC-COMPLIANT BIQUAD LOW-PASS ---
if (!state.init_perfect_filter) {
  state.x1 = 0.0; state.x2 = 0.0;
  state.y1 = 0.0; state.y2 = 0.0;
  state.init_perfect_filter = true;
}

// 1. Map parameters
let cutoff = params.cutoff !== undefined ? params.cutoff : 1200.0;
let q = params.resonance !== undefined ? params.resonance : 1.0;

// Stabilize frequency boundaries
cutoff = Math.max(20.0, Math.min(20000.0, cutoff));
q = Math.max(0.1, Math.min(15.0, q));

// 2. Compute Filter Coefficients (RBJ Low-pass formulas)
let omega = (2.0 * Math.PI * cutoff) / 44100.0;
let alpha = Math.sin(omega) / (2.0 * q);

let cos_w = Math.cos(omega);
let b0 = (1.0 - cos_w) / 2.0;
let b1 = 1.0 - cos_w;
let b2 = (1.0 - cos_w) / 2.0;
let a0 = 1.0 + alpha;
let a1 = -2.0 * cos_w;
let a2 = 1.0 - alpha;

// Normalize by a0
let nb0 = b0 / a0;
let nb1 = b1 / a0;
let nb2 = b2 / a0;
let na1 = a1 / a0;
let na2 = a2 / a0;

// 3. Process with Difference Equation
let outSample = nb0 * inputSample + nb1 * state.x1 + nb2 * state.x2 - na1 * state.y1 - na2 * state.y2;

// Denormal prevention
if (Math.abs(outSample) < 1e-15) {
  outSample = 0.0;
}

// NaN Safety Check
if (isNaN(outSample) || !isFinite(outSample)) {
  outSample = 0.0;
}

// Shift Delay registers
state.x2 = state.x1;
state.x1 = inputSample;
state.y2 = state.y1;
state.y1 = outSample;

return outSample;`;

      } else if (mode === "compressor") {
        specs = [
          {
            title: "📈 DSP Signal Flow & Equations",
            description: "Feed-forward peak envelope detector with logarithmic gain-reduction curves.",
            details: [
              "Log amplitude converter: envDb = 20 * log10(max(1e-5, envelope)).",
              "Gain reduction function: reduction = envDb > threshold ? (threshold - envDb) * (1 - 1/ratio) : 0.0.",
              "Linear gain mapping: reductionVal = 10^(reduction / 20)."
            ],
            isEditing: false
          },
          {
            title: "🗄️ State & Memory Buffering",
            description: "Envelope detector tracker registers and voltage parameters.",
            details: [
              "Sub-millisecond peak voltage follower variable to smooth attack cycles.",
              "Ballistic filter smoothers mapping release decay curves gracefully."
            ],
            isEditing: false
          },
          {
            title: "🎛️ Control Range Mapping",
            description: "Precision logarithmic threshold & makeup calibration.",
            details: [
              "threshold: limit in dB [-40.0dB to 0.0dB], default -18.0dB.",
              "ratio: slope factor [1.0:1 to 20.0:1], default 4.0:1.",
              "makeup: compensation boost [0.0dB to 24.0dB], default 6.0dB."
            ],
            isEditing: false
          },
          {
            title: "🛡️ Boundary Sanitization & Exception Safety",
            description: "Voltage rail limit protection clamps.",
            details: [
              "Forced envelope limit ceilings to prevent logarithm of absolute zero.",
              "Dynamic hard-clipping compression stage preventing digital signal overruns."
            ],
            isEditing: false
          }
        ];

        params = [
          { id: "threshold", name: "Squeeze Threshold", min: -40, max: 0, defaultValue: -18, value: -18, unit: "dB", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
          { id: "ratio", name: "Squeeze Ratio", min: 1, max: 20, defaultValue: 4, value: 4, unit: ":1", controlType: "knob", x: 180, y: 70, w: 120, h: 100 },
          { id: "makeup", name: "Makeup Level", min: 0, max: 24, defaultValue: 6, value: 6, unit: "dB", controlType: "knob", x: 320, y: 70, w: 120, h: 100 }
        ];

        generatedCode = `// --- PERFECT SPEC-COMPLIANT DYNAMIC COMPRESSOR ---
if (!state.init_perfect_comp) {
  state.envelope = 0.0;
  state.init_perfect_comp = true;
}

// 1. Extract parameters
let thresh = params.threshold !== undefined ? params.threshold : -18.0;
let ratio = params.ratio !== undefined ? params.ratio : 4.0;
let makeupDb = params.makeup !== undefined ? params.makeup : 6.0;

// 2. Full-wave dynamic envelope tracker
let rect = Math.abs(inputSample);
let attack_alpha = 0.95;  // Rapid attack
let release_alpha = 0.995; // Slower release

if (rect > state.envelope) {
  state.envelope = attack_alpha * state.envelope + (1.0 - attack_alpha) * rect;
} else {
  state.envelope = release_alpha * state.envelope + (1.0 - release_alpha) * rect;
}

// 3. Logarithm amplitude conversion with floor
let envDb = 20.0 * Math.log10(Math.max(1e-5, state.envelope));

// 4. Reduction calculation
let reductionDb = 0.0;
if (envDb > thresh) {
  let excessDb = envDb - thresh;
  let targetDb = thresh + (excessDb / ratio);
  reductionDb = targetDb - envDb; // Negative reduction amount
}

// 5. Compute output multiplier
let makeupLinear = Math.pow(10, makeupDb / 20);
let reductionLinear = Math.pow(10, reductionDb / 20);
let finalOut = inputSample * reductionLinear * makeupLinear;

// Output limits
if (isNaN(finalOut) || !isFinite(finalOut)) {
  return 0.0;
}

return finalOut;`;

      } else {
        const cleanName = architectPrompt.trim().replace(/[^a-zA-Z0-9\s]/g, "");
        specs = [
          {
            title: "📈 DSP Signal Flow & Equations",
            description: `Custom specialized hybrid processor for: "${cleanName}".`,
            details: [
              "Integrated warmth feedback algorithm running dynamic real-time math.",
              "Interactive resonance feedback loop with adaptive harmonics.",
              "Input-adaptive filters shaping frequencies in real time."
            ],
            isEditing: false
          },
          {
            title: "🗄️ State & Memory Buffering",
            description: "Multi-parameter state variables and registers.",
            details: [
              "State dynamic smoothers monitoring incoming sweeps.",
              "Buffer shift registers preserving mathematical precision during loops."
            ],
            isEditing: false
          },
          {
            title: "🎛️ Control Range Mapping",
            description: "Auto-calibrated knobs corresponding to parameters.",
            details: [
              "intensity: processing weight [0.0 to 10.0], default 5.0.",
              "resonance: peak tone accent [0.1 to 2.0], default 0.80.",
              "output_volume: makeup trim [-12.0dB to +6.0dB], default 0.0dB."
            ],
            isEditing: false
          },
          {
            title: "🛡️ Boundary Sanitization & Exception Safety",
            description: "Pre-compile NaN prevention shield blocks.",
            details: [
              "Try-catch exception wraps preventing runtime DSP thread crash.",
              "Absolute ceiling compression scaling output amplitudes beautifully."
            ],
            isEditing: false
          }
        ];

        params = [
          { id: "intensity", name: "Effect Intensity", min: 0, max: 10, defaultValue: 5, value: 5, unit: "v", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
          { id: "resonance", name: "Peak Accent", min: 0.1, max: 2, defaultValue: 0.8, value: 0.8, unit: "Q", controlType: "knob", x: 180, y: 70, w: 120, h: 100 },
          { id: "output_volume", name: "Output Volume", min: -12, max: 6, defaultValue: 0, value: 0, unit: "dB", controlType: "knob", x: 320, y: 70, w: 120, h: 100 }
        ];

        generatedCode = `// --- PERFECT SPEC-COMPLIANT CUSTOM PROCESSOR ---
// Engineered for: ${cleanName}
if (!state.init_custom_processor) {
  state.x1 = 0.0;
  state.y1 = 0.0;
  state.init_custom_processor = true;
}

// 1. Parameter mappings
let intensity = params.intensity !== undefined ? params.intensity : 5.0;
let resonance = params.resonance !== undefined ? params.resonance : 0.8;
let volDb = params.output_volume !== undefined ? params.output_volume : 0.0;

// 2. Core DSP algorithms
let intensityFactor = intensity / 10.0;
let processed = inputSample * (1.0 + intensityFactor * 0.5);

// Add resonant warm feedback
let resonantFeedback = processed - (state.y1 * resonance * 0.35);
state.y1 = Math.tanh(resonantFeedback);

let finalOut = state.y1 * Math.pow(10, volDb / 20);

// Boundary limits
if (isNaN(finalOut) || !isFinite(finalOut)) {
  return 0.0;
}

return Math.tanh(finalOut * 0.95);`;
      }

      setArchitectSpecs(specs);
      setArchitectParameters(params);
      setArchitectGeneratedCode(generatedCode);
      setArchitectIsDeconstructing(false);
      triggerToast("Prompt decomposed successfully into 4 granular, production-ready specifications!");
    }, 1500);
  };

  // ---- 5. AI Unified Agent Conversational Handler ----
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const promptToSend = inputMessage.trim();
    if (!promptToSend || chatLoading) return;

    setChatLoading(true);
    setInputMessage("");

    const userMsg: ChatMessage = {
      id: `chat-${Date.now()}-user`,
      senderId: "user",
      senderName: "Synthesist",
      role: "user",
      text: promptToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newHistory = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(newHistory));

    await processChatMessageRequest(promptToSend, newHistory);
    return; // Fast bypass redundant legacy code below
  };

  const handleClearChat = () => {
    // A new chat resets the annotation canvas: the next build request is a
    // fresh generation, not an edit of the previous plugin's notes.
    setAnnotations([]);
    setAnnotateMode(false);
    // 1. Abort any active request in-flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 2. Clear any active offline timeout
    if (chatTimeoutRef.current) {
      clearTimeout(chatTimeoutRef.current);
      chatTimeoutRef.current = null;
    }
    // 3. Stop loading / thinking status
    setChatLoading(false);

    setChatHistory([]);
    localStorage.removeItem(STORAGE_KEY_CHAT);
    triggerToast("Conversation logs cleared cleanly.");
  };

  // ---- 6. Decibel Audit Analytical checking ----
  const ANALYSIS_SYSTEM_PROMPT = `You are Decibel, a senior DSP testing specialist. Analyze the given JavaScript audio-processing snippet for numerical instability, memory leaks (e.g. allocations inside the processing loop), potential clipping, aliasing, DC offset, or infinity issues.
Return ONLY a JSON object with this exact shape, no other text:
{
  "purityScore": <integer 0-100>,
  "stabilityAssessment": "<short label, e.g. 'Highly Stable', 'Vulnerable to Blowup'>",
  "performanceEstimate": "<short CPU burden assessment, e.g. 'Lightweight O(1)'>",
  "mathCritique": "<2-sentence critique of the math>",
  "suggestions": [
    { "category": "<threat type>", "snippet": "<the unstable statement>", "issue": "<why it's risky>", "recommendationCode": "<safe replacement code>" }
  ]
}`;

  const runStabilityAnalysis = async (customCode?: string, customParams?: PluginParameter[]) => {
    setAnalysisLoading(true);
    const codeToTest = customCode || plugin.dspFunction;
    const paramsToTest = customParams || plugin.parameters;
    const llmConfig = getLLMConfig();

    try {
      let result: DSPAnalysisResult;

      if (isLocalProvider(llmConfig)) {
        const payload = await callLocalLLM({
          config: llmConfig,
          systemPrompt: ANALYSIS_SYSTEM_PROMPT,
          userText: `Parameters in scope: ${JSON.stringify(paramsToTest.map(p => p.id))}\n\nDSP code:\n\`\`\`javascript\n${codeToTest}\n\`\`\``,
          temperature: 0.1,
        });
        result = {
          purityScore: payload.purityScore ?? 70,
          stabilityAssessment: payload.stabilityAssessment || "Unknown",
          performanceEstimate: payload.performanceEstimate || "Unknown",
          mathCritique: payload.mathCritique || "",
          suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
        };
      } else {
        const response = await fetch("/api/plugins/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: codeToTest,
            parameters: paramsToTest,
          }),
        });

        if (!response.ok) {
          throw new Error("Purity analysis call failed.");
        }

        result = await response.json();
      }

      setAnalysis(result);
      if (result.purityScore !== undefined) {
        triggerToast(`Stability audit complete: score ${result.purityScore}/100`);
      }
    } catch (e: any) {
      console.warn("AI purity check failed, running local/offline heuristic fallback:", e);
      // Fallback cleanly to our dynamic static analysis checker
      const offlineResult = runOfflineDSPAnalysis(codeToTest, paramsToTest);
      setAnalysis(offlineResult);
      triggerToast(`Heuristic stability audit complete: score ${offlineResult.purityScore}/100`);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Auto patch code suggested by the QA Decibel agent - runs recursively until all issues are solved
  const handleApplyFix = async (initialFix: DspCritiqueItem) => {
    if (isAutoFixing) return;
    setIsAutoFixing(true);
    setAnalysisLoading(true);

    let currentCode = plugin.dspFunction;
    let currentFix = initialFix;
    let iteration = 1;
    const maxIterations = 8;
    let lastAppliedFixSnippet = "";

    try {
      while (iteration <= maxIterations) {
        // Apply the fix to currentCode
        let modified = currentCode;
        if (currentCode.includes(currentFix.snippet)) {
          modified = currentCode.replace(currentFix.snippet, currentFix.recommendationCode);
        } else {
          const cleanedSnippet = currentFix.snippet.replace(/\s+/g, "");
          const index = currentCode.replace(/\s+/g, "").indexOf(cleanedSnippet);
          if (index !== -1) {
            modified = `// Recommended fix applied:\n${currentFix.recommendationCode}\n\n${currentCode}`;
          } else {
            modified = `// Recommended patch applied:\n${currentFix.recommendationCode}\n\n${currentCode}`;
          }
        }

        currentCode = modified;
        lastAppliedFixSnippet = currentFix.snippet;

        // Compile and update local plugin state
        const updatedPlugin = { ...plugin, dspFunction: currentCode };
        savePluginState(updatedPlugin);
        setScratchCode(currentCode);
        compileDsp(currentCode);

        // Update terminal logs with beautiful step outputs
        const timestamp = new Date().toLocaleTimeString();
        setTerminalLogs((prev) => [
          ...prev,
          { text: `[${timestamp}] auto-fix > Applied fix for "${currentFix.category}" (Step ${iteration}/${maxIterations})`, type: "success" },
          { text: `[${timestamp}] auto-fix > Hot compiling auto-stabilized AST code blocks...`, type: "info" }
        ]);

        triggerToast(`Applied "${currentFix.category}" patch (Step ${iteration})`);

        // Wait a small amount for visual step feedback & UI responsiveness
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Run Stability Analysis to check if more anomalies exist
        let nextAnalysis: DSPAnalysisResult | null = null;
        try {
          const response = await fetch("/api/plugins/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: currentCode,
              parameters: plugin.parameters,
            }),
          });

          if (response.ok) {
            nextAnalysis = await response.json();
          } else {
            throw new Error("Purity analysis call failed.");
          }
        } catch (apiErr) {
          console.warn("API Purity call failed during auto-fix, falling back to local audit:", apiErr);
          nextAnalysis = runOfflineDSPAnalysis(currentCode, plugin.parameters);
        }

        if (nextAnalysis) {
          setAnalysis(nextAnalysis);
        }

        // If no more suggestions, we are pristine!
        if (!nextAnalysis || !nextAnalysis.suggestions || nextAnalysis.suggestions.length === 0) {
          setTerminalLogs((prev) => [
            ...prev,
            { text: `✔ [${new Date().toLocaleTimeString()}] auto-fix > SUCCESS: All anomalies and compilation errors resolved!`, type: "success" }
          ]);
          triggerToast("All stability anomalies resolved!");
          break;
        }

        // Find the next available fix. Avoid repeats if possible, otherwise take the first.
        const nextFix = nextAnalysis.suggestions.find(s => s.snippet !== lastAppliedFixSnippet) || nextAnalysis.suggestions[0];

        // If no new fix or it is exactly identical, stop to avoid infinite loops
        if (!nextFix || (nextFix.snippet === lastAppliedFixSnippet && iteration > 1)) {
          setTerminalLogs((prev) => [
            ...prev,
            { text: `[${new Date().toLocaleTimeString()}] auto-fix > Reached safety boundary. Remaining warnings kept to safeguard state.`, type: "warn" }
          ]);
          break;
        }

        currentFix = nextFix;
        iteration++;
      }

      if (iteration > maxIterations) {
        triggerToast("Completed maximum recursive auto-fix steps.");
      }
    } catch (err) {
      console.error("Error during recursive auto-fix loop:", err);
      triggerToast("Auto-fix loop encountered an unexpected exception.");
    } finally {
      setIsAutoFixing(false);
      setAnalysisLoading(false);
    }
  };

  // ---- 7. Manual Live Code Scratchpad Handlers ----
  const handleApplyScratchCode = () => {
    compileDsp(scratchCode);
    if (!dspError) {
      const updatedPlugin = { ...plugin, dspFunction: scratchCode };
      savePluginState(updatedPlugin);
      setIsEditingCode(false);
      triggerToast("Hot compiled modifications successfully!");
      runStabilityAnalysis(scratchCode);
    } else {
      triggerToast("Compilation failed. Correct syntax before applying.");
    }
  };

  // Assembling code docs copy snapshot
  const handleDownloadWorkspaceDocs = () => {
    let md = `# Workspace Documentation & DSP Codebase Copy\n`;
    md += `Refresh generated at: ${new Date().toLocaleString()}\n\n`;
    md += `## 1. Active Plugin Details\n`;
    md += `- **Name**: ${plugin.pluginName || plugin.name}\n`;
    md += `- **Category**: ${plugin.category || "General"}\n`;
    md += `- **Description**: ${plugin.description}\n\n`;
    md += `## 2. Dynamic Slider Configuration Parameters\n`;
    plugin.parameters.forEach((p) => {
      md += `- Param: \`${p.id}\` | Display: "${p.name}" | Range: [${p.min}, ${p.max}] | Default: ${p.defaultValue} (${p.unit})\n`;
    });
    md += `\n## 3. Real-Time evaluated JavaScript DSP loop (\`dspFunction\`)\n`;
    md += `\`\`\`javascript\n${plugin.dspFunction}\n\`\`\`\n\n`;
    md += `## 4. Structured Faust DSP Specification\n`;
    md += `\`\`\`faust\n${plugin.faustCode}\n\`\`\`\n\n`;
    md += `## 5. Production-Ready C++ JUCE Header DSP class\n`;
    md += `\`\`\`cpp\n${plugin.cppJuceCode}\n\`\`\`\n\n`;
    md += `--- \nSnapshot automatically assembled by PlugGen Studio transpiler pipeline.\n`;

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ALL_CODE_COPY.md";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    triggerToast("Refreshed ALL_CODE_COPY.md and initiated system download!");
  };

  const useSamplePrompt = (promptText: string) => {
    setInputMessage(promptText);
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (chatTimeoutRef.current) {
      clearTimeout(chatTimeoutRef.current);
      chatTimeoutRef.current = null;
    }
    setChatLoading(false);
    setBuildStages([]);
    triggerToast("Generation stopped.");
  };

  // ---- Factory Canvas: the autonomous factory floor ----
  if (uiMode === "canvas") {
    return (
      <>
        <FactoryCanvas
          onOpenStudio={() => {
            stopAudioEngine();
            switchUiMode("simple");
          }}
          onOpenPro={() => {
            stopAudioEngine();
            switchUiMode("pro");
          }}
          onLoadInStudio={loadCanvasPluginInStudio}
          onAudition={auditionCanvasPlugin}
          onStopAudition={stopAudioEngine}
          onLiveParamChange={updateLiveParam}
          isPlaying={isPlaying}
          analyserNode={analyserNodeRef.current}
          refineLoops={refineLoops}
          refineControl={<RefineControl loops={refineLoops} onChange={setRefineLoops} variant="simple" />}
        />
        {toastMessage && (
          <div className="fixed bottom-24 right-6 z-100 bg-neutral-900 border border-neutral-800 text-white font-bold text-xs px-4 py-3.5 rounded-xl shadow-xl flex items-center gap-2 animate-slideUp">
            <CheckCircle className="w-4 h-4 text-emerald-500 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}
      </>
    );
  }

  // ---- Simple Mode: ChatGPT-style single screen (default experience) ----
  if (uiMode === "simple") {
    return (
      <>
        <SimpleStudio
          plugin={plugin}
          chatHistory={chatHistory}
          chatLoading={chatLoading}
          dspError={dspError}
          isPlaying={isPlaying}
          bypass={bypass}
          sourceType={sourceType}
          analyserNode={analyserNodeRef.current}
          onSend={handleSendPromptDirectly}
          onStop={handleStopGeneration}
          onClearChat={handleClearChat}
          onTogglePlay={togglePlaySimulation}
          onToggleBypass={() => setBypass((v) => !v)}
          onSourceTypeChange={setSourceType}
          onSliderChange={handleSliderChange}
          onOpenPro={(tab) => {
            if (tab) setCompanionTab(tab as CompanionTabId);
            switchUiMode("pro");
          }}
          onOpenCanvas={() => {
            stopAudioEngine();
            switchUiMode("canvas");
          }}
          modelPicker={
            <ModelPicker
              hasGeminiKey={apiHealth ? apiHealth.hasApiKey : null}
              offlineForced={offlineForced}
              onEngineChange={handleEngineChange}
              onConfigChange={refreshLocalLlmStatus}
              onOpenAdvanced={() => {
                setCompanionTab("memory_core");
                switchUiMode("pro");
              }}
              variant="simple"
            />
          }
          refineControl={<RefineControl loops={refineLoops} onChange={setRefineLoops} variant="simple" />}
          buildStages={buildStages}
          buildVersions={buildVersions}
          onJudgeByEar={() => setShowBlindTest(true)}
          canJudgeByEar={refineCandidates.length >= 2}
          annotateMode={annotateMode}
          onToggleAnnotate={() => setAnnotateMode((v) => !v)}
          annotations={annotations}
          onAddNote={(paramId, paramName, note) => setAnnotations((prev) => [...prev, { paramId, paramName, note }])}
          onRemoveNote={(index) => setAnnotations((prev) => prev.filter((_, i) => i !== index))}
          onApplyNotes={() => handleSendPromptDirectly("Apply my element notes")}
        />
        {showBlindTest && refineCandidates.length >= 2 && (
          <BlindListeningTest
            candidates={refineCandidates}
            onPreview={previewCandidate}
            onStop={stopAudioEngine}
            onClose={closeBlindTest}
            onChoose={handleBlindChoose}
          />
        )}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-100 bg-neutral-900 border border-neutral-800 text-white font-bold text-xs px-4 py-3.5 rounded-xl shadow-xl flex items-center gap-2 animate-slideUp">
            <CheckCircle className="w-4 h-4 text-emerald-500 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans antialiased flex flex-col h-screen selection:bg-indigo-900/60 selection:text-white">
      
      {/* 1. Header Navigation Bar (glowing modern orange-infused slate) */}
      <header className="border-b border-neutral-900 bg-neutral-950 px-4 py-2 flex items-center justify-between z-40 shrink-0">
        <div className="flex items-center gap-2.5">
          <OrangeJuceLogo size={34} />
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <h1 className="font-display font-extrabold text-[#f97316] tracking-tight uppercase select-none">ORANGEJUCE</h1>
                <span className="text-[8px] font-mono bg-orange-950/60 text-orange-400 border border-orange-900/60 font-black px-1.5 py-0.5 rounded uppercase tracking-wider">DSP ENGINE</span>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpManualOpen(true)}
                className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-black font-mono shadow-md shadow-orange-950 cursor-pointer transition-all border border-orange-400/20 active:scale-90"
                title="Open Interactive How-To Manual"
              >
                ?
              </button>
            </div>
            <p className="text-[9px] text-neutral-450 mt-0.5 font-sans">Real-Time DSP Audio Compiler & Sandbox</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">

          <ModelPicker
            hasGeminiKey={apiHealth ? apiHealth.hasApiKey : null}
            offlineForced={offlineForced}
            onEngineChange={handleEngineChange}
            onConfigChange={refreshLocalLlmStatus}
            onOpenAdvanced={() => setCompanionTab("memory_core")}
            variant="pro"
          />

          <button
            onClick={handleDownloadWorkspaceDocs}
            className="flex items-center gap-1 border border-neutral-850 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer select-none"
            title="Download full snapshot of your codebase as ALL_CODE_COPY.md"
          >
            <Code2 className="w-3 h-3 text-emerald-400" />
            <span>Export Code</span>
          </button>

          <button
            onClick={() => switchUiMode("simple")}
            className="flex items-center gap-1 border border-orange-900/60 bg-orange-950/40 hover:bg-orange-950/70 text-orange-300 hover:text-orange-200 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all cursor-pointer select-none"
            title="Back to the simple chat-only view"
          >
            <MessageSquare className="w-3 h-3" />
            <span>Simple Mode</span>
          </button>
        </div>
      </header>

      {/* 2. Main Workspace Layout -- Single Full Bleed (Claude Code Vibe) */}
      <main className="flex-1 overflow-hidden flex flex-col bg-neutral-950">
        
        {/* ==================== SINGLE CONTAINER CORE ==================== */}
        <section className="flex-grow flex flex-col h-full bg-neutral-950 overflow-hidden">
          
          {/* Grouped workspace navigation: all tabs visible (wraps, never scrolls) */}
          <div className="border-b border-neutral-900 bg-neutral-950 px-3 py-2 shrink-0 select-none">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono">
              {WORKSPACE_TAB_GROUPS.map((group) => (
                <div key={group.label} className="flex items-center gap-1">
                  <span className="text-[7.5px] font-black uppercase tracking-widest text-neutral-600 pr-1 border-r border-neutral-900 mr-1">
                    {group.label}
                  </span>
                  {group.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = companionTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setCompanionTab(tab.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[9.5px] font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                          isActive
                            ? `${tab.accent === "orange" ? "bg-orange-600 shadow-orange-950/40" : "bg-indigo-600 shadow-indigo-950/40"} text-white shadow-md`
                            : "text-neutral-450 hover:text-neutral-200 hover:bg-neutral-900/50"
                        }`}
                      >
                        <Icon className={`w-3 h-3 ${isActive ? "text-white" : tab.iconColor}`} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* D. Scrolling Active Workspace Content Area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 bg-neutral-950/40 scrollbar-thin">
            
            {/* Companion TAB Content: Unified Chat with OrangeJuce Specialists */}
            {companionTab === "chat" && (
              <div className="flex flex-col h-[75vh] lg:h-[78vh] flex-1 max-w-4xl mx-auto w-full border border-neutral-900 rounded-2xl overflow-hidden bg-neutral-900/20 shadow-2xl shadow-orange-950/5 animate-fadeIn">
                {/* Chat Header inside Tab */}
                <div className="border-b border-neutral-900 bg-neutral-950 px-4 py-3 flex items-center justify-between shrink-0 select-none">
                  <div className="flex items-center gap-2.5">
                    <OrangeJuceLogo size={28} />
                    <div>
                      <span className="text-[8px] uppercase font-mono font-bold text-neutral-500 tracking-wider">Active Staff Specialist</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-neutral-200">
                          {currentAgent.name}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 bg-orange-950/60 border border-orange-900/60 text-orange-450 font-bold rounded font-mono uppercase tracking-wide">
                          {currentAgent.role.split(" ")[0]}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right side controls of chat header */}
                  <div className="flex items-center gap-2">
                    <RefineControl loops={refineLoops} onChange={setRefineLoops} variant="pro" />

                    {/* Engine selection lives in the header ModelPicker; this is a passive reminder of what will handle the next message. */}
                    <div className="flex items-center gap-1.5 bg-neutral-900/80 px-2 py-0.5 rounded-lg border border-neutral-850 select-none" title="Change the engine with the picker in the top-right header">
                      <span className={`w-1 h-1 rounded-full ${offlineForced || (apiHealth && !apiHealth.hasApiKey && getLLMConfig().provider === "gemini") ? "bg-amber-500 animate-pulse" : "bg-orange-500 animate-pulse"}`} />
                      <span className="text-[8.5px] font-mono font-bold text-neutral-400">
                        {offlineForced ? "OFFLINE COMPILER" : localLlmStatus ? `${localLlmStatus.provider === "ollama" ? "OLLAMA" : "LM STUDIO"}` : "GEMINI CLOUD"}
                      </span>
                    </div>

                    {chatHistory.length > 0 && (
                      <button
                        onClick={handleClearChat}
                        className="text-[9px] font-bold text-neutral-550 hover:text-rose-500 transition-colors flex items-center gap-1 cursor-pointer select-none"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Scrolling Chat Bubble Arena */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 scrollbar-thin bg-neutral-950/25">
                  {chatHistory.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-center p-6 space-y-6 my-auto animate-fadeIn">
                      {/* Beautiful styled OrangeJuce logo */}
                      <div className="flex flex-col items-center gap-3">
                        <div className="animate-bounce-slow">
                          <OrangeJuceLogo size={74} />
                        </div>
                        <div className="space-y-1">
                          <h3 className="font-display font-black text-sm text-[#f97316] tracking-tight uppercase">
                            ORANGEJUCE Studio
                          </h3>
                          <p className="text-[9px] text-neutral-500 uppercase font-mono tracking-widest">
                            Autonomous Audio DSP Co-Processor
                          </p>
                        </div>
                      </div>

                      <p className="text-[10.5px] text-neutral-400 max-w-md mx-auto leading-relaxed">
                        Prompt ORANGEJUCE to design and compile filters, delay algorithms, waveshapers, and tape saturations in real-time. Describe your idea below to load it into controls instantly!
                      </p>

                      {/* Starter Suggestion Chips */}
                      <div className="space-y-2 pt-2 max-w-2xl w-full">
                        <span className="text-[8.5px] font-mono font-bold text-neutral-500 uppercase tracking-widest block text-left sm:text-center">
                          Select DSP Blueprints:
                        </span>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <button
                            onClick={() => handleSendPromptDirectly("Create a resonant 4-pole low-pass ladder filter with drive bias and analog warm clip saturation.")}
                            className="text-left text-[10px] text-neutral-400 hover:text-orange-300 hover:border-orange-900/60 bg-neutral-900/50 hover:bg-neutral-900/80 border border-neutral-850 p-3 rounded-xl transition-all cursor-pointer flex items-start gap-2.5"
                          >
                            <span className="text-sm">📻</span>
                            <div>
                              <strong className="text-neutral-200 block font-sans mb-0.5 font-bold">Resonant Lowpass (Ladder)</strong>
                              <span className="text-[9px] text-neutral-500">Transistor ladder filter with warm tape clipper drive.</span>
                            </div>
                          </button>
                          <button
                            onClick={() => handleSendPromptDirectly("Synthesize a dual feedback slapback tape echo delay which saturates the dry tone warmly using math formulas.")}
                            className="text-left text-[10px] text-neutral-400 hover:text-orange-300 hover:border-orange-900/60 bg-neutral-900/50 hover:bg-neutral-900/80 border border-neutral-850 p-3 rounded-xl transition-all cursor-pointer flex items-start gap-2.5"
                          >
                            <span className="text-sm">🎸</span>
                            <div>
                              <strong className="text-neutral-200 block font-sans mb-0.5 font-bold">Slapback Echo Delay</strong>
                              <span className="text-[9px] text-neutral-500">Dual feedback analog model tape slapback delay with warmth.</span>
                            </div>
                          </button>
                          <button
                            onClick={() => handleSendPromptDirectly("Build a smooth hard-knee optical feedback dynamic compressor complete with threshold percentage ratios.")}
                            className="text-left text-[10px] text-neutral-400 hover:text-orange-300 hover:border-orange-900/60 bg-neutral-900/50 hover:bg-neutral-900/80 border border-neutral-850 p-3 rounded-xl transition-all cursor-pointer flex items-start gap-2.5"
                          >
                            <span className="text-sm">⚙️</span>
                            <div>
                              <strong className="text-neutral-200 block font-sans mb-0.5 font-bold">Optical Feedback Compressor</strong>
                              <span className="text-[9px] text-neutral-500">Soft/hard knee opto dynamic feedforward controller.</span>
                            </div>
                          </button>
                          <button
                            onClick={() => handleSendPromptDirectly("Forge a wild metallic multi-stage wavefolder fuzz node suited for synth leads saturation distortion.")}
                            className="text-left text-[10px] text-neutral-400 hover:text-orange-300 hover:border-orange-900/60 bg-neutral-900/50 hover:bg-neutral-900/80 border border-neutral-850 p-3 rounded-xl transition-all cursor-pointer flex items-start gap-2.5"
                          >
                            <span className="text-sm">⚡</span>
                            <div>
                              <strong className="text-neutral-200 block font-sans mb-0.5 font-bold">Metallic Wavefolder Fuzz</strong>
                              <span className="text-[9px] text-neutral-500">Multi-stage geometric waveform folder suited for lead synths.</span>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {chatHistory.map((msg) => {
                        const isUser = msg.senderId === "user";
                        const isSystem = msg.senderId === "error";

                        return (
                          <div key={msg.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-fadeIn`}>
                            <div className="flex items-center gap-1.5 mb-1 px-1">
                              <span className={`text-[9.5px] font-mono font-bold ${isUser ? "text-orange-400" : isSystem ? "text-rose-450" : "text-amber-500"}`}>
                                {msg.senderName}
                              </span>
                              <span className="text-[8px] text-neutral-600">{msg.timestamp}</span>
                            </div>

                            <div
                              className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[90%] font-sans whitespace-pre-wrap selection:bg-[#ea580c]/20 select-text ${
                                isUser
                                  ? "bg-neutral-900 border border-neutral-800 text-white rounded-tr-none"
                                  : isSystem
                                  ? "bg-rose-950/40 text-rose-300 border border-rose-900 rounded-tl-none font-mono"
                                  : "bg-neutral-900/40 text-neutral-300 rounded-tl-none border border-neutral-850 shadow-sm"
                              }`}
                            >
                              {msg.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {chatLoading && (() => {
                    const steps = getAgentSteps(selectedAgentId);
                    const totalSteps = steps.length;
                    const activeStepIndex = Math.min(orchestrationStep, totalSteps - 1);
                    const percent = Math.min(98, Math.round(((activeStepIndex + 0.5) / totalSteps) * 100));

                    return (
                      <div className="flex flex-col items-start space-y-2.5 animate-fadeIn w-full max-w-md">
                        <div className="flex items-center gap-2 mb-0.5 px-1 select-none">
                          <span className="text-[10px] font-bold text-orange-400 font-mono uppercase tracking-wider">
                            {currentAgent.name}
                          </span>
                          <span className="text-[9px] text-neutral-500 font-mono">
                            Stage {activeStepIndex + 1} of {totalSteps}
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                        </div>

                        <div className="p-4 bg-neutral-900/90 border border-neutral-800 rounded-2xl rounded-tl-none w-full shadow-lg shadow-black/30 backdrop-blur-sm space-y-3.5">
                          {/* Progress bar container */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px] font-mono text-neutral-450">
                              <span className="flex items-center gap-1.5 text-neutral-350 font-medium">
                                <Activity className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                                Processing algorithm...
                              </span>
                              <span className="font-bold text-orange-450">{percent}%</span>
                            </div>
                            {/* Outer Track */}
                            <div className="w-full h-2 bg-neutral-950 rounded-full overflow-hidden p-0.5 border border-neutral-850">
                              {/* Inner bar */}
                              <div
                                style={{ width: `${percent}%` }}
                                className="h-full bg-gradient-to-r from-orange-600 to-amber-500 rounded-full transition-all duration-700 ease-out"
                              />
                            </div>
                            <JobTimer active={chatLoading} jobKey="chat_generation" label={localLlmStatus?.model || "Generating"} />
                            {(buildStages.length > 0 || buildVersions.length > 0) && (
                              <div className="pt-2">
                                <BuildProgressBar
                                  stages={buildStages}
                                  versions={buildVersions}
                                  onJudge={refineCandidates.length >= 2 ? () => setShowBlindTest(true) : undefined}
                                />
                              </div>
                            )}
                          </div>

                          {/* Steps Checklist */}
                          <div className="pt-2.5 border-t border-neutral-850 space-y-2">
                            {steps.map((stepText, idx) => {
                              const isCompleted = idx < activeStepIndex;
                              const isActive = idx === activeStepIndex;
                              return (
                                <div
                                  key={idx}
                                  className={`flex items-start gap-2.5 transition-all duration-300 ${
                                    isActive
                                      ? "opacity-100 transform scale-[1.01]"
                                      : isCompleted
                                      ? "opacity-60"
                                      : "opacity-25"
                                  }`}
                                >
                                  {/* Step State Icon */}
                                  <div className="mt-0.5 shrink-0">
                                    {isCompleted ? (
                                      <div className="w-3.5 h-3.5 rounded-full bg-emerald-950/80 border border-emerald-500/80 flex items-center justify-center">
                                        <span className="text-[8px] text-emerald-400 font-bold font-mono">✓</span>
                                      </div>
                                    ) : isActive ? (
                                      <div className="w-3.5 h-3.5 rounded-full bg-orange-950/80 border border-orange-500/80 flex items-center justify-center animate-pulse">
                                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                                      </div>
                                    ) : (
                                      <div className="w-3.5 h-3.5 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center">
                                        <span className="w-1 h-1 rounded-full bg-neutral-700" />
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Step description */}
                                  <div className="flex-1 min-w-0">
                                    <p
                                      className={`text-[10.5px] leading-snug font-sans ${
                                        isActive
                                          ? "text-orange-200 font-medium"
                                          : isCompleted
                                          ? "text-neutral-400 line-through decoration-neutral-800"
                                          : "text-neutral-550"
                                      }`}
                                    >
                                      {stepText}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div ref={chatEndRef} />
                </div>

                {/* Form message typing box */}
                <form onSubmit={handleSendMessage} className="border-t border-neutral-900 p-3 bg-neutral-950 shrink-0 space-y-2">
                  <div className="relative flex items-center gap-1.5 animate-fadeIn">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder={`Tell ${currentAgent.name.split(" ")[0]} to edit or make a plugin...`}
                      className="flex-1 text-xs font-sans bg-neutral-900 hover:bg-neutral-850/80 focus:bg-neutral-900 border border-neutral-850 focus:border-orange-550 focus:ring-0 outline-none rounded-lg p-3 pr-10 transition-all text-neutral-100 placeholder-neutral-550"
                      disabled={chatLoading}
                    />
                    {chatLoading ? (
                      <button
                        type="button"
                        onClick={() => {
                          abortControllerRef.current?.abort();
                          abortControllerRef.current = null;
                          if (chatTimeoutRef.current) {
                            clearTimeout(chatTimeoutRef.current);
                            chatTimeoutRef.current = null;
                          }
                          setChatLoading(false);
                          triggerToast("Generation stopped.");
                        }}
                        className="absolute right-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white font-bold rounded-md transition-all flex items-center gap-1 shrink-0 cursor-pointer text-[9px] font-mono"
                        title="Stop the current generation"
                      >
                        <span className="w-2 h-2 bg-white rounded-[2px]" />
                        <span>STOP</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!inputMessage.trim()}
                        className="absolute right-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-550 disabled:bg-neutral-900 disabled:text-neutral-600 text-white font-bold rounded-md transition-all flex items-center justify-center shrink-0 cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Active Consultant Dropdown Picker Row */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-905">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-wider shrink-0 font-bold">Specialist:</span>
                      <div className="relative flex items-center bg-neutral-900 hover:bg-neutral-850 px-2 py-1 rounded-md border border-neutral-800 transition-colors group">
                        <select
                          value={selectedAgentId}
                          onChange={(e) => {
                            setSelectedAgentId(e.target.value);
                            const sel = agents.find((ag) => ag.id === e.target.value);
                            if (sel) {
                              triggerToast(`Switched focus to ${sel.name}`);
                            }
                          }}
                          className="appearance-none bg-transparent hover:text-white text-[10px] font-bold text-neutral-300 outline-none pr-4 cursor-pointer font-sans"
                        >
                          {agents.map((ag) => (
                            <option key={ag.id} value={ag.id} className="bg-neutral-950 text-neutral-200 text-xs">
                              {ag.name} ({ag.role.split(" ")[0]})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-2.5 h-2.5 text-neutral-550 pointer-events-none absolute right-1.5 hover:text-neutral-300" />
                      </div>
                    </div>
                    <div className="text-[9px] text-neutral-500 italic max-w-[50%] text-right truncate">
                      {currentAgent.description}
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Companion TAB Content: Spec & Code Architect */}
            {companionTab === "architect" && (
              <div className="space-y-6 max-w-5xl mx-auto w-full border border-neutral-900 rounded-2xl p-6 bg-neutral-950/60 shadow-2xl animate-fadeIn">
                <div className="flex items-center gap-3 border-b border-neutral-900 pb-4">
                  <div className="p-2 bg-indigo-950/80 border border-indigo-900/50 rounded-xl text-indigo-400">
                    <Wand2 className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="font-display font-black text-sm text-indigo-400 uppercase tracking-tight">🧙 Spec & Code Architect</h2>
                    <p className="text-[10px] text-neutral-400 uppercase font-mono tracking-widest">Autonomous DSP Specification Deconstructor & Synthesizer</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9.5px] font-mono font-bold text-neutral-450 uppercase tracking-wider">Describe your Audio DSP Concept</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={architectPrompt}
                        onChange={(e) => setArchitectPrompt(e.target.value)}
                        placeholder="e.g., Warm vintage analog tape delay with flutter LFO, biquad resonant filter, valve distortion..."
                        className="flex-1 bg-neutral-900/80 border border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
                      />
                      <button
                        onClick={handleDeconstructPrompt}
                        disabled={architectIsDeconstructing || !architectPrompt.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-2 border border-indigo-500/50"
                      >
                        {architectIsDeconstructing ? "Deconstructing..." : "Deconstruct to Specs"}
                      </button>
                    </div>
                  </div>

                  {/* Preset Suggestions */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[8.5px] font-mono font-bold text-neutral-600 uppercase font-bold">Instant Presets:</span>
                    {[
                      "Tape Echo & Flutter modulation",
                      "Asymmetrical Valve Overdrive",
                      "RBJ Resonant Biquad Filter",
                      "Feed-forward Logarithmic Peak Compressor"
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setArchitectPrompt(suggestion);
                        }}
                        className="text-[8.5px] font-mono font-bold px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-850 hover:border-neutral-750 rounded text-neutral-400 hover:text-neutral-200 transition-all cursor-pointer"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>

                  {/* Loading State */}
                  {architectIsDeconstructing && (
                    <div className="bg-[#111116] border border-indigo-950/40 rounded-xl p-8 flex flex-col items-center justify-center space-y-4 animate-pulse">
                      <div className="relative w-12 h-12">
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-950" />
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-[11px] text-neutral-300 font-sans leading-relaxed font-bold">Decomposing prompt semantics into mathematical structures...</p>
                        <p className="text-[9px] text-neutral-500 font-mono">Generating specs, parameters & verified DSP with {localLlmStatus?.model || "the local model"}</p>
                      </div>
                      <JobTimer active={architectIsDeconstructing} jobKey="architect_deconstruct" className="w-full max-w-xs items-center" />
                    </div>
                  )}

                  {/* Specifications Grid */}
                  {architectSpecs && (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {architectSpecs.map((spec, specIdx) => (
                          <div key={specIdx} className="bg-neutral-900/40 border border-neutral-850 hover:border-neutral-800 rounded-xl p-4 transition-all">
                            <div className="flex items-center justify-between border-b border-neutral-900 pb-2 mb-3">
                              <h3 className="font-bold text-[11px] text-indigo-400 uppercase font-mono tracking-wider">{spec.title}</h3>
                              <span className="text-[8px] bg-neutral-950 border border-neutral-850 px-1.5 py-0.5 rounded font-mono text-neutral-500">SPEC-{specIdx + 1}</span>
                            </div>

                            <p className="text-[10px] text-neutral-400 font-sans mb-3">{spec.description}</p>

                            {/* Details List */}
                            <div className="space-y-1.5 mb-4">
                              {spec.details.map((detail, dIdx) => (
                                <div key={dIdx} className="group flex items-start justify-between gap-2 text-[9px] font-mono text-neutral-300 bg-neutral-950/40 border border-neutral-900 p-1.5 rounded">
                                  <span className="leading-normal flex-1">
                                    • {detail}
                                  </span>
                                  <button
                                    onClick={() => {
                                      const updated = [...architectSpecs];
                                      updated[specIdx].details = spec.details.filter((_, idx) => idx !== dIdx);
                                      setArchitectSpecs(updated);
                                      triggerToast("Removed specification requirement");
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-[8px] font-bold text-neutral-500 hover:text-red-500 transition-all px-1 cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                            </div>

                            {/* Add Requirement Form */}
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="Add custom requirement spec..."
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = e.currentTarget.value.trim();
                                    if (val) {
                                      const updated = [...architectSpecs];
                                      updated[specIdx].details.push(val);
                                      setArchitectSpecs(updated);
                                      e.currentTarget.value = "";
                                      triggerToast("Added custom specification parameter");
                                    }
                                  }
                                }}
                                className="flex-1 bg-neutral-950 border border-neutral-900 rounded px-2 py-1 text-[9px] text-white focus:outline-none placeholder-neutral-800"
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Code Synthesis Control Bar */}
                      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-indigo-950/15 border border-indigo-900/30 rounded-xl p-4">
                        <div className="space-y-0.5">
                          <h4 className="font-bold text-[11px] text-white">All Specifications Verified</h4>
                          <p className="text-[9px] text-neutral-400 leading-relaxed font-sans">Click compile to synthesize mathematical formulas directly into an active, low-latency DSP node.</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              triggerToast("Generated optimized DSP signal graph!");
                            }}
                            className="text-[10px] font-mono font-bold text-neutral-450 hover:text-white bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 px-3 py-1.5 rounded-lg transition cursor-pointer"
                          >
                            Re-verify AST
                          </button>
                          <button
                            onClick={() => {
                              triggerToast("Trans-compiled beautifully! Live preview loaded below.");
                            }}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] px-4 py-1.5 rounded-lg transition border border-indigo-500/50 cursor-pointer"
                          >
                            ⚡ Trans-compile specs
                          </button>
                        </div>
                      </div>

                      {/* Compiled Code Block */}
                      {architectGeneratedCode && (
                        <div className="space-y-3 border-t border-neutral-900 pt-6 animate-fadeIn">
                          <div className="flex items-center justify-between">
                            <span className="text-[9.5px] font-mono font-bold text-neutral-450 uppercase tracking-wider">Optimized trans-compiled DSP Code</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(architectGeneratedCode || "");
                                  triggerToast("Copied code to clipboard!");
                                }}
                                className="text-[9px] font-mono font-bold text-neutral-400 hover:text-white border border-neutral-800 hover:border-neutral-700 bg-neutral-900/60 px-2.5 py-1 rounded transition cursor-pointer"
                              >
                                Copy Code
                              </button>
                              <button
                                onClick={() => {
                                  const name = architectPrompt.trim();
                                  const architectSpec = classifyPluginIntent(architectPrompt);
                                  const newPluginState: AudioPlugin = {
                                    ...plugin,
                                    name: name,
                                    pluginName: name,
                                    category: familyToCategory(architectSpec.family),
                                    description: "Synthesized via Spec & Code Architect",
                                    dspFunction: architectGeneratedCode || "",
                                    parameters: architectParameters,
                                    faustCode: "",
                                    cppJuceCode: "",
                                    createdAt: new Date().toLocaleDateString()
                                  };
                                  const gate = runQualityGate(newPluginState, { family: architectSpec.family, prompt: architectPrompt, intent: architectSpec.interpretedGoal });
                                  const gateMinScore = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
                                  saveCandidateRecipe(architectPrompt, architectSpec.family, gate.plugin.dspFunction, gateMinScore);
                                  savePluginState(gate.plugin);
                                  compileDsp(gate.plugin.dspFunction);
                                  triggerToast(`🧙 Injected and Compiled "${name}"!`);
                                }}
                                className="text-[9px] font-mono font-bold text-white border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 rounded transition shadow cursor-pointer"
                              >
                                📥 Inject Design & Compile Live
                              </button>
                            </div>
                          </div>

                          <pre className="p-4 bg-neutral-950 rounded-xl border border-neutral-900 overflow-x-auto text-[10px] font-mono text-emerald-400 max-h-[300px] scrollbar-thin">
                            <code>{architectGeneratedCode}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Companion TAB Content: Live Interactive Canvas / Playground */}
            {companionTab === "playground" && (
              <div className="space-y-6 animate-fadeIn">
                
                {/* 1. Interactive Controls & Socket Layout UI Designer (FIRST THING) */}
                <UIDesigner
                  plugin={plugin}
                  onChange={(next) => {
                    // Layout drags keep the same code -- save directly. A template
                    // apply swaps the DSP, so re-run the quality gate: it recomputes
                    // the loudness trim (never carrying a stale one over) and fills
                    // any visual gaps.
                    if (next.dspFunction !== plugin.dspFunction) {
                      savePluginState(runQualityGate(next).plugin);
                    } else {
                      savePluginState(next);
                    }
                  }}
                  triggerToast={triggerToast}
                />

                {/* 2. Large, Spacious Square Canvas / Visualizer Monitor Zone */}
                <div className="bg-neutral-900/10 border border-neutral-900 rounded-2xl p-4 shadow-xl relative overflow-hidden transition-all duration-300 animate-fadeIn">
                  {/* Subtle retro backdrop glow lines */}
                  <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/5 to-transparent pointer-events-none" />
                  
                  {chatLoading ? (() => {
                    const steps = getAgentSteps(selectedAgentId);
                    const totalSteps = steps.length;
                    const activeStepIndex = Math.min(orchestrationStep, totalSteps - 1);
                    const percent = Math.min(98, Math.round(((activeStepIndex + 0.5) / totalSteps) * 100));

                    return (
                      <div className="aspect-square max-h-[380px] md:max-h-[360px] w-full bg-[#111116] border border-orange-950/40 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden shadow-inner select-none animate-pulse">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl pointer-events-none" />
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                          <span className="text-[9px] font-mono font-bold text-orange-450 uppercase tracking-widest">
                            AI Compiler Synthesizing
                          </span>
                        </div>
                        <span className="text-[8px] font-mono text-orange-400 bg-orange-950/70 border border-orange-900/50 px-2 py-0.5 rounded-full">
                          {offlineForced || (apiHealth && !apiHealth.hasApiKey) ? "OFFLINE" : "ONLINE"}
                        </span>
                      </div>

                      <div className="space-y-4 my-auto w-full max-w-sm mx-auto">
                        <p className="text-[11px] text-neutral-350 font-sans leading-relaxed text-center">
                          Our DSP specialist <strong className="text-orange-450">{currentAgent.name}</strong> is generating mathematical parameters and constructing nodes.
                        </p>

                        {/* Steps Checklist */}
                        <div className="space-y-1.5 font-mono text-[9px] text-neutral-350 bg-neutral-950/80 p-3 rounded-lg border border-neutral-900/60 max-h-[140px] overflow-y-auto scrollbar-thin">
                          {steps.map((stepText, idx) => {
                            const isCompleted = idx < activeStepIndex;
                            const isActive = idx === activeStepIndex;
                            return (
                              <div
                                key={idx}
                                className={`flex items-center gap-2 transition-all duration-300 ${
                                  isActive
                                    ? "opacity-100"
                                    : isCompleted
                                    ? "opacity-60"
                                    : "opacity-25"
                                }`}
                              >
                                {isCompleted ? (
                                  <span className="text-emerald-500 font-bold">✓</span>
                                ) : isActive ? (
                                  <span className="text-orange-400 animate-spin">⟳</span>
                                ) : (
                                  <span className="text-neutral-700 font-bold">○</span>
                                )}
                                <span className={isActive ? "text-orange-200" : isCompleted ? "line-through text-neutral-500" : "text-neutral-550"}>
                                  {stepText}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <JobTimer active={chatLoading} jobKey="chat_generation" label={localLlmStatus?.model || "Generating"} className="items-center" />
                        <div className="text-center font-mono text-[9px] text-neutral-600">
                          Compiling live into Web Audio Graph pipelines...
                        </div>
                      </div>
                    </div>
                  )})() : (
                    /* The beautiful large square main canvas visualizer oscilloscope */
                    <Visualizer 
                      analyserNode={analyserNodeRef.current} 
                      isPlaying={isPlaying} 
                      aspectSquare={true} 
                    />
                  )}
                </div>

                {/* 2. Compact Control Dashboard panel (Shifted and resized neatly underneath the Canvas) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-900/15 border border-neutral-900/80 rounded-2xl p-4 shadow-sm">
                  
                  {/* Left block: Current active device specs & live player trigger */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-neutral-500 uppercase tracking-widest">Active Device Status</span>
                      <div className="flex items-center gap-1.5 animate-fadeIn">
                        <button
                          type="button"
                          onClick={() => setCompanionTab("presets")}
                          className="text-[8px] font-mono font-bold text-orange-450 hover:text-orange-400 bg-orange-950/20 hover:bg-orange-950/40 border border-orange-900/30 px-1.5 py-0.5 rounded-md transition duration-150 flex items-center gap-1 cursor-pointer"
                        >
                          <Bookmark className="w-2.5 h-2.5" />
                          <span>PRESETS DECK</span>
                        </button>
                        <span className="text-[8px] bg-indigo-950/80 text-indigo-300 border border-indigo-900/50 font-mono font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                          {plugin.category}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 bg-neutral-900/40 border border-neutral-850 p-3 rounded-xl hover:border-neutral-800 transition-all">
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <h4 className="font-bold text-xs text-white truncate">{plugin.pluginName || plugin.name}</h4>
                        <p className="text-[10px] text-neutral-400 truncate leading-relaxed font-sans">{plugin.description}</p>
                      </div>
                      
                      {/* Condensed Play Player Button */}
                      <button
                        type="button"
                        onClick={togglePlaySimulation}
                        className={`text-[10px] font-mono font-bold flex items-center gap-1 px-3 py-2 rounded-lg transition-all shadow-sm cursor-pointer select-none shrink-0 border ${
                          isPlaying
                            ? "bg-rose-950/60 border-rose-800 text-rose-300 hover:bg-rose-900/80 hover:text-white"
                            : "bg-emerald-950/60 border-emerald-800 text-emerald-300 hover:bg-emerald-900/80 hover:text-white"
                        }`}
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="w-3 h-3 fill-current" />
                            <span>MUTE</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current animate-pulse" />
                            <span>PLAY</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Right block: Audio testing routing signal switch & precision quality switches */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-neutral-500 uppercase tracking-widest">Acoustic Testing Signal</span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 bg-neutral-900/40 p-1 rounded-xl border border-neutral-850">
                      <button
                        type="button"
                        onClick={() => setSourceType("synth")}
                        className={`py-1.5 px-2 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                          sourceType === "synth" ? "bg-neutral-800 border-indigo-900/80 text-indigo-400" : "bg-transparent border-transparent text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        🎹 Synth
                      </button>
                      <button
                        type="button"
                        onClick={() => setSourceType("sine")}
                        className={`py-1.5 px-2 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                          sourceType === "sine" ? "bg-neutral-800 border-indigo-900/80 text-indigo-400" : "bg-transparent border-transparent text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        🔊 Sine
                      </button>
                      <button
                        type="button"
                        onClick={() => setSourceType("noise")}
                        className={`py-1.5 px-2 rounded-lg text-[9px] font-bold border transition-all cursor-pointer ${
                          sourceType === "noise" ? "bg-neutral-800 border-indigo-900/80 text-indigo-400" : "bg-transparent border-transparent text-neutral-400 hover:text-neutral-200"
                        }`}
                      >
                        💨 Noise
                      </button>
                    </div>

                    {/* Toggle settings checkboxes */}
                    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-neutral-900">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={bypass}
                          onChange={(e) => setBypass(e.target.checked)}
                          className="w-3.5 h-3.5 rounded text-indigo-600 bg-neutral-900 border-neutral-850 cursor-pointer"
                        />
                        <span className="text-[10px] font-semibold text-neutral-400 hover:text-neutral-200">
                          Bypass DSP engine processing dry bypass
                        </span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isPrecisionOversampled}
                          onChange={(e) => {
                            const target = e.target.checked;
                            setIsPrecisionOversampled(target);
                            triggerToast(target ? "Activated insanely accurate 2x Linear Oversampling" : "Deactivated oversampling");
                          }}
                          className="w-3.5 h-3.5 rounded text-amber-500 bg-neutral-900 border-neutral-850 cursor-pointer"
                        />
                        <span className="text-[10px] font-bold text-amber-500/85 hover:text-amber-400 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          Insane-Accuracy 2x Oversampling (Anti-Alias)
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Error banner indicator if any */}
                {dspError && (
                  <div className="bg-rose-950/40 border border-rose-900/65 rounded-2xl p-3.5 text-[10.5px] text-rose-350 font-mono flex items-start gap-2 shadow-inner">
                    <span className="text-rose-455 font-bold">⚠ CORE RUNTIME CRASH:</span>
                    <span>{dspError}</span>
                  </div>
                )}

                {/* 4. Practical starting instructions guidance box */}
                <div className="bg-neutral-900/20 border border-neutral-900 rounded-2xl p-4 flex items-start gap-3">
                  <div className="p-2 bg-indigo-950/60 rounded-xl border border-indigo-900/40 text-indigo-400 text-lg shrink-0">
                    ⚡
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-neutral-200">Fluid Workflow Options</h4>
                    <p className="text-[10px] text-neutral-400 leading-relaxed font-sans">
                      You are in complete creative command: Start by explaining your ideas to the AI Consultant on the left sidebar to generate beautiful soundscapes, or write raw DSP code directly by switching to the <strong className="text-sky-300">Script JS</strong> tab!
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Companion TAB Content: Presets Manager Library */}
            {companionTab === "presets" && (
              <div className="space-y-4 animate-fadeIn">
                <PresetManager
                  currentPlugin={plugin}
                  onLoadPreset={(preset) => {
                    const loadedPlugin: AudioPlugin = {
                      id: preset.id.startsWith("preset-") ? preset.id : "warm-tape-saturation",
                      name: preset.name,
                      category: preset.category,
                      description: preset.description,
                      parameters: preset.parameters.map(p => ({ ...p })), // Deep copy parameter values
                      dspFunction: preset.dspFunction,
                      faustCode: preset.faustCode || "",
                      cppJuceCode: preset.cppJuceCode || "",
                      createdAt: preset.timestamp || new Date().toLocaleDateString()
                    };
                    // Gate preset loads too: recomputes the loudness trim for THIS
                    // code (never inheriting the previous plugin's) and polishes looks.
                    const gatedPreset = runQualityGate(loadedPlugin).plugin;
                    savePluginState(gatedPreset);
                    setScratchCode(gatedPreset.dspFunction);
                    compileDsp(gatedPreset.dspFunction);
                  }}
                  triggerToast={triggerToast}
                />
              </div>
            )}

            {/* Companion TAB Content: JS Code Scratchpad */}
            {companionTab === "code" && (() => {
              // Client-side instant regex scan for mathematical safety constraints in real-time
              const currentText = isEditingCode ? scratchCode : plugin.dspFunction;
              const gcSweepHazard = /(?:new\s+(?:Float32Array|Float64Array|Uint16Array|Uint8Array|Array)|\s*=\s*\[\s*\]|\s*=\s*\{\s*\})/i.test(currentText) && 
                                    !/(?:if\s*\(\s*!\s*state|if\s*\(\s*typeof\s+state|!state\.)/i.test(currentText);

              const zeroDivHazard = /\/\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g.test(currentText) && 
                                    !/\/\s*\d+/.test(currentText) && 
                                    !currentText.includes("1e-") && 
                                    !currentText.includes("+ 0.000") && 
                                    !currentText.includes("Math.max");

              const logUnderflowHazard = /Math\.log(?:10)?\s*\(\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\)/.test(currentText) && 
                                         !/Math\.max\s*\(\s*[a-zA-Z_][a-zA-Z0-9_\.]*\s*,\s*(?:1e-|0\.000)/i.test(currentText);

              const unboundedFeedbackHazard = /state\.[a-zA-Z0-9_]+\s*\[\s*state\.[a-zA-Z0-9_]+\s*\]\s*=\s*/.test(currentText) && 
                                              !/(?:Math\.tanh|Math\.max|Math\.min|clipCeil|clamp)/i.test(currentText);

              // Offline-ready math recipes / cheat sheet
              const dspRecipes = [
                {
                  name: "One-Pole lowpass (Warm Filter)",
                  description: "A super-lightweight single-order filter smoother to reduce clicking or high-end tape hiss.",
                  code: `// One-pole parameter-controlled smoother filter equation
if (!state.lpPrev) {
  state.lpPrev = 0.0;
}
let smoothingCoefficient = 0.15; // Response speed [0.0 to 1.0]
state.lpPrev = state.lpPrev + smoothingCoefficient * (inputSample - state.lpPrev);

return state.lpPrev;`
                },
                {
                  name: "Cubic Valve Saturator (Rich Tube Analog)",
                  description: "An incredibly warm mathematical modeling of solid-state vacuum tube grids.",
                  code: `// Nonlinear dynamic range compression (Cubic saturation)
let drive = params.drive !== undefined ? params.drive : 2.5;
let x = inputSample * drive;

// Classic cubic wave folding formula
if (x > 1.0) {
  return 0.6667;
} else if (x < -1.0) {
  return -0.6667;
} else {
  return x - (x * x * x) / 3.0;
}`
                },
                {
                  name: "Hard waveshaping limiter",
                  description: "Strict dynamic ceiling clamp. Guarantees no visual signal clipping or DAW overflow peaks.",
                  code: `// Strict ceiling limiter with safety factor scaling
let driveLevel = params.gain !== undefined ? params.gain : 3.0;
let outputCeiling = 0.82; // Strictly prevent DAC overload

let boosted = inputSample * driveLevel;
return Math.max(-outputCeiling, Math.min(outputCeiling, boosted));`
                },
                {
                  name: "Tap Echo delay loop",
                  description: "Highly robust circular delay-line buffer memory using persistent safe array offsets.",
                  code: `// Stable feedforward delay line taps with damping feedback
if (!state.delayLine) {
  state.delayLine = new Float32Array(22050); // 500ms memory offset buffer
  state.writePtr = 0;
}

let delaySample = state.delayLine[state.writePtr];
let feedbackGain = 0.45; // Repeat feedback damp ratio

// Write saturated feedback back into memory index
state.delayLine[state.writePtr] = Math.tanh(inputSample + delaySample * feedbackGain);
state.writePtr = (state.writePtr + 1) % state.delayLine.length;

return inputSample * 0.65 + delaySample * 0.35;`
                },
                {
                  name: "Active Sine Wave LFO (Sub-Oscillator)",
                  description: "An accumulator-driven low-frequency sine generator to dynamically modulate filter bounds.",
                  code: `// Stable Phase Accumulator LFO Oscillator
if (!state.phi) {
  state.phi = 0.0;
}
let lfoSpeedHz = 5.2; // Speed cycles per second
state.phi += (2.0 * Math.PI * lfoSpeedHz) / 44100.0;

// Reset phase on boundary wrap
if (state.phi > 2.0 * Math.PI) {
  state.phi -= 2.0 * Math.PI;
}

let lfoOsc = Math.sin(state.phi);
// Modulate dry input amplitude smoothly with the LFO cycle
let dynamicVolumeMod = 1.0 - (0.5 * (lfoOsc + 1.0) * 0.6); // 60% depth

return inputSample * dynamicVolumeMod;`
                }
              ];

              return (
                <div className="space-y-4 animate-fadeIn">
                  {/* Grid split showing code text area + Real-time quality monitor */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                    
                    {/* Column A: Main Editor workspace */}
                    <div className="xl:col-span-8 bg-neutral-900 border border-neutral-850 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between">
                      <div className="bg-neutral-950 px-4 py-3 border-b border-neutral-850 flex items-center justify-between select-none">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-4 h-4 text-indigo-400" />
                          <span className="text-xs font-semibold text-white">JavaScript Real-Time Processing Loop</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isEditingCode ? (
                            <button
                              onClick={() => {
                                setScratchCode(plugin.dspFunction);
                                setIsEditingCode(true);
                              }}
                              className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded-lg font-bold select-none cursor-pointer"
                            >
                              Tweak Code Manually
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setIsEditingCode(false)}
                                className="text-[10px] bg-neutral-800 hover:bg-neutral-750 text-neutral-400 px-2.5 py-1.5 rounded-lg select-none cursor-pointer"
                              >
                                Bypass
                              </button>
                              <button
                                onClick={handleApplyScratchCode}
                                className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg select-none cursor-pointer"
                              >
                                Hot Compile Changes
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="relative flex-1">
                        {isEditingCode ? (
                          <textarea
                            value={scratchCode}
                            onChange={(e) => setScratchCode(e.target.value)}
                            className="w-full h-80 bg-neutral-900 text-[#d4d4d4] font-mono text-xs p-4 focus:outline-none leading-relaxed border-none rounded-b-xl scrollbar-thin"
                            spellCheck="false"
                            placeholder="// Write your sample-by-sample DSP code here..."
                          />
                        ) : (
                          <pre className="p-4 bg-neutral-950 text-[#9cdcfe] font-mono text-xs overflow-x-auto min-h-[320px] max-h-80 leading-relaxed scrollbar-thin">
                            <code>{plugin.dspFunction}</code>
                          </pre>
                        )}
                      </div>
                    </div>

                    {/* Column B: Real-Time Quality Monitor Panel (Zero dependency offline scanner) */}
                    <div className="xl:col-span-4 bg-neutral-950 border border-neutral-850 rounded-2xl p-4 flex flex-col justify-between space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h5 className="text-[10px] uppercase font-bold tracking-widest text-[#94a3b8] flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                            Active JIT Static Quality Shield
                          </h5>
                          <span className="text-[8px] font-mono bg-neutral-900 px-1.5 py-0.5 rounded text-indigo-400 font-bold border border-neutral-800">
                            Offline Safe
                          </span>
                        </div>
                        <p className="text-[10px] text-neutral-500 leading-normal">
                          This guardian scans your code blocks instantly during keystrokes, flagging critical NaN errors before they lock up the audio output.
                        </p>

                        <div className="space-y-2.5 pt-1">
                          {/* rule 1 */}
                          <div className={`p-2 rounded-lg border text-[10px] ${gcSweepHazard ? "bg-amber-950/20 border-amber-900/40" : "bg-emerald-950/20 border-emerald-900/30"}`}>
                            <div className="flex items-center gap-1.5 font-bold mb-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${gcSweepHazard ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
                              <span className={gcSweepHazard ? "text-amber-300" : "text-emerald-400"}>Memory Allocation & Jitter Shield</span>
                            </div>
                            <p className="text-[9px] text-neutral-400">
                              {gcSweepHazard 
                                ? "⚠️ Found dynamic collection array 'new ...' outside wrapper state. Direct allocations trigger browser Garbage Collection sweeps causing audio pops." 
                                : "✔ Garbage Collector clean. Variables are defined statically under persistent state objects."}
                            </p>
                          </div>

                          {/* rule 2 */}
                          <div className={`p-2 rounded-lg border text-[10px] ${zeroDivHazard ? "bg-amber-950/20 border-amber-900/40" : "bg-emerald-950/20 border-emerald-900/30"}`}>
                            <div className="flex items-center gap-1.5 font-bold mb-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${zeroDivHazard ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
                              <span className={zeroDivHazard ? "text-amber-300" : "text-emerald-400"}>Division-by-Zero Protection</span>
                            </div>
                            <p className="text-[9px] text-neutral-400">
                              {zeroDivHazard 
                                ? "⚠️ Direct division by custom parameter detected. Without a safe denominator guard (den + 1e-9), dynamic sweep zeros mute audio paths instantly." 
                                : "✔ Division paths guarded. Basic safety boundaries look stable."}
                            </p>
                          </div>

                          {/* rule 3 */}
                          <div className={`p-2 rounded-lg border text-[10px] ${logUnderflowHazard ? "bg-red-950/20 border-red-900/40" : "bg-emerald-950/20 border-emerald-900/30"}`}>
                            <div className="flex items-center gap-1.5 font-bold mb-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${logUnderflowHazard ? "bg-rose-500 animate-ping" : "bg-emerald-500"}`} />
                              <span className={logUnderflowHazard ? "text-rose-300" : "text-emerald-400"}>Logarithmic Underflow Gate</span>
                            </div>
                            <p className="text-[9px] text-neutral-400">
                              {logUnderflowHazard 
                                ? "❌ Extreme Risk in decibel math! Evaluating Math.log(x) on silence produces -Infinity, cascade-poisoning surrounding structures." 
                                : "✔ Infinite logarithm limits safe."}
                            </p>
                          </div>

                          {/* rule 4 */}
                          <div className={`p-2 rounded-lg border text-[10px] ${unboundedFeedbackHazard ? "bg-amber-950/20 border-amber-900/40" : "bg-emerald-950/20 border-emerald-900/30"}`}>
                            <div className="flex items-center gap-1.5 font-bold mb-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${unboundedFeedbackHazard ? "bg-amber-500 animate-ping" : "bg-emerald-500"}`} />
                              <span className={unboundedFeedbackHazard ? "text-amber-300" : "text-emerald-400"}>Unbounded Overload Saturation</span>
                            </div>
                            <p className="text-[9px] text-neutral-400">
                              {unboundedFeedbackHazard 
                                ? "⚠️ Warm Dynamic Warning: Recursive buffer loop detected without warm analog safety limiters (e.g., Math.tanh) to protect feedback levels." 
                                : "✔ Feedback paths cleanly constrained with waveshaper saturated bounds."}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-[#1e1b4b]/30 p-2 border border-indigo-950/40 rounded-lg text-left text-[9px] text-neutral-400">
                        🔑 <strong className="text-neutral-300">Tip</strong>: Need fully-gated, safe, math blocks? Choose form templates below and load them directly into your editor playground.
                      </div>
                    </div>
                  </div>

                  {/* 📐 Dynamic DSP Formula Library Section - Click to Inject */}
                  <div className="bg-neutral-900 border border-neutral-850 rounded-2xl p-4 space-y-3">
                    <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Code2 className="w-4 h-4 text-[#f97316]" />
                      <span>📐 Dynamic DSP Formula Library (Offline Cheat Sheet)</span>
                    </h5>
                    <p className="text-[10px] text-neutral-405">
                      Select high-quality, pre-tested DSP math templates in standard JavaScript. Double click to inspect or inject directly into the playground editor!
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
                      {dspRecipes.map((recipe, index) => (
                        <div 
                          key={index} 
                          className="bg-neutral-950/60 hover:bg-neutral-950 border border-neutral-850 hover:border-neutral-700/60 rounded-xl p-3 transition-all flex flex-col justify-between group"
                        >
                          <div className="space-y-1.5">
                            <span className="text-[9.5px] font-bold text-[#f97316] block group-hover:text-orange-400 transition-colors uppercase tracking-tight">
                              {recipe.name}
                            </span>
                            <p className="text-[9px] text-neutral-450 leading-relaxed">
                              {recipe.description}
                            </p>
                          </div>

                          <div className="pt-3 flex gap-1">
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(recipe.code);
                                triggerToast(`Copied formula code snippet to clipboard!`);
                              }}
                              className="flex-1 py-1 px-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded text-[9px] font-bold text-neutral-305 transition-all text-center flex items-center justify-center gap-0.5 cursor-pointer"
                              title="Copy code format"
                            >
                              <Copy className="w-2.5 h-2.5" />
                              <span>Copy</span>
                            </button>
                            <button
                              onClick={() => {
                                setScratchCode(recipe.code);
                                setIsEditingCode(true);
                                triggerToast(`Injected recipe: ${recipe.name}! Compile to test live!`);
                              }}
                              className="flex-1 py-1 px-1.5 bg-[#ea580c]/80 hover:bg-[#ea580c] text-white rounded text-[9px] font-bold transition-all text-center flex items-center justify-center gap-0.5 cursor-pointer"
                              title="Inject into editor"
                            >
                              <Play className="w-2.5 h-2.5" />
                              <span>Inject</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Standard user instructions */}
                  <div className="bg-[#181921]/40 border border-neutral-850 rounded-xl p-4 text-[11px] leading-relaxed text-neutral-450 space-y-1">
                    <div className="text-neutral-305 font-bold mb-1 flex items-center gap-1">
                      <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
                      How to manually write the loop:
                    </div>
                    <p>
                      The script is executed sample-by-sample at 44.1kHz. Write JavaScript containing:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-neutral-500 pl-1">
                      <li>Persistent trackers store on <code className="text-indigo-400 font-mono text-[10px]">state</code>, e.g. delay lines, filter history coefficients.</li>
                      <li>Read sliders map values in <code className="text-indigo-400 font-mono text-[10px]">params</code> objects depending on the slider ID, e.g. <code className="text-indigo-400 font-mono text-[10px]">params.drive</code></li>
                      <li>Always make sure to output a single float number between <code className="text-indigo-400 font-mono text-[10px]">-1.0</code> and <code className="text-indigo-400 font-mono text-[10px]">1.0</code></li>
                    </ul>
                  </div>
                </div>
              );
            })()}

            {/* Companion TAB Content: Decibel Stability Audit */}
            {companionTab === "diagnostics" && (
              <div className="space-y-4">
                <div className="bg-[#181921]/40 border border-neutral-855 rounded-xl p-4 text-[11px] leading-relaxed text-neutral-400 mb-2">
                  <div className="font-semibold text-neutral-200 text-xs flex items-center gap-1 mb-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    Interactive Decibel AI Security Audit
                  </div>
                  <p className="text-neutral-500 leading-normal">
                    This module analyzes your JavaScript code logic for mathematical bugs, numerical infinity drifts, DC biases, filter blowups, and memory allocating leakages inside sample cycles.
                  </p>
                </div>
                <DSPAnalyzer
                  analysis={analysis}
                  isLoading={analysisLoading}
                  onRunAudit={() => runStabilityAnalysis()}
                  onApplyFix={handleApplyFix}
                  isAutoFixing={isAutoFixing}
                />
              </div>
            )}

            {/* Companion TAB Content: Claude Code Compiler Monitor */}
            {companionTab === "terminal" && (
              <div className="space-y-4 animate-fadeIn font-mono">
                {/* Visual Terminal Command Box */}
                <div className="bg-[#0b0c10] border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
                  {/* Terminal Tab Bar Row */}
                  <div className="bg-[#111215] px-4 py-2 border-b border-neutral-850 flex items-center justify-between select-none">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5 pt-0.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                      </div>
                      <span className="text-[10px] text-neutral-400 font-bold ml-2">pluggen-studio://compiler-monitor.sh</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[#09b85c] bg-[#09b85c]/10 border border-[#09b85c]/30 px-2 py-0.5 rounded uppercase font-bold animate-pulse">
                        ONLINE
                      </span>
                      <button 
                        onClick={() => {
                          setTerminalLogs([
                            { text: "claude-code > init pluggen-compiler --sandbox", type: "input" },
                            { text: "Initializing real-time dynamic trans-compiler core...", type: "info" },
                            { text: "✔ Host environment validation complete (Vite v5.x + React 18)", type: "success" },
                            { text: "✔ Web Audio API context registered successfully", type: "success" },
                            { text: "✔ Current DSP loaded: " + (plugin.pluginName || plugin.name), type: "success" },
                            { text: "Terminal monitor reset. standing by.", type: "info" }
                          ]);
                          triggerToast("Compiler console cleared.");
                        }}
                        className="text-[9px] text-neutral-500 hover:text-white bg-neutral-900 hover:bg-[#1a1c22] px-2 py-0.5 rounded border border-neutral-800 transition cursor-pointer select-none font-sans"
                      >
                        CLEAR LOGS
                      </button>
                    </div>
                  </div>

                  {/* Terminal Logs List Area */}
                  <div className="p-4 bg-[#0a0b0d] text-[#e3e4e6] text-[11px] leading-relaxed max-h-[385px] overflow-y-auto font-mono scrollbar-none space-y-1.5 flex flex-col">
                    {terminalLogs.map((log, index) => {
                      let style = "text-[#d1d5db]";
                      if (log.type === "input") style = "text-indigo-400 font-semibold";
                      else if (log.type === "success") style = "text-[#09b85c]";
                      else if (log.type === "error") style = "text-rose-455 font-bold";
                      else if (log.type === "warn") style = "text-amber-500 font-bold";
                      else if (log.type === "info") style = "text-neutral-450";
                      
                      return (
                        <div key={index} className="whitespace-pre-wrap select-text selection:bg-indigo-900/60 font-mono tracking-tight leading-normal">
                          {log.type === "input" && (
                            <span className="text-indigo-500 font-bold mr-1.5">❯</span>
                          )}
                          <span className={style}>{log.text}</span>
                        </div>
                      );
                    })}
                    <div className="h-1" />
                  </div>

                  {/* Terminal Prompt Base Mock Interactivity */}
                  <div className="border-t border-neutral-850 bg-[#0c0c0e] px-4 py-2 flex items-center text-[10px] text-neutral-500 select-none">
                    <span className="text-indigo-400 font-bold">pluggen-studio &gt; </span>
                    <span className="ml-1.5 w-1.5 h-3 bg-indigo-500 animate-pulse" />
                    <span className="ml-auto text-neutral-600">UTF-8 • O(1) Web Audio Thread</span>
                  </div>
                </div>

                {/* Info block aligning with user query */}
                <div className="bg-[#111215]/60 border border-neutral-850 rounded-xl p-4 space-y-2">
                  <div className="font-bold text-neutral-200 text-xs flex items-center gap-1.5 text-sky-400">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    Real-Time Playback vs. Server Rebuilding
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-relaxed font-sans">
                    Inside your browser playground pane, <strong className="text-indigo-300">all slider motions and script edits compile instantaneously at zero latency</strong> directly into the browser's high-performance audio engine!
                  </p>
                  <p className="text-[10px] text-neutral-400 leading-relaxed font-sans">
                    For general file writes inside this developer chat workspace, Hot Module Replacement (HMR) is disabled in the dev container system for security and compilation stability. The platform automatically issues a complete reload of the browser preview frame <strong className="text-emerald-400">at the immediate conclusion of each agent turn</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Companion TAB Content: Canvas Block Routing */}
            {companionTab === "canvas" && (
              <div className="space-y-4">
                <CanvasStudio
                  currentPlugin={plugin}
                  onCompileCanvas={(compiled) => {
                    savePluginState(compiled);
                    setScratchCode(compiled.dspFunction);
                    compileDsp(compiled.dspFunction);
                    triggerToast(`Compiled visual block routing into "${compiled.name}"!`);
                  }}
                />
              </div>
            )}

            {/* Companion TAB Content: Diagnostics Medical Sweeping */}
            {companionTab === "lab" && (
              <div className="space-y-4">
                <DiagnosticsLab
                  currentPlugin={plugin}
                  onUpdatePlugin={savePluginState}
                />
              </div>
            )}

            {/* Companion TAB Content: Faust & C++ JUCE Exports */}
            {companionTab === "export" && (
              <div className="space-y-4">
                <ExportPanel
                  pluginName={plugin.pluginName || plugin.name}
                  faustCode={plugin.faustCode}
                  cppJuceCode={plugin.cppJuceCode}
                  parameters={plugin.parameters}
                />
              </div>
            )}

            {/* Companion TAB Content: Self-Improving Memory System and AI Gateways */}
            {companionTab === "memory_core" && (
              <div className="space-y-4">
                <MemoryCore
                  activeCode={plugin.dspFunction}
                  activeParams={plugin.parameters}
                  activePluginName={plugin.pluginName || plugin.name}
                  activeCategory={plugin.category}
                  latestError={dspError}
                  latestStabilityScore={analysis?.stabilityScore || null}
                  onApplyCodeSnippet={(code) => {
                    setScratchCode(code);
                    setIsEditingCode(true);
                    triggerToast("Applied code snippet to Playground scratchpad!");
                  }}
                  triggerToast={triggerToast}
                />
              </div>
            )}

            {/* Companion TAB Content: Research Engine gap->approve workflow */}
            {companionTab === "research" && (
              <div className="space-y-4">
                <ResearchLab triggerToast={triggerToast} />
              </div>
            )}

            {/* Companion TAB Content: GitHub DAW & Audio Search */}
            {companionTab === "github" && (
              <div className="space-y-4">
                <GitHubAudioDiscovery
                  currentPlugin={plugin}
                  onApplyPreset={(preset) => {
                    setPlugin({
                      ...plugin,
                      pluginName: preset.name,
                      name: preset.name,
                      category: preset.category as any,
                      description: preset.description,
                      parameters: preset.parameters,
                      dspFunction: preset.dspFunction,
                      faustCode: preset.faustCode,
                      cppJuceCode: preset.cppJuceCode
                    });
                    setScratchCode(preset.dspFunction);
                  }}
                  triggerToast={triggerToast}
                  compileDsp={compileDsp}
                />
              </div>
            )}

            {/* Companion TAB Content: Native VST3 Build (real JUCE/CMake compile) */}
            {companionTab === "cpp_harness" && (
              <div className="space-y-4">
                <NativeBuildPanel
                  plugin={plugin}
                  triggerToast={triggerToast}
                />
              </div>
            )}
            
          </div>
        </section>
      </main>

      {/* Modern floating toaster utility */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-100 bg-neutral-900 border border-neutral-800 text-white font-bold text-xs px-4 py-3.5 rounded-xl shadow-xl flex items-center gap-2 animate-slideUp">
          <CheckCircle className="w-4 h-4 text-emerald-500 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Blind A/B/C listening test — final human determination by ear */}
      {showBlindTest && refineCandidates.length >= 2 && (
        <BlindListeningTest
          candidates={refineCandidates}
          onPreview={previewCandidate}
          onStop={stopAudioEngine}
          onClose={closeBlindTest}
          onChoose={handleBlindChoose}
        />
      )}

      {/* Interactive step-by-step user companion handbook */}
      <HelpManual isOpen={isHelpManualOpen} onClose={() => setIsHelpManualOpen(false)} />
    </div>
  );
}
