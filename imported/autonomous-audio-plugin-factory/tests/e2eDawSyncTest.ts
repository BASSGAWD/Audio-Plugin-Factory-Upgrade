import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";
import { Storage } from "@google-cloud/storage";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:80";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DB_NAME = "autonomous-audio-daw";
const PROJECTS = "projects";
const ASSETS = "assets";
const SYNC = "sync-state";
const CHUNK_BYTES = 5 * 1024 * 1024;

if (!CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY is required for the signed-in DAW sync integration test.");

type TestUser = { id: string };
type SyncRecord = {
  ownerUserId?: string;
  enabled: boolean;
  remoteRevision: number | null;
  localRevision?: number;
  dirty: boolean;
  pendingAssetIds: string[];
  uploads?: Record<string, { uploadId: string; offset: number }>;
  downloads?: Record<string, { version: string; offset: number; total: number; chunks: Blob[] }>;
  conflict?: { local: { name: string }; remote: { name: string } };
};

async function clerkRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Clerk ${init.method || "GET"} ${path} failed (${response.status}): ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function createUser(label: string): Promise<TestUser> {
  const suffix = randomBytes(6).toString("hex");
  const email = `${label}+clerk_test_${suffix}@example.com`;
  const password = `Oj!${randomBytes(12).toString("base64url")}9`;
  const user = await clerkRequest("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], password, skip_password_checks: true }),
  }) as { id: string };
  return { id: user.id };
}

async function signIn(page: Page, user: TestUser) {
  const signInToken = await clerkRequest("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 60 }),
  }) as { token: string };
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => Boolean((window as any).Clerk?.loaded), undefined, { timeout: 30_000 });
  if (await page.evaluate(() => Boolean((window as any).Clerk?.user))) {
    await page.evaluate(() => (window as any).Clerk.signOut()).catch(() => undefined);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).Clerk?.loaded), undefined, { timeout: 30_000 });
  }
  await page.evaluate(async (ticket) => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket });
    if (attempt.status !== "complete" || !attempt.createdSessionId) {
      throw new Error(`Clerk sign-in did not complete (${attempt.status}).`);
    }
    await clerk.setActive({ session: attempt.createdSessionId });
  }, signInToken.token);
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function openDaw(page: Page) {
  if (!await page.getByRole("region", { name: "Arrangement" }).count()) {
    await page.getByRole("button", { name: "Pro mode" }).click();
    await page.getByTestId("button-open-daw-pro").click();
  }
  await page.getByRole("region", { name: "Arrangement" }).waitFor({ timeout: 30_000 });
}

async function idbGet<T>(page: Page, store: string, key: IDBValidKey): Promise<T | null> {
  const input: any = { database: DB_NAME, storeName: store, recordKey: key };
  return page.evaluate(async (rawInput: any) => new Promise<any>((resolve, reject) => {
    const { database, storeName, recordKey } = rawInput;
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(recordKey);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
    };
  }), input);
}

async function idbPut(page: Page, store: string, value: unknown) {
  await page.evaluate(async ({ database, storeName, record }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), { database: DB_NAME, storeName: store, record: value });
}

async function firstProject(page: Page): Promise<any> {
  return page.evaluate(async ({ database, storeName }) => new Promise<any>((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { db.close(); resolve(request.result[0] ?? null); };
    };
  }), { database: DB_NAME, storeName: PROJECTS });
}

async function projectAssets(page: Page, projectId: string): Promise<Array<{ projectId: string; assetId: string; size: number }>> {
  return page.evaluate(async ({ database, storeName, id }) => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result
          .filter((asset: { projectId: string }) => asset.projectId === id)
          .map((asset: { projectId: string; assetId: string; blob: Blob }) => ({
            projectId: asset.projectId, assetId: asset.assetId, size: asset.blob.size,
          })));
      };
    };
  }), { database: DB_NAME, storeName: ASSETS, id: projectId });
}

function wavFixture(byteLength = 10 * 1024 * 1024 + 98_348) {
  const payloadBytes = byteLength - 44;
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  const sampleRate = 48_000;
  bytes.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, byteLength - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36); view.setUint32(40, payloadBytes, true);
  for (let index = 44; index < bytes.length; index += 2) view.setInt16(index, index % 192 < 96 ? 5000 : -5000, true);
  return Buffer.from(bytes);
}

async function waitForPhase(page: Page, phase: string) {
  await page.getByTestId("status-cloud-sync").filter({ hasText: new RegExp(`^${phase}$`) }).waitFor({ timeout: 60_000 });
}

