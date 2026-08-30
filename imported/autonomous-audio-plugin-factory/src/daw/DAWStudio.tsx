import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { Activity, ChevronLeft, FileClock, FolderInput, SlidersHorizontal, Sparkles } from "lucide-react";
import type { AudioPlugin } from "../types";
import type { AudioSoftwareProject } from "../audioProjects";
import ArrangementView from "./ArrangementView";
import AuditEventView from "./AuditEventView";
import AutomationPanel from "./AutomationPanel";
import BounceStatusPanel, { type BounceState } from "./BounceStatusPanel";
import ImportRecordPanel, { type ImportedAudio } from "./ImportRecordPanel";
import MixerView from "./MixerView";
import SyncPanel from "./SyncPanel";
import TransportBar from "./TransportBar";
import {
  EditHistory, addTrackEdit, deleteTrackEdit, moveClipEdit, reorderTracksEdit, setClipLoop, splitClip,
  updateTrackEdit, type ProjectEdit,
} from "./arrangement";
import { importAudio, decodeAudioBlob, type DecodedAudio } from "./assets";
import { bounceProjectWithAudit } from "./bounce";
import { buildAudioGraph } from "./audioGraph";
import {
  appendAudit, createId, createProject, createTrack, projectDuration,
  type AudioClip, type AutomationLane, type AutomationPoint, type DawProject, type ProjectSyncState, type SidechainRoute, type Track,
} from "./model";
import { DawDatabase } from "./persistence";
import { HttpSyncTransport, ProjectSyncManager } from "./sync";
import { RealtimeAudioEngine, type EngineMeters } from "./realtimeAudioEngine";
import { createActivePluginProcessor } from "./pluginProcessor";
import {
  createPortableProjectBundle, readPortableProjectBundle, supportsPortableBundleDirectories,
  writePortableProjectBundle, portableAssetPath, portableDirectoryPicker,
} from "./portableBundle";
import { assertNativeProcessorSupport } from "./nativePluginSupport";

const LAST_PROJECT_KEY = "orangejuce_daw_last_project";
/** Per-AudioSoftwareProject DAW project storage: maps audio-project id -> daw project id. */
const DAW_HYDRATION_KEY = "orangejuce_daw_hydration_map";
const RETURN_BUS_ID = "return-a";
type InspectorTab = "capture" | "automation" | "audit" | "bounce";

/**
 * Derives a DawProject from an AudioSoftwareProject so that opening the
 * workstation for a DAW-kind audio project uses the brief's own name, BPM,
 * track count, and buses rather than silently loading an unrelated last session.
 *
 * The derived project id is stable for the audio project id so that
 * subsequent "resume" opens for the same DAW project load from IndexedDB
 * rather than re-deriving every time.
 */
