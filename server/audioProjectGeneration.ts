import {
  AUDIO_SOFTWARE_PROJECT_VERSION,
  compileAudioSoftwareProject,
  normalizeAudioSoftwareProjectCandidate,
  validateAudioSoftwareProject,
  type AudioSoftwareProject,
  type ClassificationEvidence,
  type CompilationResult,
  type LegacyPlugin,
} from "../src/audioProjects";
import { isAllowedModel, isManagedProvider, type ChatMessage, type ManagedProvider } from "./llmProviders";

const MAX_PROMPT_CHARS = 16_000;
const MAX_DSP_CHARS = 200_000;
const MAX_PARAMETERS = 64;

export interface AudioProjectGenerationRequest {
  prompt: string;
  provider?: ManagedProvider;
  model?: string;
  /** Optional real plugin contract to adapt into an effect project. */
  legacyPlugin?: LegacyPlugin;
}

/**
 * Sanitizes a client-supplied legacy plugin payload down to the exact fields
 * the effect compiler needs. Untrusted input: id/name/parameter ids/DSP source
 * are length-bounded and structurally validated. Returns undefined (never
 * throws) when the payload is not a usable plugin, so a malformed adaptation
 * request degrades to a normal native-model project rather than failing the
 * whole generation.
 */
export function sanitizeLegacyPlugin(value: unknown): LegacyPlugin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === "string" ? v.id.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const dspFunction = typeof v.dspFunction === "string" ? v.dspFunction : "";
  if (!id || !name || !dspFunction) return undefined;
  if (id.length > 200 || name.length > 200) return undefined;
  if (dspFunction.length > MAX_DSP_CHARS) return undefined;
  if (!Array.isArray(v.parameters)) return undefined;
  if (v.parameters.length > MAX_PARAMETERS) return undefined;
  const parameters: LegacyPlugin["parameters"] = [];
  const seen = new Set<string>();
  for (const raw of v.parameters as unknown[]) {
    if (!raw || typeof raw !== "object") return undefined;
    const p = raw as Record<string, unknown>;
    const pid = typeof p.id === "string" ? p.id.trim() : "";
    const pname = typeof p.name === "string" ? p.name.trim() : pid;
    if (!pid || pid.length > 120 || seen.has(pid)) return undefined;
    seen.add(pid);
    const min = Number(p.min);
    const max = Number(p.max);
    const defaultValue = Number(p.defaultValue ?? p.value ?? min);
    if (![min, max, defaultValue].every(Number.isFinite)) return undefined;
    // Preserve the shape AudioPlugin parameters carry; the compiler only reads
    // id/name/min/max/defaultValue.
    parameters.push({ ...(raw as object), id: pid, name: pname, min, max, defaultValue } as LegacyPlugin["parameters"][number]);
  }
  if (parameters.length === 0) return undefined;
  return { id, name, parameters, dspFunction };
}

export interface AudioProjectGenerationEnvelope {
  contractVersion: typeof AUDIO_SOFTWARE_PROJECT_VERSION;
  source: "deterministic" | "provider" | "deterministic-fallback";
  project: AudioSoftwareProject;
  classification: ClassificationEvidence;
  validation: { valid: boolean; issues: string[] };
  evidence: AudioSoftwareProject["brief"]["evidence"];
  limitations: string[];
  repairHistory: string[];
}

export function validateAudioProjectGenerationBody(body: unknown): AudioProjectGenerationRequest {
  if (!body || typeof body !== "object") throw new Error("Audio project generation body is required.");
  const value = body as Record<string, unknown>;
  if (typeof value.prompt !== "string" || !value.prompt.trim()) throw new Error("Audio software project prompt is required.");
  if (value.prompt.length > MAX_PROMPT_CHARS) throw new Error(`Audio software project prompt exceeds ${MAX_PROMPT_CHARS} characters.`);
  const legacyPlugin = sanitizeLegacyPlugin(value.legacyPlugin);
  if (value.provider === undefined && value.model === undefined) {
    return legacyPlugin ? { prompt: value.prompt.trim(), legacyPlugin } : { prompt: value.prompt.trim() };
  }
  if (!isManagedProvider(value.provider) || !isAllowedModel(value.provider, value.model)) throw new Error("Unsupported managed provider or model.");
  return { prompt: value.prompt.trim(), provider: value.provider, model: value.model as string, ...(legacyPlugin ? { legacyPlugin } : {}) };
}

export function audioProjectProviderMessages(prompt: string, compilation: CompilationResult): ChatMessage[] {
  return [
    {
      role: "system",
      content: `You refine audio-software project contracts. Return exactly one JSON object with a top-level "project" property.
The project must preserve contract version ${AUDIO_SOFTWARE_PROJECT_VERSION}, project.kind "${compilation.project.kind}", every stable cross-reference, truthful target support, runnable browser source, limitations, evidence, repairHistory, the plain-language brief.goal, and the brief.summary capability read-out.
Never claim VST3 support for sequencer, mixer, sampler, utility, or DAW projects. Keep preview.fidelity truthful (processor-audition only for effect, mastering, and instrument; browser-workstation for DAW; focused-simulation otherwise). Never claim a compiled or native binary that does not exist. Never replace a category-specific architecture with a generic plugin.`,
    },
    {
      role: "user",
      content: `Refine this deterministic project for the request "${prompt}". Preserve working fields unless the request requires a concrete improvement.\n${JSON.stringify({ project: compilation.project })}`,
    },
  ];
}

function fallbackProject(compilation: CompilationResult, reason: string, limitations: string[]): AudioSoftwareProject {
  return {
    ...compilation.project,
    limitations: [...compilation.project.limitations, ...limitations],
    repairHistory: [...compilation.project.repairHistory, reason],
  } as AudioSoftwareProject;
}

export function finalizeAudioProjectGeneration(
  compilation: CompilationResult,
  providerCandidate?: unknown,
  providerFailure?: string,
): AudioProjectGenerationEnvelope {
  let project = compilation.project;
  let source: AudioProjectGenerationEnvelope["source"] = "deterministic";
  if (providerFailure) {
    source = "deterministic-fallback";
    project = fallbackProject(compilation, `Provider generation failed; deterministic compiler retained: ${providerFailure}`, ["Provider refinement was unavailable."]);
  } else if (providerCandidate !== undefined) {
    const candidate = providerCandidate && typeof providerCandidate === "object" && "project" in providerCandidate
      ? (providerCandidate as Record<string, unknown>).project
      : providerCandidate;
    const normalized = normalizeAudioSoftwareProjectCandidate(candidate);
    if (normalized.project && normalized.project.kind === compilation.project.kind) {
      project = normalized.project;
      source = "provider";
    } else {
      const issues = normalized.project
        ? [`Provider changed classified kind from ${compilation.project.kind} to ${normalized.project.kind}`]
        : normalized.validation.issues;
      project = fallbackProject(compilation, `Provider candidate rejected; deterministic compiler retained: ${issues.join("; ")}`, normalized.limitations);
      source = "deterministic-fallback";
    }
  }
  const validation = validateAudioSoftwareProject(project);
  return {
    contractVersion: AUDIO_SOFTWARE_PROJECT_VERSION,
    source,
    project,
    classification: compilation.classification,
    validation,
    evidence: project.brief.evidence,
    limitations: project.limitations,
    repairHistory: project.repairHistory,
  };
}

export function compileDeterministicAudioProject(prompt: string, legacyPlugin?: LegacyPlugin): AudioProjectGenerationEnvelope {
  return finalizeAudioProjectGeneration(compileAudioSoftwareProject(prompt, legacyPlugin));
}