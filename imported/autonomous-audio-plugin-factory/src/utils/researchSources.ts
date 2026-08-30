/**
 * Curated web sources for the Research Engine's live gatherer.
 *
 * The web gatherer is OPT-IN and fetches only from this hand-picked allowlist
 * of authoritative DSP references — never arbitrary URLs, never anything
 * derived from fetched content. Everything it returns is DATA a human reviews
 * before approval: cited claims that enrich a research item's evidence. It
 * can NEVER produce a buildable module (those still require gate verification)
 * and can NEVER un-block a blocked concept. Fetched text is treated as
 * untrusted: extraction is pure keyword sentence-matching — no instruction in
 * a page is ever acted on.
 */

import { corpusEntriesFor } from "./researchCorpus";

export interface WebSource {
  url: string;
  title: string;
  source: string;
  /** Authority tier of the SOURCE (0-100), same scale as corpus citations. */
  authority: number;
  /** Keywords that mark a sentence as relevant on this page. */
  keywords: string[];
}

/**
 * concept -> authoritative reference pages. Keyed by the same concept slugs
 * the corpus and knowledge graph use. Only concepts listed here get web
 * enrichment; anything else honestly returns nothing.
 */
export const WEB_SOURCES: Record<string, WebSource[]> = {
  phaser: [
    { url: "https://en.wikipedia.org/wiki/Phaser_(effect)", title: "Phaser (effect)", source: "Wikipedia", authority: 75, keywords: ["allpass", "notch", "sweep", "feedback", "phaser"] },
  ],
  compressor: [
    { url: "https://en.wikipedia.org/wiki/Dynamic_range_compression", title: "Dynamic range compression", source: "Wikipedia", authority: 75, keywords: ["threshold", "ratio", "attack", "release", "knee", "makeup"] },
  ],
  "parallel-compression": [
    { url: "https://en.wikipedia.org/wiki/Parallel_compression", title: "Parallel compression", source: "Wikipedia", authority: 75, keywords: ["parallel", "blend", "dry", "compressed", "density"] },
  ],
  reverb: [
    { url: "https://ccrma.stanford.edu/~jos/pasp/Reverberation.html", title: "Reverberation", source: "J.O. Smith, Physical Audio Signal Processing (CCRMA)", authority: 95, keywords: ["comb", "allpass", "decay", "reverberation", "reflection"] },
  ],
  convolution: [
    { url: "https://en.wikipedia.org/wiki/Convolution_reverb", title: "Convolution reverb", source: "Wikipedia", authority: 75, keywords: ["impulse response", "convolution", "fir", "filter"] },
  ],
  "fm-synthesis": [
    { url: "https://en.wikipedia.org/wiki/Frequency_modulation_synthesis", title: "Frequency modulation synthesis", source: "Wikipedia", authority: 75, keywords: ["carrier", "modulator", "index", "sideband", "ratio"] },
  ],
  wavetable: [
    { url: "https://en.wikipedia.org/wiki/Wavetable_synthesis", title: "Wavetable synthesis", source: "Wikipedia", authority: 75, keywords: ["wavetable", "single-cycle", "interpolat", "morph"] },
  ],
  biquad: [
    { url: "https://www.w3.org/TR/audio-eq-cookbook/", title: "Audio EQ Cookbook", source: "W3C / R. Bristow-Johnson", authority: 98, keywords: ["biquad", "coefficient", "peaking", "alpha", "cutoff"] },
  ],

  // ---- Live-build discovery additions --------------------------------
  // Same authoritative, non-promotional sourcing discipline as the original
  // 8: Wikipedia/CCRMA/W3C only, never a commercial blog. "opto-model" and
  // "fet-model" reuse the EXACT citation URLs researchCorpus.ts already uses
  // for those concepts (LA-2A / 1176) -- same real hardware, cited the same
  // way, principle extracted and generalized rather than the plugin ever
  // being branded after the real product.
  "opto-model": [
    { url: "https://en.wikipedia.org/wiki/LA-2A_Leveling_Amplifier", title: "LA-2A Leveling Amplifier", source: "Wikipedia", authority: 75, keywords: ["opto", "photocell", "program-dependent", "release", "peak reduction"] },
  ],
  "fet-model": [
    { url: "https://en.wikipedia.org/wiki/1176_Peak_Limiter", title: "1176 Peak Limiter", source: "Wikipedia", authority: 75, keywords: ["fet", "attack", "all-buttons", "limiter", "1176"] },
  ],
  crossover: [
    { url: "https://en.wikipedia.org/wiki/Audio_crossover", title: "Audio crossover", source: "Wikipedia", authority: 75, keywords: ["crossover", "band-split", "low-pass", "high-pass", "linkwitz"] },
  ],
  "state-variable-filter": [
    { url: "https://en.wikipedia.org/wiki/State_variable_filter", title: "State variable filter", source: "Wikipedia", authority: 75, keywords: ["state variable", "svf", "lowpass", "highpass", "bandpass", "resonance"] },
  ],
  chorus: [
    { url: "https://en.wikipedia.org/wiki/Chorus_effect", title: "Chorus effect", source: "Wikipedia", authority: 75, keywords: ["chorus", "detune", "lfo", "modulated delay", "ensemble"] },
  ],
  tremolo: [
    { url: "https://en.wikipedia.org/wiki/Tremolo", title: "Tremolo", source: "Wikipedia", authority: 75, keywords: ["tremolo", "amplitude modulation", "lfo", "rate", "depth"] },
  ],
  "ring-modulation": [
    { url: "https://en.wikipedia.org/wiki/Ring_modulation", title: "Ring modulation", source: "Wikipedia", authority: 75, keywords: ["ring modulation", "carrier", "sideband", "multiplier", "metallic"] },
  ],
  "pitch-detection": [
    { url: "https://en.wikipedia.org/wiki/Pitch_detection_algorithm", title: "Pitch detection algorithm", source: "Wikipedia", authority: 75, keywords: ["pitch detection", "autocorrelation", "fundamental frequency", "f0"] },
  ],
  "granular-synthesis": [
    { url: "https://en.wikipedia.org/wiki/Granular_synthesis", title: "Granular synthesis", source: "Wikipedia", authority: 75, keywords: ["grain", "granular", "window", "overlap", "pitch shift"] },
  ],
  "spectral-processing": [
    { url: "https://en.wikipedia.org/wiki/Short-time_Fourier_transform", title: "Short-time Fourier transform", source: "Wikipedia", authority: 75, keywords: ["stft", "fft", "spectral", "window", "overlap-add"] },
  ],
  oscillator: [
    { url: "https://en.wikipedia.org/wiki/Voltage-controlled_oscillator", title: "Voltage-controlled oscillator", source: "Wikipedia", authority: 75, keywords: ["oscillator", "vco", "waveform", "pitch", "tuning"] },
  ],
  sibilance: [
    { url: "https://en.wikipedia.org/wiki/Sibilant", title: "Sibilant", source: "Wikipedia", authority: 70, keywords: ["sibilance", "de-esser", "high frequency", "consonant"] },
  ],
  oversampling: [
    { url: "https://en.wikipedia.org/wiki/Oversampling", title: "Oversampling", source: "Wikipedia", authority: 75, keywords: ["oversampling", "aliasing", "nyquist", "upsample", "decimation"] },
  ],
  "bit-reduction": [
    { url: "https://en.wikipedia.org/wiki/Bitcrusher", title: "Bitcrusher", source: "Wikipedia", authority: 75, keywords: ["bitcrush", "bit depth", "sample rate reduction", "quantization"] },
  ],
  wavefolding: [
    { url: "https://en.wikipedia.org/wiki/Waveshaper", title: "Waveshaper", source: "Wikipedia", authority: 75, keywords: ["wavefold", "waveshaper", "transfer function", "fold", "harmonics"] },
  ],
  "tape-delay": [
    { url: "https://en.wikipedia.org/wiki/Roland_Space_Echo", title: "Roland Space Echo", source: "Wikipedia", authority: 72, keywords: ["tape delay", "tape echo", "wow and flutter", "feedback", "multi-head"] },
  ],
  "envelope-generator": [
    { url: "https://en.wikipedia.org/wiki/Envelope_(music)", title: "Envelope (music)", source: "Wikipedia", authority: 75, keywords: ["envelope", "attack", "decay", "sustain", "release", "adsr"] },
  ],
  "voice-allocation": [
    { url: "https://en.wikipedia.org/wiki/Polyphony_and_monophony_in_instruments", title: "Polyphony and monophony in instruments", source: "Wikipedia", authority: 75, keywords: ["polyphony", "monophony", "voice allocation", "voice stealing"] },
  ],
  "feedback-delay-network": [
    { url: "https://ccrma.stanford.edu/~jos/pasp/FDN_Reverberation.html", title: "FDN Reverberation", source: "J.O. Smith, Physical Audio Signal Processing (CCRMA)", authority: 95, keywords: ["feedback delay network", "fdn", "matrix", "reverberation"] },
  ],
};

