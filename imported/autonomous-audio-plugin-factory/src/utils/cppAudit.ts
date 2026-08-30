/**
 * The C++ Real-Time Safety Auditor.
 *
 * The JS DSP is verified in-browser by the quality gate and the JS code
 * auditor. But the NATIVE export path translates that DSP into C++ with a
 * local model, and a model can quietly introduce a heap allocation, a lock,
 * or an IO call into the audio callback — the exact things that make a plugin
 * glitch or get rejected by a professional host. This auditor scans the
 * generated JUCE C++ the way a plugin reviewer does, before it ever compiles.
 *
 * Two contexts:
 *   - "core": the ProcessorCore::processSample body (the translated DSP) — the
 *     per-sample hot path; ANY allocation/lock/IO here is critical.
 *   - "full": a whole file (e.g. PluginProcessor.cpp) — same hot-path checks
 *     plus a positive check that processBlock declares juce::ScopedNoDenormals.
 *
 * Pure string analysis, no fs — safe to import from the server (to audit
 * before writing) and from tests.
 */

export type CppSeverity = "critical" | "warning" | "advisory";

export interface CppFinding {
  severity: CppSeverity;
  message: string;
}

export interface CppAuditReport {
  score: number;
  findings: CppFinding[];
  realtimeSafe: boolean;
}

const COST: Record<CppSeverity, number> = { critical: 34, warning: 12, advisory: 4 };

interface Rule {
  test: RegExp;
  severity: CppSeverity;
  message: string;
}

