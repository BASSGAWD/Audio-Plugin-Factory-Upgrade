export const LATENCY_POLICY = Object.freeze({
  minimumSeconds: 60,
  allowedBlockSizes: [64, 128] as const,
  allowedSampleRates: [48_000] as const,
  maximumRoundTripLatencyMs: 15,
  maximumCallbackLoad: 0.8,
  minimumCallbackCoverage: 0.8,
  maximumDeadlineMisses: 0,
  maximumCallbackArrivalMisses: 0,
  maximumDriverXruns: 0,
  maximumIrregularBlocks: 0,
});

export type NativeLatencyResult = {
  deviceType: string;
  device: string;
  sampleRate: number;
  blockSize: number;
  inputLatencySamples: number;
  outputLatencySamples: number;
  callbacks: number;
  deadlineMisses: number;
  irregularBlocks: number;
  maxCallbackMs: number;
  callbackArrivalMisses: number;
  maxCallbackGapMs: number;
  driverXruns: number;
  requestedSeconds: number;
  elapsedSeconds: number;
};

export type RequestedLatencyRun = {
  deviceType: string;
  device: string;
  sampleRate: number;
  blockSize: number;
  seconds: number;
};

export type LatencyAssertion = {
  id: string;
  pass: boolean;
  expected: string | number;
  actual: string | number;
};

const EXPECTED_BACKEND: Partial<Record<NodeJS.Platform, RegExp>> = {
  win32: /\bASIO\b/i,
  darwin: /\bCoreAudio\b/i,
  linux: /\bALSA\b/i,
};

