import type { AudioPlugin } from "../types";

/** This contract is intentionally renderer-neutral and safe to persist as JSON. */
export const AUDIO_SOFTWARE_PROJECT_VERSION = "1.1" as const;
/** Prior shipped contract versions that normalization can migrate forward. */
export const AUDIO_SOFTWARE_PROJECT_SUPPORTED_VERSIONS = [1, "1.0", "1.1"] as const;
export type AudioProjectKind = "effect" | "instrument" | "sampler" | "sequencer" | "mixer" | "mastering" | "utility" | "daw";
export type EvidenceGrade = "measured" | "static" | "conceptual";
export type UiRole = "primary" | "performance" | "routing" | "meter" | "transport" | "asset";
export type AudioProjectTarget = "browser" | "vst3";
export type PreviewModel = "audio-processor" | "polyphonic-instrument" | "sample-pad-bank" | "step-sequencer" | "multi-bus-mixer" | "mastering-chain" | "meter" | "browser-workstation";

/**
 * How a project's preview truthfully behaves. Never implies compiled/native
 * output. "processor-audition" = a real DSP model you can hear on a signal;
 * "browser-workstation" = the in-browser multitrack Studio; "focused-simulation"
 * = a runnable model that demonstrates the workflow without live audio.
 */
export type PreviewFidelity = "processor-audition" | "browser-workstation" | "focused-simulation";
/** Beginner shows plain-language summaries; pro exposes the full brief. */
export type BriefDetail = "beginner" | "pro";

export interface ProjectControl {
  id: string;
  label: string;
  role: UiRole;
  min?: number;
  max?: number;
  defaultValue?: number;
}
export interface ProjectNode { id: string; type: string; label: string; }
export interface ProjectRoute { id: string; from: string; to: string; gain: number; }
export interface QualityEvidence { grade: EvidenceGrade; check: string; detail: string; pass: boolean; }
export interface TargetLimit {
  target: AudioProjectTarget;
  supported: boolean;
  stage: "emitted" | "exportable" | "unsupported";
  limitation?: string;
}
export interface ProjectCodeAsset {
  id: string;
  language: "typescript" | "javascript";
  filename: string;
  source: string;
}

/**
 * The honest read-out the intake surfaces after a build. Every field is
 * plain-language and safe to show a beginner; the pro brief adds the raw
 * contract underneath. "understood" = what the request was read as;
 * "changed" = anything the compiler adjusted or defaulted; "proven" =
 * measured/static evidence that actually ran; "conceptual" = claims that were
 * reasoned about but not measured; "unsupported" = capabilities explicitly not
 * delivered (e.g. native export for a workflow project).
 */
export interface CapabilitySummary {
  understood: string[];
  changed: string[];
  proven: string[];
  conceptual: string[];
  unsupported: string[];
}

/**
 * A brief decision is an outcome-focused question that is always shown for a
 * given kind (unlike classification ambiguity which only surfaces when the
 * classifier is uncertain). Answering one updates the brief in-place without
 * restarting the build or discarding validated evidence.
 */
export interface BriefDecision {
  id: string;
  /** Beginner-friendly question the requester is asked to answer. */
  question: string;
  /** Available answers, each a short plain-language option. */
  options: string[];
  /** Currently selected answer (first option by default). */
  selected: string;
}

