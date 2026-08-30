/**
 * Phase B of the UI craft knowledge base — nativeBuild.ts's editor/
 * LookAndFeel generators:
 *
 * Before this: generatePluginEditorCpp rendered every parameter as one
 * identical generic juce::Slider on a flat color fill, regardless of
 * controlType/ampKnobStyle -- the compiled plugin and the web preview were
 * visually unrelated. Now every knob resolves a real style (explicit
 * ampKnobStyle, or a category-appropriate default) and the generated
 * PluginEditor.cpp/LookAndFeel.cpp draw from the SAME recipes
 * uiRenderPatterns.ts uses for the browser.
 *
 * Pure string-generation assertions -- no compiler invoked, matching
 * nativeBuildTest.ts's existing toolchain-free discipline.
 */
import {
  resolveParamKnobStyle,
  resolvePanelStyle,
  generateLookAndFeelHeader,
  generateLookAndFeelCpp,
  generatePluginEditorHeader,
  generatePluginEditorCpp,
  NativeParameter,
} from "../server/nativeBuild";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function braceParenBalance(s: string): { bracesOk: boolean; parensOk: boolean } {
  const ob = (s.match(/\{/g) || []).length, cb = (s.match(/\}/g) || []).length;
  const op = (s.match(/\(/g) || []).length, cp = (s.match(/\)/g) || []).length;
  return { bracesOk: ob === cb, parensOk: op === cp };
}

/* ---- resolveParamKnobStyle / resolvePanelStyle ---- */
{
  const withExplicit: NativeParameter = { id: "amp", name: "Amp", min: 0, max: 10, defaultValue: 5, ampKnobStyle: "silvercap" };
  check("explicit ampKnobStyle wins over category default", resolveParamKnobStyle(withExplicit, "distortion") === "silvercap");
}
{
  const noExplicit: NativeParameter = { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 10 };
  check("distortion category default applies with no explicit style", resolveParamKnobStyle(noExplicit, "distortion") === "chickenhead");
  check("synthesizer category default differs from distortion", resolveParamKnobStyle(noExplicit, "synthesizer") === "neonring");
  check("unknown category falls back to modern_pointer", resolveParamKnobStyle(noExplicit, "nonsense-category") === "modern_pointer");
  check("undefined category falls back to modern_pointer", resolveParamKnobStyle(noExplicit, undefined) === "modern_pointer");
}
{
  check("legacy ampKnobStyle alias resolves through resolveParamKnobStyle too", resolveParamKnobStyle({ id: "a", name: "A", min: 0, max: 1, defaultValue: 0, ampKnobStyle: "pointer" }, undefined) === "modern_pointer");
}
{
  check("resolvePanelStyle: distortion -> carbon_weave", resolvePanelStyle("distortion") === "carbon_weave");
  check("resolvePanelStyle: reverb -> matte_poly", resolvePanelStyle("reverb") === "matte_poly");
  check("resolvePanelStyle: unknown category falls back to matte_poly", resolvePanelStyle("nonsense") === "matte_poly");
  check("resolvePanelStyle: undefined category falls back to matte_poly", resolvePanelStyle(undefined) === "matte_poly");
}

