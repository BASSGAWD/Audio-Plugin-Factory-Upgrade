import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AudioPlugin, PluginParameter, VisualIdentityRecipe } from "../types";
import { computeFilterCurve, computeEqCurve, findEqBands, xPixelToHz, yPixelToDb, computeWaveformPath, waveShapeLabel } from "../utils/controlVisuals";
import { applyFineAdjust, wheelStepDelta, wheelDirection, clampToRange } from "../utils/controlInteraction";
import { METER_BALLISTICS, MeterBallistics, ballisticsStep } from "../utils/uiRenderPatterns";
import { useNonPassiveWheel } from "../hooks/useNonPassiveWheel";
import { MaterialContext, materialFilterId, materialTextureDataUri, shadowOffset, highlightOffset } from "../utils/materialVisuals";
import { ManualContext } from "../utils/featureManifest";
import { effectiveKnobToken, evaluateEqIdentityMotion, identityKnobStyle } from "../utils/visualIdentity";
import { KNOB_RECIPES } from "../utils/uiRenderPatterns";

export const VisualIdentityContext = createContext<VisualIdentityRecipe | null>(null);
export const ResolvedKnobContext = createContext<Record<string, VisualIdentityRecipe["knob"]>>({});

/**
 * Playback-time control rendering shared by Simple Mode. Mirrors the visual
 * vocabulary the Pro UI Designer already has (knob, toggle, meter, pad,
 * amp head, cabinet, mic position, EQ curve, waveform display) so a
 * generated plugin looks like what it actually is everywhere in the app,
 * not just inside the Designer tab. No drag-to-reposition here -- these are
 * fixed-layout, interact-to-play widgets.
 */

