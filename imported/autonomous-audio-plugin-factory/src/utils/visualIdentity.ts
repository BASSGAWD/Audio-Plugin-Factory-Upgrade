import { AudioPlugin, VisualIdentityRecipe } from "../types";
import { KnobRenderStyle, PanelTextureStyle } from "./uiRenderPatterns";

/** The only recipe-token-to-renderer mapping. Web and JUCE import this rather
 * than independently guessing how a token should look. */
export const IDENTITY_PANEL_STYLE: Record<VisualIdentityRecipe["panel"], PanelTextureStyle> = {
  machined: "brushed_metal", tolex: "leather_grain", wood: "wood_grain", polymer: "matte_poly", glass: "glass",
};
export const IDENTITY_KNOB_STYLE: Record<VisualIdentityRecipe["knob"], KnobRenderStyle> = {
  pointer: "modern_pointer", silvercap: "silvercap", chickenhead: "chickenhead", neonring: "neonring", vintage: "vintage_amber",
};
export function identityPanelStyle(panel: VisualIdentityRecipe["panel"]): PanelTextureStyle { return IDENTITY_PANEL_STYLE[panel]; }
export function identityKnobStyle(knob: VisualIdentityRecipe["knob"]): KnobRenderStyle { return IDENTITY_KNOB_STYLE[knob]; }
/** Resolve legacy/user per-control customization once into the contract. */
export function effectiveKnobToken(explicit: string | null | undefined, fallback: VisualIdentityRecipe["knob"]): VisualIdentityRecipe["knob"] {
  if (!explicit) return fallback;
  const aliases: Record<string, VisualIdentityRecipe["knob"]> = {
    pointer: "pointer", modern_pointer: "pointer", silvercap: "silvercap",
    chickenhead: "chickenhead", neonring: "neonring", vintage: "vintage",
    vintage_amber: "vintage",
  };
  return aliases[explicit] || fallback;
}

export function identityHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const FAMILY_STYLE: Record<string, {
  words: string[]; tokens: string[]; motif: VisualIdentityRecipe["hardwareMotif"];
  artwork: VisualIdentityRecipe["artwork"][]; panel: VisualIdentityRecipe["panel"][];
  knob: VisualIdentityRecipe["knob"][]; eq: VisualIdentityRecipe["eqMotion"][];
  meter: VisualIdentityRecipe["meter"][];
}> = {
  amp_sim: { words: ["Valve", "Stack", "Foundry"], tokens: ["amplifier", "high-voltage"], motif: "rack", artwork: ["grain", "stripes"], panel: ["tolex", "wood"], knob: ["chickenhead", "vintage"], eq: ["breathing"], meter: ["needle", "segmented-peak"] },
  eq: { words: ["Contour", "Sculpt", "Phase"], tokens: ["spectral", "precision"], motif: "console", artwork: ["arcs", "grid"], panel: ["machined", "glass"], knob: ["silvercap", "pointer"], eq: ["ripple", "scan"], meter: ["scope-stereo", "segmented-peak"] },
  filter: { words: ["Contour", "Resonant", "Sweep"], tokens: ["spectral", "filter"], motif: "console", artwork: ["arcs", "contours"], panel: ["machined", "glass"], knob: ["pointer", "neonring"], eq: ["scan", "ripple"], meter: ["plasma-bar", "scope-stereo"] },
  dynamics: { words: ["Clamp", "Punch", "Level"], tokens: ["ballistics", "studio"], motif: "rack", artwork: ["grid", "dots"], panel: ["machined", "polymer"], knob: ["silvercap", "vintage"], eq: ["static"], meter: ["needle", "segmented-peak"] },
  modulation: { words: ["Orbit", "Motion", "Phase"], tokens: ["modulated", "kinetic"], motif: "pedal", artwork: ["contours", "orbs"], panel: ["polymer", "glass"], knob: ["neonring", "pointer"], eq: ["ripple", "breathing"], meter: ["scope-stereo", "plasma-bar"] },
  delay: { words: ["Echo", "Repeat", "Memory"], tokens: ["temporal", "feedback"], motif: "tape", artwork: ["contours", "grain"], panel: ["wood", "machined"], knob: ["vintage", "silvercap"], eq: ["scan", "breathing"], meter: ["plasma-bar", "needle"] },
  reverb: { words: ["Chamber", "Cloud", "Plate"], tokens: ["spatial", "diffuse"], motif: "space-unit", artwork: ["orbs", "arcs"], panel: ["glass", "machined"], knob: ["silvercap", "neonring"], eq: ["breathing", "ripple"], meter: ["plasma-bar", "scope-stereo"] },
  sampler: { words: ["Slice", "Deck", "Grain"], tokens: ["instrument", "sample"], motif: "instrument", artwork: ["dots", "grid"], panel: ["polymer", "wood"], knob: ["pointer", "silvercap"], eq: ["scan", "static"], meter: ["segmented-peak", "scope-stereo"] },
  synthesizer: { words: ["Oscilla", "Voltage", "Nova"], tokens: ["instrument", "synthesis"], motif: "instrument", artwork: ["grid", "orbs"], panel: ["glass", "polymer"], knob: ["neonring", "pointer"], eq: ["ripple", "scan"], meter: ["scope-stereo", "plasma-bar"] },
  distortion: { words: ["Drive", "Forge", "Riot"], tokens: ["saturated", "pedal"], motif: "pedal", artwork: ["stripes", "grain"], panel: ["polymer", "machined"], knob: ["pointer", "chickenhead"], eq: ["breathing"], meter: ["segmented-peak", "plasma-bar"] },
};
export const SUPPORTED_VISUAL_FAMILIES = Object.freeze(Object.keys(FAMILY_STYLE));
export const SUPPORTED_SOURCE_PLUGIN_FAMILIES = Object.freeze([
  "eq", "filter", "distortion", "saturator", "multiband_saturator",
  "delay", "reverb", "modulation", "dynamics", "synthesizer", "pitch",
  "amp_sim", "sampler", "utility", "hybrid_other",
]);

