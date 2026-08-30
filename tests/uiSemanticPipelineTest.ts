import { AudioPlugin, PluginParameter } from "../src/types";
import React from "react";
import { buildUiSpec, orderParametersBySpec } from "../src/utils/uiSpec";
import { hasCoherentFaceplateGeometry, isGenericUndifferentiatedGrid, runQualityGate, scoreLooks } from "../src/utils/qualityGate";
import { applyArchetype, pickArchetype } from "../src/utils/guiArchetypes";
import GenerativeFaceplate from "../src/components/GenerativeFaceplate";
import { renderToStaticMarkup } from "react-dom/server";
import { generatePluginEditorCpp } from "../server/nativeBuild";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}
const P = (id: string, controlType: PluginParameter["controlType"] = "knob"): PluginParameter => ({
  id, name: id, min: 0, max: 1, defaultValue: .5, value: .5, unit: "", controlType,
});

{
  const params = [P("threshold"), P("attack"), P("release"), P("tone"), P("mix"), P("bypass", "toggle"), P("gain_reduction", "meter")];
  const spec = buildUiSpec("clinical compressor", params, "dynamics");
  check("dynamics creates multiple meaningful groups", spec.groups.length >= 4, spec.groups.map((g) => g.id).join(","));
  check("dynamics section leads family hierarchy", spec.groups[0]?.id === "dynamics");
  const ordered = orderParametersBySpec(params, spec);
  check("semantic metadata is stamped onto shipped controls", ordered.every((p) => !!p.uiRole && !!p.uiGroupLabel));
  check("controls are ordered by family sections", ordered.findIndex((p) => p.id === "tone") > ordered.findIndex((p) => p.id === "release"));
}

{
  const params = [P("delay_time"), P("feedback"), P("mod_rate"), P("mod_depth"), P("tone"), P("mix"), P("bypass", "toggle")];
  const plugin: AudioPlugin = {
    id: "delay", name: "Delay", category: "delay", description: "", parameters: params,
    dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
  };
  const gated = runQualityGate(plugin, { family: "delay", prompt: "warm tape delay", uiMetaphor: "rack_unit" });
  const groups = new Set(gated.plugin.parameters.map((p) => p.uiGroup).filter(Boolean));
  check("real quality pipeline preserves semantic groups", groups.size >= 3, [...groups].join(","));
  check("family archetype and semantic grouping coexist", gated.plugin.uiArchetype === "rack" && gated.scores.looks === 100, `${gated.plugin.uiArchetype}/${gated.scores.looks}`);
}

{
  const controls = Array.from({ length: 8 }, (_, i) => ({ ...P(`param_${i}`), x: 40 + (i % 4) * 140, y: 70 + Math.floor(i / 4) * 125, w: 120, h: 100, accentColor: "#888888" }));
  const generic: AudioPlugin = {
    id: "generic", name: "Generic", category: "filter", description: "", parameters: controls,
    dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    customSkin: { bgColor: "#101010", textColor: "#eeeeee", accentColor: "#888888" },
    uiArchetype: "grid",
  };
  check("generic dark undifferentiated grid is detected", isGenericUndifferentiatedGrid(generic));
  check("generic dark undifferentiated grid is rejected by looks floor", scoreLooks(generic) < 97, `score=${scoreLooks(generic)}`);
  const grouped: AudioPlugin = {
    ...generic,
    parameters: controls.map((p, i) => ({ ...p, uiGroup: i < 4 ? "tone" : "output", uiGroupLabel: i < 4 ? "Tone" : "Output" })),
  };
  check("dark is allowed when the faceplate has hierarchy", !isGenericUndifferentiatedGrid(grouped) && scoreLooks(grouped) === 100);
  const interleaved: AudioPlugin = {
    ...generic,
    parameters: controls.map((p, i) => ({ ...p, uiGroup: i % 2 ? "tone" : "output", uiGroupLabel: i % 2 ? "Tone" : "Output" })),
  };
  check(
    "semantic labels cannot disguise an interleaved generic grid",
    !hasCoherentFaceplateGeometry(interleaved) && scoreLooks(interleaved) < 97
  );
}

/* Representative family fixtures prove semantics are actual shared render
 * inputs, not advisory metadata: the same inventory drives Web section rails,
 * archetype geometry, and JUCE GroupComponents. */
{
  const fixtures: Array<{ family: any; category: AudioPlugin["category"]; params: PluginParameter[] }> = [
    { family: "eq", category: "filter", params: [P("low"), P("mid"), P("high"), P("eq_curve", "eq"), P("mix")] },
    { family: "dynamics", category: "dynamics", params: [P("threshold"), P("attack"), P("release"), P("makeup"), P("bypass", "toggle")] },
    { family: "delay", category: "delay", params: [P("time"), P("feedback"), P("rate"), P("tone"), P("mix"), P("bypass", "toggle")] },
    { family: "distortion", category: "distortion", params: [P("drive"), P("tone"), P("mix"), P("bypass", "toggle")] },
    { family: "amp_sim", category: "distortion", params: [P("drive"), P("tone"), { ...P("head", "amp"), w: 340, h: 150 }, { ...P("cab", "cab"), w: 240, h: 240 }, P("mic", "mic")] },
    { family: "sampler", category: "synthesizer", params: [P("pad_1", "pad"), P("pad_2", "pad"), P("pad_3", "pad"), P("pad_4", "pad"), P("mix")] },
    { family: "synthesizer", category: "synthesizer", params: [P("freq"), P("cutoff"), P("rate"), P("level"), P("scope", "waveform")] },
  ];
  for (const fixture of fixtures) {
    const spec = buildUiSpec("", fixture.params, fixture.family);
    const semantic = orderParametersBySpec(fixture.params, spec);
    const archetype = pickArchetype(undefined, fixture.family);
    const layout = applyArchetype(archetype, semantic, true);
    const plugin: AudioPlugin = {
      id: fixture.family, name: fixture.family, category: fixture.category, description: "", parameters: layout.parameters,
      dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "", uiArchetype: archetype,
      customSkin: { bgColor: "#111111", textColor: "#ffffff", accentColor: "#f97316" },
    };
    const web = renderToStaticMarkup(React.createElement(GenerativeFaceplate, { plugin }, React.createElement("div")));
    const native = generatePluginEditorCpp("Fixture", plugin.parameters, plugin.customSkin, plugin.category);
    check(`${fixture.family}: semantic inventory has roles and multiple groups`, semantic.every((p) => !!p.uiRole) && spec.groups.length >= 2);
    check(`${fixture.family}: archetype geometry is coherent`, hasCoherentFaceplateGeometry(plugin));
    check(`${fixture.family}: Web emits semantic section evidence`, web.includes("data-ui-section"));
    check(`${fixture.family}: JUCE emits semantic section evidence`, native.includes("GroupComponent"));
  }
}

console.log(failures === 0 ? "\nUI SEMANTIC PIPELINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);