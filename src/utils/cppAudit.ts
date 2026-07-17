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

/**
 * Audit generated JUCE C++ for real-time-safety violations.
 * @param cpp     the C++ source (a processSample body, or a whole file)
 * @param context "core" = the per-sample DSP body; "full" = a complete file
 *                (adds the ScopedNoDenormals check on processBlock).
 */
export function auditCppRealtimeSafety(cpp: string, context: "core" | "full" = "core"): CppAuditReport {
  const code = stripCpp(cpp);
  const findings: CppFinding[] = [];

  for (const rule of HOT_PATH_RULES) {
    if (rule.test.test(code)) findings.push({ severity: rule.severity, message: rule.message });
  }

  if (context === "full" && /processBlock\s*\(/.test(code)) {
    if (!/ScopedNoDenormals/.test(code)) {
      findings.push({ severity: "warning", message: "processBlock does not declare juce::ScopedNoDenormals — recursive filters can drop into denormal arithmetic and spike CPU; add `juce::ScopedNoDenormals noDenormals;` at the top" });
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