const SOURCE_FAMILY_TO_VISUAL: Readonly<Record<string, string>> = {
  saturator: "distortion",
  multiband_saturator: "eq",
  pitch: "synthesizer",
};

/** Canonicalize the full generation-family vocabulary into the smaller set
 * of renderer recipes. Unknown/custom families fall back through category so
 * persisted and hybrid plugins still get a supported identity. */
export function canonicalVisualFamily(sourceFamily?: string | null, category?: string | null): string {
  const mapped = sourceFamily ? SOURCE_FAMILY_TO_VISUAL[sourceFamily] || sourceFamily : "";
  if (SUPPORTED_VISUAL_FAMILIES.includes(mapped)) return mapped;
  if (category && SUPPORTED_VISUAL_FAMILIES.includes(category)) return category;
  return "filter";
}

const ATTRIBUTE_ARTWORK: Record<string, VisualIdentityRecipe["artwork"]> = {
  dreamy: "orbs", aggressive: "stripes", clinical: "dots", vintage: "grain",
  industrial: "stripes", futuristic: "grid", minimal: "dots", luxurious: "arcs",
};

function choose<T>(items: readonly T[], seed: number, shift = 0): T {
  return items[(seed >>> shift) % items.length];
}

/** Does not mutate or replace the explicit plugin name: modelLabel is an
 * optional engraved identity token for renderers. */
export function resolveVisualIdentity(plugin: AudioPlugin, familyHint?: string | null): VisualIdentityRecipe {
  const family = canonicalVisualFamily(familyHint || plugin.family, plugin.category);
  const style = FAMILY_STYLE[family] || FAMILY_STYLE[plugin.category] || FAMILY_STYLE.filter;
  const attrs = [...(plugin.buildReport?.attributes || [])].sort();
  const stableIdentity = plugin.id || `${plugin.name}::${plugin.createdAt}`;
  const seed = identityHash(`${stableIdentity}|${family}|${plugin.category}|${attrs.join(",")}`);
  return {
    version: "1.0",
    id: `vi1-${seed.toString(36)}`,
    seed,
    family,
    modelLabel: `${choose(style.words, seed)} ${String((seed % 89) + 10).padStart(2, "0")}`,
    styleTokens: [...style.tokens, ...attrs],
    hardwareMotif: style.motif,
    artwork: ATTRIBUTE_ARTWORK[attrs[0]] || choose(style.artwork, seed, 3),
    panel: choose(style.panel, seed, 7),
    knob: choose(style.knob, seed, 11),
    eqMotion: choose(style.eq, seed, 15),
    meter: choose(style.meter, seed, 19),
    motionPolicy: attrs.includes("minimal") || attrs.includes("clinical") ? "static" : "decorative",
    animation: {
      phase: Number(((seed % 6283) / 1000).toFixed(3)),
      tempo: Number((0.45 + ((seed >>> 8) % 110) / 100).toFixed(2)),
      amplitude: Number((0.35 + ((seed >>> 16) % 55) / 100).toFixed(2)),
    },
  };
}

/** Pure bounded motion math shared by render code and reduced-motion tests. */
export function evaluateEqIdentityMotion(recipe: VisualIdentityRecipe, seconds: number, reducedMotion: boolean): number {
  if (reducedMotion || recipe.motionPolicy === "static" || recipe.eqMotion === "static") return 0;
  const wave = Math.sin(seconds * recipe.animation.tempo * Math.PI * 2 + recipe.animation.phase);
  const shape = recipe.eqMotion === "ripple" ? wave * Math.cos(seconds * 0.7) : recipe.eqMotion === "scan" ? Math.sin(seconds * recipe.animation.tempo * Math.PI) : wave;
  return Math.max(-2.5, Math.min(2.5, shape * recipe.animation.amplitude * 2.5));
}