import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioPlugin } from "../src/types";
import GenerativeFaceplate from "../src/components/GenerativeFaceplate";
import { PluginControl } from "../src/components/PluginControl";
import { evaluateEqIdentityMotion, resolveVisualIdentity } from "../src/utils/visualIdentity";
import { resolveSemanticUiContract } from "../src/utils/semanticUi";
import { validateResolvedUiContract } from "../src/utils/semanticUi";
import { identityPanelStyle } from "../src/utils/visualIdentity";
import { PANEL_TEXTURE_RECIPES, panelTextureCss, toJucePanelPaintCode } from "../src/utils/uiRenderPatterns";
import { generatePluginEditorCpp, validateNativePlugin } from "../server/nativeBuild";

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};

function plugin(id: string, family: string): AudioPlugin {
  const category = family === "eq" || family === "amp_sim" || family === "sampler" ? "filter" : family as AudioPlugin["category"];
  const p: AudioPlugin = {
    id, name: "Explicit User Name", category, family, description: "", dspFunction: "return input;",
    faustCode: "", cppJuceCode: "", createdAt: "2025-01-01T00:00:00.000Z",
    buildReport: { attributes: family === "reverb" ? ["dreamy"] : [], primaryControls: [] } as any,
    parameters: [{ id: "display", name: "Display", min: 0, max: 1, defaultValue: .5, value: .5, unit: "", controlType: family === "eq" ? "eq" : "meter", x: 28, y: 64, w: family === "eq" ? 260 : 100, h: family === "eq" ? 120 : 80 }],
  };
  p.resolvedUi = resolveSemanticUiContract(p, [], family);
  return p;
}

const families = ["amp_sim", "eq", "dynamics", "modulation", "delay", "reverb", "sampler", "synthesizer"];
const recipes = families.map((f) => resolveVisualIdentity(plugin(`identity-${f}`, f), f));
check("same spec resolves identically", JSON.stringify(recipes[0]) === JSON.stringify(resolveVisualIdentity(plugin("identity-amp_sim", "amp_sim"), "amp_sim")));
check("all required families visibly differentiate", new Set(recipes.map((r) => `${r.hardwareMotif}/${r.artwork}/${r.meter}/${r.modelLabel}`)).size === families.length);
check("many stable identities avoid recipe collisions", new Set(Array.from({ length: 512 }, (_, i) => resolveVisualIdentity(plugin(`collision-${i}`, "eq"), "eq").id)).size === 512);
check("explicit user name is not renamed", plugin("stable", "eq").name === "Explicit User Name");
check("unsupported quality-gate family falls back to a renderer-supported category", resolveVisualIdentity(plugin("hybrid", "synthesizer"), "hybrid_other").family === "synthesizer");
check("motion is reduced to static", recipes.every((r) => evaluateEqIdentityMotion(r, 12.5, true) === 0));
check("motion remains bounded", recipes.every((r) => Array.from({ length: 100 }, (_, i) => Math.abs(evaluateEqIdentityMotion(r, i / 7, false)) <= 2.5).every(Boolean)));

const eqPlugin = plugin("web-eq", "eq");
const html = renderToStaticMarkup(<GenerativeFaceplate plugin={eqPlugin}>
  <PluginControl param={eqPlugin.parameters[0]} allParams={eqPlugin.parameters} onChange={() => {}} />
</GenerativeFaceplate>);
check("web faceplate consumes identity id and family", html.includes(`data-identity-recipe="${eqPlugin.resolvedUi!.identityRecipe!.id}"`) && html.includes('data-identity-family="eq"'));
check("web EQ consumes recipe style", html.includes(`data-eq-recipe="${eqPlugin.resolvedUi!.identityRecipe!.eqMotion}"`));
const ampPlugin = plugin("web-amp", "amp_sim");
const ampHtml = renderToStaticMarkup(<GenerativeFaceplate plugin={ampPlugin}><div /></GenerativeFaceplate>);
check("web panel/model are real recipe output", ampHtml.includes(ampPlugin.resolvedUi!.identityRecipe!.modelLabel) && ampHtml.includes(identityPanelStyle(ampPlugin.resolvedUi!.identityRecipe!.panel)));
const dynamicsPlugin = plugin("web-meter", "dynamics");
const meterHtml = renderToStaticMarkup(<GenerativeFaceplate plugin={dynamicsPlugin}>
  <PluginControl param={dynamicsPlugin.parameters[0]} allParams={dynamicsPlugin.parameters} onChange={() => {}} />
</GenerativeFaceplate>);
check("web meter consumes recipe renderer", meterHtml.includes(`data-meter-recipe="${dynamicsPlugin.resolvedUi!.identityRecipe!.meter}"`));

