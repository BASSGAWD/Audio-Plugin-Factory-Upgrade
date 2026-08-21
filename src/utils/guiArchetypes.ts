/**
 * GUI archetypes -- deterministic, distinct layout algorithms for the
 * generated plugin board, selected from the request's classified uiMetaphor
 * (see pluginSpec.ts) or its DSP family as a fallback.
 *
 * This is the missing link between two things that already existed: the
 * uiMetaphor taxonomy computed by classifyPluginIntent() (previously only
 * ever turned into prose for the LLM prompt, never read by any layout code)
 * and the single fixed 4-column grid every plugin used to get regardless of
 * what kind of instrument it conceptually is.
 *
 * Pure functions only -- no DOM/React/Node dependency -- so this module is
 * safe to import from BOTH the build pipeline (qualityGate.ts, Node/test
 * context) and the browser (UIDesigner.tsx, for live re-layout when the user
 * switches archetype). Mirrors how controlVisuals.ts is already shared
 * between UIDesigner.tsx and PluginControl.tsx for the same reason.
 */

import { PluginParameter } from "../types";
import { PluginFamily } from "./pluginSpec";

export type ArchetypeId = "grid" | "eq_focus" | "strip" | "pedal" | "rack" | "panel" | "showpiece" | "custom";

export const ARCHETYPE_LABELS: Record<ArchetypeId, string> = {
  grid: "Grid (simple knobs)",
  eq_focus: "EQ Focus (curve-led)",
  strip: "Channel Strip (vertical)",
  pedal: "Stompbox (compact)",
  rack: "Rack Unit (wide strip)",
  panel: "Synth Panel (dense)",
  showpiece: "Showpiece (amp/pad-led)",
  custom: "Custom (saved layout)",
};

/** Every archetype a user can explicitly pick, in display order. "custom"
 *  is appended separately by the UI only when at least one has been saved. */
export const BUILTIN_ARCHETYPES: ArchetypeId[] = ["grid", "eq_focus", "strip", "pedal", "rack", "panel", "showpiece"];

/** Backstop control-type inference for params the model didn't tag -- moved
 *  here (from qualityGate.ts) so both the build-time gate and the browser's
 *  archetype switcher use the identical heuristic. */
export function inferControlType(p: PluginParameter): NonNullable<PluginParameter["controlType"]> {
  if (p.controlType) return p.controlType;
  if (/bypass|enable|power|on_off|switch/i.test(p.id) || (p.min === 0 && p.max === 1 && p.unit === "state")) return "toggle";
  if (/meter|vu|reduction/i.test(p.id) || /meter|vu/i.test(p.name)) return "meter";
  if (/mix|level|volume|output|makeup|blend|dry_wet|drywet/i.test(p.id)) return "slider";
  return "knob";
}

const UI_METAPHOR_TO_ARCHETYPE: Record<string, ArchetypeId> = {
  simple_knobs: "grid",
  parametric_eq: "eq_focus",
  channel_strip: "strip",
  vocal_processor: "strip",
  stompbox: "pedal",
  pedal: "pedal",
  rack_unit: "rack",
  tape_machine: "rack",
  synth_panel: "panel",
  vintage_unit: "panel",
  amp_head_and_cab: "showpiece",
  pad_grid: "showpiece",
};

const FAMILY_TO_ARCHETYPE: Partial<Record<PluginFamily, ArchetypeId>> = {
  eq: "eq_focus",
  multiband_saturator: "eq_focus",
  filter: "panel",
  synthesizer: "panel",
  dynamics: "strip",
  pitch: "strip",
  distortion: "pedal",
  saturator: "pedal",
  modulation: "pedal",
  delay: "rack",
  reverb: "rack",
  amp_sim: "showpiece",
  sampler: "showpiece",
};

function normalizeMetaphorKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** The single source of truth for "what does this request look like": the
 *  richer uiMetaphor wins when available (prompt-refined), family is the
 *  fallback for call sites that only have a bare family (audit/research/edit
 *  paths -- see runQualityGate's opts). Unknown of either -> "grid", the
 *  honest default rather than forcing a mismatched archetype.
 *
 * uiMetaphor is matched loosely, not by strict string equality: a model
 * that phrases the same metaphor with different casing/spacing/hyphenation
 * ("Parametric EQ", "parametric-eq") or wraps it in extra words ("a modern
 * parametric eq design") still gets recognized, via a normalized token-SET
 * match (every token of a known key must appear in the input's tokens) --
 * strict enough that a short known key like "pedal" can't accidentally
 * match on an unrelated word that merely contains those letters. Only an
 * EXACT known string used to work; anything else silently discarded real
 * signal the model provided and fell back to the (less specific) family
 * mapping or "grid". */
export function pickArchetype(uiMetaphor: string | null | undefined, family: PluginFamily | null | undefined): ArchetypeId {
  if (uiMetaphor) {
    const key = normalizeMetaphorKey(uiMetaphor);
    if (UI_METAPHOR_TO_ARCHETYPE[key]) return UI_METAPHOR_TO_ARCHETYPE[key];
    const inputTokens = new Set(key.split("_").filter(Boolean));
    for (const knownKey of Object.keys(UI_METAPHOR_TO_ARCHETYPE)) {
      const knownTokens = knownKey.split("_");
      if (knownTokens.every((t) => inputTokens.has(t))) return UI_METAPHOR_TO_ARCHETYPE[knownKey];
    }
  }
  if (family && FAMILY_TO_ARCHETYPE[family]) return FAMILY_TO_ARCHETYPE[family]!;
  return "grid";
}

export interface ArchetypeLayout {
  parameters: PluginParameter[];
  /** Overall content bounds so the caller's artboard can grow to contain it
   *  (same contract as UIDesigner.tsx's computeFallbackLayout). */
  contentW: number;
  contentH: number;
  /** How many parameters were actually repositioned by this call. */
  laidOutCount: number;
}

const ORIGIN_X = 40;
const ORIGIN_Y = 70;

function splitByRole(parameters: PluginParameter[]) {
  const regular = parameters.filter(
    (p) => p.controlType !== "amp" && p.controlType !== "cab" && p.controlType !== "mic" && p.controlType !== "pad"
  );
  const showpiece = parameters.filter((p) => p.controlType === "amp" || p.controlType === "cab" || p.controlType === "mic");
  const pads = parameters.filter((p) => p.controlType === "pad");
  return { regular, showpiece, pads };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned rectangle overlap (touching edges don't count as overlap).
 *  Exported so qualityGate.ts's scoreLooks/measureVisualIntegrity can use
 *  the exact same overlap definition instead of a second implementation. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Scans grid cells left-to-right, top-to-bottom (unbounded rows) and returns
 * the first one whose rect doesn't overlap anything already in `occupied` --
 * then claims it by pushing that rect into `occupied`, so the very next call
 * in the same layout pass can't double-book it either.
 *
 * This replaces pure `idx % cols` / `Math.floor(idx / cols)` arithmetic, which
 * has no concept of "is this cell already taken" -- a parameter needing a
 * fresh position could (and, measured live, did) land exactly on top of a
 * parameter that already had x/y from an earlier layout pass, the moment the
 * params array's effective composition changed between passes (a new param
 * appended via an edit, a controlType inferred differently, ...). Every
 * additive edit path (chainStage, composeRecipes, extendVoicingOption) can
 * trigger that, since edited plugins are re-laid-out with "only fill gaps"
 * semantics, not a full fresh layout.
 */
function nextFreeGridCell(
  occupied: Rect[],
  opts: { cols: number; cellW: number; cellH: number; originX: number; originY: number; w: number; h: number }
): { x: number; y: number } {
  for (let row = 0; row < 300; row++) {
    for (let col = 0; col < opts.cols; col++) {
      const rect: Rect = { x: opts.originX + col * opts.cellW, y: opts.originY + row * opts.cellH, w: opts.w, h: opts.h };
      if (!occupied.some((o) => rectsOverlap(rect, o))) {
        occupied.push(rect);
        return { x: rect.x, y: rect.y };
      }
    }
  }
  // Safety valve -- practically unreachable (300 rows * cols cells), but
  // never leave a parameter unpositioned rather than throw.
  const rect: Rect = { x: opts.originX, y: opts.originY + 300 * opts.cellH, w: opts.w, h: opts.h };
  occupied.push(rect);
  return { x: rect.x, y: rect.y };
}

/** 1-D version for a single row that packs left-to-right at each item's OWN
 *  width (showpiece items aren't uniform-width cells) -- same occupied-set
 *  contract as nextFreeGridCell. */
function nextFreeRowSlot(occupied: Rect[], opts: { originX: number; y: number; w: number; h: number; step: number }): { x: number } {
  for (let col = 0; col < 50; col++) {
    const rect: Rect = { x: opts.originX + col * opts.step, y: opts.y, w: opts.w, h: opts.h };
    if (!occupied.some((o) => rectsOverlap(rect, o))) {
      occupied.push(rect);
      return { x: rect.x };
    }
  }
  const rect: Rect = { x: opts.originX + 50 * opts.step, y: opts.y, w: opts.w, h: opts.h };
  occupied.push(rect);
  return { x: rect.x };
}

/** Rects for every param in `params` that ALREADY has a position (i.e. that
 *  layout will leave untouched) -- the "no-fly zone" a freshly-positioned
 *  param must avoid. Ignored entirely when `force`, since force repositions
 *  everything and nothing is pre-occupied. */
function preOccupiedRects(params: PluginParameter[], force: boolean | undefined, fallbackW: number, fallbackH: number): Rect[] {
  if (force) return [];
  return params
    .filter((p) => p.x !== undefined && p.y !== undefined)
    .map((p) => ({ x: p.x as number, y: p.y as number, w: p.w ?? fallbackW, h: p.h ?? fallbackH }));
}

/** Generic column-grid placement for a block of params, starting at a given
 *  Y offset. Returns the positioned params and the Y the block ended at, so
 *  callers can stack multiple blocks (hero widget, then knobs, then pads). */
function layoutGridBlock(
  params: PluginParameter[],
  opts: { cols: number; cellW: number; cellH: number; originX?: number; originY: number; force?: boolean }
): { params: PluginParameter[]; bottomY: number; rightX: number; laidOut: number } {
  const originX = opts.originX ?? ORIGIN_X;
  let laidOut = 0;
  const occupied = preOccupiedRects(params, opts.force, opts.cellW - 20, opts.cellH - 25);
  let maxBottom = opts.originY;
  let maxRight = originX;
  const positioned = params.map((p) => {
    const needsLayout = opts.force || p.x === undefined || p.y === undefined;
    const w = opts.force || p.w === undefined ? 120 : p.w;
    const h = opts.force || p.h === undefined ? (p.controlType === "toggle" ? 80 : 100) : p.h;
    if (!needsLayout) {
      maxBottom = Math.max(maxBottom, (p.y as number) + h);
      maxRight = Math.max(maxRight, (p.x as number) + w);
      return p;
    }
    laidOut++;
    const slot = nextFreeGridCell(occupied, { cols: opts.cols, cellW: opts.cellW, cellH: opts.cellH, originX, originY: opts.originY, w, h });
    maxBottom = Math.max(maxBottom, slot.y + h);
    maxRight = Math.max(maxRight, slot.x + w);
    return { ...p, x: slot.x, y: slot.y, w, h };
  });
  return {
    params: positioned,
    bottomY: params.length > 0 ? maxBottom : opts.originY,
    rightX: params.length > 0 ? maxRight : originX,
    laidOut,
  };
}

// Showpiece (amp/cab/mic) and pad widgets carry their OWN meaningful size --
// a cabinet is 240x240 because that's what looks like a cabinet, not
// because it's this archetype's cell size. force (used when the user
// explicitly switches archetype) always repositions them, but must never
// resize a widget that already has an explicit w/h: only a genuinely new,
// unset widget gets the fallback default dimension.

function layoutShowpieceRow(
  params: PluginParameter[],
  originY: number,
  force?: boolean
): { params: PluginParameter[]; bottomY: number; laidOut: number } {
  let laidOut = 0;
  const occupied = preOccupiedRects(params, force, 320, 220);
  let maxBottom = originY;
  const positioned = params.map((p) => {
    const needsLayout = force || p.x === undefined || p.y === undefined;
    const w = p.w ?? 320;
    const h = p.h ?? 220;
    if (!needsLayout) {
      maxBottom = Math.max(maxBottom, (p.y as number) + h);
      return p;
    }
    laidOut++;
    const slot = nextFreeRowSlot(occupied, { originX: ORIGIN_X, y: originY, w, h, step: 340 });
    maxBottom = Math.max(maxBottom, originY + h);
    return { ...p, x: slot.x, y: originY, w, h };
  });
  return { params: positioned, bottomY: params.length > 0 ? maxBottom : originY, laidOut };
}

function layoutPadGrid(
  params: PluginParameter[],
  originY: number,
  force?: boolean
): { params: PluginParameter[]; bottomY: number; laidOut: number } {
  const COLS = 4;
  const SIZE = 100;
  const GAP = 12;
  let laidOut = 0;
  const occupied = preOccupiedRects(params, force, SIZE, SIZE);
  let maxBottom = originY;
  const positioned = params.map((p) => {
    const needsLayout = force || p.x === undefined || p.y === undefined;
    const w = p.w ?? SIZE;
    const h = p.h ?? SIZE;
    if (!needsLayout) {
      maxBottom = Math.max(maxBottom, (p.y as number) + h);
      return p;
    }
    laidOut++;
    const slot = nextFreeGridCell(occupied, { cols: COLS, cellW: SIZE + GAP, cellH: SIZE + GAP, originX: ORIGIN_X, originY, w, h });
    maxBottom = Math.max(maxBottom, slot.y + h);
    return { ...p, x: slot.x, y: slot.y, w, h };
  });
  return { params: positioned, bottomY: params.length > 0 ? maxBottom : originY, laidOut };
}

/** grid: today's original layout, reproduced with matching arithmetic (not
 *  chained through each block's own bottom -- the showpiece and pad origins
 *  are both derived directly from the regular grid's row count, exactly as
 *  the pre-archetype polishPluginVisuals() computed them) so the default,
 *  no-archetype-specified path stays byte-for-byte identical. */
function layoutGrid(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const COLS = 4;
  const CELL_W = 140;
  const CELL_H = 125;
  const reg = layoutGridBlock(regular, { cols: COLS, cellW: CELL_W, cellH: CELL_H, originY: ORIGIN_Y, force });
  const regularRows = Math.ceil(regular.length / COLS);
  const sp = layoutShowpieceRow(showpiece, ORIGIN_Y + regularRows * CELL_H + 20, force);
  const showpieceRows = showpiece.length > 0 ? 1 : 0;
  const padOriginY = ORIGIN_Y + regularRows * CELL_H + (showpieceRows > 0 ? 280 : 0);
  const pd = layoutPadGrid(pads, padOriginY, force);
  return {
    parameters: [...reg.params, ...sp.params, ...pd.params],
    contentW: Math.max(ORIGIN_X + COLS * CELL_W, ORIGIN_X + showpiece.length * 340) + 40,
    contentH: Math.max(reg.bottomY, sp.bottomY, pd.bottomY) + 40,
    laidOutCount: reg.laidOut + sp.laidOut + pd.laidOut,
  };
}

/** eq_focus: the eq curve widget is the hero -- wide, up top, everything
 *  else (band knobs, mix, etc.) forms a compact row directly beneath it. */
function layoutEqFocus(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const eqIdx = regular.findIndex((p) => p.controlType === "eq");
  let laidOut = 0;
  let hero: PluginParameter[] = [];
  let rest = regular;
  if (eqIdx >= 0) {
    const p = regular[eqIdx];
    const needsLayout = force || p.x === undefined || p.y === undefined;
    if (needsLayout) laidOut++;
    // The hero widget's size is its own -- only a genuinely unset one gets
    // the default hero dimensions; force repositions but never resizes it.
    hero = [needsLayout ? { ...p, x: ORIGIN_X, y: ORIGIN_Y, w: p.w ?? 560, h: p.h ?? 180 } : p];
    rest = regular.filter((_, i) => i !== eqIdx);
  }
  const knobsY = ORIGIN_Y + (hero.length > 0 ? (hero[0].h ?? 180) + 20 : 0);
  const reg = layoutGridBlock(rest, { cols: 4, cellW: 140, cellH: 125, originY: knobsY, force });
  laidOut += reg.laidOut;
  const sp = layoutShowpieceRow(showpiece, reg.bottomY + (showpiece.length > 0 ? 20 : 0), force);
  const pd = layoutPadGrid(pads, sp.bottomY + (pads.length > 0 ? 20 : 0), force);
  return {
    parameters: [...hero, ...reg.params, ...sp.params, ...pd.params],
    contentW: Math.max(ORIGIN_X + (hero[0]?.w ?? 560), ORIGIN_X + 4 * 140) + 40,
    contentH: pd.bottomY + 40,
    laidOutCount: laidOut + sp.laidOut + pd.laidOut,
  };
}

/** strip: narrow, tall, top-to-bottom in the array's own order -- which is
 *  already signal-flow order by the time this runs (orderParametersBySpec
 *  ranks primary controls first before polishPluginVisuals is ever called). */
function layoutStrip(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const cols = regular.length > 6 ? 2 : 1;
  const reg = layoutGridBlock(regular, { cols, cellW: 220, cellH: 95, originY: ORIGIN_Y, force });
  const sp = layoutShowpieceRow(showpiece, reg.bottomY + (showpiece.length > 0 ? 20 : 0), force);
  const pd = layoutPadGrid(pads, sp.bottomY + (pads.length > 0 ? 20 : 0), force);
  return {
    parameters: [...reg.params, ...sp.params, ...pd.params],
    contentW: ORIGIN_X + cols * 220 + 40,
    contentH: pd.bottomY + 40,
    laidOutCount: reg.laidOut + sp.laidOut + pd.laidOut,
  };
}

/** pedal: a small, opinionated knob count in one arc/row (a stompbox has
 *  3-5 knobs, not a rack of options); bypass-style toggles get their own
 *  prominent centered row below -- a physical footswitch, not just another
 *  knob in the grid. */
function layoutPedal(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const toggles = regular.filter((p) => (p.controlType || inferControlType(p)) === "toggle");
  const knobs = regular.filter((p) => (p.controlType || inferControlType(p)) !== "toggle");
  const cols = Math.max(1, Math.min(5, knobs.length));
  const reg = layoutGridBlock(knobs, { cols, cellW: 150, cellH: 150, originY: ORIGIN_Y, force });
  const toggleCols = Math.max(1, Math.min(4, toggles.length));
  const toggleOriginX = ORIGIN_X + Math.max(0, (reg.rightX - ORIGIN_X - toggleCols * 130) / 2);
  const tg = layoutGridBlock(toggles, { cols: toggleCols, cellW: 130, cellH: 80, originX: toggleOriginX, originY: reg.bottomY + (toggles.length > 0 ? 20 : 0), force });
  const sp = layoutShowpieceRow(showpiece, tg.bottomY + (showpiece.length > 0 ? 20 : 0), force);
  const pd = layoutPadGrid(pads, sp.bottomY + (pads.length > 0 ? 20 : 0), force);
  return {
    parameters: [...reg.params, ...tg.params, ...sp.params, ...pd.params],
    contentW: Math.max(reg.rightX, ORIGIN_X + toggleCols * 130) + 40,
    contentH: pd.bottomY + 40,
    laidOutCount: reg.laidOut + tg.laidOut + sp.laidOut + pd.laidOut,
  };
}

/** rack: wide horizontal "19-inch rack" strip -- short, many columns, left
 *  to right in signal-flow order. */
function layoutRack(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const cols = Math.max(1, Math.min(8, regular.length));
  const reg = layoutGridBlock(regular, { cols, cellW: 110, cellH: 100, originY: ORIGIN_Y, force });
  const sp = layoutShowpieceRow(showpiece, reg.bottomY + (showpiece.length > 0 ? 20 : 0), force);
  const pd = layoutPadGrid(pads, sp.bottomY + (pads.length > 0 ? 20 : 0), force);
  return {
    parameters: [...reg.params, ...sp.params, ...pd.params],
    contentW: ORIGIN_X + cols * 110 + 40,
    contentH: pd.bottomY + 40,
    laidOutCount: reg.laidOut + sp.laidOut + pd.laidOut,
  };
}

/** panel: a dense multi-row grid -- more columns/smaller cells than the
 *  default grid, reading as an authentically busy synth/vintage face. */
function layoutPanel(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const reg = layoutGridBlock(regular, { cols: 6, cellW: 110, cellH: 100, originY: ORIGIN_Y, force });
  const sp = layoutShowpieceRow(showpiece, reg.bottomY + (showpiece.length > 0 ? 20 : 0), force);
  const pd = layoutPadGrid(pads, sp.bottomY + (pads.length > 0 ? 20 : 0), force);
  return {
    parameters: [...reg.params, ...sp.params, ...pd.params],
    contentW: ORIGIN_X + 6 * 110 + 40,
    contentH: pd.bottomY + 40,
    laidOutCount: reg.laidOut + sp.laidOut + pd.laidOut,
  };
}

/** showpiece: the amp/cab/mic rig (or pad grid) IS the plugin -- it goes
 *  first and dominant, with everything else a slim utility row underneath
 *  it rather than the grid-then-showpiece order every other archetype uses. */
function layoutShowpiece(parameters: PluginParameter[], force?: boolean): ArchetypeLayout {
  const { regular, showpiece, pads } = splitByRole(parameters);
  const sp = layoutShowpieceRow(showpiece, ORIGIN_Y, force);
  const padsY = sp.bottomY + (pads.length > 0 ? 20 : 0);
  const pd = layoutPadGrid(pads, padsY, force);
  const regY = pd.bottomY + (regular.length > 0 && (showpiece.length > 0 || pads.length > 0) ? 20 : 0);
  const reg = layoutGridBlock(regular, { cols: 5, cellW: 130, cellH: 100, originY: regY, force });
  return {
    parameters: [...sp.params, ...pd.params, ...reg.params],
    contentW: Math.max(ORIGIN_X + showpiece.length * 340, ORIGIN_X + 5 * 130, ORIGIN_X + 4 * 112) + 40,
    contentH: (regular.length > 0 ? reg.bottomY : pd.bottomY) + 40,
    laidOutCount: sp.laidOut + pd.laidOut + reg.laidOut,
  };
}

/**
 * Apply an archetype's layout to a parameter set. force=false (the build-
 * time default) only fills gaps -- params that already carry x/y (e.g. a
 * model-provided position, or a prior archetype's placement) are left
 * alone, matching polishPluginVisuals()'s original "only fill what's
 * missing" contract. force=true (used when the user explicitly switches
 * archetype in the UI) recomputes every position unconditionally.
 *
 * "custom" is intentionally not implemented here -- a saved custom layout
 * is a positions SNAPSHOT restored by the caller (UIDesigner.tsx, matched
 * back onto params by controlType + ordinal), not a computable algorithm.
 * Falls back to "grid" so a stale/unmatched "custom" id still lays out
 * sanely instead of leaving params unpositioned.
 */
export function applyArchetype(archetypeId: ArchetypeId, parameters: PluginParameter[], force = false): ArchetypeLayout {
  switch (archetypeId) {
    case "eq_focus":
      return layoutEqFocus(parameters, force);
    case "strip":
      return layoutStrip(parameters, force);
    case "pedal":
      return layoutPedal(parameters, force);
    case "rack":
      return layoutRack(parameters, force);
    case "panel":
      return layoutPanel(parameters, force);
    case "showpiece":
      return layoutShowpiece(parameters, force);
    case "grid":
    case "custom":
    default:
      return layoutGrid(parameters, force);
  }
}

/**
 * Repairs a parameter list whose positions ALREADY collide -- e.g. a plugin
 * edited multiple times before this occupied-slot-aware layout shipped (the
 * per-archetype layout functions above only ever fill GAPS, so a plugin
 * where every param already has x/y sails straight through them untouched
 * even if those positions collide), or any x/y a model supplied directly
 * that happens to overlap something else.
 *
 * Runs on the FULL merged parameter list (every role together) in array
 * order: the first param to claim a rect keeps it exactly where it is: any
 * LATER param whose rect overlaps an already-claimed one gets nudged
 * right/down in fixed steps until it lands somewhere clear. Deterministic
 * and a true no-op when nothing overlaps -- polishPluginVisuals() runs this
 * on every build, so a plugin that's already fine never has a parameter
 * moved. Same "march until clear" idea already used and proven for Factory
 * Canvas's placeNewCard/resolveOverlaps (canvasFactory.ts), applied here to
 * individual controls instead of whole cards.
 */
export function resolveControlOverlaps(parameters: PluginParameter[]): PluginParameter[] {
  const placed: Rect[] = [];
  let changed = false;
  const result = parameters.map((p) => {
    if (p.x === undefined || p.y === undefined) return p; // nothing to repair -- not yet laid out at all
    const w = p.w ?? 120;
    const h = p.h ?? 100;
    if (!placed.some((o) => rectsOverlap({ x: p.x as number, y: p.y as number, w, h }, o))) {
      placed.push({ x: p.x, y: p.y, w, h });
      return p;
    }
    let x = p.x;
    let y = p.y;
    let step = 0;
    while (placed.some((o) => rectsOverlap({ x, y, w, h }, o)) && step < 60) {
      step++;
      x += 24;
      y += 20;
    }
    changed = true;
    placed.push({ x, y, w, h });
    return { ...p, x, y };
  });
  return changed ? result : parameters;
}