export interface AudioProjectBrief {
  purpose: string;
  /** Plain-language goal in the requester's words (survives category revisions). */
  goal: string;
  /** Who is going to use this, in plain language — e.g. "a mixing engineer". */
  audiences: string[];
  /** The workflows or creative contexts it supports — e.g. "vocal production". */
  workflows: string[];
  /** Human-readable description of the interface — e.g. "Two input channels…". */
  interfaceDescription: string;
  /** Semantic role of each control id — the same data as uiRoles, explicitly named. */
  interfaceRoles: Record<string, UiRole>;
  /** Platform targets in plain language — e.g. "Browser (ready now)", "VST3 (scaffold)". */
  platformTargets: string[];
  /** What must hold for this project to be considered correct — plain-language checks. */
  validationRequirements: string[];
  /** Per-kind outcome-focused decisions the requester can answer without restarting. */
  decisions: BriefDecision[];
  controls: ProjectControl[];
  /** @deprecated Use interfaceRoles. Kept for round-trip compatibility. */
  uiRoles: Record<string, UiRole>;
  graph: { nodes: ProjectNode[]; routes: ProjectRoute[] };
  targets: TargetLimit[];
  evidence: QualityEvidence[];
  summary: CapabilitySummary;
}
export interface ProjectBase<K extends AudioProjectKind> {
  version: typeof AUDIO_SOFTWARE_PROJECT_VERSION;
  id: string;
  kind: K;
  name: string;
  brief: AudioProjectBrief;
  preview: { runtime: "browser"; model: PreviewModel; fidelity: PreviewFidelity; entryAssetId: string; entryExport: "createModel" };
  codeAssets: ProjectCodeAsset[];
  native?: { dspAssetId: string; family: "dynamics" | "synthesizer" | "sampler" | "utility"; category: "dynamics" | "synthesizer" | "filter" };
  limitations: string[];
  repairHistory: string[];
}
export interface EffectProject extends ProjectBase<"effect"> {
  processor: { mode: "native-model" | "adapted-plugin"; pluginId?: string; parameters: string[]; dspAssetId: string };
}
export interface InstrumentProject extends ProjectBase<"instrument"> {
  midi: { input: "midi-note"; output: "audio"; voices: number; noteRange: [number, number] };
}
export interface SamplerProject extends ProjectBase<"sampler"> {
  pads: Array<{ id: string; midiNote: number; assetId: string; chokeGroup?: string }>;
  assets: Array<{ id: string; name: string; distinctFingerprint: string }>;
}
export interface SequencerProject extends ProjectBase<"sequencer"> {
  sequence: { bpm: number; stepsPerBar: number; events: Array<{ id: string; step: number; note: number; velocity: number; durationSteps: number }>; persistenceKey: string };
}
export interface MixerProject extends ProjectBase<"mixer"> {
  mixer: { channels: Array<{ id: string; gain: number; busId: string }>; buses: Array<{ id: string; gain: number }> };
}
export interface MasteringProject extends ProjectBase<"mastering"> {
  chain: Array<{ id: string; type: "eq" | "compressor" | "limiter"; enabled: boolean }>;
}
export interface UtilityProject extends ProjectBase<"utility"> {
  analyzer: { type: "meter"; sourceNodeId: string; ballisticsMs: number; peakHoldMs: number };
}
export interface DawProject extends ProjectBase<"daw"> {
  workstation: { tracks: number; buses: Array<{ id: string; kind: "audio" | "return" | "master" }>; transportBpm: number };
}
export type AudioSoftwareProject = EffectProject | InstrumentProject | SamplerProject | SequencerProject | MixerProject | MasteringProject | UtilityProject | DawProject;

/**
 * A contextual clarifying question raised when intent is ambiguous at
 * classification time. Options are candidate kinds (one-tap category
 * confirmation). Distinct from BriefDecision which is per-kind and always shown.
 */
export interface IntakeQuestion {
  id: string;
  prompt: string;
  /** Candidate categories, most-likely first, for one-tap confirmation. */
  options: Array<{ kind: AudioProjectKind; label: string }>;
}

export interface ClassificationEvidence {
  kind: AudioProjectKind;
  confidence: number;
  matched: string[];
  rejected: string[];
  rationale: string;
  /** True when more than one category competed closely for the top slot. */
  ambiguous: boolean;
  /** Ordered runners-up (kind + score) the requester can switch to. */
  alternatives: Array<{ kind: AudioProjectKind; score: number }>;
  /** Non-empty only when a short guided confirmation is warranted. */
  questions: IntakeQuestion[];
}

/**
 * A category/decision revision. The requester can change the classified kind
 * (or any brief decision) without discarding evidence that already ran and
 * passed on the browser model.
 */
export interface ProjectRevision {
  fromKind: AudioProjectKind;
  toKind: AudioProjectKind;
  reason: string;
  /** Evidence that was measured/static and still holds after the revision. */
  preservedEvidence: QualityEvidence[];
}
export interface CompilationResult {
  project: AudioSoftwareProject;
  classification: ClassificationEvidence;
  adaptedLegacyPlugin: boolean;
}
export type LegacyPlugin = Pick<AudioPlugin, "id" | "name" | "parameters" | "dspFunction">;