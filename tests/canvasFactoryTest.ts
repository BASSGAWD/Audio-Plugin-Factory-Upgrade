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
  mergeRebuildChanges,
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

  /* 7. Heavy embedded blobs (custom faceplate images, uploaded IR files) are
   *    stripped before persisting -- a handful of cards carrying multi-MB
   *    base64 images used to blow the ~5-10MB localStorage quota, silently
   *    failing the ENTIRE save (see check 8) and reverting the whole card
   *    list to whatever was last written successfully -- reported as
   *    "cards keep erasing". Everything except the cosmetic blob survives. */
  const skinned = {
    ...a.plugin,
    customSkin: { ...(a.plugin.customSkin || {}), bgImage: "data:image/png;base64," + "A".repeat(2000) },
    parameters: [
      ...a.plugin.parameters,
      { id: "irtest", name: "IR", min: 0, max: 1, defaultValue: 0, value: 0, unit: "", irFiles: [{ id: "f1", name: "hall.wav", size: "2MB", data: "B".repeat(2000) }] },
    ],
  };
  saveCanvasWorkspace({
    cards: [{ id: "skin1", prompt: "custom skin test", x: 0, y: 0, status: "ready", plugin: skinned as any, createdAt: 1 }],
    view: { x: 0, y: 0, zoom: 1 },
  });
  const skinRestored = loadCanvasWorkspace().cards.find((c) => c.id === "skin1");
  check(
    "persist: heavy customSkin.bgImage is stripped, everything else survives",
    !!skinRestored && skinRestored.plugin?.dspFunction === a.plugin.dspFunction && !skinRestored.plugin?.customSkin?.bgImage
  );
  check(
    "persist: heavy irFiles[].data is stripped, file identity survives",
    skinRestored?.plugin?.parameters.find((p) => p.id === "irtest")?.irFiles?.[0]?.name === "hall.wav" &&
      skinRestored?.plugin?.parameters.find((p) => p.id === "irtest")?.irFiles?.[0]?.data === ""
  );

  /* 8. A save that genuinely can't fit reports failure instead of pretending
   *    to succeed -- this is what lets the app toast a real warning instead
   *    of the failure being invisible (the old behavior: console.warn only,
   *    caller had no idea anything went wrong). */
  const realSetItem = (globalThis as any).localStorage.setItem;
  (globalThis as any).localStorage.setItem = () => {
    throw new Error("QuotaExceededError (simulated)");
  };
  const okResult = saveCanvasWorkspace({ cards: [], view: { x: 0, y: 0, zoom: 1 } });
  check("persist: a failing write reports false instead of silently succeeding", okResult === false);
  (globalThis as any).localStorage.setItem = realSetItem;

  /* 8b. The decisive gap this fallback tier exists for: a save that fails
   *     at full fidelity (simulating quota pressure from many cards' worth
   *     of accumulated buildReport evidence) must NOT drop the card --
   *     it should retry with that secondary detail pruned and still land
   *     in storage. Without the fallback tier, this exact scenario used to
   *     return false and the card would be gone on next reload; with it,
   *     the save succeeds and the card survives, just without its
   *     evidence detail. */
  {
    const real = (globalThis as any).localStorage.setItem;
    let calls = 0;
    (globalThis as any).localStorage.setItem = (k: string, v: string) => {
      calls++;
      if (calls === 1) throw new Error("QuotaExceededError (simulated full-fidelity payload)");
      real(k, v);
    };
    const heavyPlugin = { ...a.plugin, buildReport: a.plugin.buildReport ? { ...a.plugin.buildReport, fixes: Array(50).fill("a fairly long deterministic fix note, repeated") } : undefined };
    const fallbackResult = saveCanvasWorkspace({
      cards: [{ id: "fallback1", prompt: "heavy evidence test", x: 0, y: 0, status: "ready", plugin: heavyPlugin as any, createdAt: 1 }],
      view: { x: 0, y: 0, zoom: 1 },
    });
    check("persist fallback: a full-fidelity failure retries and succeeds (does not give up)", fallbackResult === true, `calls=${calls}`);
    check("persist fallback: it actually retried (2 setItem calls, not 1)", calls === 2, `calls=${calls}`);
    (globalThis as any).localStorage.setItem = real;

    const fallbackRestored = loadCanvasWorkspace().cards.find((c) => c.id === "fallback1");
    check(
      "persist fallback: the CARD survives (plugin, DSP, name all intact) even though the save was pruned",
      !!fallbackRestored && fallbackRestored.status === "ready" && fallbackRestored.plugin?.dspFunction === a.plugin.dspFunction && fallbackRestored.plugin?.name === a.plugin.name
    );
    check(
      "persist fallback: buildReport (the secondary evidence detail) is what got dropped, not the plugin",
      !!fallbackRestored?.plugin && fallbackRestored.plugin.buildReport === undefined
    );
  }

  /* 9. placeNewCard's spacing matches FactoryCanvas.tsx's actual card
   *    geometry (header + max-h-[440px] scrollable body + footer), not the
   *    old H=240 guess that real ready-state cards routinely blew past by
   *    hundreds of pixels -- which is what let one card's expanded content
   *    visually overlap a neighboring card's title text. */
  const realistic: CanvasCard[] = [];
  const centers = [
    { x: 500, y: 300 },
    { x: 560, y: 340 },
    { x: 440, y: 260 },
  ];
  for (const c of centers) {
    const pos = placeNewCard(realistic, c.x, c.y);
    realistic.push({ id: `real-${realistic.length}`, prompt: "x", x: pos.x, y: pos.y, status: "ready", createdAt: 0 });
  }
  const REAL_CARD_W = 360;
  const REAL_CARD_H = 536; // header + capped 440px body + footer, matching FactoryCanvas.tsx
  const realisticOverlap = realistic.some((c, i) =>
    realistic.some(
      (d, j) => j > i && Math.abs(c.x - d.x) < REAL_CARD_W && Math.abs(c.y - d.y) < REAL_CARD_H
    )
  );
  check("placement: spacing holds against realistic (post-fix) card dimensions, not just a token 40px probe", !realisticOverlap);

  /* 10. Legacy layouts saved before this spacing fix (or before the card
   *     body was height-capped) get repaired on load, not just prevented
   *     going forward -- this is what makes the fix visible immediately on
   *     a canvas that already has overlapping cards, instead of only
   *     protecting cards built after the fix ships. */
  saveCanvasWorkspace({
    cards: [
      { id: "legacy-old", prompt: "older card", x: 100, y: 100, status: "ready", plugin: a.plugin, createdAt: 1 },
      { id: "legacy-new", prompt: "newer card placed too close under the old H=240 rule", x: 110, y: 110, status: "ready", plugin: a.plugin, createdAt: 2 },
    ],
    view: { x: 0, y: 0, zoom: 1 },
  });
  const repaired = loadCanvasWorkspace();
  const older = repaired.cards.find((c) => c.id === "legacy-old");
  const newer = repaired.cards.find((c) => c.id === "legacy-new");
  check(
    "repair: an old card keeps its exact saved position",
    !!older && older.x === 100 && older.y === 100
  );
  check(
    "repair: a colliding newer card gets nudged clear of it on load",
    !!newer && !(Math.abs(newer.x - 100) < 360 + 24 && Math.abs(newer.y - 100) < 536 + 24)
  );

  /* 11. mergeRebuildChanges: the rebuild modal's "any changes you'd like
   *     made?" text gets folded into a fresh rebuild prompt -- a rebuild
   *     re-runs the whole pipeline from scratch, it isn't an edit pass, so
   *     the requested changes have to become PART of the prompt text
   *     itself. Blank input must be a true no-op (a plain "rebuild as
   *     before" must never grow a stray "(also: )" suffix). */
  check(
    "mergeRebuildChanges: blank changes leave the prompt byte-for-byte unchanged",
    mergeRebuildChanges("a warm tape delay", "") === "a warm tape delay"
  );
  check(
    "mergeRebuildChanges: whitespace-only changes are treated as blank",
    mergeRebuildChanges("a warm tape delay", "   \n  ") === "a warm tape delay"
  );
  check(
    "mergeRebuildChanges: real changes are folded into the prompt",
    mergeRebuildChanges("a warm tape delay", "make it wobblier").includes("a warm tape delay") &&
      mergeRebuildChanges("a warm tape delay", "make it wobblier").includes("make it wobblier")
  );
  check(
    "mergeRebuildChanges: surrounding whitespace on real changes is trimmed",
    mergeRebuildChanges("x", "  trimmed  ") === "x (also: trimmed)"
  );

  console.log(failures === 0 ? "\nCANVAS FACTORY: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
