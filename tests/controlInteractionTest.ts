/**
 * Shared keyboard-modifier interaction grammar (controlInteraction.ts) --
 * pure-function coverage of shift-fine-adjust, wheel step direction/
 * magnitude, the reset-modifier check, and range clamping. The actual event
 * wiring (mousedown/wheel/dblclick handlers in PluginControl.tsx and
 * UIDesigner.tsx's CustomKnob) can only be verified live in a browser -- this
 * file covers the math those handlers all share.
 */
import {
  FINE_ADJUST_DIVISOR,
  applyFineAdjust,
  isResetModifier,
  wheelStepDelta,
  wheelDirection,
  clampToRange,
} from "../src/utils/controlInteraction";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- applyFineAdjust ---- */
{
  check("no shift: delta passes through unchanged", applyFineAdjust(50, false) === 50);
  check("shift held: delta divided by FINE_ADJUST_DIVISOR", applyFineAdjust(50, true) === 50 / FINE_ADJUST_DIVISOR);
  check("FINE_ADJUST_DIVISOR is a real order-of-magnitude factor", FINE_ADJUST_DIVISOR >= 5 && FINE_ADJUST_DIVISOR <= 20);
  check("custom divisor honored", applyFineAdjust(100, true, 4) === 25);
  check("negative delta: shift still scales toward zero, not away", Math.abs(applyFineAdjust(-80, true)) < Math.abs(-80));
  check("zero delta stays zero regardless of shift", applyFineAdjust(0, true) === 0 && applyFineAdjust(0, false) === 0);
}

/* ---- isResetModifier ---- */
{
  check("ctrl held -> reset modifier", isResetModifier({ ctrlKey: true, metaKey: false }));
  check("meta (cmd) held -> reset modifier", isResetModifier({ ctrlKey: false, metaKey: true }));
  check("both held -> still reset modifier", isResetModifier({ ctrlKey: true, metaKey: true }));
  check("neither held -> not a reset modifier", !isResetModifier({ ctrlKey: false, metaKey: false }));
}

/* ---- wheelStepDelta ---- */
{
  const range = 100;
  const normal = wheelStepDelta(range, false);
  const fine = wheelStepDelta(range, true);
  check("normal wheel step is 1% of range (default 100 ticks)", Math.abs(normal - 1) < 1e-9);
  check("shift wheel step is 10x finer than normal", Math.abs(fine - normal / FINE_ADJUST_DIVISOR) < 1e-9);
  check("shift step is decisively smaller than normal step", fine < normal);
  check("custom ticksPerFullRange honored", wheelStepDelta(range, false, 50) === 2);
}

/* ---- wheelDirection ---- */
{
  check("positive deltaY (scroll down) -> decrease (-1)", wheelDirection(5) === -1);
  check("negative deltaY (scroll up) -> increase (+1)", wheelDirection(-5) === 1);
  check("zero deltaY -> no direction (0)", wheelDirection(0) === 0);
  check("large positive deltaY still -1 (direction, not magnitude)", wheelDirection(240) === -1);
}

/* ---- clampToRange ---- */
{
  check("value within range passes through", clampToRange(5, 0, 10) === 5);
  check("value below min clamps to min", clampToRange(-5, 0, 10) === 0);
  check("value above max clamps to max", clampToRange(15, 0, 10) === 10);
  check("value exactly at min stays at min", clampToRange(0, 0, 10) === 0);
  check("value exactly at max stays at max", clampToRange(10, 0, 10) === 10);
}

console.log(failures === 0 ? "\nCONTROL INTERACTION: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
