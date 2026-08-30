import { AudioPlugin, PluginParameter, ResolvedUiContract } from "../types";
import { rectsOverlap } from "./guiArchetypes";
import { resolveMaterial } from "./materialVisuals";
import { effectiveKnobToken, resolveVisualIdentity, SUPPORTED_VISUAL_FAMILIES } from "./visualIdentity";

export const RESOLVED_UI_VERSION = "1.0" as const;
const PAD = 28;
const GAP = 12;

function minimumSize(type: NonNullable<PluginParameter["controlType"]>): { w: number; h: number } {
  if (type === "amp" || type === "cab" || type === "mic" || type === "mic_stand") return { w: 180, h: 140 };
  if (type === "eq" || type === "waveform") return { w: 240, h: 120 };
  if (type === "pad") return { w: 72, h: 72 };
  if (type === "slider" || type === "select" || type === "number") return { w: 100, h: 64 };
  if (type === "toggle" || type === "button") return { w: 72, h: 52 };
  if (type === "meter" || type === "label") return { w: 72, h: 48 };
  return { w: 88, h: 88 };
}

function a11yRole(type: NonNullable<PluginParameter["controlType"]>): "slider" | "switch" | "button" | "img" {
  if (type === "toggle") return "switch";
  if (type === "button" || type === "pad") return "button";
  if (["meter", "label", "waveform", "eq", "amp", "cab", "mic", "mic_stand"].includes(type)) return "img";
  return "slider";
}

function displayValue(p: PluginParameter): string {
  const choice = p.controlType === "select" ? p.choices?.[Math.round(p.value)] : undefined;
  return choice ?? `${Number.isFinite(p.value) ? p.value : p.defaultValue}${p.unit ? ` ${p.unit}` : ""}`;
}

/** Enforces the physical rules shared by both renderers. Earlier controls keep
 * deliberate positions; only invalid geometry and later colliding controls
 * move. This makes the pass safe for hand-authored custom layouts. */
export function repairResolvedGeometry(parameters: PluginParameter[]): { parameters: PluginParameter[]; fixes: string[] } {
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
  const fixes: string[] = [];
  const result = parameters.map((p, index) => {
    const type = p.controlType ?? "knob";
    const min = minimumSize(type);
    let w = Math.max(min.w, Math.round(Number.isFinite(p.w) ? p.w! : min.w));
    let h = Math.max(min.h, Math.round(Number.isFinite(p.h) ? p.h! : min.h));
    let x = Math.max(PAD, Math.round(Number.isFinite(p.x) ? p.x! : PAD + (index % 4) * 140));
    let y = Math.max(PAD + 36, Math.round(Number.isFinite(p.y) ? p.y! : PAD + 36 + Math.floor(index / 4) * 120));
    const original = { x: p.x, y: p.y, w: p.w, h: p.h };
    const collides = () => occupied.some((o) => rectsOverlap(
      { x: x - GAP / 2, y: y - GAP / 2, w: w + GAP, h: h + GAP },
      { x: o.x - GAP / 2, y: o.y - GAP / 2, w: o.w + GAP, h: o.h + GAP }
    ));
    let attempts = 0;
    while (collides() && attempts++ < 500) {
      x += 24;
      if (x + w > 920) {
        x = PAD;
        y += 24;
      }
    }
    occupied.push({ x, y, w, h });
    if (x !== original.x || y !== original.y || w !== original.w || h !== original.h) {
      fixes.push(`repaired UI geometry for ${p.id}`);
      return { ...p, controlType: type, x, y, w, h };
    }
    return p;
  });
  return { parameters: result, fixes };
}

