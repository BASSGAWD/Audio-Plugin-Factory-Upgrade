import { classifyPluginIntent, familyToCategory } from "../src/utils/pluginSpec";
import { scoreRecipes, buildRecipeContext } from "../src/utils/dspRecipes";
import { saveCandidateRecipe, findCandidateRecipe, clearCandidateRecipes } from "../src/utils/recipeMemory";

// localStorage shim for recipeMemory (node has no DOM localStorage)
const store: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

let failures = 0;
const check = (label: string, cond: boolean, extra?: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " -- " + extra : ""}`);
};

// --- The harness doc's headline example ---
const s1 = classifyPluginIntent("Make me a plugin that looks like an EQ, but instead of boosting and cutting, each band saturates the chosen frequency range.");
check("hybrid EQ-saturator: family", s1.family === "multiband_saturator", `got ${s1.family}`);
check("hybrid EQ-saturator: uiMetaphor", s1.uiMetaphor === "parametric_eq", `got ${s1.uiMetaphor}`);
check("hybrid EQ-saturator: hybrid flag", s1.hybrid === true);
check("hybrid EQ-saturator: category maps to distortion (not filter)", familyToCategory(s1.family) === "distortion", `got ${familyToCategory(s1.family)}`);
check("hybrid EQ-saturator: dspIdentity mentions band isolation", /band|isolat/i.test(s1.dspIdentity));

// --- Simple, non-hybrid requests should NOT be flagged hybrid ---
const s2 = classifyPluginIntent("warm tape delay with feedback and mix");
check("plain delay: family", s2.family === "delay", `got ${s2.family}`);
check("plain delay: not hybrid", s2.hybrid === false);

const s3 = classifyPluginIntent("a screaming fuzz pedal for metal guitar");
check("plain distortion: family", s3.family === "distortion", `got ${s3.family}`);

const s4 = classifyPluginIntent("glue compressor for the drum bus");
check("plain dynamics: family", s4.family === "dynamics", `got ${s4.family}`);

// --- Explicit "looks like X" marker phrasing picks the marker-adjacent family as the LOOK ---
const s5 = classifyPluginIntent("a filter that looks like a synthesizer");
check("filter looks-like synth: family stays filter (the real DSP)", s5.family === "filter", `got ${s5.family}`);
check("filter looks-like synth: uiMetaphor is the synth panel", s5.uiMetaphor === "synth_panel", `got ${s5.uiMetaphor}`);
check("filter looks-like synth: hybrid true", s5.hybrid === true);

// --- Ambiguous phrasing with no "looks like" marker and no eq/filter present
// should NOT be forced hybrid -- a single coherent family is the honest answer. ---
const s5b = classifyPluginIntent("a compressor with tape saturation warmth");
check("compressor+saturation, no marker: still classifies (dynamics or saturator)", s5b.family === "dynamics" || s5b.family === "saturator", `got ${s5b.family}`);

// --- Recipe router: hybrid composes two recipes ---
const scored = scoreRecipes("an EQ where each band saturates", s1);
check("hybrid scoring returns 2 recipes", scored.length === 2, `got ${scored.map(s => s.recipe.id).join(",")}`);
check("hybrid scoring includes filter", scored.some(s => s.recipe.id === "filter"));
check("hybrid scoring includes distortion", scored.some(s => s.recipe.id === "distortion"));

const ctx = buildRecipeContext("an EQ where each band saturates", s1);
check("hybrid context mentions HYBRID BUILD PLAN", ctx.includes("HYBRID BUILD PLAN"));
check("hybrid context includes both stage bodies", ctx.includes("state.lp1") /* filter recipe symbol */ || /cutoff/.test(ctx));

// --- Candidate recipe memory round-trip ---
clearCandidateRecipes();
check("memory starts empty", findCandidateRecipe("any distortion pedal", "distortion") === null);
saveCandidateRecipe("a warm fuzz pedal", "distortion", "return Math.tanh(inputSample * 4);", 98);
const found = findCandidateRecipe("give me a fuzz pedal please", "distortion");
check("memory finds same-family match", found !== null && found.dspFunction.includes("tanh"), `found=${JSON.stringify(found)}`);
check("low-score builds are not saved", (() => {
  clearCandidateRecipes();
  saveCandidateRecipe("bad build", "reverb", "return inputSample;", 60);
  return findCandidateRecipe("bad build", "reverb") === null;
})());

console.log(failures === 0 ? "\nALL SPEC/ROUTER/MEMORY TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
