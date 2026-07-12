/**
 * Semantic UI specification stage (from the factory architecture doc):
 * the AI/classifier outputs MEANING — design attributes and control
 * priorities — and deterministic code turns that into pixels. Nothing here
 * touches coordinates; the quality gate's layout engine consumes this spec.
 */

import { PluginParameter } from "../types";

export type DesignAttribute =
  | "dreamy"
  | "aggressive"
  | "clinical"
  | "vintage"
  | "industrial"
  | "futuristic"
  | "minimal"
  | "luxurious";

const ATTRIBUTE_SIGNALS: Array<{ attribute: DesignAttribute; match: RegExp }> = [
  { attribute: "dreamy", match: /dream|ethereal|ambient|shimmer|glass|frozen|cloud|wash|floaty|celestial|lush/i },
  { attribute: "aggressive", match: /aggressive|metal|brutal|heavy|savage|shred|fuzz|destroy|extreme|violent/i },
  { attribute: "clinical", match: /clinical|surgical|precise|transparent|mastering|clean\b|accurate|reference/i },
  { attribute: "vintage", match: /vintage|retro|tape|analog|60s|70s|80s|classic|old.?school|dusty|lo.?fi|worn/i },
  { attribute: "industrial", match: /industrial|machine|mechanical|factory|concrete|harsh|raw\b|gritty/i },
  { attribute: "futuristic", match: /futur|cyber|neon|sci.?fi|space|alien|digital|hologra|synthwave/i },
  { attribute: "minimal", match: /minimal|simple|\bbare\b|essential|\bzen\b|clean lines|stripped/i },
  { attribute: "luxurious", match: /luxur|premium|gold|silk|velvet|expensive|boutique|high.?end|elegant/i },
];

/** Up to two attributes, in prompt-match order — combined, not templated. */
export function detectDesignAttributes(prompt: string): DesignAttribute[] {
  const found: DesignAttribute[] = [];
  for (const { attribute, match } of ATTRIBUTE_SIGNALS) {
    if (match.test(prompt)) found.push(attribute);
    if (found.length === 2) break;
  }
  return found;
}

export interface UiTheme {
  bg: string;
  border: string;
  accent: string;
  text: string;
  font: "sans" | "mono" | "serif" | "grotesk" | "orbitron";
  glowStyle: "none" | "neon" | "vintage" | "flat" | "shadow";
}

/** Each attribute maps to materials/typography/palette — combinable. */
export const ATTRIBUTE_THEMES: Record<DesignAttribute, UiTheme> = {
  dreamy: { bg: "#0d1020", border: "#3b4a7a", accent: "#93c5fd", text: "#e0e7ff", font: "serif", glowStyle: "neon" },
  aggressive: { bg: "#160808", border: "#7f1d1d", accent: "#ef4444", text: "#fecaca", font: "grotesk", glowStyle: "shadow" },
  clinical: { bg: "#0c0f11", border: "#374151", accent: "#a5f3fc", text: "#f3f4f6", font: "mono", glowStyle: "flat" },
  vintage: { bg: "#171008", border: "#78350f", accent: "#f59e0b", text: "#fde68a", font: "serif", glowStyle: "vintage" },
  industrial: { bg: "#101012", border: "#3f3f46", accent: "#a1a1aa", text: "#e4e4e7", font: "mono", glowStyle: "flat" },
  futuristic: { bg: "#0a0618", border: "#5b21b6", accent: "#e879f9", text: "#ede9fe", font: "orbitron", glowStyle: "neon" },
  minimal: { bg: "#0e0e0e", border: "#262626", accent: "#d4d4d4", text: "#f5f5f5", font: "sans", glowStyle: "none" },
  luxurious: { bg: "#120e08", border: "#713f12", accent: "#facc15", text: "#fef9c3", font: "serif", glowStyle: "shadow" },
};

/**
 * Combine detected attributes with the category fallback: the first
 * attribute sets the material (bg/border/text/font/glow), a second attribute
 * contributes its accent — a "dreamy aggressive" plugin gets glassy blues
 * with a hot accent rather than one of eight fixed templates.
 */
export function composeTheme(attributes: DesignAttribute[], fallback: UiTheme): UiTheme {
  if (attributes.length === 0) return fallback;
  const primary = ATTRIBUTE_THEMES[attributes[0]];
  if (attributes.length === 1) return primary;
  return { ...primary, accent: ATTRIBUTE_THEMES[attributes[1]].accent };
}

/** Musician-priority order: the controls people reach for first. */
const PRIMARY_PRIORITY = [
  "mix", "drive", "gain", "decay", "time", "cutoff", "freq", "pitch",
  "threshold", "rate", "space", "depth", "feedback", "tone", "level",
];

export interface UiSpecification {
  attributes: DesignAttribute[];
  /** "focus" = few controls, hero treatment; "grid" = dense panel. */
  layout: "focus" | "grid";
  primaryControls: string[];
  secondaryControls: string[];
}

function isRankable(p: PluginParameter): boolean {
  if (p.id.startsWith("pad_")) return false;
  const widgets = ["meter", "label", "waveform", "eq", "amp", "cab", "mic", "mic_stand", "pad", "button"];
  return !(p.controlType && widgets.includes(p.controlType));
}

/**
 * Semantic spec: which controls are primary (top three by musician priority)
 * vs secondary, plus the design attributes. Deterministic and instant.
 */
export function buildUiSpec(prompt: string, parameters: PluginParameter[]): UiSpecification {
  const rankable = parameters.filter(isRankable);
  const ranked = [...rankable].sort((a, b) => {
    const ra = PRIMARY_PRIORITY.indexOf(a.id);
    const rb = PRIMARY_PRIORITY.indexOf(b.id);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
  });
  const primary = ranked.slice(0, 3).map((p) => p.id);
  const secondary = ranked.slice(3).map((p) => p.id);
  return {
    attributes: detectDesignAttributes(prompt),
    layout: rankable.length <= 4 ? "focus" : "grid",
    primaryControls: primary,
    secondaryControls: secondary,
  };
}

/**
 * Deterministic ordering pass: primary controls first, remaining rankable
 * controls after, widgets/pads untouched at the end (their renderers group
 * them separately). The AI never dictates order — this does.
 */
export function orderParametersBySpec(parameters: PluginParameter[], spec: UiSpecification): PluginParameter[] {
  const rank = (p: PluginParameter): number => {
    if (!isRankable(p)) return 1000 + parameters.indexOf(p); // stable tail
    const pi = spec.primaryControls.indexOf(p.id);
    if (pi !== -1) return pi;
    const si = spec.secondaryControls.indexOf(p.id);
    return si === -1 ? 900 : 100 + si;
  };
  return [...parameters].sort((a, b) => rank(a) - rank(b));
}
