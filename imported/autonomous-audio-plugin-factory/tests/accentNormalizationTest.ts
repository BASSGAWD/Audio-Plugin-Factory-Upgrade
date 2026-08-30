/**
 * Accent-color enforcement in polishPluginVisuals() -- research into
 * professional plugin UI design converged on "one dominant accent color per
 * plugin, not a rainbow of per-knob colors" as a clear marker of a polished
 * vs. unfinished-looking plugin. GUI_DESIGN_PHILOSOPHY (dspPromptKit.ts) has
 * always asked the model for this, but nothing enforced it: the previous
 * backfill (`p.accentColor ?? theme.accent`) was a no-op against a model
 * that already emitted divergent per-parameter colors.
 *
 * Verifies the "honest vs. broken" gap this project's testing discipline
 * expects: a plugin with a real rainbow of colors gets normalized to one on
 * first polish, showpiece controls (amp/cab/mic/pad) keep their own
 * deliberate color, and -- the important regression guard -- a plugin that
 * has ALREADY been polished once (customSkin already set) is left alone on a
 * second pass, so this can never clobber a color a user hand-picks later via
 * the Element Inspector.
 */
import { polishPluginVisuals } from "../src/utils/qualityGate";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function makeParam(overrides: Partial<PluginParameter>): PluginParameter {
  return {
    id: "p",
    name: "P",
    min: 0,
    max: 1,
    defaultValue: 0.5,
    value: 0.5,
    unit: "",
    ...overrides,
  };
}

function makePlugin(overrides: Partial<AudioPlugin>): AudioPlugin {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    category: "filter",
    description: "",
    parameters: [],
    dspFunction: "return input;",
    faustCode: "",
    cppJuceCode: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ---- first polish: a rainbow of colors collapses to one dominant accent ---- */
{
  const rainbow = makePlugin({
    category: "distortion",
    parameters: [
      makeParam({ id: "drive", name: "Drive", accentColor: "#ff0000" }),
      makeParam({ id: "tone", name: "Tone", accentColor: "#00ff00" }),
      makeParam({ id: "mix", name: "Mix", accentColor: "#0000ff" }),
      makeParam({ id: "level", name: "Level" }), // no color at all
    ],
    // customSkin intentionally absent -- this is what makes it "first polish"
  });
  const { plugin, changes } = polishPluginVisuals(rainbow);
  const accents = new Set(plugin.parameters.map((p) => p.accentColor));
  check("first polish: every non-showpiece param collapses to ONE accent color", accents.size === 1, `${[...accents].join(", ")}`);
  check("first polish: the collapsed color is the plugin's theme accent", plugin.parameters[0].accentColor === plugin.customSkin?.accentColor);
  check("first polish: a normalization change is reported", changes.some((c) => /normalized every control/.test(c)), JSON.stringify(changes));
}

/* ---- showpiece controls (amp/cab/mic/pad) keep their own color, even on first polish ---- */
{
  const withShowpiece = makePlugin({
    category: "distortion",
    parameters: [
      makeParam({ id: "drive", name: "Drive", accentColor: "#ff0000" }),
      makeParam({ id: "amp", name: "Amp", controlType: "amp", accentColor: "#00ffcc" }),
      makeParam({ id: "cab", name: "Cab", controlType: "cab", accentColor: "#ff00ff" }),
    ],
  });
  const { plugin } = polishPluginVisuals(withShowpiece);
  const drive = plugin.parameters.find((p) => p.id === "drive")!;
  const amp = plugin.parameters.find((p) => p.id === "amp")!;
  const cab = plugin.parameters.find((p) => p.id === "cab")!;
  check("non-showpiece param normalized to theme accent", drive.accentColor === plugin.customSkin?.accentColor);
  check("amp showpiece keeps its OWN distinct color, not the theme accent", amp.accentColor === "#00ffcc" && amp.accentColor !== drive.accentColor);
  check("cab showpiece keeps its OWN distinct color, not the theme accent", cab.accentColor === "#ff00ff" && cab.accentColor !== drive.accentColor);
}

/* ---- re-entrant call guard: an already-polished plugin is left untouched ---- */
{
  const alreadyPolished = makePlugin({
    category: "distortion",
    // customSkin already set -- this plugin has been through the gate before,
    // and may since have been hand-edited by a user in the Designer.
    customSkin: { bgColor: "#111", accentColor: "#f97316", textColor: "#fff" },
    parameters: [
      makeParam({ id: "drive", name: "Drive", accentColor: "#ff0000" }),
      makeParam({ id: "tone", name: "Tone", accentColor: "#00ff00" }),
    ],
  });
  const { plugin, changes } = polishPluginVisuals(alreadyPolished);
  check(
    "re-entrant call: divergent colors on an already-customSkin'd plugin are left UNTOUCHED",
    plugin.parameters.find((p) => p.id === "drive")!.accentColor === "#ff0000" &&
      plugin.parameters.find((p) => p.id === "tone")!.accentColor === "#00ff00"
  );
  check("re-entrant call: no normalization change is reported the second time", !changes.some((c) => /normalized every control/.test(c)), JSON.stringify(changes));
}

console.log(failures === 0 ? "\nACCENT NORMALIZATION: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
