import { evaluateAutomation } from "./automation";
import { validateSidechainRoute } from "./audioGraph";
import { appendAudit, projectDuration, type DawProject, type PluginInstance, type Track } from "./model";
import type { DecodedAudio } from "./assets";

export interface BounceRange { start: number; end: number }
export type BounceRangeMode = "full" | "selection";
export interface BounceOptions {
  sampleRate?: number;
  range?: BounceRange;
  /** Identifies the user-facing choice that produced range; rendering is always range-based. */
  rangeMode?: BounceRangeMode;
  tailSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  /** Maximum synchronous work before returning to the browser event loop. */
  framesPerYield?: number;
}
export interface BounceResult {
  wav: Blob;
  channels: [Float32Array, Float32Array];
  sampleRate: number;
  /** Arrangement/selection portion, without an effect tail. */
  contentRange: BounceRange;
  range: BounceRange;
  tailSeconds: number;
  peak: number;
  clippedSamples: number;
}
export type AssetResolver = (assetId: string) => Promise<DecodedAudio>;
export type PluginProcessor = (
  plugin: PluginInstance,
  left: number,
  right: number,
  sidechain: number,
  sample: number,
  sampleRate: number,
) => [number, number];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const abortError = () => new DOMException("Bounce cancelled", "AbortError");

/** Resolves a full arrangement or an explicit, validated selection deterministically. */
export function resolveBounceRange(project: DawProject, range?: BounceRange): BounceRange {
  const resolved = range ?? { start: 0, end: projectDuration(project) };
  if (!Number.isFinite(resolved.start) || !Number.isFinite(resolved.end) || resolved.start < 0 || resolved.end <= resolved.start) {
    throw new Error("Bounce range is empty or invalid");
  }
  return { start: resolved.start, end: resolved.end };
}

