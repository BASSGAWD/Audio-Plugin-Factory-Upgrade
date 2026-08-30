import assert from "node:assert/strict";
import {
  BrowserRecorder,
  EditHistory,
  addTrackEdit,
  bounceProject,
  buildAudioGraph,
  buildSchedule,
  createProject,
  createTrack,
  evaluateAutomation,
  migrateProject,
  moveClipEdit,
  recoverProjectCandidates,
  splitClip,
  type AutomationLane,
  type DecodedAudio,
} from "../src/daw";
import type { PluginRoutingContract } from "../src/types";

const project = createProject("Core test", "2025-01-01T00:00:00.000Z");
const track = createTrack("Audio 1", 0);
track.id = "track-1";
track.clips.push({
  id: "clip-1", assetId: "asset-1", name: "Tone", start: 1, offset: 0,
  duration: 1, loop: false, sourceDuration: 1, gain: 1, fadeIn: 0, fadeOut: 0,
});
const history = new EditHistory();
let edited = history.execute(project, addTrackEdit(track));
edited = history.execute(edited, moveClipEdit("track-1", "clip-1", 1.26, 0.25));
assert.equal(edited.tracks[0].clips[0].start, 1.25, "clip move snaps");
edited = history.undo(edited);
assert.equal(edited.tracks[0].clips[0].start, 1, "clip move is non-destructively undoable");
edited = history.redo(edited);
assert.equal(edited.tracks[0].clips[0].start, 1.25);
const halves = splitClip(edited.tracks[0].clips[0], 1.75);
assert.equal(halves[0].duration, 0.5);
assert.equal(halves[1].offset, 0.5);

const lane: AutomationLane = {
  id: "lane", enabled: true, defaultValue: 0, target: { kind: "track", ownerId: "track-1", parameterId: "gain" },
  points: [
    { id: "b", time: 1, value: 1, curve: "linear" },
    { id: "a", time: 0, value: 0, curve: "linear" },
  ],
};
assert.equal(evaluateAutomation(lane, 0.25), 0.25, "automation is sorted and interpolated deterministically");

edited.transport.metronome = true;
const schedule = buildSchedule(edited, 0, 3, 100);
assert(schedule.some((event) => event.kind === "clip-start" && event.sample === 125));
assert.deepEqual(schedule, buildSchedule(edited, 0, 3, 100), "schedule is deterministic");

const contract: PluginRoutingContract = {
  version: "1.0",
  mainInput: { channels: "mono-or-stereo", required: true },
  auxiliaryInput: { role: "sidechain", supported: true, required: false, channels: "mono-or-stereo" },
  detectorMode: "external-optional",
  disconnectedBehavior: "use-internal-detector",
  inputKeyArgument: true,
};
const destination = createTrack("Destination", 1);
destination.id = "track-2";
destination.inserts.push({ id: "compressor", pluginId: "plugin", name: "Compressor", enabled: true, parameters: {}, routing: contract });
edited.tracks.push(destination);
edited.routes.push({
  id: "route", sourceTrackId: "track-1", destinationTrackId: "track-2",
  pluginInstanceId: "compressor", enabled: true,
});
const graph = buildAudioGraph(edited);
assert.equal(graph.warnings.length, 0);
assert(graph.edges.some((edge) => edge.kind === "sidechain"), "shared sidechain contract creates graph edge");

const legacy = {
  ...createProject("Legacy"),
  version: 1,
  routes: undefined,
  automation: undefined,
  markers: undefined,
  audit: undefined,
  assets: undefined,
  buses: undefined,
};
const migrated = migrateProject(legacy);
assert.equal(migrated.version, 3);
assert.equal(migrated.buses[0].kind, "master");
assert.deepEqual(migrated.routes, []);
const savedCandidate = createProject("Saved");
savedCandidate.revision = 2;
const recoveryCandidate = structuredClone(savedCandidate);
recoveryCandidate.name = "Recovered";
recoveryCandidate.revision = 3;
assert.equal(recoverProjectCandidates(savedCandidate, recoveryCandidate).project?.name, "Recovered");
assert.equal(recoverProjectCandidates(savedCandidate, { revision: 4 }).project?.name, "Saved",
  "corrupt recovery journal falls back to valid saved project");

const bounceProjectFixture = createProject("Bounce");
const bounceTrack = createTrack("Tone", 0);
bounceTrack.pan = -1;
bounceTrack.clips.push({
  id: "bounce-clip", assetId: "tone", name: "Tone", start: 0, offset: 0,
  duration: 4 / 4, loop: false, sourceDuration: 1, gain: 1, fadeIn: 0, fadeOut: 0,
});
bounceProjectFixture.tracks.push(bounceTrack);
const tone: DecodedAudio = {
  sampleRate: 4, frames: 4, duration: 1,
  channels: [new Float32Array([0.25, -0.5, 0.75, -1])],
};
const first = await bounceProject(bounceProjectFixture, async () => tone, { sampleRate: 4 });
const second = await bounceProject(bounceProjectFixture, async () => tone, { sampleRate: 4 });
assert.deepEqual([...first.channels[0]], [...second.channels[0]], "offline render is deterministic");
assert.deepEqual([...new Uint8Array(await first.wav.arrayBuffer())], [...new Uint8Array(await second.wav.arrayBuffer())]);
assert.equal(first.wav.type, "audio/wav");
assert.equal(first.wav.size, 44 + 4 * 2 * 2);
assert.equal(first.channels[1].every((sample) => Math.abs(sample) < 1e-7), true, "constant-power hard-left pan");

const deniedDevices = {
  getUserMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); },
};
class UnusedRecorder {}
const recorder = new BrowserRecorder(deniedDevices as unknown as MediaDevices, UnusedRecorder as unknown as typeof MediaRecorder);
await assert.rejects(() => recorder.start(), (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "permission-denied");

console.log("dawCoreTest: all assertions passed");