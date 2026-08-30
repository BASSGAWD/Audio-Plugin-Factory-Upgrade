import type { DawProject } from "./model";

export interface ScheduledEvent {
  id: string;
  kind: "clip-start" | "clip-stop" | "metronome";
  sample: number;
  time: number;
  trackId?: string;
  clipId?: string;
  accent?: boolean;
}

/** Produces an immutable sample-indexed plan, independent of UI/render timing. */
export function buildSchedule(project: DawProject, from: number, to: number, sampleRate: number): ScheduledEvent[] {
  if (!(sampleRate > 0) || to < from) throw new Error("Invalid schedule range");
  const events: ScheduledEvent[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const start = Math.max(from, clip.start);
      const end = Math.min(to, clip.start + clip.duration);
      if (end <= start) continue;
      events.push({
        id: `${clip.id}:start`, kind: "clip-start", sample: Math.round(start * sampleRate),
        time: start, trackId: track.id, clipId: clip.id,
      });
      events.push({
        id: `${clip.id}:stop`, kind: "clip-stop", sample: Math.round(end * sampleRate),
        time: end, trackId: track.id, clipId: clip.id,
      });
    }
  }
  if (project.transport.metronome) addMetronome(project, from, to, sampleRate, events);
  return events.sort((a, b) => a.sample - b.sample || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function addMetronome(project: DawProject, from: number, to: number, sampleRate: number, events: ScheduledEvent[]) {
  const tempo = [...project.transport.tempo].sort((a, b) => a.time - b.time)[0];
  if (!tempo || tempo.bpm <= 0) return;
  const beatSeconds = 60 / tempo.bpm * (4 / tempo.denominator);
  const firstBeat = Math.ceil(from / beatSeconds);
  for (let beat = firstBeat; beat * beatSeconds < to; beat++) {
    const time = beat * beatSeconds;
    events.push({
      id: `metronome:${beat}`, kind: "metronome", sample: Math.round(time * sampleRate),
      time, accent: beat % tempo.numerator === 0,
    });
  }
}

export class TransportClock {
  private anchorContextTime = 0;
  private anchorProjectTime = 0;
  private state: "stopped" | "playing" | "paused" = "stopped";
  constructor(readonly sampleRate: number) {}

  play(contextTime: number, projectTime = this.anchorProjectTime) {
    this.anchorContextTime = contextTime;
    this.anchorProjectTime = Math.max(0, projectTime);
    this.state = "playing";
  }
  pause(contextTime: number) {
    this.anchorProjectTime = this.positionAt(contextTime);
    this.state = "paused";
  }
  stop() {
    this.state = "stopped";
    this.anchorProjectTime = 0;
  }
  seek(time: number, contextTime: number) {
    this.anchorProjectTime = Math.max(0, time);
    this.anchorContextTime = contextTime;
  }
  positionAt(contextTime: number) {
    return this.state === "playing"
      ? this.anchorProjectTime + Math.max(0, contextTime - this.anchorContextTime)
      : this.anchorProjectTime;
  }
  sampleAt(contextTime: number) { return Math.round(this.positionAt(contextTime) * this.sampleRate); }
  get status() { return this.state; }
}