/**
 * The visual-craft knowledge base: control-rendering RECIPES, not markup.
 *
 * guiArchetypes.ts owns layout (x/y/w/h position math, explicitly no color
 * or style). uiSpec.ts owns flat theme TOKENS (one bg/border/accent/text/font
 * bundle per category or attribute, no rendering math). Neither owns
 * per-control RENDERING -- how a knob's body actually shades, where its
 * indicator sits, what a panel's surface texture looks like. That logic
 * exists today, richly, but only as inline JSX inside UIDesigner.tsx
 * (chickenhead/silvercap/neonring/vintage knob styles, tolex/grill
 * textures) -- scoped to the amp/cab widget alone, and with zero equivalent
 * anywhere in the generated C++ plugin. This is the missing third layer.
 *
 * Every recipe here is described as RENDERER-AGNOSTIC NUMBERS -- gradient
 * stops, angles, dash formulas, ballistics constants -- specifically so a
 * CSS/SVG consumer (the browser) and a juce::Graphics consumer (the
 * compiled plugin) draw from the SAME source numbers instead of two
 * independently-drifting implementations. That is the only way "the
 * compiled plugin matches the web preview" can be a true claim, and it is
 * what keeps the design ORIGINAL: these are generic style-family names and
 * hand-authored gradient/bevel/ballistics math, never a specific product's
 * actual artwork, branding, or color values.
 *
 * Pure functions and data only, like controlVisuals.ts and guiArchetypes.ts
 * -- safe to import from the browser AND from server/nativeBuild.ts.
 */

/* ------------------------------------------------------------------ */
/* Knobs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Generalizes the amp-only 5-style vocabulary (ampKnobStyle:
 * chickenhead/silvercap/pointer/neonring/vintage) to every control type.
 * "pointer" -> "modern_pointer" is a backward-compatible rename; a caller
 * still holding the literal string "pointer" should map it to
 * "modern_pointer" (see resolveKnobStyle below), not treat it as unknown.
 */
export type KnobRenderStyle = "modern_pointer" | "chickenhead" | "silvercap" | "neonring" | "vintage_amber";

export interface GradientStop {
  pos: number; // 0..1
  color: string; // hex
}

export interface KnobRenderRecipe {
  style: KnobRenderStyle;
  label: string;
  bodyGradient: { type: "radial" | "linear"; angleDeg?: number; stops: GradientStop[] };
  /** The rotating indicator -- a line (pointer), a dot, or an SVG dash-ring
   *  arc. colorFromAccent: true means the indicator/ring tints from the
   *  plugin's own accentColor rather than a fixed color, matching the
   *  existing neonring/pointer behavior. */
  indicator: { kind: "line" | "dot" | "dashring"; lengthFraction: number; widthFraction: number; colorFromAccent: boolean; fixedColor?: string };
  rim: { outerWidthFraction: number; innerWidthFraction: number; shadeDelta: number };
  /** Degrees, matching the existing -135..135 (270-degree) sweep every
   *  knob in this project already uses. */
  sweep: { startAngleDeg: number; endAngleDeg: number };
}

