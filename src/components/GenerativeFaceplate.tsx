import React, { useEffect, useMemo, useRef } from "react";
import { AudioPlugin } from "../types";
import { resolveCustomSkinStyle } from "../utils/customSkin";
import { resolveMaterial, materialFilterDefs, MaterialContext } from "../utils/materialVisuals";

/**
 * Interactive generative faceplate: every plugin gets a UNIQUE, procedurally
 * generated backdrop — seeded from its identity (stable across reloads),
 * patterned by its design attributes, colored by its theme — that breathes
 * with the audio while playing.
 *
 * Motion is driven entirely by ONE JS rAF loop writing directly to element
 * styles (transform / opacity) via refs — not CSS classes, not SMIL
 * (<animate>/<animateTransform>). Both of those depend on browser feature
 * support and timing that turned out to be unreliable in practice; a plain
 * rAF loop computing `sin(t)` and setting `el.style.transform` cannot
 * silently fail to animate the way a missing CSS class or an unsupported
 * SMIL attribute can. `prefers-reduced-motion` is still honored by skipping
 * the loop's motion math entirely (elements stay at their rest position).
 */

interface GenerativeFaceplateProps {
  plugin: AudioPlugin;
  analyserNode?: AnalyserNode | null;
  isPlaying?: boolean;
  className?: string;
  /** Extra inline styles merged in AFTER the resolved customSkin style, so a
   *  caller can override one piece of it (e.g. retinting its own border-top
   *  divider) without fighting the skin the faceplate already applies. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

// Exported so materialVisuals.ts's seeded turbulence/lighting recipes derive
// grain from the SAME per-plugin identity hash this file already uses for
// its background artwork -- one seed source for "this plugin's" procedural
// look, not two independently-invented ones.
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type PatternKind = "orbs" | "stripes" | "grain" | "grid" | "dots" | "arcs" | "contours";
const ATTRIBUTE_PATTERN: Record<string, PatternKind> = {
  dreamy: "orbs", aggressive: "stripes", vintage: "grain", futuristic: "grid",
  clinical: "dots", minimal: "dots", industrial: "stripes", luxurious: "arcs",
};
const CATEGORY_PATTERN: Record<AudioPlugin["category"], PatternKind> = {
  reverb: "orbs", delay: "contours", modulation: "contours", filter: "arcs",
  distortion: "stripes", dynamics: "grid", synthesizer: "orbs",
};

/** Per-element motion recipe, driven imperatively every rAF tick. */
type MoverSpec =
  | { kind: "drift"; dx: number; dy: number; period: number; phase: number }
  | { kind: "pulse"; minOp: number; maxOp: number; period: number; phase: number };

/** Pure function of elapsed seconds -> transform/opacity; unit-testable
 *  without a browser or a rendered DOM. */
export function evaluateMover(spec: MoverSpec, tSec: number): { transform?: string; opacity?: number } {
  if (spec.kind === "drift") {
    const w = Math.sin((2 * Math.PI * tSec) / spec.period + spec.phase);
    return { transform: `translate(${(spec.dx * w).toFixed(2)}px, ${(spec.dy * w).toFixed(2)}px)` };
  }
  const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * tSec) / spec.period + spec.phase);
  return { opacity: spec.minOp + (spec.maxOp - spec.minOp) * w };
}

/** Same "this plugin's identity" string buildArtwork already seeds its own
 *  RNG from -- reused verbatim so the background art and the controls'
 *  material grain/lighting derive from ONE identity concept, not two
 *  independently-invented ones. */
export function pluginSeedString(plugin: AudioPlugin): string {
  return `${plugin.name}::${plugin.category}::${plugin.parameters.length}`;
}

interface Artwork {
  node: React.ReactNode;
  movers: MoverSpec[];
  /** Parallel to movers[] — the live DOM node each spec should be applied
   *  to, populated via ref callbacks as React mounts the artwork. Returned
   *  alongside (not stashed on) the JSX node, since React elements are
   *  frozen in development mode and cannot carry extra properties. */
  elementRefs: Array<SVGElement | null>;
}

