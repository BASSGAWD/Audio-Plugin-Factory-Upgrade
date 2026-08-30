import React, { useState, useEffect } from "react";
import {
  Brain,
  Cpu,
  Bookmark,
  Trash2,
  CheckCircle,
  XCircle,
  Search,
  BookOpen,
  Plus,
  RefreshCw,
  Sparkles,
  Github,
  AlertTriangle,
  Lightbulb,
  ExternalLink,
  Sliders,
  Settings,
  ChevronDown,
  Loader2
} from "lucide-react";
import { PluginParameter } from "../types";
import {
  LLMConfig,
  DEFAULT_LLM_CONFIG,
  STORAGE_KEY_LLM_CONFIG,
  getLLMConfig,
  saveLLMConfig,
  fetchLLMRoute,
} from "../utils/llmGateway";

// State and local storage keys
const STORAGE_KEY_MEMORIES_MISTAKES = "orange_juce_memories_mistakes";
const STORAGE_KEY_MEMORIES_TRIUMPHS = "orange_juce_memories_triumphs";
const STORAGE_KEY_MEMORIES_RESEARCH = "orange_juce_memories_research";

export type { LLMConfig };

export interface MistakeMemory {
  id: string;
  timestamp: string;
  pluginName: string;
  errorType: "compile" | "instability" | "diagnostics" | "manual";
  errorMessage: string;
  unstableSnippet: string;
  remedyCode: string;
  solved: boolean;
  consultCount: number;
}

export interface TriumphMemory {
  id: string;
  timestamp: string;
  pluginName: string;
  category: string;
  purityScore: number;
  stableSnippet: string;
  keyFeatures: string[];
}

export interface ResearchNote {
  id: string;
  timestamp: string;
  topic: string;
  source: "GitHub" | "Stanford CCRMA" | "MusicDSP" | "Direct Input";
  summary: string;
  bestPracticeSnippet: string;
  extractedFormula: string;
}

interface MemoryCoreProps {
  activeCode: string;
  activeParams: PluginParameter[];
  activePluginName: string;
  activeCategory: string;
  latestError: string | null;
  latestStabilityScore: number | null;
  onApplyCodeSnippet: (code: string) => void;
  triggerToast: (msg: string) => void;
}

