import React from "react";
import { AudioPlugin } from "../types";
import { hashString } from "../components/GenerativeFaceplate";

/**
 * Real skeuomorphic surface rendering -- procedural, seeded, zero external
 * assets. Same "infinite variation, zero licensing risk, deterministic per
 * plugin" idiom GenerativeFaceplate.tsx already proves for backgrounds
 * (buildArtwork() seeds a per-plugin RNG and generates bespoke SVG art every
 * time, forever), extended here to the actual controls: real `feTurbulence`
 * grain + `feDiffuseLighting`/`feSpecularLighting` embossed relief, instead
 * of the flat 2-gradient + one static highlight ellipse KnobControl used to
 * be limited to. A licensed bitmap asset pack was evaluated and rejected
 * (see the plan this shipped against) -- it can't scale to an unbounded
 * generation space and, for the strongest candidate found, its own license
 * explicitly excludes "customization/on-demand applications" (precisely
 * what this factory is). Procedural is the only shape of fix that actually
 * satisfies "every generation, forever."
 */

export type MaterialId = "brushed-metal" | "anodized-aluminum" | "wood-panel" | "matte-plastic" | "vintage-cream";

/** Attribute -> material. Checked before category, same precedence
 *  GenerativeFaceplate.tsx's ATTRIBUTE_PATTERN/CATEGORY_PATTERN already use
 *  (a model-supplied design attribute is more specific than the plugin's
 *  broad category). */
const MATERIAL_BY_ATTRIBUTE: Record<string, MaterialId> = {
  aggressive: "brushed-metal",
  industrial: "brushed-metal",
  dreamy: "anodized-aluminum",
  futuristic: "anodized-aluminum",
  vintage: "wood-panel",
  luxurious: "wood-panel",
  clinical: "matte-plastic",
  minimal: "matte-plastic",
};

/** Category fallback for plugins with no (or no matching) design attribute. */
const MATERIAL_BY_CATEGORY: Record<AudioPlugin["category"], MaterialId> = {
  distortion: "brushed-metal",
  delay: "anodized-aluminum",
  modulation: "anodized-aluminum",
  filter: "matte-plastic",
  dynamics: "matte-plastic",
  synthesizer: "anodized-aluminum",
  reverb: "vintage-cream",
};

/** Deterministic per-plugin material selection -- same plugin identity
 *  always resolves to the same material, every render, every session. */
export function resolveMaterial(plugin: AudioPlugin): MaterialId {
  const attr = plugin.buildReport?.attributes?.[0];
  if (attr && MATERIAL_BY_ATTRIBUTE[attr]) return MATERIAL_BY_ATTRIBUTE[attr];
  return MATERIAL_BY_CATEGORY[plugin.category] || "vintage-cream";
}

/**
 * What KnobControl/SliderControl/ToggleControl (PluginControl.tsx) read to
 * find the current plugin's resolved material + seed, without prop-drilling
 * it through every call site that renders <PluginControl>.
 * GenerativeFaceplate.tsx (which already wraps every control in both real
 * surfaces that render "the plugin" -- Simple Mode and Factory Canvas, per
 * customSkin.ts's own doc comment) provides the real value; this Context IS
 * the plumbing, not an addition on top of separate plumbing. Defaulted so a
 * control rendered with no GenerativeFaceplate ancestor still resolves to
 * something sane instead of crashing.
 */
export const MaterialContext = React.createContext<{ materialId: MaterialId; seedString: string }>({
  materialId: "matte-plastic",
  seedString: "default",
});

