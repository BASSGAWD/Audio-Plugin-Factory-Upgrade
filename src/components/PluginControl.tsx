import React, { useContext, useEffect, useRef, useState } from "react";
import { AudioPlugin, PluginParameter } from "../types";
import { computeFilterCurve, computeEqCurve, findEqBands, xPixelToHz, yPixelToDb, computeWaveformPath, waveShapeLabel } from "../utils/controlVisuals";
import { applyFineAdjust, wheelStepDelta, wheelDirection, clampToRange } from "../utils/controlInteraction";
import { METER_BALLISTICS, MeterBallistics, ballisticsStep } from "../utils/uiRenderPatterns";
import { useNonPassiveWheel } from "../hooks/useNonPassiveWheel";
import { MaterialContext, materialFilterId, materialTextureDataUri } from "../utils/materialVisuals";

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
 * loop and returns a 0..1 RMS level, attack/release-smoothed via the given
 * meter ballistics (default: led_segment_peak -- fast attack so transients
 * register immediately, slow release for a readable peak-hold feel, matching
 * MeterControl's continuous gradient-bar rendering). Throttled to ~12
 * updates/sec so meter widgets react to real audio without re-rendering the
 * whole control grid at full frame rate. This is pure client-side smoothing
 * of an already-polled value -- no audio-thread/engine change involved.
 */
function useSignalLevel(
  analyserNode: AnalyserNode | null | undefined,
  isPlaying: boolean | undefined,
  ballistics: MeterBallistics = METER_BALLISTICS.led_segment_peak
): number | null {
  const [level, setLevel] = useState<number | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!analyserNode || !isPlaying) {
      setLevel(null);
      smoothedRef.current = 0;
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
      const dtMs = lastUpdate === 0 ? 80 : t - lastUpdate;
      lastUpdate = t;
      const data = dataRef.current!;
      analyserNode.getByteTimeDomainData(data);
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSq += v * v;
      }
      const raw = Math.min(1, Math.sqrt(sumSq / data.length) * 1.8);
      smoothedRef.current = ballisticsStep(smoothedRef.current, raw, dtMs, ballistics);
      setLevel(smoothedRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [analyserNode, isPlaying, ballistics]);

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
  const [isEditingValue, setIsEditingValue] = useState(false);
  const dragRef = useRef<HTMLDivElement | null>(null);
  // Real seeded material (brushed-metal/anodized-aluminum/wood-panel/
  // matte-plastic/vintage-cream) instead of a flat gradient-only cap --
  // the filter def itself is mounted once per plugin by GenerativeFaceplate,
  // this just references it by the SAME (materialId, seedString) pair.
  const { materialId, seedString } = useContext(MaterialContext);
  const matFilterUrl = `url(#${materialFilterId(materialId, seedString)})`;
  const CX = 50;
  const CY = 50;
  const TRACK_R = 44;
  const valueAngle = KNOB_START_ANGLE + pct * (KNOB_END_ANGLE - KNOB_START_ANGLE);
  // Unique gradient/filter ids so multiple knobs in the DOM don't cross-wire.
  const uid = param.id.replace(/[^a-zA-Z0-9]/g, "") || "k";
  const grooveEnd = polarPoint(CX, CY, 25, valueAngle);
  const grooveStart = polarPoint(CX, CY, 9, valueAngle);
  const tipDot = polarPoint(CX, CY, 26, valueAngle);
  // Rim bevel: a light arc where the (upper-left) light source would catch
  // the ring's edge, a dark arc on the opposite side where it falls into
  // its own shadow -- this is what actually reads as "a curved metal ring",
  // as distinct from surface grain/texture (which the material filter
  // already handles). A radial gradient alone is rotationally symmetric and
  // can't produce this directional light/shadow split on its own.
  const bevelHighlightPath = knobArcPath(CX, CY, 31, -110, 20);
  const bevelShadowPath = knobArcPath(CX, CY, 31, 70, 200);

  // Tick ring: dim graduations, brightening up to the current value.
  const TICKS = 11;
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const a = KNOB_START_ANGLE + (i / (TICKS - 1)) * (KNOB_END_ANGLE - KNOB_START_ANGLE);
    const lit = a <= valueAngle + 0.5;
    return { p1: polarPoint(CX, CY, 40, a), p2: polarPoint(CX, CY, 36, a), lit };
  });

  const handleDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startVal = param.value;
    const onMove = (ev: MouseEvent) => {
      const dy = startY - ev.clientY;
      // Shift = fine adjustment: same drag distance covers a smaller slice
      // of the range, matching the "hold shift to be precise" convention
      // used across professional plugin UIs.
      const delta = (applyFineAdjust(dy, ev.shiftKey) / 140) * range;
      const next = clampToRange(startVal + delta, param.min, param.max);
      onChange(param.id, parseFloat(next.toFixed(4)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = wheelStepDelta(range, e.shiftKey) * wheelDirection(e.deltaY);
    onChange(param.id, parseFloat(clampToRange(param.value + step, param.min, param.max).toFixed(4)));
  };
  useNonPassiveWheel(dragRef, handleWheel);

  const handleReset = () => onChange(param.id, param.defaultValue);

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div
        ref={dragRef}
        className="relative w-16 h-16 cursor-ns-resize"
        onMouseDown={handleDrag}
        onDoubleClick={handleReset}
        title="Drag up/down (shift = fine, wheel = step, double-click = reset)"
      >
        <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
          <defs>
            {/* Domed brushed-metal cap: light from top-left. */}
            <radialGradient id={`cap-${uid}`} cx="38%" cy="30%" r="72%">
              <stop offset="0%" stopColor="#4a4a54" />
              <stop offset="45%" stopColor="#2b2b32" />
              <stop offset="100%" stopColor="#111114" />
            </radialGradient>
            {/* Beveled rim. */}
            <radialGradient id={`rim-${uid}`} cx="50%" cy="22%" r="80%">
              <stop offset="0%" stopColor="#5a5a66" />
              <stop offset="60%" stopColor="#2a2a30" />
              <stop offset="100%" stopColor="#0c0c0e" />
            </radialGradient>
            <filter id={`sh-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
              {/* Cast shadow onto the panel -- strengthened (from dy=2.5/
                  stdDeviation=2.5) so the knob visibly sits ABOVE the
                  faceplate instead of looking painted flush onto it. */}
              <feDropShadow dx="0" dy="3.5" stdDeviation="3.2" floodColor="#000" floodOpacity="0.6" />
            </filter>
            {/* Soft glossy highlight, screen-blended onto the cap so it
                brightens the material underneath instead of flattening it
                to solid white -- the "domed, catching the light" pop a
                textured-but-flat disc doesn't have on its own. */}
            <radialGradient id={`hl-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Value track + glowing fill */}
          <path d={knobArcPath(CX, CY, TRACK_R, KNOB_START_ANGLE, KNOB_END_ANGLE)} fill="none" stroke="#242429" strokeWidth="4.5" strokeLinecap="round" />
          <path
            d={knobArcPath(CX, CY, TRACK_R, KNOB_START_ANGLE, valueAngle)}
            fill="none"
            stroke={accent}
            strokeWidth="4.5"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${accent}cc)` }}
          />

          {/* Graduation ticks */}
          {ticks.map((t, i) => (
            <line key={i} x1={t.p1.x} y1={t.p1.y} x2={t.p2.x} y2={t.p2.y}
              stroke={t.lit ? accent : "#3a3a42"} strokeWidth="1.5" strokeLinecap="round"
              opacity={t.lit ? 0.9 : 0.6} />
          ))}

          {/* Rim + cap (with elevation shadow) */}
          <circle cx={CX} cy={CY} r="31" fill={`url(#rim-${uid})`} filter={`url(#sh-${uid})`} />
          {/* Rim bevel: light/shadow arcs give the ring real curvature,
              independent of the cap's own surface material. */}
          <path d={bevelHighlightPath} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" />
          <path d={bevelShadowPath} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="1.8" strokeLinecap="round" />
          {/* Cap: real seeded material (grain + embossed lighting) painted
              over the base gradient. */}
          <circle cx={CX} cy={CY} r="27" fill={`url(#cap-${uid})`} filter={matFilterUrl} />
          {/* Glossy highlight on top of the material -- screen blend so it
              pops without erasing the grain/relief underneath. */}
          <ellipse cx="41" cy="35" rx="12" ry="8" fill={`url(#hl-${uid})`} style={{ mixBlendMode: "screen" }} />

          {/* Indicator: dark groove + bright line + accent tip */}
          <line x1={grooveStart.x} y1={grooveStart.y} x2={grooveEnd.x} y2={grooveEnd.y} stroke="#0a0a0c" strokeWidth="4.5" strokeLinecap="round" />
          <line x1={grooveStart.x} y1={grooveStart.y} x2={grooveEnd.x} y2={grooveEnd.y} stroke="#f2f2f6" strokeWidth="2" strokeLinecap="round" />
          <circle cx={tipDot.x} cy={tipDot.y} r="2.4" fill={accent} style={{ filter: `drop-shadow(0 0 3px ${accent})` }} />
        </svg>
      </div>
      <span className="text-[10px] font-semibold text-neutral-200 truncate max-w-[76px] text-center leading-tight tracking-tight">{param.name}</span>
      {isEditingValue ? (
        <input
          type="number"
          defaultValue={param.value}
          min={param.min}
          max={param.max}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const parsed = parseFloat(e.currentTarget.value);
            if (!Number.isNaN(parsed)) onChange(param.id, clampToRange(parsed, param.min, param.max));
            setIsEditingValue(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setIsEditingValue(false);
          }}
          className="w-16 text-[9px] font-mono text-neutral-100 tabular-nums bg-neutral-900 border border-indigo-500 rounded px-1.5 py-0.5 outline-none text-center"
        />
      ) : (
        <span
          onClick={() => setIsEditingValue(true)}
          title="Click to enter an exact value"
          className="text-[9px] font-mono text-neutral-400 tabular-nums bg-neutral-900/60 border border-neutral-800/80 rounded px-1.5 py-0.5 cursor-text hover:border-neutral-600 hover:text-neutral-200 transition-colors"
        >
          {Number(param.value.toFixed(2))} {param.unit}
        </span>
      )}
    </div>
  );
}