async function waitForSettledOutbox(page: Page, projectId: string): Promise<SyncRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const project = await idbGet<{ revision: number }>(page, PROJECTS, projectId);
    const sync = await idbGet<SyncRecord>(page, SYNC, projectId);
    if (project && sync?.dirty && sync.localRevision === project.revision) return sync;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the project save and sync outbox revisions to settle.");
}

async function interruptSecondUpload(route: Route, state: { chunks: number; interrupted: boolean }) {
  const range = route.request().headers()["content-range"];
  if (range && state.chunks++ === 1 && !state.interrupted) {
    state.interrupted = true;
    await route.abort("internetdisconnected");
    return;
  }
  await route.continue();
}

async function seedSecondDevice(page: Page, project: any, userId: string) {
  await idbPut(page, PROJECTS, project);
  await idbPut(page, SYNC, {
    projectId: project.id, ownerUserId: userId, enabled: true, remoteRevision: 0,
    localRevision: project.revision, dirty: false, pendingAssetIds: [], assetVersions: {}, uploads: {}, downloads: {},
  });
  await page.evaluate((id) => localStorage.setItem("orangejuce_daw_last_project", id), project.id);
}

const users: TestUser[] = [];
const browser = await chromium.launch();
let cloudUserId: string | undefined;
try {
  const unauthenticated = await fetch(`${BASE_URL}/api/daw-sync/projects/integration-probe`);
  assert.equal(unauthenticated.status, 401, "shared preview route must reach Clerk-protected DAW sync");

  const primary = await createUser("orangejuce-sync");
  const secondary = await createUser("orangejuce-switch");
  users.push(primary, secondary);
  cloudUserId = primary.id;

  const contextA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const contextB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await signIn(pageA, primary);
  await signIn(pageB, primary);
  await openDaw(pageA);
  await openDaw(pageB);

  const uploadState = { chunks: 0, interrupted: false };
  await pageA.route("**/api/daw-sync/**/chunks", (route) => interruptSecondUpload(route, uploadState));
  const largeWav = wavFixture();
  await pageA.getByTestId("input-import-audio").setInputFiles({ name: "sync-integration.wav", mimeType: "audio/wav", buffer: largeWav });
  await pageA.locator('[data-testid^="button-clip-"]').first().waitFor({ timeout: 60_000 });
  await pageA.getByTestId("button-enable-sync").click();
  await waitForPhase(pageA, "error");
  assert.equal(uploadState.interrupted, true, "test must interrupt a later upload chunk");

  const projectA = await firstProject(pageA);
  assert(projectA?.id, "Device A must persist the project before sync");
  const interrupted = await idbGet<SyncRecord>(pageA, SYNC, projectA.id);
  const uploadCheckpoint = Object.values(interrupted?.uploads ?? {})[0];
  assert.equal(uploadCheckpoint?.offset, CHUNK_BYTES, "upload checkpoint must persist the first completed chunk");

  const resumedRanges: string[] = [];
  await pageA.unroute("**/api/daw-sync/**/chunks");
  await pageA.route("**/api/daw-sync/**/chunks", async (route) => {
    resumedRanges.push(route.request().headers()["content-range"] || "");
    await route.continue();
  });
  await pageA.getByTestId("button-retry-sync").click();
  await waitForPhase(pageA, "synced");
  assert.match(resumedRanges[0] || "", new RegExp(`^bytes ${CHUNK_BYTES}-`), "upload retry must resume at the persisted offset");

  const uploadedProject = await firstProject(pageA);
  const uploadedState = await idbGet<SyncRecord>(pageA, SYNC, uploadedProject.id);
  assert.equal(uploadedState?.dirty, false);
  assert(uploadedState?.remoteRevision, "Device A must commit project metadata after the asset upload");

  await seedSecondDevice(pageB, uploadedProject, primary.id);
  let downloadRequests = 0;
  let interruptedDownload = false;
  await pageB.route("**/api/daw-sync/**/versions/**", async (route) => {
    if (downloadRequests++ === 1 && !interruptedDownload) {
      interruptedDownload = true;
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });
  await pageB.reload({ waitUntil: "domcontentloaded" });
  await openDaw(pageB);
  await waitForPhase(pageB, "error");
  const interruptedDownloadState = await idbGet<SyncRecord>(pageB, SYNC, uploadedProject.id);
  const downloadCheckpoint = Object.values(interruptedDownloadState?.downloads ?? {})[0];
  assert.equal(downloadCheckpoint?.offset, CHUNK_BYTES, "download checkpoint must persist the first completed chunk");

  const resumedDownloadRanges: string[] = [];
  await pageB.unroute("**/api/daw-sync/**/versions/**");
  await pageB.route("**/api/daw-sync/**/versions/**", async (route) => {
    resumedDownloadRanges.push(route.request().headers().range || "");
    await route.continue();
  });
  await pageB.getByTestId("button-retry-sync").click();
  await waitForPhase(pageB, "synced");
  assert.equal(resumedDownloadRanges[0], `bytes=${CHUNK_BYTES}-${CHUNK_BYTES * 2 - 1}`, "download retry must resume at the persisted offset");
  const downloadedAssets = await projectAssets(pageB, uploadedProject.id);
  assert(downloadedAssets.some((asset) => asset.size === largeWav.byteLength), "Device B must restore the complete App Storage audio object");

  await pageA.getByTestId("input-project-name").fill("Device A arrangement");
  await pageA.getByTestId("button-save-project").click();
  await pageA.getByTestId("button-retry-sync").click();
  await waitForPhase(pageA, "synced");
  await pageB.getByTestId("input-project-name").fill("Device B arrangement");
  await pageB.getByTestId("button-save-project").click();
  await pageB.getByTestId("button-retry-sync").click();
  await waitForPhase(pageB, "conflict");
  await pageB.getByTestId("button-keep-local").waitFor();
  await pageB.getByTestId("button-use-cloud").waitFor();
  const conflictState = await idbGet<SyncRecord>(pageB, SYNC, uploadedProject.id);
  assert.equal(conflictState?.conflict?.local.name, "Device B arrangement");
  assert.equal(conflictState?.conflict?.remote.name, "Device A arrangement");

  await pageA.getByTestId("input-project-name").fill("Primary account pending outbox");
  await pageA.getByTestId("button-save-project").click();
  const outboxBefore = await waitForSettledOutbox(pageA, uploadedProject.id);
  await signIn(pageA, secondary);
  await openDaw(pageA);
  await waitForPhase(pageA, "local-only");
  const outboxAfter = await idbGet<SyncRecord>(pageA, SYNC, uploadedProject.id);
  assert.deepEqual(outboxAfter, outboxBefore, "account switching must not mutate the previous account outbox");
  assert.equal(outboxAfter?.ownerUserId, primary.id);

  await signIn(pageA, primary);
  await openDaw(pageA);
  await pageA.route("**/api/daw-sync/**/uploads", (route) => route.fulfill({ status: 507, contentType: "application/json", body: '{"error":"quota fixture"}' }));
  const quotaState = await idbGet<SyncRecord>(pageA, SYNC, uploadedProject.id);
  assert(quotaState, "primary account sync state must still exist after returning");
  quotaState.dirty = true;
  quotaState.pendingAssetIds = [uploadedProject.assets[0].id];
  quotaState.uploads = {};
  await idbPut(pageA, SYNC, quotaState);
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await openDaw(pageA);
  await waitForPhase(pageA, "quota");
  await pageA.getByText(/Cloud storage quota is full.*Retry is available and local work is safe/).waitFor();
  await pageA.getByTestId("button-retry-sync").waitFor();

  await pageA.unroute("**/api/daw-sync/**/uploads");
  await pageA.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restoreSyncQuotaFixture = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if (this.name === "sync-state") throw new DOMException("Local quota fixture", "QuotaExceededError");
      return original.call(this, value, key as any);
    };
  });
  await pageA.getByTestId("button-retry-sync").click();
  await waitForPhase(pageA, "quota");
  await pageA.getByText(/not have enough local storage to checkpoint the transfer.*Retry is available and local work is safe/).waitFor();
  await pageA.evaluate(() => (window as any).__restoreSyncQuotaFixture?.());

  await contextA.close();
  await contextB.close();
  console.log("e2eDawSyncTest: two Clerk contexts, App Storage transfer resumes, conflict safety, account isolation, and quota recovery passed");
} finally {
  await browser.close();
  await Promise.allSettled(users.map((user) => clerkRequest(`/users/${user.id}`, { method: "DELETE" })));
  if (cloudUserId && process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    const endpoint = "http://127.0.0.1:1106";
    const storage = new Storage({
      credentials: {
        audience: "replit", subject_token_type: "access_token", token_url: `${endpoint}/token`, type: "external_account",
        credential_source: { url: `${endpoint}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
        universe_domain: "googleapis.com",
      },
      projectId: "",
    });
    await storage.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID).deleteFiles({
      prefix: `${(process.env.PRIVATE_OBJECT_DIR || ".private").replace(/^\/+|\/+$/g, "")}/daw/${cloudUserId}/`,
      force: true,
    }).catch(() => undefined);
  }
}