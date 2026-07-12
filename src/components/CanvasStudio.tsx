import React, { useState } from "react";
import { CanvasNode, CanvasNodeType, AudioPlugin } from "../types";
import { compileCanvasToPlugin } from "../utils/canvasCompiler";
import { Sliders, Activity, Power, Cpu, CornerRightDown, Wand2, Info, ArrowRight } from "lucide-react";

interface CanvasStudioProps {
  currentPlugin: AudioPlugin;
  onCompileCanvas: (compiledPlugin: AudioPlugin) => void;
}

const DEFAULT_NODES: CanvasNode[] = [
  { id: "node-in", type: "input", title: "Input Waveform Source", active: true, settings: {} },
  { id: "node-sat", type: "saturator", title: "Tape Saturator Overdrive", active: true, settings: { drive: 3.5, bias: 0.0 } },
  { id: "node-fil", type: "ladder_filter", title: "4-Pole Transistor Filter", active: true, settings: { cutoff: 1800, resonance: 0.35 } },
  { id: "node-del", type: "comb_delay", title: "Recursive Tuboid Delay", active: false, settings: { time: 280, feedback: 0.45 } },
  { id: "node-cho", type: "chorus", title: "Analog Modulator Chorus", active: false, settings: { rate: 1.2, depth: 3.5 } },
  { id: "node-trem", type: "tremolo", title: "LFO Volume Tremolo", active: false, settings: { rate: 6.0, depth: 0.5 } },
  { id: "node-gain", type: "gain", title: "Output Stage Master Gain", active: true, settings: { volume: 0.85 } }
];

const NODE_EXPLANATIONS: Record<string, string> = {
  "node-in": "Processes raw audio inputs like synths, sine sweeps, or pink noise into the signal pipeline.",
  "node-sat": "Injects rich warm harmonics, soft-clipping overdrive, and tube saturation into the dry input.",
  "node-fil": "Sweeps frequencies using an emulation of classic analog 4-pole transistor filter designs.",
  "node-del": "Echoes current sounds back into the input using comb feedback lines for spatial echo and delay.",
  "node-cho": "Generates wide stereo phase animations by subtle modulations of multiple low frequency delay units.",
  "node-trem": "Rhythmically gates or pulses the amplitude levels with a customizable sine-wave LFO.",
  "node-gain": "Attenuates or boosts the final consolidated wet mix to secure stable decibels."
};

