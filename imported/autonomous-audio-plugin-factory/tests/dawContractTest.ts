import assert from "node:assert/strict";
import {
  BrowserRecorder,
  EditHistory,
  addTrackEdit,
  bounceProject,
  buildAudioGraph,
  createProject,
  createTrack,
  deleteTrackEdit,
  evaluateAutomation,
  migrateProject,
  moveClipEdit,
  normalizeAutomation,
  recoverProjectCandidates,
  reorderTracksEdit,
  resolveBounceRange,
  setClipLoop,
  splitClip,
  trimClip,
  updateTrackEdit,
  validateSidechainRoute,
  RealtimeAudioEngine,
  type AutomationLane,
  type DawProject,
  type DecodedAudio,
  type SidechainRoute,
} from "../src/daw";
import type { PluginRoutingContract } from "../src/types";

const clip = {
  id: "clip-a", assetId: "asset-a", name: "Source", start: 1, offset: .25,
  duration: 2, loop: false, sourceDuration: 3, gain: 1, fadeIn: .1, fadeOut: .1,
};

// Domain edits remain immutable, reversible, snapped, and non-destructive.
const original = createProject("Edits", "2025-01-01T00:00:00.000Z");
const firstTrack = createTrack("Voice", 0, "#112233");
firstTrack.id = "voice";
firstTrack.clips = [clip];
const secondTrack = createTrack("Music", 1, "#445566");
secondTrack.id = "music";
const history = new EditHistory();
let edited = history.execute(original, addTrackEdit(firstTrack));
edited = history.execute(edited, addTrackEdit(secondTrack));
edited = history.execute(edited, updateTrackEdit("voice", {
  name: "Lead", color: "#abcdef", mute: true, solo: true, armed: true,
}));
assert.equal(original.tracks.length, 0, "editing does not mutate the source project");
assert.deepEqual(
  (({ name, color, mute, solo, armed }) => ({ name, color, mute, solo, armed }))(edited.tracks[0]),
  { name: "Lead", color: "#abcdef", mute: true, solo: true, armed: true },
);
edited = history.execute(edited, reorderTracksEdit(["music", "voice"]));
assert.deepEqual(edited.tracks.map((track) => track.id), ["music", "voice"]);
edited = history.execute(edited, moveClipEdit("voice", "clip-a", 1.37, .25));
assert.equal(edited.tracks[1].clips[0].start, 1.25, "clip move snaps to the supplied grid");
edited = history.undo(edited);
assert.equal(edited.tracks[1].clips[0].start, 1);
edited = history.redo(edited);
assert.equal(edited.tracks[1].clips[0].start, 1.25);
const [left, right] = splitClip(clip, 2);
assert.deepEqual([left.duration, right.start, right.offset, right.duration], [1, 2, 1.25, 1]);
assert.deepEqual(
  (({ start, offset, duration }) => ({ start, offset, duration }))(trimClip(clip, 1.5, 1)),
  { start: 1.5, offset: .75, duration: 1 },
);
assert.deepEqual(
  (({ loop, duration }) => ({ loop, duration }))(setClipLoop(clip, true, 6)),
  { loop: true, duration: 6 },
);
await assert.rejects(async () => history.execute(edited, reorderTracksEdit(["voice", "voice"])), /exactly once/);

// Removing a track also removes dangling routes and undo restores both.
const route: SidechainRoute = {
  id: "route-a", sourceTrackId: "voice", destinationTrackId: "music",
  pluginInstanceId: "compressor", enabled: true,
};
edited.routes = [route];
edited = history.execute(edited, deleteTrackEdit("voice"));
assert.equal(edited.routes.length, 0);
edited = history.undo(edited);
assert.equal(edited.routes[0].id, "route-a");

