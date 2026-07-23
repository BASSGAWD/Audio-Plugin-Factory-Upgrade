import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  Sliders, 
  Trash2, 
  Plus, 
  Check, 
  Edit, 
  Grid, 
  Settings, 
  MousePointer, 
  ToggleLeft, 
  CircleDot, 
  Keyboard, 
  RotateCcw,
  Sparkles,
  Info,
  GripVertical,
  HelpCircle,
  Eye,
  Wrench,
  Palette,
  ChevronUp,
  ChevronDown,
  Volume2,
  Tv,
  ArrowRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Move,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Copy,
  Lock,
  Unlock,
  Layers,
  Wand2
} from "lucide-react";
import { AudioPlugin, PluginParameter } from "../types";
import { computeFilterCurve, xPixelToHz, computeWaveformPath, waveShapeLabel } from "../utils/controlVisuals";

interface UIDesignerProps {
  plugin: AudioPlugin;
  onChange: (updatedPlugin: AudioPlugin) => void;
  triggerToast: (msg: string) => void;
}

/**
 * Size-aware fallback layout for params that carry no explicit x/y: a shelf
 * flow that honors each control's real w/h (a 240x240 cabinet takes a
 * cabinet-sized slot, not a knob-sized one), wrapping within the board width.
 * The old fixed 210x150 grid overlapped and overflowed the board the moment a
 * family-mandatory big component (amp head, cabinet, mic, pad grid) was in
 * the parameter list. Returns the positions plus the content bounds so the
 * artboard can grow to CONTAIN the layout instead of clipping it.
 */
function computeFallbackLayout(
  parameters: PluginParameter[],
  boardWidth: number
): { positions: Record<string, { x: number; y: number }>; contentW: number; contentH: number } {
  const MARGIN = 30;
  const GAP = 20;
  const positions: Record<string, { x: number; y: number }> = {};
  let cursorX = MARGIN;
  let cursorY = MARGIN;
  let rowH = 0;
  let contentW = 0;
  let contentH = 0;

  for (const p of parameters) {
    const w = p.w ?? 180;
    const h = p.h ?? 120;
    if (cursorX > MARGIN && cursorX + w > boardWidth - MARGIN) {
      cursorX = MARGIN;
      cursorY += rowH + GAP;
      rowH = 0;
    }
    // Explicitly-placed params keep their spot; they still occupy bounds.
    const x = p.x ?? cursorX;
    const y = p.y ?? cursorY;
    positions[p.id] = { x, y };
    if (p.x === undefined || p.y === undefined) {
      cursorX = x + w + GAP;
      rowH = Math.max(rowH, h);
    }
    contentW = Math.max(contentW, x + w);
    contentH = Math.max(contentH, y + h);
  }
  return { positions, contentW: contentW + MARGIN, contentH: contentH + MARGIN };
}

// 1. --- Custom Immersive Rotary Knob Component ---
interface KnobProps {
  param: PluginParameter;
  onChange: (value: number) => void;
  onDblClick: () => void;
  themeStyle: string;
}

function CustomKnob({ param, onChange, onDblClick, themeStyle }: KnobProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(0);

  const range = param.max - param.min;
  const normalized = (param.value - param.min) / (range || 1);
  const angle = -135 + normalized * 270;

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = param.value;
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaY = startYRef.current - e.clientY;
      const sensitivity = 0.005;
      
      let nextUnclamped = startValRef.current + (deltaY * range * sensitivity);
      let rounded = Math.max(param.min, Math.min(param.max, nextUnclamped));
      
      if (range > 1) {
        rounded = Math.round(rounded * 100) / 100;
      } else {
        rounded = Math.round(rounded * 1000) / 1000;
      }
      onChange(rounded);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, param.min, param.max, range, onChange]);

  const getKnobClasses = () => {
    switch (themeStyle) {
      case "vintage-analog":
        return {
          ring: isDragging ? "border-[#5c4a37] ring-2 ring-[#a88258]/30 shadow-[#a88258]/10 scale-102" : "border-[#8a7b68] hover:border-[#5c4a37]",
          body: "bg-gradient-to-b from-[#e8e4d8] to-[#cac2ae]",
          core: "bg-[#4a3f35]",
          needle: "bg-amber-800",
          needleShadow: "0 0 6px rgba(180, 83, 9, 0.6)"
        };
      case "cyberpunk-neon":
        return {
          ring: isDragging ? "border-[#00ffff] ring-2 ring-[#ea00d9]/50 shadow-[#00ffff]/20 scale-102" : "border-[#711c91] hover:border-[#ea00d9]",
          body: "bg-gradient-to-b from-black to-[#0d0214]",
          core: "bg-[#ea00d9]/10 border border-[#ea00d9]/50",
          needle: "bg-[#00ffff]",
          needleShadow: "0 0 8px rgba(0, 255, 255, 0.9)"
        };
      case "modular-synth":
        return {
          ring: isDragging ? "border-orange-500 ring-2 ring-orange-950/80 shadow-orange-500/10 scale-102" : "border-neutral-700 hover:border-neutral-500",
          body: "bg-gradient-to-b from-neutral-800 to-neutral-900",
          core: "bg-neutral-950 border border-neutral-850",
          needle: "bg-orange-500",
          needleShadow: "0 0 8px rgba(249, 115, 22, 0.8)"
        };
      default: // aero-slate
        return {
          ring: isDragging ? "border-indigo-400 ring-2 ring-indigo-950/80 shadow-indigo-500/10 scale-102" : "border-neutral-700 hover:border-neutral-500",
          body: "bg-gradient-to-b from-neutral-800 to-neutral-900",
          core: "bg-neutral-950 border border-neutral-800",
          needle: "bg-indigo-400",
          needleShadow: "0 0 8px rgba(129, 140, 248, 0.8)"
        };
    }
  };

  const style = getKnobClasses();

  return (
    <div className="flex flex-col items-center justify-center space-y-1 select-none group">
      <div 
        onMouseDown={handleMouseDown}
        onDoubleClick={onDblClick}
        className={`relative w-12 h-12 rounded-full border-2 cursor-ns-resize shadow-md flex items-center justify-center transition-all ${style.ring} ${style.body}`}
      >
        <div 
          className={`absolute w-0.5 h-4 rounded-full origin-bottom ${style.needle}`}
          style={{ 
            transform: `rotate(${angle}deg)`, 
            top: "6px",
            boxShadow: style.needleShadow
          }}
        />
        <div className={`w-6 h-6 rounded-full flex items-center justify-center pointer-events-none ${style.core}`}>
          <div className="w-1 h-1 rounded-full bg-neutral-600/40" />
        </div>

        {isDragging && (
          <div className="absolute -top-8 z-[100] px-1.5 py-0.5 bg-neutral-950 border border-neutral-800 rounded text-[8px] font-mono text-orange-400 font-bold">
            {param.value.toFixed(2)}{param.unit}
          </div>
        )}
      </div>
      <span className="text-[7px] text-neutral-500 font-mono scale-90 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        Drag vertical
      </span>
    </div>
  );
}

// 2. --- Retro Metal Toggle Switch Component ---
interface ToggleProps {
  param: PluginParameter;
  onChange: (value: number) => void;
  themeStyle: string;
}

function RetroToggle({ param, onChange, themeStyle }: ToggleProps) {
  const midPoint = param.min + (param.max - param.min) / 2;
  const isOn = param.value > midPoint;

  const handleToggle = () => {
    onChange(isOn ? param.min : param.max);
  };

  const isVintage = themeStyle === "vintage-analog";
  const isCyber = themeStyle === "cyberpunk-neon";

  return (
    <div className="flex flex-col items-center justify-center select-none">
      <div 
        onClick={handleToggle}
        className={`w-9 h-12 border border-2 rounded-lg flex flex-col justify-between items-center p-1.5 cursor-pointer shadow-inner transition duration-200 ${
          isVintage 
            ? "bg-[#efebe1] border-[#bcb6a3] hover:border-[#8e8774]" 
            : isCyber 
            ? "bg-black border-[#711c91] hover:border-[#ea00d9]" 
            : "bg-neutral-950 border-neutral-800 hover:border-neutral-700"
        }`}
      >
        <span className={`text-[7px] font-mono font-bold ${
          isOn 
            ? isCyber ? "text-[#00ffff]" : isVintage ? "text-amber-800" : "text-indigo-400" 
            : "text-neutral-700"
        }`}>
          ON
        </span>
        
        <div className={`w-4 h-3.5 rounded border shadow-md transform transition-all duration-150 ${
          isOn ? "-translate-y-0.5" : "translate-y-0.5"
        } ${
          isVintage 
            ? "bg-gradient-to-b from-amber-100 to-amber-700 border-[#9e8f7a]" 
            : isCyber 
            ? "bg-gradient-to-b from-[#ea00d9] to-purple-950 border-[#ea00d9]/40" 
            : "bg-gradient-to-b from-neutral-200 to-neutral-400 border-white/10"
        }`} />

        <span className={`text-[7px] font-mono font-bold ${
          !isOn 
            ? isCyber ? "text-rose-500" : "text-rose-600" 
            : "text-neutral-700"
        }`}>
          OFF
        </span>
      </div>
    </div>
  );
}

// 3. --- Momentary Push / Gate Trigger Button ---
interface TriggerBtnProps {
  param: PluginParameter;
  onChange: (value: number) => void;
  themeStyle: string;
}

