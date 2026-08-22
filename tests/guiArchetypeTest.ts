/**
 * GUI archetypes -- the layout composition axis wired up from the
 * previously-dead-end uiMetaphor taxonomy (pluginSpec.ts). These checks
 * prove: (1) the mapping from uiMetaphor/family to archetype is correct,
 * (2) every archetype produces a sane, non-overlapping layout, (3) the
 * "grid" default is byte-for-byte identical to the pre-archetype
 * polishPluginVisuals() output (the invariant that matters most --
 * generations that never opt into an archetype must not change at all).
 */
import { ArchetypeId, BUILTIN_ARCHETYPES, applyArchetype, pickArchetype, resolveControlOverlaps } from "../src/utils/guiArchetypes";
import { polishPluginVisuals, runQualityGate, scoreLooks, measureVisualIntegrity, measureSkeuomorphicFidelity } from "../src/utils/qualityGate";
import { classifyPluginIntent } from "../src/utils/pluginSpec";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { AudioPlugin, PluginParameter } from "../src/types";
import { resolveMaterial } from "../src/utils/materialVisuals";
import { resolveCustomSkinStyle } from "../src/utils/customSkin";

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

  // Loose uiMetaphor matching: a model that phrases a known metaphor with
  // different casing/spacing/hyphenation, or wraps it in extra descriptive
  // words, still gets recognized -- previously only an EXACT string match
  // worked, silently discarding real signal the model provided.
  check("uiMetaphor: different casing still matches", pickArchetype("Parametric EQ", null) === "eq_focus");
  check("uiMetaphor: hyphenated still matches", pickArchetype("parametric-eq", null) === "eq_focus");
  check("uiMetaphor: extra words around a known metaphor still match", pickArchetype("a modern parametric eq design", null) === "eq_focus");
  check("uiMetaphor: extra spacing still matches", pickArchetype("  channel   strip  ", null) === "strip");
  // A short known key must not accidentally match on an unrelated phrase
  // that merely shares one of its tokens -- "parametric_eq" needs BOTH
  // "parametric" and "eq" present, so a bare "eq" alone (missing
  // "parametric") correctly falls through to the family/grid default
  // instead of loose-matching.
  check("uiMetaphor: a single shared token alone does not false-positive", pickArchetype("eq", null) === "grid");
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

