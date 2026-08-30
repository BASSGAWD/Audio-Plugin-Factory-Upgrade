import type { AudioProjectKind, ClassificationEvidence, IntakeQuestion } from "./contracts";

const SIGNALS: Record<AudioProjectKind, Array<{ pattern: RegExp; weight: number }>> = {
  daw: [
    { pattern: /\b(daw|workstation|multitrack|multi.?track|arrangement)\b/gi, weight: 3 },
    { pattern: /\b(record\s+tracks|arrange|timeline|full\s+studio)\b/gi, weight: 1 },
  ],
  effect: [
    { pattern: /\b(effect|processor)\b/gi, weight: 3 },
    { pattern: /\b(delay|reverb|chorus|distortion|filter|compressor)\b/gi, weight: 1 },
  ],
  instrument: [
    { pattern: /\b(instrument|synth|synthesizer)\b/gi, weight: 3 },
    { pattern: /\b(oscillator|midi keyboard)\b/gi, weight: 1 },
  ],
  sampler: [
    { pattern: /\b(sampler|drum\s*pad|pad\s*machine|mpc)\b/gi, weight: 3 },
    { pattern: /\b(sample|one.?shot)\b/gi, weight: 1 },
  ],
  sequencer: [
    { pattern: /\b(sequencer|step\s*sequence|piano\s*roll)\b/gi, weight: 3 },
    { pattern: /\b(pattern|arpeggiator)\b/gi, weight: 1 },
  ],
  mixer: [
    { pattern: /\b(mixer|mixing|channel\s*strip|console)\b/gi, weight: 3 },
    { pattern: /\b(bus|fader)\b/gi, weight: 1 },
  ],
  mastering: [
    { pattern: /\b(mastering|master\s*bus)\b/gi, weight: 3 },
    { pattern: /\b(finalize|loudness|limiter)\b/gi, weight: 1 },
  ],
  utility: [
    { pattern: /\b(utility|analy[sz]er|tuner|scope)\b/gi, weight: 3 },
    { pattern: /\b(meter|monitor)\b/gi, weight: 1 },
  ],
};

/**
 * Plain-language goals a musician might type without naming a category. These
 * are weak (weight 1) hints so an explicit category term always wins, but they
 * let "make my vocals sit better" resolve to a sensible default instead of the
 * catch-all effect fallback.
 */
const GOAL_HINTS: Array<{ pattern: RegExp; kind: AudioProjectKind }> = [
  { pattern: /\b(warm|glue|thicken|saturate|widen)\s+(?:my|the)\s+\w+/gi, kind: "effect" },
  { pattern: /\b(vocals?\s+sit|sit\s+in\s+the\s+mix|tame\s+harsh)/gi, kind: "effect" },
  { pattern: /\b(play\s+notes|play\s+with\s+a\s+keyboard|make\s+sounds\s+from\s+midi)/gi, kind: "instrument" },
  { pattern: /\b(finger\s+drum|tap\s+out\s+a\s+beat|trigger\s+samples)/gi, kind: "sampler" },
  { pattern: /\b(program\s+a\s+beat|loop\s+a\s+pattern|make\s+a\s+groove)/gi, kind: "sequencer" },
  { pattern: /\b(balance\s+levels|set\s+up\s+faders|blend\s+tracks)/gi, kind: "mixer" },
  { pattern: /\b(make\s+it\s+loud|final\s+polish|ready\s+for\s+release|streaming\s+loudness)/gi, kind: "mastering" },
  { pattern: /\b(see\s+the\s+levels|check\s+the\s+tuning|watch\s+the\s+signal)/gi, kind: "utility" },
  { pattern: /\b(record\s+a\s+song|full\s+song|whole\s+track\s+start\s+to\s+finish|write\s+a\s+song)/gi, kind: "daw" },
];

const KIND_LABEL: Record<AudioProjectKind, string> = {
  effect: "Effect",
  instrument: "Instrument",
  sampler: "Sampler",
  sequencer: "Sequencer",
  mixer: "Mixer",
  mastering: "Mastering",
  utility: "Utility",
  daw: "DAW workstation",
};
const PRIORITY: AudioProjectKind[] = ["daw", "mastering", "mixer", "sequencer", "sampler", "instrument", "utility", "effect"];

