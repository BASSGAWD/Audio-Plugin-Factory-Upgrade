import { AudioPlugin, DiagnosticsReport, SignalMetrics } from "../types";

/**
 * Undo the two most common model formatting mistakes BEFORE code enters the
 * pipeline: wrapping the body in markdown fences, and returning a complete
 * `function(...) { ... }` (or arrow function) instead of just the body the
 * runtime contract expects. Both used to fail compilation and burn a whole
 * LLM repair round-trip; now they're fixed deterministically at ingestion.
 */
export function normalizeModelDspCode(codeString: string): string {
  let code = (codeString || "").trim();

  // Strip a single wrapping markdown fence (```javascript ... ```)
  const fenceMatch = code.match(/^```(?:javascript|js|typescript|ts)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    code = fenceMatch[1].trim();
  }

  // Unwrap a full function declaration/expression into its body
  const fnMatch = code.match(
    /^(?:const\s+\w+\s*=\s*)?(?:function\s*\w*\s*\([^)]*\)|\([^)]*\)\s*=>|inputSample\s*=>)\s*\{([\s\S]*)\}\s*;?\s*$/
  );
  if (fnMatch) {
    code = fnMatch[1].trim();
  }

  return code;
}

export function sanitizeDspCode(codeString: string): string {
  let sanitizedCode = codeString;
  const commonVars = [
    'delaySamples', 
    'readPtr', 
    'delayTimeMs', 
    'feedback', 
    'drive', 
    'bias', 
    'saturated', 
    'computation', 
    'volume', 
    'cutoff', 
    'resonance',
    'inputSample',
    'params',
    'state',
    'delayLine',
    'writePtr',
    'delaySample',
    'biasedInput'
  ];
  for (const v of commonVars) {
    let occurrences = 0;
    const regex = new RegExp(`\\b(let|const|var)\\s+(${v})\\b`, 'g');
    sanitizedCode = sanitizedCode.replace(regex, (match, declaration, name) => {
      occurrences++;
      if (occurrences === 1) {
        return `let ${name}`;
      } else {
        return name;
      }
    });
  }
  return sanitizedCode;
}

export function runPluginDiagnostics(plugin: AudioPlugin): DiagnosticsReport {
  const sampleRate = 44100;
  
  // Dynamic JavaScript function compilation
  let dspFunc: (inputSample: number, params: Record<string, number>, state: any, inputR?: number) => number;
  try {
    const sanitized = sanitizeDspCode(plugin.dspFunction);
    dspFunc = new Function("inputSample", "params", "state", "inputR", sanitized) as any;
  } catch (err: any) {
    return {
      timestamp: new Date().toLocaleTimeString(),
      overallHealthStatus: "CRITICAL",
      unstableTonesDetected: false,
      dcAccumulatorRisk: false,
      clippingSevereRisk: false,
      testSignals: {
        impulse: createEmptyMetrics(),
        lowFrequencySweep: createEmptyMetrics(),
        extremeFeedback: createEmptyMetrics(),
      },
      recommedSummary: `Compilation Failed during healthcheck initialization: ${err.message}`,
    };
  }

  // Map parameters to an easy object
  const paramsMap: Record<string, number> = {};
  plugin.parameters.forEach((p) => {
    paramsMap[p.id] = p.value;
  });

  // 1. IMPULSE SIGNAL TEST (10,000 samples)
  // Evaluates decay, ringing stability, and infinity blows
  const impulseState: any = {};
  const impulseMetrics = runSignalSimulation(
    10000,
    (idx) => (idx === 0 ? 1.0 : 0.0),
    dspFunc,
    paramsMap,
    impulseState
  );

  // 2. LOW-FREQUENCY SINE SWEEP INPUT (22050 samples = 0.5s)
  // Evaluates harmonic response, gain overflow & clipping ratio
  const staticSweepState: any = {};
  const lowSweepMetrics = runSignalSimulation(
    22050,
    (idx) => {
      const t = idx / sampleRate;
      // Frequency sweeping from 20Hz to 150Hz over 0.5 seconds
      const freq = 20.0 + (150.0 - 20.0) * (idx / 22050);
      return Math.sin(2.0 * Math.PI * freq * t) * 0.85;
    },
    dspFunc,
    paramsMap,
    staticSweepState
  );

  // 3. EXTREME FEEDBACK EXCITATION TEST (15000 samples)
  // Feeds high-volume noise bursts to test stability ceiling
  const feedbackState: any = {};
  const feedbackMetrics = runSignalSimulation(
    15000,
    (idx) => {
      if (idx % 2000 < 50) return (Math.random() - 0.5) * 1.5; // high spikes
      return 0.0;
    },
    dspFunc,
    paramsMap,
    feedbackState
  );

  // Compute Overall Status
  let status: "PRISTINE" | "WARNING" | "CRITICAL" = "PRISTINE";
  let unstableTonesDetected = false;
  let dcAccumulatorRisk = false;
  let clippingSevereRisk = false;

  // Stability thresholds
  if (!impulseMetrics.isStable || !lowSweepMetrics.isStable || !feedbackMetrics.isStable) {
    status = "CRITICAL";
    unstableTonesDetected = true;
  }
  if (lowSweepMetrics.dcOffset > 0.15 || impulseMetrics.dcOffset > 0.05) {
    dcAccumulatorRisk = true;
    if (status !== "CRITICAL") status = "WARNING";
  }
  if (lowSweepMetrics.clippingRatio > 0.1 || feedbackMetrics.clippingRatio > 0.15) {
    clippingSevereRisk = true;
    if (status !== "CRITICAL") status = "WARNING";
  }

  // Generate Recommendations
  let rec = "";
  if (status === "PRISTINE") {
    rec = "All diagnostic pipelines cleared! Zero NaN triggers, high arithmetic precision, and negligible DC accumulation.";
  } else {
    const list: string[] = [];
    if (unstableTonesDetected) {
      list.push("Math Instability blowup. Apply custom clamping filters (Math.max/Math.min) or introduce dampening factors inside recursive variables.");
    }
    if (dcAccumulatorRisk) {
      list.push("Significant DC Offset Detected. Integrate a 1-pole high-pass block: y = x - x_prev + 0.995 * y_prev to zero out cumulative bias.");
    }
    if (clippingSevereRisk) {
      list.push("Over-excitation clipping. Decrease core signal gain or introduce dynamic soft saturators like Math.tanh to compress peak transients.");
    }
    rec = "Diagnostics Warnings raised: " + list.join(" | ");
  }

  return {
    timestamp: new Date().toLocaleTimeString(),
    overallHealthStatus: status,
    unstableTonesDetected,
    dcAccumulatorRisk,
    clippingSevereRisk,
    testSignals: {
      impulse: impulseMetrics,
      lowFrequencySweep: lowSweepMetrics,
      extremeFeedback: feedbackMetrics,
    },
    recommedSummary: rec,
  };
}

function runSignalSimulation(
  length: number,
  inputGen: (index: number) => number,
  dspFunc: (input: number, params: any, state: any) => number,
  params: any,
  state: any
): SignalMetrics {
  let maxAmp = 0.0;
  let dcSum = 0.0;
  let clipCount = 0;
  let hasNaN = false;
  let isStable = true;

  for (let s = 0; s < length; s++) {
    const inVal = inputGen(s);
    let outVal = 0.0;

    try {
      outVal = dspFunc(inVal, params, state);
    } catch {
      hasNaN = true;
      isStable = false;
      break;
    }

    if (Number.isNaN(outVal) || !Number.isFinite(outVal)) {
      hasNaN = true;
      isStable = false;
      break;
    }

    // Capture instability
    const outAbs = Math.abs(outVal);
    if (outAbs > 5.0) {
      isStable = false; // Blowup limit
    }

    if (outAbs > maxAmp) {
      maxAmp = outAbs;
    }

    dcSum += outVal;

    // Detect hard clips
    if (outVal >= 0.999 || outVal <= -0.999) {
      clipCount++;
    }
  }

  return {
    maxAmplitude: parseFloat(maxAmp.toFixed(3)),
    dcOffset: parseFloat((dcSum / length).toFixed(4)),
    clippingSamples: clipCount,
    totalSamples: length,
    clippingRatio: parseFloat((clipCount / length).toFixed(4)),
    isStable,
    hasNaN,
  };
}

function createEmptyMetrics(): SignalMetrics {
  return {
    maxAmplitude: 0,
    dcOffset: 0,
    clippingSamples: 0,
    totalSamples: 0,
    clippingRatio: 0,
    isStable: true,
    hasNaN: false,
  };
}