export function resolveSemanticUiContract(
  plugin: AudioPlugin,
  primaryIds: string[] = plugin.buildReport?.primaryControls ?? [],
  familyHint?: string | null
): ResolvedUiContract {
  const identityRecipe = resolveVisualIdentity(plugin, familyHint);
  const controls = plugin.parameters.map((p) => {
    const type = p.controlType ?? "knob";
    const visual = ["meter", "label", "waveform", "eq", "amp", "cab", "mic", "mic_stand"].includes(type);
    const role = visual ? "visual" as const : primaryIds.includes(p.id) ? "primary" as const : "secondary" as const;
    return {
      parameterId: p.id,
      controlType: type,
      role,
      bounds: { x: p.x ?? PAD, y: p.y ?? PAD + 36, width: p.w ?? minimumSize(type).w, height: p.h ?? minimumSize(type).h },
      style: {
        accent: p.accentColor ?? plugin.customSkin?.accentColor ?? "#f97316",
        font: p.fontStyle ?? plugin.customSkin?.fontStyle ?? "sans" as const,
        ...(type === "knob" ? { knob: effectiveKnobToken(p.ampKnobStyle, identityRecipe.knob) } : {}),
      },
      accessibility: {
        label: p.name.trim() || p.id,
        role: a11yRole(type),
        valueText: displayValue(p),
        ...(a11yRole(type) === "slider" || a11yRole(type) === "switch" ? { min: p.min, max: p.max } : {}),
      },
    };
  });
  const maxRight = controls.reduce((n, c) => Math.max(n, c.bounds.x + c.bounds.width), 0);
  const maxBottom = controls.reduce((n, c) => Math.max(n, c.bounds.y + c.bounds.height), 0);
  const groups = (["primary", "secondary", "visual"] as const)
    .map((role) => ({
      id: role,
      label: role === "visual" ? "Displays" : `${role[0].toUpperCase()}${role.slice(1)} controls`,
      role,
      parameterIds: controls.filter((c) => c.role === role).map((c) => c.parameterId),
    }))
    .filter((g) => g.parameterIds.length > 0);
  return {
    version: RESOLVED_UI_VERSION,
    renderers: { web: RESOLVED_UI_VERSION, native: RESOLVED_UI_VERSION },
    artboard: { width: Math.max(480, maxRight + PAD), height: Math.max(260, maxBottom + PAD), padding: PAD },
    theme: {
      background: plugin.customSkin?.bgColor ?? "#111116",
      border: plugin.customSkin?.borderColor ?? "#3f3f46",
      accent: plugin.customSkin?.accentColor ?? "#f97316",
      text: plugin.customSkin?.textColor ?? "#f5f5f5",
      font: plugin.customSkin?.fontStyle ?? "sans",
      glow: plugin.customSkin?.glowStyle ?? "none",
      material: resolveMaterial(plugin),
    },
    archetype: plugin.uiArchetype ?? "grid",
    identityRecipe,
    hierarchy: groups,
    controls,
  };
}