export const KNOB_RECIPES: Record<KnobRenderStyle, KnobRenderRecipe> = {
  modern_pointer: {
    style: "modern_pointer",
    label: "Modern Pointer",
    bodyGradient: { type: "linear", angleDeg: 180, stops: [{ pos: 0, color: "#5c5c5c" }, { pos: 1, color: "#232326" }] },
    indicator: { kind: "line", lengthFraction: 0.32, widthFraction: 0.05, colorFromAccent: true, fixedColor: "#d4af37" },
    rim: { outerWidthFraction: 0.04, innerWidthFraction: 0, shadeDelta: -18 },
    sweep: { startAngleDeg: -135, endAngleDeg: 135 },
  },
  chickenhead: {
    style: "chickenhead",
    label: "Chicken Head",
    // The bespoke tapered-pointer shape (a dark rooster-comb silhouette)
    // isn't a plain gradient-disc -- the body gradient here approximates
    // its dark cap; the SHAPE distinction lives in the indicator (a wide
    // triangular pointer, not a thin line) so a renderer that can only do
    // circles+indicators still reads as "chickenhead family," not identical
    // pixels to the hand-drawn web version.
    bodyGradient: { type: "radial", stops: [{ pos: 0, color: "#2b2b2b" }, { pos: 1, color: "#0d0d0d" }] },
    indicator: { kind: "line", lengthFraction: 0.5, widthFraction: 0.12, colorFromAccent: false, fixedColor: "#f5f5f4" },
    rim: { outerWidthFraction: 0.03, innerWidthFraction: 0, shadeDelta: -10 },
    sweep: { startAngleDeg: -135, endAngleDeg: 135 },
  },
  silvercap: {
    style: "silvercap",
    label: "Silver-cap Dome",
    bodyGradient: { type: "linear", angleDeg: 45, stops: [{ pos: 0, color: "#a3a3a3" }, { pos: 0.5, color: "#f5f5f4" }, { pos: 1, color: "#737373" }] },
    indicator: { kind: "line", lengthFraction: 0.22, widthFraction: 0.04, colorFromAccent: false, fixedColor: "#0a0a0a" },
    rim: { outerWidthFraction: 0.05, innerWidthFraction: 0, shadeDelta: -30 },
    sweep: { startAngleDeg: -135, endAngleDeg: 135 },
  },
  neonring: {
    style: "neonring",
    label: "Neon Ring Dial",
    bodyGradient: { type: "radial", stops: [{ pos: 0, color: "#171717" }, { pos: 1, color: "#0a0a0a" }] },
    indicator: { kind: "dashring", lengthFraction: 1, widthFraction: 0.06, colorFromAccent: true, fixedColor: "#10b981" },
    rim: { outerWidthFraction: 0.02, innerWidthFraction: 0, shadeDelta: -8 },
    sweep: { startAngleDeg: -135, endAngleDeg: 135 },
  },
  vintage_amber: {
    style: "vintage_amber",
    label: "Vintage Amber",
    bodyGradient: { type: "linear", angleDeg: 180, stops: [{ pos: 0, color: "#78350f" }, { pos: 1, color: "#451a03" }] },
    indicator: { kind: "dot", lengthFraction: 0.3, widthFraction: 0.06, colorFromAccent: false, fixedColor: "#fef3c7" },
    rim: { outerWidthFraction: 0.04, innerWidthFraction: 0.02, shadeDelta: -15 },
    sweep: { startAngleDeg: -135, endAngleDeg: 135 },
  },
};

/** Backward-compatible resolution: the legacy ampKnobStyle string "pointer"
 *  (and any other legacy alias) maps to the current KnobRenderStyle id, so
 *  existing plugin.parameters[].ampKnobStyle values keep resolving. */
export function resolveKnobStyle(raw: string | undefined | null): KnobRenderStyle {
  if (!raw) return "modern_pointer";
  if (raw === "pointer") return "modern_pointer";
  if (raw === "vintage") return "vintage_amber";
  if (raw in KNOB_RECIPES) return raw as KnobRenderStyle;
  return "modern_pointer";
}

/* ------------------------------------------------------------------ */
/* Panel textures                                                      */
/* ------------------------------------------------------------------ */

/** Generalizes ampTolexPattern (leather/carbon/tweed/wood/snakeskin/
 *  metalgrid) to a control-agnostic PANEL background usable on any plugin,
 *  plus 2 new originals for non-amp "studio gear" looks. */
export type PanelTextureStyle = "brushed_metal" | "leather_grain" | "carbon_weave" | "tweed_weave" | "wood_grain" | "matte_poly";

export interface PanelTextureRecipe {
  style: PanelTextureStyle;
  label: string;
  baseColor: string;
  microStructure: { kind: "diagonal_weave" | "brushed_lines" | "noise_specks" | "wood_bands"; scalePx: number; opacity: number };
}

export const PANEL_TEXTURE_RECIPES: Record<PanelTextureStyle, PanelTextureRecipe> = {
  brushed_metal: { style: "brushed_metal", label: "Brushed Metal", baseColor: "#3a3d42", microStructure: { kind: "brushed_lines", scalePx: 2, opacity: 0.08 } },
  leather_grain: { style: "leather_grain", label: "Leather Grain", baseColor: "#2b1d14", microStructure: { kind: "noise_specks", scalePx: 3, opacity: 0.14 } },
  carbon_weave: { style: "carbon_weave", label: "Carbon Weave", baseColor: "#16181c", microStructure: { kind: "diagonal_weave", scalePx: 6, opacity: 0.18 } },
  tweed_weave: { style: "tweed_weave", label: "Tweed Weave", baseColor: "#c9a227", microStructure: { kind: "diagonal_weave", scalePx: 4, opacity: 0.22 } },
  wood_grain: { style: "wood_grain", label: "Wood Grain", baseColor: "#4a2f1c", microStructure: { kind: "wood_bands", scalePx: 10, opacity: 0.16 } },
  matte_poly: { style: "matte_poly", label: "Matte Polymer", baseColor: "#1c1e22", microStructure: { kind: "noise_specks", scalePx: 1.5, opacity: 0.05 } },
};