function buildArtwork(plugin: AudioPlugin): Artwork {
  const rand = mulberry32(hashString(`${plugin.name}::${plugin.category}::${plugin.parameters.length}`));
  const accent = plugin.customSkin?.accentColor || "#f97316";
  const border = plugin.customSkin?.borderColor || "#555";
  const attr = plugin.buildReport?.attributes?.[0];
  const pattern: PatternKind = (attr && ATTRIBUTE_PATTERN[attr]) || CATEGORY_PATTERN[plugin.category] || "contours";

  const W = 400, H = 200;
  const els: React.ReactNode[] = [];
  const movers: MoverSpec[] = [];
  const gradId = `gfp-g-${hashString(plugin.name) % 99999}`;
  const blurId = `gfp-b-${hashString(plugin.name) % 99999}`;
  const seedString = pluginSeedString(plugin);
  const materialId = resolveMaterial(plugin);

  els.push(
    <React.Fragment key="base">
      <defs>
        <radialGradient id={gradId} cx="30%" cy="0%" r="90%">
          <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
          <stop offset="55%" stopColor={accent} stopOpacity={0.06} />
          <stop offset="100%" stopColor="transparent" stopOpacity={0} />
        </radialGradient>
        <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        {/* Mounted once per rendered plugin -- every KnobControl/
            SliderControl/ToggleControl on this faceplate references this
            SAME filter id via MaterialContext (below), rather than each
            control re-generating its own copy of the recipe. */}
        {materialFilterDefs(materialId, seedString)}
      </defs>
      <rect width={W} height={H} fill={`url(#${gradId})`} />
    </React.Fragment>
  );

  // registerDrift/registerPulse push a MoverSpec and return a ref callback
  // that stores the live DOM node at the SAME index, so the rAF loop below
  // can zip movers[] with elementRefs.current[] one-to-one.
  const elementRefs: Array<SVGElement | null> = [];
  const registerDrift = (dx: number, dy: number, period: number): React.RefCallback<SVGGElement> => {
    const idx = movers.length;
    movers.push({ kind: "drift", dx, dy, period, phase: rand() * Math.PI * 2 });
    return (el) => { elementRefs[idx] = el; };
  };
  const registerPulse = (minOp: number, maxOp: number, period: number): React.RefCallback<SVGElement> => {
    const idx = movers.length;
    movers.push({ kind: "pulse", minOp, maxOp, period, phase: rand() * Math.PI * 2 });
    return (el) => { elementRefs[idx] = el; };
  };

  if (pattern === "orbs") {
    for (let i = 0; i < 6; i++) {
      els.push(
        <g key={i} ref={registerDrift(20 + rand() * 40, -(10 + rand() * 24), 7 + rand() * 8)}>
          <circle cx={rand() * W} cy={rand() * H} r={35 + rand() * 75} fill={accent}
            opacity={0.14 + rand() * 0.16} filter={`url(#${blurId})`} />
        </g>
      );
    }
  } else if (pattern === "stripes") {
    for (let i = 0; i < 10; i++) {
      const x = rand() * W * 1.4 - W * 0.2;
      els.push(
        <rect key={i} ref={registerPulse(0.12 + rand() * 0.1, 0.3 + rand() * 0.15, 3 + rand() * 4)}
          x={x} y={-40} width={4 + rand() * 16} height={H + 80} fill={i % 3 === 0 ? accent : border}
          opacity={0.16 + rand() * 0.18} transform={`rotate(${16 + rand() * 12} ${x} ${H / 2})`} />
      );
    }
  } else if (pattern === "grain") {
    for (let i = 0; i < 24; i++) {
      const y = rand() * H;
      els.push(<line key={i} x1={0} y1={y} x2={W} y2={y + rand() * 5 - 2.5} stroke={i % 4 === 0 ? accent : border} strokeWidth={0.8 + rand() * 1.6} opacity={0.12 + rand() * 0.16} />);
    }
    els.push(
      <g key="warm" ref={registerDrift(30, 0, 11)}>
        <circle cx={W * 0.75} cy={H * 0.4} r={90} fill={accent} opacity={0.12} filter={`url(#${blurId})`} />
      </g>
    );
  } else if (pattern === "grid") {
    for (let x = 0; x <= W; x += 25) els.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={H} stroke={accent} strokeWidth={0.6} opacity={0.14} />);
    for (let y = 0; y <= H; y += 25) els.push(<line key={`h${y}`} x1={0} y1={y} x2={W} y2={y} stroke={accent} strokeWidth={0.6} opacity={0.14} />);
    for (let i = 0; i < 8; i++) {
      els.push(
        <circle key={`n${i}`} ref={registerPulse(0.15, 0.85, 1.6 + rand() * 2.4)}
          cx={Math.round(rand() * 16) * 25} cy={Math.round(rand() * 8) * 25} r={3.5} fill={accent} opacity={0.6} />
      );
    }
  } else if (pattern === "dots") {
    for (let i = 0; i < 16; i++) {
      els.push(
        <circle key={i} ref={registerPulse(0.15, 0.5, 2.5 + rand() * 3)}
          cx={rand() * W} cy={rand() * H} r={1.5 + rand() * 2.5} fill={accent} opacity={0.3} />
      );
    }
  } else if (pattern === "arcs") {
    for (let i = 0; i < 7; i++) {
      const cx = rand() * W, cy = H + rand() * 50, r = 60 + rand() * 170;
      els.push(
        <circle key={i} ref={registerPulse(0.1 + rand() * 0.08, 0.28 + rand() * 0.1, 5 + rand() * 5)}
          cx={cx} cy={cy} r={r} fill="none" stroke={accent} strokeWidth={1.2 + rand() * 2} opacity={0.16 + rand() * 0.14} />
      );
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const amp = 12 + rand() * 30, freq = 1 + rand() * 3, phase = rand() * Math.PI * 2, base = 30 + rand() * (H - 60);
      let d = `M 0 ${base.toFixed(1)}`;
      for (let x = 0; x <= W; x += 10) d += ` L ${x} ${(base + Math.sin((x / W) * Math.PI * 2 * freq + phase) * amp).toFixed(1)}`;
      els.push(
        <g key={i} ref={registerDrift(-(16 + rand() * 24), 0, 8 + rand() * 8)}>
          <path d={d} fill="none" stroke={i % 2 === 0 ? accent : border} strokeWidth={1.4 + rand() * 1.4} opacity={0.2 + rand() * 0.18} />
        </g>
      );
    }
  }

  const node = (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
      {els}
    </svg>
  );
  return { node, movers, elementRefs };
}