function ToggleControl({ param, onChange }: ControlProps) {
  const on = param.value > param.min;
  // SliderControl/ToggleControl are pure inline-CSS <div>s (no <svg>), so
  // they can't reference a page-level <filter> by url(#id) the way
  // KnobControl can -- instead they layer the same seeded material's grain
  // as a second background-image, blended over the existing gradient.
  const { materialId, seedString } = useContext(MaterialContext);
  const texture = materialTextureDataUri(materialId, seedString);
  const trackGradient = on
    ? `linear-gradient(180deg, ${param.accentColor || "#f97316"}, ${param.accentColor || "#c2410c"}bb)`
    : "linear-gradient(180deg, #18181b, #18181b)";
  return (
    <button
      type="button"
      onClick={() => onChange(param.id, on ? param.min : param.max)}
      className="flex flex-col items-center gap-1.5 select-none cursor-pointer"
      aria-pressed={on}
    >
      <div
        className="w-12 h-6 rounded-full p-0.5 transition-colors duration-150"
        style={{
          backgroundImage: `url("${texture}"), ${trackGradient}`,
          backgroundBlendMode: "overlay",
          boxShadow: on
            ? `inset 0 1px 2px rgba(0,0,0,0.35), 0 0 10px ${(param.accentColor || "#f97316")}66`
            : "inset 0 1.5px 3px rgba(0,0,0,0.7)",
        }}
      >
        <div
          className={`w-5 h-5 rounded-full transition-transform duration-150 ${on ? "translate-x-6" : "translate-x-0"}`}
          style={{ background: "radial-gradient(circle at 35% 28%, #fdfdff, #d4d4d8 70%, #a1a1aa)", boxShadow: "0 1.5px 3px rgba(0,0,0,0.5)" }}
        />
      </div>
      <span className="text-[10px] font-semibold text-neutral-200 truncate max-w-[80px] text-center tracking-tight">{param.name}</span>
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
      className={`aspect-square w-full rounded-xl border flex flex-col items-center justify-center gap-1 select-none transition-all duration-75 cursor-pointer ${
        active ? "scale-95 text-white border-white/20" : "text-neutral-400 border-white/5 hover:border-white/10"
      }`}
      style={
        active
          ? {
              background: `radial-gradient(circle at 40% 30%, ${(param.accentColor || "#f97316")}, ${(param.accentColor || "#c2410c")} 70%)`,
              boxShadow: `0 0 22px ${(param.accentColor || "#f97316")}aa, inset 0 1px 3px rgba(255,255,255,0.25)`,
            }
          : {
              background: "radial-gradient(circle at 40% 28%, #26262c, #161619 70%)",
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.05), 0 2px 4px rgba(0,0,0,0.4)",
            }
      }
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
  const dragRef = useRef<HTMLDivElement | null>(null);

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

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = wheelStepDelta(range, e.shiftKey) * wheelDirection(e.deltaY);
    onChange(param.id, Math.round(clampToRange(param.value + step, param.min, param.max)));
  };
  useNonPassiveWheel(dragRef, handleWheel);

  return (
    <div className="w-full rounded-xl border-2 border-neutral-800 bg-neutral-950 p-2 select-none">
      <div className="flex justify-between items-baseline mb-1.5 px-0.5">
        <span className="text-[8px] uppercase tracking-widest text-neutral-500 font-mono">🎙️ {param.name}</span>
        <span className="text-[9px] font-mono text-neutral-500">
          {Number(param.value.toFixed(0))} {param.unit}
        </span>
      </div>
      <div
        ref={dragRef}
        className="relative w-full h-6 rounded-lg bg-neutral-900 border border-neutral-850 cursor-ew-resize overflow-hidden"
        onMouseDown={handleDrag}
        onDoubleClick={() => onChange(param.id, param.defaultValue)}
        title="Drag (wheel = step, double-click = reset)"
      >
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
  const eqBands = findEqBands(allParams, param.id);

  if (eqBands.length >= 2) {
    const curve = computeEqCurve(allParams, param, width, height);
    const handleNodeDrag = (
      e: React.MouseEvent<SVGCircleElement>,
      freqParamId: string | undefined,
      freqMin: number | undefined,
      freqMax: number | undefined,
      gainParamId: string,
      gainMin: number,
      gainMax: number
    ) => {
      e.stopPropagation();
      const svg = (e.currentTarget.closest("svg") as SVGSVGElement) || null;
      const bound = svg?.getBoundingClientRect();
      if (!bound) return;
      // Shift = fine adjustment on the GAIN axis only (frequency stays at
      // normal sensitivity -- a node's vertical position is the harder one
      // to place precisely by ear). Position-based drag, so "fine" blends
      // toward the dB value the drag started at, same approach as the
      // slider's ratio-blend above.
      const startDb = yPixelToDb(((e.clientY - bound.top) / bound.height) * height, height);
      const update = (clientX: number, clientY: number, shiftHeld: boolean) => {
        if (freqParamId) {
          const hz = xPixelToHz(((clientX - bound.left) / bound.width) * width, width);
          onChange(freqParamId, Math.round(Math.max(freqMin!, Math.min(freqMax!, hz))));
        }
        const rawDb = yPixelToDb(((clientY - bound.top) / bound.height) * height, height);
        const db = shiftHeld ? startDb + applyFineAdjust(rawDb - startDb, true) : rawDb;
        onChange(gainParamId, Math.max(gainMin, Math.min(gainMax, Math.round(db * 10) / 10)));
      };
      update(e.clientX, e.clientY, e.shiftKey);
      const onMove = (ev: MouseEvent) => update(ev.clientX, ev.clientY, ev.shiftKey);
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
          <path d={`${curve.pathD} L ${width},${height / 2} L 0,${height / 2} Z`} fill={param.accentColor || "#10b981"} fillOpacity="0.12" stroke="none" />
          <path d={curve.pathD} fill="none" stroke={param.accentColor || "#10b981"} strokeWidth="2" />
          {curve.nodes.map((node) => (
            <circle
              key={node.gainParamId}
              cx={node.x}
              cy={node.y}
              r="6"
              fill={param.accentColor || "#10b981"}
              stroke="#fff"
              strokeWidth="1.5"
              className={node.freqParamId ? "cursor-move" : "cursor-ns-resize"}
              onMouseDown={(e) => handleNodeDrag(e, node.freqParamId, node.freqParamMin, node.freqParamMax, node.gainParamId, node.gainParamMin, node.gainParamMax)}
            />
          ))}
        </svg>
        <div className="flex justify-between px-1 pt-0.5">
          <span className="text-[9px] font-mono text-neutral-500">{param.name}</span>
          <span className="text-[9px] font-mono text-neutral-500">{curve.nodes.length}-Band</span>
        </div>
      </div>
    );
  }

  // Fallback: single cutoff/resonance marker (unchanged).
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
  const range = param.max - param.min || 1;
  const pct = Math.max(0, Math.min(1, (param.value - param.min) / range));
  const accent = param.accentColor || ACCENT_FALLBACK;
  const [isEditingValue, setIsEditingValue] = useState(false);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const { materialId, seedString } = useContext(MaterialContext);
  const texture = materialTextureDataUri(materialId, seedString);

  const handleDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const bound = e.currentTarget.getBoundingClientRect();
    // Shift = fine adjustment. This is a position-absolute (not delta-based)
    // drag, so "fine" means blending toward the ratio the drag STARTED at --
    // the same physical mouse travel then only moves the value a fraction as
    // far, instead of jumping straight to the cursor's raw position.
    const dragStartRatio = pct;
    const update = (clientX: number, shiftHeld: boolean) => {
      const rawRatio = clampToRange((clientX - bound.left) / bound.width, 0, 1);
      const ratio = shiftHeld
        ? clampToRange(dragStartRatio + applyFineAdjust(rawRatio - dragStartRatio, true), 0, 1)
        : rawRatio;
      onChange(param.id, parseFloat((param.min + ratio * range).toFixed(4)));
    };
    update(e.clientX, e.shiftKey);
    const onMove = (ev: MouseEvent) => update(ev.clientX, ev.shiftKey);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = wheelStepDelta(range, e.shiftKey) * wheelDirection(e.deltaY);
    onChange(param.id, parseFloat(clampToRange(param.value + step, param.min, param.max).toFixed(4)));
  };
  useNonPassiveWheel(dragRef, handleWheel);

  return (
    <div className="block select-none">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-neutral-200 truncate pr-2 tracking-tight">{param.name}</span>
        {isEditingValue ? (
          <input
            type="number"
            defaultValue={param.value}
            min={param.min}
            max={param.max}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const parsed = parseFloat(e.currentTarget.value);
              if (!Number.isNaN(parsed)) onChange(param.id, clampToRange(parsed, param.min, param.max));
              setIsEditingValue(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setIsEditingValue(false);
            }}
            className="w-16 text-[10px] font-mono text-neutral-100 tabular-nums shrink-0 bg-neutral-900 border border-indigo-500 rounded px-1.5 py-0.5 outline-none text-center"
          />
        ) : (
          <span
            onClick={() => setIsEditingValue(true)}
            title="Click to enter an exact value"
            className="text-[10px] font-mono text-neutral-400 tabular-nums shrink-0 bg-neutral-900/60 border border-neutral-800/80 rounded px-1.5 py-0.5 cursor-text hover:border-neutral-600 hover:text-neutral-200 transition-colors"
          >
            {Number(param.value.toFixed(2))} {param.unit}
          </span>
        )}
      </div>
      {/* Recessed track with inner shadow, glowing accent fill, metallic grip */}
      <div
        ref={dragRef}
        className="relative h-6 flex items-center cursor-ew-resize group"
        onMouseDown={handleDrag}
        onDoubleClick={() => onChange(param.id, param.defaultValue)}
        role="slider"
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={param.value}
        aria-label={param.name}
        title="Drag left/right (shift = fine, wheel = step, double-click = reset)"
      >
        <div
          className="absolute inset-x-0 h-2 rounded-full bg-neutral-950 border border-black/60"
          style={{
            backgroundImage: `url("${texture}")`,
            backgroundBlendMode: "overlay",
            boxShadow: "inset 0 1.5px 3px rgba(0,0,0,0.8)",
          }}
        />
        <div
          className="absolute left-0 h-2 rounded-full"
          style={{ width: `${pct * 100}%`, background: `linear-gradient(90deg, ${accent}88, ${accent})`, boxShadow: `0 0 8px ${accent}99` }}
        />
        <div
          className="absolute w-4 h-4 rounded-full -translate-x-1/2 border border-black/50 transition-transform group-active:scale-110"
          style={{
            left: `${pct * 100}%`,
            background: "radial-gradient(circle at 35% 28%, #56565f, #26262c 60%, #131316)",
            boxShadow: `0 1.5px 3px rgba(0,0,0,0.6), 0 0 0 1.5px ${accent}55`,
          }}
        />
      </div>
    </div>
  );
}

