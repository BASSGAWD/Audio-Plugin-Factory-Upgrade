import { classifyPluginIntent, familyToCategory, PluginFamily } from "../src/utils/pluginSpec";
import { scoreRecipes, DSP_RECIPES } from "../src/utils/dspRecipes";

// One representative prompt per detectable family
const probes: Array<[PluginFamily, string]> = [
  ["eq", "a clean parametric eq"],
  ["filter", "acid resonant lowpass filter"],
  ["distortion", "a screaming fuzz pedal"],
  ["saturator", "warm tape saturation for the mix bus"],
  ["multiband_saturator", "an eq that saturates each band instead of boosting"],
  ["delay", "warm tape delay with feedback"],
  ["reverb", "lush hall reverb"],
  ["modulation", "classic 80s chorus"],
  ["dynamics", "glue compressor for drums"],
  ["synthesizer", "ambient drone synth pad"],
  ["pitch", "vocal autotune pitch corrector"],
  ["amp_sim", "guitar amp sim for metal"],
  ["sampler", "mpc style drum sampler pads"],
];

let failures = 0;
console.log("family".padEnd(22) + "detected".padEnd(22) + "category".padEnd(14) + "recipes".padEnd(22) + "verdict");
console.log("-".repeat(90));

for (const [expected, prompt] of probes) {
  const spec = classifyPluginIntent(prompt);
  const cat = familyToCategory(spec.family);
  const recipes = scoreRecipes(prompt, spec).map((s) => s.recipe.id);
  const detectOk = spec.family === expected;
  const recipeOk = recipes.length > 0;
  const ok = detectOk && recipeOk;
  if (!ok) failures++;
  console.log(
    expected.padEnd(22) +
    (detectOk ? spec.family : `WRONG:${spec.family}`).padEnd(22) +
    cat.padEnd(14) +
    recipes.join("+").padEnd(22) +
    (ok ? "OK" : "FAIL")
  );
}

// Fallback families: utility/hybrid_other have no keyword (by design -> No-Recipe Mode)
const fallback = classifyPluginIntent("a thing that does something unusual to sound");
console.log("hybrid_other (fallback)".padEnd(44) + familyToCategory(fallback.family).padEnd(14) + "(no recipe = No-Recipe Mode, by design)");
if (fallback.family !== "hybrid_other") failures++;

console.log(`\nRecipe library: ${DSP_RECIPES.length} verified recipes`);
console.log(failures === 0 ? "ALL FAMILIES CORRECTLY SCALED" : `${failures} COVERAGE GAP(S)`);
process.exit(failures === 0 ? 0 : 1);
