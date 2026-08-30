import { appendAudit, type DawProject, type ProjectSyncState } from "./model";
import { DawDatabase, type StoredSyncState } from "./persistence";

export interface RemoteProject {
  project: DawProject;
  revision: number;
  missingAssetIds: string[];
  assetVersions?: Record<string, string>;
}

export interface SyncTransport {
  getProject(projectId: string): Promise<RemoteProject | null>;
  putProject(project: DawProject, baseRevision: number | null, assetVersions: Record<string, string>): Promise<{ revision: number; missingAssetIds: string[] }>;
  uploadAsset(projectId: string, assetId: string, blob: Blob, checkpoint: { uploadId: string; offset: number } | undefined, onProgress: (sent: number) => void, onCheckpoint: (uploadId: string, offset: number) => Promise<void>): Promise<string>;
  downloadAsset(projectId: string, assetId: string, version: string, offset: number, onChunk: (chunk: Blob, offset: number, total: number) => Promise<void>): Promise<void>;
}

export class SyncConflictError extends Error {
  constructor(readonly remote: RemoteProject) {
    super("The cloud copy changed on another device.");
    this.name = "SyncConflictError";
  }
}

export class SyncQuotaError extends Error {
  constructor(message = "Cloud storage quota is full.") { super(message); this.name = "SyncQuotaError"; }
}

export class HttpSyncTransport implements SyncTransport {
  private readonly chunkSize = 5 * 1024 * 1024;
  constructor(private readonly base = "/api/daw-sync") {}
  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${this.base}${path}`, { credentials: "same-origin", ...init });
    if (response.status === 401) throw new Error("Sign in before enabling cloud sync.");
    if (response.status === 409) throw new SyncConflictError(await response.json());
    if (response.status === 413 || response.status === 507) throw new SyncQuotaError();
    if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => null))?.error || `Cloud sync failed (${response.status}).`), { status: response.status });
    return response;
  }
  async getProject(id: string) {
    const response = await this.request(`/projects/${encodeURIComponent(id)}`);
    return response.status === 204 ? null : response.json();
  }
  async putProject(project: DawProject, baseRevision: number | null, assetVersions: Record<string, string>) {
    return (await this.request(`/projects/${encodeURIComponent(project.id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, baseRevision, assetVersions }),
    })).json();
  }
  async uploadAsset(projectId: string, assetId: string, blob: Blob, checkpoint: { uploadId: string; offset: number } | undefined, onProgress: (sent: number) => void, onCheckpoint: (uploadId: string, offset: number) => Promise<void>) {
    let uploadId = checkpoint?.uploadId;
    let offset = checkpoint?.offset ?? 0;
    if (uploadId) {
      try {
        const status = await (await this.request(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/uploads/${encodeURIComponent(uploadId)}`)).json();
        offset = Number(status.offset);
      } catch (error) {
        if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
        uploadId = undefined; offset = 0;
      }
    }
    if (!uploadId) {
      const created = await (await this.request(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/uploads`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size: blob.size, mimeType: blob.type || "application/octet-stream" }),
      })).json();
      uploadId = created.uploadId;
      await onCheckpoint(uploadId!, 0);
    }
    while (offset < blob.size) {
      const end = Math.min(blob.size, offset + this.chunkSize);
      const chunk = blob.slice(offset, end);
      await this.request(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/uploads/${encodeURIComponent(uploadId!)}/chunks`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}` }, body: chunk,
      });
      offset = end; onProgress(offset); await onCheckpoint(uploadId!, offset);
    }
    await this.request(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/uploads/${encodeURIComponent(uploadId!)}/complete`, { method: "POST" });
    return uploadId!;
  }
  async downloadAsset(projectId: string, assetId: string, version: string, initialOffset: number, onChunk: (chunk: Blob, offset: number, total: number) => Promise<void>) {
    let offset = initialOffset;
    while (true) {
      const response = await this.request(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(version)}`, {
        headers: { Range: `bytes=${offset}-${offset + this.chunkSize - 1}` },
      });
      const chunk = await response.blob();
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
      if (!range || Number(range[1]) !== offset || Number(range[2]) - Number(range[1]) + 1 !== chunk.size) throw new Error("Cloud audio returned an invalid resume range.");
      const total = Number(range[3]);
      offset += chunk.size;
      await onChunk(chunk, offset, total);
      if (!chunk.size || offset >= total) return;
    }
  }
}

