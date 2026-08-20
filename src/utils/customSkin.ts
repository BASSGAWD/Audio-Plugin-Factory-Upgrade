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
  boxShadow?: string;
  fontFamily: string;
}

/**
 * Resolves a plugin's customSkin into a plain CSS style object. Always
 * fully-defaulted (never returns undefined fields except boxShadow) --
 * matching the artboard's own historical behavior of forcing a coherent dark
 * baseline (#111116 / #1f1f29 / #ffffff / Inter) even with no customSkin set
 * at all, so refactoring the artboard to call this helper is byte-for-byte
 * behavior-preserving there. boxShadow is the one genuinely optional field:
 * it stays undefined unless glowStyle is "neon", matching prior behavior.
 */
export function resolveCustomSkinStyle(customSkin: CustomSkin | undefined): ResolvedSkinStyle {
  return {
    backgroundColor: customSkin?.bgColor || "#111116",
    borderColor: customSkin?.borderColor || "#1f1f29",
    borderWidth: `${customSkin?.borderWidth ?? 4}px`,
    borderStyle: "solid",
    color: customSkin?.textColor || "#ffffff",
    backgroundImage: customSkin?.bgImage ? `url(${customSkin.bgImage})` : "none",
    backgroundSize: "cover",
    backgroundPosition: "center",
    boxShadow: customSkin?.glowStyle === "neon" ? `0 0 30px ${customSkin?.accentColor || "#10b981"}` : undefined,
    fontFamily: resolveSkinFontFamily(customSkin?.fontStyle),
  };
}