/** A discrete swatch/segmented-button control for a "select" param -- real
 *  value/onChange, unlike the cosmetic amp/cab customizer swatches in
 *  UIDesigner.tsx (those set only a decorative label field no DSP ever
 *  reads). Each button snaps the param to an exact integer step; the DSP
 *  body branches on that same integer (see e.g. AMP_CHANNEL's headType/
 *  cabType in offlineBuilder.ts), so what you click is what changes the
 *  sound -- not a label next to an unwired knob. */
function SelectControl({ param, onChange }: ControlProps) {
  const accent = param.accentColor || ACCENT_FALLBACK;
  const steps = param.max - param.min + 1;
  const choices = param.choices && param.choices.length === steps ? param.choices : Array.from({ length: steps }, (_, i) => String(param.min + i));
  const current = Math.round(clampToRange(param.value, param.min, param.max));

  return (
    <div className="block select-none">
      <div className="text-[11px] font-semibold text-neutral-200 truncate pr-2 tracking-tight mb-1.5">{param.name}</div>
      <div className="flex gap-1" role="radiogroup" aria-label={param.name}>
        {choices.map((label, i) => {
          const stepValue = param.min + i;
          const active = stepValue === current;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(param.id, stepValue)}
              className="flex-1 text-[10px] font-bold py-1.5 rounded-md border transition-colors cursor-pointer"
              style={
                active
                  ? { background: `${accent}26`, borderColor: accent, color: accent }
                  : { background: "transparent", borderColor: "#27272a", color: "#a1a1aa" }
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
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
    case "select":
      return <SelectControl param={param} allParams={allParams} onChange={onChange} />;
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