const status = (phase: ProjectSyncState["phase"], state: StoredSyncState, message: string, extra: Partial<ProjectSyncState> = {}): ProjectSyncState => ({
  enabled: state.enabled, phase, remoteRevision: state.remoteRevision,
  pendingAssets: state.pendingAssetIds.length, transferredBytes: 0, totalBytes: 0, message, retryAt: state.retryAt, ...extra,
});

export class ProjectSyncManager {
  private running = false;
  private userId: string | null = null;
  private localEditsInFlight = 0;
  constructor(
    private readonly db: DawDatabase,
    private readonly transport: SyncTransport,
    private readonly report: (state: ProjectSyncState) => void,
    private readonly applyRemote: (project: DawProject) => void = () => undefined,
    private readonly activeProject: () => DawProject | null = () => null,
  ) {}

  setIdentity(userId: string | null) { this.userId = userId; }
  beginLocalEdit() {
    this.localEditsInFlight++;
    return () => { this.localEditsInFlight = Math.max(0, this.localEditsInFlight - 1); };
  }

  async initialize(projectId: string, userId = this.userId) {
    this.userId = userId;
    const state = await this.db.getSyncState(projectId);
    if (state?.enabled && state.ownerUserId !== userId) {
      this.report({ enabled: false, phase: "local-only", remoteRevision: null, pendingAssets: state.pendingAssetIds.length, transferredBytes: 0, totalBytes: 0, message: userId ? "This device’s sync belongs to another account. Enable sync to start a separate cloud copy." : "Sign in to resume this project’s cloud sync." });
      return;
    }
    if (state?.enabled && state.ownerUserId === userId) {
      const local = await this.db.loadProject(projectId);
      if (local.project && state.localRevision !== undefined && local.project.revision !== state.localRevision) {
        this.report({ enabled: false, phase: "local-only", remoteRevision: state.remoteRevision, pendingAssets: state.pendingAssetIds.length, transferredBytes: 0, totalBytes: 0, message: "The local project changed while another account was active. Review it and explicitly enable sync before uploading." });
        return;
      }
    }
    this.report(state ? status(state.conflict ? "conflict" : state.dirty ? "pending" : "synced", state, state.conflict ? "Choose which copy to keep." : state.dirty ? "Local changes are waiting to upload." : "Cloud copy is up to date.") : {
      enabled: false, phase: "local-only", remoteRevision: null, pendingAssets: 0, transferredBytes: 0, totalBytes: 0, message: "Saved on this device only.",
    });
    if (state?.enabled && !state.conflict) await this.flush(projectId);
  }

  async enable(project: DawProject) {
    if (!this.userId) throw new Error("Sign in before enabling cloud sync.");
    const assets = await this.db.listAssets(project.id);
    const state: StoredSyncState = { projectId: project.id, ownerUserId: this.userId, enabled: true, remoteRevision: null, localRevision: project.revision, dirty: true, pendingAssetIds: assets.map((a) => a.assetId), assetVersions: {}, uploads: {}, downloads: {} };
    appendAudit(project, "sync-enabled", "Enabled authenticated cloud sync");
    await this.db.saveProject(project);
    await this.db.putSyncState(state);
    await this.flush(project.id);
  }

  async disable(projectId: string) {
    const current = await this.db.getSyncState(projectId);
    const state: StoredSyncState = { projectId, ownerUserId: current?.ownerUserId, enabled: false, remoteRevision: current?.remoteRevision ?? null, localRevision: current?.localRevision, dirty: current?.dirty ?? false, pendingAssetIds: current?.pendingAssetIds ?? [], assetVersions: current?.assetVersions, uploads: current?.uploads, downloads: current?.downloads };
    await this.db.putSyncState(state);
    this.report(status("local-only", state, "Cloud sync is off. Local files remain available."));
  }

