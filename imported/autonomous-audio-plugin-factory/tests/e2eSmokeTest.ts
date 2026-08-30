/**
 * End-to-end smoke test against the REAL running app in a real (headless)
 * browser -- the thing every other test suite here can't cover, since they
 * all run pure functions / SSR markup with no live DOM, no CSS, no rAF, no
 * Web Audio. Requires `npm run dev` already running on http://localhost:3000.
 *
 * Forces the Offline Compiler engine so the test is deterministic and has
 * no dependency on a local LLM being reachable.
 *
 * Screenshots land in tests/.e2e-screenshots/ -- read them with the Read
 * tool to actually SEE the rendered UI when interactive browser tools are
 * unavailable.
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
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

  // The ModelPicker probes local LLM backends in the background on an
  // interval, independent of which engine is selected for chat -- the
  // feature actually under test here runs entirely on the offline compiler
  // and touches neither backend. Depending on whatever state Ollama/LM
  // Studio happen to be in on the machine running this test (not started,
  // no model loaded, CORS-blocked direct-fetch-before-proxy-fallback -- see
  // llmGateway.ts), those probes surface as browser resource-load errors
  // with varying status codes/network error codes. Match the general
  // pattern rather than individual codes so the test doesn't need updating
  // every time the backends' failure mode changes; genuine JS exceptions
  // (pageerror) and app-level console.error() calls use a different message
  // shape entirely and are never matched by this.
  const EXPECTED_NOISE = /Failed to load resource: the server responded with a status of|net::ERR_|blocked by CORS policy/;
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !EXPECTED_NOISE.test(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    check("app loads", await page.locator("text=OrangeJuce").first().isVisible({ timeout: 10000 }).catch(() => false));

    // ---- Force the Offline Compiler engine via the ModelPicker ----
    const picker = page.locator('[aria-haspopup="menu"]').first();
    await picker.click({ timeout: 10000 });
    await page.locator('[role="menuitemradio"]', { hasText: "Offline Compiler" }).click({ timeout: 10000 });
    check("model picker: switched to Offline Compiler", await picker.innerText().then((t) => /Offline Compiler/i.test(t)));

    // ---- Build a plugin through the real chat UI ----
    const textarea = page.locator('textarea[aria-label="Describe the sound you want"]');
    await textarea.fill("make a dreamy shimmer reverb");
    await page.locator('button[aria-label="Send message"]').click();

    // Plugin card appears once the build lands (dock auto-opens on first build only if hasMessages -- it will).
    const pluginNameLocator = page.locator("text=Shimmer").first();
    await pluginNameLocator.waitFor({ timeout: 10000 }).catch(() => {});
    check("plugin card appears with a name", await pluginNameLocator.isVisible().catch(() => false));

    // ---- Expand the dock to reveal the generative faceplate + controls ----
    const controlsToggle = page.locator('button[aria-label="Show controls"]').first();
    if (await controlsToggle.isVisible().catch(() => false)) {
      await controlsToggle.click();
    }

    // GenerativeFaceplate's artwork always includes a <radialGradient> base
    // wash -- unlike a bare aria-hidden svg (which also matches decorative
    // lucide-react icons throughout the header), this uniquely identifies it.
    const faceplateSvg = page.locator("svg:has(radialGradient)").first();
    check(
      "generative faceplate SVG rendered",
      await faceplateSvg.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)
    );

    // "Decay" appears twice: once in the chat reply's bullet list, once as
    // the knob's own label further down in DOM order -- .last() is the
    // knob. isVisible() is an immediate snapshot with no auto-wait; waitFor()
    // retries until the element settles, which is what the earlier
    // "plugin card appears" check already relied on.
    const decayKnob = page.locator("text=Decay").last();
    check(
      "plugin controls rendered (Decay knob visible)",
      await decayKnob.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)
    );

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-plugin-built.png") });

    // ---- Press play, confirm the transport actually toggles ----
    const playButton = page.locator('button[aria-label="Play audio preview"]');
    if (await playButton.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await playButton.click();
      const stopButton = page.locator('button[aria-label="Stop audio"]');
      check(
        "play button toggles to stop (audio engine started)",
        await stopButton.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)
      );
      await page.waitForTimeout(800); // let the audio-reactive glow rAF loop run a few frames
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-playing.png") });
      await stopButton.click().catch(() => {});
    } else {
      check("play button toggles to stop (audio engine started)", false, "play button not found");
    }

    // ---- Relative tweak: "brighter" should adjust in place, not rebuild ----
    await textarea.fill("brighter");
    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForTimeout(1500);
    check("tweak reply appears without erroring", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    // ---- Pro mode: confirm the workspace loads without crashing ----
    await page.locator('button:has-text("Pro mode")').click();
    await page.locator("text=ORANGEJUCE").first().waitFor({ timeout: 10000 });
    check("Pro mode loads", await page.locator("text=ORANGEJUCE").first().isVisible().catch(() => false));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03-pro-mode.png") });

    check("no console/page errors across the whole run", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  } catch (err: any) {
    check("smoke test ran to completion without throwing", false, err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "99-failure.png") }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots: ${SCREENSHOT_DIR}`);
  console.log(failures === 0 ? "\nE2E SMOKE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