export function webSourcesFor(concept: string): WebSource[] {
  return WEB_SOURCES[concept] ?? [];
}

/**
 * Regex fallback for WEB_SOURCES concepts that have no researchCorpus.ts
 * entry (so resolveWebSourceConcept's primary corpusEntriesFor() pass can't
 * find them). Copied verbatim from the matching family regex in
 * dspRecipes.ts wherever one already exists, rather than reinvented, so
 * detection stays consistent with how the rest of the factory already
 * recognizes these concepts from a prompt. Concepts already resolvable via
 * corpusEntriesFor (opto-model, fet-model, spectral-processing, mid-side)
 * are deliberately absent here -- they don't need a fallback.
 */
const WEB_SOURCE_ONLY_MATCH: Record<string, RegExp> = {
  crossover: /crossover|band.?split|linkwitz.?riley/i,
  "state-variable-filter": /state.?variable|\bsvf\b/i,
  chorus: /chorus|flang|ensemble|leslie|rotary/i, // dspRecipes.ts "modulation" family regex
  tremolo: /tremolo|\btrem\b/i, // dspRecipes.ts "tremolo" regex, verbatim
  "ring-modulation": /ring.?mod|ring.?modulat/i,
  "pitch-detection": /pitch.?detect|autocorrelat|fundamental\s*frequency|\bf0\b/i,
  "granular-synthesis": /granular|grain\b/i,
  oscillator: /oscillator|\bvco\b|voltage.?controlled/i,
  sibilance: /sibilan|de.?ess/i,
  oversampling: /oversampl|anti.?alias/i,
  "bit-reduction": /bitcrush|bit.?reduc|bit.?depth|sample.?rate.?reduc/i,
  wavefolding: /wavefold|wave.?fold/i,
  "tape-delay": /tape.?delay|tape.?echo|space\s*echo/i,
  "envelope-generator": /envelope|\badsr\b|attack.?decay.?sustain.?release/i,
  "voice-allocation": /voice.?alloc|voice.?steal|polyphon|monophon/i,
  "feedback-delay-network": /feedback\s*delay\s*network|\bfdn\b/i,
};