export interface ControlProps {
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
  const identity = useContext(VisualIdentityContext);
  const resolvedKnobs = useContext(ResolvedKnobContext);
  const effectiveKnob = effectiveKnobToken(resolvedKnobs[param.id], identity?.knob || "pointer");
  const knobRecipe = KNOB_RECIPES[identityKnobStyle(effectiveKnob)];
  const capStops = knobRecipe.bodyGradient.stops;
  const indicatorColor = knobRecipe.indicator.colorFromAccent ? accent : knobRecipe.indicator.fixedColor || accent;
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
    <div className="flex flex-col items-center gap-1.5 select-none" data-knob-recipe={effectiveKnob}>
      <div
        ref={dragRef}
        className="relative w-16 h-16 cursor-ns-resize"
        onMouseDown={handleDrag}
        onDoubleClick={handleReset}
        title="Drag up/down (shift = fine, wheel = step, double-click = reset)"
      >
        {/* Drilled-hole mount: a recessed ring sunk into the panel BEHIND
            the knob's own rim (rendered first so the SVG paints over it),
            so the knob reads as sitting IN a hole cut for it rather than
            floating on top of a flat panel. Shadow direction derives from
            the shared light model, same as every other recess on the
            faceplate. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle at 50% 50%, transparent 58%, rgba(0,0,0,0.35) 68%, rgba(0,0,0,0.14) 82%, transparent 92%)",
            boxShadow: `inset ${shadowOffset(2.2).x}px ${shadowOffset(2.2).y}px 4px rgba(0,0,0,0.5)`,
          }}
        />
        <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
          <defs>
            {/* Domed brushed-metal cap: light from top-left. */}
            <radialGradient id={`cap-${uid}`} cx="38%" cy="30%" r="72%">
              {capStops.map((stop) => <stop key={stop.pos} offset={`${stop.pos * 100}%`} stopColor={stop.color} />)}
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
                  faceplate instead of looking painted flush onto it.
                  Direction now derives from the shared light model
                  (shadowOffset) instead of a fixed straight-down dy, so it
                  falls the same way every other lit surface on the
                  faceplate does. distance=6.1 preserves the original
                  drop's ~3.5px magnitude (sqrt(x^2+y^2)) at the new angle. */}
              <feDropShadow dx={shadowOffset(6.1).x} dy={shadowOffset(6.1).y} stdDeviation="3.2" floodColor="#000" floodOpacity="0.6" />
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
          {knobRecipe.indicator.kind === "dashring" ? <path d={knobArcPath(CX, CY, 35, KNOB_START_ANGLE, valueAngle)} fill="none" stroke={indicatorColor} strokeWidth="3" strokeDasharray="3,2" /> :
            <line x1={grooveStart.x} y1={grooveStart.y} x2={grooveEnd.x} y2={grooveEnd.y} stroke={indicatorColor} strokeWidth={Math.max(2, knobRecipe.indicator.widthFraction * 40)} strokeLinecap="round" />}
          <circle cx={tipDot.x} cy={tipDot.y} r={knobRecipe.indicator.kind === "dot" ? 4 : 2.4} fill={indicatorColor} style={{ filter: `drop-shadow(0 0 3px ${indicatorColor})` }} />
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

// Zone color per segment index (bottom -> top), matching the old
// continuous gradient's emerald -> amber -> rose progression.
const METER_SEGMENTS = 12;
function meterSegmentColor(i: number): string {
  return i < 7 ? "#10b981" : i < 10 ? "#fbbf24" : "#f43f5e";
}

function MeterControl({ param, analyserNode, isPlaying }: ControlProps) {
  const range = param.max - param.min || 1;
  const staticPct = Math.max(0, Math.min(1, (param.value - param.min) / range));
  const liveLevel = useSignalLevel(analyserNode, isPlaying);
  const isLive = liveLevel !== null;
  const pct = isLive ? liveLevel : staticPct;
  const identity = useContext(VisualIdentityContext);
  const style = identity?.meter || "segmented-peak";
  const accent = param.accentColor || ACCENT_FALLBACK;

  const meterVisual = style === "needle" ? (
    <svg viewBox="0 0 100 62" className="w-24 h-16 rounded bg-[#d8c9a4] border border-neutral-700">
      <path d="M12 53 A42 42 0 0 1 88 53" fill="none" stroke="#463f34" strokeWidth="2" />
      <line x1="50" y1="54" x2={50 + Math.sin((pct - .5) * 1.8) * 38} y2={54 - Math.cos((pct - .5) * 1.8) * 38} stroke="#9b231b" strokeWidth="2" />
      <circle cx="50" cy="54" r="4" fill="#29231d" />
    </svg>
  ) : style === "plasma-bar" ? (
    <div className="w-8 h-16 rounded-lg bg-neutral-950 border border-neutral-800 relative overflow-hidden">
      <div className="absolute inset-x-1 bottom-1 rounded-md" style={{ height: `${pct * 90}%`, background: `linear-gradient(0deg, ${accent}, #e879f9, #67e8f9)`, boxShadow: `0 0 10px ${accent}` }} />
    </div>
  ) : style === "scope-stereo" ? (
    <svg viewBox="0 0 100 62" className="w-24 h-16 rounded bg-neutral-950 border border-neutral-800">
      <path d={`M4 31 C 18 ${31-pct*25}, 30 ${31+pct*20}, 48 31 S 76 ${31-pct*24}, 96 31`} fill="none" stroke={accent} strokeWidth="2" />
      <path d={`M4 34 C 25 ${34+pct*16}, 38 ${34-pct*19}, 52 34 S 78 ${34+pct*18}, 96 34`} fill="none" stroke="#67e8f9" strokeOpacity=".65" />
    </svg>
  ) : (
    <div className="w-6 h-16 rounded-md bg-neutral-950 border border-neutral-800 relative overflow-hidden flex flex-col-reverse gap-[1.5px] p-1"
      // Recess shadow direction now derives from the shared light model
      // (shadowOffset) instead of a fixed straight-down inset, so it's
      // shaded consistently with every other recessed surface on the
      // faceplate.
      style={{ boxShadow: `inset ${shadowOffset(1.7).x}px ${shadowOffset(1.7).y}px 3px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.03)` }}>
      {Array.from({ length: METER_SEGMENTS }).map((_, i) => {
        const lit = pct * METER_SEGMENTS > i;
        const color = meterSegmentColor(i);
        return <div key={i} className="flex-1 rounded-[1px] transition-[background-color,box-shadow] duration-75"
          style={{ backgroundColor: lit ? color : `${color}22`, boxShadow: lit ? `0 0 4px ${color}bb` : "none" }} />;
      })}
    </div>
  );

  // Discrete LED-style segments instead of one continuous gradient fill --
  // real hardware VU/peak meters read as individually lit cells. Same
  // ballistics (pct, from useSignalLevel/ballisticsStep) and the same
  // emerald/amber/rose zones as before -- this is a render-only change.
  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="relative" data-meter-recipe={style}>
        {meterVisual}
        {isLive && <div className={`absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-emerald-400 ${identity?.motionPolicy === "decorative" ? "animate-pulse" : ""}`} title="Live signal" />}
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
  // Same seeded material grain KnobControl/SliderControl/ToggleControl
  // already have -- layered over both rest/active gradients so a pad
  // doesn't stand out as the one un-textured surface on the faceplate.
  const { materialId, seedString } = useContext(MaterialContext);
  const texture = materialTextureDataUri(materialId, seedString);
  return (
    <button
      type="button"
      className={`aspect-square w-full rounded-xl border flex flex-col items-center justify-center gap-1 select-none transition-all duration-75 cursor-pointer ${
        active ? "scale-95 text-white border-white/20" : "text-neutral-400 border-white/5 hover:border-white/10"
      }`}
      style={
        active
          ? {
              backgroundImage: `url("${texture}"), radial-gradient(circle at 40% 30%, ${(param.accentColor || "#f97316")}, ${(param.accentColor || "#c2410c")} 70%)`,
              backgroundBlendMode: "overlay",
              boxShadow: `0 0 22px ${(param.accentColor || "#f97316")}aa, inset 0 1px 3px rgba(255,255,255,0.25)`,
            }
          : {
              backgroundImage: `url("${texture}"), radial-gradient(circle at 40% 28%, #26262c, #161619 70%)`,
              backgroundBlendMode: "overlay",
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

// Exported so RigStack.tsx can compose these three into a real amp rig
// (head sitting on top of cab, mic in front) instead of PluginControl's own
// dispatch switch positioning them as independent, uncoordinated boxes.
export function AmpHeadControl({ param }: ControlProps) {
  // The hero of every amp_sim build. A real head is a tolex-wrapped BOX with
  // a recessed, brightly-lit control fascia across its face and a jewel lamp
  // -- not a flat card with text on it, which is what this used to render.
  // Tolex comes from ampTolexPattern (already populated, previously only a
  // text label) so the head and its cabinet visibly match.
  const tolex = TOLEX_CSS[param.ampTolexPattern || "leather"] || TOLEX_CSS.leather;
  const accent = param.accentColor || "#ef4444";
  const glowing = param.ampTubeGlow;

  return (
    <div
      data-amp-head="true"
      data-tolex={param.ampTolexPattern || "leather"}
      className="w-full rounded-lg select-none relative overflow-hidden"
      style={{
        backgroundColor: tolex.color,
        backgroundImage: tolex.image,
        backgroundSize: tolex.size,
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,0.1), inset 0 -3px 0 rgba(0,0,0,0.55), inset 2px 0 0 rgba(255,255,255,0.04), inset -2px 0 0 rgba(0,0,0,0.4), 0 10px 22px rgba(0,0,0,0.55)",
        padding: 9,
      }}
    >
      {/* Recessed control fascia -- the lit plate a real head's knobs mount
          through. Sunk into the box, not sitting on top of it. */}
      <div
        className="rounded-sm px-3 py-2.5 flex items-center gap-3"
        style={{
          background: "linear-gradient(178deg, #2f3238 0%, #1d1f24 55%, #141619 100%)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.75), inset 0 -1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[7.5px] uppercase tracking-[0.22em] text-neutral-500 font-mono">Amp Head</div>
          <div
            className="text-[15px] font-black uppercase tracking-tight truncate leading-tight"
            style={{
              color: param.textColor || "#e8e8ec",
              // Engraved: dark shadow below, faint light above.
              textShadow: "0 1px 0 rgba(0,0,0,0.8), 0 -0.5px 0 rgba(255,255,255,0.12)",
            }}
          >
            {param.customText || param.name}
          </div>
          <div className="text-[8.5px] font-mono text-neutral-500 mt-0.5 capitalize tracking-wide">
            {param.ampChannelType || "crunch"} channel
          </div>
        </div>

        {/* Jewel lamp: a real domed indicator, lit when the tubes are warm */}
        <div
          className="w-6 h-6 rounded-full shrink-0 relative"
          style={{
            background: glowing
              ? `radial-gradient(circle at 34% 30%, #fff8, ${accent} 45%, ${accent}bb 70%, #1a0708)`
              : `radial-gradient(circle at 34% 30%, #ffffff22, ${accent}55 45%, ${accent}33 70%, #140607)`,
            boxShadow: glowing
              ? `0 0 14px ${accent}cc, 0 0 4px ${accent}, inset 0 -1px 3px rgba(0,0,0,0.6)`
              : "inset 0 -1px 3px rgba(0,0,0,0.6)",
            border: "2px solid #23262b",
          }}
          title={glowing ? "Tubes warm" : "Standby"}
        />
      </div>

      {/* Vent slots along the top of the chassis */}
      <div aria-hidden="true" className="flex gap-1 justify-center mt-1.5 opacity-40">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="w-3 h-[2px] rounded-full" style={{ background: "rgba(0,0,0,0.6)", boxShadow: "0 1px 0 rgba(255,255,255,0.07)" }} />
        ))}
      </div>
    </div>
  );
}

/** How many speakers a cab size actually has, and how to arrange them.
 *  `cabSize` was already populated on every amp build and only ever drove a
 *  text label -- a "4x12" and a "1x12" rendered the identical widget. */
const CAB_LAYOUTS: Record<string, { count: number; cols: number }> = {
  "1x12": { count: 1, cols: 1 },
  "2x12": { count: 2, cols: 2 },
  "4x12": { count: 4, cols: 2 },
  "8x10": { count: 8, cols: 2 },
};

/** Tolex is the vinyl covering on a real cabinet. `ampTolexPattern` was also
 *  already populated and also only drove a label. */
const TOLEX_CSS: Record<string, { color: string; image: string; size: string }> = {
  leather: { color: "#241a13", image: "radial-gradient(rgba(255,255,255,0.05) 0.5px, transparent 0.6px), radial-gradient(rgba(0,0,0,0.35) 0.5px, transparent 0.6px)", size: "5px 5px, 8px 8px" },
  carbon: { color: "#14161a", image: "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.4) 0 1px, transparent 1px 5px)", size: "10px 10px, 10px 10px" },
  tweed: { color: "#a8862f", image: "repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 4px)", size: "8px 8px, 8px 8px" },
  wood: { color: "#43291a", image: "repeating-linear-gradient(92deg, rgba(0,0,0,0.3) 0 4px, transparent 4px 10px), repeating-linear-gradient(88deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 27px)", size: "80px 100%, 130px 100%" },
  snakeskin: { color: "#2a2620", image: "repeating-linear-gradient(60deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 7px), repeating-linear-gradient(-60deg, rgba(0,0,0,0.35) 0 2px, transparent 2px 7px)", size: "12px 12px, 12px 12px" },
  metalgrid: { color: "#2c2f34", image: "repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgba(0,0,0,0.4) 0 1px, transparent 1px 6px)", size: "12px 12px, 12px 12px" },
};

export function CabinetControl({ param }: ControlProps) {
  // A real cabinet: tolex-covered box, grille cloth stretched over the
  // baffle, and the ACTUAL number of speakers its cabSize names -- a 4x12
  // shows four drivers, a 1x12 shows one. Both cabSize and ampTolexPattern
  // were already populated on every amp build and previously only appeared
  // as text, so a 1x12 and an 8x10 rendered an identical widget.
  const layout = CAB_LAYOUTS[param.cabSize || "4x12"] || CAB_LAYOUTS["4x12"];
  const tolex = TOLEX_CSS[param.ampTolexPattern || "leather"] || TOLEX_CSS.leather;
  const coneTint = param.accentColor || "#6b6152";

  return (
    <div
      data-cab-size={param.cabSize || "4x12"}
      data-tolex={param.ampTolexPattern || "leather"}
      className="w-full rounded-lg select-none relative overflow-hidden"
      style={{
        backgroundColor: tolex.color,
        backgroundImage: tolex.image,
        backgroundSize: tolex.size,
        // A box, not a card: thick tolex-wrapped edges, lit from the same
        // upper-left the rest of the faceplate is lit from.
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,0.09), inset 0 -3px 0 rgba(0,0,0,0.55), inset 2px 0 0 rgba(255,255,255,0.04), inset -2px 0 0 rgba(0,0,0,0.4), 0 10px 22px rgba(0,0,0,0.55)",
        padding: 10,
      }}
    >
      {/* Corner hardware -- real cabs have metal corner protectors */}
      {[
        { top: 3, left: 3 }, { top: 3, right: 3 }, { bottom: 3, left: 3 }, { bottom: 3, right: 3 },
      ].map((pos, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute w-3 h-3 pointer-events-none"
          style={{
            ...pos,
            background: "linear-gradient(135deg, #8b8b93, #3a3a42 60%, #1a1a1f)",
            clipPath: i === 0 ? "polygon(0 0,100% 0,0 100%)" : i === 1 ? "polygon(100% 0,100% 100%,0 0)" : i === 2 ? "polygon(0 0,0 100%,100% 100%)" : "polygon(100% 0,100% 100%,0 100%)",
            opacity: 0.85,
          }}
        />
      ))}

      {/* Grille cloth over the baffle, with the speakers behind it */}
      <div
        className="rounded-sm p-2"
        style={{
          backgroundColor: "#15130f",
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 3px)",
          backgroundSize: "3px 3px, 3px 3px",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8), inset 0 -1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="grid gap-2 mx-auto" style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, maxWidth: layout.cols === 1 ? 90 : 150 }}>
          {Array.from({ length: layout.count }).map((_, i) => (
            <div key={i} className="aspect-square rounded-full relative" style={{
              // A speaker: dark surround, lit cone, dust cap in the middle.
              background: `radial-gradient(circle at 38% 32%, ${coneTint}dd, ${coneTint}66 42%, #15120e 70%, #0a0908)`,
              boxShadow: "inset 0 2px 5px rgba(0,0,0,0.75), 0 1px 0 rgba(255,255,255,0.06)",
            }}>
              <div
                aria-hidden="true"
                className="absolute rounded-full"
                style={{
                  inset: "34%",
                  background: "radial-gradient(circle at 35% 30%, #6d6459, #2a251f 65%, #14110d)",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.6)",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-2 mt-2 px-0.5">
        <span className="text-[10px] font-black uppercase tracking-tight truncate text-neutral-200">{param.customText || param.name}</span>
        <span className="ml-auto text-[9px] font-mono text-neutral-400/80 shrink-0">
          {param.cabSize || "4x12"} · {param.cabMicModel || "SM57"}
        </span>
      </div>
    </div>
  );
}

export function MicPositionControl({ param, onChange }: ControlProps) {
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
  const identity = useContext(VisualIdentityContext);
  const movingRef = useRef<SVGGElement | null>(null);
  useEffect(() => {
    if (!identity || !movingRef.current || typeof requestAnimationFrame === "undefined" || identity.motionPolicy === "static") return;
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (movingRef.current) movingRef.current.style.transform = `translateY(${evaluateEqIdentityMotion(identity, (now - start) / 1000, reduced).toFixed(2)}px)`;
      if (!reduced) frame = requestAnimationFrame(tick);
    };
    tick(start);
    return () => cancelAnimationFrame(frame);
  }, [identity]);
  const curveStyle = identity?.eqMotion || "static";
  const dash = curveStyle === "scan" ? "7 3" : curveStyle === "ripple" ? "3 2" : undefined;

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
      <div className="w-full rounded-xl border border-neutral-850 bg-neutral-950 p-1.5 select-none" data-eq-recipe={curveStyle}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ aspectRatio: `${width}/${height}` }}>
          <g ref={movingRef}>
          <path d={`${curve.pathD} L ${width},${height / 2} L 0,${height / 2} Z`} fill={param.accentColor || "#10b981"} fillOpacity="0.12" stroke="none" />
          <path d={curve.pathD} fill="none" stroke={param.accentColor || "#10b981"} strokeWidth="2" strokeDasharray={dash} />
          </g>
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
    <div className="w-full rounded-xl border border-neutral-850 bg-neutral-950 p-1.5 select-none" data-eq-recipe={curveStyle}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ aspectRatio: `${width}/${height}` }}>
        <g ref={movingRef}>
        <path d={`${curve.pathD} L ${width},${height} L 0,${height} Z`} fill={param.accentColor || "#10b981"} fillOpacity="0.12" stroke="none" />
        <path d={curve.pathD} fill="none" stroke={param.accentColor || "#10b981"} strokeWidth="2" strokeDasharray={dash} />
        </g>
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

