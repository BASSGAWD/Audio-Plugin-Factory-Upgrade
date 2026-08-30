/**
 * The C++/JUCE idiom knowledge base.
 *
 * server/nativeBuild.ts ports a plugin's already-tested JS DSP body to C++
 * with a local LLM, guided only by a short, generic system prompt (the
 * method signature, the no-heap rule, the MEMBER-comment convention). The
 * prompt fully specifies the ALGORITHM (the JS body is given verbatim) --
 * what a small local model actually gets wrong is the C++/JUCE IDIOM: it
 * hand-rolls a one-pole smoother instead of reaching for
 * juce::SmoothedValue, keeps envelope state as a stray local instead of a
 * member, or invents a juce::dsp::Oversampling call that can't fit the
 * per-sample method signature it was just told to preserve.
 *
 * This module is the mirror of dspRecipes.ts for that gap: a small, curated,
 * hand-verified corpus of idiomatic building blocks (NOT whole alternate
 * plugins -- the algorithm is already given) that gets selected by DSP
 * concept and injected as few-shot context into the translation and repair
 * prompts. Every code snippet not flagged `oneTimeSetup` is proven
 * real-time-safe by the SAME auditor (cppAudit.ts) that grades the model's
 * own output -- an exemplar can never itself poison a translation with an
 * unsafe idiom (see tests/cppKnowledgeTest.ts).
 *
 * Concepts reuse the SAME vocabulary knowledgeGraph.ts already uses
 * (cutoff-smoothing, biquad, delay, feedback-loop, ring-buffer,
 * envelope-detector, gain-computer, oversampling, waveshaping, ...) so a
 * human or future tooling can cross-reference the JS and C++ knowledge
 * bases directly, without a parallel taxonomy.
 */

export interface CppPattern {
  id: string;
  title: string;
  /** DSP concepts this pattern is the right exemplar for. */
  concepts: string[];
  /** When/why this is the idiomatic JUCE choice -- shown to the model. */
  guidance: string;
  /** Valid, illustrative C++. Few-shot content, not necessarily a drop-in
   *  processSample body. */
  code: string;
  pitfalls: string[];
  /** Keywords matched (case-insensitively) against raw compiler error text,
   *  so the repair loop can pull the right exemplar when an error names a
   *  relevant symbol -- separate from concept-based selection, which only
   *  runs once, before any error exists. */
  errorKeywords?: string[];
  /** True for patterns that are legitimately CONSTRUCTOR/setup code, not
   *  audio-callback code (e.g. building a ParameterLayout) -- exempts the
   *  pattern from the real-time-safety self-check the same way
   *  codeAudit.ts's stripInitBlocks exempts the JS init guard. Everything
   *  else must pass auditCppRealtimeSafety(code, "core") cleanly. */
  oneTimeSetup?: boolean;
}

