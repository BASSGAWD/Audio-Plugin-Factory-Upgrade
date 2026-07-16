/**
 * End-to-end Factory Canvas test against the REAL running app in a headless
 * browser: enter canvas mode, spawn a card from a prompt, watch the
 * autonomous pipeline land it at the >= 97 floor, audition it live, and
 * confirm persistence across a reload. Requires the dev server on
 * E2E_BASE_URL (default http://localhost:3000).
 *
 * Screenshots land in tests/.e2e-screenshots/ -- read them to SEE the canvas
 * when interactive browser tools are unavailable.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const SCREENSHOT_DIR = path.join(here, ".e2e-screenshots");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Same expected background noise as e2eSmokeTest: the ModelPicker probes
  // local LLM backends regardless of the engine in use.
  const EXPECTED_NOISE = /Failed to load resource: the server responded with a status of|net::ERR_|blocked by CORS policy/;
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !EXPECTED_NOISE.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    check("app loads", await page.locator("text=OrangeJuce").first().isVisible({ timeout: 10000 }).catch(() => false));

    // ---- Enter the Factory Canvas from the Studio header ----
    await page.locator('button:has-text("Canvas")').first().click({ timeout: 10000 });
    const canvasBadge = page.locator("text=Factory Canvas").first();
    check("canvas mode opens", await canvasBadge.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "10-canvas-empty.png") });

    // ---- Spawn a card from the composer ----
    const composer = page.locator('textarea[aria-label="Describe a sound to build a new plugin card"]');
    await composer.fill("make a warm tape echo delay with a bit of wobble");
    await page.locator('button[aria-label="Build plugin"]').click();

    // The card builds autonomously; the score badge lands when it's ready.
    const card = page.locator('[data-canvas-card="true"]').first();
    check("card spawns on the canvas", await card.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false));

    // Wait for a ready card: its footer "Studio" action only exists at ready.
    const studioAction = card.locator('button:has-text("Studio")');
    check(
      "autonomous build completes",
      await studioAction.waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false)
    );

    // The badge shows the MIN of the four gate scores -- the >= 97 contract.
    const badgeText = await card.locator('span[title*="Lowest of the four"]').innerText().catch(() => "");
    const minScore = parseInt(badgeText, 10);
    check("card ships at the >= 97 floor", Number.isFinite(minScore) && minScore >= 97, `badge=${badgeText}`);

    // Knobs are rendered and interactive on the card itself.
    const knobCount = await card.locator('[role="slider"], input[type="range"]').count();
    check("card renders live controls", knobCount > 0, `${knobCount} sliders/knobs`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "11-canvas-card-ready.png") });

    // ---- Audition: play the card through the live engine ----
    const playBtn = card.locator('button[aria-label^="Play"]').first();
    await playBtn.click();
    check(
      "card goes LIVE through the audio engine",
      await card.locator("text=LIVE").waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)
    );
    await page.waitForTimeout(700); // let the faceplate's audio-reactive rAF glow run
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "12-canvas-card-live.png") });
    await card.locator('button[aria-label^="Stop"]').first().click().catch(() => {});

    // ---- Second card via suggestion-free composer + queue ----
    await composer.fill("a big dreamy shimmer reverb");
    await page.locator('button[aria-label="Build plugin"]').click();
    const cards = page.locator('[data-canvas-card="true"]');
    await cards.nth(1).waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    check("second card queues and spawns", (await cards.count()) === 2);
    const secondStudio = cards.nth(1).locator('button:has-text("Studio")');
    check(
      "second card also lands ready",
      await secondStudio.waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false)
    );
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "13-canvas-two-cards.png") });

    // ---- Persistence: reload -> cards come back ready ----
    await page.reload({ waitUntil: "domcontentloaded" });
    const cardsAfter = page.locator('[data-canvas-card="true"]');
    await cardsAfter.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    check("cards persist across reload", (await cardsAfter.count()) === 2, `count=${await cardsAfter.count()}`);
    check(
      "reloaded card is still ready (plugin restored, not rebuilt)",
      await cardsAfter.first().locator('button:has-text("Studio")').waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false)
    );

    // ---- Open in Studio: canvas plugin becomes the loaded plugin ----
    await cardsAfter.first().locator('button:has-text("Studio")').click();
    check(
      "Open in Studio lands back in simple mode with the plugin loaded",
      await page.locator("text=Tape Echo").first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)
    );
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "14-canvas-to-studio.png") });

    check("no console/page errors across the whole run", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  } catch (err: any) {
    check("canvas e2e ran to completion without throwing", false, err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "98-canvas-failure.png") }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots: ${SCREENSHOT_DIR}`);
  console.log(failures === 0 ? "\nE2E CANVAS: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