export function dawProjectFromAudioProject(source: AudioSoftwareProject & { kind: "daw" }): DawProject {
  const ws = source.workstation;
  const trackCount = Math.max(1, ws.tracks);
  const bpm = ws.transportBpm > 0 ? ws.transportBpm : 120;

  const now = new Date().toISOString();
  const project = createProject(source.name, now);
  // Use a deterministic id derived from the audio project id so the same
  // DAW project is always found in IndexedDB for this audio project.
  (project as { id: string }).id = `daw-derived-${source.id}`;
  // Set BPM from the audio project's transport.
  if (project.transport.tempo.length > 0) project.transport.tempo[0].bpm = bpm;

  // Add return and master buses from the workstation contract.
  project.buses = [{ id: "master", kind: "master", name: "Master", gain: 1, pan: 0, inserts: [] }];
  for (const bus of ws.buses) {
    if (bus.kind === "return" && !project.buses.some(b => b.id === bus.id)) {
      project.buses.unshift({ id: bus.id, kind: "return", name: bus.id, gain: 1, pan: 0, inserts: [] });
    }
  }
  // Ensure Return A is always present.
  if (!project.buses.some(b => b.id === RETURN_BUS_ID)) {
    project.buses.unshift({ id: RETURN_BUS_ID, kind: "return", name: "Return A", gain: 1, pan: 0, inserts: [] });
  }

  // Add tracks matching the brief's track count.
  const TRACK_COLORS: string[] = ["#f97316", "#6366f1", "#22c55e", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444"];
  for (let i = 0; i < trackCount; i++) {
    const track = createTrack(`Audio ${i + 1}`, i, (TRACK_COLORS[i % TRACK_COLORS.length] || "#64748b") as `#${string}`);
    project.tracks.push(track);
    appendAudit(project, "track-created", `Created track ${track.name}`, { trackId: track.id }, now);
  }

  appendAudit(project, "project-created", `Hydrated from audio project ${source.id}`, { sourceId: source.id }, now);
  return project;
}

/**
 * Applies safe template growth when the shared brief changes after a session
 * has already been opened. Existing tracks and buses are never deleted here:
 * removing them could destroy recorded clips or routing. When a lower track
 * count is requested, the saved session is retained and the caller surfaces
 * that limitation instead of silently pretending the template was applied.
 */
export function reconcileDawProjectWithAudioProject(
  saved: DawProject,
  source: AudioSoftwareProject & { kind: "daw" },
): { project: DawProject; changed: boolean; limitation?: string } {
  const next = structuredClone(saved);
  const desiredTracks = Math.max(1, source.workstation.tracks);
  let changed = false;

  while (next.tracks.length < desiredTracks) {
    const index = next.tracks.length;
    const colors = ["#f97316", "#6366f1", "#22c55e", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444"] as const;
    const track = createTrack(`Audio ${index + 1}`, index, colors[index % colors.length]);
    next.tracks.push(track);
    appendAudit(next, "track-created", `Added ${track.name} from the revised audio project brief`, { trackId: track.id });
    changed = true;
  }

  for (const bus of source.workstation.buses) {
    if (bus.kind === "return" && !next.buses.some(existing => existing.id === bus.id)) {
      next.buses.unshift({ id: bus.id, kind: "return", name: bus.id, gain: 1, pan: 0, inserts: [] });
      changed = true;
    }
  }

  const limitation = next.tracks.length > desiredTracks
    ? `The revised brief asks for ${desiredTracks} track(s), but this saved session keeps ${next.tracks.length} to avoid deleting existing work.`
    : undefined;
  return { project: next, changed, limitation };
}

function initialProject(plugin?: AudioPlugin): DawProject {
  const project = createProject("Untitled session");
  project.buses.unshift({ id: RETURN_BUS_ID, kind: "return", name: "Return A", gain: 1, pan: 0, inserts: [] });
  const track = createTrack("Audio 1", 0, "#f97316");
  if (plugin && !plugin.isPlaceholder) {
    track.inserts.push({
      id: createId("insert"), pluginId: plugin.id, name: plugin.name, enabled: true,
      parameters: Object.fromEntries(plugin.parameters.map((parameter) => [parameter.id, parameter.value])),
      routing: plugin.routing,
    });
  }
  project.tracks.push(track);
  appendAudit(project, "track-created", `Created track ${track.name}`, { trackId: track.id });
  return project;
}

function replacementEdit(label: string, before: DawProject, after: DawProject): ProjectEdit {
  return {
    label,
    apply: () => structuredClone(after),
    revert: () => structuredClone(before),
  };
}

interface DAWStudioProps {
  onExit: () => void;
  plugin?: AudioPlugin;
  /**
   * When provided and kind === "daw", the workstation is hydrated from this
   * audio project on first open. Subsequent opens for the same project id load
   * the saved state from IndexedDB rather than re-deriving.
   */
  audioProject?: AudioSoftwareProject | null;
}

export default function DAWStudio({ onExit, plugin, audioProject }: DAWStudioProps) {
  const { isSignedIn, userId } = useAuth();
  const [project, setProject] = useState<DawProject>(() => initialProject(plugin));
  const [loading, setLoading] = useState(true);
  const [storageStatus, setStorageStatus] = useState("Opening durable project storage…");
  const [syncState, setSyncState] = useState<ProjectSyncState>({ enabled: false, phase: "local-only", remoteRevision: null, pendingAssets: 0, transferredBytes: 0, totalBytes: 0, message: "Saved on this device only." });
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [bottomView, setBottomView] = useState<"mixer" | "inspector">("mixer");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("capture");
  const [automationTrackId, setAutomationTrackId] = useState<string | null>(project.tracks[0]?.id ?? null);
  const [automationParameter, setAutomationParameter] = useState<"gain" | "pan">("gain");
  const [automationTarget, setAutomationTarget] = useState<AutomationLane["target"]>({ kind: "track", ownerId: project.tracks[0]?.id ?? "", parameterId: "gain" });
  const [bounceRangeMode, setBounceRangeMode] = useState<"full" | "selection">("full");
  const [bounceTail, setBounceTail] = useState(0);
  const [bounce, setBounce] = useState<BounceState>({ status: "idle" });
  const [playbackStatus, setPlaybackStatus] = useState("Stopped");
  const [meters, setMeters] = useState<EngineMeters>({ tracks: {}, buses: {} });
  const databaseRef = useRef<DawDatabase | null>(null);
  const syncRef = useRef<ProjectSyncManager | null>(null);
  const historyRef = useRef(new EditHistory());
  const decodedRef = useRef(new Map<string, DecodedAudio>());
  const engineRef = useRef<RealtimeAudioEngine | null>(null);
  const projectRef = useRef(project);
  const bounceAbortRef = useRef<AbortController | null>(null);
  const persistenceQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const tempo = project.transport.tempo[0]?.bpm ?? 120;
  const signature = `${project.transport.timeSignature.numerator}/${project.transport.timeSignature.denominator}`;
  const duration = Math.max(32, projectDuration(project));
  const automationLane = project.automation.find((lane) => lane.target.kind === automationTarget.kind && lane.target.ownerId === automationTarget.ownerId && lane.target.parameterId === automationTarget.parameterId);
  const points = automationLane?.points ?? [];
  const armed = project.tracks.filter((track) => track.armed);
  const graph = useMemo(() => buildAudioGraph(project), [project]);
  const sidechains = Object.fromEntries(project.tracks.map((track) => [
    track.id, project.routes.find((route) => route.destinationTrackId === track.id && route.enabled)?.sourceTrackId ?? null,
  ]));
  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const database = await DawDatabase.open();
        if (disposed) { database.close(); return; }
        databaseRef.current = database;
        syncRef.current = new ProjectSyncManager(database, new HttpSyncTransport(), setSyncState, (incoming) => {
          projectRef.current = incoming;
          historyRef.current = new EditHistory();
          setProject(incoming);
          setAutomationTrackId(incoming.tracks[0]?.id ?? null);
        }, () => projectRef.current);
        engineRef.current = new RealtimeAudioEngine({
          resolveAsset: async (assetId) => {
            const cached = decodedRef.current.get(assetId);
            if (cached) return cached;
            const blob = await database.getAsset(projectRef.current.id, assetId);
            if (!blob) throw new Error(`Audio asset ${assetId} is missing from IndexedDB`);
            const context = new AudioContext();
            try { return await decodeAudioBlob(blob, { decodeAudioData: (data) => context.decodeAudioData(data) }); }
            finally { await context.close(); }
          },
          onPosition: setPosition, onMeters: setMeters, onStatus: setPlaybackStatus, onPlayingChange: setPlaying, processPlugin: createActivePluginProcessor(plugin),
        });
        // Determine which DAW project to load:
        // 1. If an AudioSoftwareProject (kind=daw) is passed, derive a stable
        //    DawProject id from the audio project id and look that up in IndexedDB
        //    first. On first open, save the derived project. On resume, load the
        //    saved edits for that same audio project.
        // 2. Otherwise fall back to the legacy LAST_PROJECT_KEY lookup.
        let resolvedId: string | null = null;
        if (audioProject?.kind === "daw") {
          const derivedId = `daw-derived-${audioProject.id}`;
          const hydrationMap: Record<string, string> = (() => {
            try { return JSON.parse(localStorage.getItem(DAW_HYDRATION_KEY) ?? "{}"); } catch { return {}; }
          })();
          if (hydrationMap[audioProject.id]) {
            resolvedId = hydrationMap[audioProject.id];
          } else {
            // First open for this audio project — derive and persist the project.
            const derived = dawProjectFromAudioProject(audioProject as AudioSoftwareProject & { kind: "daw" });
            await database.saveProject(derived);
            hydrationMap[audioProject.id] = derived.id;
            localStorage.setItem(DAW_HYDRATION_KEY, JSON.stringify(hydrationMap));
            localStorage.setItem(LAST_PROJECT_KEY, derived.id);
            setProject(derived);
            projectRef.current = derived;
            setAutomationTrackId(derived.tracks[0]?.id ?? null);
            setStorageStatus(`Opened "${derived.name}" — hydrated from audio project brief.`);
            syncRef.current.setIdentity(userId ?? null);
            await syncRef.current.initialize(derived.id, userId ?? null);
            resolvedId = null; // first open was fully handled above
          }
          if (resolvedId) {
            // Resume: load saved edits for this audio project.
            const loaded = await database.loadProject(resolvedId);
            if (loaded.project) {
              const reconciled = reconcileDawProjectWithAudioProject(
                loaded.project,
                audioProject as AudioSoftwareProject & { kind: "daw" },
              );
              if (!reconciled.project.buses.some((bus) => bus.id === RETURN_BUS_ID)) {
                reconciled.project.buses.unshift({ id: RETURN_BUS_ID, kind: "return", name: "Return A", gain: 1, pan: 0, inserts: [] });
                reconciled.changed = true;
              }
              if (reconciled.changed) await database.saveProject(reconciled.project, false);
              setProject(reconciled.project);
              projectRef.current = reconciled.project;
              setAutomationTrackId(reconciled.project.tracks[0]?.id ?? null);
              setStorageStatus(
                reconciled.limitation
                  ?? (loaded.recovered ? "Recovered an interrupted IndexedDB save." : "Resumed DAW session from audio project."),
              );
              syncRef.current.setIdentity(userId ?? null);
              await syncRef.current.initialize(reconciled.project.id, userId ?? null);
            } else {
              // The hydration map can outlive IndexedDB eviction. Recreate the
              // project from the current brief instead of falling back to an
              // unrelated legacy session.
              const derived = dawProjectFromAudioProject(audioProject as AudioSoftwareProject & { kind: "daw" });
              await database.saveProject(derived);
              hydrationMap[audioProject.id] = derived.id;
              localStorage.setItem(DAW_HYDRATION_KEY, JSON.stringify(hydrationMap));
              setProject(derived);
              projectRef.current = derived;
              setAutomationTrackId(derived.tracks[0]?.id ?? null);
              setStorageStatus(`Recreated "${derived.name}" from its audio project brief.`);
              syncRef.current.setIdentity(userId ?? null);
              await syncRef.current.initialize(derived.id, userId ?? null);
            }
          }
        } else {
          // Legacy path: load whatever was open last.
          const id = localStorage.getItem(LAST_PROJECT_KEY);
          if (id) {
            const loaded = await database.loadProject(id);
            if (loaded.project) {
              if (!loaded.project.buses.some((bus) => bus.id === RETURN_BUS_ID)) {
                loaded.project.buses.unshift({ id: RETURN_BUS_ID, kind: "return", name: "Return A", gain: 1, pan: 0, inserts: [] });
              }
              setProject(loaded.project);
              setAutomationTrackId(loaded.project.tracks[0]?.id ?? null);
              setStorageStatus(loaded.recovered ? "Recovered an interrupted IndexedDB save." : "Project and asset references restored from IndexedDB.");
              syncRef.current.setIdentity(userId ?? null);
              await syncRef.current.initialize(loaded.project.id, userId ?? null);
            } else setStorageStatus("Previous project was not found; started a new project.");
          } else {
            await database.saveProject(projectRef.current);
            localStorage.setItem(LAST_PROJECT_KEY, projectRef.current.id);
            setStorageStatus("New project persisted in IndexedDB.");
            syncRef.current.setIdentity(userId ?? null);
            await syncRef.current.initialize(projectRef.current.id, userId ?? null);
          }
        }
      } catch (error) {
        setStorageStatus(`Storage unavailable: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      void engineRef.current?.close();
      databaseRef.current?.close();
      if (bounce.status === "complete") URL.revokeObjectURL(bounce.url);
    };
  }, []);

  const enqueueProjectPersistence = (next: DawProject, recordAudit: boolean) => {
    const database = databaseRef.current;
    if (!database) return Promise.reject(new Error("IndexedDB is not available."));
    const snapshot = structuredClone(next);
    const finishLocalEdit = syncRef.current?.beginLocalEdit() ?? (() => undefined);
    const operation = persistenceQueueRef.current.catch(() => undefined).then(async () => {
      try {
        await database.exclusive(async () => {
          await database.saveProject(snapshot, recordAudit);
          await syncRef.current?.markDirty(snapshot);
        });
        return snapshot;
      } finally { finishLocalEdit(); }
    });
    persistenceQueueRef.current = operation;
    return operation;
  };

  const persistLocalEdit = (next: DawProject) => {
    void enqueueProjectPersistence(next, false)
      .catch((error) => setStorageStatus(`Local autosave failed: ${error instanceof Error ? error.message : String(error)}`));
  };

  const execute = (edit: ProjectEdit) => {
    setProject((current) => {
      const next = historyRef.current.execute(current, edit);
      projectRef.current = next; persistLocalEdit(next);
      return next;
    });
  };

  const replaceProject = (label: string, mutate: (next: DawProject) => void) => {
    setProject((current) => {
      const next = structuredClone(current);
      mutate(next);
      projectRef.current = next; persistLocalEdit(next);
      return historyRef.current.execute(current, replacementEdit(label, current, next));
    });
  };

  const save = async (projectToSave = project) => {
    const database = databaseRef.current;
    if (!database) {
      setStorageStatus("Save failed: IndexedDB is not available.");
      return;
    }
    try {
      const saved = await enqueueProjectPersistence(projectToSave, true);
      localStorage.setItem(LAST_PROJECT_KEY, saved.id);
      projectRef.current = saved;
      setProject(structuredClone(saved));
      setStorageStatus(`Project and asset references saved at ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setStorageStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const requirePortableDirectories = () => {
    if (supportsPortableBundleDirectories()) return true;
    setStorageStatus("Portable bundle import/export is unavailable: this browser does not support the File System Access directory picker.");
    return false;
  };

  const exportPortableBundle = async () => {
    const database = databaseRef.current;
    if (!database || !requirePortableDirectories()) return;
    try {
      assertNativeProcessorSupport(projectRef.current);
      const directory = await portableDirectoryPicker()({ mode: "readwrite" });
      setStorageStatus("Preparing portable project bundle…");
      const assets = new Map<string, Blob>((await database.listAssets(projectRef.current.id)).map((asset) => [asset.assetId, asset.blob]));
      const bundle = createPortableProjectBundle(projectRef.current, assets);
      await writePortableProjectBundle(directory, bundle);
      setStorageStatus(`Exported portable bundle to ${directory.name}.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStorageStatus("Portable bundle export cancelled.");
      } else setStorageStatus(`Portable bundle export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const importPortableBundle = async () => {
    const database = databaseRef.current;
    if (!database || !requirePortableDirectories()) return;
    try {
      const directory = await portableDirectoryPicker()({ mode: "read" });
      setStorageStatus("Opening portable project bundle…");
      const bundle = await readPortableProjectBundle(directory);
      await database.exclusive(async () => {
        for (const asset of bundle.project.assets) {
          const blob = bundle.files.get(portableAssetPath(asset));
          if (!blob) throw new Error(`Portable bundle is missing asset ${asset.id}`);
          await database.putAsset({ projectId: bundle.project.id, assetId: asset.id, blob });
        }
        await database.saveProject(bundle.project, false);
      });
      decodedRef.current.clear();
      historyRef.current = new EditHistory();
      projectRef.current = bundle.project;
      setProject(structuredClone(bundle.project));
      setAutomationTrackId(bundle.project.tracks[0]?.id ?? null);
      setSelectedClipId(null);
      localStorage.setItem(LAST_PROJECT_KEY, bundle.project.id);
      await syncRef.current?.initialize(bundle.project.id, userId ?? null);
      setStorageStatus(`Imported portable bundle ${directory.name}; project and ${bundle.project.assets.length} asset(s) are now stored in IndexedDB.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStorageStatus("Portable bundle import cancelled.");
      } else setStorageStatus(`Portable bundle import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resolveAsset = async (assetId: string): Promise<DecodedAudio> => {
    const cached = decodedRef.current.get(assetId);
    if (cached) return cached;
    const blob = await databaseRef.current?.getAsset(project.id, assetId);
    if (!blob) throw new Error(`Audio asset ${assetId} is missing from IndexedDB`);
    const context = new AudioContext();
    const decoded = await decodeAudioBlob(blob, { decodeAudioData: (data) => context.decodeAudioData(data) });
    await context.close();
    decodedRef.current.set(assetId, decoded);
    return decoded;
  };

  const addAudio = async (audio: ImportedAudio) => {
    const destination = armed.length === 1 ? armed[0] : project.tracks[0];
    const database = databaseRef.current;
    if (!destination || !database) {
      setStorageStatus(!destination ? "Import failed: add a destination track." : "Import failed: IndexedDB is unavailable.");
      return;
    }
    setStorageStatus(`Decoding ${audio.name}…`);
    const context = new AudioContext();
    try {
      const imported = await importAudio(audio.blob, { decodeAudioData: (data) => context.decodeAudioData(data) }, audio.name);
       await context.close();
      await database.putAsset({ projectId: project.id, assetId: imported.asset.id, blob: imported.blob });
      decodedRef.current.set(imported.asset.id, imported.audio);
      const clip: AudioClip = {
        id: createId("clip"), assetId: imported.asset.id, name: audio.name, start: position, offset: 0,
        duration: imported.asset.duration, sourceDuration: imported.asset.duration, loop: false,
        gain: 1, fadeIn: 0, fadeOut: 0,
      };
      const next = structuredClone(project);
      next.assets.push(imported.asset);
      next.tracks.find((track) => track.id === destination.id)!.clips.push(clip);
      appendAudit(next, audio.source === "record" ? "take-recorded" : "asset-imported",
        `${audio.source === "record" ? "Recorded" : "Imported"} ${audio.name}`,
        { assetId: imported.asset.id, trackId: destination.id, duration: imported.asset.duration });
      appendAudit(next, "clip-created", `Placed ${clip.name} on ${destination.name}`, { clipId: clip.id, trackId: destination.id });
      setProject(next);
      setSelectedClipId(clip.id);
      await save(next);
      await syncRef.current?.markDirty(next, imported.asset.id);
      setStorageStatus(`${audio.name} decoded and stored durably (${imported.asset.duration.toFixed(2)}s).`);
    } catch (error) {
      setStorageStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(() => {
    const reconnect = () => void syncRef.current?.flush(projectRef.current.id);
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);

  useEffect(() => {
    syncRef.current?.setIdentity(userId ?? null);
    if (databaseRef.current) void syncRef.current?.initialize(projectRef.current.id, userId ?? null);
  }, [userId]);

  const stopPlayback = (reset = true) => {
    if (reset) engineRef.current?.stop(); else engineRef.current?.pause();
    setPlaying(false);
    if (reset) setPosition(0);
    setPlaybackStatus(reset ? "Stopped" : "Paused");
  };

  const play = async () => {
    if (playing) { stopPlayback(false); return; }
    if (!project.tracks.some((track) => track.clips.length)) {
      setPlaybackStatus("Import or record audio before playback.");
      return;
    }
    try {
      await engineRef.current?.play(project, position);
      setPlaying(engineRef.current?.isPlaying ?? false);
    } catch (error) {
      stopPlayback(false);
      setPlaybackStatus(`Playback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const seek = (time: number) => {
    if (playing) stopPlayback(false);
    setPosition(Math.max(0, Math.min(duration, time)));
  };

  const mutateTrack = (id: string, patch: Partial<Track>) => {
    const allowed = (({ name, color, mute, solo, armed, gain, pan }) =>
      ({ name, color, mute, solo, armed, gain, pan })) (patch);
    const changes = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
    execute(updateTrackEdit(id, changes));
  };

  const mutateClip = (trackId: string, clipId: string, patch: Partial<AudioClip>) => {
    const clip = project.tracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId);
    if (!clip) return;
    if (patch.start !== undefined && Object.keys(patch).length === 1) {
      execute(moveClipEdit(trackId, clipId, patch.start, project.transport.snapSeconds));
      return;
    }
    replaceProject("Update clip", (next) => {
      const target = next.tracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId);
      if (target) Object.assign(target, patch);
      appendAudit(next, "clip-updated", `Updated clip ${clip.name}`, { clipId });
    });
  };

  const setAutomationPoints = (nextPoints: AutomationPoint[]) => {
    replaceProject("Update automation", (next) => {
      let lane = next.automation.find((item) => item.target.kind === automationTarget.kind && item.target.ownerId === automationTarget.ownerId && item.target.parameterId === automationTarget.parameterId);
      if (!lane && automationTarget.ownerId) {
        const activeParameter = plugin?.id === next.tracks.flatMap((track) => track.inserts).find((insert) => insert.id === automationTarget.ownerId)?.pluginId ? plugin.parameters.find((item) => item.id === automationTarget.parameterId) : undefined;
        lane = { id: createId("lane"), target: automationTarget, enabled: true, defaultValue: activeParameter?.defaultValue ?? (automationTarget.parameterId === "gain" ? 1 : 0), points: [] };
        next.automation.push(lane);
      }
      if (lane) lane.points = [...nextPoints].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
      appendAudit(next, "automation-updated", `Updated ${automationTarget.parameterId} automation`, { trackId: automationTarget.ownerId });
    });
  };

  const routeSidechain = (destinationId: string, sourceId: string | null) => {
    replaceProject("Update sidechain", (next) => {
      next.routes = next.routes.filter((route) => route.destinationTrackId !== destinationId);
      const destination = next.tracks.find((track) => track.id === destinationId);
      const insert = destination?.inserts.find((item) => item.routing?.auxiliaryInput.supported);
      if (sourceId && insert) {
        const route: SidechainRoute = { id: createId("route"), sourceTrackId: sourceId, destinationTrackId: destinationId, pluginInstanceId: insert.id, enabled: true };
        next.routes.push(route);
      }
      appendAudit(next, "route-updated", sourceId ? "Assigned external sidechain route" : "Removed external sidechain route", { destinationTrackId: destinationId, sourceTrackId: sourceId });
    });
  };

  const startBounce = async () => {
    if (!databaseRef.current) { setBounce({ status: "failed", error: "IndexedDB is unavailable." }); return; }
    const controller = new AbortController();
    bounceAbortRef.current = controller;
    setBounce({ status: "rendering", progress: 0 });
    try {
      const range = bounceRangeMode === "selection" ? project.transport.loop : undefined;
      const result = await bounceProjectWithAudit(project, resolveAsset, {
        sampleRate: 48000, range, rangeMode: bounceRangeMode, tailSeconds: bounceTail, signal: controller.signal, onProgress: (progress) => setBounce({ status: "rendering", progress }),
      }, createActivePluginProcessor(plugin));
      const url = URL.createObjectURL(result.wav);
      const fileName = `${project.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "bounce"}.wav`;
      setBounce({ status: "complete", fileName, url, clipped: result.clippedSamples > 0, peak: result.peak });
      setProject(structuredClone(project));
      await save(project);
    } catch (error) {
      setProject(structuredClone(project));
      setBounce({ status: "failed", error: error instanceof DOMException && error.name === "AbortError" ? "Bounce cancelled." : error instanceof Error ? error.message : String(error) });
    } finally {
      bounceAbortRef.current = null;
    }
  };

  return (
    <div className="h-screen bg-neutral-950 text-neutral-200 flex flex-col font-sans selection:bg-orange-500/30">
      <header className="h-12 shrink-0 border-b border-neutral-800 px-3 flex items-center gap-3">
        <button data-testid="button-exit-daw" type="button" onClick={onExit} className="p-2 rounded hover:bg-neutral-800" aria-label="Back to plugin factory"><ChevronLeft className="w-4 h-4" /></button>
        <div className="w-7 h-7 rounded-lg bg-orange-500 text-neutral-950 flex items-center justify-center"><Sparkles className="w-4 h-4" /></div>
        <div><div className="text-[9px] uppercase tracking-[.18em] text-orange-400">OrangeJuce Studio</div><input data-testid="input-project-name" aria-label="Project name" value={project.name} onChange={(event) => replaceProject("Rename project", (next) => { next.name = event.target.value; appendAudit(next, "project-renamed", `Renamed project to ${event.target.value}`); })} className="bg-transparent text-sm font-semibold outline-none focus:ring-1 ring-orange-500 rounded" /></div>
        <div className="ml-auto flex items-center gap-3">
          <span data-testid="status-project-save" role="status" className="hidden md:block text-[9px] text-neutral-500 max-w-80 truncate">{storageStatus}</span>
          <button data-testid="button-save-project" type="button" disabled={loading} onClick={() => void save()} className="flex gap-1 items-center text-[10px] border border-neutral-700 rounded px-2.5 py-1.5 hover:bg-neutral-800 disabled:opacity-40"><FileClock className="w-3 h-3" /> Save project</button>
           <button data-testid="button-import-portable-project" type="button" disabled={loading} onClick={() => void importPortableBundle()} className="flex gap-1 items-center text-[10px] border border-neutral-700 rounded px-2.5 py-1.5 hover:bg-neutral-800 disabled:opacity-40"><FolderInput className="w-3 h-3" /> Import bundle</button>
           <button data-testid="button-export-portable-project" type="button" disabled={loading} onClick={() => void exportPortableBundle()} className="flex gap-1 items-center text-[10px] border border-neutral-700 rounded px-2.5 py-1.5 hover:bg-neutral-800 disabled:opacity-40"><FolderInput className="w-3 h-3" /> Export bundle</button>
          <span data-testid="status-playback-monitor" role="status" className="flex items-center gap-1 text-[9px] text-emerald-400"><Activity className="w-3 h-3" />{playbackStatus}</span>
        </div>
      </header>
      <TransportBar playing={playing} position={position} duration={duration} tempo={tempo} signature={signature} loop={project.transport.loop.enabled} metronome={project.transport.metronome} countIn={project.transport.countInBars > 0} loopStart={project.transport.loop.start} loopEnd={project.transport.loop.end} canUndo={historyRef.current.canUndo} canRedo={historyRef.current.canRedo}
        onPlayPause={() => void play()} onStop={() => stopPlayback()} onSeek={seek}
        onTempo={(value) => replaceProject("Set tempo", (next) => { next.transport.tempo[0].bpm = Math.max(30, Math.min(300, value || 120)); })}
        onSignature={(value) => replaceProject("Set time signature", (next) => { const [numerator, denominator] = value.split("/").map(Number); next.transport.timeSignature = { numerator, denominator }; next.transport.tempo[0] = { ...next.transport.tempo[0], numerator, denominator }; })}
        onLoop={() => replaceProject("Toggle loop", (next) => { next.transport.loop.enabled = !next.transport.loop.enabled; })}
        onMetronome={() => replaceProject("Toggle metronome", (next) => { next.transport.metronome = !next.transport.metronome; })}
        onCountIn={() => replaceProject("Toggle count-in", (next) => { next.transport.countInBars = next.transport.countInBars ? 0 : 1; })}
         onLoopRange={(start, end) => replaceProject("Set loop range", (next) => { next.transport.loop.start = Math.max(0, Math.min(start, end - .01)); next.transport.loop.end = Math.max(next.transport.loop.start + .01, end); })}
         onUndo={() => setProject((current) => { const next = historyRef.current.undo(current); projectRef.current = next; persistLocalEdit(next); return next; })}
         onRedo={() => setProject((current) => { const next = historyRef.current.redo(current); projectRef.current = next; persistLocalEdit(next); return next; })} />
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <ArrangementView tracks={project.tracks} assets={project.assets} duration={duration} position={position} zoom={zoom} snap={project.transport.snapSeconds} selectedClipId={selectedClipId}
            onAddTrack={() => { const track = createTrack(`Audio ${project.tracks.length + 1}`, project.tracks.length, ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#f43f5e"][project.tracks.length % 5] as `#${string}`); if (plugin && !plugin.isPlaceholder) track.inserts.push({ id: createId("insert"), pluginId: plugin.id, name: plugin.name, enabled: true, parameters: Object.fromEntries(plugin.parameters.map((parameter) => [parameter.id, parameter.value])), routing: plugin.routing }); execute(addTrackEdit(track)); }}
            onTrackChange={mutateTrack}
            onMoveTrack={(id, direction) => { const ordered = project.tracks.map((track) => track.id); const from = ordered.indexOf(id); const to = from + direction; if (to < 0 || to >= ordered.length) return; [ordered[from], ordered[to]] = [ordered[to], ordered[from]]; execute(reorderTracksEdit(ordered)); }}
            onDeleteTrack={(id) => execute(deleteTrackEdit(id))} onSelectClip={setSelectedClipId} onClipChange={mutateClip}
            onSplitClip={(trackId, clipId) => { const clip = project.tracks.find((track) => track.id === trackId)?.clips.find((item) => item.id === clipId); if (!clip) return; try { const halves = splitClip(clip, position); replaceProject("Split clip", (next) => { const track = next.tracks.find((item) => item.id === trackId); if (track) track.clips = track.clips.flatMap((item) => item.id === clipId ? halves : item); appendAudit(next, "clip-updated", `Split clip ${clip.name}`, { clipId }); }); } catch (error) { setPlaybackStatus(error instanceof Error ? error.message : String(error)); } }}
            onDeleteClip={(trackId, clipId) => { replaceProject("Delete clip", (next) => { const track = next.tracks.find((item) => item.id === trackId); if (track) track.clips = track.clips.filter((clip) => clip.id !== clipId); appendAudit(next, "clip-deleted", "Deleted clip", { clipId }); }); setSelectedClipId(null); }}
            onSeek={seek} onZoom={setZoom} onSnap={(snap) => replaceProject("Set snap grid", (next) => { next.transport.snapSeconds = snap; })} />
          <div className="h-56 shrink-0 border-t border-neutral-800">
            <div className="h-8 flex border-b border-neutral-800 px-2 gap-1">
              <button data-testid="button-show-mixer" type="button" onClick={() => setBottomView("mixer")} className={`px-3 text-[10px] flex gap-1 items-center ${bottomView === "mixer" ? "text-orange-400 border-b border-orange-400" : "text-neutral-500"}`}><SlidersHorizontal className="w-3 h-3" /> Mixer</button>
              <button data-testid="button-show-inspector" type="button" onClick={() => setBottomView("inspector")} className={`px-3 text-[10px] flex gap-1 items-center ${bottomView === "inspector" ? "text-orange-400 border-b border-orange-400" : "text-neutral-500"}`}><FolderInput className="w-3 h-3" /> Automation</button>
            </div>
            <div className="h-[calc(100%-2rem)]">{bottomView === "mixer"
               ? <MixerView tracks={project.tracks} sidechains={sidechains} meters={meters} buses={project.buses} onChange={mutateTrack}
                  onSend={(id, gain) => replaceProject("Set send", (next) => { const track = next.tracks.find((item) => item.id === id); if (!track) return; const send = track.sends.find((item) => item.busId === RETURN_BUS_ID); if (send) send.gain = gain; else track.sends.push({ busId: RETURN_BUS_ID, gain, preFader: false }); })}
                   onSidechain={routeSidechain}
                   onBusChange={(id, patch) => replaceProject("Update bus", (next) => { const bus = next.buses.find((item) => item.id === id); if (bus) Object.assign(bus, patch); })} />
               : <AutomationPanel tracks={project.tracks} trackId={automationTrackId} parameter={automationParameter} points={points} onTrack={(id) => { setAutomationTrackId(id); setAutomationTarget({ kind: "track", ownerId: id, parameterId: automationParameter }); }} onParameter={(parameter) => { setAutomationParameter(parameter); setAutomationTarget({ kind: "track", ownerId: automationTrackId ?? "", parameterId: parameter }); }} selectedTarget={automationTarget} onTarget={setAutomationTarget}
                   parameterRanges={Object.fromEntries(project.tracks.flatMap((track) => track.inserts.filter((insert) => insert.pluginId === plugin?.id).flatMap((insert) => plugin?.parameters.map((parameter) => [`${insert.id}:${parameter.id}`, { min: parameter.min, max: parameter.max }]) ?? [])))}
                   onAdd={() => { const active = plugin?.parameters.find((item) => item.id === automationTarget.parameterId); setAutomationPoints([...points, { id: createId("point"), time: position, value: active?.defaultValue ?? (automationTarget.parameterId === "gain" ? 1 : 0), curve: "linear" }]); }}
                  onChange={(id, patch) => setAutomationPoints(points.map((point) => point.id === id ? { ...point, ...patch } : point))}
                  onDelete={(id) => setAutomationPoints(points.filter((point) => point.id !== id))} />}
            </div>
          </div>
        </div>
        <aside className="w-72 shrink-0 border-l border-neutral-800 flex flex-col">
          <SyncPanel state={syncState} signedIn={Boolean(isSignedIn)}
            onEnable={() => void syncRef.current?.enable(projectRef.current)}
            onDisable={() => void syncRef.current?.disable(projectRef.current.id)}
            onRetry={() => void syncRef.current?.flush(projectRef.current.id)}
            onResolve={(choice) => void syncRef.current?.resolve(projectRef.current.id, choice).then((chosen) => { if (chosen) setProject(chosen); })} />
          <nav aria-label="Studio detail panels" className="h-9 flex border-b border-neutral-800">
            {(["capture", "automation", "audit", "bounce"] as InspectorTab[]).map((tab) => <button data-testid={`button-panel-${tab}`} type="button" key={tab} onClick={() => { setInspectorTab(tab); if (tab === "automation") setBottomView("inspector"); }} className={`flex-1 text-[9px] uppercase ${inspectorTab === tab ? "text-orange-400 bg-neutral-900" : "text-neutral-500"}`}>{tab}</button>)}
          </nav>
          {graph.warnings.length > 0 && <div data-testid="status-routing-warnings" role="status" className="p-2 text-[9px] text-amber-400 border-b border-neutral-800">{graph.warnings.join(" · ")}</div>}
          <div className="flex-1 min-h-0">{inspectorTab === "capture"
            ? <ImportRecordPanel armedTrackName={armed.length === 1 ? armed[0].name : null} onAudio={(audio) => void addAudio(audio)} />
            : inspectorTab === "automation"
              ? <section aria-label="Automation panel location" className="p-4"><h2 className="text-xs font-semibold uppercase">Automation</h2><p className="text-[11px] text-neutral-400 mt-2">Edit deterministic track automation below the arrangement.</p><button data-testid="button-focus-automation-editor" type="button" onClick={() => setBottomView("inspector")} className="mt-3 text-xs px-3 py-2 bg-neutral-800 rounded hover:bg-neutral-700">Show automation editor</button></section>
              : inspectorTab === "audit"
                ? <AuditEventView events={[...project.audit].reverse()} />
                 : <BounceStatusPanel state={bounce} hasClips={project.tracks.some((track) => track.clips.length > 0)} onBounce={() => void startBounce()} onCancel={() => { bounceAbortRef.current?.abort(); }} rangeMode={bounceRangeMode} tailSeconds={bounceTail} onRangeMode={setBounceRangeMode} onTailSeconds={setBounceTail} rangeLabel={bounceRangeMode === "selection" ? `Loop ${project.transport.loop.start.toFixed(2)}–${project.transport.loop.end.toFixed(2)}s` : "Full arrangement"} />}
          </div>
        </aside>
      </div>
    </div>
  );
}