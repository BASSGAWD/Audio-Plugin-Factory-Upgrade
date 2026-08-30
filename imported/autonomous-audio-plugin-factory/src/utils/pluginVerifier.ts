/**
 * Post-generation verification & repair loop.
 *
 * Whatever a model returns is no longer loaded blindly: the dspFunction is
 * compile-checked, then run through the real signal-simulation harness
 * (impulse / low-frequency sweep / feedback burst -- runPluginDiagnostics).
 * If it fails, the concrete failure evidence is fed back to the local model
 * for a bounded number of repair attempts. Only verified (or best-effort,
 * clearly flagged) code reaches the audio engine.
 */

import { AudioPlugin, PluginParameter } from "../types";
import { runPluginDiagnostics, sanitizeDspCode, normalizeModelDspCode } from "./healthcheckRunner";
import { LLMConfig, callLocalLLM, isLocalProvider } from "./llmGateway";
import { REPAIR_SYSTEM_PROMPT } from "./dspPromptKit";
import { measureMusicality, analyzeRealtimeSafety } from "./qualityGate";

export interface VerificationOutcome {
  dspFunction: string;
  verified: boolean;
  attempts: number;
  /** Human-readable trail of what happened, for the chat transcript. */
  notes: string[];
}

export interface CheckResult {
  ok: boolean;
  evidence: string;
}

/** Full deterministic acceptance test for a dspFunction: compile, signal
 *  simulation, musicality, real-time safety. Also used as the DSP job's
 *  acceptance test in the build planner. */
export function checkDsp(dspFunction: string, parameters: PluginParameter[]): CheckResult {
  // 1. Compile check
  try {
    const sanitized = sanitizeDspCode(dspFunction);
    new Function("inputSample", "params", "state", "inputR", "inputKey", sanitized);
  } catch (err: any) {
    return { ok: false, evidence: `JavaScript syntax error: ${err.message}` };
  }

  // 2. Signal simulation (impulse, LF sweep, feedback bursts)
  const probe: AudioPlugin = {
    id: "verify-probe",
    name: "verify-probe",
    category: "filter",
    description: "",
    parameters,
    dspFunction,
    faustCode: "",
    cppJuceCode: "",
    createdAt: "",
  };

  const report = runPluginDiagnostics(probe);
  if (report.overallHealthStatus === "CRITICAL") {
    const failures: string[] = [];
    const signals = report.testSignals;
    if (signals.impulse.hasNaN || !signals.impulse.isStable) {
      failures.push(`impulse test: ${signals.impulse.hasNaN ? "produced NaN/Infinity or threw" : `blew up (peak amplitude ${signals.impulse.maxAmplitude})`}`);
    }
    if (signals.lowFrequencySweep.hasNaN || !signals.lowFrequencySweep.isStable) {
      failures.push(`low-frequency sweep: ${signals.lowFrequencySweep.hasNaN ? "produced NaN/Infinity or threw" : `blew up (peak amplitude ${signals.lowFrequencySweep.maxAmplitude})`}`);
    }
    if (signals.extremeFeedback.hasNaN || !signals.extremeFeedback.isStable) {
      failures.push(`feedback burst test: ${signals.extremeFeedback.hasNaN ? "produced NaN/Infinity or threw" : `blew up (peak amplitude ${signals.extremeFeedback.maxAmplitude})`}`);
    }
    return {
      ok: false,
      evidence: `Signal simulation failed -- ${failures.join("; ") || report.recommedSummary}`,
    };
  }

  // 3. Musicality gate: stable code that is silent, or whose knobs all do
  // nothing, is still a failed generation -- repair it with real evidence.
  const musical = measureMusicality(dspFunction, parameters);
  if (!musical.ok) {
    return { ok: false, evidence: `Musicality check failed -- ${musical.evidence}` };
  }

  // 4. Real-time safety: per-sample allocation and I/O in the audio path are
  // repairable performance defects, not stylistic nits.
  const rt = analyzeRealtimeSafety(dspFunction);
  if (rt.evidence) {
    return { ok: false, evidence: `Real-time safety check failed -- ${rt.evidence}` };
  }

  return { ok: true, evidence: "" };
}

/**
 * Verify a generated dspFunction; on failure, ask the local model to repair
 * it using the real failure evidence, up to `maxRepairs` times.
 *
 * Never throws: on unrecoverable failure it returns the last candidate with
 * verified=false so the caller can decide (the audio engine's own runtime
 * guards will zero output on crashes, so loading unverified code degrades
 * to silence rather than a broken app).
 */
export async function verifyAndRepairDsp(
  dspFunction: string,
  parameters: PluginParameter[],
  llmConfig: LLMConfig,
  maxRepairs: number = 2,
  /** Optional golden-recipe reference block for the effect family, given to the repair model. */
  recipeContext: string = ""
): Promise<VerificationOutcome> {
  const notes: string[] = [];
  let current = normalizeModelDspCode(dspFunction);

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const result = checkDsp(current, parameters);

    if (result.ok) {
      if (attempt > 0) {
        notes.push(`Auto-repaired after ${attempt} fix ${attempt === 1 ? "pass" : "passes"} -- final code passed impulse, sweep, and feedback simulations.`);
      }
      return { dspFunction: current, verified: true, attempts: attempt, notes };
    }

    notes.push(`Verification failed (attempt ${attempt + 1}): ${result.evidence}`);

    // Out of budget, or no local model available to attempt a repair with.
    if (attempt === maxRepairs || !isLocalProvider(llmConfig)) {
      break;
    }

    try {
      const paramIds = parameters.map((p) => `${p.id} (default ${p.defaultValue})`).join(", ");
      let repairUserText = `FAILURE EVIDENCE: ${result.evidence}\n\nAvailable params: ${paramIds}\n\nFailing dspFunction body:\n${current}`;
      if (recipeContext) {
        repairUserText += `\n\n${recipeContext}`;
      }
      const payload = await callLocalLLM({
        config: llmConfig,
        systemPrompt: REPAIR_SYSTEM_PROMPT,
        userText: repairUserText,
        temperature: 0.2,
      });
      if (typeof payload?.dspFunction === "string" && payload.dspFunction.trim()) {
        current = normalizeModelDspCode(payload.dspFunction);
        if (payload.explanation) notes.push(`Model diagnosis: ${payload.explanation}`);
      } else {
        notes.push("Repair call returned no usable code; stopping repair loop.");
        break;
      }
    } catch (err: any) {
      notes.push(`Repair call failed (${err.message}); stopping repair loop.`);
      break;
    }
  }

  return { dspFunction: current, verified: false, attempts: maxRepairs, notes };
}