/** Corner screw rotation angles -- fixed, not seeded: a slightly-imperfect
 *  "hand-tightened" look reads as authentic on every plugin without needing
 *  its own RNG plumbing (screws don't need to vary meaningfully by plugin
 *  identity the way the material/background art does). */
const SCREW_ANGLES = [18, -22, 32, -12] as const;

function ScrewHead({ corner, angle }: { corner: "tl" | "tr" | "bl" | "br"; angle: number }) {
  const pos: React.CSSProperties =
    corner === "tl" ? { top: 7, left: 7 } : corner === "tr" ? { top: 7, right: 7 } : corner === "bl" ? { bottom: 7, left: 7 } : { bottom: 7, right: 7 };
  return (
    <div
      aria-hidden="true"
      className="absolute rounded-full pointer-events-none"
      style={{
        ...pos,
        width: 9,
        height: 9,
        background: "radial-gradient(circle at 35% 30%, #86868f, #303036 65%, #131315)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.65), inset 0 0.5px 1px rgba(255,255,255,0.18)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "18%",
          width: "64%",
          height: 1.1,
          background: "rgba(0,0,0,0.6)",
          borderRadius: 1,
          transform: `translateY(-50%) rotate(${angle}deg)`,
        }}
      />
    </div>
  );
}

/**
 * Four corner screws + a small engraved nameplate -- the "this is a piece
 * of hardware, not a web card" cue virtually every skeuomorphic plugin
 * faceplate leans on (Neural DSP, Waves, and every rack/pedal emulation
 * puts real or implied fasteners at the corners and a brand/model plate
 * somewhere on the unit). Purely decorative -- pointer-events: none
 * throughout, so it never intercepts clicks meant for the actual controls
 * rendered on top of it.
 */