export function validateResolvedUiContract(contract: ResolvedUiContract | undefined): string[] {
  if (!contract) return ["missing resolved UI contract"];
  const issues: string[] = [];
  if (contract.version !== RESOLVED_UI_VERSION) issues.push("unsupported UI contract version");
  if (contract.renderers?.web !== RESOLVED_UI_VERSION || contract.renderers?.native !== RESOLVED_UI_VERSION) issues.push("renderer consumption handshake missing");
  if (contract.identityRecipe) {
    const r = contract.identityRecipe;
    if (r.version !== "1.0" || !/^vi1-[a-z0-9]+$/.test(r.id) || !Number.isInteger(r.seed)) issues.push("invalid visual identity recipe");
    if (![r.animation.phase, r.animation.tempo, r.animation.amplitude].every(Number.isFinite) || r.animation.phase < 0 || r.animation.phase > 6.284 || r.animation.tempo < .25 || r.animation.tempo > 1.6 || r.animation.amplitude < 0 || r.animation.amplitude > 1 || !["decorative", "static"].includes(r.motionPolicy)) issues.push("invalid visual identity animation");
    if (!["rack", "pedal", "console", "instrument", "tape", "space-unit"].includes(r.hardwareMotif) ||
        !["orbs", "stripes", "grain", "grid", "dots", "arcs", "contours"].includes(r.artwork) ||
        !["machined", "tolex", "wood", "polymer", "glass"].includes(r.panel) ||
        !["pointer", "silvercap", "chickenhead", "neonring", "vintage"].includes(r.knob) ||
        !["static", "breathing", "ripple", "scan"].includes(r.eqMotion) ||
        !["needle", "segmented-peak", "plasma-bar", "scope-stereo"].includes(r.meter)) issues.push("unknown visual identity token");
    if (typeof r.modelLabel !== "string" || r.modelLabel.length < 2 || r.modelLabel.length > 80 ||
        !Array.isArray(r.styleTokens) || r.styleTokens.some((token) => typeof token !== "string" || token.length > 40)) issues.push("invalid visual identity labels");
    if (!SUPPORTED_VISUAL_FAMILIES.includes(r.family)) issues.push("unsupported visual identity family");
    if (r.family === "amp_sim" && r.hardwareMotif !== "rack") issues.push("family-inappropriate amp visual identity");
  }
  const ids = new Set<string>();
  for (const c of contract.controls) {
    if (!c.parameterId || ids.has(c.parameterId)) issues.push(`duplicate or empty control id: ${c.parameterId}`);
    ids.add(c.parameterId);
    const b = c.bounds;
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) issues.push(`invalid bounds: ${c.parameterId}`);
    const min = minimumSize(c.controlType);
    if (b.width < min.w || b.height < min.h) issues.push(`below minimum size: ${c.parameterId}`);
    if (b.x < 0 || b.y < 0 || b.x + b.width > contract.artboard.width || b.y + b.height > contract.artboard.height) issues.push(`out of bounds: ${c.parameterId}`);
    if (!c.accessibility.label.trim()) issues.push(`missing accessibility label: ${c.parameterId}`);
    if (c.style.knob && !["pointer", "silvercap", "chickenhead", "neonring", "vintage"].includes(c.style.knob)) issues.push(`unsupported control knob style: ${c.parameterId}`);
    if (c.style.knob && c.controlType !== "knob") issues.push(`knob style assigned to non-knob control: ${c.parameterId}`);
  }
  for (let i = 0; i < contract.controls.length; i++) {
    for (let j = i + 1; j < contract.controls.length; j++) {
      const a = contract.controls[i].bounds, b = contract.controls[j].bounds;
      if (rectsOverlap({ x: a.x, y: a.y, w: a.width, h: a.height }, { x: b.x, y: b.y, w: b.width, h: b.height })) {
        issues.push(`overlap: ${contract.controls[i].parameterId}/${contract.controls[j].parameterId}`);
      } else if (rectsOverlap(
        { x: a.x - GAP / 2, y: a.y - GAP / 2, w: a.width + GAP, h: a.height + GAP },
        { x: b.x - GAP / 2, y: b.y - GAP / 2, w: b.width + GAP, h: b.height + GAP }
      )) {
        issues.push(`insufficient spacing: ${contract.controls[i].parameterId}/${contract.controls[j].parameterId}`);
      }
    }
  }
  // Hierarchy is not decorative metadata: production web rendering iterates
  // it. Require a complete, unique partition so malformed grouping can never
  // hide, duplicate, invent, or misclassify a valid control.
  const controlsById = new Map(contract.controls.map((control) => [control.parameterId, control]));
  const hierarchyCounts = new Map<string, number>();
  for (const group of contract.hierarchy) {
    for (const id of group.parameterIds) {
      hierarchyCounts.set(id, (hierarchyCounts.get(id) ?? 0) + 1);
      const control = controlsById.get(id);
      if (!control) issues.push(`unknown hierarchy control: ${id}`);
      else if (control.role !== group.role) issues.push(`hierarchy role mismatch: ${id}`);
    }
  }
  for (const id of controlsById.keys()) {
    const count = hierarchyCounts.get(id) ?? 0;
    if (count === 0) issues.push(`control omitted from hierarchy: ${id}`);
    else if (count > 1) issues.push(`control duplicated in hierarchy: ${id}`);
  }
  return issues;
}