  async markDirty(project: DawProject, assetId?: string) {
    const current = await this.db.getSyncState(project.id);
    if (!current?.enabled || !this.userId || current.ownerUserId !== this.userId) return;
    current.dirty = true;
    current.localRevision = project.revision;
    if (assetId && !current.pendingAssetIds.includes(assetId)) current.pendingAssetIds.push(assetId);
    await this.db.putSyncState(current);
    this.report(status(navigator.onLine ? "pending" : "offline", current, navigator.onLine ? "Local changes are waiting to upload." : "Offline. Local changes are safe and will wait."));
  }

  async flush(projectId: string) {
    if (this.running) return;
    this.running = true;
    try { await this.db.exclusive(() => this.flushExclusive(projectId)); }
    finally { this.running = false; }
  }

  private async flushExclusive(projectId: string) {
    const state = await this.db.getSyncState(projectId);
    if (!state?.enabled || state.conflict || !this.userId || state.ownerUserId !== this.userId) return;
    if (this.localEditsInFlight > 0) {
      this.report(status("pending", state, "Finishing the local save before checking the cloud copy."));
      return;
    }
    if (!navigator.onLine) { this.report(status("offline", state, "Offline. Local changes are safe and will wait.")); return; }
    const loaded = await this.db.loadProject(projectId);
    if (!loaded.project) return;
    try {
      this.report(status("syncing", state, "Checking the cloud copy…"));
      const remote = await this.transport.getProject(projectId);
      if (state.dirty && remote && remote.revision !== state.remoteRevision) throw new SyncConflictError(remote);
      if (!state.dirty && remote && remote.revision > (state.remoteRevision ?? -1)) {
        await this.download(remote, state);
        return;
      }
      const assets = await this.db.listAssets(projectId);
      const pending = assets.filter((asset) => state.pendingAssetIds.includes(asset.assetId));
      const total = pending.reduce((sum, asset) => sum + asset.blob.size, 0);
      let transferred = 0;
      for (const asset of pending) {
        const checkpoint = state.uploads?.[asset.assetId];
        const uploadId = await this.transport.uploadAsset(projectId, asset.assetId, asset.blob, checkpoint, (sent) => {
          this.report(status("syncing", state, `Uploading ${asset.assetId}…`, { totalBytes: total, transferredBytes: transferred + sent }));
        }, async (id, offset) => {
          state.uploads ??= {};
          state.uploads[asset.assetId] = { uploadId: id, offset, size: asset.blob.size, mimeType: asset.blob.type };
          await this.persistState(state);
        });
        state.assetVersions ??= {};
        state.assetVersions[asset.assetId] = uploadId;
        if (state.uploads) delete state.uploads[asset.assetId];
        transferred += asset.blob.size;
        state.pendingAssetIds = state.pendingAssetIds.filter((id) => id !== asset.assetId);
        await this.persistState(state);
      }
      const result = await this.transport.putProject(loaded.project, state.remoteRevision, state.assetVersions ?? {});
      state.remoteRevision = result.revision; state.dirty = false; state.retryAt = undefined;
      appendAudit(loaded.project, "sync-uploaded", "Uploaded project to cloud", { remoteRevision: result.revision });
      await this.db.saveProject(loaded.project); state.localRevision = loaded.project.revision; await this.persistState(state);
      this.report(status("synced", state, "Cloud copy is up to date.", { transferredBytes: transferred, totalBytes: total }));
    } catch (error) {
      if (error instanceof SyncConflictError) {
        const local = structuredClone(this.activeProject() ?? loaded.project);
        state.conflict = { local, remote: error.remote.project, remoteRevision: error.remote.revision, remoteAssetVersions: error.remote.assetVersions, detectedAt: new Date().toISOString() };
        appendAudit(local, "sync-conflict", "Cloud sync paused for conflict", { remoteRevision: error.remote.revision });
        await this.db.saveProject(local); await this.persistState(state);
        this.report(status("conflict", state, "Another device has a newer copy. Choose local or cloud; nothing was overwritten."));
      } else {
        let failure = error;
        state.retryAt = new Date(Date.now() + 30_000).toISOString();
        try { await this.persistState(state); } catch (checkpointError) { failure = checkpointError; }
        this.report(status(failure instanceof SyncQuotaError ? "quota" : "error", state, `${failure instanceof Error ? failure.message : String(failure)} Retry is available and local work is safe.`));
      }
    }
  }

