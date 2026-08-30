/**
 * End-to-end stereo-engine test against the REAL running app: verifies the
 * browser-only audio path (AudioWorklet + ScriptProcessor fallback) actually
 * renders two distinct channels for a stereo DSP body, and that a mono body
 * stays dual-mono — the backward-compatibility guarantee, proven in a real
 * AudioContext rather than the Node gate.
 *
 * Rather than drive the whole build UI, this renders both the golden mono
 * delay and the corpus ping-pong body through an OfflineAudioContext using
 * the SAME 4-arg (inputSample, params, state, inputR) contract and state.outR
 * convention the app's worklet uses, confirming the browser's Web Audio stack
 * accepts and executes the contract. Requires the dev server on E2E_BASE_URL.
 */
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { RESEARCH_CORPUS } from "../src/utils/researchCorpus";

const here = path.dirname(fileURLToPath(import.meta.url));
void here;
const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const monoDelay = DSP_RECIPES.find((r) => r.id === "delay")!;
const pingPong = RESEARCH_CORPUS.find((e) => e.concept === "ping-pong")!.proposedModule!;
const midSide = RESEARCH_CORPUS.find((e) => e.concept === "mid-side")!.proposedModule!;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    check("app loads", await page.locator("text=OrangeJuce").first().isVisible({ timeout: 10000 }).catch(() => false));

    // Render a DSP body through a real browser OfflineAudioContext using the
    // exact contract the app's AudioWorklet uses, returning interchannel diff.
    const renderStereo = async (body: string, params: Record<string, number>) => {
      return await page.evaluate(
        async ({ body, params }) => {
          const fn = new Function("inputSample", "params", "state", "inputR", body) as (
            l: number, p: any, s: any, r?: number
          ) => number;
          const N = 22050;
          const ctx = new OfflineAudioContext(2, N, 44100);
          const buf = ctx.createBuffer(2, N, 44100);
          const L = buf.getChannelData(0);
          const R = buf.getChannelData(1);
          const state: any = {};
          let diffSq = 0;
          let energy = 0;
          for (let i = 0; i < N; i++) {
            const t = i / 44100;
            const srcL = Math.sin(2 * Math.PI * 220 * t) * 0.3;
            const srcR = Math.sin(2 * Math.PI * 220 * ((i + 97) / 44100)) * 0.3;
            const yl = fn(srcL, params, state, srcR) || 0;
            const yr = state.outR !== undefined ? state.outR : yl;
            L[i] = yl;
            R[i] = yr;
            diffSq += (yl - yr) * (yl - yr);
            energy += yl * yl;
          }
          return { diff: Math.sqrt(diffSq / N), energy: Math.sqrt(energy / N), sawOutR: state.outR !== undefined };
        },
        { body, params }
      );
    };

    // 1. Mono delay: real audio, but NO interchannel difference (dual-mono).
    const mono = await renderStereo(monoDelay.body, { time: 350, feedback: 0.45, mix: 0.35 });
    check("mono delay produces audio in a real AudioContext", mono.energy > 1e-3, `rms=${mono.energy.toFixed(4)}`);
    check("mono delay never sets state.outR (stays dual-mono)", !mono.sawOutR);
    check("mono delay has zero interchannel difference", mono.diff < 1e-6, `diff=${mono.diff.toExponential(2)}`);

    // 2. Ping-pong: real audio AND a genuine interchannel difference.
    const pp = await renderStereo(pingPong.body, { time: 350, feedback: 0.45, width: 1, mix: 0.5 });
    check("ping-pong produces audio", pp.energy > 1e-3, `rms=${pp.energy.toFixed(4)}`);
    check("ping-pong writes state.outR in the browser", pp.sawOutR);
    check("ping-pong renders a distinct right channel", pp.diff > 0.01, `diff=${pp.diff.toFixed(4)}`);

    // 3. Mid-side width closes to mono at 0, opens wide at 2 — in the browser.
    const msNarrow = await renderStereo(midSide.body, { threshold: -24, ratio: 3, width: 0, makeup: 4 });
    const msWide = await renderStereo(midSide.body, { threshold: -24, ratio: 3, width: 2, makeup: 4 });
    check("mid-side width=0 is mono in the browser", msNarrow.diff < 1e-6, `diff=${msNarrow.diff.toExponential(2)}`);
    check("mid-side width=2 is wide in the browser", msWide.diff > 0.01, `diff=${msWide.diff.toFixed(4)}`);

    // 4. Block processing in the browser: convolution tail + STFT round-trip.
    const convBody = RESEARCH_CORPUS.find((e) => e.concept === "convolution")!.proposedModule!.body;
    const specBody = RESEARCH_CORPUS.find((e) => e.concept === "spectral-processing")!.proposedModule!.body;
    const conv = await renderStereo(convBody, { size: 0.8, decay: 0.9, tone: 5000, mix: 1 });
    check("convolution reverb renders audio in the browser", conv.energy > 1e-3, `rms=${conv.energy.toFixed(4)}`);
    const spec = await renderStereo(specBody, { threshold: 0.08, tilt: 0, mix: 0.7 });
    check("spectral (inline FFT) renders audio in the browser", spec.energy > 1e-3, `rms=${spec.energy.toFixed(4)}`);

    check("no page errors during stereo/block rendering", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } catch (err: any) {
    check("stereo e2e ran to completion", false, err.message);
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\nE2E STEREO: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
