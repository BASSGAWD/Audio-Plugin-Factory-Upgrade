import React, { useState } from "react";
import { 
  X, 
  HelpCircle, 
  BookOpen, 
  Sparkles, 
  Sliders, 
  Bookmark, 
  Code2, 
  Workflow, 
  Activity, 
  Terminal,
  Search,
  CheckCircle,
  Play,
  HeartPulse,
  Bug,
  Info,
  ArrowRight
} from "lucide-react";

interface HelpManualProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpManual({ isOpen, onClose }: HelpManualProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"intro" | "modules" | "canvas" | "qa" | "cheatsheet">("intro");

  if (!isOpen) return null;

  const sections = [
    {
      id: "intro",
      title: "Introduction",
      keywords: "orangejuce tutorial welcome manual start dsp guide",
      content: (
        <div className="space-y-4">
          <div className="bg-orange-955/50 border border-orange-900/60 p-4 rounded-xl space-y-2">
            <h4 className="text-sm font-bold text-orange-400 flex items-center gap-1.5 font-display">
              <Sparkles className="w-4 h-4 text-orange-400 animate-pulse" />
              Welcome to the ORANGEJUCE DSP Studio Manual
            </h4>
            <p className="text-[11px] text-neutral-300 leading-relaxed">
              ORANGEJUCE is a high-craft, real-time, browser-native <strong>Digital Signal Processing (DSP) Co-Processor and Sandbox</strong>. 
              Equipped with a live virtual feedback loop simulation, you can write mathematical signal formulas, connect visual modules, 
              stress-test configurations, and experience automated self-healing AST compilers.
            </p>
          </div>

          <div className="space-y-2 text-[11px] text-neutral-400 leading-relaxed">
            <p className="font-bold text-xs text-neutral-200">How the Live Simulation Works:</p>
            <p>
              In real time, your audio is mapped down to individual samples at <strong>44,100Hz (44.1kHz standard)</strong>. Every single sample 
              is processed by your custom mathematics or arranged signal blocks. The visual waveform analyzer at the center charts these 
              floating-point computations to display waveshaping outputs, frequency sweeps, or recursive echo delay lines instantly.
            </p>
            <p>
              Use the tabs at the top of the companion screen to jump between modules, and click the <strong>"?"</strong> button anytime you need reference!
            </p>
          </div>

          {/* Screenshot Emulator */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">Screenshot: App Overview</span>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-2 select-none relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/[0.02] to-transparent pointer-events-none" />
              {/* Header emulator */}
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-850">
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                  <span className="text-[10px] font-bold font-mono text-neutral-250 uppercase tracking-wide">ORANGEJUCE STUDIO</span>
                </div>
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-750" />
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-750" />
                  <div className="w-1.5 h-1.5 rounded-full bg-neutral-750" />
                </div>
              </div>
              {/* Main Area Emulator */}
              <div className="grid grid-cols-12 gap-2 text-[8px] font-mono">
                <div className="col-span-4 bg-neutral-950 border border-neutral-800 p-1.5 rounded text-neutral-500 flex flex-col justify-between h-20">
                  <div>
                    <div className="text-orange-400 font-bold mb-0.5 border-b border-neutral-900 pb-0.5">Left sidebar</div>
                    <span>• Oscillations</span><br/>
                    <span>• Sweep Tests</span>
                  </div>
                  <div className="bg-neutral-900/60 p-0.5 rounded text-center text-[7px] text-neutral-400">44.1 kHz Wave Engine</div>
                </div>
                <div className="col-span-8 bg-neutral-950 border border-neutral-800 p-1.5 rounded text-neutral-300 space-y-1 h-20 flex flex-col justify-between">
                  <div>
                    <div className="text-indigo-400 font-bold mb-1 border-b border-neutral-900 pb-0.5 flex justify-between">
                      <span>Companion space</span>
                      <span className="bg-indigo-950 px-1 rounded text-neutral-300">Playground</span>
                    </div>
                    <div className="flex justify-between text-neutral-450 text-[7px]">
                      <span>Volume Slider</span>
                      <span>[==============o--] 85%</span>
                    </div>
                    <div className="flex justify-between text-neutral-450 text-[7px]">
                      <span>Drive Level</span>
                      <span>[========o---------] 3.5x</span>
                    </div>
                  </div>
                  <div className="bg-neutral-900 text-center py-1 rounded text-[7px] border border-neutral-800 text-neutral-400 font-bold">
                    [Live Status: Signal Flow Locked & Pristine 0.00dB]
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "modules",
      title: "Interactive Components",
      keywords: "chat playground presets scripts workspace user tabs slider parameters",
      content: (
        <div className="space-y-4 text-[11px] text-neutral-400 leading-relaxed">
          <p>
            The studio contains 6 distinct interactive panel tabs designed to aid you during development and test iterations:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-neutral-900/40 border border-neutral-850 p-3 rounded-xl space-y-1.5">
              <h5 className="font-bold text-white flex items-center gap-1 font-sans text-xs">
                <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                1. AI Specialist Chat
              </h5>
              <p className="text-[10px] text-neutral-500 leading-normal">
                An expert audio engineer chatbot configured to draft new filters or distortion equations in real time. Simply type a description and look at it compiling instantly.
              </p>
            </div>

            <div className="bg-neutral-900/40 border border-neutral-850 p-3 rounded-xl space-y-1.5">
              <h5 className="font-bold text-white flex items-center gap-1 font-sans text-xs">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                2. Real-Time Playground
              </h5>
              <p className="text-[10px] text-neutral-500 leading-normal">
                Includes tactile virtual slider cards linked directly to your DSP parameter bounds. Grab, drag, and watch how it alters waves, saturation, and feedback loops on-the-fly.
              </p>
            </div>

            <div className="bg-neutral-900/40 border border-neutral-850 p-3 rounded-xl space-y-1.5">
              <h5 className="font-bold text-white flex items-center gap-1 font-sans text-xs">
                <Bookmark className="w-3.5 h-3.5 text-orange-450" />
                3. Presets Deck (3,290+ Tones)
              </h5>
              <p className="text-[10px] text-neutral-550 leading-normal">
                Access 35 high-craft built-in factory defaults as well as our procedural sub-library containing 3260 unique, mathematically correct multi-genre sound spaces.
              </p>
            </div>

            <div className="bg-neutral-900/40 border border-neutral-850 p-3 rounded-xl space-y-1.5">
              <h5 className="font-bold text-white flex items-center gap-1 font-sans text-xs">
                <Code2 className="w-3.5 h-3.5 text-sky-400" />
                4. Script JS (Code Sandbox)
              </h5>
              <p className="text-[10px] text-neutral-550 leading-normal">
                Write raw JavaScript syntax inside a live interactive sandboxed compiler. Implements auto-validations and safe exception catching to prevent crashing.
              </p>
            </div>
          </div>

          {/* Custom wireframe graphic for editing sliders */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">Illustration: Adjusting Real-Time Sliders</span>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 select-none">
              <div className="flex-1 w-full space-y-2">
                <div className="bg-neutral-950 p-2 border border-neutral-850 rounded-lg flex items-center justify-between text-[10px]">
                  <span className="text-neutral-300 font-sans font-bold">Feedback Delay Gain</span>
                  <span className="font-mono text-orange-400 font-bold">75.0 %</span>
                </div>
                {/* slider rail */}
                <div className="relative w-full h-1.5 bg-neutral-950 rounded-full">
                  <div className="absolute left-0 top-0 h-full w-[75%] bg-orange-500 rounded-full" />
                  <div className="absolute left-[75%] top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full border-2 border-orange-500 shadow-md animate-pulse" />
                </div>
              </div>
              <div className="text-[9.5px] text-neutral-500 space-y-1 max-w-xs font-sans leading-relaxed">
                <div className="flex items-center gap-1 text-neutral-350 font-semibold">
                  <CheckCircle className="w-3 h-3 text-emerald-400" /> High Precision Interpolators
                </div>
                Moving this knob recalculates the delay lines' internal decaying feedback parameter variables <strong>44,100 times per second</strong> without snapping artifacts.
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "canvas",
      title: "Modular Block Router",
      keywords: "canvas router blocks modular lines input feedback connections nodes compiling flow",
      content: (
        <div className="space-y-4">
          <p className="text-[11px] text-neutral-400 leading-relaxed">
             The <strong>Block Router (Canvas)</strong> tab is an interactive modular signal flow designer. Here you can construct complex 
             effects units by chain-wiring specialized physical cards in series!
          </p>

          <div className="space-y-2 text-[11px] text-neutral-400 leading-relaxed">
            <p className="font-bold text-xs text-neutral-200">How the Compiler Organizes Blocks:</p>
            <p>
               When you hit the <strong>"Hot-Compile to Active Workspace"</strong> button, the visual configuration is compiled down into a monolith JavaScript block. 
               Each parameter, circular memory line, and state register is optimized automatically inside a sandboxed block-scope ({}) to secure performance variables 
               without variable naming conflicts!
            </p>
          </div>

          {/* Diagram of Modular Chain */}
          <div className="space-y-1.5">
            <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">Illustration: Visual Signal Routing Map</span>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between gap-3 text-[10px] font-mono select-none">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="bg-neutral-950 border border-neutral-800 px-2 py-1.5 rounded flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span>[Input Waves]</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                <div className="bg-orange-950/40 border border-orange-900 px-2 py-1.5 rounded flex items-center gap-1.5 text-orange-400 font-bold">
                  <Sliders className="w-3 h-3" />
                  <span>[Saturator]</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                <div className="bg-indigo-950/40 border border-indigo-900 px-2 py-1.5 rounded flex items-center gap-1.5 text-indigo-300 font-bold">
                  <Workflow className="w-3 h-3" />
                  <span>[Delay Line]</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                <div className="bg-neutral-950 border border-neutral-800 px-2 py-1.5 rounded flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>[Master Output]</span>
                </div>
              </div>
              <div className="pt-2 text-[9.5px] leading-relaxed text-neutral-500 border-t border-neutral-850 font-sans">
                <span className="font-bold text-white select-none">Pro Tip: </span> Toggle the <strong>power switch</strong> icon on any visual block card to disable its mathematical stage from the live pipeline temporarily!
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "qa",
      title: "Purity QA & Diagnostics",
      keywords: "qa diagnostics purity lab healthcheck blowup infinite error check math",
      content: (
        <div className="space-y-4 text-[11px] text-neutral-400 leading-relaxed">
          <p>
            The <strong>Purity QA (Diagnostics Lab)</strong> tab is where real-time mathematics are rigorously verified, automated sweeps are tested, 
            and self-healing algorithms operate!
          </p>

          <div className="space-y-3">
            <div className="flex gap-2 p-3 bg-rose-955/35 border border-rose-950 rounded-xl">
              <Bug className="w-4 h-4 text-rose-450 shrink-0 mt-0.5" />
              <div>
                <h5 className="font-bold text-rose-300 text-xs font-sans">Preventing Math Instabilities (Blowups)</h5>
                <p className="text-[10px] text-neutral-400 mt-0.5 leading-normal">
                  If filter resonance exceeds limit coefficients or delay feedback goes beyond 1.0, equations can double expontentially 
                  until values hit <strong>Infinity/NaN (Not a Number)</strong>. Our offline simulation suite automatically runs test impulse signals 
                  at mock extremes to catch these occurrences before they reach speaker outputs!
                </p>
              </div>
            </div>

            <div className="flex gap-2 p-3 bg-indigo-955/35 border border-indigo-950 rounded-xl">
              <HeartPulse className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h5 className="font-bold text-indigo-300 text-xs font-sans">Level 5 Autonomy (Self-Driving DSP Optimization)</h5>
                <p className="text-[10px] text-neutral-400 mt-0.5 leading-normal">
                  Stuck with a compiler block error or feedback buzz? Engage our <strong>Level 5 Autonomous Tuner</strong> or <strong>AST Self-Healing</strong> scripts which 
                  trace variables, identify bugs, and re-serialize corrected formulas into the compiler seamlessly.
                </p>
              </div>
            </div>
          </div>

          {/* Screenshot Emulator: Bullet results table */}
          <div className="space-y-1.5">
            <span className="text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">Screenshot: Preset Stress Testing HUD</span>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-3 space-y-2 select-none font-mono">
              <div className="flex items-center justify-between text-[9px] border-b border-neutral-850 pb-1.5">
                <span className="text-white font-bold">BULK PRESET INTEGRITY SUITE</span>
                <span className="text-emerald-400 font-bold bg-emerald-955/50 border border-emerald-900 px-1.5 py-0.5 rounded text-[8px]">✓ 100% SECURE MATCH</span>
              </div>
              <div className="text-[8px] space-y-1 text-neutral-500 leading-relaxed">
                <div className="flex justify-between">
                  <span>- [gen-dist-tube-150] Asym Vacuum Triode...</span>
                  <span className="text-emerald-400">[PRISTINE]</span>
                </div>
                <div className="flex justify-between">
                  <span>- [gen-delay-tap-310] Multitap Echo...</span>
                  <span className="text-emerald-400">[PRISTINE]</span>
                </div>
                <div className="flex justify-between">
                  <span>- [gen-verb-room-44] Pristine Cathedral...</span>
                  <span className="text-amber-400">[WARNING] (Swell detected but clamped)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "cheatsheet",
      title: "Audio Math Cheatsheet",
      keywords: "cheatsheet code snippet equations tanh sin delay filter formulas math",
      content: (
        <div className="space-y-4">
          <p className="text-[11px] text-neutral-400 leading-relaxed">
            Ready to design your own custom modules? Copy/paste these pre-verified high-craft mathematical formulas directly inside our Script JS code sandbox:
          </p>

          <div className="space-y-3 font-mono">
            {/* Tube clip */}
            <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-850 space-y-1">
              <div className="flex items-center justify-between text-[10px] border-b border-neutral-900 pb-1">
                <span className="text-orange-400 font-bold">Dynamic Tube Clipper</span>
                <span className="text-neutral-550 text-[8px]">WAVESHAPER</span>
              </div>
              <pre className="text-[9.5px] text-neutral-350 leading-relaxed overflow-x-auto whitespace-pre">
{`let drive = params.drive || 3.0;
let bias = params.bias || 0.15;
let outputSample = Math.tanh((inputSample + bias) * drive);
return outputSample * 0.85;`}
              </pre>
            </div>

            {/* Echo Tap */}
            <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-850 space-y-1">
              <div className="flex items-center justify-between text-[10px] border-b border-neutral-900 pb-1">
                <span className="text-indigo-400 font-bold">Stable Tap Echo Delay</span>
                <span className="text-neutral-550 text-[8px]">RECURSIVE MEMORY</span>
              </div>
              <pre className="text-[9.5px] text-neutral-350 leading-relaxed overflow-x-auto whitespace-pre">
{`if (!state.delayBuffer) {
  state.delayBuffer = new Float32Array(44100); // 1-sec max
  state.ptr = 0;
}
let delaySamples = Math.floor(0.25 * 44100); // 250ms delay
let readHead = state.ptr - delaySamples;
if (readHead < 0) readHead += state.delayBuffer.length;

let delaySample = state.delayBuffer[readHead] || 0.0;
state.delayBuffer[state.ptr] = Math.tanh(inputSample + delaySample * 0.45);
state.ptr = (state.ptr + 1) % state.delayBuffer.length;

return inputSample * 0.65 + delaySample * 0.35;`}
              </pre>
            </div>

            {/* Simple LFO */}
            <div className="bg-neutral-950 p-2.5 rounded-lg border border-neutral-850 space-y-1">
              <div className="flex items-center justify-between text-[10px] border-b border-neutral-900 pb-1">
                <span className="text-sky-400 font-bold">Tremolo Volume LFO</span>
                <span className="text-neutral-550 text-[8px]">MODULATOR</span>
              </div>
              <pre className="text-[9.5px] text-neutral-350 leading-relaxed overflow-x-auto whitespace-pre">
{`if (!state.lfoPhase) state.lfoPhase = 0.0;
let rateHz = params.lfoRate || 4.5;
state.lfoPhase += (2.0 * Math.PI * rateHz) / 44100.0;
if (state.lfoPhase > 2 * Math.PI) state.lfoPhase -= 2 * Math.PI;

let modValue = 1.0 - ((Math.sin(state.lfoPhase) + 1.0) * 0.5 * 0.5);
return inputSample * modValue;`}
              </pre>
            </div>
          </div>
        </div>
      )
    }
  ];

  const filteredSections = sections.filter(sec => {
    if (!searchTerm) return true;
    return sec.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
           sec.keywords.toLowerCase().includes(searchTerm.toLowerCase());
  });

  return (
    <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div 
        className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-fade-in"
        id="help-manual-panel"
      >
        {/* Manual Header */}
        <div className="px-6 py-4 border-b border-neutral-850 bg-neutral-950 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-600">
              <HelpCircle className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <h3 className="font-display font-black text-sm text-white uppercase tracking-tight">ORANGEJUCE User Companion</h3>
              <p className="text-[10px] text-neutral-500 uppercase font-mono tracking-widest mt-0.5">Physical Sandbox & Signal Flow Manual</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 text-neutral-400 hover:text-white text-[10px] font-bold py-1.5 flex items-center gap-1.5 transition-all select-none cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close Manual</span>
          </button>
        </div>

        {/* Search Bar Segment */}
        <div className="px-6 py-3 border-b border-neutral-850 bg-neutral-900/10 flex items-center gap-3">
          <Search className="w-4 h-4 text-neutral-505" />
          <input 
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search keywords (e.g. 'delaySamples', 'stability', 'presets', 'router')"
            className="flex-grow bg-transparent border-none text-xs text-neutral-100 placeholder-neutral-550 focus:outline-none"
          />
          {searchTerm && (
            <button 
              type="button"
              onClick={() => setSearchTerm("")} 
              className="text-[9px] font-mono text-neutral-500 hover:text-neutral-300 font-bold"
            >
              CLEAR
            </button>
          )}
        </div>

        {/* Two Column Layout (Tabs Left, Content Right) */}
        <div className="flex-grow overflow-hidden flex flex-col md:flex-row h-[420px]">
          {/* Navigation panel */}
          <div className="w-full md:w-56 bg-neutral-900/25 border-r border-neutral-850 p-4 space-y-1.5 shrink-0 overflow-y-auto">
            <span className="text-[8.5px] font-mono font-bold text-neutral-550 uppercase tracking-widest block mb-2 px-1">Navigation Index</span>
            
            {filteredSections.map(sec => (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  setActiveTab(sec.id as any);
                  setSearchTerm("");
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-sans transition-all text-left border cursor-pointer ${
                  activeTab === sec.id
                    ? "bg-neutral-900 border-neutral-800 text-orange-400 font-bold"
                    : "bg-transparent border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {sec.id === "intro" && <BookOpen className="w-3.5 h-3.5" />}
                {sec.id === "modules" && <Sliders className="w-3.5 h-3.5" />}
                {sec.id === "canvas" && <Workflow className="w-3.5 h-3.5" />}
                {sec.id === "qa" && <Activity className="w-3.5 h-3.5" />}
                {sec.id === "cheatsheet" && <Code2 className="w-3.5 h-3.5" />}
                <span>{sec.title}</span>
              </button>
            ))}
          </div>

          {/* Core manual content view panel */}
          <div className="flex-1 overflow-y-auto p-6 bg-neutral-950/20 text-neutral-200">
            {sections.find(s => s.id === activeTab)?.content}
          </div>
        </div>

        {/* Footer info segment */}
        <div className="px-6 py-3 border-t border-neutral-850 bg-neutral-950 text-neutral-500 text-[10px] flex flex-col sm:flex-row justify-between items-center gap-1 font-sans">
          <div className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            <span>Interactive sandbox manual compiled dynamically against active components.</span>
          </div>
          <span className="font-mono text-[9px]">L5_MANUAL_COMPILER v2.4</span>
        </div>
      </div>
    </div>
  );
}
