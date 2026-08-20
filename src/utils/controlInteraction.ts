/**
 * Shared keyboard-modifier interaction grammar for every draggable control
 * (PluginControl.tsx's Knob/Slider/Mic/EqCurve controls, UIDesigner.tsx's
 * CustomKnob). Pure functions only -- no DOM/React types -- so a plain
 * assertion test can cover every branch without a browser.
 *
 * Before this: every drag handler in the app used a single fixed-sensitivity
 * constant with zero keyboard-modifier awareness -- no fine adjustment, no
 * reset gesture, no wheel support. Research into how top-tier commercial
 * plugins (FabFilter et al.) handle control interaction consistently surfaced
 * a small, converged modifier grammar (shift = fine-adjust, double-click/
 * ctrl-click = reset, wheel = step) as one of the most directly *felt*
 * details separating "feels premium" from "feels amateur" -- it's physically
 * experienced on every interaction, not just seen once.
 */

/** Shift held while dragging divides the raw per-pixel delta so the same
 *  drag distance covers a smaller slice of the range -- "hold shift to be
 *  precise." 10x matches the common "shift = an order of magnitude finer"
 *  convention; not tied to any specific product's exact multiplier. */
export const FINE_ADJUST_DIVISOR = 10;

export function applyFineAdjust(rawDelta: number, shiftHeld: boolean, divisor: number = FINE_ADJUST_DIVISOR): number {
  return shiftHeld ? rawDelta / divisor : rawDelta;
}

/** Ctrl (Windows/Linux) or Cmd (macOS) held -- the project's chosen
 *  reset-to-default trigger alongside double-click. */
export function isResetModifier(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey;
}

/** One mouse-wheel "tick" step, as a fraction of the control's range: 1% per
 *  tick normally, 0.1% per tick with shift held -- the same "shift = 10x
 *  finer" grammar as drag, applied to the wheel gesture too. */
export function wheelStepDelta(range: number, shiftHeld: boolean, ticksPerFullRange: number = 100): number {
  const base = range / ticksPerFullRange;
  return shiftHeld ? base / FINE_ADJUST_DIVISOR : base;
}

/** Normalizes a WheelEvent's deltaY into a +1/-1/0 step direction, so callers
 *  don't have to reason about deltaMode or trackpad-vs-wheel magnitude.
 *  Wheel down (positive deltaY) = decrease, matching OS scroll convention
 *  (scrolling "down" moves a value down). */
export function wheelDirection(deltaY: number): -1 | 0 | 1 {
  if (deltaY === 0) return 0;
  return deltaY > 0 ? -1 : 1;
}

export function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
