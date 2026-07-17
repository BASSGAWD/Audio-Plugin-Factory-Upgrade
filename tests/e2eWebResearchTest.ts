/**
 * End-to-end LIVE web gatherer test against the running app: proves the
 * opt-in path actually fetches a real reference page through /api/proxy and
 * extracts cited passages — the one thing the deterministic stub test can't
 * cover. Requires the dev server on E2E_BASE_URL and live network.
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { webSourcesFor, extractRelevantPassages } from "../src/utils/researchSources";

const here = path.dirname(fileURLToPath(import.meta.url));
void here;
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    check("app loads", await page.locator("text=OrangeJuce").first().isVisible({ timeout: 10000 }).catch(() => false));

    const src = webSourcesFor("phaser")[0];
    // Fetch the real page through the app's proxy, in the page context.
    const html: string | null = await page.evaluate(async (url) => {
      try {
        const res = await fetch("/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUrl: url, method: "GET" }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.ok ? (data.responseText as string) : null;
      } catch {
        return null;
      }
    }, src.url);

    check("live proxy fetched the reference page", !!html && html.length > 5000, `len=${html?.length ?? 0}`);
    if (html) {
      const passages = extractRelevantPassages(html, src.keywords, 2);
      check("extraction returns cited passages from the LIVE page", passages.length >= 1, `${passages.length} passages`);
      check("passages are clean text (no HTML)", passages.every((p) => !/[<>]/.test(p)));
      check("passages are on-topic (mention a phaser keyword)", passages.some((p) => /all.?pass|notch|phaser|feedback|sweep/i.test(p)));
      console.log("  sample:", (passages[0] || "").slice(0, 120));
    }

    // The opt-in toggle renders in the Research Lab.
    await page.locator('button:has-text("Pro mode")').click({ timeout: 10000 });
    await page.locator("text=ORANGEJUCE").first().waitFor({ timeout: 10000 });
    await page.locator('button:has-text("Research Lab")').click({ timeout: 10000 });
    check("Research Lab shows the live-web opt-in toggle", await page.locator('input[aria-label="Include live web sources"]').isVisible({ timeout: 5000 }).catch(() => false));
    check("web sources are OFF by default", !(await page.locator('input[aria-label="Include live web sources"]').isChecked().catch(() => true)));
  } catch (err: any) {
    check("live web e2e ran to completion", false, err.message);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\nE2E WEB RESEARCH: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
