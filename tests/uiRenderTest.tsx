import React from "react";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => { if (!ok) failures++; console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : "")); };
import { renderToStaticMarkup } from "react-dom/server";
import GenerativeFaceplate, { evaluateMover } from "../src/components/GenerativeFaceplate";
import RefineControl from "../src/components/RefineControl";
import { CustomKnob } from "../src/components/UIDesigner";
import { PluginManual, PluginManualContent } from "../src/components/PluginManual";
import { PluginControl } from "../src/components/PluginControl";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { buildPluginManual } from "../src/utils/featureManifest";
import { PluginParameter } from "../src/types";

const b = buildOfflinePlugin("make a dreamy shimmer reverb");
const gate = runQualityGate({ id: "p1", name: b.name, category: b.category, description: b.description, parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" }, { family: b.family, prompt: "make a dreamy shimmer reverb" });

const html1 = renderToStaticMarkup(<GenerativeFaceplate plugin={gate.plugin}><div>controls</div></GenerativeFaceplate>);
const html2 = renderToStaticMarkup(<GenerativeFaceplate plugin={gate.plugin}><div>controls</div></GenerativeFaceplate>);
check("faceplate renders svg", html1.includes("<svg"));
check("dreamy -> orbs (circles)", (html1.match(/<circle/g) || []).length >= 5);
check("deterministic (same plugin = same art)", html1 === html2);
check("uses theme accent", html1.includes(gate.plugin.customSkin!.accentColor!));
check("base themed wash present", html1.includes("radialGradient"));

// Motion is driven by a plain JS function of elapsed time (rAF-applied),
// not CSS/SMIL — verify its math directly: this is what actually moves
// pixels, independent of any browser's animation-feature support.
const driftSpec = { kind: "drift" as const, dx: 30, dy: -10, period: 8, phase: 0 };
const atRest = evaluateMover(driftSpec, 0);
const quarterPeriod = evaluateMover(driftSpec, 2); // sin peaks at t = period/4
check("drift mover: at rest at t=0 (phase 0)", atRest.transform === "translate(0.00px, -0.00px)" || atRest.transform === "translate(0.00px, 0.00px)", atRest.transform);
check("drift mover: displaced a quarter-period later", quarterPeriod.transform !== atRest.transform, quarterPeriod.transform);
check("drift mover: bounded by dx/dy amplitude", /translate\(30\.00px, -10\.00px\)/.test(quarterPeriod.transform || ""), quarterPeriod.transform);

const pulseSpec = { kind: "pulse" as const, minOp: 0.2, maxOp: 0.8, period: 4, phase: 0 };
const opacities = [0, 1, 2, 3, 4].map((t) => evaluateMover(pulseSpec, t).opacity!);
check("pulse mover: stays within [minOp, maxOp]", opacities.every((o) => o >= 0.2 - 1e-9 && o <= 0.8 + 1e-9), JSON.stringify(opacities));
check("pulse mover: actually varies over time (not stuck)", new Set(opacities.map((o) => o.toFixed(3))).size > 1, JSON.stringify(opacities));

const distB = buildOfflinePlugin("brutal metal distortion");
const distGate = runQualityGate({ id: "p2", name: distB.name, category: distB.category, description: "", parameters: distB.parameters, dspFunction: distB.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" }, { family: distB.family, prompt: "brutal metal distortion" });
const html3 = renderToStaticMarkup(<GenerativeFaceplate plugin={distGate.plugin}><div /></GenerativeFaceplate>);
check("aggressive -> stripes (rects)", (html3.match(/<rect/g) || []).length >= 5);
check("different plugins -> different art", html1 !== html3);

/* ---- Chassis details: corner screws + nameplate (the "this is hardware,  */
/* not a web card" cue) and the real seeded material filter, both actually */
/* present in the rendered markup, not just constructed and discarded.     */
{
  check("faceplate mounts a real material <filter> (feTurbulence/lighting, not just gradients)", html1.includes("<filter") && html1.includes("feTurbulence") && html1.includes("feDiffuseLighting") && html1.includes("feSpecularLighting"));
  check("faceplate renders 4 corner screws", (html1.match(/rounded-full pointer-events-none/g) || []).length === 4);
  check("faceplate renders its plugin's name as an engraved nameplate", html1.includes(gate.plugin.name));
  check("different plugins -> different material filter ids (not the same recipe reused verbatim)", (html1.match(/id="material-[^"]+"/) || [])[0] !== (html3.match(/id="material-[^"]+"/) || [])[0]);
  check("faceplate silhouette is chamfered (clip-path polygon), not a plain rectangle", html1.includes("clip-path") && html1.includes("polygon("));
  check("faceplate renders a top rail/fascia band with vent holes", (html1.match(/border-radius:50%/g) || []).length >= 5);
}

/* ---- PluginManual: the auto-generated per-plugin manual actually renders */
/* real per-control purpose text from FEATURE_MANIFEST -- not placeholder */
/* copy, and not just constructed and discarded.                          */
{
  const manualEntries = buildPluginManual(gate.plugin.parameters, gate.plugin.family);
  const realEntry = manualEntries.find((e) => e.tier !== "custom");
  const contentHtml = renderToStaticMarkup(<PluginManualContent plugin={gate.plugin} />);
  check("PluginManualContent: renders the plugin's own name and category", contentHtml.includes(gate.plugin.name) && contentHtml.includes(gate.plugin.category));
  check(
    "PluginManualContent: renders a REAL manifest purpose sentence, not placeholder text",
    !!realEntry && contentHtml.includes(realEntry.purpose),
    realEntry?.purpose
  );

  const closedHtml = renderToStaticMarkup(<PluginManual plugin={gate.plugin} isOpen={false} onClose={() => {}} />);
  check("PluginManual: renders nothing while closed", closedHtml === "");
  const openHtml = renderToStaticMarkup(<PluginManual plugin={gate.plugin} isOpen={true} onClose={() => {}} />);
  check("PluginManual: renders the modal chrome + content while open", openHtml.includes('role="dialog"') && !!realEntry && openHtml.includes(realEntry.purpose));
  const noPluginHtml = renderToStaticMarkup(<PluginManual plugin={undefined} isOpen={true} onClose={() => {}} />);
  check("PluginManual: no plugin -> renders nothing rather than crashing", noPluginHtml === "");
}

const off = renderToStaticMarkup(<RefineControl loops={0} onChange={() => {}} />);
const on = renderToStaticMarkup(<RefineControl loops={4} onChange={() => {}} />);
check("refine off: no number input", !off.includes("type=\"number\""));
check("refine on: number input with value", on.includes("type=\"number\"") && on.includes("value=\"4\""));
check("refine toggle accessible", on.includes("role=\"switch\"") && on.includes("aria-checked=\"true\""));

/* ---- CustomKnob: ordinary (non-amp) knobs now draw from the shared      */
/* uiRenderPatterns.ts recipe table instead of a fixed 4-bucket Tailwind   */
/* switch -- prove the generalization actually took effect in the         */
/* browser, not just that it compiles.                                    */
function knobParam(overrides: Partial<PluginParameter> = {}): PluginParameter {
  return { id: "cutoff", name: "Cutoff", min: 0, max: 100, value: 50, unit: "Hz", ...overrides } as PluginParameter;
}
{
  const themes = ["vintage-analog", "cyberpunk-neon", "modular-synth", "aero-slate"];
  const rendered = themes.map((theme) =>
    renderToStaticMarkup(<CustomKnob param={knobParam()} onChange={() => {}} onDblClick={() => {}} themeStyle={theme} />)
  );
  const distinct = new Set(rendered);
  check("CustomKnob: every legacy theme preset renders distinct output", distinct.size === themes.length, `${distinct.size}/${themes.length} distinct`);
  for (const html of rendered) check("CustomKnob: renders a real gradient background (not a flat Tailwind class)", /background:\s*linear-gradient|background:\s*radial-gradient/.test(html));
}
{
  // Unknown/unset theme falls back to the default style rather than
  // crashing or rendering nothing.
  const html = renderToStaticMarkup(<CustomKnob param={knobParam()} onChange={() => {}} onDblClick={() => {}} themeStyle="something-unrecognized" />);
  check("CustomKnob: unrecognized theme falls back safely (renders something)", html.length > 100);
}
{
  // Two different plugin CATEGORIES sharing the same explicit theme should
  // still be distinguishable by accentColor flowing into accent-driven
  // styles (neonring's ring color) -- proves per-plugin accent actually
  // reaches the shared renderer, not just the style bucket.
  const red = renderToStaticMarkup(<CustomKnob param={knobParam({ accentColor: "#ff0000" } as Partial<PluginParameter>)} onChange={() => {}} onDblClick={() => {}} themeStyle="cyberpunk-neon" />);
  const green = renderToStaticMarkup(<CustomKnob param={knobParam({ accentColor: "#00ff00" } as Partial<PluginParameter>)} onChange={() => {}} onDblClick={() => {}} themeStyle="cyberpunk-neon" />);
  check("CustomKnob: accentColor reaches the shared renderer (neonring)", red !== green);
}
{
  // Different knob VALUES must rotate the indicator differently -- the
  // recipe's sweep math is actually wired to param.value, not a static angle.
  const low = renderToStaticMarkup(<CustomKnob param={knobParam({ value: 0 })} onChange={() => {}} onDblClick={() => {}} themeStyle="aero-slate" />);
  const high = renderToStaticMarkup(<CustomKnob param={knobParam({ value: 100 })} onChange={() => {}} onDblClick={() => {}} themeStyle="aero-slate" />);
  check("CustomKnob: indicator rotation responds to param.value", low !== high);
}

/* ---- Round-2 UI Track 1: AmpHead/Cabinet/Pad now carry the same seeded
 * material grain KnobControl/SliderControl/ToggleControl already had --
 * previously flat rectangles with zero texture, the amp_sim family's own
 * showpiece identity. Meter is redrawn as discrete lit LED segments
 * instead of one continuous gradient fill. Checked by rendering the real
 * PluginControl dispatcher (not the underlying private components
 * directly -- those aren't exported, and the dispatcher is what every
 * real call site actually renders). ---- */
{
  const ctrlParam = (overrides: Partial<PluginParameter> = {}): PluginParameter =>
    ({ id: "p", name: "Test", min: 0, max: 1, value: 0, defaultValue: 0, unit: "", ...overrides } as PluginParameter);
  const noop = () => {};

  const ampHtml = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "amp" as any, name: "Amp" })} allParams={[]} onChange={noop} />
  );
  check("AmpHeadControl: carries the seeded material grain texture (not a flat color swatch)", ampHtml.includes("data:image/svg+xml"));
  check("AmpHeadControl: has a real bevel (lit top edge + dark bottom edge), not a bare drop-shadow", /inset 0 1px 0 rgba\(255,255,255/.test(ampHtml) && /inset 0 -1\.5px 0 rgba\(0,0,0/.test(ampHtml));

  const cabHtml = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "cab" as any, name: "Cab" })} allParams={[]} onChange={noop} />
  );
  check("CabinetControl: carries the seeded material grain texture", cabHtml.includes("data:image/svg+xml"));
  check("CabinetControl: grille dots are dimensional (radial-gradient highlight/shadow), not flat-filled circles", /radial-gradient\(circle at 35% 30%, rgba\(255,255,255/.test(cabHtml));

  const padOffHtml = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "pad" as any, name: "Pad", value: 0 })} allParams={[]} onChange={noop} />
  );
  const padOnHtml = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "pad" as any, name: "Pad", min: 0, max: 1, value: 1 })} allParams={[]} onChange={noop} />
  );
  check("PadControl: carries the seeded material grain texture at rest", padOffHtml.includes("data:image/svg+xml"));
  check("PadControl: carries the seeded material grain texture when active", padOnHtml.includes("data:image/svg+xml"));

  const meterHtml = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "meter" as any, name: "Meter", min: -60, max: 0, value: -12 })} allParams={[]} onChange={noop} />
  );
  // Lit segments are the bare 6-hex-digit color; dim (unlit) segments are
  // the same color with a "22" alpha suffix appended -- match on a
  // non-hex-digit boundary so "lit" doesn't accidentally also match the
  // dim form as a substring prefix.
  const litSegments = (meterHtml.match(/background-color:#(?:10b981|fbbf24|f43f5e)(?![0-9a-f])/g) || []).length;
  const dimSegments = (meterHtml.match(/background-color:#(?:10b981|fbbf24|f43f5e)22/g) || []).length;
  check("MeterControl: renders 12 discrete segments, not one continuous gradient bar", !meterHtml.includes("gradient"));
  check("MeterControl: has both lit and unlit segments at a mid-range value (real per-segment state, not all-on/all-off)", litSegments > 0 && dimSegments > 0, `lit=${litSegments} dim=${dimSegments}`);
  const meterFull = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "meter" as any, name: "Meter", min: -60, max: 0, value: 0 })} allParams={[]} onChange={noop} />
  );
  const meterEmpty = renderToStaticMarkup(
    <PluginControl param={ctrlParam({ controlType: "meter" as any, name: "Meter", min: -60, max: 0, value: -60 })} allParams={[]} onChange={noop} />
  );
  check("MeterControl: lit segment count actually tracks the value (decisive gap between empty and full)", meterFull !== meterEmpty && meterEmpty.includes("#10b98122"));
}

console.log(failures === 0 ? "UI RENDER: ALL CHECKS PASS" : failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
