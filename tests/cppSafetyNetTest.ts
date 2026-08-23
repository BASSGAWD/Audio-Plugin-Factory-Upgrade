/**
 * The C++ NaN/Inf/denormal safety-net (native export path):
 *
 * Zero shipped plugin C++ had any NaN/Inf/denormal protection before this --
 * no isnan/isinf/isfinite/jlimit anywhere in the generated output. An
 * unstable feedback delay, a resonant filter pushed past stability, or a
 * divide landing on zero could write full-scale garbage straight into a real
 * DAW's audio graph. This suite proves two independent things:
 *
 *   1. Every C++ surface this project generates -- the deterministic
 *      portableCodegen.ts scaffold (src/utils/portableCodegen.ts, shown/
 *      downloaded from the Export tab) AND the real compiled native-build
 *      path (server/nativeBuild.ts, actually turned into a .vst3) --
 *      unconditionally sanitizes every output sample immediately before it
 *      is written to the JUCE audio buffer: NaN/Inf -> 0.0f, denormals
 *      flushed to zero, hard-ceiling clipped to a safe bound. This holds
 *      for every channel a stereo (or wider) buffer has, not just channel 0.
 *
 *   2. The extended cppAudit.ts auditor can independently detect a missing
 *      guard (a second line of defense on top of #1 always emitting it),
 *      without regressing its existing behavior or false-positiving on real
 *      generated output.
 *
 * Per this project's verification standard (see CLAUDE.md): every "detects
 * the guard" assertion below is paired with a "deliberately broken
 * counterpart" that has the guard removed, and a decisive score/verdict gap
 * between the two is asserted -- not just a number that merely exists.
 */

import fs from "node:fs";
import { auditCppRealtimeSafety } from "../src/utils/cppAudit";
import { buildJuceScaffold, buildPortableScaffolds } from "../src/utils/portableCodegen";
import { scaffoldNativeProject, LocalLLMConfig, NativePlugin } from "../server/nativeBuild";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/** Balanced-braces/parens sanity check: cheap but catches obviously
 *  malformed template output (a stray unclosed brace from a bad edit). */
function braceParenCounts(src: string): string {
  const counts: Record<string, number> = { "{": 0, "}": 0, "(": 0, ")": 0 };
  for (const ch of src) if (ch in counts) counts[ch]++;
  return `{=${counts["{"]} }=${counts["}"]} (=${counts["("]} )=${counts[")"]}`;
}
function bracesBalanced(src: string): boolean {
  const counts: Record<string, number> = { "{": 0, "}": 0, "(": 0, ")": 0 };
  for (const ch of src) if (ch in counts) counts[ch]++;
  return counts["{"] === counts["}"] && counts["("] === counts[")"];
}

/* =========================================================================
 * 1. portableCodegen.ts -- the deterministic Export-tab scaffold
 * ======================================================================= */

function makeParam(id: string, name: string, min: number, max: number, def: number): PluginParameter {
  return { id, name, min, max, defaultValue: def, value: def, unit: "" };
}

const explosivePlugin: AudioPlugin = {
  id: "p1",
  name: "Runaway Feedback Delay",
  category: "delay",
  description: "deliberately pathological -- feedback coefficient can exceed 1.0 and diverge",
  parameters: [
    makeParam("time", "Time", 1, 2000, 350),
    // A feedback knob whose max (1.4) is explicitly > 1.0 -- a textbook
    // divergent-feedback pathology, plus a mix knob that could land on 0
    // and trigger a divide-by-zero in a naive normalization.
    makeParam("feedback", "Feedback", 0, 1.4, 0.45),
    makeParam("mix", "Mix", 0, 1, 0.4),
  ],
  dspFunction: `
if (!state.init) { state.buf = new Array(4096).fill(0); state.w = 0; state.init = true; }
const fb = params.feedback !== undefined ? params.feedback : 0.45;
const mix = params.mix !== undefined ? params.mix : 0.4;
const r = state.buf[state.w];
// deliberately no feedback clamp -- fb can be pushed past 1.0 by the caller
state.buf[state.w] = inputSample + r * fb;
state.w = (state.w + 1) % state.buf.length;
// deliberately unguarded divide -- mix == 0 divides by zero
return (inputSample * (1 - mix) + r * mix) / mix;
`,
  faustCode: "",
  cppJuceCode: "",
  createdAt: "",
};