/**
 * Resolve a build prompt (or a bare concept slug) to the best-matching
 * WEB_SOURCES key. Reuses the SAME fuzzy resolution runResearch already
 * relies on (corpusEntriesFor's regex/substring match against
 * RESEARCH_CORPUS) as the primary pass -- so a concept with real research
 * corpus coverage is recognized the identical way the rest of the pipeline
 * already recognizes it -- then falls back to WEB_SOURCE_ONLY_MATCH for
 * concepts that have web coverage but no corpus entry. Returns null on no
 * match; callers must treat that as a silent no-op, never an error.
 */
export function resolveWebSourceConcept(prompt: string): string | null {
  const corpusHit = corpusEntriesFor(prompt)[0]?.concept;
  if (corpusHit && WEB_SOURCES[corpusHit]) return corpusHit;
  for (const [concept, match] of Object.entries(WEB_SOURCE_ONLY_MATCH)) {
    if (match.test(prompt)) return concept;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* OpenAudio index — a curated list of open-source audio projects.     */
/* We surface LINKS to real implementations as reference material for   */
/* the human, never ingesting or shipping their code (copyright + the   */
/* same data-only safety model as every web source).                    */
/* ------------------------------------------------------------------ */

export const OPENAUDIO_INDEX = {
  url: "https://raw.githubusercontent.com/webprofusion/OpenAudio/master/README.md",
  source: "OpenAudio (webprofusion) — curated open-source audio index",
  /** Community-curated index tier (above forums 55, below books 90). */
  authority: 68,
};

export interface IndexEntry {
  name: string;
  url: string;
  description: string;
}

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;

/**
 * Parse the OpenAudio README (markdown) into {name, url, description}
 * entries. Handles both the plugin TABLE rows (`| [Name](url) | desc | … |`)
 * and the Code-Samples BULLET list (`* [Name](url) — desc`). Pure and
 * deterministic; treats the markdown as inert data.
 */
export function parseOpenAudioIndex(markdown: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    const link = line.match(MD_LINK);
    if (!link) continue;
    const name = link[1].trim();
    const url = link[2].trim();
    if (seen.has(url) || !/^https?:\/\//.test(url)) continue;

    let description = "";
    if (line.trimStart().startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      const idx = cells.findIndex((c) => c.includes(url));
      description = idx >= 0 && cells[idx + 1] ? cells[idx + 1] : "";
    } else {
      const after = line.slice(line.indexOf(link[0]) + link[0].length);
      description = after.replace(/^[\s—–\-:|]+/, "").trim();
    }
    description = description.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").slice(0, 220);

    entries.push({ name, url, description });
    seen.add(url);
  }
  return entries;
}

/** Search terms for matching index entries to a research concept. Falls back
 *  to the concept slug's own words when no explicit mapping exists. */
const CONCEPT_SEARCH_TERMS: Record<string, string[]> = {
  convolution: ["convolution", "convolv", "impulse response", "convolution reverb"],
  reverb: ["reverb", "reverberation", "room", "hall", "plate"],
  phaser: ["phaser", "allpass", "phase"],
  compressor: ["compressor", "compression", "dynamics", "limiter"],
  "parallel-compression": ["parallel compression", "compressor", "dynamics"],
  "multiband-compression": ["multiband", "compressor"],
  delay: ["delay", "echo"],
  "multi-tap": ["delay", "echo", "multi-tap"],
  "ping-pong": ["ping-pong", "delay", "stereo delay"],
  distortion: ["distortion", "saturation", "overdrive", "waveshaper", "fuzz"],
  "dynamic-saturation": ["saturation", "distortion", "tape"],
  filter: ["filter", "svf", "state variable"],
  biquad: ["biquad", "eq", "equalizer", "filter"],
  chorus: ["chorus", "flanger", "modulation"],
  "fm-synthesis": ["fm synth", "frequency modulation", "operator", "dexed"],
  wavetable: ["wavetable", "vital", "wavetable synth"],
  synthesizer: ["synth", "synthesizer", "oscillator"],
  "spectral-processing": ["spectral", "fft", "vocoder", "phase vocoder"],
  "pitch-correction": ["pitch", "autotune", "auto-tune", "pitch correction"],
  "granular-pitch-shift": ["granular", "pitch shift"],
  "opto-model": ["opto", "la-2a", "compressor"],
  "fet-model": ["fet", "1176", "compressor"],
  "sidechain-filter": ["de-esser", "sidechain", "compressor"],
  "sidechain-input": ["sidechain", "ducking"],
};

export function searchTermsFor(concept: string): string[] {
  if (CONCEPT_SEARCH_TERMS[concept]) return CONCEPT_SEARCH_TERMS[concept];
  const words = concept.split(/[-_]/).filter((w) => w.length >= 3);
  return words.length > 0 ? words : [concept];
}

/** Rank index entries by how many search terms appear in name+description
 *  (hyphen/space-insensitive), returning the top `max` with any match. */
export function matchIndexEntries(entries: IndexEntry[], terms: string[], max = 4): IndexEntry[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
  const nterms = terms.map(norm).filter(Boolean);
  return entries
    .map((e) => {
      const hay = norm(`${e.name} ${e.description}`);
      const score = nterms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0);
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/**
 * Extract the most relevant sentences from a fetched reference page. Pure and
 * deterministic: strips HTML/scripts, splits into sentences, ranks by keyword
 * hits, returns the top `max` trimmed and de-duplicated. Treats the input as
 * inert data — it never interprets or executes anything in the page.
 */
export function extractRelevantPassages(rawHtml: string, keywords: string[], max = 2): string[] {
  const text = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Normalize by dropping hyphens/spaces so a keyword matches however the
  // source punctuates it ("allpass" finds "all-pass" and "all pass").
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim());
  const kws = keywords.map(norm).filter(Boolean);

  const scored = sentences
    .filter((s) => s.length >= 40 && s.length <= 320)
    .map((s) => {
      const low = norm(s);
      const score = kws.reduce((n, k) => (low.includes(k) ? n + 1 : n), 0);
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
