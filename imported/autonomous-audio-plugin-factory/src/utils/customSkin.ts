import { AudioPlugin } from "../types";

/**
 * Single source of numbers for "what does this plugin's customSkin look like
 * as CSS" -- shared between the Pro artboard's own preview (UIDesigner.tsx,
 * gated behind its local theme==="custom-skin" selector) and the generative
 * faceplate that renders every plugin everywhere else in the app
 * (GenerativeFaceplate.tsx, used unconditionally by Simple Mode and Factory
 * Canvas). Before this, the artboard preview and "the plugin" elsewhere were
 * visually unrelated -- editing Custom Skin Settings had zero effect outside
 * the Pro artboard itself. Same relationship as uiRenderPatterns.ts's
 * renderer-agnostic knob/panel recipes, minus the JUCE/C++ codegen half:
 * this is CSS-only, shared across two React render targets instead of two
 * languages.
 */

type CustomSkin = AudioPlugin["customSkin"];
type FontStyle = NonNullable<CustomSkin>["fontStyle"];

/** Maps a customSkin fontStyle token to its actual CSS font-family stack.
 *  Verbatim extraction of the mapping the artboard's custom-skin preview has
 *  always used -- kept here as the single source. */
export function resolveSkinFontFamily(fontStyle?: FontStyle): string {
  switch (fontStyle) {
    case "mono":
      return "JetBrains Mono, monospace";
    case "grotesk":
      return "Space Grotesk, sans-serif";
    case "orbitron":
      return "Orbitron, sans-serif";
    case "serif":
      return "Georgia, serif";
    default:
      return "Inter, sans-serif";
  }
}

export interface ResolvedSkinStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth: string;
  borderStyle: "solid";
  color: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  /** Always defined now -- at minimum BEZEL_SHADOW's chassis groove, plus
   *  whatever glowStyle adds on top. */
  boxShadow: string;
  fontFamily: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/**
 * Turns `glowStyle` into a real, DISTINCT boxShadow per value. Previously
 * only "neon" produced anything -- "vintage"/"flat"/"shadow" silently
 * resolved to `undefined`, even though 5 of ATTRIBUTE_THEMES' 8 entries
 * (aggressive, clinical, industrial, vintage, luxurious -- see uiSpec.ts)
 * assign one of exactly those three values. Every plugin generated under
 * those attributes was rendering with no glow treatment at all, contrary to
 * what its own theme declared.
 */
export function resolveGlowBoxShadow(customSkin: CustomSkin | undefined): string | undefined {
  const accent = customSkin?.accentColor || "#10b981";
  switch (customSkin?.glowStyle) {
    case "neon":
      return `0 0 30px ${accent}`;
    case "shadow":
      // Directional drop shadow -- an offset, grounded shadow, distinct
      // from "neon"'s centered ambient glow.
      return "6px 10px 22px rgba(0,0,0,0.55)";
    case "vintage":
      // A soft, warm inset shadow -- a worn-in hardware look, not a glow.
      return "inset 0 2px 6px rgba(0,0,0,0.35), inset 0 -1px 0 rgba(255,255,255,0.05)";
    case "flat":
      // Deliberately flat: a crisp 1px inner highlight instead of any
      // shadow or glow -- "flat" is a real design choice, not "nothing".
      return "inset 0 0 0 1px rgba(255,255,255,0.06)";
    default:
      return undefined; // "none" or unset
  }
}

/**
 * Every faceplate gets this, unconditionally, on top of whatever glow it
 * has (or doesn't) -- a subtle inset groove reading as "recessed into a
 * housing" rather than "a flat card floating on the page". This is the
 * chassis-identity fix: before it, a plugin with glowStyle "none" had
 * literally zero shadow of any kind, indistinguishable from a plain web
 * div. Deliberately faint (this is a bezel, not a glow) so it never
 * competes with the actual glow treatment stacked on top of it.
 */
const BEZEL_SHADOW = "inset 0 0 0 1px rgba(255,255,255,0.05), inset 0 0 16px rgba(0,0,0,0.35)";

/**
 * Resolves a plugin's customSkin into a plain CSS style object. Always
 * fully-defaulted (never returns undefined fields except boxShadow) --
 * matching the artboard's own historical behavior of forcing a coherent dark
 * baseline (#111116 / #1f1f29 / #ffffff / Inter) even with no customSkin set
 * at all, so refactoring the artboard to call this helper is byte-for-byte
 * behavior-preserving there. boxShadow is now ALWAYS defined (at minimum,
 * BEZEL_SHADOW's chassis groove) -- glowStyle only controls what's stacked
 * ON TOP of that baseline, not whether a shadow exists at all.
 *
 * `bgOpacity` ("overlay alpha" per its own doc comment in types.ts) controls
 * how strongly a `bgImage` shows through, by layering a same-color scrim
 * over the image in the SAME `backgroundImage` CSS property (comma-
 * separated background layers) -- so a busy faceplate photo/texture can be
 * washed back so text/controls stay legible, without needing a second DOM
 * element. Unset (or 1) behaves EXACTLY as before this field existed: no
 * scrim layer, the image alone.
 */
export function resolveCustomSkinStyle(customSkin: CustomSkin | undefined): ResolvedSkinStyle {
  const bg = customSkin?.bgColor || "#111116";
  const opacity = Math.max(0, Math.min(1, customSkin?.bgOpacity ?? 1));
  const scrimAlpha = 1 - opacity;
  const backgroundImage = customSkin?.bgImage
    ? scrimAlpha > 0
      ? `linear-gradient(${hexToRgba(bg, scrimAlpha)}, ${hexToRgba(bg, scrimAlpha)}), url(${customSkin.bgImage})`
      : `url(${customSkin.bgImage})`
    : "none";
  return {
    backgroundColor: bg,
    borderColor: customSkin?.borderColor || "#1f1f29",
    borderWidth: `${customSkin?.borderWidth ?? 4}px`,
    borderStyle: "solid",
    color: customSkin?.textColor || "#ffffff",
    backgroundImage,
    backgroundSize: "cover",
    backgroundPosition: "center",
    boxShadow: [resolveGlowBoxShadow(customSkin), BEZEL_SHADOW].filter(Boolean).join(", "),
    fontFamily: resolveSkinFontFamily(customSkin?.fontStyle),
  };
}