// Automation output is independent of input ordering and handles all curves.
const lane = (points: AutomationLane["points"]): AutomationLane => ({
  id: "gain", target: { kind: "track", ownerId: "voice", parameterId: "gain" },
  enabled: true, defaultValue: .2, points,
});
const points: AutomationLane["points"] = [
  { id: "c", time: 2, value: 1, curve: "linear" },
  { id: "a", time: 0, value: .25, curve: "linear" },
  { id: "b", time: 1, value: .5, curve: "exponential" },
];
for (const time of [-1, 0, .5, 1, 1.5, 2, 3]) {
  assert.equal(evaluateAutomation(lane(points), time), evaluateAutomation(lane([...points].reverse()), time));
}
assert.equal(evaluateAutomation(lane(points), .5), .375);
assert(Math.abs(evaluateAutomation(lane(points), 1.5) - Math.SQRT1_2) < 1e-12);
assert.deepEqual(
  normalizeAutomation(lane([...points, { id: "bad", time: -1, value: NaN, curve: "linear" }])).points.map((point) => point.id),
  ["a", "b", "c"],
);

const externalContract: PluginRoutingContract = {
  version: "1.0",
  mainInput: { channels: "mono-or-stereo", required: true },
  auxiliaryInput: { role: "sidechain", supported: true, required: false, channels: "mono-or-stereo" },
  detectorMode: "external-optional",
  disconnectedBehavior: "use-internal-detector",
  inputKeyArgument: true,
};
const routingProject = createProject("Routing");
const source = createTrack("Key", 0); source.id = "key";
const destination = createTrack("Bass", 1); destination.id = "bass";
destination.inserts = [{
  id: "compressor", pluginId: "plugin", name: "External compressor",
  enabled: true, parameters: {}, routing: externalContract,
}];
routingProject.tracks = [source, destination];
routingProject.routes = [{ id: "valid", sourceTrackId: "key", destinationTrackId: "bass", pluginInstanceId: "compressor", enabled: true }];
assert.deepEqual(validateSidechainRoute(routingProject, routingProject.routes[0]), []);
assert(buildAudioGraph(routingProject).edges.some((edge) => edge.kind === "sidechain"));
for (const [label, invalid, expected] of [
  ["self route", { ...routingProject.routes[0], sourceTrackId: "bass" }, /cannot sidechain itself/],
  ["missing source", { ...routingProject.routes[0], sourceTrackId: "missing" }, /source track does not exist/],
  ["missing plugin", { ...routingProject.routes[0], pluginInstanceId: "missing" }, /plugin does not exist/],
] as const) {
  assert.match(validateSidechainRoute(routingProject, invalid)[0], expected, label);
}
destination.inserts[0].routing = { ...externalContract, auxiliaryInput: { ...externalContract.auxiliaryInput, supported: false }, inputKeyArgument: false, detectorMode: "internal" };
assert.match(validateSidechainRoute(routingProject, routingProject.routes[0])[0], /does not implement/);

// Recording failures are classified so UI can present truthful remediation.
class NeverRecorder {}
for (const [name, code] of [
  ["NotAllowedError", "permission-denied"],
  ["SecurityError", "permission-denied"],
  ["NotFoundError", "no-device"],
  ["OverconstrainedError", "no-device"],
  ["AbortError", "capture-failed"],
] as const) {
  const recorder = new BrowserRecorder({
    getUserMedia: async () => { throw new DOMException("capture error", name); },
  } as Pick<MediaDevices, "getUserMedia">, NeverRecorder as unknown as typeof MediaRecorder);
  await assert.rejects(() => recorder.start(), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === code, `${name} maps to ${code}`);
}

// Migration/recovery always prefers the newest valid revision and rejects total corruption.
const saved = createProject("Saved"); saved.revision = 4;
const journal = structuredClone(saved); journal.name = "Journal"; journal.revision = 5;
assert.deepEqual(recoverProjectCandidates(saved, journal), {
  project: migrateProject(journal), recovered: true,
});
assert.equal(recoverProjectCandidates(saved, { revision: 6 }).project?.name, "Saved");
assert.throws(() => recoverProjectCandidates({ revision: 1 }, { revision: 2 }), /corrupted/);
assert.throws(() => migrateProject({ ...saved, version: 999 }), /newer than supported/);

