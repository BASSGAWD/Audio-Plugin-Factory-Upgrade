import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateLatencyRun, LATENCY_POLICY, type NativeLatencyResult } from "../scripts/desktopLatencyPolicy";
import { signLatencyReport, verifyLatencyReport } from "../scripts/desktopLatencySignature";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const aggregator = fs.readFileSync(path.join(root, "scripts/aggregateDesktopLatencyEvidence.ts"), "utf8");
const native = fs.readFileSync(path.join(root, "desktop/Source/Main.cpp"), "utf8");
const cmake = fs.readFileSync(path.join(root, "desktop/CMakeLists.txt"), "utf8");

const requested = {
  deviceType: "ASIO",
  device: "Reference Interface",
  sampleRate: 48_000,
  blockSize: 64,
  seconds: 60,
};
const passing: NativeLatencyResult = {
  deviceType: "ASIO",
  device: "Reference Interface",
  sampleRate: 48_000,
  blockSize: 64,
  inputLatencySamples: 128,
  outputLatencySamples: 128,
  callbacks: 45_000,
  deadlineMisses: 0,
  irregularBlocks: 0,
  maxCallbackMs: 0.5,
  callbackArrivalMisses: 0,
  maxCallbackGapMs: 4 / 3,
  driverXruns: 0,
  requestedSeconds: 60,
  elapsedSeconds: 60,
};

const pass = evaluateLatencyRun(passing, requested, "win32");
assert.equal(pass.status, "pass");
assert.equal(pass.measured.roundTripLatencyMs, 16 / 3);
assert.equal(LATENCY_POLICY.maximumRoundTripLatencyMs, 15);
assert.deepEqual(LATENCY_POLICY.allowedSampleRates, [48_000]);

for (const [key, value] of [
  ["driverXruns", 1],
  ["deadlineMisses", 1],
  ["callbackArrivalMisses", 1],
  ["maxCallbackMs", 1.2],
  ["blockSize", 256],
] as const) {
  const failed = evaluateLatencyRun({ ...passing, [key]: value }, requested, "win32");
  assert.equal(failed.status, "fail", `${key} must fail closed`);
}
assert.equal(evaluateLatencyRun({ ...passing, driverXruns: -1 }, requested, "win32").status, "fail");
assert.equal(evaluateLatencyRun({ ...passing, deviceType: "WASAPI" }, requested, "win32").status, "fail");
for (const key of ["inputLatencySamples", "deadlineMisses", "irregularBlocks", "maxCallbackMs"] as const) {
  assert.throws(() => evaluateLatencyRun({ ...passing, [key]: -1 }, requested, "win32"), /cannot be negative/);
}

assert.match(native, /setCurrentAudioDeviceType/);
assert.match(native, /setAudioDeviceSetup/);
assert.match(native, /--list-audio-devices/);
assert.match(native, /getDeviceNames \(true\)/);
assert.match(native, /startTimer \(100\)/);
assert.match(native, /elapsedSeconds < static_cast<double> \(duration\)/);
assert.match(native, /initialDriverXruns/);
assert.match(native, /maxCallbackNanoseconds/);
assert.match(aggregator, /projectHashes\.length !== 2/);
assert.match(aggregator, /allowedBlockSizes/);
assert.match(aggregator, /win32: \/\\bASIO/);
assert.match(aggregator, /darwin: \/\\bCoreAudio/);
assert.match(aggregator, /linux: \/\\bALSA/);
assert.match(cmake, /ORANGEJUCE_ENABLE_ASIO/);
assert.match(cmake, /target_compile_definitions\(OrangeJUCEStudio PRIVATE JUCE_ASIO=1\)/);
assert.match(cmake, /requires a complete, separately licensed ASIO SDK/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "orangejuce-latency-policy-test-"));
try {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyPath = path.join(temp, "collector-public.pem");
  fs.writeFileSync(publicKeyPath, publicPem);
  const backends = { win32: "ASIO", darwin: "CoreAudio", linux: "ALSA" };
  const executableHashes = { win32: "c".repeat(64), darwin: "d".repeat(64), linux: "e".repeat(64) };
  for (const [platform, deviceType] of Object.entries(backends)) {
    for (const blockSize of LATENCY_POLICY.allowedBlockSizes) {
      for (const projectHash of ["a".repeat(64), "b".repeat(64)]) {
        const runRequested = { ...requested, deviceType, blockSize };
        const evaluated = evaluateLatencyRun({ ...passing, deviceType, blockSize }, runRequested, platform as NodeJS.Platform);
        const report = signLatencyReport({
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          evidenceKind: "native-audio-device",
          host: { platform, architecture: "test", release: "test" },
          project: { name: `${projectHash.slice(0, 1)}.ojdaw`, sha256: projectHash },
          executable: { name: "OrangeJUCE Studio", sha256: executableHashes[platform as keyof typeof executableHashes] },
          requested: runRequested,
          thresholds: LATENCY_POLICY,
          ...evaluated,
        }, privatePem);
        assert.equal(verifyLatencyReport(report, publicPem), true);
        fs.writeFileSync(path.join(temp, `${platform}-${blockSize}-${projectHash.slice(0, 1)}.json`), JSON.stringify(report));
      }
    }
  }
  const aggregateScript = path.join(root, "scripts/aggregateDesktopLatencyEvidence.ts");
  const output = path.join(temp, "summary", "results.json");
  const aggregateArgs = [
    "--import", "tsx", aggregateScript, "--evidence", temp, "--output", output,
    "--public-key", publicKeyPath,
    ...Object.entries(executableHashes).flatMap(([platform, hash]) =>
      ["--expected-executable", `${platform}=${hash}`]),
  ];
  const complete = spawnSync(process.execPath,
    aggregateArgs,
    { encoding: "utf8" });
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).reports.length, 12);

  const missingPath = path.join(temp, "linux-128-b.json");
  const missingReport = fs.readFileSync(missingPath, "utf8");
  fs.rmSync(missingPath);
  const incomplete = spawnSync(process.execPath,
    aggregateArgs,
    { encoding: "utf8" });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /requires exactly 12 signed reports; found 11/);

  fs.writeFileSync(missingPath, missingReport);
  const tampered = JSON.parse(fs.readFileSync(missingPath, "utf8"));
  tampered.measured.deadlineMisses = -1;
  fs.writeFileSync(missingPath, JSON.stringify(tampered));
  const badSignature = spawnSync(process.execPath,
    aggregateArgs,
    { encoding: "utf8" });
  assert.notEqual(badSignature.status, 0);
  assert.match(badSignature.stderr, /invalid evidence signature/);

  fs.writeFileSync(missingPath, JSON.stringify(signLatencyReport(tampered, privatePem)));
  const signedInvalid = spawnSync(process.execPath,
    aggregateArgs,
    { encoding: "utf8" });
  assert.notEqual(signedInvalid.status, 0);
  assert.match(signedInvalid.stderr, /deadlineMisses cannot be negative/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("desktop latency evidence: explicit devices, strict thresholds, and cross-platform suite contract pass");