export const CPP_PATTERNS: CppPattern[] = [
  {
    id: "smoothed_value_param",
    title: "juce::SmoothedValue for a per-sample-ramped parameter",
    concepts: ["cutoff-smoothing", "parameter-smoothing"],
    guidance:
      "The single biggest gap between a naive port and idiomatic JUCE: the C++ side has no equivalent of the JS smoothing idiom (state.sm += 0.002 * (target - state.sm)) unless the model is shown one. juce::SmoothedValue is the correct, standard replacement -- reach for it whenever a JS `state.smX` ramp is being ported, instead of hand-rolling the same exponential-approach math with a bare float.",
    code: `// MEMBER: juce::SmoothedValue<float, juce::ValueSmoothingTypes::Linear> smCutoff;

// In prepare (double sampleRate, int /*samplesPerBlock*/):
smCutoff.reset (sampleRate, 0.02); // 20 ms ramp -- matches the JS convention's typical settle time

// Per sample, inside processSample:
smCutoff.setTargetValue (params.cutoff);
const float cutoff = smCutoff.getNextValue();`,
    pitfalls: [
      "Call reset(sampleRate, rampSeconds) once in prepare(), never per-sample -- it re-arms the ramp from the CURRENT value, so calling it every sample defeats smoothing entirely.",
      "setTargetValue is safe to call every sample even when the value hasn't changed -- it's cheap and idempotent; don't guard it with an if.",
    ],
    errorKeywords: ["SmoothedValue", "getNextValue", "setTargetValue", "zipper"],
  },
  {
    id: "biquad_iir_filter",
    title: "juce::dsp::IIR::Filter for a biquad stage",
    concepts: ["biquad", "state-variable-filter", "cutoff-smoothing"],
    guidance:
      "When the JS body hand-rolls biquad coefficients (the RBJ cookbook A/alpha/cos-w0 shape, or a one-pole exp() smoother feeding a difference equation), the idiomatic C++ port is juce::dsp::IIR::Filter driven by juce::dsp::IIR::Coefficients' factory methods -- NOT a manual translation of the JS's own coefficient math into raw member floats, which throws away JUCE's tested, denormal-safe implementation for no benefit.",
    code: `// MEMBER: juce::dsp::IIR::Filter<float> biquad;

// In prepare (double sampleRate, int samplesPerBlock):
juce::dsp::ProcessSpec spec { sampleRate, (juce::uint32) samplesPerBlock, 1 };
biquad.prepare (spec);
biquad.reset();

// When the cutoff/Q/gain parameters change (recompute at most once per
// block, not per sample -- coefficient recomputation is not free):
*biquad.coefficients = *juce::dsp::IIR::Coefficients<float>::makePeakFilter (
    sampleRate, params.freq, params.q, juce::Decibels::decibelsToGain (params.boost));

// Per sample, inside processSample:
const float y = biquad.processSample (inputSample);`,
    pitfalls: [
      "Recompute coefficients per BLOCK (or only when the smoothed parameter has actually moved), never per sample -- makePeakFilter/makeLowPass do real trigonometry and are too expensive for the inner sample loop.",
      "prepare() must run before the first processSample call or the filter's internal state is uninitialized.",
      "Use makeLowPass/makeHighPass/makeBandPass/makeNotch/makePeakFilter/makeLowShelf/makeHighShelf to match the JS filter's actual topology -- don't default to peaking for a lowpass port.",
    ],
    errorKeywords: ["IIR::Filter", "IIR::Coefficients", "makeLowPass", "makePeakFilter", "dsp::IIR", "ProcessSpec"],
  },
  {
    id: "ring_buffer_delay_line",
    title: "Fixed-size ring buffer for a delay/feedback line",
    concepts: ["delay", "feedback-loop", "ring-buffer", "fractional-delay"],
    guidance:
      "The JS side's `state.buf[i]` ring buffer (a plain array with a wrapping write pointer) ports directly to a fixed-size C-array member -- this is already the correct, no-heap idiom and needs no JUCE-specific API. The only things a naive port gets wrong are keeping the write pointer as a stray local (it must be a member, it persists across calls) and off-by-one wrap arithmetic on the read index.",
    code: `// MEMBER: float delayBuf[96000] = {};
// MEMBER: int delayWritePos = 0;

// Per sample, inside processSample:
const int delaySamples = juce::jlimit (1, 95999, (int) (params.time * 0.001f * 44100.0f));
int readPos = delayWritePos - delaySamples;
if (readPos < 0) readPos += 96000;
const float wet = delayBuf[readPos];
delayBuf[delayWritePos] = inputSample + wet * params.feedback;
delayWritePos = (delayWritePos + 1) % 96000;`,
    pitfalls: [
      "The write pointer and the buffer itself MUST be members (declared via // MEMBER:), never locals -- a local resets to 0 every call and the delay line never accumulates history.",
      "Wrap the read index AFTER subtracting, not before -- `(delayWritePos - delaySamples + 96000) % 96000` and the two-step `if (readPos < 0) readPos += 96000;` shown above are equivalent; either is fine, but a bare `% ` on a value that can go negative is NOT (C++'s % can return negative for negative operands, unlike a true modulo).",
      "Clamp delaySamples strictly below the buffer length (95999, not 96000) or the read can alias the sample currently being written.",
    ],
    errorKeywords: ["delayBuf", "delayWritePos", "array subscript", "out of bounds"],
  },
  {
    id: "envelope_follower",
    title: "Envelope follower as persistent member state",
    concepts: ["envelope-detector", "attack-release", "gain-computer"],
    guidance:
      "The JS `state.env += (x > state.env ? attackCoeff : releaseCoeff) * (x - state.env)` idiom ports almost verbatim -- the ONLY thing that goes wrong in a naive translation is declaring `env` as a local `float` inside processSample instead of a member. A local re-initializes to 0 every call, so the envelope can never actually follow anything across samples.",
    code: `// MEMBER: float envState = 0.0f;

// Per sample, inside processSample:
const float x = std::abs (inputSample);
const float coeff = (x > envState) ? attackCoeff : releaseCoeff;
envState += coeff * (x - envState);`,
    pitfalls: [
      "envState (and any comparably-named envelope/state variable) MUST be declared via // MEMBER:, not as a local -- this is the single most common bug a naive JS-to-C++ port introduces, since JS's `state.env` looks lexically like a plain variable read/write.",
      "attackCoeff/releaseCoeff should themselves be derived from a time constant via std::exp(-1.0f / (timeMs * 0.001f * sampleRate)), matching whatever the JS original used -- don't invent new time constants.",
    ],
    errorKeywords: ["envState"],
  },
  {
    id: "apvts_parameter_layout",
    title: "AudioProcessorValueTreeState::ParameterLayout builder",
    concepts: ["parameter-layout", "apvts"],
    guidance:
      "This is CONSTRUCTOR-time setup code, run once when the processor is built -- not audio-callback code, so std::vector/std::make_unique here are correct and safe (unlike the same calls inside processSample, which would be a real-time-safety violation). Shown for reference when a repair error touches parameter registration, not because the generated template usually needs changing here.",
    code: `juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;
    params.push_back (std::make_unique<juce::AudioParameterFloat> (
        juce::ParameterID { "cutoff", 1 },
        "Cutoff",
        juce::NormalisableRange<float> (20.0f, 20000.0f, 0.01f, 0.3f), // skewed for a musical sweep
        1000.0f));
    return { params.begin(), params.end() };
}`,
    pitfalls: [
      "This function itself must never be called from processBlock/processSample -- it belongs in the constructor's apvts initializer list, exactly once.",
      "The NormalisableRange skew factor (0.3f above) should make a linear on-screen slider feel musically even across a wide Hz range -- 1.0 (unskewed) makes most of the useful low-frequency range crowd into a tiny slider travel.",
    ],
    errorKeywords: ["ParameterLayout", "RangedAudioParameter", "AudioParameterFloat", "ParameterID"],
    oneTimeSetup: true,
  },
  {
    id: "oversampling_2x",
    title: "Why juce::dsp::Oversampling does not fit the per-sample contract",
    concepts: ["oversampling", "waveshaping", "block-based-processing"],
    guidance:
      "A known architectural limit, documented so the model doesn't hallucinate a mismatched API call: juce::dsp::Oversampling operates on BLOCKS (juce::dsp::AudioBlock), not single samples, so it cannot be dropped into `processSample(float, const Params&) noexcept` as written -- that would require restructuring ProcessorCore around a block-based override, a structural change this translation step does not make. If the JS original uses a 2x midpoint-average oversampling idiom for anti-aliasing, port that SCALAR per-sample technique literally (it works fine sample-by-sample); do not invent a juce::dsp::Oversampling call inside processSample.",
    code: `// The JS 2x midpoint-average oversampling idiom ports as plain scalar code,
// entirely within the per-sample contract -- no juce::dsp::Oversampling needed:
// MEMBER: float prevIn = 0.0f;
// MEMBER: float prevShaped = 0.0f;

const float midIn = 0.5f * (prevIn + inputSample);
const float shapedMid = std::tanh (midIn * driveGain);
const float shapedCur = std::tanh (inputSample * driveGain);
const float wet = 0.5f * (prevShaped + shapedCur); // simple 2-tap average, matches the JS box-filter decimator
prevShaped = shapedCur;
prevIn = inputSample;`,
    pitfalls: [
      "Do not call juce::dsp::Oversampling::processSamplesUp/Down from inside processSample -- its API is block-shaped (AudioBlock<float>) and does not have a per-sample equivalent.",
      "If a plugin genuinely needs real oversampling (not just the cheap midpoint-average anti-aliasing trick), that is a ProcessorCore architecture change (block-based processing), out of scope for a like-for-like translation -- flag it in a comment rather than guessing at a signature change.",
    ],
    errorKeywords: ["Oversampling", "AudioBlock", "ProcessContextReplacing", "processSamplesUp"],
  },
  {
    id: "lock_free_atomic_param_read",
    title: "Snapshot APVTS parameters once per block, not per sample",
    concepts: ["lock-free", "parameter-snapshot"],
    guidance:
      "Documents what the generated processBlock() ALREADY does correctly, so the repair loop doesn't 'fix' this away when patching an unrelated nearby error: every automatable parameter is read from the APVTS exactly ONCE per block into a plain Params struct, then the per-sample loop reads that struct (not the APVTS) for every sample.",
    code: `Params params;
params.cutoff = apvts.getRawParameterValue ("cutoff")->load();
params.resonance = apvts.getRawParameterValue ("resonance")->load();

for (int i = 0; i < buffer.getNumSamples(); ++i)
    data[i] = sanitizeSample (core.processSample (data[i], params));`,
    pitfalls: [
      "Do NOT call apvts.getRawParameterValue(...)->load() inside the per-sample loop -- it's an atomic load, technically real-time-safe on its own, but wasteful when done N times instead of once, and the whole point of snapshotting once per block is to avoid a parameter tearing mid-block.",
    ],
    errorKeywords: ["getRawParameterValue", "apvts"],
  },
];