// Offline WAV rendering is byte deterministic, applies automation/sidechain,
// reports clipping and progress, and emits a structurally valid PCM header.
const bounceFixture: DawProject = createProject("Deterministic bounce", "2025-01-01T00:00:00.000Z");
const main = createTrack("Main", 0); main.id = "main";
main.clips = [{ ...clip, id: "main-clip", assetId: "main-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
main.inserts = [{ id: "duck", pluginId: "duck", name: "Duck", enabled: true, parameters: {}, routing: externalContract }];
const key = createTrack("Key", 1); key.id = "bounce-key";
key.clips = [{ ...clip, id: "key-clip", assetId: "key-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
bounceFixture.tracks = [main, key];
bounceFixture.routes = [{ id: "bounce-route", sourceTrackId: key.id, destinationTrackId: main.id, pluginInstanceId: "duck", enabled: true }];
bounceFixture.automation = [lane([
  { id: "start", time: 0, value: 1, curve: "linear" },
  { id: "end", time: 1, value: 2, curve: "linear" },
])];
bounceFixture.automation[0].target.ownerId = main.id;
const audio = new Map<string, DecodedAudio>([
  ["main-audio", { sampleRate: 8, frames: 8, duration: 1, channels: [new Float32Array([.2, .4, .6, .8, 1, .8, .6, .4])] }],
  ["key-audio", { sampleRate: 8, frames: 8, duration: 1, channels: [new Float32Array([1, 0, 1, 0, 1, 0, 1, 0])] }],
]);
const render = () => {
  const progress: number[] = [];
  return bounceProject(
    bounceFixture,
    async (id) => audio.get(id)!,
    { sampleRate: 8, onProgress: (value) => progress.push(value) },
    (_plugin, leftSample, rightSample, sidechain) => [leftSample * (1 - sidechain * .5), rightSample * (1 - sidechain * .5)],
  ).then((result) => ({ result, progress }));
};
const first = await render();
const second = await render();
const firstBytes = new Uint8Array(await first.result.wav.arrayBuffer());
const secondBytes = new Uint8Array(await second.result.wav.arrayBuffer());
assert.deepEqual(firstBytes, secondBytes);
assert.deepEqual([...firstBytes.slice(0, 12)], [...Buffer.from("RIFF\0\0\0\0WAVE")].map((value, index) => index >= 4 && index <= 7 ? firstBytes[index] : value));
assert.equal(first.result.wav.type, "audio/wav");
assert.equal(first.result.wav.size, 44 + 8 * 2 * 2);
assert.equal(first.progress.at(-1), 1);
assert(first.result.clippedSamples > 0, "unclamped render data reports clipping before WAV encoding");
assert.notEqual(first.result.channels[0][0], first.result.channels[0][1], "automation and sidechain affect output samples");
const aborted = new AbortController(); aborted.abort();
await assert.rejects(() => bounceProject(bounceFixture, async (id) => audio.get(id)!, { sampleRate: 8, signal: aborted.signal }), (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError");

// The offline graph has deterministic sends/returns, bus processing and automation.
const graphBounce = createProject("Graph bounce", "2025-01-01T00:00:00.000Z");
const graphTrack = createTrack("Source", 0); graphTrack.id = "graph-track"; graphTrack.pan = -1;
graphTrack.clips = [{ ...clip, assetId: "graph-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
graphTrack.sends = [{ busId: "return-a", gain: .5, preFader: true }];
graphBounce.tracks = [graphTrack];
graphBounce.buses = [
  { id: "return-a", kind: "return", name: "Return", gain: 1, pan: -1, inserts: [] },
  { id: "master", kind: "master", name: "Master", gain: 1, pan: -1, inserts: [{ id: "master-fx", pluginId: "gain", name: "Gain", enabled: true, parameters: { amount: 1 } }] },
];
graphBounce.automation = [{
  id: "master-amount", target: { kind: "plugin", ownerId: "master-fx", parameterId: "amount" },
  enabled: true, defaultValue: 1, points: [{ id: "amount", time: 0, value: .5, curve: "step" }],
}];
assert.deepEqual(resolveBounceRange(graphBounce, { start: 0, end: 1 }), { start: 0, end: 1 });
assert.throws(() => resolveBounceRange(graphBounce, { start: 1, end: 1 }), /empty or invalid/);
const graphRender = await bounceProject(graphBounce, async () => ({
  sampleRate: 4, frames: 4, duration: 1, channels: [new Float32Array([1, 1, 1, 1])],
}), { sampleRate: 4, range: { start: 0, end: 1 }, tailSeconds: .5 }, (plugin, leftSample, rightSample) =>
  [leftSample * (plugin.parameters.amount ?? 1), rightSample]);
assert.equal(graphRender.channels[0][0], .75, "track main plus pre-fader return are processed by automated master insert");
assert.equal(graphRender.channels[1][0], 0, "hard-left pans are applied through track, return, and master stages");
assert.deepEqual(graphRender.contentRange, { start: 0, end: 1 });
assert.deepEqual(graphRender.range, { start: 0, end: 1.5 });
assert.equal(graphRender.channels[0].length, 6, "tail extends the frame count after selected content");

// Disabled track, bus, and plugin lanes must not override live mixer/plugin
// values during bounce; realtime uses the same enabled-lane semantics.
const disabledAutomation = createProject("Disabled automation");
const disabledTrack = createTrack("Source", 0);
disabledTrack.id = "disabled-track";
disabledTrack.gain = .5;
disabledTrack.clips = [{ ...clip, assetId: "disabled-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
disabledTrack.inserts = [{ id: "disabled-fx", pluginId: "gain", name: "Gain", enabled: true, parameters: { amount: .5 } }];
disabledAutomation.tracks = [disabledTrack];
disabledAutomation.buses = [{ id: "master", kind: "master", name: "Master", gain: .5, pan: 0, inserts: [] }];
disabledAutomation.automation = [
  { id: "disabled-track-gain", target: { kind: "track", ownerId: disabledTrack.id, parameterId: "gain" }, enabled: false, defaultValue: 0, points: [] },
  { id: "disabled-master-gain", target: { kind: "bus", ownerId: "master", parameterId: "gain" }, enabled: false, defaultValue: 0, points: [] },
  { id: "disabled-plugin-amount", target: { kind: "plugin", ownerId: "disabled-fx", parameterId: "amount" }, enabled: false, defaultValue: 0, points: [] },
];
const disabledRender = await bounceProject(disabledAutomation, async () => ({
  sampleRate: 2, frames: 2, duration: 1, channels: [new Float32Array([1, 1])],
}), { sampleRate: 2 }, (processor, leftSample, rightSample) => [
  leftSample * processor.parameters.amount,
  rightSample * processor.parameters.amount,
]);
assert.equal(disabledRender.channels[0][0], .125, "disabled track, bus, and plugin lanes preserve live values");
assert.equal(disabledRender.channels[1][0], .125, "disabled automation parity applies to both channels");

// A non-zero render origin evaluates plugin automation in project time, and the
// same processor receives the routed external-key samples and bus inserts.
const realtimeParity = createProject("Realtime parity");
const parityMain = createTrack("Main", 0); parityMain.id = "parity-main";
parityMain.clips = [{ ...clip, assetId: "parity-main-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
parityMain.inserts = [{ id: "parity-duck", pluginId: "generated", name: "Duck", enabled: true, parameters: { drive: 0 }, routing: externalContract }];
const parityKey = createTrack("Key", 1); parityKey.id = "parity-key";
parityKey.clips = [{ ...clip, assetId: "parity-key-audio", start: 0, offset: 0, duration: 1, sourceDuration: 1, fadeIn: 0, fadeOut: 0 }];
realtimeParity.tracks = [parityMain, parityKey];
realtimeParity.routes = [{ id: "parity-route", sourceTrackId: parityKey.id, destinationTrackId: parityMain.id, pluginInstanceId: "parity-duck", enabled: true }];
realtimeParity.automation = [{ id: "seek-drive", target: { kind: "plugin", ownerId: "parity-duck", parameterId: "drive" }, enabled: true, defaultValue: 0, points: [{ id: "zero", time: 0, value: 0, curve: "linear" }, { id: "one", time: 1, value: 1, curve: "linear" }] }];
const observed: Array<{ drive: number; key: number }> = [];
await bounceProject(realtimeParity, async (id) => ({
  sampleRate: 8, frames: 8, duration: 1,
  channels: [new Float32Array(id === "parity-key-audio" ? [1, 1, 1, 1, 1, 1, 1, 1] : [1, 1, 1, 1, 1, 1, 1, 1])],
}), { sampleRate: 8, range: { start: .5, end: .75 } }, (processor, leftSample, rightSample, sidechain) => {
  if (processor.id === "parity-duck") observed.push({ drive: processor.parameters.drive, key: sidechain });
  return [leftSample, rightSample];
});
assert.equal(observed[0].drive, .5, "non-zero seek starts plugin automation at project time");
assert(observed.some((sample) => sample.key > 0), "routed sidechain reaches the plugin processor");

// The realtime graph must finish decode before anchoring/scheduling sources,
// and looped source material must still obey the arrangement clip stop.
const sourceCalls: Array<{ start?: number; stop?: number }> = [];
class MockNode { connect() { return this; } disconnect() {} }
class MockParam { value = 0; setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class MockContext {
  currentTime = 0; sampleRate = 10; destination = new MockNode();
  async resume() {}
  async close() {}
  createGain() { const node = new MockNode() as MockNode & { gain: MockParam }; node.gain = new MockParam(); return node; }
  createStereoPanner() { const node = new MockNode() as MockNode & { pan: MockParam }; node.pan = new MockParam(); return node; }
  createAnalyser() { const node = new MockNode() as MockNode & { fftSize: number; getFloatTimeDomainData: (data: Float32Array) => void }; node.fftSize = 32; node.getFloatTimeDomainData = (data) => data.fill(0); return node; }
  createBuffer(_channels: number, _frames: number, _rate: number) { return { copyToChannel() {} }; }
  createBufferSource() { const call: { start?: number; stop?: number } = {}; sourceCalls.push(call); const node = new MockNode() as MockNode & { buffer: unknown; loop: boolean; start: (when: number) => void; stop: (when: number) => void }; node.loop = false; node.start = (when) => { call.start = when; }; node.stop = (when) => { call.stop = when; }; return node; }
  createChannelSplitter() { return new MockNode(); }
  createOscillator() { return new MockNode() as unknown as OscillatorNode; }
}
let decoded!: (value: DecodedAudio) => void;
const delayedAsset = new Promise<DecodedAudio>((resolve) => { decoded = resolve; });
const realtimeProject = createProject("Preload");
const realtimeTrack = createTrack("Loop", 0); realtimeTrack.id = "rt";
realtimeTrack.clips = [{ ...clip, id: "rt-clip", assetId: "rt-asset", start: 0, offset: 0, duration: .5, sourceDuration: .25, loop: true, fadeIn: 0, fadeOut: 0 }];
realtimeProject.tracks = [realtimeTrack];
(globalThis as unknown as { requestAnimationFrame: (fn: FrameRequestCallback) => number; cancelAnimationFrame: (id: number) => void }).requestAnimationFrame = () => 1;
(globalThis as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = () => {};
const realtime = new RealtimeAudioEngine({ createContext: () => new MockContext() as unknown as AudioContext, resolveAsset: () => delayedAsset });
const startRealtime = realtime.play(realtimeProject, 0);
await Promise.resolve();
assert.equal(sourceCalls.length, 0, "no source/clock schedule starts while required asset decode is pending");
decoded({ sampleRate: 10, frames: 3, duration: .3, channels: [new Float32Array([1, 1, 1])] });
await startRealtime;
assert.equal(sourceCalls.length, 1);
assert.equal(sourceCalls[0].start, .05, "source is scheduled from one post-preload context anchor");
assert.equal(sourceCalls[0].stop, .55, "looped BufferSource stops at finite arrangement clip end");
realtime.stop();

const cancelDuringRender = new AbortController();
let cancellationScheduled = false;
await assert.rejects(() => bounceProject(graphBounce, async () => ({
  sampleRate: 4, frames: 4, duration: 1, channels: [new Float32Array([1, 1, 1, 1])],
}), {
  sampleRate: 4096, range: { start: 0, end: 1 }, framesPerYield: 1,
  signal: cancelDuringRender.signal,
  onProgress: () => {
    if (!cancellationScheduled) {
      cancellationScheduled = true;
      setTimeout(() => cancelDuringRender.abort(), 0);
    }
  },
}, undefined), (error: unknown) => error instanceof DOMException && error.name === "AbortError",
"render yields macrotasks so a queued user cancellation is observed");

console.log("dawContractTest: all assertions passed");