function TriggerButton({ param, onChange, themeStyle }: TriggerBtnProps) {
  const [isActive, setIsActive] = useState(false);

  const startTrigger = () => {
    setIsActive(true);
    onChange(param.max);
  };

  const endTrigger = () => {
    setIsActive(false);
    onChange(param.min);
  };

  const isVintage = themeStyle === "vintage-analog";
  const isCyber = themeStyle === "cyberpunk-neon";

  return (
    <div className="flex flex-col items-center justify-center select-none">
      <button
        onMouseDown={startTrigger}
        onMouseUp={endTrigger}
        onMouseLeave={endTrigger}
        onTouchStart={startTrigger}
        onTouchEnd={endTrigger}
        className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-mono font-bold text-[8px] active:scale-95 transition-all outline-none ${
          isActive 
            ? isCyber 
              ? "bg-black border-[#00ffff] text-[#00ffff] shadow-lg shadow-[#00ffff]/20" 
              : isVintage 
              ? "bg-[#6c5943] border-[#a28a6e] text-amber-100 shadow-md"
              : "bg-emerald-950 border-emerald-400 text-emerald-300 shadow-lg" 
            : isCyber 
            ? "bg-black border-[#711c91] text-[#711c91] hover:border-[#ea00d9] hover:text-[#ea00d9]" 
            : isVintage 
            ? "bg-[#efebe1] border-[#bcb6a3] text-neutral-700"
            : "bg-neutral-900 border-neutral-750 text-neutral-400 hover:border-neutral-650"
        }`}
      >
        {isActive ? "LIVE" : "PUSH"}
      </button>
    </div>
  );
}

// 4. --- Advanced Audio Range Presets ---
const AUDIO_RANGE_PRESETS = [
  { name: "🎚️ Dry/Wet Mix", min: 0, max: 1, def: 0.5, unit: "ratio", desc: "Acoustic blending weight from dry original to processed wet signals." },
  { name: "🎛️ Filter Cutoff", min: 20, max: 20000, def: 1000, unit: "Hz", desc: "Frequency threshold. Low frequencies are bassy; high frequencies are brilliant treble." },
  { name: "🔊 Signal Gain", min: -40, max: 6, def: 0, unit: "dB", desc: "Output amplitude gain adjustment, where 0dB is standard full volume." },
  { name: "🌀 Feedback Ratio", min: 0, max: 0.95, def: 0.3, unit: "ratio", desc: "Feeds sound back to create repetition. Keep below 1.0 to prevent explosive noise." },
  { name: "⏱️ Echo Delay", min: 10, max: 1500, def: 250, unit: "ms", desc: "Echo latency. Higher delay times produce slower repetitions." },
  { name: "🌊 LFO Rate", min: 0.1, max: 15, def: 1, unit: "Hz", desc: "Low Frequency Oscillator ticking cycles per second. Drives cyclical sweeps." },
  { name: "⚡ Waveshape Saturation", min: 1, max: 80, def: 10, unit: "x", desc: "Distortion multiplier to crunch or fuzz sample waves." },
];

const GLOSSARY_TERMS: Record<string, { term: string; explanation: string; example: string }> = {
  hz: {
    term: "Hertz (Hz)",
    explanation: "Vibration rate of sound. Human hearing ranges from 20Hz (rumbling bass) to 20,000Hz (whistling shimmer). Boost high Hz for sparkle, or lower it for a dark, warm tone.",
    example: "params.cutoff = Math.max(20, Math.min(20000, params.cutoff));"
  },
  db: {
    term: "Decibels (dB)",
    explanation: "Logarithmic scale for audio volume. 0dB is standard original amplitude. Every 6dB drop cuts volume in half. -40dB or lower is nearly silent.",
    example: "const linearGain = Math.pow(10, params.volume / 20);"
  },
  feedback: {
    term: "Feedback Decay",
    explanation: "Re-injecting the output signal back into the processor. In delays, it controls echo repetition counts. In filters, it increases sharp whistling resonance.",
    example: "this.historyBuffer[pos] = input + (lastOutput * params.feedback);"
  },
  lfo: {
    term: "LFO Modulation",
    explanation: "A slow rhythm clock (usually 0.1 to 10 cycles per second) used to swing other controls back and forth automatically for shimmering chorus or auto-wah effects.",
    example: "this.lfoPhase += (2 * Math.PI * params.lfo_rate) / sampleRate;"
  },
  q: {
    term: "Filter Quality (Q)",
    explanation: "Sharpness of a filter cut. Low Q is soft and natural. High Q creates a squealing analog synthesizer resonance peak at the cutoff point.",
    example: "const qFactor = Math.max(0.5, params.resonance_q);"
  }
};

// --- Professional Multi-Widget Faceplate & DSP Templates ---
const PRO_STUDIO_TEMPLATES: Array<{
  name: string;
  theme: "aero-slate" | "vintage-analog" | "cyberpunk-neon" | "modular-synth" | "classic-ivory" | "custom-skin";
  description: string;
  customSkin?: any;
  parameters: PluginParameter[];
  dspFunction: string;
}> = [
  {
    name: "📻 Vintage Tube Compressor",
    theme: "vintage-analog" as const,
    description: "Authentic retro faceplate modeled with double gain-reduction VU needle meters, threshold controls, and classic warm saturate tube circuit simulation.",
    parameters: [
      { id: "input_gain", name: "Preamp Input Gain", min: 0, max: 40, defaultValue: 15, value: 15, unit: "dB", controlType: "knob", x: 40, y: 130, w: 110, h: 100 },
      { id: "threshold", name: "Compressor Threshold", min: -40, max: 0, defaultValue: -16, value: -16, unit: "dB", controlType: "knob", x: 170, y: 130, w: 110, h: 100 },
      { id: "ratio", name: "Squeeze Ratio", min: 1, max: 20, defaultValue: 4, value: 4, unit: ":1", controlType: "knob", x: 300, y: 130, w: 110, h: 100 },
      { id: "gain_reduction", name: "Gain Reduction VU", min: -24, max: 3, defaultValue: 0, value: 0, unit: "dB", controlType: "meter", x: 430, y: 70, w: 80, h: 180 },
      { id: "make_up", name: "Makeup Level", min: 0, max: 24, defaultValue: 6, value: 6, unit: "dB", controlType: "knob", x: 535, y: 130, w: 110, h: 100 },
      { id: "bypass", name: "Hard Tube Bypass", min: 0, max: 1, defaultValue: 0, value: 0, unit: "state", controlType: "toggle", x: 40, y: 260, w: 110, h: 80 },
    ],
    dspFunction: `// --- VINTAGE TUBE COMPRESSOR AUDIO ENGINE ---
if (!state.init_comp) {
  state.envelope = 0.0;
  state.gr_db = 0.0;
  state.init_comp = true;
}

let inGainDb = params.input_gain !== undefined ? params.input_gain : 15.0;
let threshDb = params.threshold !== undefined ? params.threshold : -16.0;
let ratio = params.ratio !== undefined ? params.ratio : 4.0;
let makeUpDb = params.make_up !== undefined ? params.make_up : 6.0;
let bypass = params.bypass !== undefined ? params.bypass : 0.0;

if (bypass > 0.5) {
  return inputSample;
}

// 1. Preamp Input Boost and Saturation
let inLinear = Math.pow(10, inGainDb / 20);
let boosted = inputSample * inLinear;

// Soft asymmetrical tube clipping saturator
let x = boosted;
let saturated = x > 0 
  ? (x / (1.0 + x)) 
  : (x / (1.0 - x * 0.4));

// 2. Dynamic Envelope Detection (Attack = 10ms, Release = 100ms)
let rect = Math.abs(saturated);
let alpha_attack = Math.exp(-1.0 / (44100 * 0.01));
let alpha_release = Math.exp(-1.0 / (44100 * 0.1));

if (rect > state.envelope) {
  state.envelope = alpha_attack * state.envelope + (1.0 - alpha_attack) * rect;
} else {
  state.envelope = alpha_release * state.envelope + (1.0 - alpha_release) * rect;
}

// Convert detected amplitude to Decibels
let envDb = 20.0 * Math.log10(Math.max(1e-5, state.envelope));

// 3. Gain Calculation over Threshold
let gainDb = 0.0;
if (envDb > threshDb) {
  let excessDb = envDb - threshDb;
  let targetDb = threshDb + (excessDb / ratio);
  gainDb = targetDb - envDb; // Negative reduction amount
}

state.gr_db = gainDb; // store for metering
if (params.gain_reduction !== undefined) {
  params.gain_reduction = gainDb; // set real-time UI meter!
}

// 4. Apply make-up gain
let totalGainDb = gainDb + makeUpDb;
let linearGain = Math.pow(10, totalGainDb / 20);

return saturated * linearGain;`
  },
  {
    name: "🌌 Tape Echo & LFO Space Pedal",
    theme: "cyberpunk-neon" as const,
    description: "Modulated analog tape machine simulator. Combines a pitch-wobbling LFO chorused delay line with self-oscillating feedback and dynamic waveform visuals.",
    parameters: [
      { id: "delay_time", name: "Tape Head Delay", min: 20, max: 1000, defaultValue: 350, value: 350, unit: "ms", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
      { id: "feedback", name: "Feedback Decay", min: 0, max: 0.98, defaultValue: 0.45, value: 0.45, unit: "ratio", controlType: "knob", x: 180, y: 70, w: 120, h: 100 },
      { id: "mix", name: "Space Mix Weight", min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "ratio", controlType: "knob", x: 320, y: 70, w: 120, h: 100 },
      { id: "lfo_speed", name: "Wow & Flutter Rate", min: 0.1, max: 10, defaultValue: 2.5, value: 2.5, unit: "Hz", controlType: "knob", x: 40, y: 195, w: 120, h: 100 },
      { id: "lfo_depth", name: "Chorus Drift Depth", min: 0, max: 5, defaultValue: 1.5, value: 1.5, unit: "ms", controlType: "knob", x: 180, y: 195, w: 120, h: 100 },
      { id: "waveform", name: "Saturator Oscilloscope", min: 0, max: 0, defaultValue: 0, value: 0, unit: "", controlType: "waveform", x: 450, y: 70, w: 220, h: 120 },
      { id: "bypass", name: "Hard Bypass", min: 0, max: 1, defaultValue: 0, value: 0, unit: "state", controlType: "button", x: 320, y: 195, w: 120, h: 100 },
    ],
    dspFunction: `// --- MODULATED TAPE ECHO DELAY ENGINE ---
if (!state.init_delay) {
  state.buf = new Float32Array(96000); // 2 second buffer at 48k
  state.write_ptr = 0;
  state.lfo_phase = 0.0;
  state.init_delay = true;
}

let delayMs = params.delay_time !== undefined ? params.delay_time : 350.0;
let feedback = params.feedback !== undefined ? params.feedback : 0.45;
let mix = params.mix !== undefined ? params.mix : 0.5;
let lfoSpeed = params.lfo_speed !== undefined ? params.lfo_speed : 2.5;
let lfoDepth = params.lfo_depth !== undefined ? params.lfo_depth : 1.5;
let bypass = params.bypass !== undefined ? params.bypass : 0.0;

if (bypass > 0.5) {
  return inputSample;
}

// 1. Calculate LFO Tape Flutter Drift (sines modulation)
state.lfo_phase += (2.0 * Math.PI * lfoSpeed) / 44100.0;
if (state.lfo_phase > 2.0 * Math.PI) {
  state.lfo_phase -= 2.0 * Math.PI;
}
let flutter = Math.sin(state.lfo_phase) * lfoDepth;

// 2. Retrieve sample with dynamic tap pointer
let totalDelayMs = delayMs + flutter;
let delaySamples = (totalDelayMs * 44100.0) / 1000.0;

let readPtr = state.write_ptr - delaySamples;
if (readPtr < 0) {
  readPtr += 96000;
}

// Linear Interpolated Read
let baseIndex = Math.floor(readPtr);
let frac = readPtr - baseIndex;
let nextIndex = (baseIndex + 1) % 96000;

let delayedSample = state.buf[baseIndex] * (1.0 - frac) + state.buf[nextIndex] * frac;

// Analog High-pass tape roll-off filter
if (!state.last_out) state.last_out = 0;
delayedSample = 0.95 * delayedSample + 0.05 * (delayedSample - state.last_out);
state.last_out = delayedSample;

// Write new sample to feedback ring buffer
let tapeWarmSaturated = Math.tanh(inputSample + delayedSample * feedback);
state.buf[state.write_ptr] = tapeWarmSaturated;
state.write_ptr = (state.write_ptr + 1) % 96000;

// Mix dry/wet
return inputSample * (1.0 - mix) + delayedSample * mix;`
  },
  {
    name: "🎸 Marshall Plexi Tube Stack",
    theme: "modular-synth" as const,
    description: "Multi-stage British guitar tube preamp distortion head, cascading EQ tonestack, and SM57 microphone-on-cone speaker simulation.",
    parameters: [
      { id: "drive", name: "Plexi Tube Gain", min: 1, max: 20, defaultValue: 8, value: 8, unit: "x", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
      { id: "tone", name: "High Treble Presence", min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "%", controlType: "knob", x: 40, y: 195, w: 120, h: 100 },
      { id: "amp", name: "British Plexi Tube Amp", min: 0, max: 10, defaultValue: 5, value: 5, unit: "v", controlType: "amp", x: 180, y: 70, w: 340, h: 140 },
      { id: "cabinet", name: "Speaker Vintage Cabinet", min: 0, max: 10, defaultValue: 6, value: 6, unit: "v", controlType: "cab", x: 180, y: 220, w: 240, h: 220 },
      { id: "microphone", name: "SM57 Cone Placement", min: 0, max: 100, defaultValue: 30, value: 30, unit: "mm", controlType: "mic", x: 430, y: 220, w: 180, h: 180 },
    ],
    dspFunction: `// --- BRITISH TUBE GUITAR AMPLIFIER & SPEAKER ---
if (!state.init_amp) {
  state.last_low = 0.0;
  state.init_amp = true;
}

let drive = params.drive !== undefined ? params.drive : 8.0;
let tone = params.tone !== undefined ? params.tone : 0.5;
let micPos = params.microphone !== undefined ? params.microphone : 30.0;

// 1. Cascoded 12AX7 Valve Triode Saturation
let triodeInput = inputSample * drive;
let saturatedTriode = Math.tanh(triodeInput) + 0.12 * Math.pow(Math.abs(Math.tanh(triodeInput)), 2.5);

// 2. High-pass filter emulation (Presence Cut)
let hpAlpha = 0.85;
let brightStage = saturatedTriode - state.last_low;
state.last_low = saturatedTriode;

// Blend presence brightness
let postEq = saturatedTriode * (1.0 - tone) + brightStage * tone * 1.5;

// 3. SM57 Mic Positioning Acoustic Resonances (Cabinet Modeling)
// Higher mic distance / off-center trims highs and hollows mids
let distanceCoeff = micPos / 100.0;
let cabinetResonance = Math.sin(inputSample * 4.0) * 0.1 * distanceCoeff;

let speakerOutput = postEq * (1.0 - 0.4 * distanceCoeff) + cabinetResonance;
return speakerOutput * 0.5;`
  },
  {
    name: "🎤 Studio Ivory Vocal Preamp & EQ",
    theme: "classic-ivory" as const,
    description: "Premium vocal preamp strip complete with linear solid-state preamp input, 3-band parametric graphic EQ node, and custom fader channel controls.",
    parameters: [
      { id: "preamp_gain", name: "Preamp Pre-gain", min: 0, max: 30, defaultValue: 12, value: 12, unit: "dB", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
      { id: "low_cut", name: "Low-end Rumble Cut", min: 20, max: 300, defaultValue: 80, value: 80, unit: "Hz", controlType: "knob", x: 40, y: 195, w: 120, h: 100 },
      { id: "eq_curve", name: "Studio Parametric EQ", min: 0, max: 10, defaultValue: 5, value: 5, unit: "dB", controlType: "eq", x: 180, y: 70, w: 285, h: 140 },
      { id: "treble_boost", name: "Air Treble Presence", min: -12, max: 12, defaultValue: 3, value: 3, unit: "dB", controlType: "knob", x: 180, y: 220, w: 120, h: 100 },
      { id: "vocal_warmth", name: "Tube Harmonic Warmth", min: 0, max: 10, defaultValue: 4, value: 4, unit: "dB", controlType: "knob", x: 320, y: 220, w: 120, h: 100 },
      { id: "vocal_fader", name: "Studio Volume Fader", min: -60, max: 6, defaultValue: 0, value: 0, unit: "dB", controlType: "slider", x: 480, y: 70, w: 80, h: 250 },
      { id: "output_vu", name: "Master Output Level", min: -60, max: 6, defaultValue: -12, value: -12, unit: "dB", controlType: "meter", x: 580, y: 70, w: 80, h: 180 },
    ],
    dspFunction: `// --- STUDIO VOCAL PREAMP & EQ STRIP ---
if (!state.init_vocal_strip) {
  state.x1 = 0; state.x2 = 0; state.y1 = 0; state.y2 = 0; // EQ Biquad memory
  state.init_vocal_strip = true;
}

let preGainDb = params.preamp_gain !== undefined ? params.preamp_gain : 12.0;
let lowCutHz = params.low_cut !== undefined ? params.low_cut : 80.0;
let airBoostDb = params.treble_boost !== undefined ? params.treble_boost : 3.0;
let warmth = params.vocal_warmth !== undefined ? params.vocal_warmth : 4.0;
let faderDb = params.vocal_fader !== undefined ? params.vocal_fader : 0.0;

// 1. Amplification stage
let ampLinear = Math.pow(10, preGainDb / 20);
let rawAmplified = inputSample * ampLinear;

// Dynamic saturation based on warmth knob
let warmthFactor = warmth / 10.0;
let saturatedVocal = Math.tanh(rawAmplified * (1.0 + warmthFactor)) / (1.0 + warmthFactor * 0.2);

// 2. High Pass Rumble Filter (80Hz low-cut)
let lc_omega = (2.0 * Math.PI * lowCutHz) / 44100.0;
let lc_alpha = Math.sin(lc_omega) / (2.0 * 0.707); // Q = 0.707
let a0 = 1.0 + lc_alpha;
let b0 = (1.0 + Math.cos(lc_omega)) / 2.0 / a0;
let b1 = -(1.0 + Math.cos(lc_omega)) / a0;
let b2 = (1.0 + Math.cos(lc_omega)) / 2.0 / a0;
let a1 = -2.0 * Math.cos(lc_omega) / a0;
let a2 = (1.0 - lc_alpha) / a0;

let lowCutSample = b0 * saturatedVocal + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
state.x2 = state.x1; state.x1 = saturatedVocal;
state.y2 = state.y1; state.y1 = lowCutSample;

// 3. Air treble presence booster
let trebleLinear = Math.pow(10, airBoostDb / 20);
let highSqueezed = lowCutSample + 0.12 * Math.sin(lowCutSample * 8.0) * trebleLinear;

// 4. Volume Fader & VU Meter mapping
let faderLinear = Math.pow(10, faderDb / 20);
let outVal = highSqueezed * faderLinear;

let outputPower = Math.max(1e-5, Math.abs(outVal));
let outDb = 20.0 * Math.log10(outputPower);

if (params.output_vu !== undefined) {
  params.output_vu = Math.max(-60, Math.min(6, outDb));
}

return outVal;`
  },
  {
    name: "🌌 Cyberpunk LFO Synth Drone Cockpit",
    theme: "custom-skin" as const,
    description: "Complete modular dual-oscillator drone generator featuring 12-step trigger pads, cyclical LFO drift knobs, and a fully customized purple faceplate skin.",
    customSkin: {
      bgColor: "#080112",
      borderColor: "#581c87",
      borderWidth: 6,
      textColor: "#d8b4fe",
      accentColor: "#c084fc",
      fontStyle: "orbitron",
      glowStyle: "neon"
    },
    parameters: [
      { id: "synth_pitch", name: "Drone Osc Frequency", min: 40, max: 440, defaultValue: 110, value: 110, unit: "Hz", controlType: "knob", x: 40, y: 70, w: 120, h: 100 },
      { id: "waveform_type", name: "LFO Shape visualizer", min: 1, max: 4, defaultValue: 2, value: 2, unit: "sine", controlType: "waveform", x: 180, y: 70, w: 220, h: 120 },
      { id: "lfo_depth", name: "Phaser Sweep Depth", min: 0.1, max: 12, defaultValue: 4.5, value: 4.5, unit: "Hz", controlType: "knob", x: 420, y: 70, w: 120, h: 100 },
      { id: "pad_c3", name: "Osc Sub-Harmonic (C3)", min: 0, max: 1, defaultValue: 0, value: 0, unit: "gate", controlType: "pad", x: 40, y: 200, w: 90, h: 90 },
      { id: "pad_g3", name: "Drone Fifth interval (G3)", min: 0, max: 1, defaultValue: 0, value: 0, unit: "gate", controlType: "pad", x: 145, y: 200, w: 90, h: 90 },
      { id: "pad_c4", name: "High Octave (C4)", min: 0, max: 1, defaultValue: 0, value: 0, unit: "gate", controlType: "pad", x: 250, y: 200, w: 90, h: 90 },
    ],
    dspFunction: `// --- DRONE COCKPIT MODULAR SYNTH SHAPER ---
if (!state.init_synth) {
  state.osc1 = 0.0;
  state.osc2 = 0.0;
  state.lfo = 0.0;
  state.phase = 0.0;
  state.subPhase = 0.0;
  state.fifthPhase = 0.0;
  state.octavePhase = 0.0;
  state.init_synth = true;
}

let freq = params.synth_pitch !== undefined ? params.synth_pitch : 110.0;
let sweepDepth = params.lfo_depth !== undefined ? params.lfo_depth : 4.5;
let pad1 = params.pad_c3 !== undefined ? params.pad_c3 : 0.0;
let pad2 = params.pad_g3 !== undefined ? params.pad_g3 : 0.0;
let pad3 = params.pad_c4 !== undefined ? params.pad_c4 : 0.0;

// Update phase of primary oscillators
state.phase += (2.0 * Math.PI * freq) / 44100.0;
if (state.phase > 2.0 * Math.PI) state.phase -= 2.0 * Math.PI;

// LFO sweeping modulator (3Hz slow sweep)
state.lfo += (2.0 * Math.PI * 3.0) / 44100.0;
if (state.lfo > 2.0 * Math.PI) state.lfo -= 2.0 * Math.PI;
let sweep = Math.sin(state.lfo) * sweepDepth;

// Synthesize dynamic analog square wave
let wave = Math.sin(state.phase + sweep) > 0 ? 0.25 : -0.25;

// Synthesize gated auxiliary voices from drum triggers
let auxVoice = 0.0;

if (pad1 > 0.5) { // C3 Sub voice (freq / 2)
  state.subPhase += (2.0 * Math.PI * (freq * 0.5)) / 44100.0;
  if (state.subPhase > 2.0 * Math.PI) state.subPhase -= 2.0 * Math.PI;
  auxVoice += Math.sin(state.subPhase) * 0.35;
}

if (pad2 > 0.5) { // G3 Fifth voice (freq * 1.5)
  state.fifthPhase += (2.0 * Math.PI * (freq * 1.5)) / 44100.0;
  if (state.fifthPhase > 2.0 * Math.PI) state.fifthPhase -= 2.0 * Math.PI;
  auxVoice += (Math.sin(state.fifthPhase) > 0 ? 0.15 : -0.15);
}

if (pad3 > 0.5) { // C4 High Octave (freq * 2.0)
  state.octavePhase += (2.0 * Math.PI * (freq * 2.0)) / 44100.0;
  if (state.octavePhase > 2.0 * Math.PI) state.octavePhase -= 2.0 * Math.PI;
  auxVoice += Math.sin(state.octavePhase) * 0.25;
}

// Cascaded output and noise simulation
let noise = (Math.random() - 0.5) * 0.015;
let mixed = (wave + auxVoice + noise) * 0.5;

return inputSample * 0.3 + mixed;`
  }
];

export default function UIDesigner({ plugin, onChange, triggerToast }: UIDesignerProps) {
  // Config Mode Selector: Play/test vs. Customize/build Layout
  const [isEditMode, setIsEditMode] = useState<boolean>(true);

  // Selected Figma Element inside canvas
  const [selectedParamId, setSelectedParamId] = useState<string | null>(null);

  // Context Menu state for right-clicking Amp and Cab widgets
  const [activeContextMenu, setActiveContextMenu] = useState<{
    x: number;
    y: number;
    paramId: string;
    type: "amp" | "cab";
  } | null>(null);

  const [contextMenuTab, setContextMenuTab] = useState<"visuals" | "hardware" | "irs">("visuals");

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const menuEl = document.getElementById("custom-context-menu");
      if (menuEl && !menuEl.contains(e.target as Node)) {
        setActiveContextMenu(null);
      }
    };
    if (activeContextMenu) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [activeContextMenu]);

  // Left sidebar active tab: palette (toolbox) vs layers (tree)
  const [leftTab, setLeftTab] = useState<"palette" | "layers">("palette");

  // Figma workspace properties
  const [zoom, setZoom] = useState<number>(1.0);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [gridSize, setGridSize] = useState<number>(10);
  const [artboardWidth, setArtboardWidth] = useState<number>(720);
  const [artboardHeight, setArtboardHeight] = useState<number>(440);

  // Size-aware fallback positions for params without explicit x/y, plus the
  // real content bounds of the whole layout.
  const fallbackLayout = useMemo(
    () => computeFallbackLayout(plugin.parameters, artboardWidth),
    [plugin.parameters, artboardWidth]
  );

  // Grow the artboard to CONTAIN the plugin's controls (amp heads, cabinets,
  // pad grids push past the 720x440 default). Grow-only: never shrink a
  // board the user has enlarged, and never fight an explicit resize.
  useEffect(() => {
    setArtboardHeight((h) => Math.max(h, Math.ceil(fallbackLayout.contentH)));
    setArtboardWidth((w) => Math.max(w, Math.ceil(fallbackLayout.contentW)));
  }, [fallbackLayout.contentH, fallbackLayout.contentW]);

  // Active theme layout: slate, vintage, cyberpunk, modular, custom-skin
  const [theme, setTheme] = useState<"aero-slate" | "vintage-analog" | "cyberpunk-neon" | "modular-synth" | "classic-ivory" | "custom-skin">(() => {
    const saved = localStorage.getItem(`plugin_theme_${plugin.id}`);
    return (saved as any) || "aero-slate";
  });

  const [selectedGlossaryKey, setSelectedGlossaryKey] = useState<string>("hz");

  // Floating drawer hover/vis states
  const [isTopOpen, setIsTopOpen] = useState<boolean>(false);
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(false);
  const [isRightOpen, setIsRightOpen] = useState<boolean>(false);
  const [isBottomOpen, setIsBottomOpen] = useState<boolean>(false);

  // Pinning states to lock drawer open
  const [isTopPinned, setIsTopPinned] = useState<boolean>(false);
  const [isLeftPinned, setIsLeftPinned] = useState<boolean>(false);
  const [isRightPinned, setIsRightPinned] = useState<boolean>(false);
  const [isBottomPinned, setIsBottomPinned] = useState<boolean>(false);
  const [bottomSubTab, setBottomSubTab] = useState<"templates" | "wizard" | "injectors">("templates");

  const canvasRef = useRef<HTMLDivElement>(null);

  const changeTheme = (newTheme: typeof theme) => {
    setTheme(newTheme);
    localStorage.setItem(`plugin_theme_${plugin.id}`, newTheme);
    triggerToast(`Skin applied: ${newTheme.replace("-", " ").toUpperCase()}`);
  };

  const handleParamValueChange = (id: string, newVal: number) => {
    updateParamFields(id, { value: newVal });
  };

  const updateParamFields = (paramId: string, fields: Partial<PluginParameter>) => {
    const updated = plugin.parameters.map((p) => {
      if (p.id === paramId) {
        const merged = { ...p, ...fields };
        if (merged.value !== undefined) {
          merged.value = Math.max(merged.min, Math.min(merged.max, merged.value));
        }
        return merged;
      }
      return p;
    });
    onChange({ ...plugin, parameters: updated });
  };

  const deleteParam = (paramId: string) => {
    const updated = plugin.parameters.filter((p) => p.id !== paramId);
    onChange({ ...plugin, parameters: updated });
    if (selectedParamId === paramId) {
      setSelectedParamId(null);
    }
    triggerToast("Control removed from artboard.");
  };

  // Align Tools
  const alignSelected = (alignment: "left" | "right" | "top" | "bottom" | "centerX" | "centerY") => {
    if (!selectedParamId) return;
    const target = plugin.parameters.find(p => p.id === selectedParamId);
    if (!target) return;

    const w = target.w ?? 180;
    const h = target.h ?? 120;

    let nextX = target.x ?? 50;
    let nextY = target.y ?? 50;

    switch (alignment) {
      case "left":
        nextX = 10;
        break;
      case "right":
        nextX = artboardWidth - w - 10;
        break;
      case "centerX":
        nextX = (artboardWidth - w) / 2;
        break;
      case "top":
        nextY = 10;
        break;
      case "bottom":
        nextY = artboardHeight - h - 10;
        break;
      case "centerY":
        nextY = (artboardHeight - h) / 2;
        break;
    }

    if (snapToGrid) {
      nextX = Math.round(nextX / gridSize) * gridSize;
      nextY = Math.round(nextY / gridSize) * gridSize;
    }

    updateParamFields(selectedParamId, { x: nextX, y: nextY });
    triggerToast(`Aligned ${target.name} to artboard`);
  };

  // Auto layout arranging algorithms
  const autoArrangeLayout = (layoutStyle: "grid" | "rack" | "pedal" | "strip") => {
    if (plugin.parameters.length === 0) {
      triggerToast("No controls to arrange! Add some controls first.");
      return;
    }

    let updatedParams = [...plugin.parameters];
    const count = updatedParams.length;

    if (layoutStyle === "grid") {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellW = Math.floor((artboardWidth - 40) / cols);
      const cellH = Math.floor((artboardHeight - 40) / rows);

      updatedParams = updatedParams.map((p, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const w = Math.min(cellW - 15, p.w ?? 150);
        const h = Math.min(cellH - 15, p.h ?? 110);
        return {
          ...p,
          w,
          h,
          x: Math.round((20 + col * cellW + (cellW - w) / 2) / gridSize) * gridSize,
          y: Math.round((20 + row * cellH + (cellH - h) / 2) / gridSize) * gridSize,
        };
      });
      triggerToast(`Re-arranged ${count} controls into a ${cols}x${rows} Grid!`);
    } else if (layoutStyle === "strip") {
      const cellW = Math.floor((artboardWidth - 40) / count);
      updatedParams = updatedParams.map((p, idx) => {
        const isVerticalElement = p.controlType === "slider" || p.controlType === "meter";
        const w = Math.min(cellW - 10, isVerticalElement ? 80 : 120);
        const h = isVerticalElement ? artboardHeight - 60 : 100;
        return {
          ...p,
          w,
          h,
          x: Math.round((20 + idx * cellW + (cellW - w) / 2) / gridSize) * gridSize,
          y: Math.round((isVerticalElement ? 20 : (artboardHeight - h) / 2) / gridSize) * gridSize,
        };
      });
      triggerToast(`Arranged ${count} controls into a Horizontal Channel Strip!`);
    } else if (layoutStyle === "pedal") {
      const knobs = updatedParams.filter(p => p.controlType === "knob" || p.controlType === "slider");
      const controls = updatedParams.filter(p => p.controlType !== "knob" && p.controlType !== "slider");
      
      let knobIdx = 0;
      let controlIdx = 0;
      
      updatedParams = updatedParams.map((p) => {
        if (p.controlType === "knob" || p.controlType === "slider") {
          const colCount = Math.min(3, knobs.length) || 1;
          const cellW = Math.floor((artboardWidth - 40) / colCount);
          const col = knobIdx % colCount;
          const row = Math.floor(knobIdx / colCount);
          knobIdx++;
          const w = 120;
          const h = 100;
          return {
            ...p,
            w,
            h,
            x: Math.round((20 + col * cellW + (cellW - w) / 2) / gridSize) * gridSize,
            y: Math.round((20 + row * 110) / gridSize) * gridSize,
          };
        } else {
          const colCount = Math.max(1, controls.length);
          const cellW = Math.floor((artboardWidth - 40) / colCount);
          const col = controlIdx;
          controlIdx++;
          const w = p.controlType === "pad" || p.controlType === "button" ? 100 : 140;
          const h = 80;
          return {
            ...p,
            w,
            h,
            x: Math.round((20 + col * cellW + (cellW - w) / 2) / gridSize) * gridSize,
            y: Math.round((artboardHeight - h - 30) / gridSize) * gridSize,
          };
        }
      });
      triggerToast(`Re-arranged stompbox layout: parameters aligned!`);
    } else if (layoutStyle === "rack") {
      const cellW = Math.floor((artboardWidth - 60) / count);
      updatedParams = updatedParams.map((p, idx) => {
        const w = Math.min(cellW - 10, p.w ?? 140);
        const h = Math.min(artboardHeight - 60, p.h ?? 110);
        return {
          ...p,
          w,
          h,
          x: Math.round((30 + idx * cellW + (cellW - w) / 2) / gridSize) * gridSize,
          y: Math.round(((artboardHeight - h) / 2) / gridSize) * gridSize,
        };
      });
      triggerToast(`Re-arranged controls into a Studio Rackmount Strip!`);
    }

    onChange({ ...plugin, parameters: updatedParams });
  };

  // Load complete pre-designed faceplate and matching dynamic DSP
  const applyProStudioTemplate = (idx: number) => {
    const t = PRO_STUDIO_TEMPLATES[idx];
    if (!t) return;
    
    const updatedPlugin: AudioPlugin = {
      ...plugin,
      name: t.name,
      category: t.theme === "cyberpunk-neon" ? "modulation" : t.theme === "modular-synth" ? "distortion" : "filter",
      description: t.description,
      parameters: t.parameters,
      dspFunction: t.dspFunction,
    };
    
    onChange(updatedPlugin);
    changeTheme(t.theme);
    setSelectedParamId(t.parameters[0]?.id || null);
    triggerToast(`Successfully loaded "${t.name}" Faceplate & DSP Engine!`);
  };

  // Draggable node mechanism inside figma board
  const handleWidgetMouseDown = (e: React.MouseEvent, param: PluginParameter) => {
    if (!isEditMode) return;
    e.stopPropagation();
    setSelectedParamId(param.id);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = (e.clientX - rect.left) / zoom;
    const startY = (e.clientY - rect.top) / zoom;
    const initialX = param.x ?? 50;
    const initialY = param.y ?? 50;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentX = (moveEvent.clientX - rect.left) / zoom;
      const currentY = (moveEvent.clientY - rect.top) / zoom;

      let dx = currentX - startX;
      let dy = currentY - startY;

      let nextX = initialX + dx;
      let nextY = initialY + dy;

      if (snapToGrid) {
        nextX = Math.round(nextX / gridSize) * gridSize;
        nextY = Math.round(nextY / gridSize) * gridSize;
      }

      nextX = Math.max(0, Math.min(artboardWidth - (param.w ?? 180), nextX));
      nextY = Math.max(0, Math.min(artboardHeight - (param.h ?? 120), nextY));

      updateParamFields(param.id, { x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Interactive resize node mechanism
  const handleResizeMouseDown = (e: React.MouseEvent, param: PluginParameter) => {
    e.stopPropagation();
    e.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = (e.clientX - rect.left) / zoom;
    const startY = (e.clientY - rect.top) / zoom;
    const initialW = param.w ?? 180;
    const initialH = param.h ?? 120;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentX = (moveEvent.clientX - rect.left) / zoom;
      const currentY = (moveEvent.clientY - rect.top) / zoom;

      let dw = currentX - startX;
      let dh = currentY - startY;

      let nextW = initialW + dw;
      let nextH = initialH + dh;

      if (snapToGrid) {
        nextW = Math.round(nextW / gridSize) * gridSize;
        nextH = Math.round(nextH / gridSize) * gridSize;
      }

      nextW = Math.max(120, Math.min(artboardWidth - (param.x ?? 0), nextW));
      nextH = Math.max(70, Math.min(artboardHeight - (param.y ?? 0), nextH));

      updateParamFields(param.id, { w: nextW, h: nextH });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Drag and Drop Assets from Palette to Canvas
  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDrop = (e: React.DragEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    
    const data = e.dataTransfer.getData("text/plain");
    if (!data) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Relative release spot
    const dropX = (e.clientX - rect.left) / zoom;
    const dropY = (e.clientY - rect.top) / zoom;

    let created: PluginParameter | null = null;

    if (data.startsWith("widget:")) {
      const type = data.split(":")[1] as any;
      const randomId = `${type}_${Math.floor(100 + Math.random() * 900)}`;
      let label = `${type.charAt(0).toUpperCase() + type.slice(1)} Control`;
      
      let min = 0, max = 1, def = 0.5, unit = "%";
      let defaultW = 180;
      let defaultH = 120;
      let customText = "";
      let valX = 50;
      let valY = 50;

      if (type === "knob") {
        min = 20; max = 20000; def = 1000; unit = "Hz";
      } else if (type === "toggle" || type === "button") {
        min = 0; max = 1; def = 0; unit = "state";
      } else if (type === "label") {
        min = 0; max = 0; def = 0; unit = "";
      } else if (type === "meter") {
        min = -60; max = 6; def = -12; unit = "dB";
        label = "Decibel VU Meter";
        defaultW = 80;
        defaultH = 180;
      } else if (type === "eq") {
        min = 0.1; max = 10; def = 1; unit = "Q";
        label = "Parametric EQ Curve";
        defaultW = 285;
        defaultH = 140;
      } else if (type === "waveform") {
        min = 1; max = 4; def = 1; unit = "osc";
        label = "LFO Oscillator Wave";
        defaultW = 220;
        defaultH = 120;
      } else if (type === "pad") {
        min = 0; max = 127; def = 0; unit = "vel";
        label = "MPC Trigger Pad";
        defaultW = 100;
        defaultH = 100;
      } else if (type === "amp") {
        min = 0; max = 10; def = 5; unit = "gain";
        label = "Plexi Amp Head";
        customText = "MARSHALL PLEXI 50W";
        defaultW = 340;
        defaultH = 150;
      } else if (type === "cab") {
        min = 0; max = 10; def = 5; unit = "vol";
        label = "4x12 Vintage Cabinet";
        customText = "CELESTION 1960A";
        defaultW = 240;
        defaultH = 240;
      } else if (type === "mic") {
        min = 0; max = 100; def = 20; unit = "mm";
        label = "SM57 Dynamic Mic";
        defaultW = 160;
        defaultH = 160;
        valX = 35;
        valY = 50;
      } else if (type === "mic_stand") {
        min = 0; max = 360; def = 45; unit = "deg";
        label = "U87 Vintage Condenser Mic";
        defaultW = 140;
        defaultH = 220;
      }

      let targetX = Math.max(0, Math.min(artboardWidth - defaultW, dropX - defaultW / 2));
      let targetY = Math.max(0, Math.min(artboardHeight - defaultH, dropY - defaultH / 2));

      if (snapToGrid) {
        targetX = Math.round(targetX / gridSize) * gridSize;
        targetY = Math.round(targetY / gridSize) * gridSize;
      }

      created = {
        id: randomId,
        name: label,
        min,
        max,
        defaultValue: def,
        value: def,
        unit,
        controlType: type,
        x: targetX,
        y: targetY,
        w: defaultW,
        h: defaultH,
        customText,
        valX,
        valY
      };
    } else if (data.startsWith("preset:")) {
      const idx = parseInt(data.split(":")[1]);
      const p = AUDIO_RANGE_PRESETS[idx];
      if (p) {
        const safeId = p.name.replace(/[^a-zA-Z]/g, "").toLowerCase().replace(/\s+/g, "_") + "_" + Math.floor(10 + Math.random() * 90);
        const defaultW = 180;
        const defaultH = 120;
        let targetX = Math.max(0, Math.min(artboardWidth - defaultW, dropX - defaultW / 2));
        let targetY = Math.max(0, Math.min(artboardHeight - defaultH, dropY - defaultH / 2));

        if (snapToGrid) {
          targetX = Math.round(targetX / gridSize) * gridSize;
          targetY = Math.round(targetY / gridSize) * gridSize;
        }

        created = {
          id: safeId,
          name: p.name.split(" ").slice(1).join(" "),
          min: p.min,
          max: p.max,
          defaultValue: p.def,
          value: p.def,
          unit: p.unit,
          controlType: p.min === 0 && p.max === 1 ? "toggle" : "slider",
          x: targetX,
          y: targetY,
          w: defaultW,
          h: defaultH
        };
      }
    }

    if (created) {
      onChange({
        ...plugin,
        parameters: [...plugin.parameters, created]
      });
      setSelectedParamId(created.id);
      triggerToast(`Figma Canvas: Dropped & mounted ${created.name}`);
    }
  };

  // Add parameter through quick click
  const appendWidgetInstantly = (type: "slider" | "knob" | "toggle" | "button" | "number" | "label" | "meter" | "eq" | "waveform" | "pad" | "amp" | "cab" | "mic" | "mic_stand") => {
    const randomId = `${type}_${Math.floor(100 + Math.random() * 900)}`;
    let label = `${type.charAt(0).toUpperCase() + type.slice(1)} Control`;
    
    let min = 0, max = 1, def = 0.5, unit = "%";
    let defaultW = 180;
    let defaultH = 120;
    let customText = "";
    let valX = 50;
    let valY = 50;

    if (type === "knob") {
      min = 20; max = 20000; def = 1000; unit = "Hz";
    } else if (type === "toggle" || type === "button") {
      min = 0; max = 1; def = 0; unit = "state";
    } else if (type === "label") {
      min = 0; max = 0; def = 0; unit = "";
    } else if (type === "meter") {
      min = -60; max = 6; def = -12; unit = "dB";
      label = "Decibel VU Meter";
      defaultW = 80;
      defaultH = 180;
    } else if (type === "eq") {
      min = 0.1; max = 10; def = 1; unit = "Q";
      label = "Parametric EQ Curve";
      defaultW = 285;
      defaultH = 140;
    } else if (type === "waveform") {
      min = 1; max = 4; def = 1; unit = "osc";
      label = "LFO Oscillator Wave";
      defaultW = 220;
      defaultH = 120;
    } else if (type === "pad") {
      min = 0; max = 127; def = 0; unit = "vel";
      label = "MPC Trigger Pad";
      defaultW = 100;
      defaultH = 100;
    } else if (type === "amp") {
      min = 0; max = 10; def = 5; unit = "gain";
      label = "Plexi Amp Head";
      customText = "MARSHALL PLEXI 50W";
      defaultW = 340;
      defaultH = 150;
    } else if (type === "cab") {
      min = 0; max = 10; def = 5; unit = "vol";
      label = "4x12 Vintage Cabinet";
      customText = "CELESTION 1960A";
      defaultW = 240;
      defaultH = 240;
    } else if (type === "mic") {
      min = 0; max = 100; def = 20; unit = "mm";
      label = "SM57 Dynamic Mic";
      defaultW = 160;
      defaultH = 160;
      valX = 35;
      valY = 50;
    } else if (type === "mic_stand") {
      min = 0; max = 360; def = 45; unit = "deg";
      label = "U87 Vintage Condenser Mic";
      defaultW = 140;
      defaultH = 220;
    }

    const col = plugin.parameters.length % 3;
    const row = Math.floor(plugin.parameters.length / 3);
    const targetX = 30 + col * 210;
    const targetY = 30 + row * 150;

    const created: PluginParameter = {
      id: randomId,
      name: label,
      min,
      max,
      defaultValue: def,
      value: def,
      unit,
      controlType: type as any,
      x: targetX,
      y: targetY,
      w: defaultW,
      h: defaultH,
      customText,
      valX,
      valY
    };

    onChange({
      ...plugin,
      parameters: [...plugin.parameters, created]
    });
    setSelectedParamId(created.id);
    triggerToast(`Added ${label} to artboard layout`);
  };

  const selectedParam = plugin.parameters.find(p => p.id === selectedParamId);

  const getParamFontFamily = (fontStyle?: string) => {
    switch (fontStyle) {
      case "serif":
        return "Georgia, serif";
      case "mono":
        return "JetBrains Mono, monospace";
      case "grotesk":
        return "Space Grotesk, sans-serif";
      case "orbitron":
        return "Orbitron, sans-serif";
      default:
        return "Inter, sans-serif";
    }
  };

  // Background styling of figma Artboard
  const getArtboardSkinStyle = () => {
    switch (theme) {
      case "vintage-analog":
        return "bg-[#efebe1] border-[6px] border-[#8c7456] shadow-xl relative overflow-hidden text-[#3e3427]";
      case "cyberpunk-neon":
        return "bg-black border-2 border-[#ea00d9] text-purple-200 shadow-[0_0_35px_rgba(234,0,217,0.3)] relative overflow-hidden";
      case "modular-synth":
        return "bg-neutral-900 border-4 border-neutral-750 shadow-inner relative overflow-hidden text-neutral-350";
      case "classic-ivory":
        return "bg-[#fcfbf9] border-4 border-neutral-300 shadow-lg text-neutral-800 rounded-lg";
      case "custom-skin":
        return "border-solid shadow-2xl relative overflow-hidden rounded-2xl";
      default: // aero-slate
        return "bg-[#0d0d11] border border-neutral-800/80 rounded-2xl shadow-2xl text-white";
    }
  };

  // Coordinate indicators for Rulers
  const getHorizontalRulers = () => {
    const ticks = [];
    for (let i = 0; i <= artboardWidth; i += 100) {
      ticks.push(i);
    }
    return ticks;
  };

  const getVerticalRulers = () => {
    const ticks = [];
    for (let i = 0; i <= artboardHeight; i += 100) {
      ticks.push(i);
    }
    return ticks;
  };

  return (
    <div className="w-full flex flex-col space-y-4">
      
      {/* IMMERSIVE HOVER-CONTROLLED WORKSPACE CONTAINER */}
      <div className="relative w-full h-[780px] bg-neutral-950 border border-neutral-800 rounded-3xl overflow-hidden select-none flex flex-col">
        
        {/* EDGE HOVER TRIGGERS (When panels are closed and unpinned) */}
        {(!isTopOpen && !isTopPinned) && (
          <div 
            onMouseEnter={() => setIsTopOpen(true)}
            className="absolute top-0 left-1/2 -translate-x-1/2 z-30 px-5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-b-xl border-x border-b border-indigo-400 font-mono text-[9px] font-extrabold uppercase tracking-widest cursor-pointer shadow-lg shadow-indigo-950/50 flex items-center gap-1.5 animate-bounce hover:animate-none transition-all duration-200"
          >
            <Wrench className="w-3 h-3" />
            <span>▲ Hover for Tools & Skin Settings</span>
          </div>
        )}

        {(!isLeftOpen && !isLeftPinned) && (
          <div 
            onMouseEnter={() => setIsLeftOpen(true)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-30 px-1.5 py-6 bg-neutral-900 hover:bg-indigo-600 border-y border-r border-neutral-800 hover:border-indigo-500 rounded-r-xl text-neutral-300 hover:text-white cursor-pointer shadow-xl flex flex-col items-center justify-center gap-2 transition-all duration-200"
          >
            <Grid className="w-3.5 h-3.5 text-indigo-400" />
            <div className="flex flex-col items-center gap-0.5 text-[8px] font-mono font-bold leading-none uppercase tracking-wider">
              <span>P</span>
              <span>A</span>
              <span>L</span>
              <span>E</span>
              <span>T</span>
              <span>T</span>
              <span>E</span>
            </div>
          </div>
        )}

        {(!isRightOpen && !isRightPinned) && (
          <div 
            onMouseEnter={() => setIsRightOpen(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-30 px-1.5 py-6 bg-neutral-900 hover:bg-indigo-600 border-y border-l border-neutral-800 hover:border-indigo-500 rounded-l-xl text-neutral-300 hover:text-white cursor-pointer shadow-xl flex flex-col items-center justify-center gap-2 transition-all duration-200"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            <div className="flex flex-col items-center gap-0.5 text-[8px] font-mono font-bold leading-none uppercase tracking-wider">
              <span>I</span>
              <span>N</span>
              <span>S</span>
              <span>P</span>
              <span>E</span>
              <span>C</span>
              <span>T</span>
            </div>
          </div>
        )}

        {(!isBottomOpen && !isBottomPinned) && (
          <div 
            onMouseEnter={() => setIsBottomOpen(true)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 z-30 px-5 py-1.5 bg-neutral-900 hover:bg-indigo-600 border-x border-t border-neutral-800 hover:border-indigo-500 rounded-t-xl text-neutral-300 hover:text-white cursor-pointer shadow-xl flex items-center gap-1.5 transition-all duration-200"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest">▼ Templates & Glossary</span>
          </div>
        )}

        {/* SLIDE-OUT TOP BAR */}
        <div 
          onMouseEnter={() => setIsTopOpen(true)}
          onMouseLeave={() => setIsTopOpen(false)}
          className={`absolute top-0 left-0 right-0 z-40 bg-neutral-900/95 backdrop-blur-md p-4 border-b border-neutral-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 transition-all duration-300 ${
            (isTopOpen || isTopPinned) ? "translate-y-0 opacity-100 shadow-2xl pointer-events-auto" : "-translate-y-full opacity-0 pointer-events-none"
          }`}
        >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {/* FIGMA-STYLE LOGO ACCENT */}
            <div className="flex gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <span className="font-mono text-[10px] font-bold text-neutral-400 tracking-wider">
              FIGMA AUDIO STUDIO WORKSPACE
            </span>
          </div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <MousePointer className="w-4 h-4 text-indigo-400" />
            <span>Interactive Tactile UI Designer</span>
          </h2>
          <p className="text-[11px] text-neutral-400">
            Figma-style drag, drop, align, and customize absolute faceplate controls. Real-time audio engine binds to <code className="bg-neutral-950 px-1 py-0.5 rounded text-orange-400 font-mono text-[9px]">params.id_ref</code>.
          </p>
        </div>

        {/* Console Workspace Master Switcher */}
        <div className="flex flex-wrap items-center gap-2 select-none shrink-0 self-start lg:self-auto">
          {/* Theme Skin selector */}
          <div className="flex items-center gap-1 bg-neutral-950 px-2 py-1 rounded-xl border border-neutral-800">
            <Palette className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[9px] font-mono text-neutral-500 uppercase mr-1">Skin:</span>
            {(["aero-slate", "vintage-analog", "cyberpunk-neon", "modular-synth", "classic-ivory", "custom-skin"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeTheme(t)}
                className={`px-2 py-0.5 rounded-md text-[9px] font-mono font-bold capitalize transition-all ${
                  theme === t
                    ? "bg-indigo-600 text-white shadow"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {t.split("-")[0]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800">
            <button
              type="button"
              onClick={() => {
                setIsEditMode(false);
                triggerToast("Playing & Testing active console values.");
              }}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                !isEditMode
                  ? "bg-emerald-600 text-white shadow-md"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>🕹️ LIVE TEST</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditMode(true);
                triggerToast("Customize Mode Active! Select elements on the canvas to move or resize them.");
              }}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                isEditMode
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>🛠️ FIGMA CANVAS</span>
            </button>

            {/* PIN/LOCK CONTROL */}
            <button
              type="button"
              onClick={() => setIsTopPinned(!isTopPinned)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold border transition ${
                isTopPinned 
                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-400 shadow-md" 
                  : "bg-neutral-950 border-neutral-850 text-neutral-400 hover:text-white"
              }`}
              title={isTopPinned ? "Unpin Top Bar" : "Pin Top Bar Open"}
            >
              {isTopPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span>{isTopPinned ? "LOCKED" : "PIN"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* MAIN VIEWPORT BODY (Underlying Canvas + Absolute Slide-out Drawers) */}
      <div className="relative w-full h-full overflow-hidden flex flex-col">
        
        {/* COLUMN 1: LEFT SIDEBAR (Slide-out Absolute Drawer) */}
        <div 
          onMouseEnter={() => setIsLeftOpen(true)}
          onMouseLeave={() => setIsLeftOpen(false)}
          className={`absolute top-0 bottom-0 left-0 w-[300px] z-40 bg-neutral-900/95 backdrop-blur-md border-r border-neutral-850 flex flex-col transition-all duration-300 ease-in-out ${
            (isLeftOpen || isLeftPinned) ? "translate-x-0 opacity-100 shadow-2xl pointer-events-auto" : "-translate-x-full opacity-0 pointer-events-none"
          }`}
        >
          {/* Drawer Pin Control */}
          <div className="flex items-center justify-between p-2.5 bg-neutral-950 border-b border-neutral-800 shrink-0">
            <span className="text-[10px] font-mono font-bold text-neutral-450">🎛️ LIBRARY & LAYERS</span>
            <button
              type="button"
              onClick={() => setIsLeftPinned(!isLeftPinned)}
              className={`p-1 rounded transition ${
                isLeftPinned ? "text-indigo-400 font-bold" : "text-neutral-500 hover:text-white"
              }`}
              title={isLeftPinned ? "Unpin Sidebar" : "Pin Sidebar Open"}
            >
              {isLeftPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </div>
          
          {/* Tab selectors */}
          <div className="grid grid-cols-2 border-b border-neutral-800 text-[10px] font-mono font-bold">
            <button
              onClick={() => setLeftTab("palette")}
              className={`py-2.5 flex items-center justify-center gap-1 border-r border-neutral-800 transition ${
                leftTab === "palette" ? "bg-neutral-950 text-indigo-400 border-b-2 border-indigo-500" : "hover:bg-neutral-950/50"
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>PALETTE</span>
            </button>
            <button
              onClick={() => setLeftTab("layers")}
              className={`py-2.5 flex items-center justify-center gap-1 transition ${
                leftTab === "layers" ? "bg-neutral-950 text-indigo-400 border-b-2 border-indigo-500" : "hover:bg-neutral-950/50"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>LAYERS ({plugin.parameters.length})</span>
            </button>
          </div>

          {/* Side Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {leftTab === "palette" ? (
              <div className="space-y-4">
                
                {/* Visual Shapes */}
                <div className="space-y-2">
                  <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">
                    1. Control UI Widgets
                  </span>
                  <p className="text-[10px] text-neutral-400 leading-normal">
                    Drag widgets directly into the canvas drop-zone or click to insert:
                  </p>
                  
                  <div className="grid grid-cols-1 gap-1.5">
                    {[
                      { type: "slider", name: "Linear Fader Slider", icon: "🎚️", desc: "Linear slider for volume, mix, thresholds" },
                      { type: "knob", name: "Rotary Dial Knob", icon: "🎛️", desc: "Radial knob dial for frequency or feedback" },
                      { type: "toggle", name: "Lever Toggle Switch", icon: "🔌", desc: "Binary toggle bypass or route switches" },
                      { type: "button", name: "Push trigger Button", icon: "⏹️", desc: "Push-gate trigger button" },
                      { type: "number", name: "Digital Numeric Input", icon: "🔢", desc: "Readout input box for direct entries" },
                      { type: "label", name: "Decorative Text Label", icon: "🏷️", desc: "Visual text headings, subheadings, frames" },
                      { type: "meter", name: "Decibel VU Meter", icon: "📊", desc: "Real-time glowing segment level-meter with clip light" },
                      { type: "eq", name: "Parametric EQ Curve", icon: "📈", desc: "Equalizer display graph with editable spline handles" },
                      { type: "waveform", name: "Osc Waveform Canvas", icon: "〰️", desc: "Interactive synthesiser oscillator cycle display" },
                      { type: "pad", name: "Tactile MPC Drum Pad", icon: "🟩", desc: "Velocity-sensitive light-up percussion trigger" },
                      { type: "amp", name: "Guitar Tube Amp Head", icon: "🎸", desc: "Guitar amplifier faceplate with metal dials and brand text" },
                      { type: "cab", name: "Vintage Guitar Cabinet", icon: "🔊", desc: "Speaker cabinet overlay with retro grille cloth" },
                      { type: "mic", name: "Mic Position Tracker", icon: "🎙️", desc: "Interactive mic off-axis and distance speaker target" },
                      { type: "mic_stand", name: "Studio Condenser & Stand", icon: "🗼", desc: "Vocal microphone mounted on gallows boom shock-mount" },
                    ].map((w) => (
                      <div
                        key={w.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", `widget:${w.type}`);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => appendWidgetInstantly(w.type as any)}
                        className="group flex items-center justify-between px-3 py-2 bg-neutral-950 border border-neutral-850 hover:border-indigo-500 hover:bg-neutral-900 rounded-xl cursor-grab active:cursor-grabbing text-[11px] font-medium text-neutral-350 transition-all shadow-sm"
                        title={w.desc}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{w.icon}</span>
                          <span>{w.name}</span>
                        </div>
                        <span className="text-[8px] font-mono text-neutral-500 group-hover:text-indigo-400 transition">DRAG / +</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Preconfigured Audio Nodes templates */}
                <div className="space-y-2 pt-3 border-t border-neutral-800">
                  <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">
                    2. Dynamic Audio Presets
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {AUDIO_RANGE_PRESETS.map((p, idx) => (
                      <div
                        key={idx}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", `preset:${idx}`);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => {
                          const safeId = p.name.replace(/[^a-zA-Z]/g, "").toLowerCase().replace(/\s+/g, "_") + "_" + Math.floor(10 + Math.random() * 90);
                          const created: PluginParameter = {
                            id: safeId,
                            name: p.name.split(" ").slice(1).join(" "),
                            min: p.min,
                            max: p.max,
                            defaultValue: p.def,
                            value: p.def,
                            unit: p.unit,
                            controlType: p.min === 0 && p.max === 1 ? "toggle" : "slider",
                            x: 40 + (plugin.parameters.length % 3) * 200,
                            y: 40 + Math.floor(plugin.parameters.length / 3) * 140,
                            w: 180,
                            h: 120
                          };
                          onChange({
                            ...plugin,
                            parameters: [...plugin.parameters, created]
                          });
                          setSelectedParamId(created.id);
                          triggerToast(`Mounted preset: ${created.name}`);
                        }}
                        className="group flex items-center justify-between px-3 py-1.5 bg-neutral-950/60 hover:bg-neutral-950 border border-neutral-850 rounded-xl cursor-grab active:cursor-grabbing text-[10px] text-neutral-350 transition-all"
                        title={p.desc}
                      >
                        <div className="truncate pr-2">
                          <span className="font-bold text-indigo-400 mr-1">{p.name.split(" ")[0]}</span>
                          <span className="font-semibold">{p.name.split(" ").slice(1).join(" ")}</span>
                        </div>
                        <span className="text-[7.5px] font-mono text-neutral-600 shrink-0">ADD</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-[8px] font-mono font-bold text-neutral-500 uppercase tracking-widest block">
                  Artboard Layers Tree
                </span>
                
                {plugin.parameters.length === 0 ? (
                  <div className="p-4 text-center text-neutral-500 text-[10px]">
                    No elements on artboard. Add widgets above.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {plugin.parameters.map((p) => {
                      const isSelected = selectedParamId === p.id;
                      return (
                        <div
                          key={p.id}
                          onClick={() => setSelectedParamId(p.id)}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition text-[11px] ${
                            isSelected 
                              ? "bg-indigo-600 text-white font-bold" 
                              : "bg-neutral-950 border border-neutral-850/50 hover:bg-neutral-850"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="text-[9px] opacity-75">
                              {p.controlType === "knob" ? "🎛️" : p.controlType === "slider" ? "🎚️" : p.controlType === "toggle" ? "🔌" : p.controlType === "label" ? "🏷️" : "⏹️"}
                            </span>
                            <div className="truncate">
                              <p className="truncate text-left leading-tight">{p.name}</p>
                              <p className={`text-[8px] truncate font-mono ${isSelected ? "text-indigo-200" : "text-neutral-500"}`}>
                                params.{p.id}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className="text-[8px] font-mono text-neutral-500">
                              X:{Math.round(p.x ?? 0)} Y:{Math.round(p.y ?? 0)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteParam(p.id);
                              }}
                              className="text-rose-400 hover:text-rose-250 p-0.5"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Clear Workspace */}
          <div className="p-3 border-t border-neutral-800 bg-neutral-950/40 text-center">
            <button
              onClick={() => {
                if (window.confirm("Clear all controls and start with a fresh blank canvas?")) {
                  onChange({ ...plugin, parameters: [] });
                  setSelectedParamId(null);
                  triggerToast("Figma board cleared.");
                }
              }}
              className="px-4 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg hover:bg-rose-950/20 hover:border-rose-900 text-[10px] hover:text-rose-400 text-neutral-400 font-bold tracking-tight transition"
            >
              ♻️ Reset Blank Artboard
            </button>
          </div>
        </div>

        {/* COLUMN 2: CENTER FIGMA CANVAS WINDOW (Underlying Base Layer) */}
        <div className="w-full h-full flex flex-col overflow-hidden relative bg-neutral-950">
          
          {/* Canvas Sub-Header with Zoom & Grid Controls */}
          <div className="bg-neutral-900 border-b border-neutral-850 p-2 flex items-center justify-between text-xs text-neutral-300 select-none">
            
            {/* View indicators */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-bold text-neutral-400">
                BOARD: {artboardWidth}x{artboardHeight}
              </span>
              <div className="h-3 w-[1px] bg-neutral-800" />
              <button
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono border transition ${
                  snapToGrid ? "bg-indigo-600 border-indigo-500 text-white" : "border-neutral-800 text-neutral-500"
                }`}
                title="Align items automatically to incremental points"
              >
                GRID SNAP: {snapToGrid ? "ON" : "OFF"}
              </button>
            </div>

            {/* Zoom tool buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[9px] font-mono font-bold text-indigo-400 w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
                className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setZoom(1.0)}
                className="px-1 py-0.5 bg-neutral-950 text-[8px] text-neutral-500 hover:text-neutral-300 font-mono rounded"
              >
                FIT
              </button>
            </div>
          </div>

          {/* INFINITE ZOOMABLE CANVAS CONTAINER */}
          <div className="flex-1 bg-neutral-900 bg-[radial-gradient(#262626_1.5px,transparent_1.5px)] bg-[size:20px_20px] overflow-auto relative p-10 flex items-start justify-start">
            
            {/* FIGMA BOARD WRAPPER */}
            <div 
              style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
              className="relative transition-transform duration-75 select-none shrink-0"
            >
              
              {/* Top Coordinate ruler scale decoration */}
              <div className="absolute -top-7 left-0 right-0 h-4 flex items-end justify-between font-mono text-[8px] text-neutral-600 select-none border-b border-neutral-800 pb-0.5">
                {getHorizontalRulers().map(tick => (
                  <span key={tick} className="relative">
                    <span>{tick}px</span>
                    <span className="absolute -bottom-1 left-1/2 w-[1px] h-1.5 bg-neutral-800" />
                  </span>
                ))}
              </div>

              {/* Left Coordinate ruler scale decoration */}
              <div className="absolute top-0 -left-9 bottom-0 w-6 flex flex-col justify-between items-end font-mono text-[8px] text-neutral-600 select-none border-r border-neutral-800 pr-1 pb-1">
                {getVerticalRulers().map(tick => (
                  <span key={tick} className="relative">
                    <span>{tick}px</span>
                    <span className="absolute right-[-4px] top-1/2 w-1.5 h-[1px] bg-neutral-800" />
                  </span>
                ))}
              </div>

              {/* ACTUAL DESIGN ARTBOARD FACEPLATE */}
              <div
                ref={canvasRef}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                style={{ 
                  width: `${artboardWidth}px`, 
                  height: `${artboardHeight}px`,
                  ...(theme === "custom-skin" ? {
                    backgroundColor: plugin.customSkin?.bgColor || "#111116",
                    borderColor: plugin.customSkin?.borderColor || "#1f1f29",
                    borderWidth: `${plugin.customSkin?.borderWidth ?? 4}px`,
                    color: plugin.customSkin?.textColor || "#ffffff",
                    backgroundImage: plugin.customSkin?.bgImage ? `url(${plugin.customSkin.bgImage})` : "none",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    boxShadow: plugin.customSkin?.glowStyle === "neon" ? `0 0 30px ${plugin.customSkin?.accentColor || "#10b981"}` : undefined,
                    fontFamily: plugin.customSkin?.fontStyle === "mono" 
                      ? "JetBrains Mono, monospace" 
                      : plugin.customSkin?.fontStyle === "grotesk"
                      ? "Space Grotesk, sans-serif"
                      : plugin.customSkin?.fontStyle === "orbitron"
                      ? "Orbitron, sans-serif"
                      : plugin.customSkin?.fontStyle === "serif"
                      ? "Georgia, serif"
                      : "Inter, sans-serif"
                  } : {})
                }}
                className={`${getArtboardSkinStyle()} relative shadow-2xl transition-all duration-200 select-none`}
              >
                
                {/* Vintage wood texture overlay */}
                {theme === "vintage-analog" && (
                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-black/10 opacity-30 pointer-events-none" />
                )}
                {/* Cyberpunk Scanlines */}
                {theme === "cyberpunk-neon" && (
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[size:100%_4px] pointer-events-none opacity-40" />
                )}

                {/* Blank Board Message */}
                {plugin.parameters.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 text-neutral-500 space-y-3 pointer-events-none">
                    <Sliders className="w-8 h-8 text-neutral-700 animate-pulse" />
                    <div className="max-w-xs">
                      <p className="text-[11px] font-bold text-neutral-400">Empty Faceplate Design Artboard</p>
                      <p className="text-[9.5px] leading-relaxed">
                        Drag controls or preset templates from the **Left Palette** directly into this frame to place them exactly where you want.
                      </p>
                    </div>
                  </div>
                )}

                {/* ARTBOARD CONTROLS RENDERING */}
                {plugin.parameters.map((param, idx) => {
                  const isSelected = selectedParamId === param.id;
                  
                  // Size-aware fallback when x/y is not set: honors each
                  // control's real w/h so big components never overlap knobs
                  // or spill off the board (see computeFallbackLayout).
                  const x = param.x ?? fallbackLayout.positions[param.id]?.x ?? (30 + (idx % 3) * 210);
                  const y = param.y ?? fallbackLayout.positions[param.id]?.y ?? (30 + Math.floor(idx / 3) * 150);
                  const w = param.w ?? 180;
                  const h = param.h ?? 120;
                  
                  const type = param.controlType || "slider";

                  // Element wrapper classes
                  const getElementContainerStyle = () => {
                    let base = "absolute rounded-xl p-2.5 flex flex-col justify-between transition-shadow border select-none group shadow-sm ";
                    
                    if (isSelected) {
                      base += "ring-2 ring-indigo-500 border-indigo-500 bg-indigo-950/20 z-50 ";
                    } else if (isEditMode) {
                      base += "border-dashed border-neutral-800 hover:border-indigo-500 bg-neutral-900/10 hover:bg-neutral-900/40 cursor-grab active:cursor-grabbing ";
                    } else {
                      base += "border-transparent bg-transparent ";
                    }

                    switch (theme) {
                      case "vintage-analog":
                        return `${base} ${!isSelected && "bg-[#f6f2e8] border-[#dfd6c3] text-neutral-800"}`;
                      case "cyberpunk-neon":
                        return `${base} ${!isSelected && "bg-black/90 border-[#711c91]/40 text-cyan-400"}`;
                      case "modular-synth":
                        return `${base} ${!isSelected && "bg-[#141416] border-[#222226] text-neutral-300"}`;
                      case "classic-ivory":
                        return `${base} ${!isSelected && "bg-[#faf9f6] border-[#dfdcd6] text-neutral-800"}`;
                      default: // aero-slate
                        return `${base} ${!isSelected && "bg-neutral-900/50 border-neutral-850 hover:border-neutral-750 text-white"}`;
                    }
                  };

                  return (
                    <div
                      key={param.id}
                      style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
                      onMouseDown={(e) => handleWidgetMouseDown(e, param)}
                      onContextMenu={(e) => {
                        if (type === "amp" || type === "cab") {
                          e.preventDefault();
                          e.stopPropagation();
                          const bounds = canvasRef.current?.getBoundingClientRect();
                          const canvasX = bounds ? e.clientX - bounds.left : e.clientX;
                          const canvasY = bounds ? e.clientY - bounds.top : e.clientY;
                          setContextMenuTab("visuals");
                          setActiveContextMenu({
                            x: canvasX,
                            y: canvasY,
                            paramId: param.id,
                            type: type
                          });
                        }
                      }}
                      className={getElementContainerStyle()}
                    >
                      {/* SYNTH PANEL CORNER METAL CODES */}
                      {theme === "modular-synth" && (
                        <>
                          <div className="absolute top-1 left-1 w-1 h-1 rounded-full bg-neutral-600 border border-neutral-500" />
                          <div className="absolute top-1 right-1 w-1 h-1 rounded-full bg-neutral-600 border border-neutral-500" />
                          <div className="absolute bottom-1 left-1 w-1 h-1 rounded-full bg-neutral-600 border border-neutral-500" />
                          <div className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-neutral-600 border border-neutral-500" />
                        </>
                      )}

                      {/* Header metadata label of element */}
                      <div className="flex items-start justify-between gap-1 w-full truncate">
                        <div className="truncate">
                          {type === "label" ? (
                            <span className={`text-[8px] uppercase tracking-widest block font-mono text-neutral-500 font-bold`}>
                              Decoration Node
                            </span>
                          ) : (
                            <h4 className={`text-[11px] font-bold truncate ${
                              theme === "vintage-analog" ? "text-amber-950 font-serif" : "text-neutral-200"
                            }`}>
                              {param.name}
                            </h4>
                          )}
                          
                          {type !== "label" && (
                            <span className="text-[7.5px] font-mono text-neutral-500 uppercase tracking-wide block truncate">
                              params.{param.id}
                            </span>
                          )}
                        </div>

                        {/* Interactive values (not for labels) */}
                        {type !== "label" && (
                          <span className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${
                            theme === "vintage-analog" 
                              ? "bg-[#e2dac7] text-amber-950" 
                              : theme === "cyberpunk-neon" 
                              ? "bg-black text-[#00ffff] border border-cyan-950" 
                              : "bg-neutral-950/80 text-indigo-400 border border-neutral-850"
                          }`}>
                            {param.value.toFixed(1)}
                            <span className="text-[7.5px] text-neutral-500 ml-0.5">{param.unit || ""}</span>
                          </span>
                        )}
                      </div>

                      {/* Dynamic Component Inner Visuals */}
                      <div className="flex-1 flex items-center justify-center overflow-hidden py-1 w-full">
                        {type === "slider" && (
                          <div className="w-full space-y-1">
                            <input
                              type="range"
                              min={param.min}
                              max={param.max}
                              step={(param.max - param.min) / 100 || 0.01}
                              value={param.value}
                              disabled={isEditMode}
                              onChange={(e) => handleParamValueChange(param.id, parseFloat(e.target.value))}
                              className={`w-full h-1 rounded-full appearance-none transition-all ${isEditMode ? "pointer-events-none opacity-80" : "cursor-pointer"}`}
                              style={{ 
                                background: theme === "vintage-analog" ? "#d0c7b3" : "#262626",
                                accentColor: theme === "vintage-analog" ? "#854d0e" : theme === "cyberpunk-neon" ? "#ea00d9" : "#6366f1"
                              }}
                            />
                            <div className="flex justify-between text-[7px] font-mono text-neutral-500 px-0.5">
                              <span>{param.min}</span>
                              <span>{param.max}</span>
                            </div>
                          </div>
                        )}

                        {type === "knob" && (
                          <CustomKnob 
                            param={param} 
                            themeStyle={theme}
                            onChange={(val) => handleParamValueChange(param.id, val)}
                            onDblClick={() => updateParamFields(param.id, { value: param.defaultValue })}
                          />
                        )}

                        {type === "toggle" && (
                          <RetroToggle 
                            param={param} 
                            themeStyle={theme}
                            onChange={(val) => handleParamValueChange(param.id, val)}
                          />
                        )}

                        {type === "button" && (
                          <TriggerButton 
                            param={param} 
                            themeStyle={theme}
                            onChange={(val) => handleParamValueChange(param.id, val)}
                          />
                        )}

                        {type === "number" && (
                          <div className="bg-neutral-950 border border-neutral-850 p-1 rounded font-mono text-[10px] text-orange-400 font-bold flex items-center gap-1">
                            <span>VAL:</span>
                            <input
                              type="number"
                              min={param.min}
                              max={param.max}
                              value={param.value}
                              disabled={isEditMode}
                              onChange={(e) => handleParamValueChange(param.id, parseFloat(e.target.value) || 0)}
                              className="bg-transparent w-10 text-center outline-none border-b border-neutral-800 focus:border-indigo-500"
                            />
                            <span className="text-neutral-550 text-[8px] uppercase">{param.unit || "N/A"}</span>
                          </div>
                        )}

                        {type === "label" && (
                          <div className={`text-center py-2 w-full truncate flex flex-col justify-center items-center ${
                            theme === "vintage-analog" ? "font-serif text-[#3e3427]" : "font-sans"
                          }`}>
                            <span 
                              style={{ color: param.textColor || undefined }}
                              className="text-xs font-bold uppercase tracking-wider text-indigo-400"
                            >
                              {param.customText || param.name || "DECORATIVE TEXT"}
                            </span>
                            <span className="text-[7.5px] font-mono text-neutral-500 uppercase tracking-widest mt-0.5">
                              {param.unit || "Mock Graphic Label"}
                            </span>
                          </div>
                        )}

                        {type === "meter" && (
                          <div 
                            className="w-full h-full flex flex-col justify-between items-center p-1 bg-black/80 rounded border border-neutral-800/80 cursor-ns-resize"
                            onMouseDown={(e) => {
                              if (isEditMode) return;
                              e.stopPropagation();
                              const bound = e.currentTarget.getBoundingClientRect();
                              const updateValue = (clientY: number) => {
                                const ratio = 1 - Math.max(0, Math.min(1, (clientY - bound.top) / bound.height));
                                const val = param.min + ratio * (param.max - param.min);
                                handleParamValueChange(param.id, parseFloat(val.toFixed(1)));
                              };
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                updateValue(moveEvent.clientY);
                              };
                              const onMouseUp = () => {
                                window.removeEventListener("mousemove", onMouseMove);
                                window.removeEventListener("mouseup", onMouseUp);
                              };
                              window.addEventListener("mousemove", onMouseMove);
                              window.addEventListener("mouseup", onMouseUp);
                              updateValue(e.clientY);
                            }}
                          >
                            {/* CLIP INDICATOR */}
                            <div className="flex items-center gap-1">
                              <span className="text-[7px] font-mono text-neutral-500 font-bold uppercase">CLIP</span>
                              <div className={`w-2 h-2 rounded-full border border-black transition ${
                                param.value >= 0 ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-neutral-900"
                              }`} />
                            </div>
                            
                            {/* SEGMENTS LADDER */}
                            <div className="flex-1 w-full flex flex-col justify-between gap-[2px] py-1.5 px-2">
                              {Array.from({ length: 12 }).map((_, segmentIdx) => {
                                const levelRatio = (12 - segmentIdx) / 12;
                                const maxValOfSegment = param.min + levelRatio * (param.max - param.min);
                                const isActive = param.value >= maxValOfSegment;
                                const isRedZone = segmentIdx <= 2;
                                const isYellowZone = segmentIdx > 2 && segmentIdx <= 4;
                                
                                return (
                                  <div 
                                    key={segmentIdx}
                                    className={`h-[4px] rounded-[1px] w-full transition-all ${
                                      isActive 
                                        ? isRedZone 
                                          ? "bg-red-500 shadow-[0_0_3px_#ef4444]" 
                                          : isYellowZone 
                                          ? "bg-amber-400 shadow-[0_0_3px_#fbbf24]" 
                                          : "bg-emerald-500 shadow-[0_0_3px_#10b981]"
                                        : "bg-neutral-950 border-[0.5px] border-neutral-900"
                                    }`}
                                  />
                                );
                              })}
                            </div>
                            
                            <span className="text-[8px] font-mono font-bold text-orange-450 uppercase">{param.value.toFixed(0)}dB</span>
                          </div>
                        )}

                        {type === "eq" && (() => {
                          // Real frequency-response curve driven by the plugin's actual
                          // cutoff/resonance parameters -- shared with Simple Mode so both
                          // views render the identical, functionally-real shape.
                          const curve = computeFilterCurve(plugin.parameters, param, w, h);

                          return (
                            <div className="w-full h-full relative bg-neutral-950 rounded border border-neutral-850 overflow-hidden">
                              {/* GRID BACKGROUND lines */}
                              <div className="absolute inset-0 flex flex-col justify-between p-1 opacity-20 pointer-events-none">
                                <div className="border-b border-white border-dashed w-full" />
                                <div className="border-b border-white border-solid w-full" />
                                <div className="border-b border-white border-dashed w-full" />
                              </div>
                              <div className="absolute inset-0 flex justify-between p-1 opacity-10 pointer-events-none">
                                {[0, 1, 2, 3, 4].map((i) => (
                                  <div key={i} className="border-r border-white h-full" />
                                ))}
                              </div>

                              <svg className="w-full h-full absolute inset-0 pointer-events-none">
                                <path
                                  d={`${curve.pathD} L ${w},${h} L 0,${h} Z`}
                                  fill={param.accentColor || "#10b981"}
                                  fillOpacity="0.12"
                                  stroke="none"
                                />
                                <path
                                  d={curve.pathD}
                                  fill="none"
                                  stroke={param.accentColor || "#10b981"}
                                  strokeWidth="2"
                                  className="drop-shadow-[0_0_4px_rgba(16,185,129,0.5)]"
                                />
                                {/* Cutoff marker, draggable to retune the real filter frequency */}
                                <line x1={curve.cutoffX} y1={0} x2={curve.cutoffX} y2={h} stroke={param.accentColor || "#10b981"} strokeOpacity="0.3" strokeDasharray="2,2" />
                                <circle
                                  cx={curve.cutoffX}
                                  cy={curve.cutoffY}
                                  r="4"
                                  fill={param.accentColor || "#10b981"}
                                  stroke="#fff"
                                  strokeWidth="1"
                                  className={curve.cutoffParamId ? "cursor-ew-resize" : ""}
                                  onMouseDown={(e) => {
                                    if (isEditMode || !curve.cutoffParamId) return;
                                    e.stopPropagation();
                                    const bound = (e.currentTarget.closest("svg") as SVGSVGElement)?.getBoundingClientRect();
                                    if (!bound) return;
                                    const updateFreq = (clientX: number) => {
                                      const hz = xPixelToHz(clientX - bound.left, bound.width);
                                      handleParamValueChange(curve.cutoffParamId!, Math.round(Math.max(curve.cutoffParamMin!, Math.min(curve.cutoffParamMax!, hz))));
                                    };
                                    const onMove = (ev: MouseEvent) => updateFreq(ev.clientX);
                                    const onUp = () => {
                                      window.removeEventListener("mousemove", onMove);
                                      window.removeEventListener("mouseup", onUp);
                                    };
                                    window.addEventListener("mousemove", onMove);
                                    window.addEventListener("mouseup", onUp);
                                    updateFreq(e.clientX);
                                  }}
                                />
                              </svg>

                              <div className="absolute bottom-1 right-1 px-1 py-[1px] bg-black/60 rounded text-[7px] font-mono text-neutral-500">
                                {curve.isPlaceholder ? "Parametric Curve" : `${Math.round(curve.cutoffHz)} Hz`}
                              </div>
                            </div>
                          );
                        })()}

                        {type === "waveform" && (
                          <div 
                            className="w-full h-full relative bg-black/90 rounded-lg border border-neutral-850 overflow-hidden cursor-ew-resize flex flex-col justify-between p-1.5"
                            onMouseDown={(e) => {
                              if (isEditMode) return;
                              e.stopPropagation();
                              const bound = e.currentTarget.getBoundingClientRect();
                              const updateValue = (clientX: number) => {
                                const ratio = Math.max(0, Math.min(1, (clientX - bound.left) / bound.width));
                                const val = param.min + ratio * (param.max - param.min);
                                handleParamValueChange(param.id, parseFloat(val.toFixed(2)));
                              };
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                updateValue(moveEvent.clientX);
                              };
                              const onMouseUp = () => {
                                window.removeEventListener("mousemove", onMouseMove);
                                window.removeEventListener("mouseup", onMouseUp);
                              };
                              window.addEventListener("mousemove", onMouseMove);
                              window.addEventListener("mouseup", onMouseUp);
                              updateValue(e.clientX);
                            }}
                          >
                            <svg className="w-full h-full absolute inset-0 p-1 pointer-events-none">
                              <path
                                d={computeWaveformPath(param.value, w, h)}
                                fill="none"
                                stroke={param.accentColor || "#3b82f6"}
                                strokeWidth="2"
                                className="drop-shadow-[0_0_5px_rgba(59,130,246,0.6)]"
                              />
                            </svg>
                            <div className="flex justify-between items-center w-full mt-auto z-10">
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">
                                {waveShapeLabel(param.value)}
                              </span>
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">OSC LFO</span>
                            </div>
                          </div>
                        )}

                        {type === "pad" && (
                          <div 
                            className={`w-full h-full flex flex-col justify-center items-center rounded-xl border-2 transition-all duration-75 select-none ${
                              param.value > param.min 
                                ? "bg-indigo-500 border-indigo-400 text-white scale-95 shadow-[0_0_15px_rgba(99,102,241,0.8)]" 
                                : "bg-neutral-900 hover:bg-neutral-850 border-neutral-750 text-neutral-400"
                            }`}
                            style={{ 
                              borderColor: param.borderColor || undefined,
                              backgroundColor: param.bgColor || undefined
                            }}
                            onMouseDown={() => {
                              if (isEditMode) return;
                              handleParamValueChange(param.id, param.max);
                            }}
                            onMouseUp={() => {
                              if (isEditMode) return;
                              handleParamValueChange(param.id, param.min);
                            }}
                            onMouseLeave={() => {
                              if (isEditMode) return;
                              if (param.value > param.min) {
                                handleParamValueChange(param.id, param.min);
                              }
                            }}
                          >
                            <div className="w-10 h-10 border border-neutral-750/30 rounded-lg flex items-center justify-center bg-black/20 text-center text-xs font-black tracking-tighter uppercase">
                              PAD
                            </div>
                            <span className="text-[7px] font-mono font-bold uppercase mt-1 text-neutral-500">GATE PRESS</span>
                          </div>
                        )}

                        {type === "amp" && (() => {
                          const getTolexStyle = (pattern?: string) => {
                            if (pattern === "carbon") {
                              return {
                                backgroundImage: `linear-gradient(45deg, rgba(0,0,0,0.45) 25%, transparent 25%), 
                                                  linear-gradient(-45deg, rgba(0,0,0,0.45) 25%, transparent 25%), 
                                                  linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.45) 75%), 
                                                  linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.45) 75%)`,
                                backgroundSize: "6px 6px",
                                backgroundColor: param.bgColor || "#1c1c22"
                              };
                            }
                            if (pattern === "tweed") {
                              return {
                                backgroundImage: `linear-gradient(135deg, rgba(80,50,30,0.4) 25%, transparent 25%), 
                                                  linear-gradient(225deg, rgba(80,50,30,0.4) 25%, transparent 25%), 
                                                  linear-gradient(45deg, rgba(80,50,30,0.4) 25%, transparent 25%), 
                                                  linear-gradient(315deg, rgba(80,50,30,0.4) 25%, transparent 25%)`,
                                backgroundSize: "8px 8px",
                                backgroundColor: "#d2b48c"
                              };
                            }
                            if (pattern === "wood") {
                              return {
                                backgroundImage: `linear-gradient(180deg, rgba(40,20,5,0.22) 20%, transparent 20%, transparent 50%, rgba(40,20,5,0.28) 50%, rgba(40,20,5,0.28) 70%, transparent 70%)`,
                                backgroundSize: "100% 12px",
                                backgroundColor: "#5c3317"
                              };
                            }
                            if (pattern === "snakeskin") {
                              return {
                                backgroundImage: `radial-gradient(ellipse at center, rgba(30,40,30,0.4) 30%, transparent 35%)`,
                                backgroundSize: "8px 12px",
                                backgroundColor: "#445544"
                              };
                            }
                            if (pattern === "metalgrid") {
                              return {
                                backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px),
                                                  linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)`,
                                backgroundSize: "4px 4px",
                                backgroundColor: "#222"
                              };
                            }
                            // Default: leather
                            return {
                              backgroundImage: `radial-gradient(circle at 50% 50%, rgba(0,0,0,0.25) 1px, transparent 1px)`,
                              backgroundSize: "3px 3px",
                              backgroundColor: param.bgColor || "#1c1c22"
                            };
                          };

                          const tolexStyle = getTolexStyle(param.ampTolexPattern);

                          return (
                            <div 
                              style={{ 
                                ...tolexStyle,
                                borderColor: param.borderColor || "#3a3a45"
                              }}
                              className="w-full h-full rounded-xl border-[3px] shadow-2xl relative overflow-hidden flex flex-col justify-between p-2 select-none"
                            >
                              {/* Grill pattern overlay for metal style preset */}
                              {param.customStyle === "metal" && (
                                <div className="absolute inset-0 bg-[radial-gradient(#3a3a3a_1px,transparent_1px)] bg-[size:4px_4px] opacity-25 pointer-events-none" />
                              )}
                              {param.customStyle === "cyberpunk" && (
                                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,240,255,0.05)_50%,rgba(0,0,0,0.15)_50%)] bg-[size:100%_4px] opacity-30 pointer-events-none" />
                              )}

                              {/* Glowing physical vacuum tubes back plate */}
                              {param.ampTubeGlow && (
                                <div className="absolute top-[32px] left-[10%] right-[10%] h-8 bg-neutral-950/85 rounded border border-neutral-900/60 flex items-center justify-around px-2 overflow-hidden shadow-inner z-0">
                                  {[1, 2, 3, 4].map((tube) => (
                                    <div key={tube} className="w-2.5 h-6 bg-amber-500/10 rounded-t-full border border-amber-500/15 relative flex flex-col items-center justify-end">
                                      {/* Glowing filament */}
                                      <div className="w-[1.5px] h-3 bg-amber-500 rounded-t-full animate-pulse shadow-[0_0_8px_#f59e0b]" />
                                      {/* Base metal ring */}
                                      <div className="w-full h-1 bg-neutral-800 shrink-0" />
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                              {/* Branding Head logo */}
                              <div className="flex items-center justify-between border-b border-neutral-800/60 pb-1 shrink-0 z-10">
                                <span 
                                  style={{ 
                                    color: param.textColor || "#d4af37",
                                    fontFamily: getParamFontFamily(param.fontStyle)
                                  }}
                                  className="text-[10px] font-extrabold tracking-wider uppercase text-left truncate max-w-[55%]"
                                >
                                  {param.customText || "PLEXI 50W"}
                                </span>
                                <div className="flex gap-1 items-center max-w-[45%]">
                                  {/* Channel indicators */}
                                  <div className="flex gap-1 items-center bg-black/40 rounded px-1 py-0.5 border border-neutral-800/40 text-[5px] font-mono tracking-wider font-bold shrink-0 truncate">
                                    <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
                                    <span className="text-neutral-400 uppercase">{(param.ampChannelType || "crunch") === "crunch" ? "Plexi" : (param.ampChannelType || "crunch")}</span>
                                  </div>

                                  {/* Power lamp glow */}
                                  <span 
                                    style={{ 
                                      backgroundColor: param.accentColor || "#ef4444",
                                      boxShadow: `0 0 10px ${param.accentColor || "#ef4444"}`
                                    }}
                                    className="w-2.5 h-2.5 rounded-full shrink-0" 
                                  />
                                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-600 shrink-0" />
                                </div>
                              </div>
                              
                              {/* Knobs dials panel */}
                              <div 
                                style={{ 
                                  backgroundColor: 
                                    param.customStyle === "boutique" ? "#ecd3ab" : 
                                    param.customStyle === "sleek" ? "#f4f4f5" : 
                                    param.customStyle === "neon-dream" ? "#2f123d" : 
                                    param.customStyle === "gold-lux" ? "#121b2d" : 
                                    param.customStyle === "crimson-shred" ? "#1a0202" : 
                                    param.customStyle === "arctic-frost" ? "#e2e8f0" : 
                                    param.customStyle === "emerald-acid" ? "#0d180d" : 
                                    param.customStyle === "steampunk" ? "#2b1a11" : 
                                    "#25252d",
                                  borderColor: param.borderColor || "#1f1f23"
                                }}
                                className="flex-1 flex items-center justify-around gap-1 py-1.5 border rounded px-1 my-1 z-10"
                              >
                                {["GAIN", "BASS", "MID", "TREB", "PRES"].map((label, kid) => {
                                  const angleOffset = -135 + (param.value / 10) * 270;
                                  return (
                                    <div key={label} className="flex flex-col items-center">
                                      <div 
                                        className="w-7 h-7 relative cursor-ns-resize"
                                        onMouseDown={(e) => {
                                          if (isEditMode) return;
                                          e.stopPropagation();
                                          const startY = e.clientY;
                                          const startVal = param.value;
                                          const onMouseMove = (moveEvent: MouseEvent) => {
                                            const delta = (startY - moveEvent.clientY) * 0.1;
                                            const next = Math.max(0, Math.min(10, startVal + delta));
                                            handleParamValueChange(param.id, parseFloat(next.toFixed(1)));
                                          };
                                          const onMouseUp = () => {
                                            window.removeEventListener("mousemove", onMouseMove);
                                            window.removeEventListener("mouseup", onMouseUp);
                                          };
                                          window.addEventListener("mousemove", onMouseMove);
                                          window.addEventListener("mouseup", onMouseUp);
                                        }}
                                      >
                                        {/* Custom Knob Rendering */}
                                        {(() => {
                                          const knobStyle = param.ampKnobStyle || "pointer";
                                          if (knobStyle === "chickenhead") {
                                            return (
                                              <div 
                                                style={{ transform: `rotate(${angleOffset}deg)` }}
                                                className="w-7 h-7 relative flex items-center justify-center transition-transform"
                                              >
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-neutral-900 border border-black shadow-lg" />
                                                <div className="absolute bottom-[2px] w-2 h-3.5 bg-neutral-900 rounded-b-md shadow-md origin-top" />
                                                <div className="absolute top-[2px] w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[10px] border-b-neutral-100" />
                                                <div className="absolute top-[2px] w-[1px] h-3.5 bg-rose-600" />
                                              </div>
                                            );
                                          }
                                          if (knobStyle === "silvercap") {
                                            return (
                                              <div className="w-7 h-7 rounded-full bg-neutral-900 border border-neutral-950 relative shadow-md flex items-center justify-center">
                                                <div className="w-5.5 h-5.5 rounded-full bg-gradient-to-tr from-neutral-400 via-neutral-100 to-neutral-500 flex items-center justify-center shadow-inner relative">
                                                  <div 
                                                    style={{ transform: `rotate(${angleOffset}deg)` }}
                                                    className="absolute inset-0 flex justify-center"
                                                  >
                                                    <div className="w-[1.5px] h-1.5 bg-neutral-950 rounded-b-sm" />
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          }
                                          if (knobStyle === "neonring") {
                                            return (
                                              <div className="w-7 h-7 rounded-full bg-neutral-950 border border-neutral-900 relative shadow-md flex items-center justify-center">
                                                <svg className="absolute inset-0 w-full h-full -rotate-90">
                                                  <circle 
                                                    cx="14" cy="14" r="11" 
                                                    stroke="#171717" strokeWidth="1.5" fill="none" 
                                                  />
                                                  <circle 
                                                    cx="14" cy="14" r="11" 
                                                    stroke={param.accentColor || "#10b981"} strokeWidth="1.5" fill="none"
                                                    strokeDasharray="69"
                                                    strokeDashoffset={69 - (param.value / 10) * 69}
                                                    style={{ filter: `drop-shadow(0 0 2px ${param.accentColor || "#10b981"})` }}
                                                  />
                                                </svg>
                                                <div className="w-4 h-4 rounded-full bg-neutral-900 border border-neutral-800" />
                                              </div>
                                            );
                                          }
                                          if (knobStyle === "vintage") {
                                            return (
                                              <div className="w-7 h-7 rounded-full bg-gradient-to-b from-amber-900 to-amber-950 border border-neutral-900 relative shadow-md flex items-center justify-center">
                                                <div className="absolute inset-0.5 rounded-full border border-amber-800/20" />
                                                <div 
                                                  style={{ transform: `rotate(${angleOffset}deg)` }}
                                                  className="absolute inset-0 flex justify-center pt-0.5"
                                                >
                                                  <div className="w-0.5 h-1.5 bg-yellow-100 rounded-full" />
                                                </div>
                                              </div>
                                            );
                                          }
                                          // Classic Pointer (Default)
                                          return (
                                            <div className="w-7 h-7 rounded-full bg-gradient-to-b from-neutral-600 to-neutral-850 border border-neutral-900 relative cursor-ns-resize shadow-md flex items-center justify-center">
                                              <div 
                                                style={{ transform: `rotate(${angleOffset}deg)` }}
                                                className="absolute inset-0 flex justify-center pt-1"
                                              >
                                                <div 
                                                  style={{ backgroundColor: param.accentColor || "#d4af37" }}
                                                  className="w-[1.5px] h-2 rounded-full" 
                                                />
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                      <span 
                                        style={{ color: param.textColor ? param.textColor + "99" : "#a3a3a3" }}
                                        className="text-[6px] font-mono font-bold mt-1"
                                      >
                                        {label}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              
                              {/* Switches footer */}
                              <div 
                                style={{ color: param.textColor ? param.textColor + "cc" : "#737373" }}
                                className="flex items-center justify-between text-[6.5px] font-mono tracking-wider shrink-0 z-10"
                              >
                                <span>CLASS-A TUBE MODEL</span>
                                <div className="flex gap-1.5">
                                  <span className="px-1 bg-black/50 rounded text-[6px] text-emerald-400 font-bold border border-emerald-500/20">STANDBY</span>
                                  <span className="px-1 bg-black/50 rounded text-[6px] text-rose-500 font-bold border border-rose-500/20">POWERED</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {type === "cab" && (() => {
                          const activeIr = param.irFiles?.find(ir => ir.id === param.activeIrId);
                          // Speaker cones scale vibration on value change
                          const scaleVal = 1 + (param.value / 10) * 0.04;

                          const getGrillStyle = (pattern?: string) => {
                            if (pattern === "metalgrid") {
                              return {
                                backgroundImage: `radial-gradient(circle, rgba(0,0,0,0.65) 1.5px, transparent 1.5px)`,
                                backgroundSize: "5px 5px",
                              };
                            }
                            if (pattern === "stripes") {
                              return {
                                backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.55) 2px, transparent 2px)`,
                                backgroundSize: "6px 100%",
                              };
                            }
                            if (pattern === "pinstripe") {
                              return {
                                backgroundImage: `linear-gradient(45deg, rgba(0,0,0,0.4) 1px, transparent 1px), 
                                                  linear-gradient(-45deg, rgba(0,0,0,0.4) 1px, transparent 1px)`,
                                backgroundSize: "8px 8px",
                              };
                            }
                            if (pattern === "retro") {
                              return {
                                backgroundImage: `linear-gradient(135deg, rgba(212,175,55,0.12) 25%, transparent 25%), 
                                                  linear-gradient(225deg, rgba(212,175,55,0.12) 25%, transparent 25%),
                                                  linear-gradient(45deg, rgba(212,175,55,0.12) 25%, transparent 25%), 
                                                  linear-gradient(315deg, rgba(212,175,55,0.12) 25%, transparent 25%)`,
                                backgroundSize: "12px 12px",
                              };
                            }
                            // Default: weave wicker
                            return {
                              backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.3) 1px, transparent 1px), 
                                                linear-gradient(rgba(0,0,0,0.3) 1px, transparent 1px)`,
                              backgroundSize: "3px 3px",
                            };
                          };

                          const grillStyle = getGrillStyle(param.cabGrillStyle);

                          // Speaker layout variables
                          const speakerSize = param.cabSize || "4x12";
                          let speakerConesCount = 4;
                          let gridColsClass = "grid-cols-2 gap-2";
                          let coneSizeClass = "w-11 h-11";

                          if (speakerSize === "1x12") {
                            speakerConesCount = 1;
                            gridColsClass = "grid-cols-1 flex items-center justify-center";
                            coneSizeClass = "w-20 h-20";
                          } else if (speakerSize === "2x12") {
                            speakerConesCount = 2;
                            gridColsClass = "grid-cols-2 gap-4 flex items-center justify-center";
                            coneSizeClass = "w-14 h-14";
                          } else if (speakerSize === "8x10") {
                            speakerConesCount = 8;
                            gridColsClass = "grid-cols-4 gap-1 p-0.5";
                            coneSizeClass = "w-7 h-7";
                          }

                          return (
                            <div 
                              style={{ 
                                backgroundColor: param.bgColor || "#16161a",
                                borderColor: param.borderColor || "#2c2c36"
                              }}
                              className="w-full h-full rounded-2xl border-[5px] shadow-2xl relative overflow-hidden flex flex-col justify-between p-2 select-none"
                            >
                              {/* Custom Grill cloth texture overlay */}
                              <div style={grillStyle} className="absolute inset-0 pointer-events-none opacity-80" />

                              {/* Additional style preset texture overlays */}
                              {param.customStyle === "vintage" && (
                                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(212,175,55,0.08)_1px,transparent_1px),linear-gradient(rgba(212,175,55,0.08)_1px,transparent_1px)] bg-[size:4px_4px] pointer-events-none opacity-60" />
                              )}
                              {param.customStyle === "metal" && (
                                <div className="absolute inset-0 bg-[radial-gradient(#262626_1.5px,transparent_1.5px)] bg-[size:5px_5px] pointer-events-none opacity-70" />
                              )}
                              {param.customStyle === "cyberpunk" && (
                                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,240,255,0.04)_2px,transparent_2px),linear-gradient(rgba(234,0,217,0.04)_2px,transparent_2px)] bg-[size:8px_8px] pointer-events-none opacity-90" />
                              )}
                              {param.customStyle === "boutique" && (
                                <div className="absolute inset-0 bg-[linear-gradient(45deg,#3f291b_25%,transparent_25%),linear-gradient(-45deg,#3f291b_25%,transparent_25%)] bg-[size:6px_6px] pointer-events-none opacity-15" />
                              )}
                              {param.customStyle === "neon-dream" && (
                                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(234,0,217,0.15)_25%,transparent_25%),linear-gradient(225deg,rgba(0,240,255,0.15)_25%,transparent_25%)] bg-[size:10px_10px] pointer-events-none opacity-40" />
                              )}
                              {param.customStyle === "gold-lux" && (
                                <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(212,175,55,0.05)_25%,transparent_25%)] bg-[size:8px_8px] pointer-events-none opacity-50" />
                              )}
                              {param.customStyle === "crimson-shred" && (
                                <div className="absolute inset-0 bg-[radial-gradient(rgba(220,38,38,0.15)_1.5px,transparent_1.5px)] bg-[size:6px_6px] pointer-events-none opacity-60" />
                              )}
                              {param.customStyle === "arctic-frost" && (
                                <div className="absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.08)_50%,transparent_50%)] bg-[size:100%_6px] pointer-events-none opacity-50" />
                              )}
                              {param.customStyle === "emerald-acid" && (
                                <div className="absolute inset-0 bg-[radial-gradient(rgba(34,197,94,0.1)_1px,transparent_1px)] bg-[size:3px_3px] pointer-events-none opacity-50" />
                              )}
                              {param.customStyle === "steampunk" && (
                                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(180,83,9,0.1)_1px,transparent_1px)] bg-[size:6px_100%] pointer-events-none opacity-50" />
                              )}
                              
                              {/* Speakers Circle Matrix based on cabinet configuration */}
                              <div className={`flex-1 grid ${gridColsClass} p-1 relative z-10`}>
                                {Array.from({ length: speakerConesCount }).map((_, cid) => (
                                  <div 
                                    key={cid} 
                                    style={{ 
                                      transform: `scale(${scaleVal})`,
                                      transition: "transform 100ms ease-out"
                                    }}
                                    className={`${coneSizeClass} rounded-full border-[3px] border-black bg-gradient-to-b from-neutral-800 to-black relative flex items-center justify-center overflow-hidden shadow-inner shrink-0`}
                                  >
                                    {/* Inner speaker cone cap with glow accent */}
                                    <div 
                                      style={{ 
                                        borderColor: param.accentColor || "#3e3e4a",
                                        boxShadow: param.customStyle === "cyberpunk" ? `0 0 12px ${param.accentColor || "#ea00d9"}` : undefined
                                      }}
                                      className="w-1/2 h-1/2 rounded-full bg-neutral-900 border flex items-center justify-center"
                                    >
                                      <div className="w-1/3 h-1/3 rounded-full bg-neutral-950 border border-neutral-700 shadow-md" />
                                    </div>
                                    <div className="absolute inset-1 rounded-full border border-neutral-850/20 border-dashed" />
                                  </div>
                                ))}
                              </div>
                              
                              {/* Brass branding badge overlay */}
                              <div 
                                style={{ 
                                  backgroundColor: "#000000eb",
                                  borderColor: param.textColor || "#d4af37"
                                }}
                                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border px-3 py-1 rounded-md shadow-2xl z-20 text-center min-w-[120px]"
                              >
                                <p 
                                  style={{ 
                                    color: param.textColor || "#d4af37",
                                    fontFamily: getParamFontFamily(param.fontStyle)
                                  }}
                                  className="text-[9px] font-bold uppercase tracking-wide select-none leading-none truncate"
                                >
                                  {param.customText || "CELESTION 1960A"}
                                </p>
                                <span 
                                  style={{ color: param.textColor ? param.textColor + "aa" : "#737373" }}
                                  className="text-[5.5px] font-mono tracking-wider leading-none block mt-1 truncate"
                                >
                                  {activeIr ? `IR: ${activeIr.name}` : `${speakerSize.toUpperCase()} VINTAGE CAB`}
                                </span>
                              </div>

                              {/* Virtual Microphones Overlay */}
                              <div className="absolute bottom-1 right-2 bg-neutral-950/90 border border-neutral-850/60 rounded px-1.5 py-0.5 flex items-center gap-1 shadow-md z-20 font-mono text-[5.5px] font-black text-neutral-400">
                                <span className="text-indigo-400 text-[6.5px]">🎙️</span>
                                <span>MIC: {param.cabMicModel || "SM57"}</span>
                              </div>
                            </div>
                          );
                        })()}

                        {type === "mic" && (
                          <div 
                            className="w-full h-full relative bg-[#1c1c22] rounded-xl border border-neutral-800 overflow-hidden flex flex-col justify-between p-1.5 select-none"
                            onMouseDown={(e) => {
                              if (isEditMode) return;
                              e.stopPropagation();
                              const bound = e.currentTarget.getBoundingClientRect();
                              const updatePosition = (clientX: number, clientY: number) => {
                                const rx = Math.max(0, Math.min(100, Math.round(((clientX - bound.left) / bound.width) * 100)));
                                const ry = Math.max(0, Math.min(100, Math.round(((clientY - bound.top) / bound.height) * 100)));
                                updateParamFields(param.id, { 
                                  valX: rx, 
                                  valY: ry, 
                                  value: parseFloat((param.min + (rx / 100) * (param.max - param.min)).toFixed(1))
                                });
                              };
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                updatePosition(moveEvent.clientX, moveEvent.clientY);
                              };
                              const onMouseUp = () => {
                                window.removeEventListener("mousemove", onMouseMove);
                                window.removeEventListener("mouseup", onMouseUp);
                              };
                              window.addEventListener("mousemove", onMouseMove);
                              window.addEventListener("mouseup", onMouseUp);
                              updatePosition(e.clientX, e.clientY);
                            }}
                          >
                            {/* Speaker concentric targets circles backing */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-[85%] h-[85%] rounded-full border border-dashed border-neutral-700 flex items-center justify-center">
                                  <div className="w-[60%] h-[60%] rounded-full border border-solid border-neutral-700 flex items-center justify-center">
                                    <div className="w-[30%] h-[30%] rounded-full border border-neutral-600 bg-neutral-900/40" />
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Coordinate crosshairs */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-25 pointer-events-none">
                              <div className="h-full border-l border-neutral-700 border-dotted" />
                              <div className="absolute w-full border-b border-neutral-700 border-dotted" />
                            </div>

                            {/* Floating Vector Microphone pointer icon */}
                            {(() => {
                              const micX = (param.valX ?? 35);
                              const micY = (param.valY ?? 50);
                              return (
                                <div 
                                  style={{ left: `calc(${micX}% - 10px)`, top: `calc(${micY}% - 10px)` }}
                                  className="absolute w-5 h-5 rounded-full bg-[#ef4444] border-2 border-white flex items-center justify-center shadow-lg transition-all z-30 pointer-events-none"
                                >
                                  {/* Small Mic capsule svg shape */}
                                  <div className="w-1.5 h-3 bg-neutral-300 rounded-[1px] border border-black" />
                                </div>
                              );
                            })()}
                            
                            <div className="flex justify-between items-center w-full z-10 pointer-events-none mt-auto">
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">
                                Dist: {param.valX ?? 35}%
                              </span>
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">
                                Off-Axis: {param.valY ?? 50}%
                              </span>
                            </div>
                          </div>
                        )}

                        {type === "mic_stand" && (
                          <div 
                            className="w-full h-full relative bg-neutral-950 rounded-xl border border-neutral-850 flex flex-col justify-between p-2 select-none"
                            onMouseDown={(e) => {
                              if (isEditMode) return;
                              e.stopPropagation();
                              const bound = e.currentTarget.getBoundingClientRect();
                              const updateValue = (clientY: number) => {
                                const ratio = 1 - Math.max(0, Math.min(1, (clientY - bound.top) / bound.height));
                                const val = param.min + ratio * (param.max - param.min);
                                handleParamValueChange(param.id, parseFloat(val.toFixed(1)));
                              };
                              const onMouseMove = (moveEvent: MouseEvent) => {
                                updateValue(moveEvent.clientY);
                              };
                              const onMouseUp = () => {
                                window.removeEventListener("mousemove", onMouseMove);
                                window.removeEventListener("mouseup", onMouseUp);
                              };
                              window.addEventListener("mousemove", onMouseMove);
                              window.addEventListener("mouseup", onMouseUp);
                              updateValue(e.clientY);
                            }}
                          >
                            {/* Boom Stand Vector Drawing */}
                            <div className="flex-1 w-full flex items-center justify-center relative">
                              <svg className="w-full h-full absolute inset-0 pointer-events-none">
                                {/* Base tripod legs */}
                                <path d={`M ${w/2 - 20},${h - 15} L ${w/2 + 20},${h - 15} M ${w/2},${h - 30} L ${w/2},${h - 15}`} stroke="#666" strokeWidth="2" strokeLinecap="round" />
                                {/* Telescopic riser pole */}
                                <line x1={w/2} y1={h - 30} x2={w/2} y2={h/2 + 10} stroke="#999" strokeWidth="3" />
                                {/* Joint coupler */}
                                <circle cx={w/2} cy={h/2 + 10} r="4" fill="#333" />
                                {/* Boom pole tilted depending on param.value */}
                                {(() => {
                                  const rad = ((param.value || 45) * Math.PI) / 180;
                                  const bx1 = w/2 - Math.cos(rad) * 35;
                                  const by1 = h/2 + 10 - Math.sin(rad) * 35;
                                  const bx2 = w/2 + Math.cos(rad) * 35;
                                  const by2 = h/2 + 10 + Math.sin(rad) * 35;
                                  return (
                                    <>
                                      <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke="#888" strokeWidth="2.5" />
                                      {/* Counter-weight */}
                                      <circle cx={bx1} cy={by1} r="5" fill="#444" />
                                      {/* Suspension Shock mount */}
                                      <circle cx={bx2} cy={by2} r="12" fill="none" stroke="#ef4444" strokeWidth="1.5" />
                                      {/* Micro capsule centered inside shockmount */}
                                      <rect x={bx2 - 4} y={by2 - 10} width={8} height={20} rx={2} fill="#bbb" stroke="#333" strokeWidth="1" />
                                      <rect x={bx2 - 3.5} y={by2 - 9.5} width={7} height={8} fill="#333" />
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>
                            
                            <div className="flex justify-between items-center w-full z-10">
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">ANGLE: {Math.round(param.value)}°</span>
                              <span className="text-[7.5px] font-mono text-neutral-500 uppercase">U87 BOOM</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Figma Absolute Resize Anchors overlay */}
                      {isSelected && isEditMode && (
                        <>
                          {/* Corner Blue Squares */}
                          <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-indigo-600 border border-white rounded shadow-sm cursor-nwse-resize z-50" />
                          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-indigo-600 border border-white rounded shadow-sm cursor-nesw-resize z-50" />
                          <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-indigo-600 border border-white rounded shadow-sm cursor-nesw-resize z-50" />
                          <div 
                            onMouseDown={(e) => handleResizeMouseDown(e, param)}
                            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-indigo-600 border border-white rounded shadow-sm cursor-nwse-resize z-50 hover:bg-emerald-500 hover:scale-125 transition-transform"
                            title="Drag blue anchor to resize widget"
                          />
                          {/* Position coordinates tooltip inside widget */}
                          <div className="absolute -top-7 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white font-mono text-[8px] px-1 py-0.5 rounded shadow z-50 pointer-events-none whitespace-nowrap">
                            W:{Math.round(w)}px H:{Math.round(h)}px
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* FLOATING RIGHT-CLICK CONTEXT MENU */}
                {activeContextMenu && (() => {
                  const param = plugin.parameters.find(p => p.id === activeContextMenu.paramId);
                  if (!param) return null;
                  
                  // Style presets applying specific look to parameter
                  const applyStylePreset = (presetName: string) => {
                    let fields: Partial<PluginParameter> = { customStyle: presetName };
                    
                    if (presetName === "vintage") {
                      fields.bgColor = "#efebe1";
                      fields.borderColor = "#8c7456";
                      fields.textColor = "#3e3427";
                      fields.accentColor = "#b8860b";
                      fields.fontStyle = "serif";
                      fields.ampTolexPattern = "tweed";
                      fields.ampKnobStyle = "vintage";
                      fields.cabGrillStyle = "retro";
                    } else if (presetName === "metal") {
                      fields.bgColor = "#1c1d21";
                      fields.borderColor = "#4a4e5d";
                      fields.textColor = "#e2e8f0";
                      fields.accentColor = "#f97316";
                      fields.fontStyle = "sans";
                      fields.ampTolexPattern = "carbon";
                      fields.ampKnobStyle = "silvercap";
                      fields.cabGrillStyle = "metalgrid";
                    } else if (presetName === "cyberpunk") {
                      fields.bgColor = "#0a000f";
                      fields.borderColor = "#ea00d9";
                      fields.textColor = "#00f0ff";
                      fields.accentColor = "#ea00d9";
                      fields.fontStyle = "orbitron";
                      fields.ampTolexPattern = "metalgrid";
                      fields.ampKnobStyle = "neonring";
                      fields.cabGrillStyle = "stripes";
                    } else if (presetName === "sleek") {
                      fields.bgColor = "#18181b";
                      fields.borderColor = "#3f3f46";
                      fields.textColor = "#f4f4f5";
                      fields.accentColor = "#10b981";
                      fields.fontStyle = "sans";
                      fields.ampTolexPattern = "leather";
                      fields.ampKnobStyle = "pointer";
                      fields.cabGrillStyle = "pinstripe";
                    } else if (presetName === "boutique") {
                      fields.bgColor = "#2c1a11";
                      fields.borderColor = "#9a3412";
                      fields.textColor = "#fed7aa";
                      fields.accentColor = "#f97316";
                      fields.fontStyle = "grotesk";
                      fields.ampTolexPattern = "wood";
                      fields.ampKnobStyle = "chickenhead";
                      fields.cabGrillStyle = "weave";
                    } else if (presetName === "neon-dream") {
                      fields.bgColor = "#1a0826";
                      fields.borderColor = "#ff007f";
                      fields.textColor = "#00f0ff";
                      fields.accentColor = "#ff007f";
                      fields.fontStyle = "orbitron";
                      fields.ampTolexPattern = "snakeskin";
                      fields.ampKnobStyle = "neonring";
                      fields.cabGrillStyle = "stripes";
                    } else if (presetName === "gold-lux") {
                      fields.bgColor = "#0a0f1d";
                      fields.borderColor = "#d4af37";
                      fields.textColor = "#f3e5ab";
                      fields.accentColor = "#ffbf00";
                      fields.fontStyle = "serif";
                      fields.ampTolexPattern = "tweed";
                      fields.ampKnobStyle = "vintage";
                      fields.cabGrillStyle = "weave";
                    } else if (presetName === "crimson-shred") {
                      fields.bgColor = "#0d0d0d";
                      fields.borderColor = "#dc2626";
                      fields.textColor = "#f97316";
                      fields.accentColor = "#ef4444";
                      fields.fontStyle = "sans";
                      fields.ampTolexPattern = "carbon";
                      fields.ampKnobStyle = "silvercap";
                      fields.cabGrillStyle = "metalgrid";
                    } else if (presetName === "arctic-frost") {
                      fields.bgColor = "#f0f4f8";
                      fields.borderColor = "#cbd5e1";
                      fields.textColor = "#1e293b";
                      fields.accentColor = "#38bdf8";
                      fields.fontStyle = "sans";
                      fields.ampTolexPattern = "metalgrid";
                      fields.ampKnobStyle = "pointer";
                      fields.cabGrillStyle = "pinstripe";
                    } else if (presetName === "emerald-acid") {
                      fields.bgColor = "#101510";
                      fields.borderColor = "#22c55e";
                      fields.textColor = "#4ade80";
                      fields.accentColor = "#15803d";
                      fields.fontStyle = "orbitron";
                      fields.ampTolexPattern = "snakeskin";
                      fields.ampKnobStyle = "neonring";
                      fields.cabGrillStyle = "metalgrid";
                    } else if (presetName === "steampunk") {
                      fields.bgColor = "#201510";
                      fields.borderColor = "#b45309";
                      fields.textColor = "#fbbf24";
                      fields.accentColor = "#ca8a04";
                      fields.fontStyle = "serif";
                      fields.ampTolexPattern = "wood";
                      fields.ampKnobStyle = "vintage";
                      fields.cabGrillStyle = "retro";
                    }
                    
                    updateParamFields(param.id, fields);
                    triggerToast(`Applied '${presetName.toUpperCase()}' look!`);
                  };

                  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = () => {
                      const base64Data = reader.result as string;
                      const newIr = {
                        id: "ir_" + Date.now(),
                        name: file.name,
                        size: (file.size / 1024).toFixed(1) + " KB",
                        data: base64Data
                      };
                      
                      const existingIrs = param.irFiles || [];
                      const updatedIrs = [...existingIrs, newIr];
                      
                      updateParamFields(param.id, {
                        irFiles: updatedIrs,
                        activeIrId: newIr.id
                      });
                      triggerToast(`Successfully loaded Impulse Response: ${file.name}`);
                    };
                    reader.readAsDataURL(file);
                  };

                  const deleteIrFile = (irId: string) => {
                    const existingIrs = param.irFiles || [];
                    const updatedIrs = existingIrs.filter(ir => ir.id !== irId);
                    const nextActiveId = param.activeIrId === irId 
                      ? (updatedIrs[0]?.id || undefined) 
                      : param.activeIrId;
                    
                    updateParamFields(param.id, {
                      irFiles: updatedIrs,
                      activeIrId: nextActiveId
                    });
                    triggerToast("Deleted Impulse Response file.");
                  };

                  // To avoid the menu running out of screen bounds:
                  const menuWidth = 310;
                  const menuHeight = activeContextMenu.type === "cab" ? 380 : 340;
                  
                  let menuX = activeContextMenu.x;
                  let menuY = activeContextMenu.y;
                  
                  if (menuX + menuWidth > artboardWidth) {
                    menuX = Math.max(10, artboardWidth - menuWidth - 15);
                  }
                  if (menuY + menuHeight > artboardHeight) {
                    menuY = Math.max(10, artboardHeight - menuHeight - 15);
                  }

                  return (
                    <div 
                      id="custom-context-menu"
                      style={{ 
                        left: `${menuX}px`, 
                        top: `${menuY}px`,
                        width: `${menuWidth}px`
                      }}
                      className="absolute z-50 bg-neutral-950/98 border border-neutral-800 rounded-xl shadow-2xl p-3.5 text-xs text-neutral-300 backdrop-blur-lg flex flex-col gap-3.5 select-none text-left"
                    >
                      {/* Header title */}
                      <div className="flex items-center justify-between border-b border-neutral-850 pb-2 shrink-0">
                        <span className="font-bold font-mono text-indigo-400 tracking-wider flex items-center gap-1.5 uppercase text-[10px]">
                          🛡️ {activeContextMenu.type === "amp" ? "AMP HEAD WORKSHOP" : "CABINET CUSTOMIZER"}
                        </span>
                        <button 
                          onClick={() => setActiveContextMenu(null)}
                          className="text-neutral-500 hover:text-white hover:bg-neutral-800 rounded p-0.5 text-[11px]"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Tab switching bar */}
                      <div className="flex border-b border-neutral-900 gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setContextMenuTab("visuals")}
                          className={`flex-1 pb-1.5 text-[9px] font-bold tracking-wider uppercase border-b-2 text-center transition-all cursor-pointer ${
                            contextMenuTab === "visuals" 
                              ? "border-indigo-500 text-indigo-400 font-black"
                              : "border-transparent text-neutral-500 hover:text-neutral-350"
                          }`}
                        >
                          Visuals
                        </button>
                        <button
                          type="button"
                          onClick={() => setContextMenuTab("hardware")}
                          className={`flex-1 pb-1.5 text-[9px] font-bold tracking-wider uppercase border-b-2 text-center transition-all cursor-pointer ${
                            contextMenuTab === "hardware" 
                              ? "border-indigo-500 text-indigo-400 font-black"
                              : "border-transparent text-neutral-500 hover:text-neutral-350"
                          }`}
                        >
                          Hardware
                        </button>
                        {activeContextMenu.type === "cab" && (
                          <button
                            type="button"
                            onClick={() => setContextMenuTab("irs")}
                            className={`flex-1 pb-1.5 text-[9px] font-bold tracking-wider uppercase border-b-2 text-center transition-all cursor-pointer ${
                              contextMenuTab === "irs" 
                                ? "border-indigo-500 text-indigo-400 font-black"
                                : "border-transparent text-neutral-500 hover:text-neutral-350"
                            }`}
                          >
                            IR Loader
                          </button>
                        )}
                      </div>

                      {/* Content panel based on Tab */}
                      <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-0.5 scrollbar-thin">
                        
                        {/* Tab 1: Visual Styles */}
                        {contextMenuTab === "visuals" && (
                          <>
                            {/* Presets Grid */}
                            <div>
                              <p className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider mb-1.5 font-mono">Select Style Preset</p>
                              <div className="grid grid-cols-4 gap-1">
                                {[
                                  "vintage", "metal", "cyberpunk", "sleek", "boutique", 
                                  "neon-dream", "gold-lux", "crimson-shred", "arctic-frost", 
                                  "emerald-acid", "steampunk"
                                ].map((st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => applyStylePreset(st)}
                                    title={st.toUpperCase()}
                                    className={`py-1 px-0.5 rounded text-[7px] border uppercase font-mono transition-all font-bold cursor-pointer truncate ${
                                      param.customStyle === st 
                                        ? "bg-indigo-600/30 border-indigo-500 text-indigo-300 shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                                        : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white hover:bg-neutral-800"
                                    }`}
                                  >
                                    {st.replace("-", " ")}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Custom brand text */}
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Custom Brand Label</label>
                              <input 
                                type="text"
                                value={param.customText || ""}
                                placeholder={activeContextMenu.type === "amp" ? "PLEXI 50W" : "CELESTION 1960A"}
                                onChange={(e) => updateParamFields(param.id, { customText: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-850 rounded px-2.5 py-1.5 text-neutral-200 outline-none focus:border-indigo-500 transition-colors text-xs font-mono"
                              />
                            </div>

                            {/* Font selector */}
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Typography Font</label>
                              <div className="grid grid-cols-5 gap-1">
                                {["sans", "serif", "mono", "grotesk", "orbitron"].map((fn) => (
                                  <button
                                    key={fn}
                                    type="button"
                                    onClick={() => updateParamFields(param.id, { fontStyle: fn as any })}
                                    className={`py-1 rounded text-[8px] uppercase font-mono font-bold border transition cursor-pointer ${
                                      (param.fontStyle || "serif") === fn
                                        ? "bg-indigo-600/20 border-indigo-500 text-white"
                                        : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white"
                                    }`}
                                  >
                                    {fn}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Custom colors */}
                            <div>
                              <p className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono mb-1.5">Custom Colors</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-850 rounded p-1">
                                  <input 
                                    type="color"
                                    value={param.bgColor || (activeContextMenu.type === "amp" ? "#1c1c22" : "#16161a")}
                                    onChange={(e) => updateParamFields(param.id, { bgColor: e.target.value })}
                                    className="w-5 h-5 bg-transparent border-0 cursor-pointer outline-none"
                                  />
                                  <span className="text-[9px] text-neutral-400 font-mono">Faceplate</span>
                                </div>

                                <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-850 rounded p-1">
                                  <input 
                                    type="color"
                                    value={param.borderColor || (activeContextMenu.type === "amp" ? "#3a3a45" : "#2c2c36")}
                                    onChange={(e) => updateParamFields(param.id, { borderColor: e.target.value })}
                                    className="w-5 h-5 bg-transparent border-0 cursor-pointer outline-none"
                                  />
                                  <span className="text-[9px] text-neutral-400 font-mono">Border</span>
                                </div>

                                <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-850 rounded p-1">
                                  <input 
                                    type="color"
                                    value={param.textColor || "#d4af37"}
                                    onChange={(e) => updateParamFields(param.id, { textColor: e.target.value })}
                                    className="w-5 h-5 bg-transparent border-0 cursor-pointer outline-none"
                                  />
                                  <span className="text-[9px] text-neutral-400 font-mono">Text/Label</span>
                                </div>

                                <div className="flex items-center gap-1.5 bg-neutral-900 border border-neutral-850 rounded p-1">
                                  <input 
                                    type="color"
                                    value={param.accentColor || (activeContextMenu.type === "amp" ? "#ef4444" : "#10b981")}
                                    onChange={(e) => updateParamFields(param.id, { accentColor: e.target.value })}
                                    className="w-5 h-5 bg-transparent border-0 cursor-pointer outline-none"
                                  />
                                  <span className="text-[9px] text-neutral-400 font-mono">Accent</span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        {/* Tab 2: Hardware Customization */}
                        {contextMenuTab === "hardware" && (
                          <div className="flex flex-col gap-3">
                            {/* AMP HEAD hardware settings */}
                            {activeContextMenu.type === "amp" && (
                              <>
                                {/* Tolex Pattern Selection */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Cabinet Tolex Wrap Pattern</label>
                                  <div className="grid grid-cols-3 gap-1">
                                    {[
                                      { id: "leather", label: "🐄 Leather" },
                                      { id: "carbon", label: "🧶 Carbon" },
                                      { id: "tweed", label: "🧺 Tweed" },
                                      { id: "wood", label: "🪵 Wood" },
                                      { id: "snakeskin", label: "🐍 Reptile" },
                                      { id: "metalgrid", label: "⚙️ Steel" }
                                    ].map((tx) => (
                                      <button
                                        key={tx.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { ampTolexPattern: tx.id as any })}
                                        className={`py-1.5 rounded text-[8.5px] border font-mono font-semibold transition cursor-pointer text-center ${
                                          (param.ampTolexPattern || "leather") === tx.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {tx.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Knob Design Selection */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Rotary Knob Style</label>
                                  <div className="grid grid-cols-2 gap-1">
                                    {[
                                      { id: "chickenhead", label: "🐓 Chicken Head" },
                                      { id: "silvercap", label: "⚪ Silver-cap Dome" },
                                      { id: "pointer", label: "🔻 Classic Pointer" },
                                      { id: "neonring", label: "⭕ Neon Ring Dial" },
                                      { id: "vintage", label: "📀 Amber Radio" }
                                    ].map((kn) => (
                                      <button
                                        key={kn.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { ampKnobStyle: kn.id as any })}
                                        className={`py-1.5 rounded text-[8px] border font-mono font-semibold transition cursor-pointer text-left px-2 ${
                                          (param.ampKnobStyle || "pointer") === kn.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {kn.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Preamp Channel Tone Circuitry */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Preamp Channel Circuit</label>
                                  <div className="grid grid-cols-4 gap-1">
                                    {[
                                      { id: "clean", label: "Clean" },
                                      { id: "crunch", label: "Plexi" },
                                      { id: "lead", label: "Lead" },
                                      { id: "modern", label: "Insane" }
                                    ].map((ch) => (
                                      <button
                                        key={ch.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { ampChannelType: ch.id as any })}
                                        className={`py-1 rounded text-[8px] border font-mono font-semibold transition cursor-pointer ${
                                          (param.ampChannelType || "crunch") === ch.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {ch.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Glowing tubes switch toggle */}
                                <div className="flex items-center justify-between bg-neutral-900 border border-neutral-850 rounded p-2 mt-0.5">
                                  <div className="flex flex-col text-left">
                                    <span className="text-[9px] uppercase font-mono font-bold text-neutral-400">Vacuum Tube Glow</span>
                                    <span className="text-[7.5px] font-mono text-neutral-500">Render physical 12AX7 filaments</span>
                                  </div>
                                  <input 
                                    type="checkbox"
                                    checked={param.ampTubeGlow || false}
                                    onChange={(e) => updateParamFields(param.id, { ampTubeGlow: e.target.checked })}
                                    className="w-4 h-4 rounded border-neutral-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer bg-neutral-950"
                                  />
                                </div>
                              </>
                            )}

                            {/* CABINET hardware settings */}
                            {activeContextMenu.type === "cab" && (
                              <>
                                {/* Grill style selection */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Grill Cloth Mesh Style</label>
                                  <div className="grid grid-cols-3 gap-1">
                                    {[
                                      { id: "weave", label: "🧺 Weave" },
                                      { id: "metalgrid", label: "⚙️ Metal" },
                                      { id: "stripes", label: "➖ Stripes" },
                                      { id: "pinstripe", label: "💈 Pin" },
                                      { id: "retro", label: "💎 Retro" }
                                    ].map((gr) => (
                                      <button
                                        key={gr.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { cabGrillStyle: gr.id as any })}
                                        className={`py-1 rounded text-[8.5px] border font-mono font-semibold transition cursor-pointer ${
                                          (param.cabGrillStyle || "weave") === gr.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {gr.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Speaker configuration (Cabinet Size) */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Cabinet Speaker Configuration</label>
                                  <div className="grid grid-cols-4 gap-1">
                                    {[
                                      { id: "1x12", label: "1x12 Solo" },
                                      { id: "2x12", label: "2x12 Duo" },
                                      { id: "4x12", label: "4x12 Stack" },
                                      { id: "8x10", label: "8x10 Beast" }
                                    ].map((sz) => (
                                      <button
                                        key={sz.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { cabSize: sz.id as any })}
                                        className={`py-1 rounded text-[8px] border font-mono font-semibold transition cursor-pointer ${
                                          (param.cabSize || "4x12") === sz.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {sz.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Virtual Microphone Selection */}
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-[9px] uppercase font-bold text-neutral-500 tracking-wider font-mono">Virtual Microphone Model</label>
                                  <div className="grid grid-cols-4 gap-1">
                                    {[
                                      { id: "SM57", label: "SM57" },
                                      { id: "R-121", label: "R-121" },
                                      { id: "MD421", label: "MD421" },
                                      { id: "C414", label: "C414" }
                                    ].map((mc) => (
                                      <button
                                        key={mc.id}
                                        type="button"
                                        onClick={() => updateParamFields(param.id, { cabMicModel: mc.id as any })}
                                        className={`py-1 rounded text-[8.5px] border font-mono font-semibold transition cursor-pointer ${
                                          (param.cabMicModel || "SM57") === mc.id
                                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                                            : "bg-neutral-900 border-neutral-850 text-neutral-400 hover:text-white"
                                        }`}
                                      >
                                        {mc.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Tab 3: IR Impulse Responses Loader */}
                        {contextMenuTab === "irs" && activeContextMenu.type === "cab" && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider font-mono">Cabinet Impulse Response (IR)</span>
                              <span className="text-[8px] font-mono bg-indigo-950 text-indigo-400 px-1 py-0.5 rounded font-bold">MULTIPLE IR</span>
                            </div>
                            
                            {/* Upload trigger box */}
                            <label className="flex flex-col items-center justify-center p-2 border border-dashed border-neutral-800 hover:border-indigo-500 hover:bg-indigo-950/10 rounded-lg cursor-pointer transition text-center group">
                              <input 
                                type="file" 
                                accept=".wav,.ir,.txt" 
                                onChange={handleFileUpload} 
                                className="hidden" 
                              />
                              <span className="text-[9px] font-bold text-indigo-400 flex items-center gap-1 group-hover:scale-105 transition-transform">
                                📤 LOAD IMPULSE RESPONSE (.wav)
                              </span>
                              <span className="text-[7.5px] text-neutral-500 mt-0.5 block">Drag/click to load response curves</span>
                            </label>

                            {/* List of currently uploaded IRs */}
                            {param.irFiles && param.irFiles.length > 0 ? (
                              <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto pr-1 bg-black/45 p-1.5 rounded-lg border border-neutral-900">
                                {param.irFiles.map((ir) => {
                                  const isActive = param.activeIrId === ir.id;
                                  return (
                                    <div 
                                      key={ir.id}
                                      onClick={() => updateParamFields(param.id, { activeIrId: ir.id })}
                                      className={`flex items-center justify-between p-1 rounded group/item cursor-pointer border ${
                                        isActive 
                                          ? "bg-indigo-950/40 border-indigo-800/80 text-white" 
                                          : "bg-transparent border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 truncate max-w-[85%] text-left">
                                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500 shadow-[0_0_4px_#10b981]" : "bg-neutral-700"}`} />
                                        <span className="truncate text-[8.5px] font-mono leading-none">{ir.name}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[7px] text-neutral-600 font-mono shrink-0">{ir.size}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            deleteIrFile(ir.id);
                                          }}
                                          className="opacity-0 group-hover/item:opacity-100 hover:text-rose-500 p-0.5 rounded transition shrink-0 cursor-pointer"
                                          title="Delete IR"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-center py-2 text-[8px] text-neutral-600 italic">
                                No custom IRs loaded. Using default Celestion modeling curves.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>

          </div>
        </div>

        {/* COLUMN 3: RIGHT SIDEBAR (Slide-out Absolute Drawer) */}
        <div 
          onMouseEnter={() => setIsRightOpen(true)}
          onMouseLeave={() => setIsRightOpen(false)}
          className={`absolute top-0 bottom-0 right-0 w-[320px] z-40 bg-neutral-900/95 backdrop-blur-md border-l border-neutral-850 flex flex-col transition-all duration-300 ease-in-out ${
            (isRightOpen || isRightPinned) ? "translate-x-0 opacity-100 shadow-2xl pointer-events-auto" : "translate-x-full opacity-0 pointer-events-none"
          }`}
        >
          
          <div className="p-3 border-b border-neutral-800 bg-neutral-950/40 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-400">
              {selectedParam ? "📐 ELEMENT INSPECTOR" : "⚙️ ARTBOARD SETTINGS"}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsRightPinned(!isRightPinned)}
                className={`p-1 rounded transition ${
                  isRightPinned ? "text-indigo-400" : "text-neutral-500 hover:text-white"
                }`}
                title={isRightPinned ? "Unpin Inspector" : "Pin Inspector Open"}
              >
                {isRightPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
              <span className="text-[8px] font-mono text-neutral-500">PROPERTIES</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
            {selectedParam ? (
              <div className="space-y-4 animate-fadeIn text-xs">
                
                {/* 1. Positioning Alignment Buttons */}
                <div className="space-y-1.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60">
                  <span className="text-[8.5px] font-mono text-neutral-500 uppercase block font-bold">Quick Alignments</span>
                  <div className="grid grid-cols-6 gap-1 text-center">
                    <button
                      onClick={() => alignSelected("left")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Align Left edge"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => alignSelected("centerX")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Center Horizontally"
                    >
                      <AlignCenter className="w-3.5 h-3.5 rotate-90" />
                    </button>
                    <button
                      onClick={() => alignSelected("right")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Align Right edge"
                    >
                      <AlignRight className="w-3.5 h-3.5 rotate-180" />
                    </button>
                    <button
                      onClick={() => alignSelected("top")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Align Top edge"
                    >
                      <AlignLeft className="w-3.5 h-3.5 rotate-90" />
                    </button>
                    <button
                      onClick={() => alignSelected("centerY")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Center Vertically"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => alignSelected("bottom")}
                      className="p-1.5 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 rounded border border-neutral-800 flex justify-center items-center"
                      title="Align Bottom edge"
                    >
                      <AlignLeft className="w-3.5 h-3.5 -rotate-90" />
                    </button>
                  </div>
                </div>

                {/* 2. Absolute Positions Inputs */}
                <div className="grid grid-cols-2 gap-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60 font-mono text-[10px]">
                  <div>
                    <span className="text-neutral-550 block mb-0.5">POSITION X</span>
                    <div className="flex items-center bg-neutral-900 px-1.5 py-1 rounded border border-neutral-800">
                      <span className="text-neutral-600 mr-1.5">X</span>
                      <input
                        type="number"
                        value={Math.round(selectedParam.x ?? 0)}
                        onChange={(e) => updateParamFields(selectedParam.id, { x: parseInt(e.target.value) || 0 })}
                        className="bg-transparent w-full outline-none text-neutral-200"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-neutral-550 block mb-0.5">POSITION Y</span>
                    <div className="flex items-center bg-neutral-900 px-1.5 py-1 rounded border border-neutral-800">
                      <span className="text-neutral-600 mr-1.5">Y</span>
                      <input
                        type="number"
                        value={Math.round(selectedParam.y ?? 0)}
                        onChange={(e) => updateParamFields(selectedParam.id, { y: parseInt(e.target.value) || 0 })}
                        className="bg-transparent w-full outline-none text-neutral-200"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-neutral-550 block mb-0.5 mt-1.5">WIDTH (W)</span>
                    <div className="flex items-center bg-neutral-900 px-1.5 py-1 rounded border border-neutral-800">
                      <span className="text-neutral-600 mr-1.5">W</span>
                      <input
                        type="number"
                        value={Math.round(selectedParam.w ?? 180)}
                        onChange={(e) => updateParamFields(selectedParam.id, { w: parseInt(e.target.value) || 120 })}
                        className="bg-transparent w-full outline-none text-neutral-200"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-neutral-550 block mb-0.5 mt-1.5">HEIGHT (H)</span>
                    <div className="flex items-center bg-neutral-900 px-1.5 py-1 rounded border border-neutral-800">
                      <span className="text-neutral-600 mr-1.5">H</span>
                      <input
                        type="number"
                        value={Math.round(selectedParam.h ?? 120)}
                        onChange={(e) => updateParamFields(selectedParam.id, { h: parseInt(e.target.value) || 70 })}
                        className="bg-transparent w-full outline-none text-neutral-200"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Core Text & Shape properties */}
                <div className="space-y-2.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60">
                  <span className="text-[8.5px] font-mono text-neutral-500 uppercase block font-bold">Element Properties</span>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-500">HUMAN-READABLE LABEL</label>
                    <input
                      type="text"
                      value={selectedParam.name}
                      onChange={(e) => updateParamFields(selectedParam.id, { name: e.target.value })}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-200 font-semibold outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-500">VARIABLE REFERENCE ID</label>
                    <input
                      type="text"
                      value={selectedParam.id}
                      onChange={(e) => {
                        const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                        updateParamFields(selectedParam.id, { id: sanitized });
                        setSelectedParamId(sanitized);
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-orange-450 font-mono outline-none focus:border-indigo-500"
                    />
                    <p className="text-[8px] text-neutral-500 leading-tight">
                      Access in JavaScript using: <code className="text-orange-400">params.{selectedParam.id}</code>.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-500">CONTROL TYPE SHAPE</label>
                    <select
                      value={selectedParam.controlType || "slider"}
                      onChange={(e) => {
                        const type = e.target.value as any;
                        updateParamFields(selectedParam.id, { controlType: type });
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-300 outline-none cursor-pointer text-[10px]"
                    >
                      <option value="slider">Fader Slider</option>
                      <option value="knob">Rotary Dial Knob</option>
                      <option value="toggle">Toggle Lever Switch</option>
                      <option value="button">Push trigger Button</option>
                      <option value="number">Digital Readout Box</option>
                      <option value="label">Decorative Graphic Label</option>
                    </select>
                  </div>
                </div>

                {/* 4. Boundaries configuration (hidden if Label) */}
                {selectedParam.controlType !== "label" && (
                  <div className="space-y-2.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60 font-mono">
                    <span className="text-[8.5px] text-neutral-500 uppercase block font-bold">Numeric Range Bounds</span>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] block mb-0.5">MIN VALUE</span>
                        <input
                          type="number"
                          step="any"
                          value={selectedParam.min}
                          onChange={(e) => updateParamFields(selectedParam.id, { min: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-200 text-[10px] outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] block mb-0.5">MAX VALUE</span>
                        <input
                          type="number"
                          step="any"
                          value={selectedParam.max}
                          onChange={(e) => updateParamFields(selectedParam.id, { max: parseFloat(e.target.value) || 1 })}
                          className="w-full bg-gradient-to-b bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-200 text-[10px] outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <span className="text-[8px] block mb-0.5">DEFAULT</span>
                        <input
                          type="number"
                          step="any"
                          value={selectedParam.defaultValue}
                          onChange={(e) => updateParamFields(selectedParam.id, { defaultValue: parseFloat(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-200 text-[10px] outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] block mb-0.5">UNIT LABELS</span>
                        <input
                          type="text"
                          value={selectedParam.unit}
                          onChange={(e) => updateParamFields(selectedParam.id, { unit: e.target.value })}
                          placeholder="e.g. Hz, dB, ms"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-200 text-[10px] outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. Live testing preview within Right Panel */}
                {selectedParam.controlType !== "label" && (
                  <div className="space-y-2 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60">
                    <div className="flex items-center justify-between">
                      <span className="text-[8.5px] font-mono text-neutral-500 uppercase block font-bold">Live Value Tester</span>
                      <span className="text-[9.5px] text-orange-400 font-mono font-bold">
                        {selectedParam.value.toFixed(2)}{selectedParam.unit}
                      </span>
                    </div>

                    <input
                      type="range"
                      min={selectedParam.min}
                      max={selectedParam.max}
                      step={(selectedParam.max - selectedParam.min) / 100 || 0.01}
                      value={selectedParam.value}
                      onChange={(e) => handleParamValueChange(selectedParam.id, parseFloat(e.target.value))}
                      className="w-full h-1 bg-neutral-900 rounded-full appearance-none accent-indigo-500 cursor-pointer"
                    />
                    
                    <button
                      type="button"
                      onClick={() => updateParamFields(selectedParam.id, { value: selectedParam.defaultValue })}
                      className="w-full py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded font-mono text-[8px] text-neutral-400 hover:text-white transition"
                    >
                      ↺ RESET TO DEFAULT DEFAULT: {selectedParam.defaultValue}
                    </button>
                  </div>
                )}

                {/* 5. Custom Visual Customization & Colors */}
                <div className="space-y-2.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60">
                  <span className="text-[8.5px] font-mono text-neutral-500 uppercase block font-bold">Custom Visual Styling</span>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono font-bold text-neutral-500">CUSTOM BRAND / LABEL TEXT</label>
                    <input
                      type="text"
                      value={selectedParam.customText || ""}
                      placeholder="e.g. CELESTION 1960, PLEXI 50W"
                      onChange={(e) => updateParamFields(selectedParam.id, { customText: e.target.value })}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-200 outline-none focus:border-indigo-500 text-[10px]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[8px] font-mono font-bold text-neutral-500 block">BACKGROUND COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={selectedParam.bgColor || "#1e1e24"}
                          onChange={(e) => updateParamFields(selectedParam.id, { bgColor: e.target.value })}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={selectedParam.bgColor || ""}
                          placeholder="#1e1e24"
                          onChange={(e) => updateParamFields(selectedParam.id, { bgColor: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[9px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[8px] font-mono font-bold text-neutral-500 block">BORDER COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={selectedParam.borderColor || "#2a2a35"}
                          onChange={(e) => updateParamFields(selectedParam.id, { borderColor: e.target.value })}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={selectedParam.borderColor || ""}
                          placeholder="#2a2a35"
                          onChange={(e) => updateParamFields(selectedParam.id, { borderColor: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[9px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="space-y-1">
                      <label className="text-[8px] font-mono font-bold text-neutral-500 block">ACCENT / GLOW COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={selectedParam.accentColor || "#10b981"}
                          onChange={(e) => updateParamFields(selectedParam.id, { accentColor: e.target.value })}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={selectedParam.accentColor || ""}
                          placeholder="#10b981"
                          onChange={(e) => updateParamFields(selectedParam.id, { accentColor: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[9px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[8px] font-mono font-bold text-neutral-500 block">TEXT COLOR</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={selectedParam.textColor || "#ffffff"}
                          onChange={(e) => updateParamFields(selectedParam.id, { textColor: e.target.value })}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={selectedParam.textColor || ""}
                          placeholder="#ffffff"
                          onChange={(e) => updateParamFields(selectedParam.id, { textColor: e.target.value })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[9px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Mic specifics coordinates indicator if type === mic */}
                  {selectedParam.controlType === "mic" && (
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-850/40 font-mono text-[9px]">
                      <div>
                        <span className="text-neutral-550 block">MIC DISTANCE (X)</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedParam.valX ?? 35}
                          onChange={(e) => updateParamFields(selectedParam.id, { valX: parseInt(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-neutral-200"
                        />
                      </div>
                      <div>
                        <span className="text-neutral-550 block">CONE OFF-AXIS (Y)</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedParam.valY ?? 50}
                          onChange={(e) => updateParamFields(selectedParam.id, { valY: parseInt(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-neutral-200"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Delete parameter trigger */}
                <button
                  type="button"
                  onClick={() => deleteParam(selectedParam.id)}
                  className="w-full py-2 bg-rose-950/40 text-rose-450 hover:bg-rose-900 hover:text-white border border-rose-900/30 font-mono font-bold text-[10px] rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>DELETE SELECTED CONTROL</span>
                </button>

              </div>
            ) : (
              <div className="space-y-4 text-xs">
                
                {/* Artboard Frame properties */}
                <div className="space-y-2.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60 font-mono">
                  <span className="text-[8.5px] text-neutral-500 uppercase block font-bold">Faceplate Dimensions</span>
                  
                  <div className="space-y-1">
                    <span className="text-[8px] block">CANVAS WIDTH (PX)</span>
                    <input
                      type="number"
                      value={artboardWidth}
                      onChange={(e) => setArtboardWidth(Math.max(400, parseInt(e.target.value) || 720))}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-indigo-400 text-[10px] outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="text-[8px] block">CANVAS HEIGHT (PX)</span>
                    <input
                      type="number"
                      value={artboardHeight}
                      onChange={(e) => setArtboardHeight(Math.max(250, parseInt(e.target.value) || 380))}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-indigo-400 text-[10px] outline-none"
                    />
                  </div>

                  <div className="space-y-1 pt-1.5">
                    <span className="text-[8px] block text-neutral-500">GRID SNAP SPACING</span>
                    <select
                      value={gridSize}
                      onChange={(e) => setGridSize(parseInt(e.target.value))}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-300 text-[9px] outline-none cursor-pointer"
                    >
                      <option value="5">Fine grid (5px)</option>
                      <option value="10">Standard grid (10px)</option>
                      <option value="20">Large grid (20px)</option>
                    </select>
                  </div>
                </div>

                {/* Custom Skin properties */}
                <div className="space-y-2.5 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850/60 font-mono">
                  <span className="text-[8.5px] text-neutral-500 uppercase block font-bold">Custom Skin Settings</span>
                  
                  <div className="space-y-1">
                    <span className="text-[8px] block text-neutral-400">SELECT OVERALL SKIN FONT</span>
                    <select
                      value={plugin.customSkin?.fontStyle || "sans"}
                      onChange={(e) => {
                        onChange({
                          ...plugin,
                          customSkin: {
                            ...(plugin.customSkin || {}),
                            fontStyle: e.target.value as any
                          }
                        });
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-300 text-[9px] outline-none cursor-pointer"
                    >
                      <option value="sans">Inter (Modern Clean)</option>
                      <option value="grotesk">Space Grotesk (Tech Editorial)</option>
                      <option value="orbitron">Orbitron (Sci-Fi Futuristic)</option>
                      <option value="mono">JetBrains Mono (Developer Pro)</option>
                      <option value="serif">Georgia (Classic Vintage)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[8px] block text-neutral-400">GLOW ACCENT STYLE</span>
                    <select
                      value={plugin.customSkin?.glowStyle || "none"}
                      onChange={(e) => {
                        onChange({
                          ...plugin,
                          customSkin: {
                            ...(plugin.customSkin || {}),
                            glowStyle: e.target.value as any
                          }
                        });
                      }}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-1.5 py-1 text-neutral-300 text-[9px] outline-none cursor-pointer"
                    >
                      <option value="none">Flat/Minimal</option>
                      <option value="neon">Neon Active Glow</option>
                      <option value="vintage">Soft Shadow</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <span className="text-[8px] block text-neutral-500">BORDER WIDTH</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={plugin.customSkin?.borderWidth ?? 4}
                        onChange={(e) => {
                          onChange({
                            ...plugin,
                            customSkin: {
                              ...(plugin.customSkin || {}),
                              borderWidth: parseInt(e.target.value) || 0
                            }
                          });
                        }}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-200 text-[10px] outline-none"
                      />
                    </div>
                  </div>

                  {/* Faceplate colors customization */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <span className="text-[8px] text-neutral-400 block">FACEPLATE BG</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={plugin.customSkin?.bgColor || "#111116"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                bgColor: e.target.value
                              }
                            });
                          }}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={plugin.customSkin?.bgColor || "#111116"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                bgColor: e.target.value
                              }
                            });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[8px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[8px] text-neutral-400 block">BORDER COLOR</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={plugin.customSkin?.borderColor || "#1f1f29"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                borderColor: e.target.value
                              }
                            });
                          }}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={plugin.customSkin?.borderColor || "#1f1f29"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                borderColor: e.target.value
                              }
                            });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[8px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <span className="text-[8px] text-neutral-400 block">TEXT COLOR</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={plugin.customSkin?.textColor || "#ffffff"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                textColor: e.target.value
                              }
                            });
                          }}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={plugin.customSkin?.textColor || "#ffffff"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                textColor: e.target.value
                              }
                            });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[8px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[8px] text-neutral-400 block">ACCENT COLOR</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={plugin.customSkin?.accentColor || "#10b981"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                accentColor: e.target.value
                              }
                            });
                          }}
                          className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={plugin.customSkin?.accentColor || "#10b981"}
                          onChange={(e) => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                accentColor: e.target.value
                              }
                            });
                          }}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded px-1 py-0.5 text-[8px] text-neutral-300 font-mono outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Base64 faceplate image skin uploader */}
                  <div className="space-y-1 pt-1.5 border-t border-neutral-850/40">
                    <span className="text-[8px] block text-neutral-400">UPLOAD CUSTOM SKIN IMAGE</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (uploadEvent) => {
                            const base64 = uploadEvent.target?.result as string;
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                bgImage: base64
                              }
                            });
                            setTheme("custom-skin");
                            triggerToast("Custom faceplate skin uploaded successfully! Activated custom-skin preset.");
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full text-[9px] font-mono text-neutral-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[9px] file:font-mono file:bg-indigo-950 file:text-indigo-400 hover:file:bg-indigo-900 cursor-pointer"
                    />
                    
                    {plugin.customSkin?.bgImage && (
                      <div className="flex items-center justify-between gap-1 mt-1 bg-black/40 p-1 rounded">
                        <span className="text-[7.5px] font-mono text-emerald-400 truncate">✓ Active skin image</span>
                        <button
                          type="button"
                          onClick={() => {
                            onChange({
                              ...plugin,
                              customSkin: {
                                ...(plugin.customSkin || {}),
                                bgImage: undefined
                              }
                            });
                            triggerToast("Custom skin image removed.");
                          }}
                          className="text-[7.5px] font-mono text-rose-450 hover:text-rose-300 hover:underline"
                        >
                          Clear Image
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Info Card */}
                <div className="p-3 bg-neutral-950 border border-neutral-850 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-indigo-400">
                    <Info className="w-4 h-4 shrink-0" />
                    <span className="font-mono text-[9px] font-bold uppercase tracking-wider">Figma Design Tip</span>
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-relaxed font-sans">
                    Select any component on the visual Artboard to customize its width, height, coordinates, reference handles, and range attributes. Use <strong>Design Skin Preset</strong> to transform the physical visual vibe of the panel faceplate instantly!
                  </p>
                </div>

              </div>
            )}
          </div>

          {/* Code reference summary inside Inspector bottom */}
          <div className="p-3 border-t border-neutral-800 bg-neutral-950/50 space-y-1.5 select-none font-mono text-[8px] text-neutral-500">
            <span className="text-neutral-400 font-bold uppercase block tracking-wider">DSP Node Reference Mapping</span>
            <div className="space-y-1 max-h-[110px] overflow-y-auto scrollbar-thin pr-0.5">
              {plugin.parameters.map((p) => (
                <div key={p.id} className="flex justify-between items-center bg-black/40 p-1 px-1.5 rounded border border-neutral-900">
                  <span className="text-orange-450">params.{p.id}</span>
                  <span>[{p.min}-{p.max}]</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* FOOTER SECTION: ACOUSTIC GLOSSARY DECODER (Slide-up Absolute Drawer) */}
        <div 
          onMouseEnter={() => setIsBottomOpen(true)}
          onMouseLeave={() => setIsBottomOpen(false)}
          className={`absolute bottom-0 left-0 right-0 z-40 bg-neutral-900/95 backdrop-blur-md p-4 border-t border-neutral-850 transition-all duration-300 ease-in-out flex flex-col gap-3.5 max-h-[320px] overflow-y-auto ${
            (isBottomOpen || isBottomPinned) ? "translate-y-0 opacity-100 shadow-2xl pointer-events-auto" : "translate-y-full opacity-0 pointer-events-none"
          }`}
        >
          {/* Bottom Drawer Pin Control Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2 shrink-0">
            <span className="text-[10px] font-mono font-bold text-neutral-450 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Acoustic Templates & Glossary Inspector</span>
            </span>
            <button
              type="button"
              onClick={() => setIsBottomPinned(!isBottomPinned)}
              className={`p-1 rounded transition ${
                isBottomPinned ? "text-indigo-400 font-bold" : "text-neutral-500 hover:text-white"
              }`}
              title={isBottomPinned ? "Unpin Bottom Panel" : "Pin Bottom Panel Open"}
            >
              {isBottomPinned ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Quick Audio Preset calculators */}
        <div className="lg:col-span-8 space-y-2 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-850">
              <button
                type="button"
                onClick={() => setBottomSubTab("templates")}
                className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  bottomSubTab === "templates"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>⚡ PRO FACEPLATES</span>
              </button>
              <button
                type="button"
                onClick={() => setBottomSubTab("wizard")}
                className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  bottomSubTab === "wizard"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Wand2 className="w-3 h-3" />
                <span>🪄 AUTO-LAYOUT WIZARD</span>
              </button>
              <button
                type="button"
                onClick={() => setBottomSubTab("injectors")}
                className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  bottomSubTab === "injectors"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-950/40"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                <Sliders className="w-3 h-3" />
                <span>🧪 SINGLE INJECTORS</span>
              </button>
            </div>
            
            <span className="text-[8.5px] font-mono text-neutral-500 uppercase tracking-widest hidden sm:inline">STUDIO TOOLKIT</span>
          </div>

          {bottomSubTab === "templates" && (
            <div className="space-y-1.5 pt-0.5">
              <p className="text-[10px] text-neutral-400 leading-normal">
                Deploy fully engineered multi-widget audio faceplates. Select any design preset below to replace your workspace with a complete, visually aligned physical interface with **matching real-time digital DSP code**:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-[160px] overflow-y-auto pr-1">
                {PRO_STUDIO_TEMPLATES.map((t, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => applyProStudioTemplate(idx)}
                    className="p-2 bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-indigo-500 rounded-lg flex flex-col text-left transition select-none group cursor-pointer"
                  >
                    <span className="text-[9.5px] font-bold text-neutral-200 truncate group-hover:text-indigo-400">{t.name}</span>
                    <span className="text-[7.5px] text-neutral-500 mt-1 leading-snug line-clamp-2">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {bottomSubTab === "wizard" && (
            <div className="space-y-1.5 pt-0.5">
              <p className="text-[10px] text-neutral-450 leading-normal">
                Instantly arrange your current parameters into a professional aligned rack, channel strip, or console interface. Select any layout geometry below:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => autoArrangeLayout("grid")}
                  className="p-2.5 bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center text-center transition cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-neutral-200">⊞ Modular Grid</span>
                  <span className="text-[7px] text-neutral-500 mt-1">Multi-column layout</span>
                </button>
                <button
                  type="button"
                  onClick={() => autoArrangeLayout("rack")}
                  className="p-2.5 bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center text-center transition cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-neutral-200">▭ 19" Studio Rack</span>
                  <span className="text-[7px] text-neutral-500 mt-1">Horizontal flow strip</span>
                </button>
                <button
                  type="button"
                  onClick={() => autoArrangeLayout("strip")}
                  className="p-2.5 bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center text-center transition cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-neutral-200">▥ Channel Strip</span>
                  <span className="text-[7px] text-neutral-500 mt-1">Console faders alignment</span>
                </button>
                <button
                  type="button"
                  onClick={() => autoArrangeLayout("pedal")}
                  className="p-2.5 bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-indigo-500 rounded-xl flex flex-col items-center justify-center text-center transition cursor-pointer"
                >
                  <span className="text-[11px] font-bold text-neutral-200">⬚ Guitar Pedal</span>
                  <span className="text-[7px] text-neutral-500 mt-1">Knobs top, switches bottom</span>
                </button>
              </div>
            </div>
          )}

          {bottomSubTab === "injectors" && (
            <div className="space-y-1.5 pt-0.5">
              <p className="text-[10px] text-neutral-450 leading-normal">
                Click any parameter module below to instantly generate a physically calibrated, range-proper parameter right on your Artboard center:
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                {AUDIO_RANGE_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const safeId = p.name.replace(/[^a-zA-Z]/g, "").toLowerCase().replace(/\s+/g, "_") + "_" + Math.floor(10 + Math.random() * 90);
                      const created: PluginParameter = {
                        id: safeId,
                        name: p.name.split(" ").slice(1).join(" "),
                        min: p.min,
                        max: p.max,
                        defaultValue: p.def,
                        value: p.def,
                        unit: p.unit,
                        controlType: p.min === 0 && p.max === 1 ? "toggle" : "knob",
                        x: (artboardWidth - 180) / 2,
                        y: (artboardHeight - 120) / 2,
                        w: 120,
                        h: 100
                      };
                      onChange({
                        ...plugin,
                        parameters: [...plugin.parameters, created]
                      });
                      setSelectedParamId(created.id);
                      triggerToast(`Mounted parameter: ${created.name}`);
                    }}
                    className="px-2.5 py-1.5 bg-neutral-950 border border-neutral-850 hover:border-indigo-500 rounded-lg text-[9.5px] text-neutral-300 font-semibold transition-all flex items-center gap-1 cursor-pointer select-none"
                    title={p.desc}
                  >
                    <span>{p.name.split(" ")[0]}</span>
                    <span>{p.name.split(" ").slice(1).join(" ")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Glossary decoder */}
        <div className="lg:col-span-4 bg-neutral-950/80 p-3 rounded-xl border border-neutral-800 space-y-2.5 text-xs text-neutral-300">
          <div className="flex items-center justify-between border-b border-neutral-850 pb-1.5">
            <div className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="font-bold text-[10px] text-neutral-200 uppercase tracking-tight font-mono">
                DSP Glossary Decoder
              </span>
            </div>
            
            <div className="flex gap-1">
              {Object.keys(GLOSSARY_TERMS).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedGlossaryKey(key)}
                  className={`px-1 py-0.5 rounded text-[8.5px] font-mono uppercase font-bold border transition ${
                    selectedGlossaryKey === key
                      ? "bg-orange-500/10 border-orange-500 text-orange-400"
                      : "bg-neutral-900 border-neutral-850 text-neutral-500"
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-neutral-450 leading-relaxed">
            <strong className="text-orange-400 font-mono block mb-0.5">
              {GLOSSARY_TERMS[selectedGlossaryKey].term}
            </strong>
            {GLOSSARY_TERMS[selectedGlossaryKey].explanation}
          </p>

          <div className="space-y-1">
            <span className="text-[8px] font-mono text-neutral-600 block uppercase font-bold tracking-wider">
              Integration Code Example:
            </span>
            <pre className="bg-neutral-950 p-2 rounded border border-neutral-900 text-[8.5px] font-mono text-emerald-400 overflow-x-auto leading-normal">
              {GLOSSARY_TERMS[selectedGlossaryKey].example}
            </pre>
          </div>
        </div>

      </div>

      </div> {/* Close Bottom Drawer slide-out container */}
      </div> {/* Close MAIN VIEWPORT BODY */}
    </div> {/* Close IMMERSIVE HOVER-CONTROLLED WORKSPACE CONTAINER */}
  </div>
);
}