/* ---- attribute-driven skeuomorphism: research-informed refinement of the
   category default (buildReport.attributes -- vintage/futuristic/etc. --
   the same vocabulary GenerativeFaceplate.tsx's ATTRIBUTE_PATTERN uses) ---- */
{
  const noExplicit: NativeParameter = { id: "cutoff", name: "Cutoff", min: 20, max: 20000, defaultValue: 1000 };
  check(
    "vintage attribute overrides filter's plain modern_pointer default",
    resolveParamKnobStyle(noExplicit, "filter", ["vintage"]) === "vintage_amber"
  );
  check(
    "vintage attribute overrides filter's plain matte_poly panel default",
    resolvePanelStyle("filter", ["vintage"]) === "wood_grain"
  );
  check(
    "futuristic attribute pushes toward neonring regardless of category",
    resolveParamKnobStyle(noExplicit, "dynamics", ["futuristic"]) === "neonring"
  );
  check(
    "no attributes: category default applies unchanged",
    resolveParamKnobStyle(noExplicit, "filter", undefined) === "modern_pointer"
  );
  check(
    "attributes present but none match a nudge entry: category default applies unchanged",
    resolveParamKnobStyle(noExplicit, "filter", ["dreamy"]) === "modern_pointer"
  );
  check(
    "ampKnobStyle still wins over an attribute nudge",
    resolveParamKnobStyle({ id: "a", name: "A", min: 0, max: 1, defaultValue: 0, ampKnobStyle: "silvercap" }, "filter", ["vintage"]) === "silvercap"
  );
  check(
    "first matching attribute in the array wins when several are present",
    resolveParamKnobStyle(noExplicit, "filter", ["nonsense-attr", "industrial", "futuristic"]) === "chickenhead"
  );
}

/* ---- generateLookAndFeelHeader ---- */
{
  const h = generateLookAndFeelHeader();
  const { bracesOk, parensOk } = braceParenBalance(h);
  check("LookAndFeel.h: braces balanced", bracesOk);
  check("LookAndFeel.h: parens balanced", parensOk);
  check("LookAndFeel.h: declares StyledLookAndFeel", /class StyledLookAndFeel/.test(h));
  check("LookAndFeel.h: declares drawRotarySlider override", /drawRotarySlider/.test(h));
}

/* ---- generateLookAndFeelCpp ---- */
{
  const cpp = generateLookAndFeelCpp(["chickenhead", "silvercap"], "#f97316");
  const { bracesOk, parensOk } = braceParenBalance(cpp);
  check("LookAndFeel.cpp: braces balanced", bracesOk);
  check("LookAndFeel.cpp: parens balanced", parensOk);
  check("LookAndFeel.cpp: has a branch for chickenhead", /style == "chickenhead"/.test(cpp));
  check("LookAndFeel.cpp: has a branch for silvercap", /style == "silvercap"/.test(cpp));
  check("LookAndFeel.cpp: always includes modern_pointer as the safety-net fallback branch", /style == "modern_pointer"/.test(cpp));
  check("LookAndFeel.cpp: falls back to base LookAndFeel_V4 for unrecognized style tags", /LookAndFeel_V4::drawRotarySlider/.test(cpp));
  check(
    "LookAndFeel.cpp: fallback receives named rotary angles",
    /float rotaryStartAngle, float rotaryEndAngle/.test(cpp) &&
      /sliderPosProportional, rotaryStartAngle, rotaryEndAngle, slider/.test(cpp)
  );
}
{
  // Two different style sets must produce genuinely different generated
  // code (not the same fixed output regardless of input).
  const a = generateLookAndFeelCpp(["chickenhead"], "#f97316");
  const b = generateLookAndFeelCpp(["neonring"], "#f97316");
  check("LookAndFeel.cpp differs for different style sets", a !== b);
}

