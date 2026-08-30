import { createId, type AudioAsset } from "./model";

export interface DecodedAudio {
  sampleRate: number;
  channels: Float32Array[];
  frames: number;
  duration: number;
}

export interface AudioDecoder {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
}

export function analyzeWaveform(channels: readonly Float32Array[], buckets = 512): number[] {
  if (!channels.length || buckets <= 0) return [];
  const frames = channels[0].length;
  const result: number[] = [];
  for (let bucket = 0; bucket < Math.min(buckets, Math.max(1, frames)); bucket++) {
    const from = Math.floor(bucket * frames / buckets);
    const to = Math.max(from + 1, Math.floor((bucket + 1) * frames / buckets));
    let peak = 0;
    for (const channel of channels) {
      for (let frame = from; frame < Math.min(to, channel.length); frame++) peak = Math.max(peak, Math.abs(channel[frame]));
    }
    result.push(peak);
  }
  return result;
}

export async function decodeAudioBlob(blob: Blob, decoder: AudioDecoder): Promise<DecodedAudio> {
  if (!blob.size) throw new Error("The audio file is empty");
  let buffer: AudioBuffer;
  try {
    buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
  } catch (error) {
    throw new Error(`Audio decode failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!buffer.numberOfChannels || !buffer.length || !Number.isFinite(buffer.sampleRate)) {
    throw new Error("Decoded audio contains no playable samples");
  }
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => new Float32Array(buffer.getChannelData(index))),
    frames: buffer.length,
    duration: buffer.duration,
  };
}

export async function importAudio(
  file: Blob & { readonly name?: string },
  decoder: AudioDecoder,
  fileName?: string,
): Promise<{ asset: AudioAsset; audio: DecodedAudio; blob: Blob }> {
  const audio = await decodeAudioBlob(file, decoder);
  const asset: AudioAsset = {
    id: createId("asset"),
    name: fileName || file.name || "Imported audio",
    mimeType: file.type || "application/octet-stream",
    sampleRate: audio.sampleRate,
    channels: audio.channels.length,
    frames: audio.frames,
    duration: audio.duration,
    createdAt: new Date().toISOString(),
    byteLength: file.size,
    waveform: analyzeWaveform(audio.channels),
  };
  return { asset, audio, blob: file };
}

export type RecordingErrorCode = "permission-denied" | "no-device" | "unsupported" | "capture-failed";

export class RecordingError extends Error {
  constructor(readonly code: RecordingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RecordingError";
  }
}

export interface RecordingOptions {
  deviceId?: string;
  channels?: 1 | 2;
  mimeType?: string;
  latencySeconds?: number;
}

export class BrowserRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(
    private readonly devices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices,
    private readonly Recorder: typeof MediaRecorder = MediaRecorder,
  ) {}

  async start(options: RecordingOptions = {}): Promise<void> {
    if (this.recorder?.state === "recording") throw new RecordingError("capture-failed", "Recording is already active");
    if (!this.devices?.getUserMedia || !this.Recorder) throw new RecordingError("unsupported", "Audio recording is not supported by this browser");
    try {
      const constraints: MediaTrackConstraints & { latency?: number } = {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        channelCount: options.channels ?? 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        latency: options.latencySeconds,
      };
      this.stream = await this.devices.getUserMedia({
        audio: constraints,
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new RecordingError("permission-denied", "Microphone permission was denied", { cause: error });
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new RecordingError("no-device", "The selected audio input is unavailable", { cause: error });
      }
      throw new RecordingError("capture-failed", "Could not open the audio input", { cause: error });
    }
    this.chunks = [];
    try {
      this.recorder = new this.Recorder(this.stream, options.mimeType ? { mimeType: options.mimeType } : undefined);
      this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
      this.recorder.start(250);
    } catch (error) {
      this.release();
      throw new RecordingError("capture-failed", "Could not start recording", { cause: error });
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return Promise.reject(new RecordingError("capture-failed", "Recording is not active"));
    return new Promise((resolve, reject) => {
      recorder.onerror = () => {
        this.release();
        reject(new RecordingError("capture-failed", "Recording failed"));
      };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
        this.release();
        if (!blob.size) reject(new RecordingError("capture-failed", "Recording produced no audio"));
        else resolve(blob);
      };
      recorder.stop();
    });
  }

  cancel() {
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    this.chunks = [];
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}