/** Dispatches a single parameter to its right-shaped playback control. Also
 *  where "in-plugin instructions" and first-launch guide badges attach --
 *  ONE place, so every control kind gets both without touching Knob/Slider/
 *  Toggle/Meter/etc. individually. */
export const PluginControl: React.FC<ControlProps> = ({ param, allParams, onChange, analyserNode, isPlaying }) => {
  // Read unconditionally, before any early return below -- hooks must run
  // in the same order on every render regardless of which branch a given
  // parameter's controlType takes (Rules of Hooks).
  const { entries, guideActive, dismissedParamIds, dismissGuide } = useContext(ManualContext);

  const rendered = (() => {
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
  })();

  // Labels are decorative dividers, not real controls -- no manual entry,
  // no tooltip, no guide badge makes sense on one.
  if (param.controlType === "label") return rendered;

  const entry = entries.find((e) => e.paramId === param.id);
  const showGuideBadge =
    guideActive && !!entry && (entry.tier === "required" || entry.tier === "expected") && !dismissedParamIds.has(param.id);

  return (
    <div className="relative" title={entry?.purpose}>
      {rendered}
      {showGuideBadge && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dismissGuide(param.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-500 ring-2 ring-neutral-950 animate-pulse cursor-pointer z-10"
          title={entry?.purpose}
          aria-label={`Tip for ${entry?.name}: ${entry?.purpose}`}
        />
      )}
    </div>
  );
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