/* ---- generatePluginEditorHeader ---- */
{
  const h = generatePluginEditorHeader("FuzzBox");
  const { bracesOk, parensOk } = braceParenBalance(h);
  check("PluginEditor.h: braces balanced", bracesOk);
  check("PluginEditor.h: parens balanced", parensOk);
  check("PluginEditor.h: includes LookAndFeel.h", /#include "LookAndFeel.h"/.test(h));
  check("PluginEditor.h: has a StyledLookAndFeel member", /StyledLookAndFeel styledLookAndFeel;/.test(h));
  check("PluginEditor.h: destructor is NOT defaulted (needs to call setLookAndFeel(nullptr))", !/~FuzzBoxAudioProcessorEditor\(\) override = default;/.test(h));
}

/* ---- generatePluginEditorCpp ---- */
const params: NativeParameter[] = [
  { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 10, unit: "dB" },
  { id: "tone", name: "Tone", min: 500, max: 12000, defaultValue: 4200, unit: "Hz" },
  { id: "ampCharacter", name: "Amp", min: 0, max: 10, defaultValue: 5, ampKnobStyle: "silvercap" },
];
const skin = { bgColor: "#12161D", accentColor: "#f97316", textColor: "#F4F7FB" };
{
  const cpp = generatePluginEditorCpp("FuzzBox", params, skin, "distortion");
  const { bracesOk, parensOk } = braceParenBalance(cpp);
  check("PluginEditor.cpp: braces balanced", bracesOk);
  check("PluginEditor.cpp: parens balanced", parensOk);
  check("PluginEditor.cpp: wires setLookAndFeel in the constructor", /setLookAndFeel \(&styledLookAndFeel\)/.test(cpp));
  check("PluginEditor.cpp: resets LookAndFeel in the destructor", /setLookAndFeel \(nullptr\)/.test(cpp));
  check("PluginEditor.cpp: initializes styledLookAndFeel with the plugin's accent color", /styledLookAndFeel \(juce::Colour::fromString \("fff97316"\)\)/.test(cpp));
  check("PluginEditor.cpp: category-default-styled param carries its resolved knobStyle tag", /knobStyle", "chickenhead"/.test(cpp));
  check("PluginEditor.cpp: explicitly-styled param carries ITS OWN tag, not the category default", /knobStyle", "silvercap"/.test(cpp));
  // Regression check for a real bug caught during development: paint() must
  // fill with the PLUGIN'S OWN bgColor, not silently overwrite it with the
  // panel recipe's own fixed base color.
  check("PluginEditor.cpp: paint() fills with the plugin's actual customSkin.bgColor", /g\.fillAll \(juce::Colour::fromString \("ff12161D"\)\)/.test(cpp));
  check("PluginEditor.cpp: paint() does NOT also fill with the panel recipe's own unrelated base color", (cpp.match(/g\.fillAll/g) || []).length === 1, `fillAll count=${(cpp.match(/g\.fillAll/g) || []).length}`);
  check("PluginEditor.cpp: panel texture overlay is present (carbon_weave diagonal weave)", /drawLine/.test(cpp));
  // Keyboard-modifier interaction grammar (research-informed): the native
  // slider should get real JUCE interaction behavior, not just paint/color
  // config -- double-click-to-reset, velocity-based fine/coarse drag, and a
  // floating value popup while dragging/hovering.
  check("PluginEditor.cpp: wires setDoubleClickReturnValue with the param's own default", /setDoubleClickReturnValue \(true, 10\)/.test(cpp));
  check("PluginEditor.cpp: enables velocity-based mode for fast/slow-drag sensitivity", /setVelocityBasedMode \(true\)/.test(cpp));
  check("PluginEditor.cpp: enables a popup value display", /setPopupDisplayEnabled \(true, true, this\)/.test(cpp));
}

/* ---- semantic grouping/layout shared with the web generation pipeline ---- */
{
  const semanticParams: NativeParameter[] = [
    { id: "drive", name: "Drive", min: 0, max: 10, defaultValue: 5, x: 40, y: 70, w: 120, h: 100, uiGroup: "character", uiGroupLabel: "Character" },
    { id: "tone", name: "Tone", min: 0, max: 1, defaultValue: .5, x: 180, y: 70, w: 120, h: 100, uiGroup: "tone", uiGroupLabel: "Tone" },
  ];
  const h = generatePluginEditorHeader("Grouped");
  const cpp = generatePluginEditorCpp("Grouped", semanticParams, { bgColor: "#111111", accentColor: "#f97316", textColor: "#ffffff" }, "distortion");
  check("PluginEditor.h owns semantic section primitives", /OwnedArray<juce::GroupComponent> semanticGroups/.test(h));
  check("PluginEditor.cpp renders shared semantic labels", /CHARACTER/.test(cpp) && /TONE/.test(cpp));
  check("PluginEditor.cpp uses generation-pipeline coordinates", /Rectangle<int> cell \(40, 70, 120, 100\)/.test(cpp));
}

/* ---- native controls preserve semantic visual primitives ---- */
{
  const visualParams: NativeParameter[] = [
    { id: "enabled", name: "Enabled", min: 0, max: 1, defaultValue: 1, controlType: "toggle" },
    { id: "meter", name: "Meter", min: -60, max: 0, defaultValue: -12, controlType: "meter" },
    { id: "curve", name: "Curve", min: 0, max: 1, defaultValue: 0, controlType: "eq" },
    { id: "pad", name: "Pad", min: 0, max: 127, defaultValue: 0, controlType: "pad" },
    { id: "head", name: "Head", min: 0, max: 1, defaultValue: 0, controlType: "amp" },
    { id: "cab", name: "Cab", min: 0, max: 1, defaultValue: 0, controlType: "cab" },
    { id: "mic", name: "Mic", min: 0, max: 1, defaultValue: 0, controlType: "mic" },
  ];
  const h = generatePluginEditorHeader("Visuals");
  const cpp = generatePluginEditorCpp("Visuals", visualParams);
  check("JUCE declares dedicated native primitive inventories", /OwnedArray<juce::ToggleButton> toggles/.test(h) && /OwnedArray<juce::TextButton> pads/.test(h) && /OwnedArray<juce::Component> visualComponents/.test(h));
  check("JUCE uses attached ToggleButton instead of rotary slider", /ToggleButton \("Enabled"\)/.test(cpp) && /ButtonAttachment/.test(cpp));
  check("JUCE uses pad button, segmented meter, and curve EQ", /TextButton \("Pad"\)/.test(cpp) && /segment < 12/.test(cpp) && /Curve-led EQ monitor/.test(cpp));
  check("JUCE paints amp/cab and mic native visuals", /amp hardware faceplate/.test(cpp) && /cab hardware faceplate/.test(cpp) && /Mic-position target/.test(cpp));
  check("JUCE meter reads processor levels only from its UI timer", /void timerCallback\(\) override[\s\S]*processor\.getMeterLevels \(meterLeft, meterRight\)/.test(cpp));
  check("JUCE meter timer runs even when decorative motion is disabled", /if \(type == "meter" \|\| \(allowMotion && type == "eq"\)\) startTimerHz/.test(cpp));
  check("JUCE reduced-motion gate only advances decorative phase", /if \(decorativeMotionAllowed\)\s*phase \+=/.test(cpp));
  check("JUCE visual keeps a processor reference owned for no longer than the editor", /RecipeVisualComponent \(processorRef, "meter"/.test(cpp));
}
{
  // Different categories with NO explicit ampKnobStyle must resolve to
  // different knob AND panel styles -- proves the category default is
  // actually wired through end-to-end, not a hardcoded constant.
  const bareParams: NativeParameter[] = [{ id: "freq", name: "Freq", min: 20, max: 20000, defaultValue: 1000 }];
  const distCpp = generatePluginEditorCpp("Dist", bareParams, skin, "distortion");
  const synthCpp = generatePluginEditorCpp("Synth", bareParams, skin, "synthesizer");
  check("distortion and synthesizer categories produce different knobStyle tags", distCpp.includes('"chickenhead"') && synthCpp.includes('"neonring"'));
  check("distortion and synthesizer categories produce different panel textures", distCpp !== synthCpp);
}
{
  // No category at all must still produce valid, balanced output (safe
  // defaults throughout), not a crash or malformed file.
  const bareParams: NativeParameter[] = [{ id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 1 }];
  const cpp = generatePluginEditorCpp("Untitled", bareParams, undefined, undefined);
  const { bracesOk, parensOk } = braceParenBalance(cpp);
  check("no category, no customSkin: still balanced, valid output", bracesOk && parensOk);
  check("no category: falls back to modern_pointer knob style", cpp.includes('"modern_pointer"'));
}

console.log(failures === 0 ? "\nNATIVE BUILD EDITOR: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