const scaffold = buildJuceScaffold(explosivePlugin);

check("portableCodegen: scaffold contains the sanitizeSample guard function", /sanitizeSample/.test(scaffold));
check("portableCodegen: guard checks finiteness (std::isfinite)", /std::isfinite\s*\(/.test(scaffold));
check("portableCodegen: guard flushes denormals to zero", /1\.0e-30f|1e-30f/.test(scaffold));
check("portableCodegen: guard hard-ceiling clips (juce::jlimit)", /juce::jlimit\s*\(\s*-4\.0f\s*,\s*4\.0f/.test(scaffold));
check("portableCodegen: processBlock declares ScopedNoDenormals", /juce::ScopedNoDenormals\s+noDenormals\s*;/.test(scaffold));

// Structural placement: the guard must wrap the buffer-write RHS, i.e. sit
// BETWEEN the computed sample and the assignment to `data[i]` -- not after
// (which would be a no-op) and not merely present-but-unused somewhere else.
const writeSiteMatch = scaffold.match(/data\[i\]\s*=\s*(sanitizeSample\s*\(\s*processSample\s*\(\s*data\[i\]\s*\)\s*\))\s*;/);
check("portableCodegen: guard is applied AT the buffer write (data[i] = sanitizeSample(processSample(data[i])))", !!writeSiteMatch, scaffold.match(/data\[i\]\s*=[^;]+;/)?.[0]);

// The write happens inside the generic per-channel loop
// (`for (int ch = 0; ch < buffer.getNumChannels(); ++ch)`), so the same
// guarded write site covers every channel a stereo (or wider) buffer has --
// there is no separate/unguarded branch for channel 1+.
const channelLoopMatch = scaffold.match(/for\s*\(\s*int\s+ch\s*=\s*0\s*;\s*ch\s*<\s*buffer\.getNumChannels\s*\(\s*\)\s*;\s*\+\+ch\s*\)\s*\{[\s\S]*?data\[i\]\s*=\s*sanitizeSample/);
check("portableCodegen: guarded write is inside the per-channel loop (covers stereo, not just channel 0)", !!channelLoopMatch);

check("portableCodegen: scaffold is brace/paren-balanced (well-formed C++)", bracesBalanced(scaffold), braceParenCounts(scaffold));

// buildPortableScaffolds wires the same buildJuceScaffold output through --
// confirm the composed entry point plugin authors actually call also carries it.
const scaffolds = buildPortableScaffolds(explosivePlugin);
check("portableCodegen: buildPortableScaffolds.cppJuceCode also carries the guard", /sanitizeSample/.test(scaffolds.cppJuceCode) && scaffolds.cppJuceCode === scaffold);

// A second, unrelated plugin (different category/param shape) to prove this
// isn't a one-off -- every category's scaffold gets the guard unconditionally.
const filterPlugin: AudioPlugin = {
  id: "p2", name: "Screaming Resonant Filter", category: "filter", description: "",
  parameters: [makeParam("cutoff", "Cutoff", 20, 20000, 1200), makeParam("resonance", "Resonance", 0, 40, 35)],
  dspFunction: `return inputSample;`,
  faustCode: "", cppJuceCode: "", createdAt: "",
};
const filterScaffold = buildJuceScaffold(filterPlugin);
check("portableCodegen: guard present for a second, unrelated category (filter)", /sanitizeSample/.test(filterScaffold) && /juce::jlimit\s*\(\s*-4\.0f\s*,\s*4\.0f/.test(filterScaffold));

/* --- C++ float-literal correctness: the compile-breaking bug this session
   found and fixed. explosivePlugin's own params are exactly the real-world
   mix that exposed it -- time's default (350) is a whole number, feedback's
   (0.45) and mix's (0.4) are not. "350f" is a C++ compile error (C3688);
   "350.0f" is required. --- */
check(
  "portableCodegen: a whole-number default emits a VALID C++ float literal (350.0f, not the broken 350f)",
  /float time = 350\.0f;/.test(scaffold),
  scaffold.match(/float time = [^;]+;/)?.[0]
);
check(
  "portableCodegen: a decimal default ships unchanged, not re-padded (0.45f stays 0.45f)",
  /float feedback = 0\.45f;/.test(scaffold),
  scaffold.match(/float feedback = [^;]+;/)?.[0]
);
check(
  "portableCodegen: no bare-integer float literal survives ANYWHERE in the scaffold -- the actual defect, decisively closed",
  !/=\s*-?\d+f\b/.test(scaffold),
  scaffold.match(/=\s*-?\d+f\b/)?.[0]
);
check(
  "portableCodegen: whole-number default correct for a second, unrelated plugin too (resonance: 35 -> 35.0f)",
  /float resonance = 35\.0f;/.test(filterScaffold),
  filterScaffold.match(/float resonance = [^;]+;/)?.[0]
);

// A closely-related defect found alongside the float-literal bug: a param
// id that starts with a digit after sanitization is an ILLEGAL C++
// identifier ("1x12" can't be a variable name) -- the exact same guard
// nativeBuild.ts's cppIdentifier() already had, never ported here either.
const digitLedPlugin: AudioPlugin = {
  id: "p3", name: "Digit Led Param Test", category: "filter", description: "",
  parameters: [makeParam("1x12", "1x12 Size", 0, 2, 1)],
  dspFunction: `return inputSample;`, faustCode: "", cppJuceCode: "", createdAt: "",
};
const digitLedScaffold = buildJuceScaffold(digitLedPlugin);
check(
  "portableCodegen: a numeric-led param id gets a legal C++ identifier (p_1x12, not the illegal 1x12)",
  /float p_1x12 = 1\.0f;/.test(digitLedScaffold),
  digitLedScaffold.match(/float \S+ = 1\.0f;/)?.[0]
);
check("portableCodegen: never emits an identifier that illegally starts with a digit", !/\bfloat\s+\d/.test(digitLedScaffold));

/* --- Honest vs. deliberately broken counterpart (CLAUDE.md standard) --- */
// Simulate the exact pre-patch template (guard function AND the wrapped
// call both absent) and prove the auditor's new check sees a decisive gap
// versus the real, guarded output above -- not a score that happens to be
// the same for both.
const brokenScaffold = scaffold
  .replace(
    /\n    \/\/ Safety net:[\s\S]*?return juce::jlimit \(-4\.0f, 4\.0f, x\);\n    \}\n/,
    "\n"
  )
  .replace("data[i] = sanitizeSample (processSample (data[i]));", "data[i] = processSample (data[i]);");
check("sanity: the broken counterpart actually lost the guard (test fixture is valid)", !/sanitizeSample/.test(brokenScaffold));

const honestAudit = auditCppRealtimeSafety(scaffold, "full", { requireSafetyNet: true });
const brokenAudit = auditCppRealtimeSafety(brokenScaffold, "full", { requireSafetyNet: true });
check(
  "auditor: decisive gap between honest (guarded) and broken (guard removed) scaffold",
  honestAudit.realtimeSafe && honestAudit.score === 100 && !brokenAudit.realtimeSafe && brokenAudit.score < honestAudit.score,
  `honest=${honestAudit.score}/${honestAudit.realtimeSafe} broken=${brokenAudit.score}/${brokenAudit.realtimeSafe}`
);
check("auditor: broken scaffold's finding names the missing safety net", brokenAudit.findings.some((f) => /safety-net/i.test(f.message) && f.severity === "critical"));

/* =========================================================================
 * 2. server/nativeBuild.ts -- the real compiled native-build path
 * ======================================================================= */

const unreachableLlm: LocalLLMConfig = {
  provider: "ollama",
  ollamaUrl: "http://127.0.0.1:1", // deliberately unroutable -- deterministic, offline, no real model needed
  ollamaModel: "none",
  lmStudioUrl: "http://127.0.0.1:1",
  lmStudioModel: "none",
};

const nativePlugin: NativePlugin = {
  name: "Native Safety Net Test",
  category: "delay",
  parameters: [
    { id: "time", name: "Time", min: 1, max: 2000, defaultValue: 350 },
    { id: "feedback", name: "Feedback", min: 0, max: 1.4, defaultValue: 0.45 },
  ],
  dspFunction: `return inputSample;`,
};

(async () => {
  const built = await scaffoldNativeProject(nativePlugin, unreachableLlm);
  try {
    const processorCppPath = `${built.projectDir}/Source/PluginProcessor.cpp`;
    const processorCpp = fs.readFileSync(processorCppPath, "utf8");

    check("nativeBuild: DSP translation fell back as expected (unreachable LLM -- deterministic)", built.dspTranslated === false);
    check("nativeBuild: PluginProcessor.cpp contains the sanitizeSample guard", /sanitizeSample/.test(processorCpp));
    check("nativeBuild: guard checks finiteness (std::isfinite)", /std::isfinite\s*\(/.test(processorCpp));
    check("nativeBuild: guard flushes denormals to zero", /1\.0e-30f|1e-30f/.test(processorCpp));
    check("nativeBuild: guard hard-ceiling clips (juce::jlimit)", /juce::jlimit\s*\(\s*-4\.0f\s*,\s*4\.0f/.test(processorCpp));
    check("nativeBuild: processBlock declares ScopedNoDenormals", /juce::ScopedNoDenormals\s+noDenormals\s*;/.test(processorCpp));
    check("nativeBuild: PluginProcessor.h includes <cmath> for std::isfinite/std::abs", /#include\s*<cmath>/.test(fs.readFileSync(`${built.projectDir}/Source/PluginProcessor.h`, "utf8")));

    // Structural placement: guard applied AT the buffer write, wrapping the
    // translated core's return value, for the generic multi-channel loop
    // (stereo and beyond -- both L and R go through this exact same site).
    const nativeWriteSite = processorCpp.match(/data\[i\]\s*=\s*(sanitizeSample\s*\(\s*mCore\.processSample\s*\(\s*data\[i\]\s*,\s*params\s*\)\s*\))\s*;/);
    check("nativeBuild: guard is applied AT the buffer write (data[i] = sanitizeSample(mCore.processSample(...)))", !!nativeWriteSite, processorCpp.match(/data\[i\]\s*=[^;]+;/)?.[0]);
    const nativeChannelLoop = processorCpp.match(/for\s*\(\s*int\s+channel\s*=\s*0\s*;\s*channel\s*<\s*buffer\.getNumChannels\s*\(\s*\)\s*;\s*\+\+channel\s*\)\s*\{[\s\S]*?data\[i\]\s*=\s*sanitizeSample/);
    check("nativeBuild: guarded write is inside the per-channel loop (covers stereo, not just channel 0)", !!nativeChannelLoop);

    check("nativeBuild: PluginProcessor.cpp is brace/paren-balanced (well-formed C++)", bracesBalanced(processorCpp), braceParenCounts(processorCpp));

    // The guard must be emitted even though the DSP translation itself fell
    // back to the passthrough placeholder (dspTranslated === false above) --
    // it is unconditional, wired into the template, not into the
    // model-translated core.
    const coreHeader = fs.readFileSync(`${built.projectDir}/Source/dsp/ProcessorCore.h`, "utf8");
    check("nativeBuild: guard present even when DSP translation fell back to passthrough", built.dspTranslated === false && /sanitizeSample/.test(processorCpp) && /passthrough/i.test(coreHeader));

    /* --- Task 2: the wired auditor call must not false-positive on real output --- */
    check("nativeBuild: auditor found no missing-safety-net finding on real generated output", !(built.cppAuditFindings || []).some((f) => /safety-net/i.test(f) && /processBlock/.test(f)));
    check("nativeBuild: no safety-net warning surfaced for real output", !(built.warning || "").toLowerCase().includes("safety-net"));
  } finally {
    // Don't leave the generated project sitting under ~/.audio-plugin-factory
    // (disk space on this machine is already tight -- see project memory).
    fs.rmSync(built.projectDir, { recursive: true, force: true });
  }

  /* =======================================================================
   * 3. cppAudit.ts -- the extended auditor, in isolation
   * ===================================================================== */

  // Backward compatibility: the EXACT fixture cppAuditTest.ts already
  // asserts scores 100 in "full" context must keep scoring 100 by default
  // (requireSafetyNet is opt-in) -- proves the extension is additive, not a
  // behavior change for any existing caller.
  const legacyGoodProcessBlock = `
void FooAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    Params params;
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch) {
        auto* data = buffer.getWritePointer(ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            data[i] = mCore.processSample(data[i], params);
    }
}`;
  const legacyDefault = auditCppRealtimeSafety(legacyGoodProcessBlock, "full");
  check("auditor: backward compatible -- default (no options) still scores existing fixture 100", legacyDefault.score === 100, `score=${legacyDefault.score}`);

  // The SAME fixture, with the new opt-in check enabled, must now be caught
  // -- this is exactly "a plugin that somehow ships without this protection".
  const legacyStrict = auditCppRealtimeSafety(legacyGoodProcessBlock, "full", { requireSafetyNet: true });
  check("auditor: catches a real missing-guard processBlock when requireSafetyNet is on", !legacyStrict.realtimeSafe && legacyStrict.score < 100, `score=${legacyStrict.score}`);
  check("auditor: missing-guard finding is critical severity", legacyStrict.findings.some((f) => f.severity === "critical" && /safety-net/i.test(f.message)));

  // Decisive gap, restated directly against the two states of one fixture:
  check(
    "auditor: decisive score gap between guard-present and guard-absent for the same code shape",
    legacyDefault.score === 100 && legacyStrict.score < legacyDefault.score,
    `default=${legacyDefault.score} strict=${legacyStrict.score}`
  );

  // Partial guards (only one half of the pattern) must still be flagged --
  // an isfinite check with no bound, or a clamp with no NaN/Inf check, is
  // not the safety net the task asked for.
  const onlyFiniteCheck = legacyGoodProcessBlock.replace(
    "data[i] = mCore.processSample(data[i], params);",
    "data[i] = std::isfinite(mCore.processSample(data[i], params)) ? mCore.processSample(data[i], params) : 0.0f;"
  );
  const onlyFiniteAudit = auditCppRealtimeSafety(onlyFiniteCheck, "full", { requireSafetyNet: true });
  check("auditor: isfinite check alone (no hard-ceiling clip) is still flagged", !onlyFiniteAudit.realtimeSafe);

  const onlyClampCheck = legacyGoodProcessBlock.replace(
    "data[i] = mCore.processSample(data[i], params);",
    "data[i] = juce::jlimit(-4.0f, 4.0f, mCore.processSample(data[i], params));"
  );
  const onlyClampAudit = auditCppRealtimeSafety(onlyClampCheck, "full", { requireSafetyNet: true });
  check("auditor: hard-ceiling clip alone (no NaN/Inf check) is still flagged", !onlyClampAudit.realtimeSafe);

  // Alternate idioms for both halves must be recognized, not just the exact
  // spelling this project's own templates happen to use.
  const altIdiomGuard = legacyGoodProcessBlock.replace(
    "data[i] = mCore.processSample(data[i], params);",
    "float y = mCore.processSample(data[i], params);\n            if (std::isnan(y) || std::isinf(y)) y = 0.0f;\n            data[i] = std::clamp(y, -4.0f, 4.0f);"
  );
  const altIdiomAudit = auditCppRealtimeSafety(altIdiomGuard, "full", { requireSafetyNet: true });
  check("auditor: recognizes the alternate isnan/isinf + std::clamp idiom, not just isfinite/jlimit", altIdiomAudit.realtimeSafe && altIdiomAudit.score === 100, `score=${altIdiomAudit.score} findings=${altIdiomAudit.findings.map((f) => f.message).join(" | ")}`);

  // The real generated bufferWriteSite text from portableCodegen must not
  // false-positive when audited the same strict way.
  const realGuardedAudit = auditCppRealtimeSafety(scaffold, "full", { requireSafetyNet: true });
  check("auditor: no false positive on the real portableCodegen scaffold output", realGuardedAudit.realtimeSafe && realGuardedAudit.score === 100, `score=${realGuardedAudit.score}`);

  // "core" context is untouched by this option (the guard is a processBlock/
  // buffer-write concern, not a per-sample-core concern) -- confirms the
  // extension didn't leak into the other context's scoring.
  const coreWithOption = auditCppRealtimeSafety("return std::tanh(inputSample);", "core", { requireSafetyNet: true });
  check("auditor: requireSafetyNet has no effect in \"core\" context", coreWithOption.score === 100 && coreWithOption.realtimeSafe);

  console.log(failures === 0 ? "\nCPP SAFETY NET: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
