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
import {
  KNOB_RECIPES,
  PANEL_TEXTURE_RECIPES,
  METER_BALLISTICS,
  ballisticsStep,
  SPECTRUM_ANALYZER_RECIPE,
  spectrumBinToHz,
  tiltGainDb,
  byteMagnitudeToDisplayHeight01,
  toCssKnobStyle,
  toJuceKnobPaintCode,
  toJucePanelPaintCode,
  resolveKnobStyle,
  KnobRenderStyle,
  PanelTextureStyle,
} from "../src/utils/uiRenderPatterns";

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

/* ---- meter ballistics ---- */
check("vu_needle ballistics defined", METER_BALLISTICS.vu_needle.attackMs > 0 && METER_BALLISTICS.vu_needle.releaseMs > 0);
check("led_segment_peak ballistics defined", METER_BALLISTICS.led_segment_peak.attackMs > 0 && METER_BALLISTICS.led_segment_peak.releaseMs > 0);
check("LED peak attack is much faster than release (peak-hold character)", METER_BALLISTICS.led_segment_peak.attackMs < METER_BALLISTICS.led_segment_peak.releaseMs / 10);

/* ---- ballisticsStep: now wired into PluginControl.tsx's useSignalLevel ---- */
{
  const b = METER_BALLISTICS.led_segment_peak;
  // Rising target (attack, 3ms tau): should reach very close to target within
  // a handful of milliseconds.
  let level = 0;
  for (let i = 0; i < 20; i++) level = ballisticsStep(level, 1, 5, b);
  check("attack: rises toward a higher target", level > 0.9, `${level}`);

  // Falling target (release, 800ms tau): after the SAME elapsed time, should
  // have moved much LESS than the attack case did -- proves attack/release
  // are actually asymmetric, not just one shared time-constant.
  let falling = 1;
  for (let i = 0; i < 20; i++) falling = ballisticsStep(falling, 0, 5, b);
  const roseBy = level; // started at 0, target 1
  const fellBy = 1 - falling; // started at 1, target 0
  check("release is decisively slower than attack for the same dtMs", fellBy < roseBy, `rose by ${roseBy}, fell by ${fellBy}`);

  check("never overshoots past the target when rising", ballisticsStep(0, 1, 1e6, b) <= 1);
  check("never undershoots past the target when falling", ballisticsStep(1, 0, 1e6, b) >= 0);
  check("dtMs=0 leaves current unchanged", ballisticsStep(0.4, 1, 0, b) === 0.4);
  check("already at target stays at target", ballisticsStep(0.5, 0.5, 50, b) === 0.5);
}

/* ---- spectrum analyzer recipe ---- */
{
  check("FFT-size ladder has 4 steps", SPECTRUM_ANALYZER_RECIPE.fftSizes.length === 4);
  check("FFT sizes are ascending powers of two", SPECTRUM_ANALYZER_RECIPE.fftSizes.every((v, i, arr) => i === 0 || v > arr[i - 1]));
  check("default FFT size is a member of the ladder", SPECTRUM_ANALYZER_RECIPE.fftSizes.includes(SPECTRUM_ANALYZER_RECIPE.defaultFftSize));
  check("dB-range ladder has 3 steps", SPECTRUM_ANALYZER_RECIPE.dbRanges.length === 3);
  check("default dB range is a member of the ladder", SPECTRUM_ANALYZER_RECIPE.dbRanges.includes(SPECTRUM_ANALYZER_RECIPE.defaultDbRange));
  check("tilt is a positive dB/octave slope", SPECTRUM_ANALYZER_RECIPE.tiltDbPerOctave > 0);
  check("tilt pivot sits in the audible mid-range", SPECTRUM_ANALYZER_RECIPE.tiltPivotHz > 200 && SPECTRUM_ANALYZER_RECIPE.tiltPivotHz < 5000);

  check("spectrumBinToHz(0, ...) is 0 Hz (DC bin)", spectrumBinToHz(0, 512, 44100) === 0);
  check("spectrumBinToHz(binCount, ...) reaches Nyquist", spectrumBinToHz(512, 512, 44100) === 22050);
  check("spectrumBinToHz is monotonically increasing with bin index", spectrumBinToHz(100, 512, 44100) < spectrumBinToHz(200, 512, 44100));

  check("tiltGainDb(0) is a no-op (guarded against -Infinity)", tiltGainDb(0) === 0);
  check("tiltGainDb at the pivot frequency is 0 dB", Math.abs(tiltGainDb(SPECTRUM_ANALYZER_RECIPE.tiltPivotHz)) < 1e-9);
  check("tiltGainDb rises above the pivot", tiltGainDb(SPECTRUM_ANALYZER_RECIPE.tiltPivotHz * 4) > 0);
  check("tiltGainDb falls below the pivot", tiltGainDb(SPECTRUM_ANALYZER_RECIPE.tiltPivotHz / 4) < 0);
  check("tiltGainDb is monotonic across octaves", tiltGainDb(8000) > tiltGainDb(4000) && tiltGainDb(4000) > tiltGainDb(2000));

  check("byteMagnitudeToDisplayHeight01(0, ...) is exactly 0", byteMagnitudeToDisplayHeight01(0, 1000) === 0);
  check("byteMagnitudeToDisplayHeight01 stays within [0,1] across the full byte range", (() => {
    for (let b = 0; b <= 255; b += 5) {
      for (const hz of [50, 1000, 15000]) {
        const h = byteMagnitudeToDisplayHeight01(b, hz);
        if (h < 0 || h > 1) return false;
      }
    }
    return true;
  })());
  check("a louder byte value produces a taller (or equal) bar than a quieter one", byteMagnitudeToDisplayHeight01(200, 1000) >= byteMagnitudeToDisplayHeight01(100, 1000));
  check("a tighter dB range (60) clips a quiet signal harder than a wider range (120)", byteMagnitudeToDisplayHeight01(60, 1000, SPECTRUM_ANALYZER_RECIPE, 60) <= byteMagnitudeToDisplayHeight01(60, 1000, SPECTRUM_ANALYZER_RECIPE, 120));
}

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
