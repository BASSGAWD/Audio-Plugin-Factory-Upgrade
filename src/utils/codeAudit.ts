/**
 * The DSP Code Auditor — Milestone 5's answer to the sharpest critique of
 * this factory: "your quality gate measures the OUTPUT, not the ENGINEERING."
 *
 * runQualityGate proves a plugin SOUNDS right (audible, honest, at the floor).
 * This proves the code IS right, statically, across the dimensions a senior
 * DSP engineer reviews for:
 *
 *   REAL-TIME SAFETY   — no per-sample allocation, no locks/IO/logging/timers,
 *                        no non-deterministic Math.random in the audio path.
 *   NUMERICAL ROBUSTNESS — guarded logs and divisions, clamped feedback that
 *                        can't run away, a soft-limited return that can't emit
 *                        a raw NaN/Inf.
 *   PARAMETER SMOOTHING — coefficient-driving params are smoothed, not applied
 *                        raw (the difference between a clean sweep and a zipper).
 *   MAINTAINABILITY    — body length, nesting depth, magic-number density.
 *
 * Every finding is concrete and actionable. The score is INFORMATIONAL (like
 * the aliasing and true-peak measurements): it rides in the build report and
 * the knowledge audit's per-concept "code health" column, and feeds the
 * refinement loop's tie-breaks, but it never touches the four headline scores,
 * so the >= 97 floor stays provable. Parameter ranges are used where relevant
 * so the numerical checks are accurate, not trigger-happy (a feedback whose
 * range tops out below 1.0 is safe and is not flagged).
 */

import { PluginParameter } from "../types";

/** The auditor only needs a parameter's id, name, and max — accept anything
 *  that carries those (full PluginParameter, or a recipe's value-less param). */
type AuditParam = Pick<PluginParameter, "id" | "name" | "max">;

export type AuditSeverity = "critical" | "warning" | "advisory";

export interface CodeFinding {
  dimension: "realtime" | "numerical" | "smoothing" | "maintainability";
  severity: AuditSeverity;
  message: string;
}

export interface CodeAuditReport {
  /** 0-100 overall engineering health (min of the weighted dimensions). */
  codeHealth: number;
  dimensions: {
    realtime: number;
    numerical: number;
    smoothing: number;
    maintainability: number;
  };
  findings: CodeFinding[];
  metrics: {
    lines: number;
    maxNestingDepth: number;
    magicNumbersPerLine: number;
    guardedLogs: number;
    unguardedLogs: number;
  };
}

const SEVERITY_COST: Record<AuditSeverity, number> = { critical: 30, warning: 12, advisory: 4 };

/** Strip string/regex/number-suffix noise that would confuse the text scans. */
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Remove EVERY one-time init-guard block — `if (!state.<...>init<...>) { ... }`
 * — by brace matching, so hot-loop checks (allocations, .push) see only the
 * code that runs every sample. Composed builds prefix state keys per stage
 * (state.s1_init, state.s2_init), so there can be several guards; strip them
 * all. Requiring "init" in the guarded var keeps this from eating a genuine
 * per-sample `if (!state.gate)` conditional.
 */
function stripInitBlocks(code: string): string {
  const re = /if\s*\(\s*!\s*state\.\w*init\w*\b[^)]*\)\s*\{/i;
  let out = code;
  for (let guard = 0; guard < 20; guard++) {
    const m = re.exec(out);
    if (!m) break;
    const start = m.index;
    let i = start + m[0].length;
    let depth = 1;
    for (; i < out.length && depth > 0; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") depth--;
    }
    out = out.slice(0, start) + out.slice(i);
  }
  return out;
}

function scoreFrom(findings: CodeFinding[], dimension: CodeFinding["dimension"]): number {
  const cost = findings.filter((f) => f.dimension === dimension).reduce((s, f) => s + SEVERITY_COST[f.severity], 0);
  return Math.max(0, 100 - cost);
}

/* ------------------------------------------------------------------ */
/* Dimension scanners                                                  */
/* ------------------------------------------------------------------ */