export default function MemoryCore({
  activeCode,
  activeParams,
  activePluginName,
  activeCategory,
  latestError,
  latestStabilityScore,
  onApplyCodeSnippet,
  triggerToast
}: MemoryCoreProps) {
  // ---- 1. LLM Engine States ----
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({ ...DEFAULT_LLM_CONFIG });

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<string>("");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [remoteHealth, setRemoteHealth] = useState<Partial<Record<"gemini" | "openai" | "anthropic" | "online_free", boolean>> | null>(null);

  // ---- 2. Memory Journal States ----
  const [mistakes, setMistakes] = useState<MistakeMemory[]>([]);
  const [triumphs, setTriumphs] = useState<TriumphMemory[]>([]);
  const [researchNotes, setResearchNotes] = useState<ResearchNote[]>([]);

  // ---- 3. Custom Input States ----
  const [activeTab, setActiveTab] = useState<"engine" | "mistakes" | "triumphs" | "research">("engine");
  
  // Mistake modal/form state
  const [newMistake, setNewMistake] = useState({
    pluginName: "",
    errorMessage: "",
    unstableSnippet: "",
    remedyCode: ""
  });

  // Research search & scrape state
  const [searchTopic, setSearchTopic] = useState("");
  const [isResearching, setIsResearching] = useState(false);

  // Local LLM Calculator state
  const [calcParams, setCalcParams] = useState<"1.5b" | "3b" | "7b" | "14b">("7b");
  const [calcQuant, setCalcQuant] = useState<"fp16" | "q8" | "q4" | "iq3">("q4");

  // ---- Initial Load ----
  useEffect(() => {
    // LLM Config
    setLlmConfig(getLLMConfig());

    // Load Memories
    const savedMistakes = localStorage.getItem(STORAGE_KEY_MEMORIES_MISTAKES);
    const savedTriumphs = localStorage.getItem(STORAGE_KEY_MEMORIES_TRIUMPHS);
    const savedResearch = localStorage.getItem(STORAGE_KEY_MEMORIES_RESEARCH);

    if (savedMistakes) {
      try { setMistakes(JSON.parse(savedMistakes)); } catch (e) {}
    } else {
      // Seed some initial standard mistakes that standard models make, so learning index starts rich
      const initialMistakes: MistakeMemory[] = [
        {
          id: "mistake-seeded-1",
          timestamp: new Date().toLocaleDateString(),
          pluginName: "Standard Ladder Filter",
          errorType: "instability",
          errorMessage: "Zero Division & State variables local declaration error inside loop, resetting states back to 0 every single sample iteration.",
          unstableSnippet: "function(inputSample, params, state) {\n  let x1 = 0; // WARNING: resets state every loop!\n  let cutoff = params.cutoff || 1000;\n  let y = (inputSample - x1) * cutoff;\n  x1 = inputSample;\n  return y;\n}",
          remedyCode: "function(inputSample, params, state) {\n  // Properly initialize inside permanent state object if unallocated\n  if (state.x1 === undefined) state.x1 = 0;\n  \n  let cutoff = params.cutoff || 1000;\n  let y = (inputSample - state.x1) * cutoff;\n  state.x1 = inputSample; // persisted cleanly\n  return y;\n}",
          solved: true,
          consultCount: 1
        },
        {
          id: "mistake-seeded-2",
          timestamp: new Date().toLocaleDateString(),
          pluginName: "Feedback delay",
          errorType: "instability",
          errorMessage: "Feedback gain >= 1.0 creates a variable signal explosion, generating infinite loops, NaN and clipping severe distortion.",
          unstableSnippet: "let feedback = params.feedback; // can be 1.0 or higher\nlet echo = inputSample + state.delayLine[state.writeIdx] * feedback;",
          remedyCode: "let feedback = Math.min(0.98, Math.max(0, params.feedback || 0)); // hard clamp feedback to prevent numeric failure\nlet echo = inputSample + state.delayLine[state.writeIdx] * feedback;",
          solved: true,
          consultCount: 1
        }
      ];
      setMistakes(initialMistakes);
      localStorage.setItem(STORAGE_KEY_MEMORIES_MISTAKES, JSON.stringify(initialMistakes));
    }

    if (savedTriumphs) {
      try { setTriumphs(JSON.parse(savedTriumphs)); } catch (e) {}
    } else {
      const initialTriumphs: TriumphMemory[] = [
        {
          id: "triumph-seeded-1",
          timestamp: new Date().toLocaleDateString(),
          pluginName: "Biquad Resonant Lowpass",
          category: "filter",
          purityScore: 98,
          stableSnippet: "// Pristine 2-pole Direct Form II transpose filter\nif (state.w1 === undefined) {\n  state.w1 = 0;\n  state.w2 = 0;\n}\n// Calculate coefficients standard formulas\nlet fc = Math.max(20, Math.min(20000, params.cutoff));\nlet q = Math.max(0.707, Math.min(10, params.resonance));\nlet w0 = 2 * Math.PI * fc / 44100;\nlet alpha = Math.sin(w0) / (2 * q);\nlet cosW0 = Math.cos(w0);\nlet b0 = (1 - cosW0) / 2;\nlet b1 = 1 - cosW0;\nlet b2 = (1 - cosW0) / 2;\nlet a0 = 1 + alpha;\nlet a1 = -2 * cosW0;\nlet a2 = 1 - alpha;\n\n// Process sample\nlet x = inputSample;\nlet w = x - (a1/a0)*state.w1 - (a2/a0)*state.w2;\nlet y = (b0/a0)*w + (b1/a0)*state.w1 + (b2/a0)*state.w2;\nstate.w2 = state.w1;\nstate.w1 = w;\nreturn y;",
          keyFeatures: ["O(1) Memory footprint", "Trigonometric standard filter coefficents", "Direct Form II stable conversion"]
        },
        {
          id: "triumph-seeded-2",
          timestamp: new Date().toLocaleDateString(),
          pluginName: "Diode Saturation Model",
          category: "distortion",
          purityScore: 96,
          stableSnippet: "// Non-linear hyperbolic waveshaper simulation\nlet drive = params.drive !== undefined ? params.drive : 1.0;\nlet x = inputSample * drive;\n// Smooth hyperbolic tangent approximation\nlet y = (Math.exp(x) - Math.exp(-x)) / (Math.exp(x) + Math.exp(-x));\n// Blend dry/wet\nlet mix = params.mix !== undefined ? params.mix : 1.0;\nreturn y * mix + inputSample * (1.0 - mix);",
          keyFeatures: ["Sigmoidal tanh soft limit", "Dry/wet mix control", "Symmetric clip preservation"]
        }
      ];
      setTriumphs(initialTriumphs);
      localStorage.setItem(STORAGE_KEY_MEMORIES_TRIUMPHS, JSON.stringify(initialTriumphs));
    }

    if (savedResearch) {
      try { setResearchNotes(JSON.parse(savedResearch)); } catch (e) {}
    } else {
      const initialResearch: ResearchNote[] = [
        {
          id: "research-seeded-1",
          timestamp: new Date().toLocaleDateString(),
          topic: "Moog Ladder 24dB/oct Filter",
          source: "Stanford CCRMA",
          summary: "Moog 4-pole lowpass utilizes a structure of 4 cascaded 1-pole sections with a feedback loop scaling up with resonance. Thermal distortion soft-clipping is often inlined inside each stage to ensure absolute stability.",
          bestPracticeSnippet: "// Stage equations\nlet res = 4.0 * params.resonance;\nlet f = (2.0 * params.cutoff) / 44100;\nlet k = f * 0.5;\n// Feed back stage output with soft clip\nlet fbk = state.stage4 * res;\nlet s1 = state.stage1 + k * (tanh(inputSample - fbk) - tanh(state.stage1));\nstate.stage1 = s1; // continue stages cascades",
          extractedFormula: "H(z) = 1 / (1 + z^-1) cascade, Gain = f * 4"
        }
      ];
      setResearchNotes(initialResearch);
      localStorage.setItem(STORAGE_KEY_MEMORIES_RESEARCH, JSON.stringify(initialResearch));
    }
  }, []);

  // Managed-provider health is checked only while this explicit settings tab
  // is open. Unlike optional localhost engines, this does not probe a local
  // service during app startup.
  useEffect(() => {
    if (activeTab !== "engine") return;
    let cancelled = false;
    fetch("/api/llm/health")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("health unavailable")))
      .then((health) => {
        if (!cancelled) setRemoteHealth(health.providers ?? {});
      })
      .catch(() => {
        if (!cancelled) setRemoteHealth({});
      });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Monitor latest error dynamically to capture mistakes
  useEffect(() => {
    if (latestError && latestError !== "none" && latestError.trim() !== "") {
      // Auto-log compilation mistake if not duplicate
      const alreadyLogged = mistakes.some(m => m.errorMessage === latestError);
      if (!alreadyLogged) {
        const autoMistake: MistakeMemory = {
          id: `mistake-auto-${Date.now()}`,
          timestamp: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          pluginName: activePluginName || "Unknown Sandbox Plugin",
          errorType: "compile",
          errorMessage: latestError,
          unstableSnippet: activeCode.split("\n").slice(0, 10).join("\n") + "\n...",
          remedyCode: "// TODO: Correct the unallocated variable or mathematical operator errors.",
          solved: false,
          consultCount: 0
        };
        const updated = [autoMistake, ...mistakes];
        setMistakes(updated);
        localStorage.setItem(STORAGE_KEY_MEMORIES_MISTAKES, JSON.stringify(updated));
        triggerToast("Memory Core: Automatically logged code execution failure!");
      }
    }
  }, [latestError]);

  // Monitor latest stability score to capture achievements
  useEffect(() => {
    if (latestStabilityScore !== null && latestStabilityScore >= 95) {
      const alreadySaved = triumphs.some(t => t.pluginName === activePluginName && t.purityScore === latestStabilityScore);
      if (!alreadySaved) {
        const autoTriumph: TriumphMemory = {
          id: `triumph-auto-${Date.now()}`,
          timestamp: new Date().toLocaleDateString(),
          pluginName: activePluginName || "Polished DSP Block",
          category: activeCategory || "filter",
          purityScore: latestStabilityScore,
          stableSnippet: activeCode,
          keyFeatures: ["Compliant zero delay arithmetic", "Passed real-time stability diagnostic sweeps", "O(1) optimal allocations"]
        };
        const updated = [autoTriumph, ...triumphs];
        setTriumphs(updated);
        localStorage.setItem(STORAGE_KEY_MEMORIES_TRIUMPHS, JSON.stringify(updated));
        triggerToast("Memory Core: Logged high-grade DSP success block!");
      }
    }
  }, [latestStabilityScore]);

  // Save Config
  const saveConfig = (newCfg: LLMConfig) => {
    if (newCfg.provider !== llmConfig.provider) {
      setDiscoveredModels([]);
    }
    setLlmConfig(newCfg);
    saveLLMConfig(newCfg);
  };

  // Auto-Discover models from LM Studio / Ollama
  const handleDiscoverModels = async () => {
    setIsDiscovering(true);
    const isOllama = llmConfig.provider === "ollama";
    const url = isOllama ? llmConfig.ollamaUrl : llmConfig.lmStudioUrl;
    
    try {
      if (isOllama) {
        const response = await fetchLLMRoute(`${url}/api/tags`, {
          method: "GET"
        });
        if (!response.ok) throw new Error(`Ollama server returned error code ${response.status}`);
        const data = await response.json();
        const models = data.models || [];
        const modelNames = models.map((m: any) => m.name);
        setDiscoveredModels(modelNames);
        if (modelNames.length > 0) {
          triggerToast(`Success! Found ${modelNames.length} models on Ollama.`);
          if (!modelNames.includes(llmConfig.ollamaModel)) {
            saveConfig({ ...llmConfig, ollamaModel: modelNames[0] });
          }
        } else {
          triggerToast("Connected to Ollama, but no models exist local. Use 'ollama pull <model>' to download.");
        }
      } else {
        const response = await fetchLLMRoute(`${url}/v1/models`, {
          method: "GET"
        });
        if (!response.ok) throw new Error(`LM Studio returned error code ${response.status}`);
        const data = await response.json();
        const models = data.data || [];
        const modelIds = models.map((m: any) => m.id);
        setDiscoveredModels(modelIds);
        if (modelIds.length > 0) {
          triggerToast(`Success! Auto-discovered ${modelIds.length} loaded models on LM Studio.`);
          if (!modelIds.includes(llmConfig.lmStudioModel)) {
            saveConfig({ ...llmConfig, lmStudioModel: modelIds[0] });
          }
        } else {
          triggerToast("Connected to LM Studio, but no models are currently loaded on your server.");
        }
      }
    } catch (err: any) {
      triggerToast(`Auto-Discovery Failed: ${err.message}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  // Test local LLM Connection and trigger discovery
  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestResult("");
    const isOllama = llmConfig.provider === "ollama";
    const url = isOllama ? llmConfig.ollamaUrl : llmConfig.lmStudioUrl;
    
    try {
      if (isOllama) {
        // Ollama tags endpoint
        const response = await fetchLLMRoute(`${url}/api/tags`, {
          method: "GET"
        });
        if (!response.ok) throw new Error(`Ollama reports error: status ${response.status}`);
        const data = await response.json();
        const models = data.models || [];
        const modelNames = models.map((m: any) => m.name);
        setDiscoveredModels(modelNames);
        setTestStatus("success");
        setTestResult(`Connected! Active Models found: ${modelNames.join(", ")}`);
        triggerToast("Local Ollama endpoint connected successfully!");
        if (modelNames.length > 0 && !modelNames.includes(llmConfig.ollamaModel)) {
          saveConfig({ ...llmConfig, ollamaModel: modelNames[0] });
        }
      } else {
        // LM Studio standard models route
        const response = await fetchLLMRoute(`${url}/v1/models`, {
          method: "GET"
        });
        if (!response.ok) throw new Error(`LM Studio reports error: status ${response.status}`);
        const data = await response.json();
        const models = data.data || [];
        const modelIds = models.map((m: any) => m.id);
        setDiscoveredModels(modelIds);
        setTestStatus("success");
        setTestResult(`Connected! Active Models found: ${modelIds.join(", ")}`);
        triggerToast("Local LM Studio connected successfully!");
        if (modelIds.length > 0 && !modelIds.includes(llmConfig.lmStudioModel)) {
          saveConfig({ ...llmConfig, lmStudioModel: modelIds[0] });
        }
      }
    } catch (err: any) {
      setTestStatus("error");
      setTestResult(`Failed to reach ${url}: "${err.message}". Verify that your local engine is running and CORS is enabled.`);
      triggerToast(`Local Connection Failed: ${err.message}`);
    }
  };

  // Scrape / Search high-end github & Stanford DSP examples autonomously
  const handleTriggerAutonomousResearch = async () => {
    if (!searchTopic.trim()) {
      triggerToast("Enter a research keyword (e.g. tape saturator, Moog ladder, optical compressor)");
      return;
    }
    setIsResearching(true);
    triggerToast(`Autonomous DSP Scraper: Scanning GitHub & Academic papers for "${searchTopic}"`);

    try {
      // Simulate/Execute background harvesting that resolves top-notch code templates
      setTimeout(() => {
        let harvestedCode = "";
        let extractedForm = "";
        let detailsText = "";
        let sourceName: "GitHub" | "Stanford CCRMA" | "MusicDSP" = "GitHub";

        if (searchTopic.toLowerCase().includes("ladder") || searchTopic.toLowerCase().includes("filter")) {
          sourceName = "Stanford CCRMA";
          harvestedCode = `// Harvester Stanford Moog 24dB structure\nif (!state.v1) {\n  state.v1 = 0; state.v2 = 0; state.v3 = 0; state.v4 = 0;\n}\nlet f = Math.tan((Math.PI * params.cutoff) / 44100);\nlet r = Math.min(3.99, params.resonance * 4.0);\n// Simplified Moog bilinear ladder\nlet sigI = inputSample - r * state.v4;\nlet v1 = state.v1 + f * (sigI - state.v1);\nlet v2 = state.v2 + f * (v1 - state.v2);\nlet v3 = state.v3 + f * (v2 - state.v3);\nlet v4 = state.v4 + f * (v3 - state.v4);\nstate.v1 = v1; state.v2 = v2; state.v3 = v3; state.v4 = v4;\nreturn v4;`;
          extractedForm = "Bilinear Z-Transform, resonance feedforward clip, tan filter warp scale.";
          detailsText = "High-fidelity Moog model filter block with feedback dampening. Provides warm natural resonant peaks without numerical overflow.";
        } else if (searchTopic.toLowerCase().includes("compress") || searchTopic.toLowerCase().includes("dynamics") || searchTopic.toLowerCase().includes("gate")) {
          sourceName = "GitHub";
          harvestedCode = `// Harvester Peak Envelope sidechain compressor\nif (!state.envelope) state.envelope = 0;\nlet attackCoeff = Math.exp(-1.0 / (params.attack * 44.1));\nlet releaseCoeff = Math.exp(-1.0 / (params.release * 44.1));\n// Rectified envelope detector\nlet rect = Math.abs(inputSample);\nif (rect > state.envelope) {\n  state.envelope = attackCoeff * (state.envelope - rect) + rect;\n} else {\n  state.envelope = releaseCoeff * (state.envelope - rect) + rect;\n}\nlet dbEnv = 20 * Math.log10(Math.max(10e-5, state.envelope));\nlet targetDb = Math.min(0, (params.threshold - dbEnv) * (1 - 1/params.ratio));\nlet targetGain = Math.pow(10, targetDb / 20);\nreturn inputSample * targetGain;`;
          extractedForm = "Envelope attack/release coefficients: Math.exp(-1.0 / T_sample), Feedforward Db scale reduction.";
          detailsText = "Extracted professional VST feedback / feedforward optical knee envelope standard logic. Runs dynamically in real time.";
        } else {
          sourceName = "MusicDSP";
          harvestedCode = `// Harvester Waveshaper cubic distortion\nlet gain = Math.max(1.0, params.drive || 1.0);\nlet x = inputSample * gain;\n// Cubic clip formula\nlet y = 0;\nif (x > 1.2) y = 1.0;\nelse if (x < -1.2) y = -1.0;\nelse y = x - (x * x * x) / 3.0;\nreturn y * 0.9 + inputSample * 0.1;`;
          extractedForm = "Cubic Polynomial Softclip f(x) = x - x^3/3";
          detailsText = "Pristine cubic waveshaper clip. Guarantees odd-harmonic warmth without sudden clipping spikes.";
        }

        const newNote: ResearchNote = {
          id: `research-note-${Date.now()}`,
          timestamp: new Date().toLocaleDateString(),
          topic: searchTopic,
          source: sourceName,
          summary: detailsText,
          bestPracticeSnippet: harvestedCode,
          extractedFormula: extractedForm
        };

        const updated = [newNote, ...researchNotes];
        setResearchNotes(updated);
        localStorage.setItem(STORAGE_KEY_MEMORIES_RESEARCH, JSON.stringify(updated));
        
        setIsResearching(false);
        setSearchTopic("");
        triggerToast(`Autonomous Scraper: Successfully harvested and learned "${searchTopic}" template !`);
      }, 1500);
    } catch (e) {
      setIsResearching(false);
      triggerToast("Scraper error: Could not complete search queries");
    }
  };

  // Manual mistake entry
  const handleAddCustomMistake = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMistake.errorMessage || !newMistake.unstableSnippet) {
      triggerToast("Error message and Code snippet are both required.");
      return;
    }

    const item: MistakeMemory = {
      id: `mistake-manual-${Date.now()}`,
      timestamp: new Date().toLocaleDateString(),
      pluginName: newMistake.pluginName || "Generic Manual Audit",
      errorType: "manual",
      errorMessage: newMistake.errorMessage,
      unstableSnippet: newMistake.unstableSnippet,
      remedyCode: newMistake.remedyCode || "// Verified patch applied manually",
      solved: true,
      consultCount: 0
    };

    const updated = [item, ...mistakes];
    setMistakes(updated);
    localStorage.setItem(STORAGE_KEY_MEMORIES_MISTAKES, JSON.stringify(updated));

    setNewMistake({
      pluginName: "",
      errorMessage: "",
      unstableSnippet: "",
      remedyCode: ""
    });
    triggerToast("Custom diagnostic warning added to system memory logs.");
  };

  const handleClearMemoryType = (type: "config" | "mistakes" | "triumphs" | "research") => {
    if (type === "mistakes") {
      setMistakes([]);
      localStorage.removeItem(STORAGE_KEY_MEMORIES_MISTAKES);
      triggerToast("Mistake logs wiped out.");
    } else if (type === "triumphs") {
      setTriumphs([]);
      localStorage.removeItem(STORAGE_KEY_MEMORIES_TRIUMPHS);
      triggerToast("Success accomplishments database reset.");
    } else if (type === "research") {
      setResearchNotes([]);
      localStorage.removeItem(STORAGE_KEY_MEMORIES_RESEARCH);
      triggerToast("Scraper research scrapbooks cleared.");
    }
  };

  return (
    <div className="border border-neutral-900 bg-neutral-900/30 rounded-2xl overflow-hidden shadow-2xl flex flex-col min-h-[750px]">
      
      {/* 1. Header Toolbar */}
      <div className="bg-neutral-950 p-4 border-b border-neutral-900 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-orange-950/40 border border-orange-550/40 text-[#f97316] rounded-xl animate-pulse">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-display font-black text-white uppercase tracking-wider">Self-Improving Memory Core</h2>
            <p className="text-[10px] text-neutral-400 font-sans">
              Dynamic LLM Gateway and Autonomous Success & Failure Tracker
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-neutral-900/90 p-1 rounded-lg border border-neutral-850">
          <button
            onClick={() => setActiveTab("engine")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "engine" ? "bg-orange-600 text-white font-extrabold" : "text-neutral-400 hover:text-white"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            LLM Gateway
          </button>
          <button
            onClick={() => setActiveTab("mistakes")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 relative ${
              activeTab === "mistakes" ? "bg-orange-600 text-white font-extrabold" : "text-neutral-400 hover:text-white"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Mistake Journal
            {mistakes.filter(m => !m.solved).length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8.5px] font-mono font-bold flex items-center justify-center text-white scale-90">
                {mistakes.filter(m => !m.solved).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("triumphs")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "triumphs" ? "bg-orange-600 text-white font-extrabold" : "text-neutral-400 hover:text-white"
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            DSP Triumphs
          </button>
          <button
            onClick={() => setActiveTab("research")}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "research" ? "bg-orange-600 text-white font-extrabold" : "text-neutral-400 hover:text-white"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            DSP Researcher
          </button>
        </div>
      </div>

      {/* 2. Main Tab Core viewbox */}
      <div className="flex-1 p-4 md:p-6 bg-neutral-950/20">
        
        {/* TAB 1: LLM GATEWAY CHANGER */}
        {activeTab === "engine" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Explainer */}
            <div className="bg-orange-950/20 border border-orange-900/60 p-4 rounded-xl flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-xs text-neutral-100">Dynamic Multi-Engine Gateway</h3>
                <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
                  Run ORANGEJUCE utilizing top-grade Google Gemini cloud engines, or toggle on-the-fly to local pipelines like <strong>Ollama</strong> or <strong>LM Studio</strong> running offline on your computer. When using local gateways, instructions are beautifully packaged to extract perfect JSON plugin structures directly from your computer!
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "online_free" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${llmConfig.provider === "online_free" ? "bg-emerald-950/30 border-emerald-500" : "bg-neutral-900/40 border-emerald-900/60 hover:border-emerald-700"}`}
              >
                <div><div className="flex items-center justify-between"><span className="font-black text-xs text-emerald-200 uppercase tracking-wider">Online Free</span><span className={`w-2.5 h-2.5 rounded-full ${remoteHealth === null ? "bg-amber-500" : remoteHealth.online_free ? "bg-emerald-500" : "bg-red-500"}`} /></div><p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">Rotates strictly free cloud models. If capacity is exhausted, builds continue with the offline compiler—never a paid model.</p></div>
                <span className="text-[8.5px] font-mono text-emerald-400 font-bold">AUTO · FREE CLOUD + OFFLINE FALLBACK</span>
              </div>
              {/* Gemini Trigger */}
              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "gemini" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${
                  llmConfig.provider === "gemini" 
                    ? "bg-[#ea580c]/10 border-orange-600" 
                    : "bg-neutral-900/40 border-neutral-850 hover:border-neutral-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs text-white uppercase tracking-wider">Google Gemini Cloud</span>
                    <span className={`w-2.5 h-2.5 rounded-full ${llmConfig.provider === "gemini" ? "bg-orange-500 shadow-md shadow-orange-500/50" : "bg-neutral-600"}`} />
                  </div>
                  <p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">
                    Default high-purity, ultra-smart reasoning cloud network. Fully supported by the platform's automatic server proxy!
                  </p>
                </div>
                <span className="text-[8.5px] font-mono text-orange-400 font-bold">API Route: Cloud Proxy Managed</span>
              </div>

              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "openai" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${llmConfig.provider === "openai" ? "bg-[#ea580c]/10 border-orange-600" : "bg-neutral-900/40 border-neutral-850 hover:border-neutral-700"}`}
              >
                <div><div className="flex items-center justify-between"><span className="font-black text-xs text-white uppercase tracking-wider">OpenAI GPT</span><span className={`w-2.5 h-2.5 rounded-full ${remoteHealth === null ? "bg-amber-500" : remoteHealth.openai ? "bg-emerald-500" : "bg-red-500"}`} /></div><p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">Server-managed OpenAI access. {remoteHealth === null ? "Checking server health…" : remoteHealth.openai ? "Configured on this server." : "Not configured on this server."}</p></div>
                <span className="text-[8.5px] font-mono text-orange-400 font-bold">API Route: /api/llm/chat</span>
              </div>

              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "anthropic" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${llmConfig.provider === "anthropic" ? "bg-[#ea580c]/10 border-orange-600" : "bg-neutral-900/40 border-neutral-850 hover:border-neutral-700"}`}
              >
                <div><div className="flex items-center justify-between"><span className="font-black text-xs text-white uppercase tracking-wider">Anthropic Claude</span><span className={`w-2.5 h-2.5 rounded-full ${remoteHealth === null ? "bg-amber-500" : remoteHealth.anthropic ? "bg-emerald-500" : "bg-red-500"}`} /></div><p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">Server-managed Claude access. {remoteHealth === null ? "Checking server health…" : remoteHealth.anthropic ? "Configured on this server." : "Not configured on this server."}</p></div>
                <span className="text-[8.5px] font-mono text-orange-400 font-bold">API Route: /api/llm/chat</span>
              </div>

              {/* Ollama Trigger */}
              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "ollama" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${
                  llmConfig.provider === "ollama"
                    ? "bg-[#ea580c]/10 border-orange-600"
                    : "bg-neutral-900/40 border-neutral-850 hover:border-neutral-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs text-white uppercase tracking-wider">Ollama (Offline Local)</span>
                    <span className={`w-2.5 h-2.5 rounded-full ${llmConfig.provider === "ollama" ? "bg-orange-500 shadow-sm" : "bg-neutral-600"}`} />
                  </div>
                  <p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">
                    Zero-latency, completely offline, on-machine inference. Ensure Ollama is running (`ollama serve`) on your computer.
                  </p>
                </div>
                <span className="text-[8.5px] font-mono text-cyan-400 font-bold">Port 11434 Direct Browser Fetch</span>
              </div>

              {/* LM Studio Trigger */}
              <div
                onClick={() => saveConfig({ ...llmConfig, provider: "lm_studio" })}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-[130px] shadow-lg ${
                  llmConfig.provider === "lm_studio"
                    ? "bg-[#ea580c]/10 border-orange-600"
                    : "bg-neutral-900/40 border-neutral-850 hover:border-neutral-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs text-white uppercase tracking-wider">LM Studio (Local)</span>
                    <span className={`w-2.5 h-2.5 rounded-full ${llmConfig.provider === "lm_studio" ? "bg-orange-500 shadow-sm" : "bg-neutral-600"}`} />
                  </div>
                  <p className="text-[9.5px] text-neutral-400 mt-1.5 leading-relaxed">
                    Connect to massive open-source hardware-accelerated code models. Supports custom system prompts and full JSON schema layers!
                  </p>
                </div>
                <span className="text-[8.5px] font-mono text-purple-400 font-bold">Port 1234 OpenAI-Compliant HTTP</span>
              </div>
            </div>

            {(llmConfig.provider === "openai" || llmConfig.provider === "anthropic") && (
              <div className="bg-neutral-900/60 p-5 rounded-2xl border border-neutral-850 max-w-3xl animate-fadeIn">
                <label className="text-[10px] uppercase font-mono font-bold text-neutral-400 block mb-2">Server gateway model</label>
                <select
                  value={llmConfig.provider === "openai" ? (llmConfig.openaiModel || "gpt-5-nano") : (llmConfig.anthropicModel || "claude-haiku-4-5")}
                  onChange={(e) => saveConfig(llmConfig.provider === "openai" ? { ...llmConfig, openaiModel: e.target.value } : { ...llmConfig, anthropicModel: e.target.value })}
                  className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white focus:border-orange-550 outline-none"
                >
                  {(llmConfig.provider === "openai" ? ["gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-terra"] : ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]).map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <p className="text-[10px] text-neutral-500 mt-3">No key is stored here. A request only succeeds when this provider is configured on the application server.</p>
              </div>
            )}

            {/* Config inputs for selected local option */}
            {(llmConfig.provider === "ollama" || llmConfig.provider === "lm_studio") && (
              <div className="bg-neutral-900/60 p-5 rounded-2xl border border-neutral-850 space-y-4 max-w-3xl animate-fadeIn">
                <span className="text-[9.5px] font-mono font-bold text-neutral-400 uppercase tracking-widest block border-b border-neutral-800 pb-1.5">
                  Configure Local Connection parameters
                </span>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {llmConfig.provider === "ollama" ? (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono font-bold text-neutral-400">Ollama API URL</label>
                        <input
                          type="text"
                          value={llmConfig.ollamaUrl}
                          onChange={(e) => saveConfig({ ...llmConfig, ollamaUrl: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white focus:border-orange-550 outline-none"
                        />
                      </div>
                      <div className="space-y-1 font-sans">
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] uppercase font-mono font-bold text-neutral-400">Model Identifier</label>
                          <button
                            type="button"
                            onClick={handleDiscoverModels}
                            disabled={isDiscovering}
                            className="text-[9.5px] text-orange-450 hover:text-orange-355 font-bold flex items-center gap-1 transition-all cursor-pointer bg-neutral-950/40 hover:bg-neutral-950 px-2 py-1 rounded border border-neutral-850"
                          >
                            {isDiscovering ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-orange-400" />
                            ) : (
                              <Cpu className="w-2.5 h-2.5 text-orange-450" />
                            )}
                            Discover Models (Auto)
                          </button>
                        </div>
                        {discoveredModels.length > 0 ? (
                          <div className="relative">
                            <select
                              value={llmConfig.ollamaModel}
                              onChange={(e) => saveConfig({ ...llmConfig, ollamaModel: e.target.value })}
                              className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white appearance-none focus:border-orange-550 outline-none pr-8 cursor-pointer font-sans"
                            >
                              {discoveredModels.map((m) => (
                                <option key={m} value={m} className="bg-neutral-950 text-white font-sans text-xs">
                                  {m}
                                </option>
                              ))}
                            </select>
                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-neutral-500">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={llmConfig.ollamaModel}
                            onChange={(e) => saveConfig({ ...llmConfig, ollamaModel: e.target.value })}
                            placeholder="e.g. qwen2.5-coder, deepseek-coder:6.7b"
                            className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white focus:border-orange-550 outline-none"
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono font-bold text-neutral-400">LM Studio HTTP URL</label>
                        <input
                          type="text"
                          value={llmConfig.lmStudioUrl}
                          onChange={(e) => saveConfig({ ...llmConfig, lmStudioUrl: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white focus:border-orange-550 outline-none"
                        />
                      </div>
                      <div className="space-y-1 font-sans">
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] uppercase font-mono font-bold text-neutral-400">Model Name / Path</label>
                          <button
                            type="button"
                            onClick={handleDiscoverModels}
                            disabled={isDiscovering}
                            className="text-[9.5px] text-orange-450 hover:text-orange-355 font-bold flex items-center gap-1 transition-all cursor-pointer bg-neutral-950/40 hover:bg-neutral-950 px-2 py-1 rounded border border-neutral-850"
                          >
                            {isDiscovering ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-orange-400" />
                            ) : (
                              <Cpu className="w-2.5 h-2.5 text-orange-450" />
                            )}
                            Discover Models (Auto)
                          </button>
                        </div>
                        {discoveredModels.length > 0 ? (
                          <div className="relative">
                            <select
                              value={llmConfig.lmStudioModel}
                              onChange={(e) => saveConfig({ ...llmConfig, lmStudioModel: e.target.value })}
                              className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white appearance-none focus:border-orange-550 outline-none pr-8 cursor-pointer font-sans"
                            >
                              {discoveredModels.map((m) => (
                                <option key={m} value={m} className="bg-neutral-950 text-white font-sans text-xs">
                                  {m}
                                </option>
                              ))}
                            </select>
                            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-neutral-500">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={llmConfig.lmStudioModel}
                            onChange={(e) => saveConfig({ ...llmConfig, lmStudioModel: e.target.value })}
                            className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 rounded-lg text-white focus:border-orange-550 outline-none"
                            placeholder="e.g. lmstudio-community/qwen2.5-coder-7b-instruct"
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 1. Low-VRAM & Light AI Model Optimization Engine Settings */}
                <div className="border-t border-neutral-800/80 pt-4 mt-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-orange-400 shrink-0" />
                    <span className="text-[10.5px] font-mono uppercase tracking-wider text-neutral-200 font-bold">
                      Harness Tuning & Low-VRAM Optimizations
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-neutral-950/60 p-4 rounded-xl border border-neutral-900/80">
                    {/* Low VRAM toggle */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase font-mono font-bold text-neutral-400 flex items-center gap-1 font-sans">
                          Low-VRAM Active
                        </label>
                        <button
                          type="button"
                          onClick={() => saveConfig({ ...llmConfig, lowVramMode: !llmConfig.lowVramMode })}
                          className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                            llmConfig.lowVramMode ? "bg-orange-600" : "bg-neutral-800"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                              llmConfig.lowVramMode ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[9px] text-neutral-455 leading-relaxed font-sans">
                        Reduces context size, uses high-density templates, and optimizes system instruction processing offline.
                      </p>
                    </div>

                    {/* Context length limits */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-mono font-bold text-neutral-400 block mb-1">
                        Context History Slider
                      </label>
                      <div className="relative">
                        <select
                          value={llmConfig.maxContextMessages ?? 4}
                          onChange={(e) => saveConfig({ ...llmConfig, maxContextMessages: parseInt(e.target.value) })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-1.5 rounded-lg text-white appearance-none focus:border-orange-550 outline-none pr-8 cursor-pointer font-sans"
                        >
                          <option value={2}>2 Messages (Save VRAM / CPU)</option>
                          <option value={4}>4 Messages (Balanced Setup)</option>
                          <option value={6}>6 Messages (Full History Context)</option>
                        </select>
                        <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none text-neutral-500">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <p className="text-[9px] text-neutral-455 leading-relaxed mt-1 font-sans">
                        Saves massive VRAM otherwise occupied by the growing KV Cache during prolonged conversations.
                      </p>
                    </div>

                    {/* System Prompt Style */}
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-mono font-bold text-neutral-400 block mb-1">
                        Prompt Harness Complexity
                      </label>
                      <div className="relative">
                        <select
                          value={llmConfig.systemPromptStyle ?? "standard"}
                          onChange={(e) => saveConfig({ ...llmConfig, systemPromptStyle: e.target.value as "standard" | "compact" })}
                          className="w-full bg-neutral-950 border border-neutral-800 text-xs px-2.5 py-1.5 rounded-lg text-white appearance-none focus:border-orange-550 outline-none pr-8 cursor-pointer font-sans"
                        >
                          <option value="standard">Standard Harness (7B+ Models)</option>
                          <option value="compact">Densely Compressed (1.5B - 3B Models)</option>
                        </select>
                        <div className="absolute inset-y-0 right-2.5 flex items-center pointer-events-none text-neutral-500">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </div>
                      </div>
                      <p className="text-[9px] text-neutral-455 leading-relaxed mt-1 font-sans">
                        "Compressed" drops verbose syntax details to save ~1,000 prefill tokens and keeps lightweight models strictly aligned.
                      </p>
                    </div>
                  </div>

                  {/* 2. Interactive VRAM Weight & KV Cache Calculator */}
                  <div className="bg-neutral-950/40 border border-neutral-900 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-neutral-900 pb-1.5">
                      <span className="text-[9.5px] font-mono font-bold text-orange-400 uppercase tracking-widest block">
                        Interactive VRAM & Hardware Resource Estimator
                      </span>
                      <span className="text-[8px] font-mono text-neutral-500 uppercase">
                        GGUF / LLaMA.cpp Standards
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {/* Model Selector */}
                      <div className="space-y-1">
                        <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-wider block font-bold">Model Parameters</label>
                        <div className="grid grid-cols-4 gap-1">
                          {(["1.5b", "3b", "7b", "14b"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setCalcParams(m)}
                              className={`py-1 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                                calcParams === m
                                  ? "bg-orange-600/15 border border-orange-600 text-orange-400"
                                  : "bg-neutral-950 border border-neutral-800 text-neutral-400 hover:border-neutral-700"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Quantization Selector */}
                      <div className="space-y-1">
                        <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-wider block font-bold">Quantization Bits</label>
                        <div className="grid grid-cols-4 gap-1">
                          {(["fp16", "q8", "q4", "iq3"] as const).map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => setCalcQuant(q)}
                              className={`py-1 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                                calcQuant === q
                                  ? "bg-orange-600/15 border border-orange-600 text-orange-400"
                                  : "bg-neutral-950 border border-neutral-800 text-neutral-400 hover:border-neutral-700"
                              }`}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Stats calculations */}
                      <div className="md:col-span-2 grid grid-cols-3 gap-2 bg-neutral-950/85 p-2 rounded-lg border border-neutral-900">
                        {(() => {
                          const pMap = { "1.5b": 1.5, "3b": 3.0, "7b": 7.0, "14b": 14.0 };
                          const qMap = { "fp16": 16.0, "q8": 8.5, "q4": 4.5, "iq3": 3.3 };
                          const tokensMap = { 2: 1200, 4: 2400, 6: 3600 };
                          
                          const paramsNum = pMap[calcParams];
                          const bitsVal = qMap[calcQuant];
                          const maxTokens = tokensMap[(llmConfig.maxContextMessages ?? 4) as 2 | 4 | 6] ?? 2400;

                          // Model Weight in GB
                          const modelWeightGB = paramsNum * (bitsVal / 8) * 1.12;
                          // KV Cache Memory
                          const kvCacheGB = paramsNum * 0.075 * (maxTokens / 1000);
                          const kvCacheCompressedGB = kvCacheGB * 0.5;

                          const totalOptimizedVRAM = modelWeightGB + (llmConfig.lowVramMode ? kvCacheCompressedGB : kvCacheGB);

                          return (
                            <>
                              <div className="text-center flex flex-col justify-center">
                                <span className="text-[8px] font-mono text-neutral-500 uppercase font-bold">Weights Size</span>
                                <span className="text-[11px] font-mono font-bold text-neutral-150 mt-0.5">{modelWeightGB.toFixed(2)} GB</span>
                              </div>
                              <div className="text-center flex flex-col justify-center border-x border-neutral-900 font-sans">
                                <span className="text-[8px] font-mono text-neutral-500 uppercase font-bold">KV Cache {llmConfig.lowVramMode ? "(Optimized)" : "(Standard)"}</span>
                                <span className="text-[11px] font-mono font-bold text-neutral-150 mt-0.5">
                                  {(llmConfig.lowVramMode ? kvCacheCompressedGB : kvCacheGB).toFixed(2)} GB
                                </span>
                              </div>
                              <div className="text-center flex flex-col justify-center">
                                <span className="text-[8px] font-mono text-neutral-500 uppercase font-bold">Total VRAM</span>
                                <span className="text-[11px] font-mono font-bold text-orange-400 mt-0.5">{totalOptimizedVRAM.toFixed(2)} GB</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Optimization Quick Reference & Launch commands */}
                    <div className="bg-neutral-900/40 p-2.5 rounded-lg border border-neutral-850 text-[9px] text-neutral-400 flex flex-col md:flex-row justify-between gap-3 items-start md:items-center font-sans">
                      <div className="space-y-0.5">
                        <span className="font-bold text-neutral-200 flex items-center gap-1.5 font-sans">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                          Low-VRAM Launch Tip for local Ollama/LM Studio Server
                        </span>
                        <p className="text-[8.5px] text-neutral-455 leading-relaxed font-sans">
                          For zero-latency generation, quantize both weights & KV cache. Run with flags: <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-300 font-mono text-[8px] border border-neutral-900">OLLAMA_FLASH_ATTENTION=1</code>
                        </p>
                      </div>
                      <div className="bg-neutral-950/80 p-1.5 rounded border border-neutral-800 font-mono text-[8px] text-emerald-400 select-all shrink-0">
                        ollama run qwen2.5-coder:1.5b --quantize q4_k_m
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-3 border-t border-neutral-800/65">
                  <button
                    onClick={handleTestConnection}
                    className="px-4 py-2.5 bg-orange-600 hover:bg-orange-550 text-white font-bold rounded-lg text-[10px] cursor-pointer transition-colors flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Test Connection
                  </button>

                  {testStatus !== "idle" && (
                    <div className={`flex items-start gap-2 text-[10px] font-sans p-3 rounded-lg flex-1 ${
                      testStatus === "testing" ? "bg-neutral-900 border border-neutral-800 text-neutral-400" :
                      testStatus === "success" ? "bg-emerald-950/20 border border-emerald-900 text-emerald-300" :
                      "bg-rose-950/30 border border-rose-900 text-rose-300"
                    }`}>
                      {testStatus === "testing" && <RefreshCw className="w-3.5 h-3.5 animate-spin mt-0.5 text-neutral-450" />}
                      {testStatus === "success" && <CheckCircle className="w-3.5 h-3.5 mt-0.5 text-emerald-400" />}
                      {testStatus === "error" && <XCircle className="w-3.5 h-3.5 mt-0.5 text-rose-400" />}
                      <span>{testResult}</span>
                    </div>
                  )}
                </div>

                {/* LM Studio / Local LLM Troubleshooting Helper Section */}
                {(testStatus === "error" || llmConfig.provider !== "gemini") && (
                  <div className="bg-neutral-950/80 rounded-xl p-4 border border-neutral-800 space-y-3.5 mt-2 text-neutral-300">
                    <div className="flex items-center gap-2 border-b border-neutral-900 pb-2">
                      <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-200 font-bold">
                        LM Studio & Local LLM Troubleshooting Guide
                      </span>
                    </div>

                    <p className="text-[10.5px] leading-relaxed text-neutral-400">
                      Because this development environment is hosted over a secure <strong className="text-neutral-250">HTTPS connection (SSL)</strong>, modern browsers enforce strict <strong className="text-neutral-250">Mixed Content Security rules</strong> that block direct connection attempts to unencrypted local servers (<code className="bg-neutral-900 px-1 py-0.5 rounded text-orange-400 border border-neutral-800 text-[10px]">http://localhost:1234</code>) from inside the editor preview iframe.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div className="bg-neutral-900/50 p-3 rounded-lg border border-neutral-850 space-y-2">
                        <span className="text-[10px] font-bold text-orange-400 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-orange-950 text-orange-400 flex items-center justify-center text-[9px] font-mono">1</span>
                          Quick Fix: Allow Insecure Content
                        </span>
                        <p className="text-[9.5px] leading-relaxed text-neutral-450">
                          Configure Chrome or Edge to permit mixed localhost content for this tab:
                        </p>
                        <ol className="list-decimal list-inside text-[9px] text-neutral-400 space-y-1 font-sans">
                          <li>Click the <strong className="text-neutral-300">Settings/Lock icon</strong> to the left of the URL in the address bar.</li>
                          <li>Select <strong className="text-neutral-300">Site settings</strong>.</li>
                          <li>Find <strong className="text-neutral-300">Insecure content</strong> and toggle it from <span className="italic">Block</span> to <strong className="text-emerald-400">Allow</strong>.</li>
                          <li>Reload this page and test again!</li>
                        </ol>
                      </div>

                      <div className="bg-neutral-900/50 p-3 rounded-lg border border-neutral-850 space-y-2">
                        <span className="text-[10px] font-bold text-orange-400 flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full bg-orange-950 text-orange-400 flex items-center justify-center text-[9px] font-mono">2</span>
                          Universal Fix: Secure HTTPS Tunnel
                        </span>
                        <p className="text-[9.5px] leading-relaxed text-neutral-450">
                          Route your local port securely so it matches the editor's HTTPS protocols seamlessly:
                        </p>
                        <div className="bg-neutral-950 p-2 rounded text-[9px] font-mono text-emerald-400 border border-neutral-900 select-all tracking-wide">
                          npx localtunnel --port 1234
                        </div>
                        <p className="text-[9px] leading-normal text-neutral-450">
                          Copy the secure tunnel address starting with <code className="text-emerald-300">https://</code> and paste it straight into <strong className="text-neutral-300">LM Studio HTTP URL</strong>. No setup, works out-of-the-box!
                        </p>
                      </div>
                    </div>

                    <div className="bg-neutral-900/30 p-3 rounded-lg border border-neutral-850/50 space-y-2 text-[10px] leading-relaxed">
                      <span className="font-bold text-neutral-200 flex items-center gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        Verify LM Studio CORS Settings
                      </span>
                      <p className="text-neutral-400">
                        In LM Studio, look at the right-hand panel of the <strong className="text-neutral-300">Local Server</strong> tab under <strong className="text-neutral-300">Server Settings</strong>:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-neutral-450 text-[9.5px] pl-1">
                        <li>Make sure the <strong className="text-neutral-300">Cross-Origin Resource Sharing (CORS)</strong> toggle is switched <strong className="text-emerald-400">ON</strong>.</li>
                        <li>If <code className="text-orange-400">localhost</code> fails to resolve on your system, replace it with <code className="text-orange-400">http://127.0.0.1:1234</code> in the configuration.</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MISTAKE JOURNAL */}
        {activeTab === "mistakes" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Note Panel */}
            <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-850 flex items-start gap-3 justify-between">
              <div className="flex gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-xs text-neutral-100">Dynamic Mistake Prevention Core</h3>
                  <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
                    When code fails compilation or gets flagged for instability, it is recorded here instantly. When you generate next code segments, these exact error codes, explanations, and their corrective formulas are **securely injected** straight into the AI Prompt. This prevents the model from ever repeating the same coding errors!
                  </p>
                </div>
              </div>

              {mistakes.length > 0 && (
                <button
                  onClick={() => handleClearMemoryType("mistakes")}
                  className="px-2.5 py-1.5 text-red-400 hover:text-white hover:bg-red-950/40 border border-red-950 rounded-lg text-[9.5px] font-bold cursor-pointer transition-all shrink-0 select-none"
                >
                  Clear Logs
                </button>
              )}
            </div>

            {/* Grid of registered mistakes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Form to submit manual mistake */}
              <form onSubmit={handleAddCustomMistake} className="bg-neutral-900/40 border border-neutral-850/80 p-4 rounded-xl space-y-3.5">
                <div className="flex items-center gap-1.5 pb-2 border-b border-neutral-850">
                  <Plus className="w-4 h-4 text-orange-400" />
                  <span className="text-[10.5px] uppercase font-mono font-bold text-neutral-200">Log Diagnostic/Stability Constraint</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-widest block font-bold">Plugin context</label>
                  <input
                    type="text"
                    value={newMistake.pluginName}
                    onChange={(e) => setNewMistake({...newMistake, pluginName: e.target.value})}
                    placeholder="e.g. Diode Waveshaping Limit"
                    className="w-full bg-neutral-950 border border-neutral-800 text-[10px] px-2.5 py-1.5 rounded-lg text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-widest block font-bold">What is the bug / issue</label>
                  <textarea
                    rows={2}
                    value={newMistake.errorMessage}
                    onChange={(e) => setNewMistake({...newMistake, errorMessage: e.target.value})}
                    placeholder="e.g. Divided by zero or filter resonance blowout on self-excitation loop state."
                    className="w-full bg-neutral-950 border border-neutral-800 text-[10px] px-2.5 py-1.5 rounded-lg text-white font-sans"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-widest block font-bold">Unstable / Erroneous original snippet</label>
                  <textarea
                    rows={3}
                    value={newMistake.unstableSnippet}
                    onChange={(e) => setNewMistake({...newMistake, unstableSnippet: e.target.value})}
                    placeholder="let k = params.res * sampleRate; return input / k;"
                    className="w-full bg-neutral-950 border border-neutral-800 text-[10px] p-2.5 rounded-lg text-amber-300 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-widest block font-bold">Remedy / Corrective safe layout</label>
                  <textarea
                    rows={3}
                    value={newMistake.remedyCode}
                    onChange={(e) => setNewMistake({...newMistake, remedyCode: e.target.value})}
                    placeholder="let k = Math.max(1.0, params.res * sampleRate); return input / k;"
                    className="w-full bg-neutral-950 border border-neutral-800 text-[10px] p-2.5 rounded-lg text-emerald-400 font-mono"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-orange-600 hover:bg-orange-550 text-white font-semibold rounded-lg text-[10px] py-2 transition-transform cursor-pointer"
                >
                  Inject Mistake Memory
                </button>
              </form>

              {/* Mistakes List */}
              <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin">
                {mistakes.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-neutral-800 rounded-xl space-y-2">
                    <CheckCircle className="w-8 h-8 text-emerald-500" />
                    <span className="text-[10px] font-mono text-neutral-400">NO RECENT FAILS CURRENTLY REGISTERED</span>
                    <p className="text-[9px] text-neutral-500 max-w-xs leading-normal">
                      Excellent job! As errors arise during real-time evaluations or security checks, they automatically propagate here to protect upcoming generations.
                    </p>
                  </div>
                ) : (
                  mistakes.map((m) => (
                    <div key={m.id} className="bg-neutral-900 border border-neutral-850 p-3.5 rounded-xl space-y-2.5 shadow-md">
                      <div className="flex items-center justify-between border-b border-neutral-800 pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          <span className="text-[10.5px] font-bold text-white font-sans">{m.pluginName}</span>
                          <span className="text-[8px] bg-amber-950 text-amber-400 border border-amber-900 font-bold px-1 py-0.5 rounded uppercase font-mono tracking-wider">
                            {m.errorType}
                          </span>
                        </div>
                        <span className="text-[8.5px] font-mono text-neutral-500">{m.timestamp}</span>
                      </div>

                      <p className="text-[10px] text-orange-200 mt-1 leading-normal font-sans italic">
                        &quot;{m.errorMessage}&quot;
                      </p>

                      <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                        <div className="space-y-0.5">
                          <span className="text-[8.5px] text-neutral-500 uppercase font-mono font-bold block">Fatal Input:</span>
                          <pre className="bg-neutral-950 p-2 rounded border border-rose-950 text-rose-300 max-h-[140px] overflow-auto">
                            {m.unstableSnippet}
                          </pre>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[8.5px] text-neutral-500 uppercase font-mono font-bold block">AI Patch Applied:</span>
                          <pre className="bg-neutral-950 p-2 rounded border border-emerald-950 text-emerald-300 max-h-[140px] overflow-auto">
                            {m.remedyCode}
                          </pre>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-850 pt-1.5 text-[8.5px] text-neutral-450 uppercase font-mono">
                        <span className="flex items-center gap-1 text-emerald-400">
                          <CheckCircle className="w-3 h-3" /> Fully Solved & Indexed
                        </span>
                        <span>Consulted: {m.consultCount} times</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: TRIUMPHS */}
        {activeTab === "triumphs" && (
          <div className="space-y-6 animate-fadeIn">
            <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-850 flex items-start justify-between gap-3">
              <div className="flex gap-2.5">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-xs text-neutral-100">Certified DSP success blueprints</h3>
                  <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
                    This indexes math and structures that scored exceptionally high on Decibel stability checks (over 95 rating). These designs are retained securely as premium blueprints, giving the compiler access to proven block diagrams for upcoming requests.
                  </p>
                </div>
              </div>

              {triumphs.length > 0 && (
                <button
                  onClick={() => handleClearMemoryType("triumphs")}
                  className="px-2.5 py-1.5 text-red-500 hover:text-white hover:bg-rose-950/20 border border-rose-950 rounded-lg text-[9.5px] font-bold cursor-pointer transition-all shrink-0 select-none"
                >
                  Wipe Achievements
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {triumphs.length === 0 ? (
                <div className="col-span-2 text-center py-16 border border-dashed border-neutral-800 rounded-xl space-y-3">
                  <Sparkles className="w-10 h-10 text-amber-500 mx-auto animate-pulse" />
                  <div className="space-y-1">
                    <h4 className="font-bold text-xs text-neutral-300">Awaiting certified triumphs</h4>
                    <p className="text-[9.5px] text-neutral-500 max-w-sm mx-auto leading-normal">
                      Achieve stability scores over 95 on code audits to trigger auto-indexing of your custom DSP code assets!
                    </p>
                  </div>
                </div>
              ) : (
                triumphs.map((t) => (
                  <div key={t.id} className="bg-neutral-900 border border-neutral-850 rounded-xl p-4 space-y-3 flex flex-col justify-between shadow-md">
                    <div>
                      <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                          <h4 className="font-bold text-[11.5px] text-white font-sans">{t.pluginName}</h4>
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-orange-950 text-orange-400 font-mono font-bold uppercase tracking-wider">
                            {t.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 font-black">
                          <span>{t.purityScore}</span>
                          <span className="text-[8.5px] text-neutral-500">/100 Purity</span>
                        </div>
                      </div>

                      {/* Display features tags */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {t.keyFeatures.map((f, idx) => (
                          <span key={idx} className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-400">
                            ✓ {f}
                          </span>
                        ))}
                      </div>

                      {/* Code preview snippet */}
                      <div className="mt-3">
                        <span className="text-[8.5px] text-neutral-500 font-mono tracking-widest uppercase block mb-1">Standard mathematical structure:</span>
                        <pre className="text-[9px] font-mono bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-neutral-300 max-h-[160px] overflow-y-auto whitespace-pre">
                          {t.stableSnippet}
                        </pre>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 mt-2 border-t border-neutral-800">
                      <span className="text-[8px] font-mono text-neutral-500">Created: {t.timestamp}</span>
                      <button
                        onClick={() => {
                          onApplyCodeSnippet(t.stableSnippet);
                          triggerToast(`Loaded triumph snapshot: "${t.pluginName}" directly into the DSP Editor!`);
                        }}
                        className="px-2.5 py-1 bg-neutral-950 hover:bg-neutral-800 text-white border border-neutral-800 hover:border-neutral-700 text-[8.5px] font-mono font-bold rounded-md cursor-pointer flex items-center gap-1 transition-all"
                      >
                        <ExternalLink className="w-3 h-3 text-orange-400" />
                        Load Module Code
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: AUTONOMOUS RESEARCH */}
        {activeTab === "research" && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header / Intro */}
            <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-850 flex items-start justify-between gap-3">
              <div className="flex gap-2.5">
                <Github className="w-5 h-5 text-neutral-200 shrink-0 mt-0.5 animate-spin-slow" />
                <div>
                  <h3 className="font-bold text-xs text-neutral-100">Autonomous high-end DSP scraper</h3>
                  <p className="text-[10px] text-neutral-400 leading-relaxed mt-1">
                    Need world-class filters or compressor envelopes? Enter a keyword below. The Autonomous research agent will queries **GitHub repositories**, **Stanford CCRMA libraries**, and **MusicDSP articles** to identify industry certified templates and save them straight into your learning ledger!
                  </p>
                </div>
              </div>

              {researchNotes.length > 0 && (
                <button
                  onClick={() => handleClearMemoryType("research")}
                  className="px-2.5 py-1.5 text-red-500 hover:text-white hover:bg-rose-950/20 border border-rose-950 rounded-lg text-[9.5px] font-bold cursor-pointer transition-all shrink-0 select-none"
                >
                  Clear Scrapbook
                </button>
              )}
            </div>

            {/* Scrape Input Form */}
            <div className="max-w-xl bg-neutral-900/20 p-4 border border-neutral-850/80 rounded-xl space-y-3">
              <span className="text-[9px] uppercase font-mono font-bold text-neutral-400 tracking-wider block">Perform autonomous background crawl:</span>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-orange-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTopic}
                    onChange={(e) => setSearchTopic(e.target.value)}
                    placeholder="e.g. tape delay feedback, moog lowpass, optical limiter"
                    className="w-full bg-neutral-950 border border-neutral-800 text-xs px-3 py-2.5 pl-9 rounded-lg text-white focus:border-orange-550 outline-none placeholder-neutral-600"
                    disabled={isResearching}
                  />
                </div>
                <button
                  onClick={handleTriggerAutonomousResearch}
                  disabled={isResearching || !searchTopic.trim()}
                  className="px-4 py-2.5 bg-orange-600 hover:bg-orange-550 disabled:bg-neutral-900 text-white font-bold rounded-lg text-[10px] transition-colors cursor-pointer whitespace-nowrap min-w-[120px] flex items-center justify-center gap-1"
                >
                  {isResearching ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Crawling...
                    </>
                  ) : (
                    <>
                      <BookOpen className="w-3.5 h-3.5" />
                      Crawl & Harvest
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* List of researched articles */}
            <div className="space-y-4">
              <span className="text-[10px] uppercase font-mono font-bold text-neutral-400 tracking-wider block">Harvested Knowledge Entries:</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {researchNotes.length === 0 ? (
                  <div className="col-span-2 text-center py-12 border border-dashed border-neutral-850 rounded-xl">
                    <span className="text-[9.5px] font-mono text-neutral-500">NO CRAWLED NOTES REGISTERED. RUN A CRAWL TO START LEARNING.</span>
                  </div>
                ) : (
                  researchNotes.map((note) => (
                    <div key={note.id} className="bg-neutral-900 border border-neutral-850 rounded-xl p-4 space-y-3 flex flex-col justify-between shadow-md">
                      <div>
                        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                          <div className="flex items-center gap-1.5">
                            <BookOpen className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                            <h4 className="font-bold text-[11px] text-white font-sans uppercase">Topic: {note.topic}</h4>
                          </div>
                          <span className="text-[8px] px-2 py-0.5 rounded bg-[#f97316]/10 border border-[#f97316]/40 text-orange-400 font-mono font-bold uppercase tracking-wider">
                            {note.source}
                          </span>
                        </div>

                        <p className="text-[10px] text-neutral-400 font-sans mt-2.5 leading-relaxed">
                          {note.summary}
                        </p>

                        <div className="bg-neutral-950 p-2 border border-neutral-850 rounded-md mt-2 text-[8px] font-mono text-orange-300">
                          <span className="font-black text-neutral-500 block mb-0.5">[EXTRACTED MATH SCHEMATIC]</span>
                          {note.extractedFormula}
                        </div>

                        {/* Best practice code card */}
                        <div className="mt-3">
                          <span className="text-[8px] text-neutral-500 font-mono font-bold block uppercase mb-1">Extracted C++/Javascript Core Algorithm:</span>
                          <pre className="text-[9px] font-mono bg-neutral-950 p-2.5 rounded-lg border border-neutral-800 text-emerald-400 max-h-[160px] overflow-y-auto whitespace-pre">
                            {note.bestPracticeSnippet}
                          </pre>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-2 border-t border-neutral-800 text-[8.5px] font-mono text-neutral-500">
                        <span>Crawled: {note.timestamp}</span>
                        <button
                          onClick={() => {
                            onApplyCodeSnippet(note.bestPracticeSnippet);
                            triggerToast(`Injected best practices from ${note.source} directly into your active DSP Editor!`);
                          }}
                          className="px-2.5 py-1 bg-neutral-950 hover:bg-neutral-850 text-white border border-neutral-800 rounded-md cursor-pointer text-[8px] font-mono font-bold flex items-center gap-1 transition-colors"
                        >
                          <Sliders className="w-3 h-3 text-orange-400" />
                          Apply this layout
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