  async resolve(projectId: string, choice: "local" | "remote"): Promise<DawProject | null> {
    const state = await this.db.getSyncState(projectId);
    if (!state?.conflict) return null;
    const conflict = state.conflict;
    const chosen = structuredClone(choice === "local" ? conflict.local : conflict.remote);
    state.remoteRevision = conflict.remoteRevision;
    state.conflict = undefined;
    state.dirty = choice === "local";
    if (choice === "remote") await this.download({ project: chosen, revision: state.remoteRevision, missingAssetIds: chosen.assets.map((a) => a.id), assetVersions: conflict.remoteAssetVersions }, state);
    else { await this.db.saveProject(chosen); await this.persistState(state); await this.flush(projectId); }
    return chosen;
  }

  private async download(remote: RemoteProject, state: StoredSyncState) {
    let transferred = 0;
    const present = new Set((await this.db.listAssets(remote.project.id)).map((a) => a.assetId));
    const ids = remote.project.assets.map((a) => a.id).filter((id) => !present.has(id) || state.assetVersions?.[id] !== remote.assetVersions?.[id]);
    const total = remote.project.assets.filter((a) => ids.includes(a.id)).reduce((sum, a) => sum + a.byteLength, 0);
    for (const id of ids) {
      state.downloads ??= {};
      const version = remote.assetVersions?.[id];
      if (!version) throw new Error(`Cloud project is missing the immutable version for audio asset ${id}.`);
      let checkpoint = state.downloads[id];
      if (!checkpoint || checkpoint.version !== version) {
        checkpoint = { version, offset: 0, total: remote.project.assets.find((a) => a.id === id)?.byteLength ?? 0, chunks: [] };
        state.downloads[id] = checkpoint;
        await this.persistState(state);
      }
      if (checkpoint.offset < checkpoint.total || checkpoint.total === 0) {
        await this.transport.downloadAsset(remote.project.id, id, version, checkpoint.offset, async (chunk, offset, assetTotal) => {
          checkpoint.chunks.push(chunk); checkpoint.offset = offset; checkpoint.total = assetTotal; state.downloads![id] = checkpoint;
          try { await this.persistState(state); }
          catch (error) { checkpoint.chunks.pop(); checkpoint.offset -= chunk.size; throw error; }
          this.report(status("syncing", state, `Downloading ${id}…`, { transferredBytes: transferred + offset, totalBytes: total }));
        });
      }
      const blob = new Blob(checkpoint.chunks, { type: remote.project.assets.find((a) => a.id === id)?.mimeType });
      try { await this.db.putAsset({ projectId: remote.project.id, assetId: id, blob }); }
      catch (error) {
        if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "UnknownError")) throw new SyncQuotaError("This device does not have enough local storage for the cloud audio.");
        throw error;
      }
      transferred += blob.size; delete state.downloads[id]; await this.persistState(state);
    }
    appendAudit(remote.project, "sync-downloaded", "Downloaded newer cloud project", { remoteRevision: remote.revision });
    if (this.localEditsInFlight > 0) throw new SyncConflictError(remote);
    state.remoteRevision = remote.revision; state.assetVersions = remote.assetVersions ?? {}; state.dirty = false; state.conflict = undefined;
    await this.db.saveProject(remote.project); state.localRevision = remote.project.revision; await this.persistState(state);
    this.applyRemote(structuredClone(remote.project));
    this.report(status("synced", state, "Downloaded the newer cloud copy.", { transferredBytes: transferred, totalBytes: total }));
  }

  private async persistState(state: StoredSyncState) {
    try { await this.db.putSyncState(state); }
    catch (error) {
      if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "UnknownError")) {
        throw new SyncQuotaError("This device does not have enough local storage to checkpoint the transfer.");
      }
      throw error;
    }
  }
}