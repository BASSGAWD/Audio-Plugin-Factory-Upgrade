/**
 * Milestone 2 — the Research Engine.
 *
 * Pipeline for turning a knowledge GAP into approved factory knowledge:
 *
 *   gap concept
 *     -> planResearch()        what to find out, where, and what "good" means
 *     -> gather                built-in corpus (always) + local LLM (optional)
 *     -> extractKnowledge()    claims with citations, ranked by authority
 *     -> detectConflicts()     structural blocks, overlap with verified banks,
 *                              weak-authority warnings
 *     -> verify                proposed DSP modules run through the REAL gate
 *     -> queue                 status "pending" in localStorage
 *     -> HUMAN APPROVAL        nothing becomes factory knowledge until the
 *                              user approves it in the Research Lab
 *
 * Approved items extend the knowledge graph's reachable concepts (coverage
 * rises) and — when they carry a gate-verified module — become buildable:
 * the offline builder prefers an approved researched module whose concept
 * matches the prompt. Rejected items stay visible as history.
 *
 * The model gatherer is OPTIONAL by design: with no local LLM the corpus
 * still yields real, cited findings, so the engine is deterministic and
 * testable offline. Model findings enter at authority 20 (lowest tier) and
 * can never outrank literature.
 */

import { AudioPlugin } from "../types";
import { RESEARCH_CORPUS, CorpusEntry, ResearchClaim, corpusEntriesFor } from "./researchCorpus";
import { RESEARCH_QUEUE_KEY, knownConcepts } from "./knowledgeGraph";
import { runQualityGate } from "./qualityGate";
import { familyToCategory, PluginFamily } from "./pluginSpec";
import { DspRecipe } from "./dspRecipes";
import { LLMConfig, callLocalLLM, isLocalProvider, fetchLLMRoute } from "./llmGateway";
import {
  webSourcesFor, extractRelevantPassages, resolveWebSourceConcept,
  OPENAUDIO_INDEX, parseOpenAudioIndex, matchIndexEntries, searchTermsFor,
} from "./researchSources";

/**
 * Fetches a curated reference URL and returns its raw text, or null on any
 * failure. Injectable so tests stay deterministic and offline; the app wires
 * a proxy-backed implementation (createProxyWebFetcher). The gatherer only
 * ever calls this with URLs from the curated allowlist, never anything
 * derived from fetched content.
 */
export type WebFetcher = (url: string) => Promise<string | null>;

