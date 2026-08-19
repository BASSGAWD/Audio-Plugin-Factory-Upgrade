/**
 * Phase B of the UI craft knowledge base — uiRenderPatterns.ts:
 *
 *  - every knob/panel recipe's data is well-formed (valid gradient stops,
 *    valid hex colors, a real sweep range)
 *  - every style produces non-empty, MUTUALLY DISTINCT C++ paint code --
 *    guards against two styles silently emitting identical code, which
 *    would defeat "the compiled plugin matches the web preview" for at
 *    least one of them
 *  - generated C++ is structurally sane (balanced braces/parens)
 *  - the CSS converter's angle math matches the shared -135..135 sweep
 *    every knob in this project already uses
 *  - resolveKnobStyle's backward-compatible aliasing (the legacy
 *    "pointer"/"vintage" ampKnobStyle strings) still resolves correctly
 */
import { KNOB_RECIPES, PANEL_TEXTURE_RECIPES, METER_BALLISTICS, toCssKnobStyle, toJuceKnobPaintCode, toJucePanelPaintCode, resolveKnobStyle, KnobRenderStyle, PanelTextureStyle } from "../src/utils/uiRenderPatterns";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/* ---- knob recipe data validity ---- */
const knobStyles = Object.keys(KNOB_RECIPES) as KnobRenderStyle[];
check(`inventory: ${knobStyles.length} knob styles`, knobStyles.length === 5, `${knobStyles.length}`);
for (const style of knobStyles) {
  const r = KNOB_RECIPES[style];
  check(`${style}: recipe.style matches its own key`, r.style === style);
  check(`${style}: has >= 2 gradient stops`, r.bodyGradient.stops.length >= 2);
  const posAscending = r.bodyGradient.stops.every((s, i) => i === 0 || s.pos >= r.bodyGradient.stops[i - 1].pos);
  check(`${style}: gradient stop positions are ascending`, posAscending, JSON.stringify(r.bodyGradient.stops.map((s) => s.pos)));
  const allInRange = r.bodyGradient.stops.every((s) => s.pos >= 0 && s.pos <= 1);
  check(`${style}: all gradient stop positions in [0,1]`, allInRange);
  const validColors = r.bodyGradient.stops.every((s) => HEX_RE.test(s.color));
  check(`${style}: all gradient stop colors are valid hex`, validColors, JSON.stringify(r.bodyGradient.stops.map((s) => s.color)));
  check(`${style}: sweep is the shared -135..135 range`, r.sweep.startAngleDeg === -135 && r.sweep.endAngleDeg === 135);
  check(`${style}: indicator length/width fractions are in (0,1]`, r.indicator.lengthFraction > 0 && r.indicator.lengthFraction <= 1 && r.indicator.widthFraction > 0 && r.indicator.widthFraction <= 1);
}

/* ---- panel recipe data validity ---- */
const panelStyles = Object.keys(PANEL_TEXTURE_RECIPES) as PanelTextureStyle[];
check(`inventory: ${panelStyles.length} panel textures`, panelStyles.length === 6, `${panelStyles.length}`);
for (const style of panelStyles) {
  const r = PANEL_TEXTURE_RECIPES[style];
  check(`${style}: recipe.style matches its own key`, r.style === style);
  check(`${style}: baseColor is valid hex`, HEX_RE.test(r.baseColor), r.baseColor);
  check(`${style}: microStructure opacity in (0,1]`, r.microStructure.opacity > 0 && r.microStructure.opacity <= 1);
  check(`${style}: microStructure scalePx is positive`, r.microStructure.scalePx > 0);
}

/* ---- meter ballistics (constants only this phase) ---- */
check("vu_needle ballistics defined", METER_BALLISTICS.vu_needle.attackMs > 0 && METER_BALLISTICS.vu_needle.releaseMs > 0);
check("led_segment_peak ballistics defined", METER_BALLISTICS.led_segment_peak.attackMs > 0 && METER_BALLISTICS.led_segment_peak.releaseMs > 0);
check("LED peak attack is much faster than release (peak-hold character)", METER_BALLISTICS.led_segment_peak.attackMs < METER_BALLISTICS.led_segment_peak.releaseMs / 10);

