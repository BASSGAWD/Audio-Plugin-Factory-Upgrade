import React, { useEffect, useRef, useState } from "react";
import { AudioPlugin, PluginParameter } from "../types";
import { computeFilterCurve, xPixelToHz, computeWaveformPath, waveShapeLabel } from "../utils/controlVisuals";

/**
 * Playback-time control rendering shared by Simple Mode. Mirrors the visual
 * vocabulary the Pro UI Designer already has (knob, toggle, meter, pad,
 * amp head, cabinet, mic position, EQ curve, waveform display) so a
 * generated plugin looks like what it actually is everywhere in the app,
 * not just inside the Designer tab. No drag-to-reposition here -- these are
 * fixed-layout, interact-to-play widgets.
 */

interface ControlProps {
  param: PluginParameter;
  allParams: PluginParameter[];
  onChange: (paramId: string, value: number) => void;
  /** Live audio graph tap for meter widgets. Undefined/null = show the static param value instead. */
  analyserNode?: AnalyserNode | null;
  isPlaying?: boolean;
}

const ACCENT_FALLBACK = "#f97316";

/**
 * Polls an AnalyserNode's time-domain buffer on a throttled animation-frame
 * loop and returns a 0..1 RMS level. Throttled to ~12 updates/sec so meter
 * widgets react to real audio without re-rendering the whole control grid
 * at full frame rate.
 */
function useSignalLevel(analyserNode: AnalyserNode | null | undefined, isPlaying: boolean | undefined): number | null {
  const [level, setLevel] = useState<number | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!analyserNode || !isPlaying) {
      setLevel(null);
      return;
    }
    if (!dataRef.current || dataRef.current.length !== analyserNode.fftSize) {
      dataRef.current = new Uint8Array(analyserNode.fftSize);
    }
    let raf = 0;
    let lastUpdate = 0;
    let cancelled = false;

    const tick = (t: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (t - lastUpdate < 80) return;
      lastUpdate = t;
      const data = dataRef.current!;
      analyserNode.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      setLevel(Math.min(1, Math.sqrt(sumSq / data.length) * 1.8));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [analyserNode, isPlaying]);

  return level;
}

