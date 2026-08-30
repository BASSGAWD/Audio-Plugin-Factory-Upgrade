/**
 * Edit-by-default intent: after the first build, the user's words modify the
 * LOADED plugin in place -- a full regeneration only happens when they
 * explicitly ask for one ("restart", "start over", "from scratch") or ask for
 * a genuinely new thing ("make me a compressor"). This turns the standing
 * rule "additive refinement, not regeneration" from a hope into routing.
 *
 *   "edit"    -> run the surgical edit pass on the loaded plugin
 *   "rebuild" -> fall through to the normal generation pipeline
 *   "none"    -> not a change request at all (pure conversation/question);
 *                the existing flow decides what to do
 */

import { classifyPluginIntent } from "./pluginSpec";
import { isRelativeTweakRequest } from "./offlineBuilder";

/** Explicit do-over wording always wins: the user is asking to regenerate. */
const RESTART_WORDING =
  /\b(restart|start (?:over|again|fresh)|from scratch|scrap (?:it|this|that)|throw (?:it|this) (?:away|out)|regenerate|redo (?:it|this|the whole)|(?:completely |totally )?rebuild)\b/i;

/** "Make/build me a <thing>" -- asking for a new plugin, not an adjustment. */
const NEW_THING_WORDING = /\b(make|build|create|generate|design|give)\s+(?:me\s+)?(?:a|an|another|some kind of)\b/i;

/** Change-request verbs that operate on what's already loaded. */
const EDIT_WORDING =
  /\b(add|change|rename|adjust|tweak|edit|modify|increase|decrease|reduce|raise|lower|widen|extend|shorten|remove|replace|swap|fix|improve|refine|polish|smooth|too\s+\w+|more|less|brighter|darker|warmer|wetter|drier|louder|quieter|faster|slower|longer|tighter|dirtier|cleaner)\b/i;

/** Questions are conversation, not change requests. */
const QUESTION_WORDING = /^(what|why|how|when|where|who|which|does|do|is|are|can|could|should|explain|tell me)\b|\?\s*$/i;

/** How a fresh build description starts in natural English -- "a warmer
 *  vintage delay...", "a brighter shimmer reverb...", never "make it
 *  brighter" or "brighter please" (those don't take an indefinite article
 *  at all). */
const LEADING_ARTICLE = /^\s*(?:a|an)\b/i;

/**
 * A prompt phrased as a full description of a NEW plugin ("a brighter
 * shimmer reverb with size and tone controls") reads exactly like a build
 * request even though it also contains a tonal adjective EDIT_WORDING
 * watches for ("brighter", "warmer", "cleaner", "darker", "smoother", ...) --
 * and a plugin is loaded almost always (the default starting plugin loads
 * before the user's first message), so without this check, describing a
 * NEW sound's character in the single most natural way English allows
 * ("a warmer vintage delay with feedback and tone controls") silently
 * edits whatever happens to be loaded instead of building the thing being
 * described. Verified empirically: "a warmer vintage delay...", "a
 * cleaner, smoother compressor...", "a brighter shimmer reverb...", and "a
 * darker ambient pad synth..." all classified as "edit" before this check
 * existed.
 *
 * Recognized by three independent signals, all required: starts with an
 * indefinite article (how a fresh description is phrased; a tweak of an
 * existing plugin says "make it brighter" or "brighter please", never "a
 * brighter ..."), names a REAL recognized plugin family (so "a bit
 * brighter" -- family hybrid_other -- is excluded regardless of its
 * leading "a"), and has enough words to actually be a description rather
 * than a short hedge that coincidentally starts with "a" (a second,
 * independent guard alongside the family check).
 */
function looksLikeFreshBuildDescription(text: string): boolean {
  if (!LEADING_ARTICLE.test(text)) return false;
  if (text.trim().split(/\s+/).length < 5) return false;
  return classifyPluginIntent(text).family !== "hybrid_other";
}

export type EditIntent = "edit" | "rebuild" | "none";

export function classifyEditIntent(
  prompt: string,
  opts: { hasPlugin: boolean; noteCount?: number } = { hasPlugin: false }
): EditIntent {
  const text = prompt.trim();

  // Element notes pinned on the canvas are an edit by definition.
  if (opts.hasPlugin && (opts.noteCount ?? 0) > 0) return "edit";
  if (!opts.hasPlugin) return "none";

  if (RESTART_WORDING.test(text)) return "rebuild";

  // Asking for a new THING (a recognizable plugin family) is a rebuild --
  // "make a compressor" after a delay build replaces it. But "add a chorus"
  // and "make it brighter" stay edits: the new-thing wording requires the
  // make-me-a phrasing AND a family the classifier actually recognizes.
  if (NEW_THING_WORDING.test(text)) {
    const family = classifyPluginIntent(text).family;
    if (family !== "hybrid_other") return "rebuild";
  }

  if (QUESTION_WORDING.test(text)) return "none";

  // See looksLikeFreshBuildDescription's doc comment: must be checked BEFORE
  // EDIT_WORDING, since a full description of a new plugin's character
  // ("a warmer vintage delay...") legitimately contains an EDIT_WORDING
  // adjective without being an edit request at all.
  if (looksLikeFreshBuildDescription(text)) return "rebuild";

  if (isRelativeTweakRequest(text)) return "edit";
  if (EDIT_WORDING.test(text)) return "edit";

  return "none";
}
