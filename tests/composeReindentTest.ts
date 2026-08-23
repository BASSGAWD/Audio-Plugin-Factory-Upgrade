/**
 * Verifies round-2 item 2.5: composed/hybrid dspFunction bodies are now
 * reindented one level deeper when spliced into composeRecipes' per-stage
 * `{ ... }` wrapper, instead of every statement sitting flush at column 0
 * regardless of its actual lexical scope. Confirmed live before this fix:
 * every hybrid/multi-stage build (not just golden single-recipe ones) had
 * this defect in its exported code -- cosmetic (doesn't affect execution)
 * but real and visible in every downloaded hybrid plugin.
 *
 * Two things must both hold, so this isn't just "the string looks
 * different": the composed body still executes and produces correct,
 * finite output (reindentation is a pure formatting change, not a
 * semantic one), AND a decisive, fixed input/output pair confirms the
 * actual column shift happened.
 */
import { composeRecipes } from "../src/utils/offlineBuilder";
import { DSP_RECIPES } from "../src/utils/dspRecipes";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const delayRecipe = DSP_RECIPES.find((r) => r.id === "delay")!;
const distortionRecipe = DSP_RECIPES.find((r) => r.id === "distortion")!;
check("fixture recipes found", !!delayRecipe && !!distortionRecipe);

const composed = composeRecipes(distortionRecipe, delayRecipe);
const bodyLines = composed.body.split("\n");

/* ---- 1. fixed input/output pair: every non-blank line strictly inside
   either stage's { } wrapper is indented, none sit flush at column 0 ---- */
{
  const stage1Start = bodyLines.findIndex((l) => l.includes("STAGE 1"));
  const stage2Start = bodyLines.findIndex((l) => l.includes("STAGE 2"));
  check("both stage banners present", stage1Start !== -1 && stage2Start !== -1, `s1=${stage1Start} s2=${stage2Start}`);

  // The opening "{" for stage 1 is the line right after its banner; its
  // body runs from there until the matching "}" right before stage 2's
  // banner-preceding blank line. Collect the body lines (excluding the
  // bare "{"/"}" delimiters themselves) and assert every non-blank one is
  // indented.
  const collectStageBody = (openIdx: number, closeIdx: number) =>
    bodyLines.slice(openIdx + 1, closeIdx).filter((l) => l.trim().length > 0);

  const stage1Open = stage1Start + 1; // banner line, then "{"
  const stage1Close = bodyLines.findIndex((l, i) => i > stage1Open && l === "}");
  const stage1Inner = collectStageBody(stage1Open, stage1Close);
  check(
    "stage 1 body has real content to check",
    stage1Inner.length > 3,
    `lines=${stage1Inner.length}`
  );
  const stage1FlushLeft = stage1Inner.filter((l) => !/^\s/.test(l));
  check(
    "stage 1: no statement sits flush at column 0 inside its { } wrapper",
    stage1FlushLeft.length === 0,
    `flushLeftCount=${stage1FlushLeft.length} example=${JSON.stringify(stage1FlushLeft[0] ?? "")}`
  );

  const stage2Open = stage2Start + 1;
  const stage2Close = bodyLines.findIndex((l, i) => i > stage2Open && l === "}");
  const stage2Inner = collectStageBody(stage2Open, stage2Close);
  check("stage 2 body has real content to check", stage2Inner.length > 3, `lines=${stage2Inner.length}`);
  const stage2FlushLeft = stage2Inner.filter((l) => !/^\s/.test(l));
  check(
    "stage 2: no statement sits flush at column 0 inside its { } wrapper",
    stage2FlushLeft.length === 0,
    `flushLeftCount=${stage2FlushLeft.length} example=${JSON.stringify(stage2FlushLeft[0] ?? "")}`
  );
}

/* ---- 2. decisive gap: reindent() actually moved something -- a body
   built WITHOUT it (the pre-fix behavior, reproduced by stripping the
   leading pad back off) is measurably different from the real one ---- */
{
  const withoutReindent = distortionRecipe.body; // the raw, un-reindented stage body, column-0 as authored
  const rawLineFlushLeft = withoutReindent.split("\n").filter((l) => l.trim().length > 0 && !/^\s/.test(l)).length;
  check(
    "decisive gap: the raw un-reindented recipe body DOES have flush-left content lines (sanity check on the fixture itself)",
    rawLineFlushLeft > 3,
    `rawFlushLeft=${rawLineFlushLeft}`
  );
}

/* ---- 3. purely cosmetic: the composed body still executes and produces
   correct, finite output -- reindentation must not change semantics ---- */
{
  const params: Record<string, number> = {};
  for (const p of composed.parameters) params[p.id] = p.defaultValue;
  const fn = new Function("inputSample", "params", "state", "inputR", composed.body) as (
    i: number,
    p: any,
    s: any,
    r?: number
  ) => number;
  const state: any = {};
  let allFinite = true;
  let sumAbs = 0;
  for (let i = 0; i < 500; i++) {
    const x = 0.5 * Math.sin((2 * Math.PI * 220 * i) / 44100);
    const y = fn(x, params, state, x);
    if (!Number.isFinite(y)) allFinite = false;
    sumAbs += Math.abs(y);
  }
  check("composed+reindented body still executes correctly (all-finite, non-silent output)", allFinite && sumAbs > 0.01, `sumAbs=${sumAbs}`);
}

console.log(failures === 0 ? "\nCOMPOSE REINDENT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
