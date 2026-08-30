/**
 * Phase A of the C++/JUCE knowledge base — cppAudit.ts's auditCppIdioms:
 *
 * Mirrors codeAudit.ts's smoothing/numerical dimensions in C++ syntax --
 * PRESENCE of correct patterns, complementing auditCppRealtimeSafety's
 * hazard-ABSENCE checks. Per project convention: prove the honest pattern
 * scores clean AND a deliberately broken counterpart is caught, with a
 * decisive gap between them -- a score that doesn't move between the two
 * isn't measuring anything.
 */
import { auditCppIdioms, formatCppIdiomAudit } from "../src/utils/cppAudit";
import { CPP_PATTERNS } from "../src/utils/cppPatterns";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- smoothing dimension ---- */
{
  const honest = `smCutoff.setTargetValue (params.cutoff);
const float cutoff = smCutoff.getNextValue();
const float a = std::exp (-2.0f * juce::MathConstants<float>::pi * cutoff / 44100.0f);
lp += a * (inputSample - lp);`;
  const report = auditCppIdioms(honest, [{ id: "cutoff", name: "Cutoff" }]);
  check("smoothed cutoff used in a coefficient scores clean", report.findings.filter((f) => f.dimension === "smoothing").length === 0, formatCppIdiomAudit(report));
}
{
  const broken = `const float a = std::exp (-2.0f * juce::MathConstants<float>::pi * params.cutoff / 44100.0f);
lp += a * (inputSample - lp);`;
  const report = auditCppIdioms(broken, [{ id: "cutoff", name: "Cutoff" }]);
  check("raw cutoff used directly in a coefficient is flagged", report.findings.some((f) => f.dimension === "smoothing"), formatCppIdiomAudit(report));
}
{
  // Member-ramp smoothing (the non-SmoothedValue idiom, mirrors JS state.smX +=)
  const honestRamp = `smCutoff += 0.002f * (params.cutoff - smCutoff);
const float a = std::exp (-2.0f * juce::MathConstants<float>::pi * smCutoff / 44100.0f);`;
  const report = auditCppIdioms(honestRamp, [{ id: "cutoff", name: "Cutoff" }]);
  check("member-ramp smoothing (no SmoothedValue) also scores clean", report.findings.filter((f) => f.dimension === "smoothing").length === 0, formatCppIdiomAudit(report));
}
{
  // Non-coefficient params (e.g. "mix") must never be flagged -- only
  // cutoff/freq/tone/center/corner-named params are coefficient-relevant.
  const code = `const float wet = std::tanh (inputSample * params.mix);`;
  const report = auditCppIdioms(code, [{ id: "mix", name: "Mix" }]);
  check("a non-coefficient param (mix) is never flagged for smoothing", report.findings.filter((f) => f.dimension === "smoothing").length === 0);
}
{
  const honestScore = auditCppIdioms(
    `smCutoff.setTargetValue (params.cutoff); const float cutoff = smCutoff.getNextValue(); const float a = std::exp (-cutoff / 44100.0f);`,
    [{ id: "cutoff", name: "Cutoff" }]
  ).idiomHealth;
  const brokenScore = auditCppIdioms(`const float a = std::exp (-params.cutoff / 44100.0f);`, [{ id: "cutoff", name: "Cutoff" }]).idiomHealth;
  check("decisive score gap between smoothed and raw coefficient use", brokenScore < honestScore, `honest=${honestScore} broken=${brokenScore}`);
}

/* ---- numerical-idiom dimension ---- */
{
  const honest = `const float db = 20.0f * std::log10 (std::max (1e-6f, envState));`;
  const report = auditCppIdioms(honest, []);
  check("guarded log of an amplitude term scores clean", report.findings.filter((f) => f.dimension === "numerical-idiom").length === 0, formatCppIdiomAudit(report));
}
{
  const broken = `const float db = 20.0f * std::log10 (gainReductionAmount);`;
  const report = auditCppIdioms(broken, []);
  check("unguarded log of an amplitude/energy-named term is flagged critical", report.findings.some((f) => f.dimension === "numerical-idiom" && f.severity === "critical"), formatCppIdiomAudit(report));
}
{
  // Frequency-ratio logs (not amplitude/energy) are conventionally safe and
  // must not be flagged, mirroring codeAudit.ts's own "don't cry wolf" rule.
  const code = `const float octaves = std::log2 (params.freq / 440.0f);`;
  const report = auditCppIdioms(code, [{ id: "freq", name: "Freq" }]);
  check("log of a frequency ratio (not amplitude) is not flagged", report.findings.filter((f) => f.dimension === "numerical-idiom").length === 0);
}
{
  const code = `const float g = x / params.q;`;
  const report = auditCppIdioms(code, [{ id: "q", name: "Q" }]);
  check("raw division by a param that can reach 0 is flagged", report.findings.some((f) => f.dimension === "numerical-idiom" && /divides/.test(f.message)));
}
{
  const honestScore = auditCppIdioms(`const float db = 20.0f * std::log10 (std::max (1e-6f, envState));`, []).idiomHealth;
  const brokenScore = auditCppIdioms(`const float db = 20.0f * std::log10 (envState);`, []).idiomHealth;
  check("decisive score gap between guarded and unguarded log", brokenScore < honestScore, `honest=${honestScore} broken=${brokenScore}`);
}

/* ---- no false positives on the factory's own generated-style code ---- */
{
  // A trivial passthrough (the guaranteed-compiling fallback core) must
  // never trigger a finding.
  const report = auditCppIdioms("return inputSample;", []);
  check("passthrough fallback core has zero idiom findings", report.findings.length === 0 && report.idiomHealth === 100, formatCppIdiomAudit(report));
}
{
  // biquad_iir_filter's own exemplar code doesn't compute a raw exp/sin/tan
  // coefficient inline (it calls makePeakFilter), so it must not trip the
  // smoothing heuristic even though "freq" is a coefficient-shaped param id.
  const biquad = CPP_PATTERNS.find((p) => p.id === "biquad_iir_filter")!;
  const report = auditCppIdioms(biquad.code, [
    { id: "freq", name: "Center Freq" },
    { id: "q", name: "Q" },
    { id: "boost", name: "Boost" },
  ]);
  check("biquad_iir_filter exemplar has no false-positive idiom findings", report.findings.length === 0, formatCppIdiomAudit(report));
}
{
  const envelope = CPP_PATTERNS.find((p) => p.id === "envelope_follower")!;
  const report = auditCppIdioms(envelope.code, []);
  check("envelope_follower exemplar has no false-positive idiom findings", report.findings.length === 0, formatCppIdiomAudit(report));
}

/* ---- formatting ---- */
{
  const clean = formatCppIdiomAudit({ idiomHealth: 100, findings: [] });
  check("format: clean report reads as clean", /clean \(100\/100\)/.test(clean), clean);
  const dirty = formatCppIdiomAudit(auditCppIdioms(`const float a = std::exp (-params.cutoff / 44100.0f);`, [{ id: "cutoff", name: "Cutoff" }]));
  check("format: dirty report names the top finding", /top:/.test(dirty), dirty);
}

console.log(failures === 0 ? "\nC++ IDIOM AUDIT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
