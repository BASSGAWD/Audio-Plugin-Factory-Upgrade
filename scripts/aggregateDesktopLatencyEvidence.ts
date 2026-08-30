import fs from "node:fs";
import path from "node:path";
import { evaluateLatencyRun, LATENCY_POLICY, NATIVE_LATENCY_FIELDS } from "./desktopLatencyPolicy";
import { verifyLatencyReport } from "./desktopLatencySignature";

const separator = process.argv.indexOf("--");
const args = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
};
const evidenceDirectory = value("--evidence");
const output = value("--output");
const publicKeyPath = value("--public-key");
const expectedExecutableEntries = args.flatMap((arg, index) =>
  arg === "--expected-executable" && args[index + 1] ? [args[index + 1].split("=", 2)] : []);
const expectedExecutables = Object.fromEntries(expectedExecutableEntries) as Record<string, string>;
if (!evidenceDirectory || !output || !publicKeyPath
    || !["win32", "darwin", "linux"].every(platform => /^[0-9a-f]{64}$/i.test(expectedExecutables[platform] || ""))) {
  console.error("Evidence aggregation requires --evidence, --output, --public-key, and win32/darwin/linux --expected-executable platform=sha256 values.");
  process.exit(2);
}
const publicKey = fs.readFileSync(publicKeyPath, "utf8");

const files: string[] = [];
const visit = (directory: string) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(absolute);
  }
};
visit(evidenceDirectory);
const evidence = files
  .map(file => ({ file, report: JSON.parse(fs.readFileSync(file, "utf8")) }))
  .filter(item => item.report?.schemaVersion === 1 && item.report?.evidenceKind === "native-audio-device");
if (evidence.length === 0) throw new Error("No native audio-device evidence reports found");
if (evidence.length !== 12) throw new Error(`Hardware proof requires exactly 12 signed reports; found ${evidence.length}`);

const expectedBackends = {
  win32: /\bASIO\b/i,
  darwin: /\bCoreAudio\b/i,
  linux: /\bALSA\b/i,
} as const;
const exactKeys = (value: unknown, expected: readonly string[], label: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields do not match the signed schema`);
  }
};
for (const { file, report } of evidence) {
  exactKeys(report, [
    "schemaVersion", "generatedAt", "evidenceKind", "host", "project", "executable",
    "requested", "thresholds", "status", "assertions", "measured", "attestation",
  ], `${file} report`);
  exactKeys(report.host, ["platform", "architecture", "release"], `${file} host`);
  exactKeys(report.project, ["name", "sha256"], `${file} project`);
  exactKeys(report.executable, ["name", "sha256"], `${file} executable`);
  exactKeys(report.requested, ["deviceType", "device", "sampleRate", "blockSize", "seconds"], `${file} request`);
  exactKeys(report.measured, [
    ...NATIVE_LATENCY_FIELDS, "inputLatencyMs", "outputLatencyMs", "roundTripLatencyMs",
    "callbackBudgetMs", "maxCallbackLoad",
  ], `${file} measurement`);
  exactKeys(report.attestation, ["algorithm", "publicKeySha256", "signature"], `${file} attestation`);
  if (!verifyLatencyReport(report, publicKey)) throw new Error(`${file} has an invalid evidence signature`);
  if (!Number.isFinite(Date.parse(report.generatedAt))) throw new Error(`${file} has an invalid generation time`);
  if (JSON.stringify(report.thresholds) !== JSON.stringify(LATENCY_POLICY)) {
    throw new Error(`${file} does not use the current latency policy`);
  }
  const platform = report.host?.platform as keyof typeof expectedBackends;
  const pattern = expectedBackends[platform];
  if (!pattern?.test(report.measured?.deviceType || "")) {
    throw new Error(`${file} does not use the required platform-native backend`);
  }
  if (!/^[0-9a-f]{64}$/i.test(report.project?.sha256 || "")
      || !/^[0-9a-f]{64}$/i.test(report.executable?.sha256 || "")) {
    throw new Error(`${file} is missing a valid project or executable SHA-256`);
  }
  if (report.executable.sha256.toLowerCase() !== expectedExecutables[platform].toLowerCase()) {
    throw new Error(`${file} executable does not match the declared release artifact`);
  }
  const nativeResult = Object.fromEntries(
    NATIVE_LATENCY_FIELDS.map(field => [field, report.measured[field]]),
  ) as Parameters<typeof evaluateLatencyRun>[0];
  const recomputed = evaluateLatencyRun(nativeResult, report.requested, platform);
  if (report.status !== "pass" || recomputed.status !== "pass") {
    throw new Error(`${file} did not pass the recomputed latency policy`);
  }
  if (JSON.stringify(report.assertions) !== JSON.stringify(recomputed.assertions)
      || JSON.stringify(report.measured) !== JSON.stringify(recomputed.measured)) {
    throw new Error(`${file} stored values do not match the recomputed latency evidence`);
  }
}

const projectHashes = [...new Set(evidence.map(item => item.report.project?.sha256).filter(Boolean))].sort();
if (projectHashes.length !== 2) throw new Error("Hardware proof requires exactly two declared portable project workloads");
for (const [platform, backend] of Object.entries(expectedBackends)) {
  const platformReports = evidence.filter(item => item.report.host?.platform === platform);
  const setups = new Set(platformReports.map(item => JSON.stringify({
    deviceType: item.report.measured.deviceType,
    device: item.report.measured.device,
    sampleRate: item.report.measured.sampleRate,
    executable: item.report.executable.sha256,
  })));
  if (setups.size !== 1) throw new Error(`${platform} evidence must use one consistent device, rate, and executable`);
  for (const blockSize of LATENCY_POLICY.allowedBlockSizes) {
    for (const projectHash of projectHashes) {
      const match = evidence.find(item =>
        item.report.host?.platform === platform
        && item.report.measured?.blockSize === blockSize
        && item.report.project?.sha256 === projectHash
        && backend.test(item.report.measured?.deviceType || ""));
      if (!match) throw new Error(`Missing ${platform} block ${blockSize} evidence for project ${projectHash}`);
    }
  }
}

const summary = {
  schemaVersion: 1,
  evidenceKind: "cross-platform-native-latency-suite",
  generatedAt: new Date().toISOString(),
  status: "pass",
  requiredPlatforms: Object.keys(expectedBackends),
  requiredBlockSizes: LATENCY_POLICY.allowedBlockSizes,
  projectHashes,
  thresholds: LATENCY_POLICY,
  reports: evidence
    .map(({ file, report }) => ({
      file: path.relative(evidenceDirectory, file),
      platform: report.host.platform,
      architecture: report.host.architecture,
      project: report.project,
      executable: report.executable,
      measured: report.measured,
    }))
    .sort((a, b) => a.file.localeCompare(b.file)),
};
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Validated ${summary.reports.length} hardware runs across ASIO, CoreAudio, and ALSA`);