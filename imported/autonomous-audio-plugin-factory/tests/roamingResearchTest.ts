/**
 * Roaming Mode — the Research Lab's always-on background researcher.
 *
 * Verifies the two things that actually matter, per CLAUDE.md's decisive-
 * gap standard (honest vs. deliberately broken, assert a real gap):
 *
 *  1. The picker actually ADVANCES through the full gap list instead of
 *     getting stuck retrying the first structurally-blocked gap forever
 *     (a real trap runResearch's own "return the existing pending item"
 *     dedup creates for any naive "always pick gaps[0]" driver).
 *  2. The safety gate is untouched: isApprovable() is never relaxed for
 *     "roaming" the way it isn't for "auto" or a human's own click --
 *     a blocked/gate-failed concept stays pending and untouched, exactly
 *     like a disabled Approve button.
 *
 * Uses the same three permanent "test invariant" corpus fixtures the rest
 * of this pipeline's tests already rely on for exactly this purpose (see
 * researchCorpus.ts, researchEngineTest.ts, researchIndexTest.ts):
 *   __test_anchor_never_satisfied__   -- no corpus entry -> "no findings" (blocked)
 *   test-lifecycle-blocked-fixture    -- real claims, permanently `blocked:` (blocked)
 *   test-lifecycle-fixture-a          -- real claims + a gate-passing module (approvable)
 * In a fresh process with no research history, these are the ONLY three
 * open gaps (the real curriculum is fully covered by the static graph
 * alone) -- confirmed empirically before writing this file, not assumed.
 * That makes them a complete, deterministic, already-intentional fixture
 * set for proving the picker visits all three exactly once.
 */
import { runRoamingTick, pickNextRoamingGap, isRoamingEnabled, setRoamingEnabled } from "../src/utils/roamingResearch";
import { listKnowledgeGaps } from "../src/utils/knowledgeAudit";
import { runResearch, readResearchQueue, resolveResearchConcept } from "../src/utils/researchEngine";
import { knownConcepts } from "../src/utils/knowledgeGraph";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

// localStorage stub -- same pattern researchEngineTest.ts already uses.
let mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

const OFFLINE = { sources: { llmConfig: null, webFetcher: null } };

