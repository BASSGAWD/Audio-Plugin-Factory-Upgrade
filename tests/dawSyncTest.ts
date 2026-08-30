import assert from "node:assert/strict";
import { createProject, type DawProject, type ProjectSyncState } from "../src/daw/model";
import { ProjectSyncManager, SyncConflictError, SyncQuotaError, type RemoteProject, type SyncTransport } from "../src/daw/sync";
import type { StoredAsset, StoredSyncState } from "../src/daw/persistence";

Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });

class FakeDatabase {
  project: DawProject;
  sync: StoredSyncState | null = null;
  assets: StoredAsset[] = [];
  constructor(project: DawProject) { this.project = structuredClone(project); }
  async getSyncState() { return this.sync ? structuredClone(this.sync) : null; }
  async putSyncState(state: StoredSyncState) { this.sync = structuredClone(state); }
  async listAssets() { return this.assets.map((asset) => ({ ...asset })); }
  async putAsset(asset: StoredAsset) { this.assets.push(asset); }
  async loadProject() { return { project: structuredClone(this.project), recovered: false }; }
  async saveProject(project: DawProject) { this.project = structuredClone(project); }
  async exclusive<T>(operation: () => Promise<T>) { return operation(); }
}

class FakeTransport implements SyncTransport {
  remote: RemoteProject | null = null;
  uploaded: string[] = [];
  quota = false;
  async getProject() { return this.remote ? structuredClone(this.remote) : null; }
  async putProject(project: DawProject, baseRevision: number | null, assetVersions: Record<string, string>) {
    if (this.remote && baseRevision !== this.remote.revision) throw new SyncConflictError(this.remote);
    const revision = (this.remote?.revision ?? 0) + 1;
    this.remote = { project: structuredClone(project), revision, missingAssetIds: [], assetVersions };
    return { revision, missingAssetIds: [] };
  }
  async uploadAsset(_projectId: string, assetId: string, blob: Blob, checkpoint: { uploadId: string; offset: number } | undefined, progress: (sent: number) => void, save: (id: string, offset: number) => Promise<void>) {
    if (this.quota) throw new SyncQuotaError();
    const id = checkpoint?.uploadId ?? `upload-${assetId}`;
    await save(id, blob.size); this.uploaded.push(assetId); progress(blob.size); return id;
  }
  async downloadAsset(_projectId: string, _assetId: string, _version: string, offset: number, onChunk: (chunk: Blob, offset: number, total: number) => Promise<void>) {
    const blob = new Blob(["remote"]); await onChunk(blob.slice(offset), blob.size, blob.size);
  }
}

const project = createProject("Local");
project.assets.push({ id: "asset-a", name: "take.wav", mimeType: "audio/wav", sampleRate: 48_000, channels: 1, frames: 4, duration: 4 / 48_000, createdAt: project.createdAt, byteLength: 4 });
const db = new FakeDatabase(project);
db.assets.push({ projectId: project.id, assetId: "asset-a", blob: new Blob(["take"]) });
const transport = new FakeTransport();
let latest: ProjectSyncState | undefined;
const manager = new ProjectSyncManager(db as never, transport, (next) => { latest = next; });
manager.setIdentity("user-a");

await manager.enable(project);
assert.equal(latest?.phase, "synced");
assert.deepEqual(transport.uploaded, ["asset-a"]);
assert.equal(db.sync?.dirty, false);
assert.deepEqual(db.sync?.pendingAssetIds, []);
assert.equal(db.sync?.ownerUserId, "user-a");

manager.setIdentity("user-b");
await manager.initialize(project.id, "user-b");
assert.equal(latest?.enabled, false, "another account never auto-resumes the first user's outbox");
db.project.name = "Other account local edit";
db.project.revision++;
await manager.markDirty(db.project);
assert.equal(db.sync?.dirty, false, "another account cannot mutate the owner's outbox");
manager.setIdentity("user-a");
await manager.initialize(project.id, "user-a");
assert.equal(latest?.enabled, false, "owner must explicitly review local revision drift before upload");
db.project = structuredClone(project);
db.sync!.localRevision = db.project.revision;

db.project.name = "Local edit";
await manager.markDirty(db.project);
transport.remote = { project: createProject("Remote edit"), revision: (db.sync?.remoteRevision ?? 0) + 1, missingAssetIds: [] };
const uploadsBeforeConflict = [...transport.uploaded];
await manager.flush(project.id);
assert.equal(latest?.phase, "conflict");
assert.deepEqual(transport.uploaded, uploadsBeforeConflict, "a stale project is rejected before any audio upload");
assert.equal(db.sync?.conflict?.local.name, "Local edit");
assert.equal(db.sync?.conflict?.remote.name, "Remote edit");

const chosen = await manager.resolve(project.id, "remote");
assert.equal(chosen?.name, "Remote edit");
assert.equal(latest?.phase, "synced");

db.sync = { projectId: project.id, ownerUserId: "user-a", enabled: true, remoteRevision: db.sync?.remoteRevision ?? 1, dirty: true, pendingAssetIds: ["asset-a"] };
transport.quota = true;
await manager.flush(project.id);
assert.equal(latest?.phase, "quota");
assert.deepEqual(db.sync.pendingAssetIds, ["asset-a"], "failed uploads remain resumable");

console.log("dawSyncTest: authenticated transport boundary, conflicts, quota, and resumable queue assertions passed");