import { VisualIdentityRecipe } from "../types";

/**
 * Per-family chassis geometry: silhouette, corner chamfer, screw
 * count/placement, rail presence, and nameplate position. Every plugin
 * currently shares ONE byte-identical chassis shape (10px chamfer, 4 fixed
 * screws, a 13px rail, a bottom-right nameplate) regardless of family --
 * this is the profile table that gives each `hardwareMotif` (already
 * resolved per-plugin by `resolveVisualIdentity`, and already driving
 * `PANEL_TEXTURE_RECIPES`-style material choices) its own distinct physical
 * shape, mirroring that same "Record keyed by a resolved style, one lookup
 * function" pattern.
 */
export type ChassisSilhouette = "rack-ear" | "stompbox-rounded" | "console-wide" | "amp-head-boxy" | "module-slim";

export interface ChassisProfile {
  silhouette: ChassisSilhouette;
  /** Corner-chamfer size in px for the clip-path. Was a fixed 10px for
   *  every plugin -- now the single biggest lever for a genuinely
   *  different silhouette (a barely-cut rack unit vs. a heavily rounded
   *  stompbox read as different hardware at a glance). */
  chamferPx: number;
  /** Screw head diameter in px. */
  screwSizePx: number;
  /** Inset from each populated corner, in px. Must clear chamferPx with at
   *  least ~8px margin or the screw's own circle gets clipped by the
   *  chamfer cut. */
  screwInsetPx: number;
  /** Which corners actually get a screw -- not every silhouette wants all
   *  4 (a sleek space-unit module has none; a 2-screw pedal only needs the
   *  top two). */
  screwCorners: Array<"tl" | "tr" | "bl" | "br">;
  /** TopRail height in px; 0 = no rail rendered at all for this silhouette
   *  (a stompbox pedal doesn't have a rack-style vent rail across its top). */
  railHeightPx: number;
  /** Nameplate position, spread directly into its absolutely-positioned
   *  style -- lets a silhouette move the plate off the shared
   *  bottom-right default (e.g. a vintage tape unit's plate sits
   *  bottom-left, an instrument's sits top-right). */
  nameplatePos: { top?: number; bottom?: number; left?: number; right?: number };
}

export const CHASSIS_PROFILES: Record<VisualIdentityRecipe["hardwareMotif"], ChassisProfile> = {
  rack: {
    silhouette: "rack-ear",
    chamferPx: 4,
    screwSizePx: 10,
    screwInsetPx: 12,
    screwCorners: ["tl", "tr", "bl", "br"],
    railHeightPx: 14,
    nameplatePos: { bottom: 14, right: 24 },
  },
  pedal: {
    silhouette: "stompbox-rounded",
    chamferPx: 16,
    screwSizePx: 7,
    screwInsetPx: 26,
    screwCorners: ["tl", "tr"],
    railHeightPx: 0,
    nameplatePos: { bottom: 10, left: 24 },
  },
  console: {
    silhouette: "console-wide",
    chamferPx: 6,
    screwSizePx: 9,
    screwInsetPx: 14,
    screwCorners: ["tl", "tr", "bl", "br"],
    railHeightPx: 16,
    nameplatePos: { bottom: 14, right: 24 },
  },
  instrument: {
    silhouette: "module-slim",
    chamferPx: 8,
    screwSizePx: 8,
    screwInsetPx: 16,
    screwCorners: ["tl", "tr"],
    railHeightPx: 10,
    nameplatePos: { top: 14, right: 24 },
  },
  tape: {
    silhouette: "amp-head-boxy",
    chamferPx: 14,
    screwSizePx: 11,
    screwInsetPx: 24,
    screwCorners: ["tl", "tr", "bl", "br"],
    railHeightPx: 18,
    nameplatePos: { bottom: 16, left: 24 },
  },
  "space-unit": {
    silhouette: "module-slim",
    chamferPx: 2,
    screwSizePx: 6,
    screwInsetPx: 10,
    screwCorners: [],
    railHeightPx: 8,
    nameplatePos: { bottom: 14, right: 24 },
  },
};

export function resolveChassisProfile(hardwareMotif: VisualIdentityRecipe["hardwareMotif"]): ChassisProfile {
  return CHASSIS_PROFILES[hardwareMotif] ?? CHASSIS_PROFILES.rack;
}

/** Octagonal (corners chamfered) clip-path, parameterized by the profile's
 *  own chamferPx instead of a single fixed constant shared by every plugin. */
export function chassisClipPath(chamferPx: number): string {
  const c = chamferPx;
  return `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, ${c}px 100%, 0 calc(100% - ${c}px), 0 ${c}px)`;
}
