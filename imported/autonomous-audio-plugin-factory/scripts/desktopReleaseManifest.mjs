import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function values(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key || "end of input"}`);
    const name = key.slice(2);
    parsed.set(name, [...(parsed.get(name) || []), value]);
  }
  return parsed;
}

function one(args, name, required = true) {
  const result = args.get(name)?.at(-1);
  if (required && !result) throw new Error(`--${name} is required`);
  return result;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function commit() {
  return process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function parseSmoke(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  if (result.suite !== "desktop-golden-native" || result.roundtrip !== true || result.unsupportedPluginRejected !== true) {
    throw new Error(`Smoke report ${file} does not prove native render, open/save roundtrip, and rejection safety`);
  }
  return result;
}

function filesRecursively(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesRecursively(file) : [file];
  });
}

function writePlatformMetadata(args) {
  const artifacts = args.get("artifact") || [];
  if (!artifacts.length) throw new Error("At least one --artifact is required");
  artifacts.forEach(file => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Release artifact does not exist: ${file}`);
  });
  const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (!Number.isInteger(sourceDateEpoch) || sourceDateEpoch <= 0) throw new Error("SOURCE_DATE_EPOCH must be a positive Git commit timestamp");
  const metadata = {
    schemaVersion: 1,
    product: "OrangeJUCE Studio",
    version: one(args, "version"),
    platform: one(args, "platform"),
    architecture: one(args, "architecture"),
    signed: one(args, "signed") === "true",
    source: {
      commit: commit(),
      sourceDateEpoch,
      juce: "7.0.12",
      cmakeProject: "OrangeJUCEStudio",
    },
    build: {
      githubRunId: process.env.GITHUB_RUN_ID || null,
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      runner: process.env.RUNNER_OS || process.platform,
      tools: args.get("toolchain") || [],
    },
    smoke: (args.get("smoke") || []).map(parseSmoke),
    artifacts: artifacts.map(file => ({
      name: path.basename(file),
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
    })),
  };
  const output = one(args, "output");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}

function aggregate(args) {
  const root = one(args, "aggregate");
  const files = filesRecursively(root);
  const metadataFiles = files.filter(file => file.endsWith(".metadata.json"));
  const platforms = metadataFiles.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
  for (const required of ["windows", "macos", "linux"]) {
    if (!platforms.some(item => item.platform === required)) throw new Error(`Missing ${required} release metadata`);
  }
  for (const item of platforms.filter(item => item.platform === "windows" || item.platform === "macos")) {
    if (item.signed !== true) throw new Error(`${item.platform} release is not signed`);
  }
  const releaseFiles = files.filter(file => /\.(dmg|exe|deb|tar\.gz)$/i.test(file));
  const releaseByName = new Map(releaseFiles.map(file => [path.basename(file), file]));
  for (const item of platforms) {
    if (item.version !== one(args, "version")) throw new Error(`${item.platform} metadata version does not match the release`);
    if (!Array.isArray(item.smoke) || item.smoke.length < 1) throw new Error(`${item.platform} metadata has no packaged smoke evidence`);
    for (const artifact of item.artifacts || []) {
      const file = releaseByName.get(artifact.name);
      if (!file) throw new Error(`Metadata references missing artifact ${artifact.name}`);
      if (artifact.sha256 !== sha256(file) || artifact.bytes !== fs.statSync(file).size) {
        throw new Error(`Metadata does not match artifact ${artifact.name}`);
      }
    }
  }
  const checksums = releaseFiles
    .map(file => `${sha256(file)}  ${path.basename(file)}`)
    .sort()
    .join("\n");
  const checksumOutput = one(args, "checksums");
  const manifestOutput = one(args, "output");
  fs.mkdirSync(path.dirname(checksumOutput), { recursive: true });
  fs.mkdirSync(path.dirname(manifestOutput), { recursive: true });
  fs.writeFileSync(checksumOutput, `${checksums}\n`);
  fs.writeFileSync(manifestOutput, `${JSON.stringify({
    schemaVersion: 1,
    product: "OrangeJUCE Studio",
    version: one(args, "version"),
    sourceCommit: commit(),
    generatedFromSourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH),
    platforms,
  }, null, 2)}\n`);
  console.log(`Aggregated ${releaseFiles.length} release artifacts`);
}

const args = values(process.argv.slice(2));
if (args.has("aggregate")) aggregate(args);
else writePlatformMetadata(args);