const native = generatePluginEditorCpp("Identity", eqPlugin.parameters, undefined, eqPlugin.category, [], eqPlugin.resolvedUi, eqPlugin.family);
check("native emits exact recipe parity tokens", native.includes(eqPlugin.resolvedUi!.identityRecipe!.id) && native.includes(`family=${eqPlugin.family}`) && native.includes(eqPlugin.resolvedUi!.identityRecipe!.eqMotion));
const nativeExecutableLines = native.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
check("native visibly paints model and style plaque", nativeExecutableLines.includes(`g.drawText ("${eqPlugin.resolvedUi!.identityRecipe!.modelLabel}"`) && nativeExecutableLines.includes(eqPlugin.resolvedUi!.identityRecipe!.styleTokens.join(" / ").toUpperCase()));
check("native uses safe repaint-only visual timer", native.includes("timerCallback() override") && native.includes("repaint();") && !native.includes("processBlock"));
check("native emits specialized visual subclass", native.includes("class RecipeVisualComponent final"));
const ampNative = generatePluginEditorCpp("AmpIdentity", ampPlugin.parameters, undefined, ampPlugin.category, [], ampPlugin.resolvedUi, ampPlugin.family);
check("native panel/motif alter emitted renderer behavior", ampNative !== native && ampNative.includes('new RecipeVisualComponent') && ampNative.includes('style == "rack"') && ampNative.includes("fillAll"));
const legacyContract = { ...eqPlugin.resolvedUi! };
delete (legacyContract as any).identityRecipe;
check("old persisted contract stays valid", validateResolvedUiContract(JSON.parse(JSON.stringify(legacyContract))).length === 0);
check("new contract survives persistence round trip", validateResolvedUiContract(JSON.parse(JSON.stringify(eqPlugin.resolvedUi))).length === 0);
const stillPlugin = plugin("static-identity", "eq");
stillPlugin.resolvedUi = { ...stillPlugin.resolvedUi!, identityRecipe: { ...stillPlugin.resolvedUi!.identityRecipe!, motionPolicy: "static", eqMotion: "static" } };
const stillNative = generatePluginEditorCpp("StaticIdentity", stillPlugin.parameters, undefined, stillPlugin.category, [], stillPlugin.resolvedUi, stillPlugin.family);
check("native static policy suppresses decorative motion without suppressing essential meter feedback",
  stillNative.includes(", false));")
  && stillNative.includes('if (type == "meter" || (allowMotion && type == "eq"))')
  && stillNative.includes("if (decorativeMotionAllowed)"));
const panelTokens = ["machined", "tolex", "wood", "polymer", "glass"] as const;
check("every panel token has distinct real Web CSS", new Set(panelTokens.map((token) => JSON.stringify(panelTextureCss(identityPanelStyle(token))))).size === panelTokens.length);
check("every panel token has distinct JUCE paint", new Set(panelTokens.map((token) => toJucePanelPaintCode(PANEL_TEXTURE_RECIPES[identityPanelStyle(token)]))).size === panelTokens.length);

