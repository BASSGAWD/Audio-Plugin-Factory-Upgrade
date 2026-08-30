/**
 * Candidate recipe memory -- the harness's "self-improving recipe memory"
 * stage. After a generation clears the quality gate at a high score, its
 * dspFunction is a proven, project-specific example of that plugin family.
 * Saving it (and preferring it as a reference the NEXT time a similar
 * request comes in) means the factory gets measurably better at requests
 * it has already solved well, without any network call or manual curation.
 *
 * This is intentionally lightweight: localStorage, capped list, simple
 * keyword-overlap matching. It complements the hand-authored DSP_RECIPES in
 * dspRecipes.ts rather than replacing them -- hand-authored recipes cover
 * the six core families unconditionally; candidate recipes add
 * project-specific wins for whatever the user actually asked for.
 */

import { PluginFamily } from "./pluginSpec";

export interface CandidateRecipe {
  /** Original user request that produced this build. */
  sourcePrompt: string;
  family: PluginFamily | null;
  dspFunction: string;
  /** Lowest of the four gate scores at save time -- the honest headline number. */
  minScore: number;
  savedAt: string;
}

const STORAGE_KEY = "orange_juce_candidate_recipes";
const MAX_STORED = 24;
/** Only successes this good are worth reusing as a reference. */
const MIN_SCORE_TO_SAVE = 95;

function loadAll(): CandidateRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(list: CandidateRecipe[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {
    // localStorage full or unavailable -- candidate memory is a nice-to-have, never fatal
  }
}

/**
 * Record a successful build as a candidate recipe. Only called after the
 * quality gate scores it >= MIN_SCORE_TO_SAVE across every dimension, so
 * this list only ever grows with genuinely good references.
 */
export function saveCandidateRecipe(sourcePrompt: string, family: PluginFamily | null, dspFunction: string, minScore: number): void {
  if (minScore < MIN_SCORE_TO_SAVE) return;

  const list = loadAll();
  const entry: CandidateRecipe = {
    sourcePrompt: sourcePrompt.slice(0, 200),
    family,
    dspFunction,
    minScore,
    savedAt: new Date().toISOString(),
  };

  // Keep at most one candidate per family so memory stays diverse instead of
  // filling up with five near-identical delay builds.
  const filtered = family ? list.filter((c) => c.family !== family) : list;
  saveAll([entry, ...filtered]);
}

function keywordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().match(/[a-z]{4,}/g) || []);
  const wordsB = new Set(b.toLowerCase().match(/[a-z]{4,}/g) || []);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  wordsA.forEach((w) => {
    if (wordsB.has(w)) shared++;
  });
  return shared / Math.min(wordsA.size, wordsB.size);
}

/**
 * Find the best past success matching this request: same family scores
 * highest, otherwise fall back to keyword overlap with the new prompt.
 */
export function findCandidateRecipe(userPrompt: string, family?: PluginFamily | null): CandidateRecipe | null {
  const list = loadAll();
  if (list.length === 0) return null;

  const sameFamily = family ? list.filter((c) => c.family === family) : [];
  if (sameFamily.length > 0) return sameFamily[0];

  let best: CandidateRecipe | null = null;
  let bestScore = 0.34; // require meaningful overlap, not a coincidental shared word
  for (const c of list) {
    const score = keywordOverlap(userPrompt, c.sourcePrompt);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function clearCandidateRecipes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
