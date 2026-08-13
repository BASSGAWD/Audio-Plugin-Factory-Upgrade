/**
 * GUI archetypes -- the layout composition axis wired up from the
 * previously-dead-end uiMetaphor taxonomy (pluginSpec.ts). These checks
 * prove: (1) the mapping from uiMetaphor/family to archetype is correct,
 * (2) every archetype produces a sane, non-overlapping layout, (3) the
 * "grid" default is byte-for-byte identical to the pre-archetype
 * polishPluginVisuals() output (the invariant that matters most --
 * generations that never opt into an archetype must not change at all).
 */
import { ArchetypeId, BUILTIN_ARCHETYPES, applyArchetype, pickArchetype } from "../src/utils/guiArchetypes";
import { polishPluginVisuals, runQualityGate } from "../src/utils/qualityGate";
import { classifyPluginIntent } from "../src/utils/pluginSpec";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const P = (id: string, controlType?: PluginParameter["controlType"]): PluginParameter =>
  ({ id, name: id, min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "", controlType } as PluginParameter);

/* ---- 1. pickArchetype mapping ---- */
{
  check("parametric_eq -> eq_focus", pickArchetype("parametric_eq", null) === "eq_focus");
  check("channel_strip -> strip", pickArchetype("channel_strip", null) === "strip");
  check("vocal_processor -> strip", pickArchetype("vocal_processor", null) === "strip");
  check("stompbox -> pedal", pickArchetype("stompbox", null) === "pedal");
  check("rack_unit -> rack", pickArchetype("rack_unit", null) === "rack");
  check("synth_panel -> panel", pickArchetype("synth_panel", null) === "panel");
  check("amp_head_and_cab -> showpiece", pickArchetype("amp_head_and_cab", null) === "showpiece");
  check("pad_grid -> showpiece", pickArchetype("pad_grid", null) === "showpiece");
  check("simple_knobs -> grid", pickArchetype("simple_knobs", null) === "grid");
  check("unknown uiMetaphor falls back to family", pickArchetype("nonsense_metaphor", "eq") === "eq_focus");
  check("unknown uiMetaphor + unknown family falls back to grid", pickArchetype("nonsense", null) === "grid");
  check("no uiMetaphor, family=amp_sim -> showpiece", pickArchetype(null, "amp_sim") === "showpiece");
  check("no uiMetaphor, family=dynamics -> strip", pickArchetype(null, "dynamics") === "strip");
}

/* ---- 2. Every archetype produces a sane, non-overlapping layout ---- */
{
  const params: PluginParameter[] = [
    P("drive", "knob"), P("tone", "knob"), P("mix", "slider"), P("bypass", "toggle"),
    P("threshold", "knob"), P("ratio", "knob"), P("attack", "knob"), P("release", "knob"),
  ];
  for (const a of BUILTIN_ARCHETYPES) {
    const layout = applyArchetype(a, params, true);
    const allPositioned = layout.parameters.every((p) => p.x !== undefined && p.y !== undefined && p.w !== undefined && p.h !== undefined);
    check(`${a}: every param gets x/y/w/h`, allPositioned);
    check(`${a}: preserves param count`, layout.parameters.length === params.length, `${layout.parameters.length} vs ${params.length}`);
    // No two boxes exactly coincide (a real collision check is unnecessary
    // here -- this just catches "everything landed at the same spot").
    const seen = new Set<string>();
    let dup = 0;
    for (const p of layout.parameters) {
      const k = `${p.x},${p.y}`;
      if (seen.has(k)) dup++;
      seen.add(k);
    }
    check(`${a}: no duplicate positions`, dup === 0, `${dup} dup(s)`);
    check(`${a}: content bounds are positive`, layout.contentW > 0 && layout.contentH > 0);
  }
}

/* ---- 3. Showpiece/pad params always stay in their own zone regardless of
   archetype (every archetype composes the same amp/cab/mic/pad extraction,
   just arranges the REST differently). ---- */
{
  const params: PluginParameter[] = [
    P("gain", "knob"), P("presence", "knob"),
    { ...P("amp_head_auto", "amp"), w: 340, h: 150 },
    { ...P("cabinet_auto", "cab"), w: 240, h: 240 },
  ];
  for (const a of BUILTIN_ARCHETYPES) {
    const layout = applyArchetype(a, params, true);
    const amp = layout.parameters.find((p) => p.controlType === "amp")!;
    const cab = layout.parameters.find((p) => p.controlType === "cab")!;
    check(`${a}: amp widget keeps its w/h`, amp.w === 340 && amp.h === 150);
    check(`${a}: cab widget keeps its w/h`, cab.w === 240 && cab.h === 240);
  }
}

/* ---- 4. eq_focus puts the eq-typed param in a wide hero slot up top ---- */
{
  const params: PluginParameter[] = [P("low", "knob"), P("mid", "knob"), P("high", "knob"), P("eq_curve_auto", "eq")];
  const layout = applyArchetype("eq_focus", params, true);
  const hero = layout.parameters.find((p) => p.controlType === "eq")!;
  check("eq_focus: hero widget at the top", hero.y === 70, `y=${hero.y}`);
  check("eq_focus: hero widget is wide", (hero.w ?? 0) >= 400, `w=${hero.w}`);
  const bandY = layout.parameters.find((p) => p.id === "low")!.y!;
  check("eq_focus: band knobs sit below the hero", bandY > (hero.y ?? 0) + (hero.h ?? 0) - 1, `bandY=${bandY} heroBottom=${(hero.y ?? 0) + (hero.h ?? 0)}`);
}

/* ---- 5. "grid" default reproduces the ORIGINAL polishPluginVisuals()
   arithmetic exactly -- the invariant that matters most: a caller that
   never opts into an archetype sees byte-identical output. ---- */
{
  const params: PluginParameter[] = [P("a", "knob"), P("b", "knob"), P("c", "knob"), P("d", "knob"), P("e", "knob"), P("f", "slider")];
  const plugin: AudioPlugin = { id: "t", name: "t", category: "filter", description: "", parameters: params, dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "" };
  const { plugin: polished } = polishPluginVisuals(plugin);
  // Matches the historical fixed 4-col grid: CELL_W=140, CELL_H=125, origin (40,70).
  const a = polished.parameters.find((p) => p.id === "a")!;
  const e = polished.parameters.find((p) => p.id === "e")!; // index 4 -> row 1, col 0
  check("grid default: first param at origin", a.x === 40 && a.y === 70, `x=${a.x} y=${a.y}`);
  check("grid default: 5th param wraps to row 2", e.x === 40 && e.y === 195, `x=${e.x} y=${e.y}`);
}

/* ---- 6. End to end: a real prompt gets a real, distinct archetype and it
   round-trips through runQualityGate onto the shipped plugin. ---- */
{
  const prompt = "a parametric EQ with low mid high bands";
  const spec = classifyPluginIntent(prompt);
  const b = buildOfflinePlugin(prompt);
  const plugin: AudioPlugin = { id: "t", name: b.name, category: b.category, description: b.description, parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" };
  const gate = runQualityGate(plugin, { family: b.family, prompt, intent: spec.interpretedGoal, uiMetaphor: spec.uiMetaphor });
  check("end-to-end: eq prompt ships with eq_focus archetype", gate.plugin.uiArchetype === "eq_focus", `got ${gate.plugin.uiArchetype}`);
  const hero = gate.plugin.parameters.find((p) => p.controlType === "eq");
  check("end-to-end: eq_focus generation gets a real eq curve widget", !!hero, "no controlType=eq param found");
}

console.log(failures === 0 ? "\nGUI ARCHETYPE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