export async function bounceProject(
  project: DawProject,
  resolveAsset: AssetResolver,
  options: BounceOptions = {},
  processPlugin?: PluginProcessor,
): Promise<BounceResult> {
  const sampleRate = options.sampleRate ?? 48000;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Bounce sample rate is invalid");
  const contentRange = resolveBounceRange(project, options.range);
  const start = contentRange.start;
  const tailSeconds = Math.max(0, options.tailSeconds ?? 0);
  if (!Number.isFinite(tailSeconds)) throw new Error("Bounce tail duration is invalid");
  const end = contentRange.end + tailSeconds;
  const frameCount = Math.ceil((end - start) * sampleRate);
  const output: [Float32Array, Float32Array] = [new Float32Array(frameCount), new Float32Array(frameCount)];
  const neededAssets = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
  const assets = new Map<string, DecodedAudio>();
  if (options.signal?.aborted) throw abortError();
  await Promise.all([...neededAssets].map(async (id) => assets.set(id, await resolveAsset(id))));
  if (options.signal?.aborted) throw abortError();
  const activeTracks = project.tracks.filter((track) => !track.mute && (!project.tracks.some((item) => item.solo) || track.solo));
  const trackAudio = new Map<string, [Float32Array, Float32Array]>();
  // Sidechain detection reads source clip audio, regardless of whether that source is audible.
  for (const track of project.tracks) trackAudio.set(track.id, renderTrack(track, assets, start, frameCount, sampleRate));

  let peak = 0;
  let clippedSamples = 0;
  const blockSize = Math.max(1, Math.floor(options.framesPerYield ?? 1024));
  const master = project.buses.find((bus) => bus.kind === "master");
  for (let block = 0; block < frameCount; block += blockSize) {
    if (options.signal?.aborted) throw abortError();
    const blockEnd = Math.min(frameCount, block + blockSize);
    for (let frame = block; frame < blockEnd; frame++) {
      const time = start + frame / sampleRate;
      let mixL = 0, mixR = 0;
      const returns = new Map(project.buses.filter((bus) => bus.kind === "return").map((bus) => [bus.id, [0, 0] as [number, number]]));
      for (const track of activeTracks) {
        const source = trackAudio.get(track.id)!;
        let left = source[0][frame], right = source[1][frame];
        for (const plugin of track.inserts) if (plugin.enabled && processPlugin) {
          const sidechain = sidechainSample(project, track.id, plugin.id, frame, trackAudio);
          [left, right] = processPlugin(automatedPlugin(project, plugin, time), left, right, sidechain, frame, sampleRate);
        }
        // Sends tap the insert output; pre-fader sends bypass the track gain/pan.
        for (const send of track.sends) {
          const destination = returns.get(send.busId);
          if (!destination) continue;
          const sendGain = laneValue(project, "track", track.id, `send:${send.busId}:gain`, time, send.gain);
          const [sendL, sendR] = send.preFader
            ? [left, right]
            : applyGainPan(left, right,
              laneValue(project, "track", track.id, "gain", time, track.gain),
              laneValue(project, "track", track.id, "pan", time, track.pan));
          destination[0] += sendL * sendGain;
          destination[1] += sendR * sendGain;
        }
        const gain = laneValue(project, "track", track.id, "gain", time, track.gain);
        [left, right] = applyGainPan(left, right, gain, laneValue(project, "track", track.id, "pan", time, track.pan));
        mixL += left; mixR += right;
      }
      for (const bus of project.buses) if (bus.kind === "return") {
        let [left, right] = returns.get(bus.id) ?? [0, 0];
        for (const plugin of bus.inserts) if (plugin.enabled && processPlugin) {
          [left, right] = processPlugin(automatedPlugin(project, plugin, time), left, right, 0, frame, sampleRate);
        }
        [left, right] = applyGainPan(left, right,
          laneValue(project, "bus", bus.id, "gain", time, bus.gain),
          laneValue(project, "bus", bus.id, "pan", time, bus.pan));
        mixL += left; mixR += right;
      }
      if (master) {
        for (const plugin of master.inserts) if (plugin.enabled && processPlugin) {
          [mixL, mixR] = processPlugin(automatedPlugin(project, plugin, time), mixL, mixR, 0, frame, sampleRate);
        }
        [mixL, mixR] = applyGainPan(mixL, mixR,
          laneValue(project, "bus", master.id, "gain", time, master.gain),
          laneValue(project, "bus", master.id, "pan", time, master.pan));
      }
      output[0][frame] = mixL; output[1][frame] = mixR;
      const samplePeak = Math.max(Math.abs(output[0][frame]), Math.abs(output[1][frame]));
      peak = Math.max(peak, samplePeak);
      if (Math.abs(output[0][frame]) > 1) clippedSamples++;
      if (Math.abs(output[1][frame]) > 1) clippedSamples++;
    }
    options.onProgress?.(blockEnd / frameCount);
    // A macrotask yield is intentional: it lets AbortController events run during long renders.
    if (blockEnd < frameCount) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { wav: encodeWav(output, sampleRate), channels: output, sampleRate, contentRange, range: { start, end }, tailSeconds, peak, clippedSamples };
}

/** Bounce orchestration that records truthful start/outcome metadata. */
export async function bounceProjectWithAudit(
  project: DawProject,
  resolveAsset: AssetResolver,
  options: BounceOptions = {},
  processPlugin?: PluginProcessor,
): Promise<BounceResult> {
  const rangeStart = options.range?.start ?? 0;
  const rangeEnd = options.range?.end ?? projectDuration(project);
  appendAudit(project, "bounce-started", "Started offline bounce", { rangeStart, rangeEnd });
  try {
    const result = await bounceProject(project, resolveAsset, options, processPlugin);
    appendAudit(project, "bounce-completed", "Completed offline bounce", {
      rangeStart: result.range.start, rangeEnd: result.range.end, sampleRate: result.sampleRate,
      peak: result.peak, clippedSamples: result.clippedSamples, bytes: result.wav.size,
    });
    return result;
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    appendAudit(project, cancelled ? "bounce-cancelled" : "bounce-failed",
      cancelled ? "Cancelled offline bounce" : "Offline bounce failed",
      { rangeStart, rangeEnd, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function laneValue(project: DawProject, kind: "track" | "bus", ownerId: string, parameterId: string, time: number, fallback: number) {
  const lane = project.automation.find((item) =>
    item.enabled && item.target.kind === kind && item.target.ownerId === ownerId && item.target.parameterId === parameterId);
  return lane ? evaluateAutomation(lane, time) : fallback;
}

function automatedPlugin(project: DawProject, plugin: PluginInstance, time: number): PluginInstance {
  const parameters = { ...plugin.parameters };
  for (const lane of project.automation) {
    if (lane.enabled && lane.target.kind === "plugin" && lane.target.ownerId === plugin.id) {
      parameters[lane.target.parameterId] = evaluateAutomation(lane, time);
    }
  }
  return { ...plugin, parameters };
}

function applyGainPan(left: number, right: number, gain: number, pan: number): [number, number] {
  const normalizedPan = clamp(Number.isFinite(pan) ? pan : 0, -1, 1);
  const normalizedGain = Number.isFinite(gain) ? gain : 0;
  // Stereo balance keeps a centered stereo signal at unity; a hard pan mutes
  // only the opposite channel rather than applying a second centre attenuation.
  const leftPanGain = normalizedPan > 0 ? 1 - normalizedPan : 1;
  const rightPanGain = normalizedPan < 0 ? 1 + normalizedPan : 1;
  return [
    left * normalizedGain * leftPanGain,
    right * normalizedGain * rightPanGain,
  ];
}

function sidechainSample(
  project: DawProject,
  destinationTrackId: string,
  pluginInstanceId: string,
  frame: number,
  audio: Map<string, [Float32Array, Float32Array]>,
) {
  let key = 0;
  for (const route of project.routes) {
    if (!route.enabled || route.destinationTrackId !== destinationTrackId ||
      route.pluginInstanceId !== pluginInstanceId || validateSidechainRoute(project, route).length) continue;
    const source = audio.get(route.sourceTrackId);
    if (source) key += (source[0][frame] + source[1][frame]) * 0.5;
  }
  return key;
}

function renderTrack(
  track: Track,
  assets: Map<string, DecodedAudio>,
  bounceStart: number,
  frames: number,
  sampleRate: number,
): [Float32Array, Float32Array] {
  const result: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)];
  for (const clip of track.clips) {
    const asset = assets.get(clip.assetId);
    if (!asset) throw new Error(`Audio asset ${clip.assetId} is unavailable`);
    const from = Math.max(0, Math.floor((clip.start - bounceStart) * sampleRate));
    const to = Math.min(frames, Math.ceil((clip.start + clip.duration - bounceStart) * sampleRate));
    for (let frame = from; frame < to; frame++) {
      const clipTime = bounceStart + frame / sampleRate - clip.start;
      const sourceTime = clip.loop
        ? clip.offset + (clipTime % Math.max(1 / asset.sampleRate, clip.sourceDuration))
        : clip.offset + clipTime;
      const sourceFrame = Math.floor(sourceTime * asset.sampleRate);
      if (sourceFrame < 0 || sourceFrame >= asset.frames) continue;
      const fadeIn = clip.fadeIn > 0 ? clamp(clipTime / clip.fadeIn, 0, 1) : 1;
      const fadeOut = clip.fadeOut > 0 ? clamp((clip.duration - clipTime) / clip.fadeOut, 0, 1) : 1;
      const gain = clip.gain * Math.min(fadeIn, fadeOut);
      result[0][frame] += (asset.channels[0]?.[sourceFrame] ?? 0) * gain;
      result[1][frame] += (asset.channels[1]?.[sourceFrame] ?? asset.channels[0]?.[sourceFrame] ?? 0) * gain;
    }
  }
  return result;
}

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  if (!channels.length || channels.some((channel) => channel.length !== channels[0].length)) throw new Error("WAV channels must have equal length");
  const channelCount = channels.length;
  const frames = channels[0].length;
  const bytes = new ArrayBuffer(44 + frames * channelCount * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, frames * channelCount * 2, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channelCount; channel++) {
    const sample = clamp(channels[channel][frame], -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}