(async () => {
  /* ---- 1. Decisive gap: does the picker actually advance? ---- */
  {
    // Deliberately-broken control: always pick listKnowledgeGaps()[0].
    // runResearch returns the SAME existing pending item with no network
    // call once one exists -- so this "picker" can never make progress.
    const brokenSeen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const gap = listKnowledgeGaps()[0];
      const item = await runResearch(gap.researchKey, OFFLINE.sources);
      brokenSeen.add(item.concept);
    }
    check(
      "deliberately-broken always-pick-gaps[0] driver gets stuck on the same concept",
      brokenSeen.size === 1,
      `distinct=${brokenSeen.size} seen=${[...brokenSeen]}`
    );

    // Reset and prove the real picker does not have this bug.
    mem = new Map<string, string>();
    const honestSeen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const outcome = await runRoamingTick(OFFLINE);
      if (outcome.kind === "auto-added" || outcome.kind === "queued" || outcome.kind === "error") honestSeen.add(outcome.concept ?? "");
    }
    check(
      "runRoamingTick() visits 3 DISTINCT concepts across 3 calls, not stuck on the first",
      honestSeen.size === 3,
      `distinct=${honestSeen.size} seen=${[...honestSeen]}`
    );
  }

  /* ---- 2. Safety + stamps + exhaustion, using a fresh, fully-sequenced
   * run through all 3 known fixtures. ---- */
  {
    mem = new Map<string, string>();

    // 2a. In-flight guard: two concurrent ticks against the same first gap
    // -- exactly one must actually run research, the other must skip.
    const [a, b] = await Promise.all([runRoamingTick(OFFLINE), runRoamingTick(OFFLINE)]);
    const nonSkipped = [a, b].filter((o) => o.kind !== "skipped");
    const skipped = [a, b].filter((o) => o.kind === "skipped");
    check("concurrent ticks: exactly one actually runs, the other is skipped", nonSkipped.length === 1 && skipped.length === 1, `a=${a.kind} b=${b.kind}`);

    // The one that ran should be the "no findings" anchor (first gap,
    // no corpus entry at all) -- and it must be LEFT UNTOUCHED, exactly
    // like a disabled Approve button.
    const first = nonSkipped[0] as Extract<typeof a, { kind: "queued" | "auto-added" | "error" }>;
    check("first tick resolves the 'no findings' anchor", first.kind === "queued" && (first as any).reason === "no-findings", JSON.stringify(first));
    if (first.kind === "queued" || first.kind === "auto-added") {
      const stored = readResearchQueue().find((i) => i.id === first.itemId);
      check(
        "blocked concept ('no findings') stays pending and untouched, decidedBy stays undefined",
        stored?.status === "pending" && stored?.decidedBy === undefined,
        JSON.stringify(stored)
      );
    }

    // 2b. Second tick -> the real, permanently-blocked fixture (genuine
    // blocking conflict, real citations -- a different failure mode than
    // "no findings", proving the reason field actually distinguishes them).
    const second = await runRoamingTick(OFFLINE);
    check("second tick resolves the permanently-blocked fixture", second.kind === "queued" && (second as any).reason === "blocked", JSON.stringify(second));
    if (second.kind === "queued") {
      const stored = readResearchQueue().find((i) => i.id === second.itemId);
      check(
        "structurally-blocked concept also stays pending and untouched",
        stored?.status === "pending" && stored?.decidedBy === undefined,
        JSON.stringify(stored)
      );
    }

    // 2c. Third tick -> the approvable fixture. Same isApprovable() bar
    // as a human's own click -- must actually clear it to auto-add.
    const third = await runRoamingTick(OFFLINE);
    check("third tick auto-adds the approvable fixture", third.kind === "auto-added", JSON.stringify(third));
    if (third.kind === "auto-added") {
      const stored = readResearchQueue().find((i) => i.id === third.itemId);
      check("auto-added item is approved with decidedBy: \"roaming\"", stored?.status === "approved" && stored?.decidedBy === "roaming", JSON.stringify(stored));
      check("approval actually extended known concepts", knownConcepts().includes(third.concept), third.concept);
    }

    // 2d. Fourth tick -> every gap now has an item; nothing left to do.
    const beforeCount = readResearchQueue().length;
    const fourth = await runRoamingTick(OFFLINE);
    check("fourth tick reports idle once every gap has been attempted", fourth.kind === "idle", JSON.stringify(fourth));
    check("idle tick creates no new queue item and makes no network call", readResearchQueue().length === beforeCount);
  }

  /* ---- 3. Persistence round-trip. Only exercised now that every real
   * gap is exhausted (from section 2 above), so setRoamingEnabled(true)'s
   * immediate tick resolves to idle instantly -- no accidental real
   * network call from its default (non-injected) sources. ---- */
  {
    check("roaming starts disabled", isRoamingEnabled() === false);
    setRoamingEnabled(true);
    check("setRoamingEnabled(true) persists", isRoamingEnabled() === true);
    setRoamingEnabled(false);
    check("setRoamingEnabled(false) persists and stops the loop", isRoamingEnabled() === false);
  }

  /* ---- 4. Picker/dedup agreement: pins the one correctness detail that
   * would otherwise silently drift if a future edit re-implements concept
   * resolution instead of importing resolveResearchConcept(). ---- */
  {
    mem = new Map<string, string>();
    const gaps = listKnowledgeGaps();
    check("listKnowledgeGaps() returns real rows with non-empty research keys", gaps.length > 0 && gaps.every((g) => g.researchKey.length > 0), `count=${gaps.length}`);

    const next = pickNextRoamingGap();
    check("pickNextRoamingGap() finds a gap in a fresh queue", next !== null);
    if (next) {
      const item = await runResearch(next.researchKey, OFFLINE.sources);
      check(
        "researched item's stored concept matches resolveResearchConcept(researchKey) exactly",
        item.concept === resolveResearchConcept(next.researchKey),
        `stored=${item.concept} resolved=${resolveResearchConcept(next.researchKey)}`
      );
    }
  }

  console.log(failures === 0 ? "\nROAMING RESEARCH: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
