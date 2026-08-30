import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page, type Route } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:80";
const DB_NAME = "autonomous-audio-daw";
const PROJECTS = "projects";
const ASSETS = "assets";
const SYNC = "sync-state";
const CHUNK_BYTES = 5 * 1024 * 1024;
// Mirrors server/dawSync.ts's DATA_ROOT -- this test's own cleanup, not the
// app's runtime path (no shared constant across a client-side test file and
// the server, so this is the one place that pairing intentionally repeats).
const SYNC_DATA_ROOT = path.resolve(process.cwd(), ".daw-sync-data");

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

function generateCode(): string {
  // Mirrors src/daw/pairing.ts's generatePairingCode() shape closely enough
  // for this test (real format validation happens in the app itself); kept
  // local so this test has no import-order dependency on the app's own
  // module resolution.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const group = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

async function openDaw(page: Page) {
  if (!await page.getByRole("region", { name: "Arrangement" }).count()) {
    await page.getByRole("button", { name: "Pro mode" }).click();
    await page.getByTestId("button-open-daw-pro").click();
  }
  await page.getByRole("region", { name: "Arrangement" }).waitFor({ timeout: 30_000 });
}

/** Pairs the device shown in `page` to `code` (generating a fresh one if
 *  `code` is omitted, and returning whichever code ends up in effect). This
 *  replaced Clerk's ticket-based sign-in: possession of the code is the
 *  whole authorization model, so "pairing" is just entering it in the UI. */
async function pairDevice(page: Page, code?: string): Promise<string> {
  await page.getByTestId("button-sign-in-sync").click();
  if (code) {
    await page.getByTestId("button-enter-pairing-code").click();
    await page.getByTestId("input-pairing-code").fill(code);
    await page.getByTestId("button-confirm-pairing-code").click();
    return code;
  }
  await page.getByTestId("button-generate-pairing-code").click();
  const generated = (await page.getByTestId("text-pairing-code").textContent())?.trim();
  assert(generated, "generating a pairing code must display it for copying to another device");
  await page.getByRole("button", { name: "Done" }).click();
  return generated;
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

async function seedSecondDevice(page: Page, project: any, ownerCode: string) {
  await idbPut(page, PROJECTS, project);
  await idbPut(page, SYNC, {
    projectId: project.id, ownerUserId: ownerCode, enabled: true, remoteRevision: 0,
    localRevision: project.revision, dirty: false, pendingAssetIds: [], assetVersions: {}, uploads: {}, downloads: {},
  });
  await page.evaluate((id) => localStorage.setItem("orangejuce_daw_last_project", id), project.id);
}

const usedCodes: string[] = [];
const browser = await chromium.launch();
try {
  const unauthenticated = await fetch(`${BASE_URL}/api/daw-sync/projects/integration-probe`);
  assert.equal(unauthenticated.status, 401, "shared preview route must reach pairing-protected DAW sync");

  const primaryCode = generateCode();
  const secondaryCode = generateCode();
  usedCodes.push(primaryCode, secondaryCode);

  const contextA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const contextB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await pageB.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await openDaw(pageA);
  await openDaw(pageB);
  await pairDevice(pageA, primaryCode);
  await pairDevice(pageB, primaryCode);

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

  await seedSecondDevice(pageB, uploadedProject, primaryCode);
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
  assert(downloadedAssets.some((asset) => asset.size === largeWav.byteLength), "Device B must restore the complete synced audio object");

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

  await pageA.getByTestId("input-project-name").fill("Primary code pending outbox");
  await pageA.getByTestId("button-save-project").click();
  const outboxBefore = await waitForSettledOutbox(pageA, uploadedProject.id);
  await pageA.getByTestId("button-unpair").click();
  await pairDevice(pageA, secondaryCode);
  await waitForPhase(pageA, "local-only");
  const outboxAfter = await idbGet<SyncRecord>(pageA, SYNC, uploadedProject.id);
  assert.deepEqual(outboxAfter, outboxBefore, "re-pairing to a different code must not mutate the previous code's outbox");
  assert.equal(outboxAfter?.ownerUserId, primaryCode);

  await pageA.getByTestId("button-unpair").click();
  await pairDevice(pageA, primaryCode);
  await openDaw(pageA);
  await pageA.route("**/api/daw-sync/**/uploads", (route) => route.fulfill({ status: 507, contentType: "application/json", body: '{"error":"quota fixture"}' }));
  const quotaState = await idbGet<SyncRecord>(pageA, SYNC, uploadedProject.id);
  assert(quotaState, "primary code sync state must still exist after returning");
  quotaState.dirty = true;
  quotaState.pendingAssetIds = [uploadedProject.assets[0].id];
  quotaState.uploads = {};
  await idbPut(pageA, SYNC, quotaState);
  await pageA.reload({ waitUntil: "domcontentloaded" });
  await openDaw(pageA);
  await waitForPhase(pageA, "quota");
  await pageA.getByText(/Local storage quota or capacity is unavailable.*Retry is available and local work is safe/).waitFor();
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
  console.log("e2eDawSyncTest: two paired-device contexts, local transfer resumes, conflict safety, re-pairing isolation, and quota recovery passed");
} finally {
  await browser.close();
  // Cleanup is now just removing this run's own local sync data directories
  // -- no external API/service credentials needed, unlike the Clerk-user +
  // GCS-object cleanup this replaced.
  await Promise.allSettled(usedCodes.map((code) => fs.rm(path.join(SYNC_DATA_ROOT, code), { recursive: true, force: true })));
}