function finiteNumber(result: NativeLatencyResult, key: keyof NativeLatencyResult): number {
  const value = result[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Native latency result has invalid ${key}`);
  }
  return value;
}

export const NATIVE_LATENCY_FIELDS = [
  "deviceType", "device", "sampleRate", "blockSize", "inputLatencySamples",
  "outputLatencySamples", "callbacks", "deadlineMisses", "irregularBlocks",
  "maxCallbackMs", "callbackArrivalMisses", "maxCallbackGapMs", "driverXruns",
  "requestedSeconds", "elapsedSeconds",
] as const;

function validateNativeResult(result: NativeLatencyResult) {
  for (const key of NATIVE_LATENCY_FIELDS.filter(key => key !== "deviceType" && key !== "device")) {
    finiteNumber(result, key);
  }
  if (!result.device || !result.deviceType) throw new Error("Native latency result has no device identity");
  for (const key of [
    "blockSize", "inputLatencySamples", "outputLatencySamples", "callbacks",
    "deadlineMisses", "irregularBlocks", "callbackArrivalMisses", "driverXruns",
    "requestedSeconds",
  ] as const) {
    if (!Number.isInteger(result[key])) throw new Error(`Native latency result ${key} must be an integer`);
  }
  for (const key of [
    "inputLatencySamples", "outputLatencySamples", "callbacks", "deadlineMisses",
    "irregularBlocks", "maxCallbackMs", "callbackArrivalMisses", "maxCallbackGapMs",
  ] as const) {
    if (result[key] < 0) throw new Error(`Native latency result ${key} cannot be negative`);
  }
  if (result.sampleRate <= 0 || result.blockSize <= 0 || result.callbacks <= 0
      || result.requestedSeconds <= 0 || result.elapsedSeconds <= 0) {
    throw new Error("Native latency result rate, block size, callbacks, and durations must be positive");
  }
  if (result.driverXruns < -1) throw new Error("Native latency result driverXruns cannot be less than -1");
}

export function evaluateLatencyRun(
  result: NativeLatencyResult,
  requested: RequestedLatencyRun,
  platform: NodeJS.Platform,
) {
  validateNativeResult(result);

  const inputLatencyMs = result.inputLatencySamples * 1000 / result.sampleRate;
  const outputLatencyMs = result.outputLatencySamples * 1000 / result.sampleRate;
  const roundTripLatencyMs = inputLatencyMs + outputLatencyMs;
  const callbackBudgetMs = result.blockSize * 1000 / result.sampleRate;
  const maxCallbackLoad = result.maxCallbackMs / callbackBudgetMs;
  const expectedCallbacks = result.elapsedSeconds * result.sampleRate / result.blockSize;
  const backendPattern = EXPECTED_BACKEND[platform];
  const assertions: LatencyAssertion[] = [
    {
      id: "platform-backend",
      pass: Boolean(backendPattern?.test(result.deviceType)),
      expected: backendPattern?.source || "supported native backend",
      actual: result.deviceType,
    },
    {
      id: "requested-device-type",
      pass: result.deviceType.toLocaleLowerCase() === requested.deviceType.toLocaleLowerCase(),
      expected: requested.deviceType,
      actual: result.deviceType,
    },
    {
      id: "requested-device",
      pass: result.device.toLocaleLowerCase() === requested.device.toLocaleLowerCase(),
      expected: requested.device,
      actual: result.device,
    },
    {
      id: "requested-sample-rate",
      pass: result.sampleRate === requested.sampleRate
        && LATENCY_POLICY.allowedSampleRates.includes(result.sampleRate as 48_000),
      expected: requested.sampleRate,
      actual: result.sampleRate,
    },
    {
      id: "requested-block-size",
      pass: result.blockSize === requested.blockSize
        && LATENCY_POLICY.allowedBlockSizes.includes(result.blockSize as 64 | 128),
      expected: requested.blockSize,
      actual: result.blockSize,
    },
    {
      id: "minimum-duration",
      pass: result.elapsedSeconds >= LATENCY_POLICY.minimumSeconds
        && result.requestedSeconds === requested.seconds,
      expected: LATENCY_POLICY.minimumSeconds,
      actual: result.elapsedSeconds,
    },
    {
      id: "round-trip-latency",
      pass: roundTripLatencyMs <= LATENCY_POLICY.maximumRoundTripLatencyMs,
      expected: LATENCY_POLICY.maximumRoundTripLatencyMs,
      actual: roundTripLatencyMs,
    },
    {
      id: "callback-coverage",
      pass: result.callbacks >= expectedCallbacks * LATENCY_POLICY.minimumCallbackCoverage,
      expected: Math.floor(expectedCallbacks * LATENCY_POLICY.minimumCallbackCoverage),
      actual: result.callbacks,
    },
    {
      id: "callback-headroom",
      pass: maxCallbackLoad <= LATENCY_POLICY.maximumCallbackLoad,
      expected: LATENCY_POLICY.maximumCallbackLoad,
      actual: maxCallbackLoad,
    },
    {
      id: "deadline-misses",
      pass: result.deadlineMisses <= LATENCY_POLICY.maximumDeadlineMisses,
      expected: LATENCY_POLICY.maximumDeadlineMisses,
      actual: result.deadlineMisses,
    },
    {
      id: "callback-arrival-misses",
      pass: result.callbackArrivalMisses <= LATENCY_POLICY.maximumCallbackArrivalMisses,
      expected: LATENCY_POLICY.maximumCallbackArrivalMisses,
      actual: result.callbackArrivalMisses,
    },
    {
      id: "driver-xruns",
      pass: result.driverXruns >= 0 && result.driverXruns <= LATENCY_POLICY.maximumDriverXruns,
      expected: LATENCY_POLICY.maximumDriverXruns,
      actual: result.driverXruns,
    },
    {
      id: "irregular-blocks",
      pass: result.irregularBlocks <= LATENCY_POLICY.maximumIrregularBlocks,
      expected: LATENCY_POLICY.maximumIrregularBlocks,
      actual: result.irregularBlocks,
    },
  ];

  return {
    status: assertions.every(assertion => assertion.pass) ? "pass" as const : "fail" as const,
    assertions,
    measured: {
      ...result,
      inputLatencyMs,
      outputLatencyMs,
      roundTripLatencyMs,
      callbackBudgetMs,
      maxCallbackLoad,
    },
  };
}