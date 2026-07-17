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
};

export function webSourcesFor(concept: string): WebSource[] {
  return WEB_SOURCES[concept] ?? [];
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