export default function CanvasStudio({ currentPlugin, onCompileCanvas }: CanvasStudioProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>(DEFAULT_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("node-sat");
  const [customName, setCustomName] = useState("Canvas Synthesized FX");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const toggleNodeActive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Do not toggle input or output stage
    if (id === "node-in" || id === "node-gain") return;

    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, active: !n.active } : n))
    );
  };

  const updateSetting = (nodeId: string, key: string, val: number) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          settings: {
            ...n.settings,
            [key]: val
          }
        };
      })
    );
  };

  const handleTriggerCompile = () => {
    const activeComp = compileCanvasToPlugin(
      customName || "Canvas Modular Plugin",
      currentPlugin.category,
      "Skeuomorphic DSP designCompiled smoothly via visual signal flow graph.",
      nodes
    );
    onCompileCanvas(activeComp);
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="bg-neutral-950 border border-neutral-800/85 rounded-2xl p-6 space-y-6">
      
      {/* Header section of Studio */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-neutral-800/80">
        <div>
          <div className="flex items-center gap-1.5 text-indigo-405 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span>Visual Code Pipeline [canvas_to_code]</span>
          </div>
          <h3 className="font-display font-semibold text-sm text-white mt-1">Modular DSP Signal Flow Creator</h3>
          <p className="text-[11px] text-neutral-500 font-sans mt-0.5 leading-normal">
            Arrange processing modules sequentially, adjust hardware thresholds, and auto-transpile to safe C++ & JavaScript structures.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Plugin design name"
            className="bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs font-semibold text-neutral-200 focus:outline-none focus:border-indigo-650 tracking-tight"
          />
          <button
            onClick={handleTriggerCompile}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10 active:scale-98"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Hot-Compile to Active Workspace</span>
          </button>
        </div>
      </div>

      {/* Main Signal Layout Canvas Map */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold font-mono text-neutral-550 uppercase tracking-widest block font-sans">Core Signal Flow Pipeline</label>
        
        {/* Dynamic Telemetry Probe Inspector Bar */}
        <div className="bg-neutral-900 border border-neutral-850 rounded-xl px-4 py-2.5 flex items-center justify-between transition-all">
          <div className="flex items-center gap-2 text-[11px] min-w-0 pr-4">
            {hoveredNodeId ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <Info className="w-3.5 h-3.5 text-indigo-400 animate-pulse shrink-0" />
                <span className="font-mono text-[9px] text-neutral-500 tracking-wider font-bold shrink-0">PROBING:</span>
                <span className="font-semibold text-neutral-200 truncate font-sans">
                  {NODE_EXPLANATIONS[hoveredNodeId]}
                </span>
              </div>
            ) : selectedNodeId ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="font-mono text-[9px] text-neutral-500 tracking-wider font-bold shrink-0">ACTIVE MODULE:</span>
                <span className="font-semibold text-neutral-300 truncate font-sans">
                  {NODE_EXPLANATIONS[selectedNodeId]}
                </span>
              </div>
            ) : (
              <span className="text-neutral-500 font-sans">Hover your cursor over any processing stage block to inspect explanations live.</span>
            )}
          </div>
          <span className="text-[8.5px] font-mono font-bold text-indigo-455 tracking-widest shrink-0 uppercase hidden sm:inline select-none">
            {hoveredNodeId ? "Probe Locked" : "Probe Standby"}
          </span>
        </div>

        <div className="flex flex-col md:flex-row gap-4 items-stretch bg-neutral-900/15 border border-neutral-850 rounded-2xl p-6 overflow-x-auto scrollbar-thin select-none">
          {nodes.map((node, index) => {
            const isSelected = selectedNodeId === node.id;
            const canToggle = node.type !== "input" && node.type !== "gain";

            return (
              <React.Fragment key={node.id}>
                <div
                  onClick={() => setSelectedNodeId(node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className={`group relative p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer flex-shrink-0 min-w-[210px] max-w-[240px] w-full md:w-auto flex flex-col justify-between hover:-translate-y-1 hover:border-indigo-500/50 hover:shadow-lg ${
                    isSelected
                      ? "bg-neutral-900 border-indigo-500 shadow-lg shadow-indigo-950/40 text-white"
                      : node.active
                      ? "bg-neutral-900/60 border-neutral-800 hover:border-neutral-750 text-neutral-300"
                      : "bg-neutral-950/80 border-neutral-900 opacity-40 hover:opacity-75 text-neutral-600"
                  }`}
                >
                  <div>
                    {/* Top line banner of node */}
                    <div className="flex items-center justify-between gap-2 border-b border-neutral-800/40 pb-2 mb-2">
                      <span className="text-[8.5px] font-mono text-neutral-500 font-bold uppercase tracking-widest">
                        Stage {index + 1}
                      </span>
                      {canToggle && (
                        <button
                          onClick={(e) => toggleNodeActive(node.id, e)}
                          className={`p-1 rounded transition-all cursor-pointer ${
                            node.active
                              ? "bg-indigo-950 text-indigo-400 hover:bg-indigo-900/80"
                              : "bg-neutral-850 text-neutral-500 hover:bg-neutral-800"
                          }`}
                          title={node.active ? "Bypass Stage" : "Activate Stage"}
                        >
                          <Power className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Word-wrapping-friendly title display */}
                    <h4 className="font-display font-semibold text-[11px] leading-relaxed text-neutral-105 break-words pr-1">
                      {node.title}
                    </h4>

                    {/* Direct description in-card layout */}
                    <p className={`text-[9.5px] leading-relaxed mt-2 font-sans break-words pb-1 ${isSelected ? "text-neutral-300" : "text-neutral-500"}`}>
                      {NODE_EXPLANATIONS[node.id]}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-1.5 mt-3.5 pt-2.5 border-t border-neutral-850/30">
                    <span className={`w-1.5 h-1.5 rounded-full ${node.active ? "bg-emerald-500 animate-pulse" : "bg-neutral-700"}`} />
                    <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-wider font-semibold">
                      {node.type}
                    </span>
                  </div>
                </div>

                {index < nodes.length - 1 && (
                  <div className="flex md:flex justify-center items-center text-neutral-700 shrink-0 select-none py-1.5 md:py-0">
                    <ArrowRight className="w-4 h-4 animate-pulse text-indigo-900/60 hidden md:block" />
                    <CornerRightDown className="w-4 h-4 animate-pulse text-indigo-900/60 block md:hidden" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Editing sliders of Selected Node */}
      {selectedNode && (
        <div className="bg-neutral-900/20 border border-neutral-850 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-850 pb-2.5">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <div>
                <h4 className="text-xs font-semibold text-white">{selectedNode.title} Parameters</h4>
                <p className="text-[9px] text-neutral-500 font-mono uppercase mt-0.5">Hardware Settings scope</p>
              </div>
            </div>
            <span className={`text-[9px] font-mono px-2 py-0.5 border rounded-full ${
              selectedNode.active
                ? "bg-emerald-950/40 text-emerald-400 border-emerald-900/50"
                : "bg-neutral-900 text-neutral-500 border-neutral-800"
            }`}>
              {selectedNode.active ? "Live & Processing" : "Offline / Bypassed"}
            </span>
          </div>

          {/* Quick explanation segment of selected block */}
          <div className="bg-neutral-900/40 border border-neutral-850/60 rounded-xl p-3 text-[11px] text-neutral-400 font-sans leading-relaxed">
            <span className="font-bold text-neutral-300">Explanation: </span>
            {NODE_EXPLANATIONS[selectedNode.id] || "No description loaded."}
          </div>

          {/* Render parameters of the selected node category */}
          {Object.keys(selectedNode.settings).length === 0 ? (
            <div className="text-center py-4 text-xs text-neutral-550 italic flex items-center justify-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              <span>No user-configurable param slots for this node.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {selectedNode.type === "saturator" && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Saturation Drive</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.drive?.toFixed(1) ?? "3.5"}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="15.0"
                      step="0.1"
                      value={selectedNode.settings.drive ?? 3.5}
                      onChange={(e) => updateSetting(selectedNode.id, "drive", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Tube DC Bias Offset</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.bias?.toFixed(2) ?? "0.00"}V
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-0.5"
                      max="0.5"
                      step="0.01"
                      value={selectedNode.settings.bias ?? 0.0}
                      onChange={(e) => updateSetting(selectedNode.id, "bias", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === "ladder_filter" && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Cutoff Frequency</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.cutoff ?? "1800"}Hz
                      </span>
                    </div>
                    <input
                      type="range"
                      min="80"
                      max="12000"
                      step="10"
                      value={selectedNode.settings.cutoff ?? 1800}
                      onChange={(e) => updateSetting(selectedNode.id, "cutoff", parseInt(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Resonant Q Factor</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {((selectedNode.settings.resonance ?? 0.35) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="0.95"
                      step="0.01"
                      value={selectedNode.settings.resonance ?? 0.35}
                      onChange={(e) => updateSetting(selectedNode.id, "resonance", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === "comb_delay" && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Delay Interval (Time)</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.time ?? "280"}ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="1000"
                      step="5"
                      value={selectedNode.settings.time ?? 280}
                      onChange={(e) => updateSetting(selectedNode.id, "time", parseInt(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Feedback Coefficient</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {((selectedNode.settings.feedback ?? 0.45) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="0.95"
                      step="0.01"
                      value={selectedNode.settings.feedback ?? 0.45}
                      onChange={(e) => updateSetting(selectedNode.id, "feedback", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === "chorus" && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Chorus Modulating LFO Rate</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.rate?.toFixed(2) ?? "1.20"}Hz
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="5.0"
                      step="0.05"
                      value={selectedNode.settings.rate ?? 1.2}
                      onChange={(e) => updateSetting(selectedNode.id, "rate", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Chorus Delay Deviation (Depth)</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.depth?.toFixed(1) ?? "3.5"}ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="15.0"
                      step="0.1"
                      value={selectedNode.settings.depth ?? 3.5}
                      onChange={(e) => updateSetting(selectedNode.id, "depth", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === "tremolo" && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Tremolo LFO Rate</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {selectedNode.settings.rate?.toFixed(1) ?? "6.0"}Hz
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="15.0"
                      step="0.1"
                      value={selectedNode.settings.rate ?? 6.0}
                      onChange={(e) => updateSetting(selectedNode.id, "rate", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-300">Tremolo Vol Modulation Depth</span>
                      <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                        {((selectedNode.settings.depth ?? 0.5) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.01"
                      value={selectedNode.settings.depth ?? 0.5}
                      onChange={(e) => updateSetting(selectedNode.id, "depth", parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                    />
                  </div>
                </>
              )}

              {selectedNode.type === "gain" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-neutral-300">Output Signal Level (Gain)</span>
                    <span className="font-mono bg-neutral-900 text-neutral-400 px-2 py-0.5 rounded text-[10px]">
                      {selectedNode.settings.volume?.toFixed(2) ?? "0.85"}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.5"
                    step="0.01"
                    value={selectedNode.settings.volume ?? 0.85}
                    onChange={(e) => updateSetting(selectedNode.id, "volume", parseFloat(e.target.value))}
                    className="w-full h-1 bg-neutral-800 appearance-none rounded-lg cursor-pointer accent-indigo-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
