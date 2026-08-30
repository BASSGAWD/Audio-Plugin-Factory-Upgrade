import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateLatencyRun, LATENCY_POLICY, type NativeLatencyResult } from "./desktopLatencyPolicy";
import { signLatencyReport } from "./desktopLatencySignature";

const executable = process.env.ORANGEJUCE_STUDIO_BIN;
if (!executable || !fs.existsSync(executable)) {
  console.error("ORANGEJUCE_STUDIO_BIN must name a locally built executable. No synthetic latency result was emitted.");
  process.exit(2);
}
const separator = process.argv.indexOf("--");
const args = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);

function value(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

const projectDirectory = value("--project");
const deviceType = value("--device-type");
const device = value("--device");
const sampleRate = Number(value("--sample-rate"));
const blockSize = Number(value("--block-size"));
const seconds = Number(value("--seconds") || 60);
const output = value("--output");
const signingKey = value("--signing-key");

if (!projectDirectory || !deviceType || !device || !output || !signingKey
    || !Number.isFinite(sampleRate) || !Number.isInteger(blockSize) || !Number.isInteger(seconds)) {
  console.error("Latency benchmark requires --project, --device-type, --device, --sample-rate, --block-size, --output, and --signing-key.");
  process.exit(2);
}
if (!fs.statSync(projectDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Latency benchmark project directory does not exist: ${projectDirectory}`);
  process.exit(2);
}
if (!LATENCY_POLICY.allowedBlockSizes.includes(blockSize as 64 | 128)) {
  console.error(`Published low-latency evidence requires block size ${LATENCY_POLICY.allowedBlockSizes.join(" or ")}.`);
  process.exit(2);
}
if (!LATENCY_POLICY.allowedSampleRates.includes(sampleRate as 48_000)) {
  console.error(`Published low-latency evidence requires sample rate ${LATENCY_POLICY.allowedSampleRates.join(" or ")}.`);
  process.exit(2);
}
if (seconds < LATENCY_POLICY.minimumSeconds) {
  console.error(`Published low-latency evidence requires at least ${LATENCY_POLICY.minimumSeconds} seconds.`);
  process.exit(2);
}

function bundleDigest(root: string): string {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  const hash = crypto.createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(root, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const run = spawnSync(executable, ["--latency-benchmark", ...args], { encoding: "utf8" });
if (run.status !== 0) {
  console.error(run.stderr || `latency benchmark exited ${run.status}`);
  process.exit(run.status ?? 1);
}
let result: NativeLatencyResult;
try {
  result = JSON.parse(run.stdout.trim()) as NativeLatencyResult;
} catch {
  console.error(`Native latency benchmark emitted invalid JSON: ${run.stdout}`);
  process.exit(2);
}
if (!(result.sampleRate > 0) || !(result.blockSize > 0) || !(result.callbacks > 0) || !result.device) {
  console.error("Native latency benchmark did not receive callbacks from an active audio device. No result was published.");
  process.exit(2);
}

const requested = { deviceType, device, sampleRate, blockSize, seconds };
const evaluation = evaluateLatencyRun(result, requested, process.platform);
const evidence = signLatencyReport({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidenceKind: "native-audio-device",
  host: {
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
  },
  project: {
    name: path.basename(projectDirectory),
    sha256: bundleDigest(projectDirectory),
  },
  executable: {
    name: path.basename(executable),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex"),
  },
  requested,
  thresholds: LATENCY_POLICY,
  ...evaluation,
}, fs.readFileSync(signingKey, "utf8"));
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
if (evaluation.status !== "pass") process.exit(1);