const explicitKnob = plugin("explicit-knob", "amp_sim");
explicitKnob.parameters = [{ ...explicitKnob.parameters[0], id: "gain", name: "Gain", controlType: "knob", ampKnobStyle: "chickenhead", w: 100, h: 100 }];
explicitKnob.resolvedUi = resolveSemanticUiContract(explicitKnob, ["gain"], "amp_sim");
const explicitWeb = renderToStaticMarkup(<GenerativeFaceplate plugin={explicitKnob}><PluginControl param={explicitKnob.parameters[0]} allParams={explicitKnob.parameters} onChange={() => {}} /></GenerativeFaceplate>);
const explicitNative = generatePluginEditorCpp("ExplicitKnob", explicitKnob.parameters, undefined, explicitKnob.category, [], explicitKnob.resolvedUi, explicitKnob.family);
check("explicit knob resolves once with Web/native parity", explicitKnob.resolvedUi.controls[0].style.knob === "chickenhead" && explicitWeb.includes("#2b2b2b") && explicitNative.includes('set ("knobStyle", "chickenhead")'));

const corruptKnobPlugin = plugin("corrupt-knob", "eq");
(corruptKnobPlugin.resolvedUi!.controls[0].style as any).knob = "not-a-real-knob";
check("validator rejects malformed persisted knob style", validateResolvedUiContract(corruptKnobPlugin.resolvedUi).some((issue) => issue.includes("unsupported control knob style")));
let corruptWebRendered = false;
try {
  renderToStaticMarkup(<GenerativeFaceplate plugin={corruptKnobPlugin}>
    <PluginControl param={corruptKnobPlugin.parameters[0]} allParams={corruptKnobPlugin.parameters} onChange={() => {}} />
  </GenerativeFaceplate>);
  corruptWebRendered = true;
} catch {
  corruptWebRendered = false;
}
check("malformed persisted knob style falls back without crashing Web", corruptWebRendered);
let corruptNativeRejected = false;
try {
  validateNativePlugin({ name: corruptKnobPlugin.name, category: corruptKnobPlugin.category, family: corruptKnobPlugin.family, parameters: corruptKnobPlugin.parameters, dspFunction: corruptKnobPlugin.dspFunction, resolvedUi: corruptKnobPlugin.resolvedUi });
} catch {
  corruptNativeRejected = true;
}
check("native rejects malformed persisted knob style", corruptNativeRejected);

const sourceFamilyCategories: Record<string, AudioPlugin["category"]> = {
  eq: "filter", filter: "filter", distortion: "distortion", saturator: "distortion",
  multiband_saturator: "filter", delay: "delay", reverb: "reverb",
  modulation: "modulation", dynamics: "dynamics", synthesizer: "synthesizer",
  pitch: "synthesizer", amp_sim: "distortion", sampler: "synthesizer",
  utility: "filter", hybrid_other: "filter",
};
const allSourceFamiliesPassNative = Object.entries(sourceFamilyCategories).every(([sourceFamily, category]) => {
  const candidate = plugin(`native-source-${sourceFamily}`, sourceFamily);
  candidate.family = sourceFamily;
  candidate.category = category;
  candidate.resolvedUi = resolveSemanticUiContract(candidate, [], sourceFamily);
  try {
    validateNativePlugin({
      name: candidate.name, category: candidate.category, family: candidate.family,
      parameters: candidate.parameters, dspFunction: candidate.dspFunction, resolvedUi: candidate.resolvedUi,
    });
    return true;
  } catch {
    return false;
  }
});
check("every declared source family passes canonical native validation", allSourceFamiliesPassNative);

const invalid = { ...eqPlugin.resolvedUi!, identityRecipe: { ...eqPlugin.resolvedUi!.identityRecipe!, id: "bad\"; cpp" } };
let rejected = false;
try {
  validateNativePlugin({ name: eqPlugin.name, category: eqPlugin.category, family: eqPlugin.family, parameters: eqPlugin.parameters, dspFunction: eqPlugin.dspFunction, resolvedUi: invalid });
} catch {
  rejected = true;
}
check("native rejects unsafe recipe identity", rejected);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nVISUAL IDENTITY: ALL CHECKS PASS");
process.exit(failures ? 1 : 0);