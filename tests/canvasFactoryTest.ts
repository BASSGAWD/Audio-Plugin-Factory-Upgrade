/**
 * Factory Canvas pipeline: one prompt in, one fully-gated plugin out, with
 * the same quality contract as every other generation path -- >= 97 on every
 * headline score, deterministic output, monotonic perfecting loop, and
 * portable code attached. Also covers card placement and workspace
 * persistence (the canvas must resume interrupted builds as queued).
 */
import {
  buildCanvasPlugin,
  placeNewCard,
  loadCanvasWorkspace,
  saveCanvasWorkspace,
  CanvasCard,
  CANVAS_STORAGE_KEY,
} from "../src/utils/canvasFactory";
import { refinementScore } from "../src/utils/refinementLoop";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

// Node has no localStorage: a minimal in-memory stand-in for persistence tests.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

(async () => {
  /* 1. Every canvas build ships at >= 97 on all four headline scores. */
  const PROMPTS = [
    "make a warm tape echo delay with a bit of wobble",
    "create a crunchy vintage guitar amp with drive, tone, and level controls",
    "underwater dream machine",
    "a big dreamy shimmer reverb with size, tone, and mix controls",
  ];
  for (const prompt of PROMPTS) {
    const stages: string[] = [];
    const result = await buildCanvasPlugin(prompt, {
      refineLoops: 2,
      onProgress: (p) => {
        if (stages[stages.length - 1] !== p.stage) stages.push(p.stage);
      },
    });
    check(
      `floor: "${prompt.slice(0, 40)}..." ships >= 97`,
      result.minScore >= 97,
      `min=${result.minScore} scores=${JSON.stringify(result.gate.scores)}`
    );
    check(`progress: pipeline reported real stages`, stages.includes("spec") && stages.includes("gate") && stages.includes("done"), stages.join(">"));
    check(`portable: Faust + JUCE scaffolds attached`, result.plugin.faustCode.length > 0 && result.plugin.cppJuceCode.length > 0);
    check(`evidence: build report attached`, !!result.plugin.buildReport && result.plugin.buildReport.compiled);
  }

  /* 2. Deterministic: the same prompt yields the same DSP at the same scores. */
  const a = await buildCanvasPlugin("make a warm tape echo delay", { refineLoops: 2 });
  const b = await buildCanvasPlugin("make a warm tape echo delay", { refineLoops: 2 });
  check("deterministic: same prompt -> same DSP", a.plugin.dspFunction === b.plugin.dspFunction);
  check("deterministic: same prompt -> same scores", JSON.stringify(a.gate.scores) === JSON.stringify(b.gate.scores));

  /* 3. Perfecting loop is monotonic: more loops never score lower. */
  const base = await buildCanvasPlugin("dreamy shimmer reverb", { refineLoops: 0 });
  const refined = await buildCanvasPlugin("dreamy shimmer reverb", { refineLoops: 4 });
  check(
    "monotonic: refined build scores >= unrefined",
    refinementScore(refined.gate) >= refinementScore(base.gate),
    `base=${refinementScore(base.gate).toFixed(1)} refined=${refinementScore(refined.gate).toFixed(1)}`
  );
  check("monotonic: versions tried grows with loops", refined.versionsTried > base.versionsTried);

  /* 4. An aborted build rejects instead of shipping a half-built card. */
  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try {
    await buildCanvasPlugin("make a warm drive", { signal: controller.signal });
  } catch (err: any) {
    aborted = err?.name === "AbortError";
  }
  check("abort: an aborted build rejects with AbortError", aborted);

  /* 5. Card placement never stacks two cards on the same spot. */
  const placed: CanvasCard[] = [];
  for (let i = 0; i < 6; i++) {
    const pos = placeNewCard(placed, 500, 300);
    placed.push({ id: `c${i}`, prompt: "x", x: pos.x, y: pos.y, status: "ready", createdAt: i });
  }
  const overlaps = placed.some((c, i) =>
    placed.some((d, j) => j > i && Math.abs(c.x - d.x) < 40 && Math.abs(c.y - d.y) < 40)
  );
  check("placement: six spawned cards never overlap", !overlaps);

  /* 6. Persistence roundtrip: ready cards keep their plugin; a card that was
   *    mid-build when the tab closed comes back QUEUED (the factory resumes
   *    its own jobs); garbage in storage never crashes the canvas. */
  saveCanvasWorkspace({
    cards: [
      { id: "r1", prompt: "warm delay", x: 10, y: 20, status: "ready", plugin: a.plugin, minScore: a.minScore, createdAt: 1 },
      { id: "b1", prompt: "still building", x: 30, y: 40, status: "building", createdAt: 2 },
    ],
    view: { x: 5, y: -8, zoom: 1.2 },
  });
  const restored = loadCanvasWorkspace();
  const r1 = restored.cards.find((c) => c.id === "r1");
  const b1 = restored.cards.find((c) => c.id === "b1");
  check("persist: ready card keeps its plugin + score", !!r1 && r1.status === "ready" && r1.plugin?.dspFunction === a.plugin.dspFunction && r1.minScore === a.minScore);
  check("persist: interrupted build resumes as queued", !!b1 && b1.status === "queued" && !b1.plugin);
  check("persist: viewport survives", restored.view.x === 5 && restored.view.y === -8 && Math.abs(restored.view.zoom - 1.2) < 1e-9);

  (globalThis as any).localStorage.setItem(CANVAS_STORAGE_KEY, "{not json");
  const junk = loadCanvasWorkspace();
  check("persist: corrupted storage falls back to an empty canvas", junk.cards.length === 0 && junk.view.zoom === 1);

  console.log(failures === 0 ? "\nCANVAS FACTORY: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