export function classifyAudioSoftwarePrompt(prompt: string): ClassificationEvidence {
  const found = PRIORITY.map((kind) => {
    const terms: string[] = [];
    const rejectedTerms: string[] = [];
    let score = 0;
    let firstIndex = Number.POSITIVE_INFINITY;
    for (const signal of SIGNALS[kind]) {
      for (const match of prompt.matchAll(signal.pattern)) {
        const term = match[0].toLowerCase();
        const prefix = prompt.slice(Math.max(0, (match.index || 0) - 18), match.index || 0);
        if (/\b(?:not|no|without)\s+(?:an?\s+)?$/i.test(prefix)) {
          rejectedTerms.push(term);
          continue;
        }
        terms.push(term);
        score += signal.weight;
        firstIndex = Math.min(firstIndex, match.index || 0);
      }
    }
    return { kind, terms, rejectedTerms, score, firstIndex };
  }).filter(item => item.terms.length || item.rejectedTerms.length);
  const positive = found.filter(item => item.terms.length).sort((a, b) =>
    b.score - a.score || a.firstIndex - b.firstIndex || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));

  // Plain-language goal hints only decide when no explicit category term fired.
  const goalHints: { kind: AudioProjectKind; term: string }[] = [];
  if (positive.length === 0) {
    for (const hint of GOAL_HINTS) {
      const match = prompt.match(hint.pattern);
      if (match) goalHints.push({ kind: hint.kind, term: match[0].trim().toLowerCase() });
    }
  }
  const goalWinner = goalHints[0];

  const winner = positive[0] || (goalWinner
    ? { kind: goalWinner.kind, terms: [goalWinner.term], rejectedTerms: [], score: 1, firstIndex: 0 }
    : { kind: "effect" as const, terms: [], rejectedTerms: [], score: 0, firstIndex: 0 });
  const competing = found.filter(item => item.kind !== winner.kind);

  // Ambiguity = a runner-up within one weighted point of the winner. That is a
  // real fork worth confirming, not just "more than one term appeared."
  const alternatives = positive
    .filter(item => item.kind !== winner.kind)
    .map(item => ({ kind: item.kind, score: item.score }));
  const closeContenders = alternatives.filter(alt => winner.score - alt.score <= 1);
  const ambiguous = positive.length > 1 && closeContenders.length > 0;

  const questions: IntakeQuestion[] = [];
  if (ambiguous) {
    questions.push({
      id: "confirm-category",
      prompt: `This could be a ${KIND_LABEL[winner.kind].toLowerCase()} or a ${KIND_LABEL[closeContenders[0].kind].toLowerCase()}. Which are you building?`,
      options: [winner.kind, ...closeContenders.map(c => c.kind)]
        .filter((kind, index, all) => all.indexOf(kind) === index)
        .map(kind => ({ kind, label: KIND_LABEL[kind] })),
    });
  } else if (positive.length === 0 && !goalWinner) {
    questions.push({
      id: "pick-starting-point",
      prompt: "I could not read a category from that. Pick a starting point, or add a detail and send again.",
      options: (["effect", "instrument", "sampler", "sequencer", "mixer", "mastering", "utility", "daw"] as AudioProjectKind[])
        .map(kind => ({ kind, label: KIND_LABEL[kind] })),
    });
  }

  const rationale = positive.length
    ? `${winner.kind} selected from weighted explicit terms: ${winner.terms.join(", ")}${ambiguous ? "; competing categories retained for one-tap revision" : ""}`
    : goalWinner
      ? `${winner.kind} inferred from a plain-language goal ("${goalWinner.term}"); confirm or revise the category before relying on it.`
      : "No positive category term matched; effect is the conservative browser-audio default.";

  return {
    kind: winner.kind,
    confidence: positive.length === 0
      ? (goalWinner ? 0.42 : 0.3)
      : Math.min(0.98, 0.58 + winner.score * 0.08 - (ambiguous ? 0.08 : 0)),
    matched: winner.terms,
    rejected: competing.flatMap(item => [
      ...(item.terms.length ? [`${item.kind}: ${item.terms.join(", ")}`] : []),
      ...(item.rejectedTerms.length ? [`${item.kind} negated: ${item.rejectedTerms.join(", ")}`] : []),
    ]),
    rationale,
    ambiguous,
    alternatives,
    questions,
  };
}