function auditRealtime(code: string, findings: CodeFinding[]): void {
  // Allocation / array-growth / random checks look at the HOT PATH only:
  // the same operations inside the one-time init guard are correct setup.
  const hot = stripInitBlocks(code);
  if (/new\s+(Float32Array|Float64Array|Array|Object|Map|Set)\s*\(|\.fill\s*\(/.test(hot)) {
    findings.push({ dimension: "realtime", severity: "critical", message: "allocates memory OUTSIDE the `if (!state.init)` guard — per-sample allocation stutters audio; move all allocations into the one-time init block" });
  }
  if (/\.(push|pop|shift|unshift|splice)\s*\(/.test(hot)) {
    findings.push({ dimension: "realtime", severity: "critical", message: "grows/shrinks an array in the hot loop (.push/.pop/.splice) — dynamic resizing allocates; use a fixed-size ring buffer" });
  }
  if (/Math\.random\s*\(/.test(hot)) {
    findings.push({ dimension: "realtime", severity: "warning", message: "calls Math.random() in the audio path — non-deterministic and un-reproducible across runs; use a seeded integer PRNG in state for any noise" });
  }
  if (/console\.(log|warn|error|info)/.test(code)) {
    findings.push({ dimension: "realtime", severity: "warning", message: "logs to the console inside the per-sample loop — remove all logging from real-time code" });
  }
  if (/JSON\.(parse|stringify)|fetch\s*\(|setTimeout|setInterval|await\b|new\s+Promise/.test(code)) {
    findings.push({ dimension: "realtime", severity: "critical", message: "uses JSON/fetch/timers/async in the audio path — real-time DSP must be pure synchronous arithmetic" });
  }
}

function auditNumerical(code: string, params: AuditParam[], findings: CodeFinding[]): { guarded: number; unguarded: number } {
  // Logs: the real hazard is log() of an AMPLITUDE/ENERGY term that genuinely
  // reaches 0 (env, rms, magnitude, level...). log() of a literal or a
  // bounded-positive frequency ratio is safe and must not be flagged, or the
  // auditor cries wolf on clean code (the classic static-analysis failure).
  let guarded = 0;
  let unguarded = 0;
  const AMPLITUDE = /\b(env|rms|mag|magnitude|amp|amplitude|level|energy|power|gr|gain)\b/i;
  const logRe = /Math\.(log10|log2|log)\s*\(\s*([^)]*)/g;
  let m: RegExpExecArray | null;
  while ((m = logRe.exec(code))) {
    const arg = m[2];
    if (/^\s*[\d.]+\s*$/.test(arg)) { guarded++; continue; } // log of a literal — safe
    if (/Math\.max\s*\(/.test(arg) || /Math\.abs/.test(arg)) { guarded++; continue; }
    if (AMPLITUDE.test(arg)) unguarded++; // genuine log(0) hazard
    else guarded++; // frequency ratios etc. — conventionally safe
  }
  if (unguarded > 0) {
    findings.push({ dimension: "numerical", severity: "critical", message: `${unguarded} unguarded Math.log(...) of an amplitude/energy term — log of 0 is -Infinity and poisons the signal; wrap the argument in Math.max(1e-6, ...)` });
  }

  // Division by a bare state/param value (not a literal, not Math.max-guarded).
  const divRe = /\/\s*(params\.\w+|state\.\w+)\b/g;
  const bareDivs = new Set<string>();
  while ((m = divRe.exec(code))) bareDivs.add(m[1]);
  if (bareDivs.size > 0) {
    findings.push({ dimension: "numerical", severity: "warning", message: `divides by a raw value (${[...bareDivs].join(", ")}) that can reach 0 — guard the divisor with Math.max(1e-6, ...)` });
  }

  // Runaway feedback: a feedback-style param whose range reaches >= 1.0, used
  // in a recursive state update (state.X = ... state.X ...), with no Math.min
  // clamp anywhere. A clean recipe either keeps such a range below 1.0 or
  // clamps it, so this fires only on the genuine hazard.
  const clamped = /Math\.min\s*\(/.test(code);
  const recursiveState = /state\.\w+\s*=[^;]*state\.\w+/.test(code);
  if (!clamped && recursiveState) {
    for (const p of params) {
      const feedbackName = /feedback|regen|resonance|decay|\bfb\b/i.test(p.id) || /feedback|regen|resonance|decay/i.test(p.name);
      if (feedbackName && p.max >= 1.0) {
        findings.push({ dimension: "numerical", severity: "warning", message: `"${p.id}" reaches ${p.max} (>= 1.0) and feeds a recursive state update with no Math.min(...) clamp — the loop can grow without bound; clamp the coefficient below 1.0` });
      }
    }
  }

  // Return must be soft-limited: a bare return can emit a raw NaN/Inf.
  const returns = code.match(/return\s+[^;]+/g) || [];
  const unsafeReturn = returns.some((r) => !/Math\.(tanh|max|min)|Math\.tanh/.test(r) && !/^return\s+(state\.\w+|0|inputSample)\s*$/.test(r.trim()));
  if (unsafeReturn && returns.length > 0) {
    findings.push({ dimension: "numerical", severity: "advisory", message: "a return value is not soft-limited (Math.tanh / clamp) — an unexpected spike can emit a value outside [-1, 1]" });
  }

  return { guarded, unguarded };
}

function auditSmoothing(code: string, params: AuditParam[], findings: CodeFinding[]): void {
  // Only relevant for filter/coefficient-style params: a raw cutoff/freq used
  // to compute a coefficient every sample zippers unless smoothed. Heuristic:
  // the param feeds an exp/sin/coefficient expression but has no `state.smX +=`
  // smoother nearby.
  for (const p of params) {
    const isCoeffParam = /cutoff|freq|frequency|tone|center|corner/i.test(p.id) || /cutoff|freq|frequency|tone|center/i.test(p.name);
    if (!isCoeffParam) continue;
    const usedInCoeff = new RegExp(`(Math\\.(exp|sin|tan|cos|PI)[^;]*params\\.${p.id}|params\\.${p.id}[^;]*(Math\\.(exp|sin|tan)|/\\s*44100|/\\s*sampleRate))`).test(code);
    const smoothed = new RegExp(`state\\.\\w+\\s*\\+=[^;]*params\\.${p.id}`).test(code) || new RegExp(`state\\.sm\\w*`).test(code);
    if (usedInCoeff && !smoothed) {
      findings.push({ dimension: "smoothing", severity: "advisory", message: `"${p.id}" drives a filter coefficient without per-sample smoothing — automating it will zipper; smooth via state.sm += 0.002 * (target - state.sm)` });
    }
  }
}

function auditMaintainability(code: string, findings: CodeFinding[]): CodeAuditReport["metrics"] {
  const lines = code.split("\n").filter((l) => l.trim().length > 0);
  let depth = 0;
  let maxDepth = 0;
  for (const ch of code) {
    if (ch === "{") { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  const numLiterals = (code.match(/(?<![\w.])\d+\.?\d*(e-?\d+)?/gi) || []).filter((n) => !["0", "1", "2"].includes(n));
  const magicPerLine = lines.length > 0 ? numLiterals.length / lines.length : 0;

  if (lines.length > 90) {
    findings.push({ dimension: "maintainability", severity: "advisory", message: `${lines.length} lines — long for a single DSP function; consider whether it does more than one thing (block FFT bodies are a justified exception)` });
  }
  if (maxDepth > 6) {
    findings.push({ dimension: "maintainability", severity: "advisory", message: `nesting depth ${maxDepth} — deep control flow is hard to follow and to make branch-predictable` });
  }
  return {
    lines: lines.length,
    maxNestingDepth: maxDepth,
    magicNumbersPerLine: Math.round(magicPerLine * 100) / 100,
    guardedLogs: 0,
    unguardedLogs: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function auditDspCode(dspFunction: string, parameters: AuditParam[] = []): CodeAuditReport {
  const code = stripComments(dspFunction);
  const findings: CodeFinding[] = [];

  auditRealtime(code, findings);
  const logCounts = auditNumerical(code, parameters, findings);
  auditSmoothing(code, parameters, findings);
  const metrics = auditMaintainability(code, findings);
  metrics.guardedLogs = logCounts.guarded;
  metrics.unguardedLogs = logCounts.unguarded;

  const dimensions = {
    realtime: scoreFrom(findings, "realtime"),
    numerical: scoreFrom(findings, "numerical"),
    smoothing: scoreFrom(findings, "smoothing"),
    maintainability: scoreFrom(findings, "maintainability"),
  };
  // Health = min of the safety-critical dimensions blended with the softer
  // ones, so a real-time or numerical violation dominates (as it should) while
  // maintainability advisories only nudge.
  const codeHealth = Math.round(
    Math.min(dimensions.realtime, dimensions.numerical) * 0.7 +
      dimensions.smoothing * 0.15 +
      dimensions.maintainability * 0.15
  );

  return { codeHealth, dimensions, findings, metrics };
}

/** One-line summary for logs and the chat report. */
export function formatCodeAudit(report: CodeAuditReport): string {
  const worst = [...report.findings].sort((a, b) => SEVERITY_COST[b.severity] - SEVERITY_COST[a.severity])[0];
  return `Code health ${report.codeHealth}/100 (rt ${report.dimensions.realtime}, num ${report.dimensions.numerical}, smooth ${report.dimensions.smoothing}, maint ${report.dimensions.maintainability})${worst ? ` — top issue: ${worst.message}` : " — no engineering issues found"}`;
}