// Ordered hot-path hazards. Each is a real reason a JUCE plugin glitches or
// fails validation when the pattern appears inside the audio callback.
const HOT_PATH_RULES: Rule[] = [
  { test: /\bnew\b\s+[A-Za-z_]|\bdelete\b\s|\bnew\[\]|\bdelete\s*\[\]/, severity: "critical", message: "uses new/delete in the audio path — heap allocation in processBlock stutters audio and can deadlock; allocate once in prepare()" },
  { test: /\b(malloc|calloc|realloc|free)\s*\(/, severity: "critical", message: "calls malloc/free in the audio path — no heap allocation is allowed in a real-time callback" },
  { test: /std::(vector|string|map|unordered_map|list|deque|set)\s*<[^>]*>\s+\w+\s*[({]/, severity: "critical", message: "constructs a heap container (std::vector/string/map…) in the audio path — it allocates; use a fixed-size C array or a member buffer sized in prepare()" },
  { test: /std::(mutex|lock_guard|unique_lock|scoped_lock)\b|\.lock\s*\(\s*\)/, severity: "critical", message: "takes a lock in the audio path — a priority-inverted lock is the classic real-time dropout; use lock-free atomics or a SPSC FIFO" },
  { test: /std::(ifstream|ofstream|fstream)\b|\bfopen\s*\(|std::filesystem|juce::File\b/, severity: "critical", message: "does file IO in the audio path — filesystem access blocks unpredictably; do IO on a message-thread and hand data over lock-free" },
  { test: /\bsocket\s*\(|\bconnect\s*\(|curl_|juce::(Socket|URL)\b/, severity: "critical", message: "does network IO in the audio path — never touch the network from a real-time callback" },
  { test: /\bthrow\b|\btry\s*\{/, severity: "warning", message: "uses exceptions in the audio path — throwing across the audio callback is undefined-latency; return a sentinel instead" },
  { test: /printf\s*\(|std::cout|std::cerr|fprintf\s*\(|juce::Logger|\bDBG\s*\(/, severity: "warning", message: "logs from the audio path — stream/log calls can allocate and block; remove them from real-time code" },
  { test: /\bstd::this_thread::sleep|\bSleep\s*\(|\busleep\s*\(/, severity: "critical", message: "sleeps in the audio path — this directly causes buffer underruns" },
];

/** Strip C++ comments and string/char literals so the pattern scans don't
 *  match hazard words that only appear in prose or a string. */
function stripCpp(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/'(\\.|[^'\\])*'/g, "''");
}

/** A NaN/Inf guard (isnan/isinf, or the !isfinite negation). */
const FINITE_GUARD_PATTERN = /std::isfinite\s*\(|std::isnan\s*\(|std::isinf\s*\(|\bisfinite\s*\(|\bisnan\s*\(|\bisinf\s*\(/;
/** A hard-ceiling clamp/clip — the last-resort bound on the sanitized sample. */
const HARD_CEILING_PATTERN = /\bjlimit\s*\(|std::clamp\s*\(|\bjmin\s*\([^)]*\bjmax\s*\(|\bjmax\s*\([^)]*\bjmin\s*\(/;

export interface CppAuditOptions {
  /**
   * When true (opt-in — existing callers are unaffected), additionally
   * require the NaN/Inf/denormal safety-net guard (see portableCodegen.ts /
   * nativeBuild.ts's `sanitizeSample`) to be present anywhere a processBlock
   * writes to the audio buffer. Only meaningful with context "full". A
   * missing guard is "critical": an unstable filter, feedback delay, or
   * divide-by-zero can otherwise write NaN/Inf/full-scale noise straight
   * into the host's audio graph.
   */
  requireSafetyNet?: boolean;
}

/**
 * Audit generated JUCE C++ for real-time-safety violations.
 * @param cpp     the C++ source (a processSample body, or a whole file)
 * @param context "core" = the per-sample DSP body; "full" = a complete file
 *                (adds the ScopedNoDenormals check on processBlock).
 * @param options see CppAuditOptions. Defaults preserve prior behavior
 *                exactly, so existing callers are unaffected.
 */
export function auditCppRealtimeSafety(
  cpp: string,
  context: "core" | "full" = "core",
  options: CppAuditOptions = {}
): CppAuditReport {
  const code = stripCpp(cpp);
  const findings: CppFinding[] = [];

  for (const rule of HOT_PATH_RULES) {
    if (rule.test.test(code)) findings.push({ severity: rule.severity, message: rule.message });
  }

  if (context === "full" && /processBlock\s*\(/.test(code)) {
    if (!/ScopedNoDenormals/.test(code)) {
      findings.push({ severity: "warning", message: "processBlock does not declare juce::ScopedNoDenormals — recursive filters can drop into denormal arithmetic and spike CPU; add `juce::ScopedNoDenormals noDenormals;` at the top" });
    }

    if (options.requireSafetyNet) {
      const hasFiniteGuard = FINITE_GUARD_PATTERN.test(code);
      const hasHardCeiling = HARD_CEILING_PATTERN.test(code);
      if (!hasFiniteGuard || !hasHardCeiling) {
        findings.push({
          severity: "critical",
          message:
            "processBlock writes samples to the audio buffer without a NaN/Inf/denormal safety-net guard — an unstable filter, feedback delay, or divide-by-zero can send full-scale noise straight into the host's audio graph; sanitize every sample immediately before the buffer write (std::isfinite check -> 0.0f, flush denormals to zero, hard-ceiling clip e.g. juce::jlimit(-4.0f, 4.0f, x))",
        });
      }
    }
  }

  const cost = findings.reduce((s, f) => s + COST[f.severity], 0);
  const score = Math.max(0, 100 - cost);
  return { score, findings, realtimeSafe: !findings.some((f) => f.severity === "critical") };
}

/** One-line summary for the native-build log. */
export function formatCppAudit(report: CppAuditReport): string {
  if (report.findings.length === 0) return "C++ real-time safety: clean (100/100) — no heap, locks, IO, or logging in the audio path.";
  const worst = report.findings[0];
  return `C++ real-time safety: ${report.score}/100${report.realtimeSafe ? "" : " — NOT real-time-safe"} (${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}; top: ${worst.message})`;
}

/* ------------------------------------------------------------------ */
/* Positive-idiom auditor -- presence of correct patterns, not just    */
/* absence of hazards. Mirrors codeAudit.ts's smoothing/numerical      */
/* dimensions on the JS side, translated to C++ syntax: params.<id>    */
/* access is IDENTICAL between the two languages (the translation      */
/* prompt requires it), and JS's `state.smX` becomes a bare member name */
/* with no "state." prefix (the prompt requires that too), so these    */
/* checks are close ports, not new heuristics invented from scratch.   */
/* ------------------------------------------------------------------ */

type CppAuditParam = { id: string; name: string };

export interface CppIdiomFinding {
  dimension: "smoothing" | "numerical-idiom";
  severity: CppSeverity;
  message: string;
}

export interface CppIdiomReport {
  /** 0-100, informational only -- like codeAudit.ts's codeHealth, this
   *  never gates shipping, it only feeds the build report and refinement
   *  tie-breaks. */
  idiomHealth: number;
  findings: CppIdiomFinding[];
}

const IDIOM_COST: Record<CppSeverity, number> = { critical: 30, warning: 12, advisory: 4 };

function auditCppSmoothing(code: string, params: CppAuditParam[], findings: CppIdiomFinding[]): void {
  for (const p of params) {
    const isCoeffParam = /cutoff|freq|frequency|tone|center|corner/i.test(p.id) || /cutoff|freq|frequency|tone|center/i.test(p.name);
    if (!isCoeffParam) continue;
    const usedInCoeff = new RegExp(
      `(std::(exp|sin|tan|cos)[^;]*params\\.${p.id}|params\\.${p.id}[^;]*(std::(exp|sin|tan)|/\\s*44100|/\\s*sampleRate))`
    ).test(code);
    // Smoothed if: a juce::SmoothedValue call site is present, OR a bare
    // member ramp assignment feeds this param (state.smX += ... in the JS
    // becomes a bare `smX +=` member ramp in C++, no "state." prefix).
    const smoothed =
      /getNextValue\s*\(\s*\)|setTargetValue\s*\(/.test(code) ||
      new RegExp(`\\w+\\s*\\+=[^;]*params\\.${p.id}`).test(code);
    if (usedInCoeff && !smoothed) {
      findings.push({
        dimension: "smoothing",
        severity: "advisory",
        message: `"${p.id}" drives a filter/coefficient expression without per-sample smoothing — automating it will zipper; use juce::SmoothedValue (see cppPatterns.ts's smoothed_value_param) or a member ramp toward the target`,
      });
    }
  }
}

function auditCppNumericalIdiom(code: string, findings: CppIdiomFinding[]): void {
  // Logs: same amplitude/energy-term heuristic as the JS auditor -- log() of
  // a literal or a bounded-positive frequency ratio is conventionally safe
  // and must not be flagged.
  const AMPLITUDE = /\b(env|rms|mag|magnitude|amp|amplitude|level|energy|power|gr|gain)\w*\b/i;
  const logRe = /std::(log10|log2|log)\s*\(\s*([^)]*)/g;
  let unguarded = 0;
  let m: RegExpExecArray | null;
  while ((m = logRe.exec(code))) {
    const arg = m[2];
    if (/^\s*[\d.]+f?\s*$/.test(arg)) continue; // log of a literal — safe
    if (/std::max\s*\(/.test(arg) || /std::abs\s*\(/.test(arg)) continue;
    if (AMPLITUDE.test(arg)) unguarded++;
  }
  if (unguarded > 0) {
    findings.push({
      dimension: "numerical-idiom",
      severity: "critical",
      message: `${unguarded} unguarded std::log(...) of an amplitude/energy term — log of 0 is -Infinity and poisons the signal; wrap the argument in std::max(1e-6f, ...)`,
    });
  }

  // Division by a bare params.<id> member, not literal- or std::max-guarded.
  const divRe = /\/\s*(params\.\w+)\b/g;
  const bareDivs = new Set<string>();
  while ((m = divRe.exec(code))) bareDivs.add(m[1]);
  if (bareDivs.size > 0) {
    findings.push({
      dimension: "numerical-idiom",
      severity: "warning",
      message: `divides by a raw parameter value (${[...bareDivs].join(", ")}) that can reach 0 — guard the divisor with std::max(1e-6f, ...)`,
    });
  }
}

/**
 * Audit generated JUCE C++ for idiomatic-pattern PRESENCE (parameter
 * smoothing, guarded division/log), complementing auditCppRealtimeSafety's
 * hazard-ABSENCE checks above. Informational only, mirrors codeAudit.ts's
 * relationship to the four headline scores exactly: this never gates
 * shipping, it only surfaces evidence.
 */
export function auditCppIdioms(cpp: string, params: CppAuditParam[]): CppIdiomReport {
  const code = stripCpp(cpp);
  const findings: CppIdiomFinding[] = [];
  auditCppSmoothing(code, params, findings);
  auditCppNumericalIdiom(code, findings);
  const cost = findings.reduce((s, f) => s + IDIOM_COST[f.severity], 0);
  const idiomHealth = Math.max(0, 100 - cost);
  return { idiomHealth, findings };
}

/** One-line summary for the native-build log. */
export function formatCppIdiomAudit(report: CppIdiomReport): string {
  if (report.findings.length === 0) return "C++ idiom check: clean (100/100) — parameters are smoothed and numerical guards are present.";
  const worst = [...report.findings].sort((a, b) => IDIOM_COST[b.severity] - IDIOM_COST[a.severity])[0];
  return `C++ idiom check: ${report.idiomHealth}/100 (${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}; top: ${worst.message})`;
}
