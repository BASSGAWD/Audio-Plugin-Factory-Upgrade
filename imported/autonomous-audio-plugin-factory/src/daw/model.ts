import type { PluginRoutingContract } from "../types";

export const DAW_PROJECT_VERSION = 3 as const;

export type Id = string;
export type TrackColor = `#${string}`;
export type AutomationCurve = "step" | "linear" | "exponential";

export interface AudioAsset {
  id: Id;
  name: string;
  mimeType: string;
  sampleRate: number;
  channels: number;
  frames: number;
  duration: number;
  createdAt: string;
  byteLength: number;
  waveform?: number[];
}

export interface AudioClip {
  id: Id;
  assetId: Id;
  name: string;
  start: number;
  offset: number;
  duration: number;
  loop: boolean;
  sourceDuration: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
}

export interface PluginInstance {
  id: Id;
  pluginId: Id;
  name: string;
  enabled: boolean;
  parameters: Record<string, number>;
  routing?: PluginRoutingContract;
}

export interface Send {
  busId: Id;
  gain: number;
  preFader: boolean;
}

export interface Track {
  id: Id;
  name: string;
  color: TrackColor;
  order: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  gain: number;
  pan: number;
  input?: { deviceId?: string; channels: 1 | 2 };
  clips: AudioClip[];
  inserts: PluginInstance[];
  sends: Send[];
}

export interface Bus {
  id: Id;
  kind: "return" | "master";
  name: string;
  gain: number;
  pan: number;
  inserts: PluginInstance[];
}

export interface SidechainRoute {
  id: Id;
  sourceTrackId: Id;
  destinationTrackId: Id;
  pluginInstanceId: Id;
  enabled: boolean;
}

export interface AutomationPoint {
  id: Id;
  time: number;
  value: number;
  curve: AutomationCurve;
}

export interface AutomationLane {
  id: Id;
  target: {
    kind: "track" | "bus" | "plugin";
    ownerId: Id;
    parameterId: string;
  };
  enabled: boolean;
  defaultValue: number;
  points: AutomationPoint[];
}

export interface TempoEvent {
  time: number;
  bpm: number;
  numerator: number;
  denominator: number;
}

export interface Marker {
  id: Id;
  time: number;
  name: string;
  color?: TrackColor;
}

export type AuditEventType =
  | "project-created" | "project-renamed" | "track-created" | "track-updated"
  | "track-deleted" | "clip-created" | "clip-updated" | "clip-deleted"
  | "asset-imported" | "take-recorded" | "route-updated" | "automation-updated"
  | "project-saved" | "project-recovered" | "bounce-started" | "bounce-completed"
  | "bounce-failed" | "bounce-cancelled"
  | "sync-enabled" | "sync-uploaded" | "sync-downloaded" | "sync-conflict";

export type SyncPhase = "local-only" | "offline" | "pending" | "syncing" | "synced" | "conflict" | "quota" | "error";

export interface ProjectSyncState {
  enabled: boolean;
  phase: SyncPhase;
  remoteRevision: number | null;
  pendingAssets: number;
  transferredBytes: number;
  totalBytes: number;
  message: string;
  retryAt?: string;
}

export interface AuditEvent {
  id: Id;
  type: AuditEventType;
  at: string;
  actor: "user" | "system";
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TransportSettings {
  tempo: TempoEvent[];
  timeSignature: { numerator: number; denominator: number };
  loop: { enabled: boolean; start: number; end: number };
  countInBars: number;
  metronome: boolean;
  snapSeconds: number;
}

export interface DawProject {
  version: typeof DAW_PROJECT_VERSION;
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  tracks: Track[];
  buses: Bus[];
  routes: SidechainRoute[];
  automation: AutomationLane[];
  assets: AudioAsset[];
  markers: Marker[];
  transport: TransportSettings;
  audit: AuditEvent[];
}

export function createId(prefix: string): Id {
  const random = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function appendAudit(
  project: DawProject,
  type: AuditEventType,
  summary: string,
  metadata?: AuditEvent["metadata"],
  at = new Date().toISOString(),
  actor: AuditEvent["actor"] = "user",
): AuditEvent {
  const event: AuditEvent = { id: createId("event"), type, at, actor, summary, metadata };
  project.audit.push(event);
  project.updatedAt = at;
  project.revision++;
  return event;
}

export function createProject(name = "Untitled Project", now = new Date().toISOString()): DawProject {
  const project: DawProject = {
    version: DAW_PROJECT_VERSION,
    id: createId("project"),
    name,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    tracks: [],
    buses: [{ id: "master", kind: "master", name: "Master", gain: 1, pan: 0, inserts: [] }],
    routes: [],
    automation: [],
    assets: [],
    markers: [],
    transport: {
      tempo: [{ time: 0, bpm: 120, numerator: 4, denominator: 4 }],
      timeSignature: { numerator: 4, denominator: 4 },
      loop: { enabled: false, start: 0, end: 4 },
      countInBars: 0,
      metronome: false,
      snapSeconds: 0.25,
    },
    audit: [],
  };
  appendAudit(project, "project-created", `Created ${name}`, undefined, now);
  return project;
}

export function createTrack(name: string, order: number, color: TrackColor = "#64748b"): Track {
  return {
    id: createId("track"), name, color, order, mute: false, solo: false, armed: false,
    gain: 1, pan: 0, clips: [], inserts: [], sends: [],
  };
}

export function projectDuration(project: DawProject): number {
  return project.tracks.reduce((end, track) =>
    track.clips.reduce((clipEnd, clip) => Math.max(clipEnd, clip.start + clip.duration), end), 0);
}