/**
 * Phase A of the C++/JUCE knowledge base — cppPatterns.ts:
 *
 *  - every non-oneTimeSetup pattern's code is proven real-time-safe by the
 *    SAME auditor (cppAudit.ts) that grades the model's own translated
 *    output — an exemplar can never itself poison a translation with an
 *    unsafe idiom
 *  - every pattern carries real metadata (concepts, guidance, a pitfall)
 *  - exact inventory count, so a silent addition/removal can't drift
 *    unnoticed (same discipline as topologyTest.ts's node-count assertion)
 *  - concrete routing probes: a plugin's category + the JS body's own
 *    structure select the RIGHT exemplar(s), not an arbitrary one
 *  - buildCppPatternContext/buildCppErrorPatternContext are null-object
 *    correct: non-empty exactly when something matched, empty otherwise
 */
import { CPP_PATTERNS, selectCppExemplars, buildCppPatternContext, selectCppExemplarsForErrors, buildCppErrorPatternContext } from "../src/utils/cppPatterns";
import { auditCppRealtimeSafety } from "../src/utils/cppAudit";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- inventory ---- */
check(`inventory: ${CPP_PATTERNS.length} patterns`, CPP_PATTERNS.length === 7, `${CPP_PATTERNS.length}`);

/* ---- every pattern is well-formed and self-consistent ---- */
for (const p of CPP_PATTERNS) {
  check(`${p.id}: has a non-empty title`, p.title.length > 0);
  check(`${p.id}: has at least one concept tag`, p.concepts.length > 0);
  check(`${p.id}: has guidance text`, p.guidance.length > 20);
  check(`${p.id}: has at least one pitfall`, p.pitfalls.length > 0);
  check(`${p.id}: code is non-trivial`, p.code.trim().length > 20);

  // The load-bearing safety proof: every pattern NOT flagged as one-time
  // setup code must itself be real-time-safe -- it's the model's few-shot
  // model, so if IT contains a hazard, translations will learn the hazard.
  const audit = auditCppRealtimeSafety(p.code, "core");
  if (!p.oneTimeSetup) {
    check(`${p.id}: exemplar code is real-time-safe`, audit.realtimeSafe, audit.findings.map((f) => f.message).join("; "));
  } else {
    check(`${p.id}: marked oneTimeSetup (constructor-time code, exempt from the hot-path check)`, true);
  }
}

/* ---- concrete routing probes ---- */
{
  const delayBody = "if (!state.init) { state.buf = new Float32Array(96000); state.ptr = 0; state.init = true; } state.buf[state.ptr] = inputSample; state.ptr = (state.ptr + 1) % 96000; return state.buf[0];";
  const ids = selectCppExemplars("delay", delayBody).map((p) => p.id);
  check("delay category + ring-buffer body -> ring_buffer_delay_line selected", ids.includes("ring_buffer_delay_line"), `got [${ids.join(", ")}]`);
}
{
  const dynamicsBody = "state.env += (x > state.env ? 0.01 : 0.001) * (x - state.env); let db = 20 * Math.log10(Math.max(1e-6, state.env));";
  const ids = selectCppExemplars("dynamics", dynamicsBody).map((p) => p.id);
  check("dynamics category + envelope body -> envelope_follower selected", ids.includes("envelope_follower"), `got [${ids.join(", ")}]`);
}
{
  const filterBody = "let a = 1 - Math.exp(-2 * Math.PI * cutoff / 44100); state.lp += a * (inputSample - state.lp);";
  const ids = selectCppExemplars("filter", filterBody).map((p) => p.id);
  check("filter category + exp-coefficient body -> biquad_iir_filter selected", ids.includes("biquad_iir_filter"), `got [${ids.join(", ")}]`);
}
{
  // No category, no structural signal in the body -- nothing should match.
  const ids = selectCppExemplars(undefined, "return inputSample;").map((p) => p.id);
  check("no category + trivial body -> no exemplars selected", ids.length === 0, `got [${ids.join(", ")}]`);
}
{
  // Cap respected even when many concepts match.
  const richBody = "state.buf[state.ptr] = inputSample; state.env += 0.01 * x; let a = Math.exp(-2 * Math.PI * cutoff / 44100); state.sm += 0.002 * (target - state.sm);";
  const ids = selectCppExemplars("dynamics", richBody, 2).map((p) => p.id);
  check("max=2 is respected even with more matching concepts", ids.length <= 2, `got [${ids.join(", ")}]`);
}

/* ---- buildCppPatternContext: null-object contract ---- */
{
  const ctx = buildCppPatternContext("dynamics", "state.env += (x > state.env ? 0.01 : 0.001) * (x - state.env);");
  check("context is non-empty when an exemplar matches", ctx.length > 0);
  check("context includes the matched exemplar's title", ctx.includes("Envelope follower"));
}
{
  const ctx = buildCppPatternContext(undefined, "return inputSample;");
  check("context is the empty string when nothing matches", ctx === "", JSON.stringify(ctx));
}

/* ---- repair-loop error-keyword selection ---- */
{
  const ids = selectCppExemplarsForErrors(["error C2039: 'getNextValue': is not a member of 'SmoothedValue<float>'"]).map((p) => p.id);
  check("compiler error naming SmoothedValue -> smoothed_value_param selected", ids.includes("smoothed_value_param"), `got [${ids.join(", ")}]`);
}
{
  const ids = selectCppExemplarsForErrors(["error C2065: 'delayWritePos': undeclared identifier"]).map((p) => p.id);
  check("compiler error naming delayWritePos -> ring_buffer_delay_line selected", ids.includes("ring_buffer_delay_line"), `got [${ids.join(", ")}]`);
}
{
  const ctx = buildCppErrorPatternContext(["error C2039: 'getNextValue': is not a member of 'SmoothedValue<float>'"]);
  check("error-pattern context is non-empty on a matching error", ctx.length > 0);
}
{
  const ctx = buildCppErrorPatternContext(["error C2065: 'foo': undeclared identifier"]);
  check("error-pattern context is empty when no errorKeywords match", ctx === "", JSON.stringify(ctx));
}

console.log(failures === 0 ? "\nC++ KNOWLEDGE BASE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
