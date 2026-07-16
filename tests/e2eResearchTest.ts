/**
 * End-to-end Research Lab test against the REAL running app: open Pro mode,
 * enter the Research Lab tab, research a curriculum gap, review the pending
 * card (citations + gate verification), approve it, and confirm the gap
 * closes and the decision lands in history. Requires the dev server on
 * E2E_BASE_URL (default http://localhost:3000).
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

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

    // ---- Pro mode -> Research Lab tab ----
    await page.locator('button:has-text("Pro mode")').click({ timeout: 10000 });
    await page.locator("text=ORANGEJUCE").first().waitFor({ timeout: 10000 });
    await page.locator('button:has-text("Research Lab")').click({ timeout: 10000 });
    check("Research Lab opens", await page.locator("text=Research Engine").first().isVisible({ timeout: 5000 }).catch(() => false));

    // ---- Gap list shows the measured curriculum gaps ----
    const phaserGap = page.locator("li", { hasText: "Phaser (allpass cascade)" }).first();
    check("gap list shows the phaser curriculum gap", await phaserGap.isVisible({ timeout: 5000 }).catch(() => false));
    check("gap list shows blocked concepts too", await page.locator("li", { hasText: "Convolution" }).first().isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "20-research-gaps.png") });

    // ---- Research the phaser gap ----
    await phaserGap.locator("button", { hasText: "Research" }).click();
    const pendingCard = page.locator("div", { hasText: "4-stage allpass phaser" }).last();
    check("pending card appears with the proposed module", await pendingCard.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false));
    check("card shows a citation", await page.locator("text=Physical Audio Signal Processing").first().isVisible().catch(() => false));
    check("card shows gate verification", await page.locator("text=gate min 100/100").first().isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "21-research-pending.png") });

    // ---- Approve it ----
    await page.locator('button[aria-label="Approve research on phaser"]').click({ timeout: 5000 });
    check("approval lands in history as buildable",
      await page.locator("li", { hasText: "phaser" }).filter({ hasText: "buildable" }).first().waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false));
    check("phaser gap disappears from the gap list",
      await page.locator("li", { hasText: "Phaser (allpass cascade)" }).count().then((n) => n === 0));

    // ---- Blocked concept: research mid-side, approval must be disabled ----
    const msGap = page.locator("li", { hasText: "Stereo linking / mid-side" }).first();
    await msGap.locator("button", { hasText: "Research" }).click();
    const approveMs = page.locator('button[aria-label="Approve research on mid-side"]');
    await approveMs.waitFor({ state: "visible", timeout: 10000 });
    check("blocked concept's Approve button is disabled", await approveMs.isDisabled());
    check("structural constraint is explained", await page.locator("text=strictly mono").first().isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "22-research-blocked.png") });

    check("no console/page errors across the whole run", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  } catch (err: any) {
    check("research e2e ran to completion without throwing", false, err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "97-research-failure.png") }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots: ${SCREENSHOT_DIR}`);
  console.log(failures === 0 ? "\nE2E RESEARCH: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