/* ------------------------------------------------------------------ */
/* Meter ballistics (constants only this phase -- see METER_BALLISTICS   */
/* doc comment for what's deferred and why)                             */
/* ------------------------------------------------------------------ */

/** Original ballistics constants (not copied from any hardware spec sheet).
 *  Defined and unit-tested now because they're cheap, self-contained data;
 *  wiring them into a LIVE, animated meter (a thread-safe level value from
 *  processBlock + a repaint timer) is a materially larger real-time
 *  data-flow feature, deliberately deferred -- see the project plan. */
export interface MeterBallistics {
  attackMs: number;
  releaseMs: number;
  /** 0..1 -- how much the needle/segment overshoots and settles vs. moving
   *  monotonically to the target; 0 = no overshoot. */
  overshootDamping: number;
}

export const METER_BALLISTICS: Record<"vu_needle" | "led_segment_peak", MeterBallistics> = {
  vu_needle: { attackMs: 300, releaseMs: 300, overshootDamping: 0.35 },
  led_segment_peak: { attackMs: 3, releaseMs: 800, overshootDamping: 0 },
};

/* ------------------------------------------------------------------ */
/* Converters                                                           */
/* ------------------------------------------------------------------ */

function gradientStopsCss(stops: GradientStop[]): string {
  return stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(", ");
}

/** CSS-ready description of a knob recipe. Plain data (no React types, no
 *  framework dependency) -- a caller spreads bodyBackground into a style
 *  object and calls indicatorAngleDeg(value01) per render. */
export interface CssKnobStyle {
  bodyBackground: string; // ready CSS `background` value
  indicatorColor: string;
  indicatorLengthFraction: number;
  indicatorWidthFraction: number;
  indicatorKind: "line" | "dot" | "dashring";
  rimBorderCss: string; // ready CSS `border` value
  indicatorAngleDeg(value01: number): number;
}

export function toCssKnobStyle(recipe: KnobRenderRecipe, accentColor: string): CssKnobStyle {
  const bg =
    recipe.bodyGradient.type === "radial"
      ? `radial-gradient(circle, ${gradientStopsCss(recipe.bodyGradient.stops)})`
      : `linear-gradient(${recipe.bodyGradient.angleDeg ?? 180}deg, ${gradientStopsCss(recipe.bodyGradient.stops)})`;
  const indicatorColor = recipe.indicator.colorFromAccent ? accentColor || recipe.indicator.fixedColor || "#d4af37" : recipe.indicator.fixedColor || "#d4af37";
  return {
    bodyBackground: bg,
    indicatorColor,
    indicatorLengthFraction: recipe.indicator.lengthFraction,
    indicatorWidthFraction: recipe.indicator.widthFraction,
    indicatorKind: recipe.indicator.kind,
    rimBorderCss: `${Math.max(1, Math.round(recipe.rim.outerWidthFraction * 28))}px solid rgba(0,0,0,${Math.min(0.9, Math.abs(recipe.rim.shadeDelta) / 40)})`,
    indicatorAngleDeg: (value01: number) => recipe.sweep.startAngleDeg + Math.max(0, Math.min(1, value01)) * (recipe.sweep.endAngleDeg - recipe.sweep.startAngleDeg),
  };
}

/** Emits a real juce::Graphics paint snippet for one knob recipe. `propertyTag`
 *  is the LookAndFeel per-instance style key (see nativeBuild.ts's
 *  generateLookAndFeelCpp) this branch is guarded by. `value01Expr` is the
 *  C++ expression yielding the knob's normalized 0..1 value at paint time
 *  (JUCE's Slider LookAndFeel callback supplies this as `sliderPosProportional`). */
