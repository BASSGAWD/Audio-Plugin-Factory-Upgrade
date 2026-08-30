import { chromium, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const DB_NAME = "autonomous-audio-daw";
const LAST_PROJECT_KEY = "orangejuce_daw_last_project";

async function openDaw(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  // Reload recovery starts from the app shell, while a running session may
  // already be in Pro mode. Only navigate when the DAW is not present.
  if (!await page.getByRole("region", { name: "Arrangement" }).count()) {
    await page.getByRole("button", { name: "Pro mode" }).click();
    await page.getByTestId("button-open-daw-pro").click();
  }
  await page.getByRole("region", { name: "Arrangement" }).waitFor();
}

async function clearDawStorage(page: Page) {
  await page.evaluate(async ({ database, key }) => {
    localStorage.removeItem(key);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }, { database: DB_NAME, key: LAST_PROJECT_KEY });
}

/** Browser fixture: every recording request deterministically denies access. */
async function recordingDeniedContext() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied by DAW browser fixture", "NotAllowedError");
        },
      },
    });
  });
  return { browser, context };
}

function fixtureWav() {
  // A 0.1 second mono PCM WAV at 8 kHz. It is intentionally generated in the
  // browser test rather than committed as a binary fixture.
  const sampleRate = 8_000;
  const samples = new Int16Array(800);
  for (let i = 0; i < samples.length; i++) samples[i] = i % 80 < 40 ? 8_000 : -8_000;
  const bytes = new Uint8Array(44 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0); view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36); view.setUint32(40, samples.byteLength, true);
  bytes.set(new Uint8Array(samples.buffer), 44);
  return Buffer.from(bytes);
}

async function storedProject(page: Page) {
  return page.evaluate(async (database) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { db.close(); resolve(request.result[0] ?? null); };
    };
  }), DB_NAME);
}

const { browser, context } = await recordingDeniedContext();
const page = await context.newPage();
try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await clearDawStorage(page);
  await openDaw(page);

  const rows = page.locator('[data-testid^="row-track-"]');
  const firstId = (await rows.first().getAttribute("data-testid"))!.replace("row-track-", "");
  await page.getByTestId(`input-track-name-${firstId}`).fill("Lead vocal");
  await page.getByTestId(`select-track-color-${firstId}`).selectOption("#8b5cf6");
  for (const state of ["mute", "solo", "armed"]) {
    const button = page.getByTestId(`button-track-${state}-${firstId}`);
    await button.click();
    if (await button.getAttribute("aria-pressed") !== "true") throw new Error(`${state} did not activate`);
  }

  // The denied-media fixture must surface a failure and never create a take.
  await page.getByTestId("button-show-inspector").click();
  await page.getByTestId("button-panel-capture").click();
  await page.getByTestId("button-start-recording").click();
  await page.getByTestId("status-capture").filter({ hasText: "permission was denied" }).waitFor();
  if (await page.getByTestId("button-stop-recording").count()) throw new Error("denied recording entered recording state");

  // Importing this deterministic WAV exercises IndexedDB asset storage and
  // supplies a real clip for pointer/keyboard arrangement and offline bounce.
  await page.getByTestId("input-import-audio").setInputFiles({
    name: "fixture.wav", mimeType: "audio/wav", buffer: fixtureWav(),
  });
  const clip = page.locator('[data-testid^="button-clip-"]').first();
  await clip.waitFor({ timeout: 20_000 });
  const clipId = (await clip.getAttribute("data-testid"))!.replace("button-clip-", "");
  await clip.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("input-clip-offset").fill("0.01");
  await page.getByTestId("button-loop-clip").click();
  await page.getByTestId("button-timeline-ruler").click({ position: { x: 6, y: 5 } });
  await page.getByTestId("button-split-clip").click();

  await page.getByTestId("button-panel-bounce").click();
  await page.getByTestId("button-start-bounce").click();
  await page.getByTestId("status-bounce-complete").waitFor({ timeout: 20_000 });
  if (!await page.getByTestId("link-download-bounce").getAttribute("download")) throw new Error("bounce did not provide a WAV download");

  await page.getByTestId("button-panel-automation").click();
  await page.getByTestId("button-focus-automation-editor").click();
  await page.getByTestId("select-automation-track").selectOption(firstId);
  await page.getByTestId("select-automation-parameter").selectOption("pan");
  await page.getByTestId("button-add-automation-point").click();
  const automationRow = page.locator('[data-testid^="row-automation-"]').first();
  const automationId = (await automationRow.getAttribute("data-testid"))!.replace("row-automation-", "");
  await page.getByTestId(`input-automation-time-${automationId}`).fill("0.05");

  await page.getByTestId("input-project-name").fill("Reload recovery contract");
  await page.getByTestId("button-save-project").click();
  await page.getByTestId("status-project-save").filter({ hasText: "saved" }).waitFor();
  const stored = await storedProject(page) as { version?: number; tracks?: unknown[] } | null;
  if (stored?.version !== 3 || stored.tracks?.length !== 1) throw new Error("current IndexedDB project schema was not stored");

  await page.reload({ waitUntil: "domcontentloaded" });
  await openDaw(page);
  if (await page.getByTestId("input-project-name").inputValue() !== "Reload recovery contract") throw new Error("project name did not recover");
  if (!await page.getByTestId(`button-clip-${clipId}`).count()) throw new Error("IndexedDB clip did not recover");
  console.log("e2eDawTest: arrangement, recording fixture, IndexedDB reload, and bounce assertions passed");
} finally {
  await context.close();
  await browser.close();
}