import { PluginParameter } from "../types";
import { AmpHeadControl, CabinetControl, MicPositionControl } from "./PluginControl";

interface RigStackProps {
  ampParam?: PluginParameter;
  cabParam?: PluginParameter;
  micParam?: PluginParameter;
  allParams: PluginParameter[];
  onChange: (paramId: string, value: number) => void;
  /** Compact: a small, non-interactive preview sized for FactoryCanvas's
   *  card (~328px usable width) -- no mic strip, pointer-events disabled
   *  on the inner controls so it doesn't fight the card's own drag gesture.
   *  Full mode (default) is the real interactive rig rendered in SimpleStudio. */
  compact?: boolean;
}

/**
 * A real amp rig -- head sitting on top of cab, mic in front -- instead of
 * `layoutShowpieceRow` (guiArchetypes.ts:303-325), which packs amp
 * (340x150)/cab (240x240)/mic (160x160) into one row at a shared y with a
 * 100px dead gap between cab and mic and zero vertical relationship
 * (confirmed live: with those exact dimensions the row lands amp
 * x∈[40,380), cab x∈[380,620), mic x∈[720,880) -- a gap, not a rig).
 *
 * Deliberately does NOT touch `layoutShowpieceRow`/guiArchetypes.ts -- it's
 * shared by all 7 archetypes (not just "showpiece"), and changing its
 * packing logic risks regressing every other layout that also happens to
 * carry a showpiece param. Instead, RigStack treats whatever x/y/w/h the
 * caller was handed as uninformative (they were never coordinated for a
 * stacked rig to begin with) and composes its own internal layout from
 * scratch: a single shared container width, head sized narrower than and
 * layered on top of the cab, mic's existing drag-bar UI placed as a strip
 * below/in front of it.
 *
 * AmpHeadControl and CabinetControl are rendered completely UNMODIFIED --
 * both are already `w-full`, auto-height boxes with their own internal
 * padding/chrome, so composing them into a rig is purely a matter of their
 * wrapping container's width and vertical order, not touching their own
 * internals at all. MicPositionControl's real interactive drag-bar is kept
 * as-is (not replaced with a decorative mic-stand graphic) since it's the
 * only functional control of the three -- rewriting it as a static graphic
 * would remove real, currently-working interactivity for a cosmetic gain.
 */
export default function RigStack({ ampParam, cabParam, micParam, allParams, onChange, compact = false }: RigStackProps) {
  if (!ampParam && !cabParam && !micParam) return null;

  return (
    <div
      data-rig-stack={compact ? "compact" : "full"}
      className={compact ? "w-full pointer-events-none select-none" : "w-full"}
    >
      {ampParam && (
        // Narrower than the cab and layered above it (z-10, negative margin
        // pulling it down onto the cab's top edge) so it reads as SITTING ON
        // the cabinet rather than floating beside it.
        <div className="relative z-10 mx-auto" style={{ width: compact ? "76%" : "82%" }}>
          <AmpHeadControl param={ampParam} allParams={allParams} onChange={onChange} />
        </div>
      )}
      {cabParam && (
        <div
          className="relative w-full"
          style={{
            marginTop: ampParam ? -6 : 0,
            // Head casts a shadow down onto the cab it's sitting on -- a
            // hand-picked offset for now; Stage 3d's shadowOffset() helper
            // (unified light-direction model) replaces this once it lands.
            boxShadow: ampParam ? "0 8px 14px -6px rgba(0,0,0,0.55)" : undefined,
          }}
        >
          <CabinetControl param={cabParam} allParams={allParams} onChange={onChange} />
        </div>
      )}
      {micParam && !compact && (
        <div className="mt-2">
          <MicPositionControl param={micParam} allParams={allParams} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