function ChassisDetails({ plugin, fontFamily, textColor }: { plugin: AudioPlugin; fontFamily: string; textColor: string }) {
  return (
    <>
      <ScrewHead corner="tl" angle={SCREW_ANGLES[0]} />
      <ScrewHead corner="tr" angle={SCREW_ANGLES[1]} />
      <ScrewHead corner="bl" angle={SCREW_ANGLES[2]} />
      <ScrewHead corner="br" angle={SCREW_ANGLES[3]} />
      <div
        aria-hidden="true"
        className="absolute pointer-events-none select-none"
        style={{
          bottom: 9,
          right: 22,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: textColor,
          opacity: 0.4,
          fontFamily,
          textShadow: "0 1px 0 rgba(255,255,255,0.07), 0 -1px 0 rgba(0,0,0,0.55)",
        }}
      >
        {plugin.name}
      </div>
    </>
  );
}

export default function GenerativeFaceplate({ plugin, analyserNode, isPlaying, className = "", style, children }: GenerativeFaceplateProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // borderColor is read inside buildArtwork() (used for some stroke colors)
  // but was missing from this dependency array -- changing it silently
  // failed to regenerate the artwork that actually uses it.
  const artwork = useMemo(
    () => buildArtwork(plugin),
    [plugin.id, plugin.name, plugin.category, plugin.customSkin?.accentColor, plugin.customSkin?.borderColor]
  );
  const accent = plugin.customSkin?.accentColor || "#f97316";
  const { elementRefs } = artwork;
  // Same values buildArtwork() already computed for the mounted <defs> --
  // recomputed here (cheap, pure, deterministic given the same plugin) so
  // the Context advertises the identical materialId/seed the filter was
  // actually generated with.
  const materialCtx = useMemo(
    () => ({ materialId: resolveMaterial(plugin), seedString: pluginSeedString(plugin) }),
    [plugin.name, plugin.category, plugin.parameters.length, plugin.buildReport?.attributes]
  );
  // The plugin's own configured skin -- background, border, font, static
  // glow. Unconditional (no theme gate the way the Pro artboard preview has
  // one): this is "the plugin" everywhere outside that preview, so whatever
  // customSkin is actually set on the plugin object should just render here.
  // Unset fields fall back to a coherent dark baseline, so this is a no-op
  // for any plugin that has never touched Custom Skin Settings.
  const skinStyle = useMemo(() => resolveCustomSkinStyle(plugin.customSkin), [plugin.customSkin]);

  // Single rAF loop: drives idle drift/pulse motion (always) and the
  // audio-reactive glow (only while playing). Pure JS DOM writes — no CSS
  // class, no SMIL — so it cannot fail to animate due to missing browser
  // feature support.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const data = analyserNode ? new Uint8Array(analyserNode.frequencyBinCount) : null;
    let raf = 0;
    let smoothed = 0;
    const start = performance.now();

    const tick = () => {
      const tSec = (performance.now() - start) / 1000;

      if (!reduceMotion) {
        for (let i = 0; i < artwork.movers.length; i++) {
          const target = elementRefs[i];
          if (!target) continue;
          const result = evaluateMover(artwork.movers[i], tSec);
          if (result.transform !== undefined) (target as any).style.transform = result.transform;
          if (result.opacity !== undefined) (target as any).style.opacity = String(result.opacity);
        }
      }

      if (isPlaying && analyserNode && data) {
        analyserNode.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = sum / (data.length * 255);
        smoothed += 0.25 * (level - smoothed);
      } else {
        smoothed += 0.25 * (0 - smoothed);
      }
      el.style.setProperty("--gfp-live", smoothed.toFixed(3));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyserNode, isPlaying, artwork]);

  return (
    <div ref={rootRef} className={`relative overflow-hidden ${className}`} style={{ ["--gfp-live" as any]: 0, ...skinStyle, ...style }}>
      {artwork.node}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none transition-opacity duration-150"
        style={{
          opacity: "calc(var(--gfp-live) * 1.0)",
          background: `radial-gradient(ellipse at 50% 115%, ${accent}55 0%, ${accent}18 40%, transparent 65%)`,
        }}
      />
      <ChassisDetails plugin={plugin} fontFamily={skinStyle.fontFamily} textColor={skinStyle.color} />
      <MaterialContext.Provider value={materialCtx}>
        <div className="relative">{children}</div>
      </MaterialContext.Provider>
    </div>
  );
}
