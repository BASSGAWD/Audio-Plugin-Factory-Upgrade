import { classifyPluginIntent } from "../src/utils/pluginSpec";
import { scoreRecipes } from "../src/utils/dspRecipes";

let failures = 0;
const check = (label: string, cond: boolean, extra?: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " -- " + extra : ""}`);
};

const s1 = classifyPluginIntent("build a vocal pitch corrector like Auto-Tune");
check("autotune request -> pitch family", s1.family === "pitch", `got ${s1.family}`);
const r1 = scoreRecipes("build a vocal pitch corrector", s1);
check("pitch family routes to pitch recipe", r1.some(x => x.recipe.id === "pitch"), `got ${r1.map(x=>x.recipe.id)}`);

const s2 = classifyPluginIntent("make a lush ambient drone synth pad");
check("drone synth request -> synthesizer family", s2.family === "synthesizer", `got ${s2.family}`);
const r2 = scoreRecipes("make a lush ambient drone synth pad", s2);
check("synthesizer family routes to synth recipe", r2.some(x => x.recipe.id === "synth"), `got ${r2.map(x=>x.recipe.id)}`);

const s3 = classifyPluginIntent("give me an octave harmonizer for guitar");
check("harmonizer/octave request -> pitch family", s3.family === "pitch", `got ${s3.family}`);

console.log(failures === 0 ? "\nALL NEW-FAMILY DETECTION TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