/** Coarse category -> concept hints. Mirrors AudioPlugin["category"]'s
 *  7-value vocabulary; NativePlugin.category is loosely typed as `string`,
 *  so lookups are guarded, never assumed present. */
const CATEGORY_TO_CONCEPTS: Record<string, string[]> = {
  delay: ["delay", "ring-buffer", "feedback-loop", "cutoff-smoothing"],
  reverb: ["delay", "ring-buffer", "cutoff-smoothing"],
  dynamics: ["envelope-detector", "gain-computer", "attack-release", "cutoff-smoothing"],
  filter: ["biquad", "state-variable-filter", "cutoff-smoothing"],
  distortion: ["oversampling", "waveshaping", "cutoff-smoothing"],
  modulation: ["delay", "ring-buffer", "cutoff-smoothing"],
  synthesizer: ["cutoff-smoothing", "envelope-detector"],
};

/** Structural sniff of the JS dspFunction BODY itself -- always fully
 *  available, and catches cases the coarse category alone misses (e.g. a
 *  "modulation" chorus that also needs the ring-buffer pattern). */
const STRUCTURAL_SIGNALS: Array<{ concept: string; test: RegExp }> = [
  { concept: "ring-buffer", test: /state\.\w+\[[^\]]*\]\s*=/ },
  { concept: "envelope-detector", test: /state\.env\w*\s*\+=/ },
  { concept: "gain-computer", test: /20\s*\*\s*Math\.log10/ },
  { concept: "cutoff-smoothing", test: /state\.sm\w*\s*\+=/ },
  { concept: "biquad", test: /Math\.exp\(-2\s*\*\s*Math\.PI/ },
];