interface MaterialRecipe {
  /** feTurbulence baseFrequency, as "fx fy". Anisotropic (fx != fy) reads as
   *  directional brushing/grain; isotropic (fx == fy) reads as a uniform,
   *  finer noise (aluminum, plastic). */
  baseFrequency: string;
  numOctaves: number;
  /** feDiffuseLighting/feSpecularLighting surfaceScale -- how deep the
   *  embossed relief reads. Raised substantially from this recipe's first
   *  version: at the original values (well under 2.5) the relief was too
   *  faint to read as a material at normal viewing size -- confirmed by
   *  actually looking at a rendered knob, not just checking the filter
   *  compiled. Metal/wood want strong, unmistakable texture; plastic wants
   *  a lighter touch but still visibly non-flat. */
  surfaceScale: number;
  specColor: string;
  specConstant: number;
  specExponent: number;
}

const MATERIAL_RECIPES: Record<MaterialId, MaterialRecipe> = {
  "brushed-metal": { baseFrequency: "0.9 0.02", numOctaves: 2, surfaceScale: 6, specColor: "#ffffff", specConstant: 1.1, specExponent: 16 },
  "anodized-aluminum": { baseFrequency: "0.02 0.02", numOctaves: 3, surfaceScale: 3.2, specColor: "#eaf2ff", specConstant: 1, specExponent: 20 },
  "wood-panel": { baseFrequency: "0.015 0.15", numOctaves: 4, surfaceScale: 4.5, specColor: "#ffdca8", specConstant: 0.5, specExponent: 9 },
  "matte-plastic": { baseFrequency: "0.06 0.06", numOctaves: 2, surfaceScale: 1.8, specColor: "#ffffff", specConstant: 0.35, specExponent: 7 },
  "vintage-cream": { baseFrequency: "0.04 0.04", numOctaves: 3, surfaceScale: 2.4, specColor: "#fff6df", specConstant: 0.5, specExponent: 9 },
};

/** Contrast boost applied to the turbulence's alpha channel (the height map
 *  feDiffuseLighting/feSpecularLighting actually read) before lighting.
 *  feTurbulence's raw noise clusters too tightly around mid-value to
 *  produce a strong directional gradient on its own -- surfaceScale alone
 *  scales an already-shallow height map, it can't manufacture contrast that
 *  isn't there. This linear stretch (slope*x + intercept, midpoint-anchored
 *  at 0.5) is what actually makes the relief read as real material instead
 *  of a faint smudge. */
const CONTRAST_SLOPE = 2.1;
const CONTRAST_INTERCEPT = -0.55;

/** Fixed light direction (upper-left, matching KnobControl's existing
 *  radialGradient bias toward cx=38% cy=30%) shared by every material so
 *  lighting reads as consistent across a plugin's whole faceplate, not
 *  randomized per control. */
const LIGHT_AZIMUTH = 235;
const LIGHT_ELEVATION = 55;

/** The <filter> id a given (material, seed) pair resolves to. Exported
 *  separately from materialFilterDefs so a control (which only needs to
 *  WRITE `filter="url(#...)"`) and the one place that mounts the actual
 *  <filter> defs can independently compute the identical id without passing
 *  JSX between them. */
export function materialFilterId(materialId: MaterialId, seedString: string): string {
  return `material-${materialId}-${hashString(seedString) % 99999}`;
}

/**
 * The reusable <filter> definition for one plugin's resolved material.
 * Mount this ONCE per rendered plugin (inside an existing <defs> block --
 * GenerativeFaceplate.tsx's SVG background already has one) -- every
 * control on that plugin references the same filter id, so the def is not
 * duplicated per-knob.
 *
 * Chain: feTurbulence generates seeded grain -> feComponentTransfer boosts
 * its alpha contrast (raw turbulence is too flat for surfaceScale alone to
 * make a strong relief out of) -> feDiffuseLighting (lit white, i.e. a pure
 * grayscale AO/relief map, NOT a per-material color) + feSpecularLighting
 * (lit the material's own specular tint) emboss it into real 3D relief ->
 * each is feComposite'd with operator="in" against SourceGraphic so the
 * relief is clipped to whatever shape the filter is applied to (a circle, a
 * rounded rect) instead of painting a rectangular noise field -> the
 * grayscale relief is MULTIPLY-blended onto SourceGraphic (darkens/lightens
 * the knob's own accent-tinted gradient by the bump map, the way real
 * anodized aluminum keeps its color while showing brushed texture) and the
 * specular highlight is SCREEN-blended on top (a bright sheen that doesn't
 * blacken anything under it). This -- not the plain feMerge stack this
 * recipe started with -- is what keeps a plugin's own accent color/identity
 * visible THROUGH the material instead of the material opaquely replacing
 * it with a fixed generic color.
 */
