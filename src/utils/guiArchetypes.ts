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

/** The single source of truth for "what does this request look like": the
 *  richer uiMetaphor wins when available (prompt-refined), family is the
 *  fallback for call sites that only have a bare family (audit/research/edit
 *  paths -- see runQualityGate's opts). Unknown of either -> "grid", the
 *  honest default rather than forcing a mismatched archetype. */
export function pickArchetype(uiMetaphor: string | null | undefined, family: PluginFamily | null | undefined): ArchetypeId {
  if (uiMetaphor && UI_METAPHOR_TO_ARCHETYPE[uiMetaphor]) return UI_METAPHOR_TO_ARCHETYPE[uiMetaphor];
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

/** Generic column-grid placement for a block of params, starting at a given
 *  Y offset. Returns the positioned params and the Y the block ended at, so
 *  callers can stack multiple blocks (hero widget, then knobs, then pads). */
function layoutGridBlock(
  params: PluginParameter[],
  opts: { cols: number; cellW: number; cellH: number; originX?: number; originY: number; force?: boolean }
): { params: PluginParameter[]; bottomY: number; rightX: number; laidOut: number } {
  const originX = opts.originX ?? ORIGIN_X;
  let laidOut = 0;
  const positioned = params.map((p, idx) => {
    const needsLayout = opts.force || p.x === undefined || p.y === undefined;
    if (!needsLayout) return p;
    const col = idx % opts.cols;
    const row = Math.floor(idx / opts.cols);
    laidOut++;
    return {
      ...p,
      x: originX + col * opts.cellW,
      y: opts.originY + row * opts.cellH,
      w: opts.force || p.w === undefined ? 120 : p.w,
      h: opts.force || p.h === undefined ? (p.controlType === "toggle" ? 80 : 100) : p.h,
    };
  });
  const rows = Math.ceil(params.length / opts.cols);
  return {
    params: positioned,
    bottomY: params.length > 0 ? opts.originY + rows * opts.cellH : opts.originY,
    rightX: originX + Math.min(params.length, opts.cols) * opts.cellW,
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
  const positioned = params.map((p, idx) => {
    const needsLayout = force || p.x === undefined || p.y === undefined;
    if (!needsLayout) return p;
    laidOut++;
    return { ...p, x: ORIGIN_X + idx * 340, y: originY, w: p.w ?? 320, h: p.h ?? 220 };
  });
  return { params: positioned, bottomY: params.length > 0 ? originY + 240 : originY, laidOut };
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
  const positioned = params.map((p, idx) => {
    const needsLayout = force || p.x === undefined || p.y === undefined;
    if (!needsLayout) return p;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    laidOut++;
    return { ...p, x: ORIGIN_X + col * (SIZE + GAP), y: originY + row * (SIZE + GAP), w: p.w ?? SIZE, h: p.h ?? SIZE };
  });
  const rows = Math.ceil(params.length / COLS);
  return { params: positioned, bottomY: params.length > 0 ? originY + rows * (SIZE + GAP) : originY, laidOut };
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
