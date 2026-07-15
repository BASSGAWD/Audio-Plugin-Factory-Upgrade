/**
 * Failure-driven pitfall memory: the inverse of the self-improving recipe
 * memory. When the quality gate catches a MODEL-generated build doing
 * something wrong (dead knobs, NaN extremes, aliasing fizz, dishonest
 * semantics, broken gain staging), the failure is distilled into a short
 * per-family lesson and stored. Future planner/refiner prompts for that
 * family inject the lessons, so the system prompt evolves from measured
 * failures instead of hand-written guesses -- exactly how the recipes'
 * pitfall lists were originally born, but automated.
 *
 * Deterministic distillation (no model round-trip), localStorage-backed,
 * capped per family, and safe in non-browser contexts (tests, SSR): every
 * storage touch is guarded, and absence of storage degrades to no-ops.
 */

import { BuildReport } from "../types";

const STORAGE_KEY = "orange_juce_learned_pitfalls_v1";
const MAX_LESSONS_PER_FAMILY = 6;

type PitfallStore = Record<string, string[]>;

function loadStore(): PitfallStore {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: PitfallStore): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full/blocked -- lessons are an optimization, never an error
  }
}

/** Turn one gate report's failures into short, reusable lessons. */
export function distillLessons(report: BuildReport): string[] {
  const lessons: string[] = [];

  if (report.deadParams.length > 0) {
    lessons.push(
      `A previous build shipped DEAD controls (${report.deadParams.slice(0, 3).join(", ")}) -- read every params.<id> and make each one audibly change the output math between its min and max.`
    );
  }
  if (report.unstableParams.length > 0) {
    lessons.push(
      `A previous build produced NaN/Infinity at knob extremes (${report.unstableParams.slice(0, 3).join(", ")}) -- clamp coefficients, guard divisions, and wrap buffer indices across the FULL declared [min, max] range.`
    );
  }
  if (report.semanticViolations && report.semanticViolations.length > 0) {
    lessons.push(
      `A previous build had controls that did the OPPOSITE of their name (${report.semanticViolations.slice(0, 3).join(", ")}) -- a Cutoff must brighten as it opens, Feedback must lengthen the tail, Drive must add harmonics, Mix must move dry->wet.`
    );
  }
  if (report.harsh) {
    lessons.push(
      `A previous build had audible aliasing fizz (inharmonic ratio ${(report.aliasingIndex ?? 0).toFixed(2)}) -- oversample the nonlinearity 2x (shape the midpoint of the previous and current sample too, then average) and lowpass after it.`
    );
  }
  if (report.silentOnSignals && report.silentOnSignals.length > 0) {
    lessons.push(
      `A previous build went silent on ${report.silentOnSignals.join(", ")} material while working on the arp -- the DSP must stay alive on plucked, sustained, AND percussive input, not just continuous tones.`
    );
  }
  // Gain staging only becomes a lesson when it was BADLY off -- small trims
  // are routine (even golden recipes get one) and would teach nothing.
  const gainFix = report.fixes.find((f) => /Gain staging corrected: output was ([+-]?[\d.]+) dB/i.test(f));
  if (gainFix) {
    const db = Math.abs(parseFloat(gainFix.match(/output was ([+-]?[\d.]+) dB/i)![1]));
    if (db > 6) {
      lessons.push(
        `A previous build's output was ${db.toFixed(1)} dB off the dry signal level -- keep the processed output within ~1.5 dB of the input at default settings.`
      );
    }
  }

  return lessons;
}

/** Record a model build's measured failures as lessons for its family. */
export function recordLessons(family: string | null | undefined, report: BuildReport): void {
  if (!family) return;
  const lessons = distillLessons(report);
  if (lessons.length === 0) return;

  const store = loadStore();
  const current = store[family] ?? [];
  for (const lesson of lessons) {
    // Dedup by the lesson's stable prefix (the parenthesized specifics vary).
    const prefix = lesson.slice(0, 40);
    const existingIdx = current.findIndex((l) => l.slice(0, 40) === prefix);
    if (existingIdx >= 0) current.splice(existingIdx, 1);
    current.unshift(lesson);
  }
  store[family] = current.slice(0, MAX_LESSONS_PER_FAMILY);
  saveStore(store);
}

/**
 * Prompt block of learned lessons for a family ("" when none) -- appended to
 * the planner's DSP worker and the refinement loop's refiner user text.
 */
export function learnedPitfallsFor(family: string | null | undefined): string {
  if (!family) return "";
  const lessons = loadStore()[family] ?? [];
  if (lessons.length === 0) return "";
  return `\n\nLEARNED FROM PREVIOUS FAILED BUILDS OF THIS FAMILY (do not repeat these mistakes):\n${lessons
    .map((l) => `- ${l}`)
    .join("\n")}`;
}

/** Wipe all learned lessons (settings/debug). */
export function clearLearnedPitfalls(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