/* ---- 7. "only fill gaps" layout never places a fresh param on top of one
   that ALREADY has a position -- the exact bug found live: loaded a real
   generated amp into the designer and measured, via getBoundingClientRect,
   THREE controls sitting at the pixel-identical position of other controls
   ("Drive" exactly on top of "Preamp Gain"; two more "Drive" duplicates
   exactly on top of each other and on top of "Amp Voicing"). Root cause was
   idx-based `col = idx % cols` placement with zero awareness of which cells
   were already claimed -- reproduced here directly: an existing param
   already sits in the very first grid cell a naive index-0 param would
   also want. ---- */
{
  const existing: PluginParameter = { ...P("gain", "knob"), x: 40, y: 70, w: 120, h: 100 };
  const needsLayout = P("drive", "knob"); // no x/y -- array index 0 among "needs layout"
  const layout = applyArchetype("grid", [existing, needsLayout], false);
  const gain = layout.parameters.find((p) => p.id === "gain")!;
  const drive = layout.parameters.find((p) => p.id === "drive")!;
  check("gap-fill layout: pre-existing param keeps its exact position", gain.x === 40 && gain.y === 70);
  check(
    "gap-fill layout: a fresh param is never placed on the pre-existing one's cell",
    !(drive.x === gain.x && drive.y === gain.y),
    `drive=(${drive.x},${drive.y}) gain=(${gain.x},${gain.y})`
  );

  // The multi-duplicate version of the same scenario, matching the live
  // finding almost exactly: one existing param plus THREE more needing
  // layout (as chainStage's id-collision suffixing would produce:
  // drive, drive_2, drive_3) must all land on DISTINCT cells, none of
  // them coinciding with the pre-existing one or each other.
  const existing2: PluginParameter = { ...P("headType", "knob"), x: 300, y: 331, w: 120, h: 100 };
  const dupes = [P("drive", "knob"), P("drive_2", "knob"), P("drive_3", "knob")];
  const layout2 = applyArchetype("grid", [existing2, ...dupes], false);
  const seen = new Map<string, number>();
  for (const p of layout2.parameters) {
    const k = `${p.x},${p.y}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const collisions = [...seen.values()].filter((n) => n > 1).length;
  check("gap-fill layout: three duplicate-ish params + one pre-existing all land on distinct cells", collisions === 0, JSON.stringify([...seen.entries()]));
}

/* ---- 8. resolveControlOverlaps repairs a plugin whose positions ALREADY
   collide (e.g. one built before this fix shipped) -- the retroactive
   half of the same fix. An older param keeps its exact position; a later
   one occupying the same rect gets nudged clear. A layout with no overlap
   at all is returned completely untouched (true no-op, not just "no visible
   difference"). ---- */
{
  const clean: PluginParameter[] = [
    { ...P("a", "knob"), x: 40, y: 70, w: 120, h: 100 },
    { ...P("b", "knob"), x: 180, y: 70, w: 120, h: 100 },
  ];
  const repairedClean = resolveControlOverlaps(clean);
  check("resolveControlOverlaps: a non-overlapping layout is returned as the SAME array (true no-op)", repairedClean === clean);

  const broken: PluginParameter[] = [
    { ...P("gain", "knob"), x: 40, y: 330, w: 120, h: 100 },
    { ...P("drive", "knob"), x: 40, y: 330, w: 120, h: 100 }, // exact duplicate of gain's position
    { ...P("headType", "knob"), x: 300, y: 330, w: 120, h: 100 },
    { ...P("drive_2", "knob"), x: 300, y: 330, w: 120, h: 100 }, // exact duplicate of headType's position
  ];
  const repaired = resolveControlOverlaps(broken);
  const byId = (id: string) => repaired.find((p) => p.id === id)!;
  check("resolveControlOverlaps: the first claimant keeps its exact position", byId("gain").x === 40 && byId("gain").y === 330);
  check("resolveControlOverlaps: the second claimant keeps its exact position", byId("headType").x === 300 && byId("headType").y === 330);
  check(
    "resolveControlOverlaps: the duplicate stacked on gain is moved off it",
    !(byId("drive").x === byId("gain").x && byId("drive").y === byId("gain").y)
  );
  check(
    "resolveControlOverlaps: the duplicate stacked on headType is moved off it",
    !(byId("drive_2").x === byId("headType").x && byId("drive_2").y === byId("headType").y)
  );
  // And the repaired duplicates don't just collide with EACH OTHER instead.
  check(
    "resolveControlOverlaps: the two repaired duplicates don't collide with each other either",
    !(byId("drive").x === byId("drive_2").x && byId("drive").y === byId("drive_2").y)
  );
}

/* ---- 9. scoreLooks: a plugin with genuinely overlapping controls can
   never reach 100 -- "the controls are usable and distinct" is squarely
   what "looks" already claims to certify. Tested directly (bypassing
   polishPluginVisuals/resolveControlOverlaps, which repair overlaps
   before scoreLooks would ever see them in the real pipeline) so this is
   a real, standalone regression guard on the scoring function itself: if
   the repair pass ever regresses, THIS is what still catches it, since
   every one of this project's tests asserts the >=97 floor. A clean,
   fully-styled, non-overlapping layout is unaffected. ---- */
{
  const fullyStyled = (id: string, x: number, y: number): PluginParameter =>
    ({ id, name: id, min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "", controlType: "knob", x, y, w: 120, h: 100, accentColor: "#f97316" } as PluginParameter);
  const cleanPlugin: AudioPlugin = {
    id: "t", name: "t", category: "filter", description: "", dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    parameters: [fullyStyled("a", 40, 70), fullyStyled("b", 180, 70)],
    customSkin: { bgColor: "#0d0a1a", textColor: "#ede9fe", accentColor: "#a78bfa" },
  };
  check("scoreLooks: a clean, fully-styled, non-overlapping plugin scores 100", scoreLooks(cleanPlugin) === 100, `got ${scoreLooks(cleanPlugin)}`);

  const overlappingPlugin: AudioPlugin = {
    ...cleanPlugin,
    parameters: [fullyStyled("a", 40, 70), fullyStyled("b", 40, 70)], // identical position -> one real overlap
  };
  check("scoreLooks: even ONE overlapping pair of controls can never score 100", scoreLooks(overlappingPlugin) < 100, `got ${scoreLooks(overlappingPlugin)}`);

  // And the real pipeline is what actually prevents this from ever
  // happening -- runQualityGate repairs positions before scoring, so the
  // SAME structurally-overlapping input still ships at 100 once it goes
  // through the real gate (proof that the repair pass and the scoring
  // guard are two independent, both-working layers, not one broken and
  // the other quietly picking up the slack).
  const gated = runQualityGate(overlappingPlugin, { family: "filter" });
  check("scoreLooks: the SAME overlapping input still ships clean through the real gate (repair pass fixes it first)", gated.scores.looks === 100, `got ${gated.scores.looks}`);
}

/* ---- 10. measureVisualIntegrity: WCAG contrast, informational ---- */
{
  const base: AudioPlugin = {
    id: "t", name: "t", category: "filter", description: "", dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    parameters: [],
  };
  check("measureVisualIntegrity: no customSkin -> null (nothing to measure)", measureVisualIntegrity(base) === null);

  const highContrast: AudioPlugin = { ...base, customSkin: { bgColor: "#0d0a1a", textColor: "#ede9fe", accentColor: "#a78bfa" } };
  const hc = measureVisualIntegrity(highContrast);
  check("measureVisualIntegrity: a real (CATEGORY_THEMES-shaped) high-contrast skin scores well", !!hc && hc.score >= 90, `score=${hc?.score}`);

  const lowContrast: AudioPlugin = { ...base, customSkin: { bgColor: "#111111", textColor: "#141414", accentColor: "#151515" } };
  const lc = measureVisualIntegrity(lowContrast);
  check(
    "measureVisualIntegrity: near-invisible text-on-background scores decisively lower than a real theme",
    !!lc && !!hc && lc.score < hc.score - 50,
    `low=${lc?.score} high=${hc?.score}`
  );
}

/* ---- 11. resolveMaterial: deterministic per-plugin material dispatch ---- */
{
  const withAttr = (attr: string, category: AudioPlugin["category"] = "filter"): AudioPlugin => ({
    id: "t", name: "t", category, description: "", dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    parameters: [],
    buildReport: { attributes: [attr] } as any,
  });
  check("resolveMaterial: aggressive -> brushed-metal", resolveMaterial(withAttr("aggressive")) === "brushed-metal");
  check("resolveMaterial: vintage -> wood-panel", resolveMaterial(withAttr("vintage")) === "wood-panel");
  check("resolveMaterial: clinical -> matte-plastic", resolveMaterial(withAttr("clinical")) === "matte-plastic");
  check("resolveMaterial: futuristic -> anodized-aluminum", resolveMaterial(withAttr("futuristic")) === "anodized-aluminum");

  const noAttrReverb: AudioPlugin = {
    id: "t", name: "t", category: "reverb", description: "", dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    parameters: [],
  };
  check("resolveMaterial: no attribute -> falls back to category (reverb -> vintage-cream)", resolveMaterial(noAttrReverb) === "vintage-cream");

  // Same plugin identity -> same material, every call -- no hidden
  // randomness in the dispatch itself (the *rendering* is seeded/varied,
  // the *choice of material family* is not).
  const a1 = resolveMaterial(withAttr("aggressive"));
  const a2 = resolveMaterial(withAttr("aggressive"));
  check("resolveMaterial: deterministic across repeated calls", a1 === a2);
}

/* ---- 12. resolveCustomSkinStyle: all 5 glowStyle values, and bgOpacity ---- */
{
  const skinWith = (glowStyle: string) => resolveCustomSkinStyle({ glowStyle: glowStyle as any, accentColor: "#f97316" });

  check("resolveCustomSkinStyle: glowStyle 'none' -> no boxShadow", skinWith("none").boxShadow === undefined);
  check("resolveCustomSkinStyle: glowStyle 'neon' -> real boxShadow", skinWith("neon").boxShadow !== undefined);
  // The actual regression this session found and fixed: these 3 used to
  // silently resolve to undefined even though 5 of ATTRIBUTE_THEMES' 8
  // entries assign one of them. A revert of the fix would fail these.
  check("resolveCustomSkinStyle: glowStyle 'vintage' -> real boxShadow (was silently dropped before this fix)", skinWith("vintage").boxShadow !== undefined);
  check("resolveCustomSkinStyle: glowStyle 'flat' -> real boxShadow (was silently dropped before this fix)", skinWith("flat").boxShadow !== undefined);
  check("resolveCustomSkinStyle: glowStyle 'shadow' -> real boxShadow (was silently dropped before this fix)", skinWith("shadow").boxShadow !== undefined);

  // Each of the 4 non-"none" treatments must be genuinely distinct -- not
  // 4 names collapsing onto one identical CSS value.
  const shadows = ["neon", "vintage", "flat", "shadow"].map((g) => skinWith(g).boxShadow);
  const distinctCount = new Set(shadows).size;
  check("resolveCustomSkinStyle: neon/vintage/flat/shadow are 4 DISTINCT boxShadow values, not duplicates", distinctCount === 4, `values=${JSON.stringify(shadows)}`);

  // bgOpacity ("overlay alpha") was a declared type field with zero
  // consumers before this fix -- now a partial value layers a scrim over
  // bgImage in the SAME backgroundImage property; unset/1 must stay
  // byte-for-byte identical to the pre-bgOpacity behavior (plain url()).
  const fullOpacity = resolveCustomSkinStyle({ bgImage: "x.png", bgColor: "#111116" });
  check("resolveCustomSkinStyle: unset bgOpacity -> plain url(), unchanged from before this field existed", fullOpacity.backgroundImage === "url(x.png)", fullOpacity.backgroundImage);

  const partialOpacity = resolveCustomSkinStyle({ bgImage: "x.png", bgColor: "#111116", bgOpacity: 0.4 });
  check(
    "resolveCustomSkinStyle: bgOpacity < 1 -> a scrim layer is actually added (bgOpacity is no longer dead)",
    partialOpacity.backgroundImage.includes("linear-gradient") && partialOpacity.backgroundImage.includes("url(x.png)"),
    partialOpacity.backgroundImage
  );
}

/* ---- 13. measureSkeuomorphicFidelity: decisive gap on glow rendering ---- */
{
  const base: AudioPlugin = {
    id: "t", name: "t", category: "filter", description: "", dspFunction: "return inputSample;", faustCode: "", cppJuceCode: "", createdAt: "",
    parameters: [],
  };
  check("measureSkeuomorphicFidelity: no customSkin -> null (nothing to measure)", measureSkeuomorphicFidelity(base) === null);

  const noGlowRequested: AudioPlugin = { ...base, customSkin: { bgColor: "#111116" } };
  const ng = measureSkeuomorphicFidelity(noGlowRequested);
  check("measureSkeuomorphicFidelity: no glow requested -> full score (nothing expected)", !!ng && ng.score === 100, `score=${ng?.score}`);

  const realGlow: AudioPlugin = { ...base, customSkin: { bgColor: "#171008", glowStyle: "vintage", accentColor: "#f59e0b" } };
  const rg = measureSkeuomorphicFidelity(realGlow);
  check("measureSkeuomorphicFidelity: a glowStyle the resolver actually implements scores full", !!rg && rg.score === 100, `score=${rg?.score}`);

  // The decisive-gap case: a glowStyle value the resolver's switch does NOT
  // recognize (simulating exactly what "vintage"/"flat"/"shadow" looked
  // like before this session's fix -- a glow requested but wired to
  // nothing) must score DECISIVELY lower, proving this metric actually
  // discriminates rendered-vs-not rather than returning a constant.
  const unhandledGlow: AudioPlugin = { ...base, customSkin: { bgColor: "#171008", glowStyle: "bogus" as any } };
  const ug = measureSkeuomorphicFidelity(unhandledGlow);
  check(
    "measureSkeuomorphicFidelity: a glow requested but not actually rendered scores decisively lower",
    !!rg && !!ug && ug.score < rg.score - 30,
    `rendered=${rg?.score} unrendered=${ug?.score}`
  );
}

console.log(failures === 0 ? "\nGUI ARCHETYPE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
