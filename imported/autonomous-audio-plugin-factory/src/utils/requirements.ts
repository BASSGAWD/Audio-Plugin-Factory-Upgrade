/**
 * Requirements engineering: the questions a senior engineer asks BEFORE
 * choosing a topology, answered deterministically from the prompt's wording.
 *
 * "Make a compressor" is not a spec. Compressing a lead vocal, gluing a mix
 * bus, smashing a drum room, and limiting a live feed are four different
 * designs -- different detectors, knees, attack ranges, and latency budgets.
 * This module reads those requirements out of the words the user actually
 * used and hands them to the knowledge graph, which ranks the competing
 * topologies. No LLM required; when wording is neutral the answer is "any"
 * and the family's proven default topology wins, so generic prompts build
 * exactly what they always built.
 *
 * Every inference records its EVIDENCE (which words triggered it) so the
 * build can say "chosen because you said 'live'" instead of guessing
 * silently -- same honesty contract as the quality gate.
 */

export type SourceMaterial = "vocals" | "drums" | "guitar" | "bass" | "synth" | "mix_bus" | "master" | "any";
export type CharacterGoal = "transparent" | "colored" | "aggressive" | "lofi" | "any";
export type LatencyBudget = "live" | "studio" | "any";

export interface BuildRequirements {
  source: SourceMaterial;
  character: CharacterGoal;
  latency: LatencyBudget;
  /** Human-readable trail: which wording produced each inference. */
  evidence: string[];
}

interface Rule<T extends string> {
  value: T;
  match: RegExp;
  /** Short evidence label, e.g. 'vocal material ("vocal")'. */
  why: string;
}

// Order matters: the FIRST match wins, so the more specific/decisive
// wording is listed first (e.g. "master bus" must beat plain "bus").
const SOURCE_RULES: Array<Rule<SourceMaterial>> = [
  { value: "master", match: /\bmaster(?:ing)?\b|\bmaster\s*bus\b|\b2-?bus\b|final\s+mix/i, why: "mastering/2-bus material" },
  { value: "mix_bus", match: /\bmix\s*bus\b|\bbus\s+(?:comp|glue)|\bglue\b|drum\s*bus|whole\s+mix/i, why: "bus/glue duty" },
  { value: "vocals", match: /\bvocal|\bvox\b|\bvoice\b|\bsing|\brap\b|\bspoken\b/i, why: "vocal material" },
  { value: "drums", match: /\bdrum|\bsnare\b|\bkick\b|\btom(?:s)?\b|\bpercuss|\btransient|\bpunch(?:y)?\b|\bsmash/i, why: "drum/percussive material" },
  { value: "bass", match: /\bbass\b(?!\s*boost)|\bsub\b|\b808\b|low\s*end/i, why: "bass material" },
  { value: "guitar", match: /\bguitar|\briff|\bchug|\bstrum/i, why: "guitar material" },
  { value: "synth", match: /\bsynth|\bpad(?:s)?\b|\bkeys\b|\barp\b/i, why: "synth material" },
];

const CHARACTER_RULES: Array<Rule<CharacterGoal>> = [
  { value: "lofi", match: /\blo-?fi\b|\bcrush|\bbroken\b|\bdusty\b|\bcassette\b|\bdegrad/i, why: "lo-fi character" },
  { value: "aggressive", match: /\baggressive|\bsmash|\bsquash|\bbrutal|\bhard\b|\bheavy\b|\bextreme|\bfuzz\b|\bscream/i, why: "aggressive character" },
  { value: "transparent", match: /\btransparent|\bclean\b|\binvisible\b|\bsurgical|\bpristine|\bsubtle\b|\bgentle\b|\bnatural\b|\buncolou?red\b/i, why: "transparent character" },
  { value: "colored", match: /\bwarm|\bvintage|\banalog(?:ue)?\b|\bcolou?r(?:ed|ful)?\b|\bcharacter\b|\btube\b|\btape\b|\bboutique\b|\bcreamy\b|\bsilky\b/i, why: "colored/vintage character" },
];

const LATENCY_RULES: Array<Rule<LatencyBudget>> = [
  { value: "live", match: /\blive\b|\bstage\b|\bon\s*stage\b|\bmonitoring\b|\breal-?time\b|\b(?:zero|low|no)\s*latency\b|\bperform/i, why: "live/low-latency use" },
  { value: "studio", match: /\bmaster(?:ing)?\b|\bmixdown\b|\bstudio\b|\bpost\b|\boffline\b/i, why: "studio latency budget" },
];

function firstMatch<T extends string>(prompt: string, rules: Array<Rule<T>>, fallback: T, evidence: string[]): T {
  for (const rule of rules) {
    const hit = prompt.match(rule.match);
    if (hit) {
      evidence.push(`${rule.why} ("${hit[0].trim().toLowerCase()}")`);
      return rule.value;
    }
  }
  return fallback;
}

/** Read the engineering requirements out of the prompt. Deterministic. */
export function inferRequirements(prompt: string): BuildRequirements {
  const evidence: string[] = [];
  const source = firstMatch(prompt, SOURCE_RULES, "any", evidence);
  const character = firstMatch(prompt, CHARACTER_RULES, "any", evidence);
  const latency = firstMatch(prompt, LATENCY_RULES, "any", evidence);
  return { source, character, latency, evidence };
}

/** True when the prompt gave us at least one real requirement to act on. */
export function hasRequirements(req: BuildRequirements): boolean {
  return req.source !== "any" || req.character !== "any" || req.latency !== "any";
}
