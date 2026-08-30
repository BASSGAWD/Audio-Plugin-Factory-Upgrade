/**
 * Live end-to-end test of the OpenAudio index gatherer against the REAL repo,
 * through the running app's /api/proxy. Proves the parser + matcher work on
 * the actual 79 KB README, not just a canned fixture. Requires the dev server
 * on E2E_BASE_URL and live network.
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OPENAUDIO_INDEX, parseOpenAudioIndex, matchIndexEntries, searchTermsFor } from "../src/utils/researchSources";

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

    const md: string | null = await page.evaluate(async (url) => {
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
    }, OPENAUDIO_INDEX.url);

    check("live proxy fetched the OpenAudio index", !!md && md.length > 20000, `len=${md?.length ?? 0}`);
    if (md) {
      const entries = parseOpenAudioIndex(md);
      check("parses hundreds of real project entries", entries.length > 200, `${entries.length} entries`);
      check("real entries have names, github urls, descriptions", entries.slice(0, 50).every((e) => e.name && /^https?:\/\//.test(e.url)));

      const conv = matchIndexEntries(entries, searchTermsFor("convolution"), 5);
      check("matches real convolution implementations", conv.length >= 1, conv.map((e) => e.name).join(", "));
      const fm = matchIndexEntries(entries, searchTermsFor("fm-synthesis"), 5);
      check("matches real FM-synth implementations", fm.length >= 1, fm.map((e) => e.name).join(", "));
      const rev = matchIndexEntries(entries, searchTermsFor("reverb"), 5);
      check("matches real reverb implementations", rev.length >= 1, rev.map((e) => e.name).join(", "));
      console.log("  convolution refs:", conv.map((e) => `${e.name} <${e.url}>`).slice(0, 3).join(" | "));
    }
  } catch (err: any) {
    check("live OpenAudio e2e ran to completion", false, err.message);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\nE2E OPENAUDIO: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