export function materialFilterDefs(materialId: MaterialId, seedString: string): React.ReactElement {
  const id = materialFilterId(materialId, seedString);
  const r = MATERIAL_RECIPES[materialId];
  const seedNum = hashString(seedString) % 5000;
  return React.createElement(
    "filter",
    { key: id, id, x: "-30%", y: "-30%", width: "160%", height: "160%", colorInterpolationFilters: "sRGB" },
    React.createElement("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: r.baseFrequency,
      numOctaves: r.numOctaves,
      seed: seedNum,
      result: "noise",
    }),
    React.createElement(
      "feComponentTransfer",
      { in: "noise", result: "noiseContrast" },
      React.createElement("feFuncA", { type: "linear", slope: CONTRAST_SLOPE, intercept: CONTRAST_INTERCEPT })
    ),
    React.createElement(
      "feDiffuseLighting",
      { in: "noiseContrast", surfaceScale: r.surfaceScale, diffuseConstant: 1, lightingColor: "#ffffff", result: "diffuse" },
      React.createElement("feDistantLight", { azimuth: LIGHT_AZIMUTH, elevation: LIGHT_ELEVATION })
    ),
    React.createElement(
      "feSpecularLighting",
      {
        in: "noiseContrast",
        surfaceScale: r.surfaceScale,
        specularConstant: r.specConstant,
        specularExponent: r.specExponent,
        lightingColor: r.specColor,
        result: "spec",
      },
      React.createElement("feDistantLight", { azimuth: LIGHT_AZIMUTH, elevation: LIGHT_ELEVATION })
    ),
    React.createElement("feComposite", { in: "diffuse", in2: "SourceGraphic", operator: "in", result: "diffuseClipped" }),
    React.createElement("feComposite", { in: "spec", in2: "SourceGraphic", operator: "in", result: "specClipped" }),
    React.createElement("feBlend", { in: "SourceGraphic", in2: "diffuseClipped", mode: "multiply", result: "shaded" }),
    React.createElement("feBlend", { in: "shaded", in2: "specClipped", mode: "screen" })
  );
}

/**
 * A small standalone tileable grain texture, base64/URI-encoded as a plain
 * SVG string -- for the two controls (SliderControl, ToggleControl) that
 * are pure inline-CSS `<div>`s rather than `<svg>` elements, and so can't
 * reference a page-level `<filter>` def by `url(#id)` the way KnobControl
 * can. This is deliberately the SIMPLE half of the recipe (turbulence +
 * grayscale alpha, no lighting rig): applied as a low-opacity
 * `background-image` layer under the control's existing gradient via
 * `background-blend-mode`, it adds genuine seeded grain without requiring
 * those controls to become SVG or to gain a lighting/shape-clipping
 * pipeline they have no shape to clip against.
 */
export function materialTextureDataUri(materialId: MaterialId, seedString: string): string {
  const r = MATERIAL_RECIPES[materialId];
  const seedNum = hashString(seedString) % 5000;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
    `<filter id="t"><feTurbulence type="fractalNoise" baseFrequency="${r.baseFrequency}" numOctaves="${r.numOctaves}" seed="${seedNum}" result="n"/>` +
    `<feComponentTransfer in="n" result="nc"><feFuncA type="linear" slope="${CONTRAST_SLOPE}" intercept="${CONTRAST_INTERCEPT}"/></feComponentTransfer>` +
    `<feColorMatrix in="nc" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.85 0"/></filter>` +
    `<rect width="64" height="64" filter="url(#t)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