/** Optional enrichment sources for a research run. Both are off by default. */
export interface ResearchSources {
  llmConfig?: LLMConfig | null;
  /** When provided, the OPT-IN live web gatherer runs against the allowlist. */
  webFetcher?: WebFetcher | null;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ResearchPlan {
  concept: string;
  questions: string[];
  sources: string[];
  acceptance: string[];
}

export interface ResearchConflict {
  severity: "blocking" | "info" | "warning";
  text: string;
}

export interface ModuleVerification {
  minScore: number;
  scores: { looks: number; performance: number; latency: number; musicality: number };
  passes: boolean;
  defects: string[];
}

/**
 * A link to an external open-source implementation (from the OpenAudio index).
 * REFERENCE MATERIAL ONLY — a pointer to code the human can read. It is never
 * ingested, never verified into a module, and never affects approval. It
 * exists so a human building a plugin can study real implementations.
 */
export interface CodeReference {
  name: string;
  url: string;
  description: string;
  source: string;
  authority: number;
}

export interface ResearchItem {
  id: string;
  concept: string;
  area: string;
  claims: ResearchClaim[];
  /** Highest citation authority across claims (0-100). */
  topAuthority: number;
  conflicts: ResearchConflict[];
  proposedModule?: {
    family: PluginFamily;
    title: string;
    parameters: DspRecipe["parameters"];
    body: string;
    verification: ModuleVerification;
  };
  /** External code-example links (OpenAudio). Reference only — see above. */
  references?: CodeReference[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readResearchQueue(): ResearchItem[] {
  const store = storage();
  if (!store) return [];
  try {
    return JSON.parse(store.getItem(RESEARCH_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeResearchQueue(items: ResearchItem[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RESEARCH_QUEUE_KEY, JSON.stringify(items.slice(-60)));
  } catch (err) {
    console.warn("[researchEngine] could not persist research queue:", err);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Research planner                                                 */
/* ------------------------------------------------------------------ */

export function planResearch(concept: string): ResearchPlan {
  return {
    concept,
    questions: [
      `What is the canonical signal-flow / algorithm for "${concept}"?`,
      `What are the design parameters an engineer exposes, and their musical ranges?`,
      `What are the stability constraints and classic implementation pitfalls?`,
      `Can the current engine (mono, per-sample JS) implement it — and if not, what is the prerequisite?`,
    ],
    sources: [
      "built-in corpus (academic texts, cookbook specs, curated community archives — cited per claim)",
      "local LLM proposal (authority 20; only when a local model is configured and reachable)",
      "live web (opt-in; a curated allowlist of authoritative references, extracted verbatim and cited — data only, never buildable)",
      "OpenAudio index (opt-in; links to matching open-source implementations for code examples — reference only, never ingested or built)",
    ],
    acceptance: [
      "every claim carries a citation with an authority score",
      "a proposed module must pass the quality gate at >= 97 with zero defects",
      "structural conflicts must be declared, not worked around",
      "nothing lands in factory knowledge without explicit human approval",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 2-3. Gather + extract                                               */
/* ------------------------------------------------------------------ */

interface Gathered {
  entries: CorpusEntry[];
  modelClaims: ResearchClaim[];
}

async function gatherFromModel(concept: string, llmConfig: LLMConfig | null): Promise<ResearchClaim[]> {
  if (!llmConfig || !isLocalProvider(llmConfig)) return [];
  try {
    const parsed = await callLocalLLM({
      config: llmConfig,
      systemPrompt:
        'You are a DSP research assistant. Reply with JSON: {"claims": ["..."]} — 1-3 short factual statements about the requested audio DSP concept (algorithm structure, parameters, stability constraints). No code.',
      userText: `Concept: ${concept}`,
      temperature: 0.2,
    });
    const claims: string[] = Array.isArray(parsed?.claims) ? parsed.claims : [];
    return claims.slice(0, 3).map((text) => ({
      text: String(text).slice(0, 400),
      citation: { title: `Local model note (${llmConfig.provider})`, source: "model-generated — verify before trusting", authority: 20 },
    }));
  } catch {
    return []; // model enrichment is best-effort by contract
  }
}

/**
 * The app's production WebFetcher: fetches a curated URL through this app's
 * own /api/proxy relay (server-side fetch, so no browser CORS wall), and
 * returns the page text. Used only by the opt-in Research Lab toggle.
 */
export function createProxyWebFetcher(): WebFetcher {
  return async (url: string): Promise<string | null> => {
    try {
      const res = await fetchLLMRoute(url, { method: "GET" });
      if (!res.ok) return null;
      const text = await res.text();
      return text && text.length > 0 ? text.slice(0, 200000) : null;
    } catch {
      return null;
    }
  };
}

/**
 * OPT-IN live web gatherer: fetch the curated authoritative pages for this
 * concept and extract cited passages. Everything returned is DATA for the
 * human to review — verbatim sentences from a known source, tagged with that
 * source's authority tier. It can never build anything or un-block anything;
 * fetched text is never interpreted as instructions. Best-effort: a failed or
 * empty fetch just contributes nothing.
 */
export async function gatherFromWeb(concept: string, fetcher: WebFetcher | null | undefined): Promise<ResearchClaim[]> {
  if (!fetcher) return [];
  const sources = webSourcesFor(concept);
  const claims: ResearchClaim[] = [];
  for (const src of sources) {
    try {
      const raw = await fetcher(src.url);
      if (!raw) continue;
      for (const passage of extractRelevantPassages(raw, src.keywords, 2)) {
        claims.push({
          text: passage,
          citation: { title: src.title, source: `${src.source} (live web)`, url: src.url, authority: src.authority },
        });
      }
    } catch {
      // one bad fetch never fails the run
    }
  }
  return claims;
}

/**
 * EPHEMERAL per-build live context. Unlike runResearch() this NEVER queues
 * anything for human approval and NEVER runs the quality gate -- it exists
 * purely to hand the model 1-2 extra cited sentences of real external
 * reference for THIS one generation, reusing gatherFromWeb/WEB_SOURCES/
 * extractRelevantPassages unchanged. That permanent-curriculum pipeline
 * (runResearch -> pending queue -> human approval) is a deliberately
 * different, heavier job -- growing the factory's permanent knowledge with
 * oversight. This is the opposite: throwaway, best-effort, per-build only.
 *
 * Best-effort and fail-silent: any failure, timeout, or no-match returns ""
 * -- a network hiccup, an unresolved concept, or a dead link must never
 * block or degrade a build. Returns a plain string ready to append directly
 * to a prompt (matching buildRecipeContext's own return contract), ending
 * with a fixed instruction so the model treats the reference as background,
 * never as a specification to copy verbatim or brand the plugin after.
 */
export async function gatherLiveBuildContext(
  prompt: string,
  fetcher: WebFetcher | null | undefined
): Promise<string> {
  if (!fetcher) return "";
  try {
    const concept = resolveWebSourceConcept(prompt);
    if (!concept) return "";
    const claims = await gatherFromWeb(concept, fetcher);
    if (claims.length === 0) return "";
    const lines = claims.map(
      (c) => `Reference (live web -- ${c.citation.title}, ${c.citation.source}): "${c.text}"`
    );
    return [
      ...lines,
      "[The above is background technical context from a live external source. Extract the underlying design principle only -- it is not a specification to copy verbatim, and the plugin must never be named or branded after a specific commercial product.]",
    ].join("\n");
  } catch {
    return "";
  }
}

/**
 * OPT-IN: fetch the OpenAudio index and surface the open-source projects most
 * relevant to this concept as CODE-EXAMPLE LINKS. This is "the source and its
 * sources": OpenAudio is the curated index, the repos it lists are its
 * sources. We point at that code for the human to study — we never fetch,
 * ingest, or ship it (copyright + the data-only safety contract). Best-effort:
 * a failed fetch just contributes no references.
 */
async function gatherFromIndex(concept: string, fetcher: WebFetcher | null | undefined): Promise<CodeReference[]> {
  if (!fetcher) return [];
  try {
    const raw = await fetcher(OPENAUDIO_INDEX.url);
    if (!raw) return [];
    const entries = matchIndexEntries(parseOpenAudioIndex(raw), searchTermsFor(concept), 5);
    return entries.map((e) => ({
      name: e.name,
      url: e.url,
      description: e.description,
      source: OPENAUDIO_INDEX.source,
      authority: OPENAUDIO_INDEX.authority,
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 4. Conflict detection                                               */
/* ------------------------------------------------------------------ */

function detectConflicts(concept: string, entries: CorpusEntry[], topAuthority: number): ResearchConflict[] {
  const conflicts: ResearchConflict[] = [];
  for (const e of entries) {
    if (e.blocked) {
      conflicts.push({ severity: "blocking", text: e.blocked });
    }
  }
  const covered = new Set(knownConcepts());
  if (covered.has(concept)) {
    conflicts.push({
      severity: "info",
      text: `The banks already hold tier-1 verified modules reaching "${concept}" — approving adds an alternative, it does not replace the verified default.`,
    });
  }
  if (topAuthority < 60) {
    conflicts.push({
      severity: "warning",
      text: `Best available authority is ${topAuthority}/100 (community/model grade). Prefer confirming against a book or academic source before approving.`,
    });
  }
  return conflicts;
}

/* ------------------------------------------------------------------ */
/* 5. Empirical verification                                           */
/* ------------------------------------------------------------------ */

function verifyModule(family: PluginFamily, title: string, parameters: DspRecipe["parameters"], body: string): ModuleVerification {
  const plugin: AudioPlugin = {
    id: "research", name: title, category: familyToCategory(family), description: "",
    parameters: parameters.map((p) => ({ ...p, value: p.defaultValue })),
    dspFunction: body, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  try {
    const g = runQualityGate(plugin, { family, prompt: title });
    const minScore = Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);
    const defects = [
      ...g.report.deadParams.map((p) => `dead control: ${p}`),
      ...g.report.unstableParams.map((p) => `unstable control: ${p}`),
      ...(g.report.semanticViolations || []).map((v) => `dishonest control: ${v}`),
      ...(g.report.harsh ? [`aliasing harshness ${g.report.aliasingIndex?.toFixed(3)}`] : []),
    ];
    return { minScore, scores: g.scores, passes: minScore >= 97 && defects.length === 0, defects };
  } catch (err: any) {
    return {
      minScore: 0,
      scores: { looks: 0, performance: 0, latency: 0, musicality: 0 },
      passes: false,
      defects: [`module threw during gating: ${err?.message || err}`],
    };
  }
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

/**
 * Research one concept end-to-end and queue the result for human approval.
 * Returns the queued (or already-pending) item. Deterministic without any
 * sources; `sources.llmConfig` adds optional low-authority model notes and
 * `sources.webFetcher` runs the opt-in live web gatherer. Backward-compatible:
 * a bare LLMConfig (or nothing) still works as the second argument.
 */
export async function runResearch(
  concept: string,
  sources: ResearchSources | LLMConfig | null = null
): Promise<ResearchItem> {
  // Accept a bare LLMConfig for backward compatibility with earlier callers.
  const resolved: ResearchSources =
    sources && "provider" in (sources as LLMConfig) ? { llmConfig: sources as LLMConfig } : ((sources as ResearchSources) ?? {});

  // Dedup on the RESOLVED corpus concept (e.g. "parallel-compression"), not
  // the raw caller string (e.g. "parallel compression") -- that's also what
  // gets stored on the queued item a few lines down (`primary?.concept ??
  // concept`), so matching on anything else means the exact same request,
  // reworded with different spacing/hyphenation, silently queues a second
  // duplicate instead of returning the pending one. This previously went
  // unnoticed because every prompt this pipeline had been exercised with
  // happened to already equal its own corpus's canonical concept string
  // (raw input === resolved concept is not something callers should have to
  // guarantee).
  const resolvedConcept = corpusEntriesFor(concept)[0]?.concept ?? concept;
  const existing = readResearchQueue().find((i) => i.concept === resolvedConcept && i.status === "pending");
  if (existing) return existing;

  const [modelClaims, webClaims, references] = await Promise.all([
    gatherFromModel(concept, resolved.llmConfig ?? null),
    gatherFromWeb(concept, resolved.webFetcher),
    gatherFromIndex(concept, resolved.webFetcher),
  ]);
  const gathered: Gathered = { entries: corpusEntriesFor(concept), modelClaims };

  // Extraction: merge every source's claims, ranked by citation authority so
  // literature and authoritative web sources sort above low-tier model notes.
  const claims: ResearchClaim[] = [
    ...gathered.entries.flatMap((e) => e.claims),
    ...webClaims,
    ...gathered.modelClaims,
  ].sort((a, b) => b.citation.authority - a.citation.authority);
  const topAuthority = claims.length > 0 ? claims[0].citation.authority : 0;

  const primary = gathered.entries[0];
  const conflicts = detectConflicts(primary?.concept ?? concept, gathered.entries, topAuthority);
  if (claims.length === 0) {
    conflicts.push({
      severity: "blocking",
      text: "No findings: the corpus has no entry for this concept and no local model contributed. Add corpus material or configure a local model, then research again.",
    });
  }

  const blocked = conflicts.some((c) => c.severity === "blocking");
  let proposedModule: ResearchItem["proposedModule"];
  if (primary?.proposedModule && !blocked) {
    const m = primary.proposedModule;
    proposedModule = { ...m, verification: verifyModule(m.family, m.title, m.parameters, m.body) };
  }

  const item: ResearchItem = {
    id: `research_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    concept: primary?.concept ?? concept,
    area: primary?.area ?? "General",
    claims,
    topAuthority,
    conflicts,
    proposedModule,
    // Reference links attach regardless of block/approval status — they never
    // change what can be built or approved, they only give the human real
    // implementations to study.
    references: references.length > 0 ? references : undefined,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  writeResearchQueue([...readResearchQueue(), item]);
  return item;
}

/** True when the item may be approved: no blocking conflicts, and any
 *  proposed module must have PASSED the gate. Claims-only items (no module)
 *  are approvable — they extend concept coverage without becoming buildable. */
export function isApprovable(item: ResearchItem): boolean {
  if (item.conflicts.some((c) => c.severity === "blocking")) return false;
  if (item.proposedModule && !item.proposedModule.verification.passes) return false;
  return item.claims.length > 0;
}

function decide(id: string, status: "approved" | "rejected"): ResearchItem | null {
  const queue = readResearchQueue();
  const item = queue.find((i) => i.id === id);
  if (!item || item.status !== "pending") return null;
  if (status === "approved" && !isApprovable(item)) return null;
  item.status = status;
  item.decidedAt = new Date().toISOString();
  writeResearchQueue(queue);
  return item;
}

export function approveResearch(id: string): ResearchItem | null {
  return decide(id, "approved");
}

export function rejectResearch(id: string): ResearchItem | null {
  return decide(id, "rejected");
}

/* ------------------------------------------------------------------ */
/* Consumers of APPROVED knowledge                                     */
/* ------------------------------------------------------------------ */

/** Approved research items that carry a gate-verified buildable module. */
export function approvedModules(): ResearchItem[] {
  return readResearchQueue().filter((i) => i.status === "approved" && i.proposedModule?.verification.passes);
}

/**
 * The build hook: an approved researched module whose concept wording
 * matches the prompt. The corpus match regex travels with the concept so
 * "a swirling phaser" finds the approved phaser.
 */
export function findApprovedModuleForPrompt(prompt: string): ResearchItem | null {
  for (const item of approvedModules()) {
    const entry = RESEARCH_CORPUS.find((e) => e.concept === item.concept);
    if (entry && entry.match.test(prompt)) return item;
  }
  return null;
}
