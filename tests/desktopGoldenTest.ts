import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bounceProject, createPortableProjectBundle, openPortableProjectBundle,
  readPortableProjectBundle, writePortableProjectBundle,
  type DecodedAudio, type PluginProcessor,
} from "../src/daw";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixtures/desktop-v3-golden.json"), "utf8"));
const project = fixture.project;
function monoPcm16Wav(samples: number[], sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((character, index) => { bytes[offset + index] = character.charCodeAt(0); });
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true));
  return bytes;
}
const blobs = new Map<string, Blob>(
  project.assets.map((asset: { id: string }): [string, Blob] => [asset.id, new Blob([monoPcm16Wav(fixture.audio[asset.id], 4)], { type: "audio/wav" })]),
);
const bundle = createPortableProjectBundle(project, blobs);
assert.deepEqual([...bundle.files.keys()].sort(), ["assets/source-audio.wav", "assets/target-audio.wav", "project.json"]);
const reopened = await openPortableProjectBundle(bundle.files);
assert.deepEqual(reopened.project, project, "portable bundle preserves canonical DawProject v3 JSON");

type MemoryDirectory = {
  files: Map<string, Blob>;
  directories: Map<string, MemoryDirectory>;
  handle: FileSystemDirectoryHandle;
};
function memoryDirectory(name: string): MemoryDirectory {
  const value = { files: new Map<string, Blob>(), directories: new Map<string, MemoryDirectory>() } as MemoryDirectory;
  value.handle = {
    name,
    kind: "directory",
    getDirectoryHandle: async (child: string, options?: { create?: boolean }) => {
      let directory = value.directories.get(child);
      if (!directory && options?.create) {
        directory = memoryDirectory(child);
        value.directories.set(child, directory);
      }
      if (!directory) throw new DOMException("Not found", "NotFoundError");
      return directory.handle;
    },
    getFileHandle: async (file: string, options?: { create?: boolean }) => {
      if (!value.files.has(file) && !options?.create) throw new DOMException("Not found", "NotFoundError");
      return {
        name: file,
        kind: "file",
        getFile: async () => value.files.get(file)! as File,
        createWritable: async () => ({
          write: async (data: Blob) => { value.files.set(file, data); },
          close: async () => undefined,
          abort: async () => undefined,
        }),
      } as unknown as FileSystemFileHandle;
    },
  } as FileSystemDirectoryHandle;
  return value;
}
const memory = memoryDirectory("session.ojdaw");
await writePortableProjectBundle(memory.handle, bundle);
const reopenedDirectory = await readPortableProjectBundle(memory.handle);
assert.deepEqual(reopenedDirectory.project, project, "directory helpers preserve canonical JSON");
assert.deepEqual([...reopenedDirectory.files.keys()].sort(), [...bundle.files.keys()].sort());

const processor: PluginProcessor = (instance, left, right, sidechain) => {
  if (instance.pluginId === "generated.gain/v1") {
    const gain = instance.parameters.gain;
    return [left * gain, right * gain];
  }
  if (instance.pluginId === "generated.ducker/v1") {
    const gain = 1 - Math.min(Math.abs(sidechain), 1) * instance.parameters.mix;
    return [left * gain, right * gain];
  }
  return [left, right];
};
const result = await bounceProject(project, async (id): Promise<DecodedAudio> => {
  const samples = Float32Array.from(fixture.audio[id]);
  return { sampleRate: 4, frames: samples.length, duration: samples.length / 4, channels: [samples] };
}, { sampleRate: 4 }, processor);

const expected: number[] = fixture.expected;
const errors = expected.map((sample, index) => result.channels[0][index] - sample);
const maxAbsolute = Math.max(...errors.map(Math.abs));
const rms = Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
assert(maxAbsolute <= fixture.tolerance.maxAbsolute, `reference max abs error ${maxAbsolute}`);
assert(rms <= fixture.tolerance.rms, `reference RMS error ${rms}`);
assert.deepEqual([...result.channels[0]], [...result.channels[1]], "golden render remains stereo symmetric");
console.log(JSON.stringify({ suite: "desktop-golden-reference", frames: expected.length, maxAbsolute, rms }));