/* ---- CSS converter ---- */
{
  const css = toCssKnobStyle(KNOB_RECIPES.modern_pointer, "#f97316");
  check("CSS: bodyBackground is a real gradient string", /gradient/.test(css.bodyBackground));
  check("CSS: indicatorAngleDeg(0) == sweep start", css.indicatorAngleDeg(0) === -135, `${css.indicatorAngleDeg(0)}`);
  check("CSS: indicatorAngleDeg(1) == sweep end", css.indicatorAngleDeg(1) === 135, `${css.indicatorAngleDeg(1)}`);
  check("CSS: indicatorAngleDeg(0.5) == sweep midpoint", css.indicatorAngleDeg(0.5) === 0, `${css.indicatorAngleDeg(0.5)}`);
  check("CSS: indicatorAngleDeg clamps below 0", css.indicatorAngleDeg(-1) === -135);
  check("CSS: indicatorAngleDeg clamps above 1", css.indicatorAngleDeg(2) === 135);
}
{
  // colorFromAccent: true styles should use the passed accent; fixed-color
  // styles should ignore it.
  const accented = toCssKnobStyle(KNOB_RECIPES.neonring, "#00ffcc");
  check("CSS: colorFromAccent style uses the passed accent color", accented.indicatorColor === "#00ffcc", accented.indicatorColor);
  const fixed = toCssKnobStyle(KNOB_RECIPES.silvercap, "#00ffcc");
  check("CSS: fixed-color style ignores the passed accent color", fixed.indicatorColor !== "#00ffcc", fixed.indicatorColor);
}

/* ---- JUCE knob paint code: non-empty, structurally sane, distinct ---- */
{
  const outputs = knobStyles.map((s) => toJuceKnobPaintCode(KNOB_RECIPES[s], s));
  for (let i = 0; i < knobStyles.length; i++) {
    const cpp = outputs[i];
    check(`${knobStyles[i]}: JUCE paint code is non-empty`, cpp.trim().length > 50);
    const ob = (cpp.match(/\{/g) || []).length, cb = (cpp.match(/\}/g) || []).length;
    check(`${knobStyles[i]}: JUCE paint code braces balanced`, ob === cb, `{=${ob} }=${cb}`);
    const op = (cpp.match(/\(/g) || []).length, cp = (cpp.match(/\)/g) || []).length;
    check(`${knobStyles[i]}: JUCE paint code parens balanced`, op === cp, `(=${op} )=${cp}`);
    check(`${knobStyles[i]}: references juce:: types`, /juce::/.test(cpp));
  }
  const unique = new Set(outputs);
  check("every knob style's C++ output is mutually distinct", unique.size === outputs.length, `${unique.size}/${outputs.length} distinct`);
}

/* ---- JUCE panel paint code: non-empty, structurally sane, distinct ---- */
{
  const outputs = panelStyles.map((s) => toJucePanelPaintCode(PANEL_TEXTURE_RECIPES[s]));
  for (let i = 0; i < panelStyles.length; i++) {
    const cpp = outputs[i];
    check(`${panelStyles[i]}: JUCE panel code is non-empty`, cpp.trim().length > 30);
    const ob = (cpp.match(/\{/g) || []).length, cb = (cpp.match(/\}/g) || []).length;
    check(`${panelStyles[i]}: JUCE panel code braces balanced`, ob === cb, `{=${ob} }=${cb}`);
    const op = (cpp.match(/\(/g) || []).length, cp = (cpp.match(/\)/g) || []).length;
    check(`${panelStyles[i]}: JUCE panel code parens balanced`, op === cp, `(=${op} )=${cp}`);
  }
  const unique = new Set(outputs);
  check("every panel style's C++ output is mutually distinct", unique.size === outputs.length, `${unique.size}/${outputs.length} distinct`);
}

/* ---- resolveKnobStyle: backward compatibility ---- */
check('resolveKnobStyle("pointer") -> modern_pointer (legacy alias)', resolveKnobStyle("pointer") === "modern_pointer");
check('resolveKnobStyle("vintage") -> vintage_amber (legacy alias)', resolveKnobStyle("vintage") === "vintage_amber");
check('resolveKnobStyle("chickenhead") -> chickenhead (unchanged)', resolveKnobStyle("chickenhead") === "chickenhead");
check('resolveKnobStyle("silvercap") -> silvercap (unchanged)', resolveKnobStyle("silvercap") === "silvercap");
check('resolveKnobStyle("neonring") -> neonring (unchanged)', resolveKnobStyle("neonring") === "neonring");
check("resolveKnobStyle(undefined) -> modern_pointer (default)", resolveKnobStyle(undefined) === "modern_pointer");
check("resolveKnobStyle(null) -> modern_pointer (default)", resolveKnobStyle(null) === "modern_pointer");
check('resolveKnobStyle("nonsense") -> modern_pointer (safe fallback)', resolveKnobStyle("nonsense") === "modern_pointer");

console.log(failures === 0 ? "\nUI RENDER PATTERNS: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