/** angleFromTop: 0 = 12 o'clock, increases clockwise. Returns SVG coordinates. */
function polarPoint(cx: number, cy: number, r: number, angleFromTop: number): { x: number; y: number } {
  const theta = ((90 - angleFromTop) * Math.PI) / 180;
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

function knobArcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  if (endAngle <= startAngle) return "";
  const start = polarPoint(cx, cy, r, startAngle);
  const end = polarPoint(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const KNOB_START_ANGLE = -135;
const KNOB_END_ANGLE = 135;

function KnobControl({ param, onChange }: ControlProps) {
  const range = param.max - param.min || 1;
  const pct = Math.max(0, Math.min(1, (param.value - param.min) / range));
  const accent = param.accentColor || ACCENT_FALLBACK;
  const R = 38;
  const CX = 50;
  const CY = 50;
  const valueAngle = KNOB_START_ANGLE + pct * (KNOB_END_ANGLE - KNOB_START_ANGLE);
  const pointerEnd = polarPoint(CX, CY, R - 4, valueAngle);

  const handleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startVal = param.value;
    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY;
      const delta = (dy / 140) * range;
      const next = Math.max(param.min, Math.min(param.max, startVal + delta));
      onChange(param.id, parseFloat(next.toFixed(4)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="relative w-16 h-16 cursor-ns-resize" onMouseDown={handleDrag}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <path d={knobArcPath(CX, CY, R, KNOB_START_ANGLE, KNOB_END_ANGLE)} fill="none" stroke="#27272a" strokeWidth="8" strokeLinecap="round" />
          <path
            d={knobArcPath(CX, CY, R, KNOB_START_ANGLE, valueAngle)}
            fill="none"
            stroke={accent}
            strokeWidth="8"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${accent}88)` }}
          />
          <line x1={CX} y1={CY} x2={pointerEnd.x} y2={pointerEnd.y} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="3" fill="#fff" />
        </svg>
      </div>
      <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[76px] text-center leading-tight">{param.name}</span>
      <span className="text-[9px] font-mono text-neutral-500">
        {Number(param.value.toFixed(2))} {param.unit}
      </span>
    </div>
  );
}

function ToggleControl({ param, onChange }: ControlProps) {
  const on = param.value > param.min;
  return (
    <button
      type="button"
      onClick={() => onChange(param.id, on ? param.min : param.max)}
      className="flex flex-col items-center gap-1.5 select-none cursor-pointer"
      aria-pressed={on}
    >
      <div
        className={`w-12 h-6 rounded-full p-0.5 transition-colors ${on ? "bg-orange-600" : "bg-neutral-800"}`}
        style={on && param.accentColor ? { backgroundColor: param.accentColor } : undefined}
      >
        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-0"}`} />
      </div>
      <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[80px] text-center">{param.name}</span>
    </button>
  );
}

function MeterControl({ param, analyserNode, isPlaying }: ControlProps) {
  const range = param.max - param.min || 1;
  const staticPct = Math.max(0, Math.min(1, (param.value - param.min) / range));
  const liveLevel = useSignalLevel(analyserNode, isPlaying);
  const isLive = liveLevel !== null;
  const pct = isLive ? liveLevel : staticPct;

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="w-6 h-16 rounded-md bg-neutral-900 border border-neutral-800 relative overflow-hidden">
        <div
          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-emerald-500 via-amber-400 to-rose-500 transition-[height] duration-75"
          style={{ height: `${pct * 100}%` }}
        />
        {isLive && <div className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-emerald-400 animate-pulse" title="Live signal" />}
      </div>
      <span className="text-[10px] font-medium text-neutral-300 truncate max-w-[76px] text-center leading-tight">{param.name}</span>
      <span className="text-[9px] font-mono text-neutral-500">
        {isLive ? `${Math.round(pct * 100)}%` : `${Number(param.value.toFixed(1))} ${param.unit}`}
      </span>
    </div>
  );
}

function PadControl({ param, onChange }: ControlProps) {
  const active = param.value > param.min;
  return (
    <button
      type="button"
      className={`aspect-square w-full rounded-xl border-2 flex flex-col items-center justify-center gap-1 select-none transition-all duration-75 cursor-pointer ${
        active
          ? "bg-orange-500 border-orange-400 text-white scale-95 shadow-[0_0_16px_rgba(249,115,22,0.7)]"
          : "bg-neutral-900 hover:bg-neutral-850 border-neutral-750 text-neutral-400"
      }`}
      style={active && param.accentColor ? { backgroundColor: param.accentColor, borderColor: param.accentColor } : undefined}
      onMouseDown={() => onChange(param.id, param.max)}
      onMouseUp={() => onChange(param.id, param.min)}
      onMouseLeave={() => {
        if (param.value > param.min) onChange(param.id, param.min);
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onChange(param.id, param.max);
      }}
      onTouchEnd={() => onChange(param.id, param.min)}
    >
      <span className="text-[9px] font-bold uppercase tracking-wide text-center px-1 leading-tight">{param.name}</span>
    </button>
  );
}

function AmpHeadControl({ param }: ControlProps) {
  return (
    <div
      className="w-full rounded-xl border-2 p-3 flex items-center justify-between gap-3 select-none shadow-lg"
      style={{
        backgroundColor: param.bgColor || "#1c1c22",
        borderColor: param.borderColor || "#3a3a45",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[8px] uppercase tracking-widest text-neutral-500 font-mono">Amp Head</div>
        <div
          className="text-sm font-black uppercase tracking-tight truncate"
          style={{ color: param.textColor || param.accentColor || "#e5e5e5" }}
        >
          {param.customText || param.name}
        </div>
        <div className="text-[9px] font-mono text-neutral-500 mt-0.5 capitalize">
          {param.ampChannelType || "crunch"} channel{param.ampTubeGlow ? " · tube glow" : ""}
        </div>
      </div>
      <div
        className="w-8 h-8 rounded-full border-4 shrink-0"
        style={{
          borderColor: param.accentColor || "#ef4444",
          boxShadow: param.ampTubeGlow ? `0 0 10px ${param.accentColor || "#ef4444"}` : undefined,
        }}
      />
    </div>
  );
}

function CabinetControl({ param }: ControlProps) {
  return (
    <div
      className="w-full rounded-xl border-2 p-3 flex items-center gap-3 select-none shadow-lg"
      style={{
        backgroundColor: param.bgColor || "#16161a",
        borderColor: param.borderColor || "#2c2c36",
      }}
    >
      <div
        className="w-10 h-10 rounded-md shrink-0 grid grid-cols-3 gap-0.5 p-1"
        style={{ backgroundColor: "#0d0d10" }}
      >
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-full" style={{ backgroundColor: param.accentColor || "#3e3e4a" }} />
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[8px] uppercase tracking-widest text-neutral-500 font-mono">Cabinet</div>
        <div className="text-sm font-black uppercase tracking-tight truncate text-neutral-200">{param.customText || param.name}</div>
        <div className="text-[9px] font-mono text-neutral-500 mt-0.5">
          {param.cabSize || "4x12"} · mic {param.cabMicModel || "SM57"}
        </div>
      </div>
    </div>
  );
}

function MicPositionControl({ param, onChange }: ControlProps) {
  // Simple Mode can only drive a parameter's numeric value (not the extra
  // valX/valY fine-tuning fields the Pro Designer exposes), so this renders
  // as a single functional "distance from cone" drag instead of a 2D pad --
  // real and draggable, just one axis instead of two.
  const range = param.max - param.min || 1;
  const pct = Math.max(0, Math.min(1, (param.value - param.min) / range));

  const handleDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const bound = e.currentTarget.getBoundingClientRect();
    const update = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - bound.left) / bound.width));
      onChange(param.id, Math.round(param.min + ratio * range));
    };
    update(e.clientX);
    const onMove = (ev: MouseEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="w-full rounded-xl border-2 border-neutral-800 bg-neutral-950 p-2 select-none">
      <div className="flex justify-between items-baseline mb-1.5 px-0.5">
        <span className="text-[8px] uppercase tracking-widest text-neutral-500 font-mono">🎙️ {param.name}</span>
        <span className="text-[9px] font-mono text-neutral-500">
          {Number(param.value.toFixed(0))} {param.unit}
        </span>
      </div>
      <div className="relative w-full h-6 rounded-lg bg-neutral-900 border border-neutral-850 cursor-ew-resize overflow-hidden" onMouseDown={handleDrag}>
        <div className="absolute inset-y-0 left-0 opacity-25" style={{ width: `${pct * 100}%`, backgroundColor: param.accentColor || "#f97316" }} />
        <div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pct * 100}%`, backgroundColor: param.accentColor || "#f97316" }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[8px] font-mono text-neutral-600 px-0.5">
        <span>Cone (close, dark)</span>
        <span>Edge (bright)</span>
      </div>
    </div>
  );
}

function EqCurveControl({ param, allParams, onChange }: ControlProps) {
  const width = 260;
  const height = 90;
  const curve = computeFilterCurve(allParams, param, width, height);

  const handleDrag = (e: React.MouseEvent<SVGCircleElement>) => {
    if (!curve.cutoffParamId) return;
    e.stopPropagation();
    const svg = (e.currentTarget.closest("svg") as SVGSVGElement) || null;
    const bound = svg?.getBoundingClientRect();
    if (!bound) return;
    const update = (clientX: number) => {
      const hz = xPixelToHz(((clientX - bound.left) / bound.width) * width, width);
      onChange(curve.cutoffParamId!, Math.round(Math.max(curve.cutoffParamMin!, Math.min(curve.cutoffParamMax!, hz))));
    };
    update(e.clientX);
    const onMove = (ev: MouseEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="w-full rounded-xl border border-neutral-850 bg-neutral-950 p-1.5 select-none">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ aspectRatio: `${width}/${height}` }}>
        <path d={`${curve.pathD} L ${width},${height} L 0,${height} Z`} fill={param.accentColor || "#10b981"} fillOpacity="0.12" stroke="none" />
        <path d={curve.pathD} fill="none" stroke={param.accentColor || "#10b981"} strokeWidth="2" />
        <line x1={curve.cutoffX} y1={0} x2={curve.cutoffX} y2={height} stroke={param.accentColor || "#10b981"} strokeOpacity="0.3" strokeDasharray="2,2" />
        <circle
          cx={curve.cutoffX}
          cy={curve.cutoffY}
          r="5"
          fill={param.accentColor || "#10b981"}
          stroke="#fff"
          strokeWidth="1.5"
          className={curve.cutoffParamId ? "cursor-ew-resize" : ""}
          onMouseDown={handleDrag}
        />
      </svg>
      <div className="flex justify-between px-1 pt-0.5">
        <span className="text-[9px] font-mono text-neutral-500">{param.name}</span>
        <span className="text-[9px] font-mono text-neutral-500">{curve.isPlaceholder ? "" : `${Math.round(curve.cutoffHz)} Hz`}</span>
      </div>
    </div>
  );
}

function WaveformControl({ param, onChange }: ControlProps) {
  const width = 200;
  const height = 70;
  const pathD = computeWaveformPath(param.value, width, height);

  const cycleShape = () => {
    const next = (Math.round(param.value) % 4) + 1;
    onChange(param.id, next);
  };

  return (
    <button type="button" onClick={cycleShape} className="w-full rounded-xl border border-neutral-850 bg-black/90 p-1.5 select-none cursor-pointer text-left">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ aspectRatio: `${width}/${height}` }}>
        <path d={pathD} fill="none" stroke={param.accentColor || "#3b82f6"} strokeWidth="2" />
      </svg>
      <div className="flex justify-between px-1 pt-0.5">
        <span className="text-[9px] font-mono text-neutral-500 uppercase">{waveShapeLabel(param.value)}</span>
        <span className="text-[9px] font-mono text-neutral-500 uppercase">tap to cycle</span>
      </div>
    </button>
  );
}

function SliderControl({ param, onChange }: ControlProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate pr-2">{param.name}</span>
        <span className="text-[10px] font-mono text-neutral-500 shrink-0">
          {Number(param.value.toFixed(2))} {param.unit}
        </span>
      </div>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={(param.max - param.min) / 200 || 0.01}
        value={param.value}
        onChange={(e) => onChange(param.id, parseFloat(e.target.value))}
        className="w-full cursor-pointer"
        style={param.accentColor ? ({ accentColor: param.accentColor } as React.CSSProperties) : { accentColor: ACCENT_FALLBACK }}
        aria-label={param.name}
      />
    </label>
  );
}

/** Dispatches a single parameter to its right-shaped playback control. */
export const PluginControl: React.FC<ControlProps> = ({ param, allParams, onChange, analyserNode, isPlaying }) => {
  switch (param.controlType) {
    case "knob":
      return <KnobControl param={param} allParams={allParams} onChange={onChange} />;
    case "toggle":
      return <ToggleControl param={param} allParams={allParams} onChange={onChange} />;
    case "meter":
      return <MeterControl param={param} allParams={allParams} onChange={onChange} analyserNode={analyserNode} isPlaying={isPlaying} />;
    case "pad":
      return <PadControl param={param} allParams={allParams} onChange={onChange} />;
    case "amp":
      return <AmpHeadControl param={param} allParams={allParams} onChange={onChange} />;
    case "cab":
      return <CabinetControl param={param} allParams={allParams} onChange={onChange} />;
    case "mic":
    case "mic_stand":
      return <MicPositionControl param={param} allParams={allParams} onChange={onChange} />;
    case "eq":
      return <EqCurveControl param={param} allParams={allParams} onChange={onChange} />;
    case "waveform":
      return <WaveformControl param={param} allParams={allParams} onChange={onChange} />;
    case "label":
      return <div className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wide">{param.customText || param.name}</div>;
    default:
      return <SliderControl param={param} allParams={allParams} onChange={onChange} />;
  }
};

/**
 * Partitions a plugin's parameters into layout groups matching the same
 * priority the Pro Designer's deterministic layout uses: amp/cab/mic first
 * (most identity-defining), then eq/waveform displays, then a pad trigger
 * grid, then the regular knob/slider/toggle/meter grid.
 */
export function groupParamsForPlayback(plugin: AudioPlugin) {
  const showpiece = plugin.parameters.filter((p) => ["amp", "cab", "mic", "mic_stand"].includes(p.controlType || ""));
  const visualizers = plugin.parameters.filter((p) => p.controlType === "eq" || p.controlType === "waveform");
  const pads = plugin.parameters.filter((p) => p.controlType === "pad");
  const regular = plugin.parameters.filter((p) => !showpiece.includes(p) && !visualizers.includes(p) && !pads.includes(p));
  return { showpiece, visualizers, pads, regular };
}
