import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import assert from "node:assert/strict";
import { openPortableProjectBundle, portableAssetPath } from "../src/daw/portableBundle";

const executable = process.env.ORANGEJUCE_STUDIO_BIN;
if (!executable || !fs.existsSync(executable)) {
  console.error("ORANGEJUCE_STUDIO_BIN must name a locally built OrangeJUCEStudio executable; native parity was not validated.");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../tests/fixtures/desktop-v3-golden.json");
const run = spawnSync(executable, ["--golden", fixturePath], { encoding: "utf8" });
if (run.status !== 0) {
  console.error(run.stderr || `native golden exited ${run.status}`);
  process.exit(run.status ?? 1);
}
const native = JSON.parse(run.stdout.trim());
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const expected: number[] = fixture.expected;
const errors = expected.map((sample, i) => Number(native.samples[i]) - sample);
const maxAbsolute = Math.max(...errors.map(Math.abs));
const rms = Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length);
if (maxAbsolute > fixture.tolerance.maxAbsolute || rms > fixture.tolerance.rms) {
  throw new Error(`native mismatch: max=${maxAbsolute}, rms=${rms}`);
}

// Mutation probe prevents a disconnected renderer or cached/hardcoded vector
// from satisfying the golden. Halving master gain must halve every sample.
const mutation = structuredClone(fixture);
mutation.project.buses.find((bus: { kind: string }) => bus.kind === "master").gain *= 0.5;
const mutationPath = path.join(os.tmpdir(), `orangejuce-native-probe-${process.pid}.json`);
fs.writeFileSync(mutationPath, JSON.stringify(mutation));
let mutatedRun;
try { mutatedRun = spawnSync(executable, ["--golden", mutationPath], { encoding: "utf8" }); }
finally { fs.rmSync(mutationPath, { force: true }); }
if (mutatedRun.status !== 0) throw new Error(mutatedRun.stderr || "native mutation probe failed");
const mutated = JSON.parse(mutatedRun.stdout.trim()).samples.map(Number);
const mutationError = Math.max(...expected.map((sample, i) => Math.abs(mutated[i] - sample * 0.5)));
if (mutationError > fixture.tolerance.maxAbsolute) {
  throw new Error(`native graph is disconnected from fixture project: mutation error=${mutationError}`);
}

// Exercise BundleDocument::open/save with a real directory bundle and real WAV
// bytes. The declared lengths are derived from those exact files.
function monoPcm16Wav(samples: number[], sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + index * 2));
  return wav;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orangejuce-roundtrip-"));
const inputBundle = path.join(tempRoot, "input.ojdaw");
const outputBundle = path.join(tempRoot, "output.ojdaw");
try {
  fs.mkdirSync(path.join(inputBundle, "assets"), { recursive: true });
  const roundtripProject = structuredClone(fixture.project);
  const sourceWav = monoPcm16Wav(fixture.audio["source-audio"], 4);
  const targetWav = monoPcm16Wav(fixture.audio["target-audio"], 4);
  const bytes = new Map<string, Buffer>([["source-audio", sourceWav], ["target-audio", targetWav]]);
  for (const asset of roundtripProject.assets) {
    const wav = bytes.get(asset.id)!;
    asset.byteLength = wav.byteLength;
    asset.name = `${asset.id}.wav`;
    fs.writeFileSync(path.join(inputBundle, portableAssetPath(asset)), wav);
  }
  fs.writeFileSync(path.join(inputBundle, "project.json"), `${JSON.stringify(roundtripProject, null, 2)}\n`);
  const roundtrip = spawnSync(executable, ["--roundtrip", inputBundle, outputBundle], { encoding: "utf8" });
  if (roundtrip.status !== 0) throw new Error(roundtrip.stderr || `native roundtrip exited ${roundtrip.status}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputBundle, "project.json"), "utf8")), roundtripProject);
  for (const asset of roundtripProject.assets) {
    const relative = portableAssetPath(asset);
    assert.deepEqual(fs.readFileSync(path.join(outputBundle, relative)), fs.readFileSync(path.join(inputBundle, relative)));
  }
  const portableFiles = new Map<string, Blob>([
    ["project.json", new Blob([fs.readFileSync(path.join(outputBundle, "project.json"))])],
    ...roundtripProject.assets.map((asset: { id: string; mimeType: string }) => {
      const relative = portableAssetPath(asset);
      return [relative, new Blob([fs.readFileSync(path.join(outputBundle, relative))])] as [string, Blob];
    }),
  ]);
  const reopened = await openPortableProjectBundle(portableFiles);
  assert.deepEqual(reopened.project, roundtripProject);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const unsupported = structuredClone(fixture);
unsupported.project.tracks[0].inserts[0].pluginId = "unversioned.fixture";
unsupported.project.tracks[0].inserts[0].name = "Unsafe fixture";
const unsupportedPath = path.join(os.tmpdir(), `orangejuce-unsupported-${process.pid}.json`);
fs.writeFileSync(unsupportedPath, JSON.stringify(unsupported));
let unsupportedRun;
try { unsupportedRun = spawnSync(executable, ["--golden", unsupportedPath], { encoding: "utf8" }); }
finally { fs.rmSync(unsupportedPath, { force: true }); }
assert.notEqual(unsupportedRun.status, 0, "enabled unsupported native plugin must fail load");
assert.match(unsupportedRun.stderr, /Unsupported enabled native plugin Unsafe fixture \(unversioned\.fixture\)/);

console.log(JSON.stringify({
  suite: "desktop-golden-native", frames: expected.length, maxAbsolute, rms,
  mutationProbeMaxAbsolute: mutationError, roundtrip: true, unsupportedPluginRejected: true,
}));