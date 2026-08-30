import { appendAudit, DAW_PROJECT_VERSION, type DawProject } from "./model";

const DB_NAME = "autonomous-audio-daw";
const DB_VERSION = 4;
const PROJECTS = "projects";
const ASSETS = "assets";
const RECOVERY = "project-recovery";
const SYNC = "sync-state";

export interface StoredAsset {
  projectId: string;
  assetId: string;
  blob: Blob;
}

export interface StoredSyncState {
  projectId: string;
  ownerUserId?: string;
  enabled: boolean;
  remoteRevision: number | null;
  localRevision?: number;
  dirty: boolean;
  pendingAssetIds: string[];
  assetVersions?: Record<string, string>;
  uploads?: Record<string, { uploadId: string; offset: number; size: number; mimeType: string }>;
  downloads?: Record<string, { version: string; offset: number; total: number; chunks: Blob[] }>;
  conflict?: { local: DawProject; remote: DawProject; remoteRevision: number; remoteAssetVersions?: Record<string, string>; detectedAt: string };
  retryAt?: string;
}

type LegacyProject = Partial<DawProject> & { version?: number };

export function migrateProject(input: unknown): DawProject {
  if (!input || typeof input !== "object") throw new Error("Project data is not an object");
  const project = structuredClone(input) as LegacyProject;
  const version = project.version ?? 1;
  if (version > DAW_PROJECT_VERSION) throw new Error(`Project version ${version} is newer than supported version ${DAW_PROJECT_VERSION}`);
  if (version < 2) {
    project.routes ??= [];
    project.automation ??= [];
    project.markers ??= [];
    project.audit ??= [];
  }
  if (version < 3) {
    project.revision ??= 0;
    project.assets ??= [];
    project.buses ??= [{ id: "master", kind: "master", name: "Master", gain: 1, pan: 0, inserts: [] }];
    if (project.transport) {
      project.transport.countInBars ??= 0;
      project.transport.snapSeconds ??= 0.25;
    }
  }
  project.version = DAW_PROJECT_VERSION;
  if (!project.id || !project.name || !Array.isArray(project.tracks) || !project.transport) {
    throw new Error("Project is missing required fields");
  }
  project.audit ??= [];
  project.routes ??= [];
  project.automation ??= [];
  project.assets ??= [];
  project.markers ??= [];
  return project as DawProject;
}

export function recoverProjectCandidates(
  saved: unknown,
  recovery: unknown,
): { project: DawProject | null; recovered: boolean } {
  if (!saved && !recovery) return { project: null, recovered: false };
  const candidates = [
    recovery && { value: recovery, recovered: true, revision: Number((recovery as Partial<DawProject>).revision ?? -1) },
    saved && { value: saved, recovered: false, revision: Number((saved as Partial<DawProject>).revision ?? -1) },
  ].filter(Boolean) as Array<{ value: unknown; recovered: boolean; revision: number }>;
  candidates.sort((a, b) => b.revision - a.revision || Number(b.recovered) - Number(a.recovered));
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return { project: migrateProject(candidate.value), recovered: candidate.recovered };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`Project is corrupted: ${errors.join("; ")}`);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export class DawDatabase {
  private operationQueue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<DawDatabase> {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: ["projectId", "assetId"] });
      if (!db.objectStoreNames.contains(RECOVERY)) db.createObjectStore(RECOVERY, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC, { keyPath: "projectId" });
    };
    return new DawDatabase(await requestResult(request));
  }

  async saveProject(project: DawProject, recordAudit = true): Promise<void> {
    const migrated = migrateProject(project);
    if (recordAudit) appendAudit(migrated, "project-saved", "Saved project", { revision: migrated.revision + 1 });
    // Recovery is committed first. A crash between transactions leaves a
    // complete journal record that loadProject can prefer.
    await this.put(RECOVERY, { ...migrated, recoveryRevision: migrated.revision });
    await this.put(PROJECTS, migrated);
    await this.delete(RECOVERY, migrated.id);
    Object.assign(project, migrated);
  }

  async loadProject(id: string): Promise<{ project: DawProject | null; recovered: boolean }> {
    const [saved, recovery] = await Promise.all([this.get(PROJECTS, id), this.get(RECOVERY, id)]);
    try {
      const result = recoverProjectCandidates(saved, recovery);
      if (result.recovered && result.project) {
        appendAudit(result.project, "project-recovered", "Recovered interrupted project save",
          { revision: result.project.revision }, new Date().toISOString(), "system");
        await this.put(PROJECTS, result.project);
        await this.delete(RECOVERY, id);
      }
      return result;
    }
    catch (error) { throw new Error(`Project ${id} is corrupted: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async putAsset(asset: StoredAsset) { await this.put(ASSETS, asset); }
  async listAssets(projectId: string): Promise<StoredAsset[]> {
    const tx = this.db.transaction(ASSETS, "readonly");
    const range = IDBKeyRange.bound([projectId, ""], [projectId, "\uffff"]);
    return requestResult(tx.objectStore(ASSETS).getAll(range)) as Promise<StoredAsset[]>;
  }
  async getAsset(projectId: string, assetId: string): Promise<Blob | null> {
    const value = await this.get(ASSETS, [projectId, assetId]) as StoredAsset | undefined;
    return value?.blob ?? null;
  }
  async deleteProject(id: string): Promise<void> {
    await Promise.all([this.delete(PROJECTS, id), this.delete(RECOVERY, id), this.delete(SYNC, id)]);
    const tx = this.db.transaction(ASSETS, "readwrite");
    const store = tx.objectStore(ASSETS);
    const range = IDBKeyRange.bound([id, ""], [id, "\uffff"]);
    await new Promise<void>((resolve, reject) => {
      const cursor = store.openCursor(range);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        if (cursor.result) { cursor.result.delete(); cursor.result.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  close() { this.db.close(); }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.catch(() => undefined).then(operation);
    this.operationQueue = result;
    return result;
  }

  async getSyncState(projectId: string): Promise<StoredSyncState | null> {
    return await this.get(SYNC, projectId) as StoredSyncState | null;
  }
  async putSyncState(state: StoredSyncState): Promise<void> { await this.put(SYNC, state); }

  private async get(store: string, key: IDBValidKey): Promise<unknown> {
    return requestResult(this.db.transaction(store, "readonly").objectStore(store).get(key));
  }
  private async put(store: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await transactionComplete(tx);
  }
  private async delete(store: string, key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await transactionComplete(tx);
  }
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}