/** Select up to `max` exemplars whose concepts best match the plugin's
 *  category + the JS body's own structure, ranked by overlap count, ties
 *  broken by declaration order in CPP_PATTERNS. Empty array when nothing
 *  matches -- callers must treat that as "no relevant exemplar," not
 *  "match everything." */
export function selectCppExemplars(category: string | undefined, dspFunction: string, max = 3): CppPattern[] {
  const concepts = new Set<string>();
  if (category && CATEGORY_TO_CONCEPTS[category]) {
    for (const c of CATEGORY_TO_CONCEPTS[category]) concepts.add(c);
  }
  for (const sig of STRUCTURAL_SIGNALS) {
    if (sig.test.test(dspFunction)) concepts.add(sig.concept);
  }
  if (concepts.size === 0) return [];
  return CPP_PATTERNS
    .map((p) => ({ p, score: p.concepts.filter((c) => concepts.has(c)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

function formatExemplarBlock(p: CppPattern): string {
  const pitfalls = p.pitfalls.length ? `\nPitfalls:\n${p.pitfalls.map((x) => `- ${x}`).join("\n")}` : "";
  return `### ${p.title}\n${p.guidance}\n\`\`\`cpp\n${p.code}\n\`\`\`${pitfalls}`;
}

/** Few-shot context for the initial translation prompt. Empty string when
 *  no exemplar matches -- same null-object contract dspRecipes.ts's own
 *  recipe-context injection uses, so callers can append it unconditionally. */
export function buildCppPatternContext(category: string | undefined, dspFunction: string): string {
  const exemplars = selectCppExemplars(category, dspFunction);
  if (exemplars.length === 0) return "";
  return `\n\nIdiomatic JUCE reference patterns for this kind of plugin (models for the C++ IDIOM only -- still preserve the exact algorithm from the JS body above):\n\n${exemplars.map(formatExemplarBlock).join("\n\n")}`;
}

/** Select exemplars by matching `errorKeywords` against raw compiler error
 *  text (case-insensitive substring match), for the repair loop -- a
 *  separate selection pass from selectCppExemplars, since it only runs
 *  once an error actually exists. */
export function selectCppExemplarsForErrors(errors: string[], max = 2): CppPattern[] {
  const joined = errors.join(" ").toLowerCase();
  return CPP_PATTERNS
    .filter((p) => p.errorKeywords && p.errorKeywords.length > 0)
    .map((p) => ({ p, score: p.errorKeywords!.filter((k) => joined.includes(k.toLowerCase())).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

/** Few-shot context for the repair prompt. Empty string when no exemplar's
 *  errorKeywords match. */
export function buildCppErrorPatternContext(errors: string[]): string {
  const exemplars = selectCppExemplarsForErrors(errors);
  if (exemplars.length === 0) return "";
  return `\n\nRelevant idiomatic JUCE reference patterns (the failing code may be trying to approximate one of these):\n\n${exemplars.map(formatExemplarBlock).join("\n\n")}`;
}