export function toJuceKnobPaintCode(recipe: KnobRenderRecipe, propertyTag: string): string {
  const stops = recipe.bodyGradient.stops;
  const cx = "bounds.getCentreX()";
  const cy = "bounds.getCentreY()";
  const radius = "juce::jmin (bounds.getWidth(), bounds.getHeight()) * 0.5f";
  const gradientCall =
    recipe.bodyGradient.type === "radial"
      ? `juce::ColourGradient (juce::Colour::fromString ("ff${stops[0].color.replace("#", "")}"), ${cx}, ${cy}, juce::Colour::fromString ("ff${stops[stops.length - 1].color.replace("#", "")}"), ${cx} + r, ${cy}, true)`
      : `juce::ColourGradient (juce::Colour::fromString ("ff${stops[0].color.replace("#", "")}"), bounds.getX(), bounds.getY(), juce::Colour::fromString ("ff${stops[stops.length - 1].color.replace("#", "")}"), bounds.getX(), bounds.getBottom(), false)`;

  const indicatorDraw =
    recipe.indicator.kind === "dashring"
      ? `        const float arcStart = juce::degreesToRadians (${recipe.sweep.startAngleDeg}.0f);
        const float arcEnd = juce::degreesToRadians (${recipe.sweep.startAngleDeg}.0f + sliderPosProportional * (${recipe.sweep.endAngleDeg}.0f - ${recipe.sweep.startAngleDeg}.0f));
        juce::Path ring;
        ring.addCentredArc (${cx}, ${cy}, r * 0.9f, r * 0.9f, 0.0f, arcStart, arcEnd, true);
        g.setColour (accentColour);
        g.strokePath (ring, juce::PathStrokeType (r * ${recipe.indicator.widthFraction}f));`
      : `        const float angle = juce::degreesToRadians (${recipe.sweep.startAngleDeg}.0f + sliderPosProportional * (${recipe.sweep.endAngleDeg}.0f - ${recipe.sweep.startAngleDeg}.0f));
        juce::Path pointer;
        pointer.addRectangle (-r * ${recipe.indicator.widthFraction}f * 0.5f, -r * ${recipe.indicator.lengthFraction}f, r * ${recipe.indicator.widthFraction}f * 0.5f, r * ${recipe.indicator.lengthFraction}f);
        g.setColour (${recipe.indicator.colorFromAccent ? "accentColour" : `juce::Colour::fromString ("ff${(recipe.indicator.fixedColor || "#d4af37").replace("#", "")}")`});
        g.fillPath (pointer, juce::AffineTransform::rotation (angle).translated (${cx}, ${cy}));`;

  return `    if (style == "${propertyTag}")
    {
        const auto bounds = juce::Rectangle<float> ((float) x, (float) y, (float) width, (float) height).reduced (2.0f);
        const float r = ${radius};
        g.setGradientFill (${gradientCall});
        g.fillEllipse (bounds);
        g.setColour (juce::Colours::black.withAlpha (${Math.min(0.9, Math.abs(recipe.rim.shadeDelta) / 40).toFixed(2)}f));
        g.drawEllipse (bounds, ${Math.max(1, Math.round(recipe.rim.outerWidthFraction * 28))}.0f);
${indicatorDraw}
    }`;
}

/**
 * Emits juce::Graphics paint code for a panel's surface TEXTURE. `baseColorHex`
 * is the fill color to texture over -- pass the plugin's OWN customSkin
 * background (not recipe.baseColor) so a caller's per-plugin background
 * customization survives; recipe.baseColor is only the fallback used when no
 * caller-supplied color is given (e.g. in isolated tests of the recipe on
 * its own). The texture is additive microstructure, not a replacement fill.
 */
export function toJucePanelPaintCode(recipe: PanelTextureRecipe, baseColorHex?: string): string {
  const base = (baseColorHex || recipe.baseColor).replace("#", "");
  const structureDraw = (() => {
    switch (recipe.microStructure.kind) {
      case "brushed_lines":
        return `    for (float lx = 0; lx < (float) getWidth(); lx += ${recipe.microStructure.scalePx}.0f)
        g.drawVerticalLine ((int) lx, 0.0f, (float) getHeight());`;
      case "diagonal_weave":
        return `    for (float d = -(float) getHeight(); d < (float) getWidth(); d += ${recipe.microStructure.scalePx}.0f)
        g.drawLine (d, 0.0f, d + (float) getHeight(), (float) getHeight(), 1.0f);`;
      case "wood_bands":
        return `    for (float wy = 0; wy < (float) getHeight(); wy += ${recipe.microStructure.scalePx}.0f)
        g.drawHorizontalLine ((int) wy, 0.0f, (float) getWidth());`;
      case "noise_specks":
      default: {
        // Deterministic seed derived from the style name (not a per-plugin
        // random draw) so the texture is stable across rebuilds of the
        // same style.
        let seed = 0;
        for (let i = 0; i < recipe.style.length; i++) seed = (seed * 31 + recipe.style.charCodeAt(i)) >>> 0;
        return `    juce::Random rng (0x${seed.toString(16)});
    for (int i = 0; i < 200; ++i)
        g.fillRect (rng.nextFloat() * (float) getWidth(), rng.nextFloat() * (float) getHeight(), ${recipe.microStructure.scalePx}.0f, ${recipe.microStructure.scalePx}.0f);`;
      }
    }
  })();
  return `    g.fillAll (juce::Colour::fromString ("ff${base}"));
    g.setColour (juce::Colours::black.withAlpha (${recipe.microStructure.opacity}f));
${structureDraw}`;
}
