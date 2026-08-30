import React, { useMemo, useState } from "react";
import {
  AudioLines, CheckCircle, ChevronDown, ChevronUp, Code2, Download, Info,
  ListChecks, Package, PencilLine, Play, ShieldCheck, SlidersHorizontal, XCircle,
  Users, GitBranch, Square,
} from "lucide-react";
import type {
  AudioSoftwareProject, ClassificationEvidence, AudioProjectKind, PreviewFidelity,
  BriefDecision,
} from "../audioProjects";
import {
  createTrustedPreviewModel,
  findPendingFixtureCheck,
  processTrustedPreviewSample,
  runTrustedFocusedSimulation,
} from "../audioProjects";

interface AudioProjectCardProps {
  project: AudioSoftwareProject | null;
  classification?: ClassificationEvidence | null;
  loading?: boolean;
  error?: string | null;
  onNativeExport?: (project: AudioSoftwareProject) => Promise<string>;
  /** Change the classified category; App keeps validated evidence. */
  onReviseKind?: (kind: AudioProjectKind) => void;
  /** Open the browser workstation (only offered for a DAW project). */
  onOpenWorkstation?: () => void;
  /**
   * Update a single brief decision's selected answer in-place without
   * discarding project id or validated evidence. Receives the decision id
   * and the new selected value.
   */
  onUpdateDecision?: (decisionId: string, selected: string) => void;
  /**
   * For an adapted-plugin effect project (processor.mode === "adapted-plugin"),
   * prefer using the existing loaded-plugin audition so the faceplate DSP is
   * heard rather than the generic browser model. App/SimpleStudio provides
   * this; it toggles play/stop on the real Web Audio graph.
   */
  onRunPluginAudition?: () => Promise<PluginAuditionOutcome>;
  /** ID of the plugin currently loaded in the faceplate/audio engine. */
  activePluginId?: string;
  /** True when the loaded-plugin audition is currently playing. */
  pluginAuditionPlaying?: boolean;
  /**
   * Fired when a preview execution genuinely succeeds so the host can promote
   * the pending golden-fixture evidence to "measured". Called ONLY on:
   *  - a processor AudioContext audition that runs to completion,
   *  - a focused simulation that resolves successfully,
   *  - an identity-matched adapted-plugin audition that starts successfully.
   * Never called on error, when audition is unavailable, when the user stops
   * before completion, or when the project id does not match. Carries the
   * project id (host verifies it matches the live project), the pending fixture
   * evidence check, and a factual measured detail describing what ran.
   */
  onPreviewMeasured?: (projectId: string, evidenceCheck: string, measuredDetail: string) => void;
}

const KIND_LABEL: Record<AudioProjectKind, string> = {
  effect: "Effect", instrument: "Instrument", sampler: "Sampler", sequencer: "Sequencer",
  mixer: "Mixer", mastering: "Mastering", utility: "Utility", daw: "DAW workstation",
};

const FIDELITY_COPY: Record<PreviewFidelity, { label: string; detail: string }> = {
  "processor-audition": { label: "Processor audition", detail: "Hear it on a real audio signal through the browser AudioContext." },
  "browser-workstation": { label: "Browser workstation", detail: "Opens as a multitrack arrangement, not one plugin." },
  "focused-simulation": { label: "Focused simulation", detail: "Runs the workflow model in the browser; no live audio output." },
};

const ALL_KINDS: AudioProjectKind[] = [
  "effect", "instrument", "sampler", "sequencer", "mixer", "mastering", "utility", "daw",
];

/** Kinds whose preview model is a real DSP processor that can produce audible audio. */
const AUDITION_KINDS = new Set<AudioProjectKind>(["effect", "instrument", "mastering"]);

/**
 * The three mutually-exclusive audition strategies for a project card:
 *  - "plugin-delegate": an adapted-effect project whose audition MUST be played
 *    through the loaded plugin faceplate DSP (never generic audio).
 *  - "processor-audition": a non-adapted processor kind (instrument/mastering,
 *    or an effect with no legacy plugin) that runs the browser DSP model.
 *  - "plugin-unavailable": an adapted-effect project whose loaded plugin is
 *    missing, so audition is disabled — we never fake it with generic audio.
 *  - "focused-simulation": a workflow kind with no live audio.
 */
export type AuditionMode =
  | "plugin-delegate"
  | "processor-audition"
  | "plugin-unavailable"
  | "focused-simulation";

export type PluginAuditionOutcome = "started" | "stopped" | "failed";

/** Only a verified engine start is evidence that the adapted plugin executed. */
export function shouldPromotePluginAudition(outcome: PluginAuditionOutcome): boolean {
  return outcome === "started";
}

/**
 * Decides how a project's audition button behaves. Pure and testable without a
 * DOM. `hasPluginCallback` is true when the host (App/SimpleStudio) has a loaded
 * plugin whose faceplate DSP can be played back for this exact project.
 */
export function resolveAuditionMode(
  project: Pick<AudioSoftwareProject, "kind"> & { processor?: { mode?: string; pluginId?: string } },
  activePluginId: string | undefined,
  hasPluginCallback: boolean,
): AuditionMode {
  const isAdaptedEffect =
    project.kind === "effect" && project.processor?.mode === "adapted-plugin";
  if (isAdaptedEffect) {
    // An adapted effect must be heard through the exact plugin it references,
    // or not at all. A callback for some other loaded plugin is not sufficient.
    return hasPluginCallback
      && !!project.processor?.pluginId
      && activePluginId === project.processor.pluginId
      ? "plugin-delegate"
      : "plugin-unavailable";
  }
  if (AUDITION_KINDS.has(project.kind)) return "processor-audition";
  return "focused-simulation";
}

function downloadProject(project: AudioSoftwareProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.name.replace(/[^a-zA-Z0-9]+/g, "_") || "audio-project"}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Plays a bounded audition of the project's browser model through a real
 * AudioContext so the user can hear the effect or instrument.
 *
 * - For effect/mastering: creates a 220 Hz sine oscillator, routes it through
 *   the model's process() function sample-by-sample in a ScriptProcessor, and
 *   plays for 2 seconds then stops and closes the context.
 * - For instrument: synthesises a short 3-note arpeggio (C4, E4, G4) through
 *   the polyphonic model.
 *
 * Returns a cleanup function (call to stop early) and a Promise that resolves
 * to a status string or rejects on error.
 *
 * NOTE: ScriptProcessor is deprecated but universally supported in browsers
 * without AudioWorklet setup overhead; an AudioWorklet would require a
 * separate bundled module URL. For a bounded 2 s audition this is acceptable.
 */
async function runProcessorAudition(
  project: AudioSoftwareProject,
): Promise<{ stop: () => void; done: Promise<string> }> {
  const ctx = new AudioContext();
  const sampleRate = ctx.sampleRate;
  const model = createTrustedPreviewModel(project, sampleRate);

  if (!model || typeof model !== "object") throw new Error("createModel() did not return a model object.");
  if (project.kind === "instrument") {
    if (typeof model.noteOn !== "function" || typeof model.processFrame !== "function") {
      throw new Error("Instrument model is missing noteOn() or processFrame().");
    }
  } else if (typeof model.process !== "function") {
    throw new Error("Processor model is missing process().");
  }

  // We use bufferSize 4096 — large enough to avoid glitches, bounded duration.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.6;

  let phase = 0; // oscillator phase [0, 2π)
  const freq = 220; // 220 Hz — audible reference tone
  let noteTriggered = false;
  let runtimeFailure: Error | null = null;

  scriptNode.onaudioprocess = (ev: AudioProcessingEvent) => {
    const output = ev.outputBuffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) {
      // Generate a sine-wave input sample.
      const sine = Math.sin(phase) * 0.4;
      phase += (2 * Math.PI * freq) / sampleRate;
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

      let out = 0;
      try {
        if (project.kind === "instrument") {
          if (!noteTriggered) {
            (model.noteOn as (note: number) => void)(60);
            (model.noteOn as (note: number) => void)(64);
            (model.noteOn as (note: number) => void)(67);
            noteTriggered = true;
          }
          out = processTrustedPreviewSample(project, model, 0.5);
        } else {
          out = processTrustedPreviewSample(project, model, sine);
        }
      } catch (cause) {
        runtimeFailure = cause instanceof Error ? cause : new Error(String(cause));
        out = 0;
      }
      output[i] = out;
    }
  };

  scriptNode.connect(gainNode);
  gainNode.connect(ctx.destination);

  const AUDITION_DURATION_MS = 2000;
  let stopped = false;

  const done = new Promise<string>((resolve, reject) => {
    setTimeout(async () => {
      if (!stopped) {
        scriptNode.disconnect();
        gainNode.disconnect();
        await ctx.close().catch(() => undefined);
        stopped = true;
        if (runtimeFailure) reject(runtimeFailure);
        else resolve("Audition complete (2 s).");
      }
    }, AUDITION_DURATION_MS);
  });

  const stop = () => {
    if (!stopped) {
      stopped = true;
      scriptNode.disconnect();
      gainNode.disconnect();
      ctx.close().catch(() => undefined);
    }
  };

  return { stop, done };
}

/**
 * For focused-simulation kinds (sampler, sequencer, mixer, utility, daw):
 * run the JS model and return a descriptive string. No audio is produced.
 */
async function runFocusedSimulation(project: AudioSoftwareProject): Promise<string> {
  return runTrustedFocusedSimulation(project);
}

function SummaryGroup({ title, items, tone, testid, icon }: {
  title: string; items: string[]; tone: "neutral" | "amber" | "emerald" | "sky" | "rose"; testid: string;
  icon: React.ReactNode;
}) {
  if (items.length === 0) return null;
  const toneClass = {
    neutral: "text-neutral-300", amber: "text-amber-300", emerald: "text-emerald-300",
    sky: "text-sky-300", rose: "text-rose-300",
  }[tone];
  return (
    <div data-testid={testid}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${toneClass} mb-1`}>
        {icon}<span>{title}</span>
      </div>
      <ul className="space-y-1 text-[11px] text-neutral-400">
        {items.map((item, i) => <li key={`${testid}-${i}`} className="leading-snug">{item}</li>)}
      </ul>
    </div>
  );
}

/**
 * Renders per-kind outcome-focused decisions as selectable answer chips.
 * Answering one calls onUpdateDecision; the project id and evidence are kept.
 */
function DecisionsPanel({ decisions, onUpdateDecision }: {
  decisions: BriefDecision[];
  onUpdateDecision?: (id: string, selected: string) => void;
}) {
  if (decisions.length === 0) return null;
  return (
    <div data-testid="panel-brief-decisions" className="space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
        <Info className="w-3 h-3" /><span>Refine the brief</span>
      </div>
      {decisions.map((decision) => (
        <div key={decision.id} data-testid={`decision-${decision.id}`} className="space-y-1.5">
          <p className="text-[11px] text-neutral-300 leading-snug">{decision.question}</p>
          <div className="flex flex-wrap gap-1.5">
            {decision.options.map((option) => (
              <button
                key={option}
                type="button"
                data-testid={`decision-option-${decision.id}-${option.replace(/[^a-zA-Z0-9]/g, "_")}`}
                onClick={() => onUpdateDecision?.(decision.id, option)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  option === decision.selected
                    ? "bg-orange-600/20 border-orange-700 text-orange-200"
                    : "bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-orange-700 hover:text-orange-200"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AudioProjectCard({
  project, classification, loading = false, error,
  onNativeExport, onReviseKind, onOpenWorkstation, onUpdateDecision,
  onRunPluginAudition, activePluginId, pluginAuditionPlaying = false,
  onPreviewMeasured,
}: AudioProjectCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<"beginner" | "pro">("beginner");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  // Active stop-handle for a running browser AudioContext audition.
  const [stopAudition, setStopAudition] = useState<(() => void) | null>(null);

  const fidelity = project ? FIDELITY_COPY[project.preview.fidelity] : null;
  const questions = classification?.questions ?? [];
  const nativeTarget = useMemo(() => project?.brief.targets.find(t => t.target === "vst3"), [project]);

  if (!loading && !error && !project) return null;
  if (loading && !project) {
    return (
      <div
        data-testid="status-audio-project-loading"
        className="w-full max-w-2xl mx-auto rounded-2xl border border-orange-900/50 bg-orange-950/20 px-4 py-3 text-xs text-orange-200 animate-pulse"
      >
        Compiling the audio-software project…
      </div>
    );
  }
  if (error && !project) {
    return (
      <div
        data-testid="status-audio-project-error"
        className="w-full max-w-2xl mx-auto rounded-2xl border border-rose-900/50 bg-rose-950/20 px-4 py-3 text-xs text-rose-300"
      >
        {error}
      </div>
    );
  }
  if (!project) return null;

  const summary = project.brief.summary;
  const decisions: BriefDecision[] = project.brief.decisions ?? [];
  const isDaw = project.kind === "daw";
  // Resolve how this card auditions (delegate to plugin / run DSP / unavailable
  // / focused simulation). An adapted-effect project never runs generic audio.
  const auditionMode = resolveAuditionMode(
    project as Pick<AudioSoftwareProject, "kind"> & { processor?: { mode?: string; pluginId?: string } },
    activePluginId,
    !!onRunPluginAudition,
  );
  const usePluginCallback = auditionMode === "plugin-delegate";
  const isProcessorAudition = auditionMode === "processor-audition";
  const isPluginUnavailable = auditionMode === "plugin-unavailable";
  // "processor audition" button family covers both delegate and DSP modes.
  const isAuditionKind = usePluginCallback || isProcessorAudition || isPluginUnavailable;
  const auditionPlaying = usePluginCallback ? pluginAuditionPlaying : !!stopAudition;

  // Reports a genuinely successful preview execution up to the host so the
  // pending golden-fixture evidence can be promoted to "measured". No-op when
  // there is no pending fixture (already measured) or no host callback.
  function reportMeasured(measuredDetail: string) {
    if (!project || !onPreviewMeasured) return;
    const check = findPendingFixtureCheck(project);
    if (!check) return;
    onPreviewMeasured(project.id, check, measuredDetail);
  }

  async function handleAuditionClick() {
    if (usePluginCallback) {
      // Delegate to the loaded-plugin audition (toggle play/stop). The exact,
      // identity-matched plugin's faceplate DSP is what plays, so a successful
      // START of this delegate audition is a real execution of the contract.
      const outcome = await onRunPluginAudition!();
      if (shouldPromotePluginAudition(outcome)) {
        const pluginId = project.kind === "effect" && project.processor.mode === "adapted-plugin"
          ? project.processor.pluginId : undefined;
        reportMeasured(`Adapted-plugin audition started through the identity-matched loaded plugin${pluginId ? ` (${pluginId})` : ""}.`);
      } else if (outcome === "stopped") {
        setPreviewStatus("Audition stopped.");
      } else {
        setPreviewStatus("Audition could not start; evidence was not changed.");
      }
      return;
    }
    // Adapted effect with no loaded plugin: never run generic audio, never promote.
    if (isPluginUnavailable) {
      setPreviewStatus("Audition unavailable — load this effect's plugin in the studio to hear its real DSP.");
      return;
    }

    // Stop any running audition — this is NOT a completion, so never promote.
    if (stopAudition) {
      stopAudition();
      setStopAudition(null);
      setPreviewStatus("Audition stopped.");
      setBusy(null);
      return;
    }

    setBusy("preview");
    setPreviewStatus(null);
    try {
      const { stop, done } = await runProcessorAudition(project);
      setStopAudition(() => stop);
      const result = await done;
      setPreviewStatus(result);
      // The processor audition ran through a real AudioContext to completion.
      reportMeasured(`Processor audition ran the browser DSP model through a real AudioContext to completion: ${result}`);
    } catch (err) {
      // Never promote on error.
      setPreviewStatus(err instanceof Error ? err.message : "Audition failed.");
    } finally {
      setStopAudition(null);
      setBusy(null);
    }
  }

  async function handleSimulationClick() {
    setBusy("preview");
    setPreviewStatus(null);
    try {
      const result = await runFocusedSimulation(project!);
      setPreviewStatus(result);
      // The focused simulation executed the browser model successfully.
      reportMeasured(`Focused simulation executed the browser model successfully: ${result}`);
    } catch (err) {
      // Never promote on error.
      setPreviewStatus(err instanceof Error ? err.message : "Simulation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      data-testid="card-audio-project"
      className="w-full max-w-2xl mx-auto rounded-2xl border border-orange-900/50 bg-neutral-900/90 overflow-hidden"
      aria-label="Generated audio software project"
    >
      {/* Classification ambiguity panel — category confirmation for ambiguous prompts */}
      {questions.length > 0 && (
        <div data-testid="panel-intake-questions" className="border-b border-orange-900/40 bg-orange-950/20 px-4 py-3 space-y-2">
          {questions.map((question) => (
            <div key={question.id} data-testid={`question-${question.id}`} className="space-y-1.5">
              <p className="text-[11px] text-orange-200 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{question.prompt}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {question.options.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    data-testid={`button-confirm-kind-${option.kind}`}
                    disabled={loading}
                    onClick={() => onReviseKind?.(option.kind)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                      option.kind === project.kind
                        ? "bg-orange-600/25 border-orange-600 text-orange-200"
                        : "bg-neutral-900 border-neutral-700 text-neutral-300 hover:border-orange-700 hover:text-orange-200"
                    }`}
                  >
                    {option.kind === project.kind ? `Keep as ${option.label}` : `Make it a ${option.label}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Header row */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-600/20 text-orange-300 flex items-center justify-center shrink-0">
          <Package className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 data-testid="text-project-name" className="text-sm font-semibold text-neutral-100 truncate">
              {project.name}
            </h2>
            <span
              data-testid="text-project-kind"
              className="text-[10px] uppercase tracking-wider text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded-full"
            >
              {KIND_LABEL[project.kind]}
            </span>
            {fidelity && (
              <span
                data-testid="text-preview-fidelity"
                title={fidelity.detail}
                className="text-[10px] text-sky-300 bg-sky-500/10 px-2 py-0.5 rounded-full"
              >
                {fidelity.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400 line-clamp-2">
            {project.brief.goal || project.brief.purpose}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-neutral-500">
            <span>{project.brief.controls.length} controls</span>
            <span>•</span>
            <span>{project.brief.graph.nodes.length} graph nodes</span>
            <span>•</span>
            <span className={nativeTarget?.supported ? "text-emerald-400" : "text-neutral-500"}>
              {nativeTarget?.supported ? "VST3 scaffold (not compiled)" : "Browser project only"}
            </span>
          </div>
        </div>
        <button
          type="button"
          data-testid="button-toggle-project-details"
          onClick={() => setExpanded(v => !v)}
          className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800"
          aria-label={expanded ? "Hide project details" : "Inspect project details"}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {/* Action bar */}
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {isDaw && onOpenWorkstation ? (
          <button
            type="button"
            data-testid="button-open-workstation"
            onClick={onOpenWorkstation}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 px-3 py-1.5 text-xs font-medium text-white"
          >
            <AudioLines className="w-3.5 h-3.5" /> Open in workstation
          </button>
        ) : isPluginUnavailable ? (
          /* Adapted effect whose plugin isn't loaded — audition disabled, never faked */
          <button
            type="button"
            data-testid="button-run-project-preview"
            data-audition-mode="plugin-unavailable"
            disabled
            title="Load this effect's plugin in the studio to audition its real DSP."
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-500 cursor-not-allowed opacity-60"
          >
            <Play className="w-3.5 h-3.5" /> Audition unavailable
          </button>
        ) : isAuditionKind ? (
          /* Processor audition — delegates to loaded plugin DSP, or runs the
             browser processor model for non-adapted processor kinds. */
          <button
            type="button"
            data-testid="button-run-project-preview"
            data-audition-mode={usePluginCallback ? "plugin-delegate" : "processor-audition"}
            disabled={busy === "export"}
            onClick={handleAuditionClick}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
              auditionPlaying
                ? "bg-orange-700 hover:bg-orange-600"
                : "bg-orange-600 hover:bg-orange-500"
            }`}
          >
            {auditionPlaying
              ? <><Square className="w-3.5 h-3.5" /> Stop audition</>
              : <><Play className="w-3.5 h-3.5" /> {usePluginCallback ? "Audition plugin" : "Audition"}</>
            }
          </button>
        ) : (
          /* Focused simulation — no live audio; labeled clearly */
          <button
            type="button"
            data-testid="button-run-project-preview"
            disabled={busy !== null}
            onClick={handleSimulationClick}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            <Play className="w-3.5 h-3.5" />
            {busy === "preview" ? "Running…" : "Run simulation"}
          </button>
        )}
        <button
          type="button"
          data-testid="button-download-project"
          onClick={() => downloadProject(project)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 hover:border-neutral-600 px-3 py-1.5 text-xs text-neutral-200"
        >
          <Download className="w-3.5 h-3.5" /> Download project
        </button>
        {onReviseKind && (
          <button
            type="button"
            data-testid="button-toggle-revise"
            onClick={() => setReviseOpen(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 hover:border-neutral-600 px-3 py-1.5 text-xs text-neutral-200"
          >
            <PencilLine className="w-3.5 h-3.5" /> Change category
          </button>
        )}
        {nativeTarget?.supported && onNativeExport && (
          <button
            type="button"
            data-testid="button-scaffold-vst3"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("export");
              setExportStatus(null);
              try { setExportStatus(await onNativeExport(project)); }
              catch (cause) { setExportStatus(cause instanceof Error ? cause.message : "Native export failed."); }
              finally { setBusy(null); }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800 hover:border-emerald-600 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
          >
            <Code2 className="w-3.5 h-3.5" />
            {busy === "export" ? "Scaffolding…" : "Create VST3 scaffold"}
          </button>
        )}
      </div>

      {/* Category revision panel */}
      {reviseOpen && onReviseKind && (
        <div
          data-testid="panel-revise-kind"
          className="mx-4 mb-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 space-y-2"
        >
          <p className="text-[10px] text-neutral-400">
            Switch the starting point. The project id is kept; prior evidence is preserved as provenance history.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_KINDS.filter(k => k !== project.kind).map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`button-revise-to-${k}`}
                disabled={loading}
                onClick={() => { onReviseKind(k); setReviseOpen(false); }}
                className="text-[11px] px-2.5 py-1 rounded-full border border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-orange-700 hover:text-orange-200 transition-colors disabled:opacity-50"
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {(previewStatus || exportStatus) && (
        <div
          data-testid="status-project-action"
          className="mx-4 mb-3 rounded-lg bg-neutral-950/70 px-3 py-2 text-[11px] text-emerald-300 flex items-center gap-2"
        >
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{exportStatus || previewStatus}</span>
        </div>
      )}

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-neutral-800 px-4 py-3 space-y-4">
          {/* Beginner / Pro toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-neutral-500 mr-1">Brief detail</span>
            {(["beginner", "pro"] as const).map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`button-brief-detail-${level}`}
                onClick={() => setDetail(level)}
                className={`text-[10px] px-2.5 py-1 rounded-full border capitalize transition-colors ${
                  detail === level
                    ? "bg-orange-600/20 border-orange-700 text-orange-300"
                    : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Beginner view: per-kind contextual decisions + capability summary */}
          {detail === "beginner" && (
            <>
              {/* Per-kind outcome-focused decisions (always shown, not only on ambiguity) */}
              <DecisionsPanel decisions={decisions} onUpdateDecision={onUpdateDecision} />

              {/* Audiences and workflows for context */}
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <SummaryGroup
                  title="Who is this for"
                  items={project.brief.audiences ?? []}
                  tone="neutral"
                  testid="summary-audiences"
                  icon={<Users className="w-3 h-3" />}
                />
                <SummaryGroup
                  title="Workflows it supports"
                  items={project.brief.workflows ?? []}
                  tone="sky"
                  testid="summary-workflows"
                  icon={<GitBranch className="w-3 h-3" />}
                />
              </div>

              {/* Capability summary */}
              <div data-testid="panel-capability-summary" className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <SummaryGroup title="Understood" items={summary.understood} tone="neutral" testid="summary-understood" icon={<Info className="w-3 h-3" />} />
                <SummaryGroup title="Changed" items={summary.changed} tone="amber" testid="summary-changed" icon={<PencilLine className="w-3 h-3" />} />
                <SummaryGroup title="Proven" items={summary.proven} tone="emerald" testid="summary-proven" icon={<ShieldCheck className="w-3 h-3" />} />
                <SummaryGroup title="Conceptual" items={summary.conceptual} tone="sky" testid="summary-conceptual" icon={<Info className="w-3 h-3" />} />
                <SummaryGroup title="Not supported" items={summary.unsupported} tone="rose" testid="summary-unsupported" icon={<XCircle className="w-3 h-3" />} />
              </div>
            </>
          )}

          {/* Pro view: everything in beginner + explicit technical contract fields */}
          {detail === "pro" && (
            <>
              {/* Decisions still shown in pro mode */}
              <DecisionsPanel decisions={decisions} onUpdateDecision={onUpdateDecision} />

              <div data-testid="panel-capability-summary" className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <SummaryGroup title="Understood" items={summary.understood} tone="neutral" testid="summary-understood" icon={<Info className="w-3 h-3" />} />
                <SummaryGroup title="Changed" items={summary.changed} tone="amber" testid="summary-changed" icon={<PencilLine className="w-3 h-3" />} />
                <SummaryGroup title="Proven" items={summary.proven} tone="emerald" testid="summary-proven" icon={<ShieldCheck className="w-3 h-3" />} />
                <SummaryGroup title="Conceptual" items={summary.conceptual} tone="sky" testid="summary-conceptual" icon={<Info className="w-3 h-3" />} />
                <SummaryGroup title="Not supported" items={summary.unsupported} tone="rose" testid="summary-unsupported" icon={<XCircle className="w-3 h-3" />} />
              </div>

              <div data-testid="panel-pro-brief" className="grid sm:grid-cols-2 gap-4 text-[11px] pt-2 border-t border-neutral-800">
                {/* Audiences and workflows */}
                <div>
                  <h3 className="flex items-center gap-1.5 font-medium text-neutral-200 mb-1.5">
                    <Users className="w-3 h-3" /> Audiences and workflows
                  </h3>
                  <ul className="space-y-1 text-neutral-400">
                    {(project.brief.audiences ?? []).map((a, i) => <li key={i}>{a}</li>)}
                    {(project.brief.workflows ?? []).map((w, i) => <li key={`wf-${i}`} className="text-sky-400/80">{w}</li>)}
                  </ul>
                </div>
                {/* Interface and platform targets */}
                <div>
                  <h3 className="flex items-center gap-1.5 font-medium text-neutral-200 mb-1.5">
                    <SlidersHorizontal className="w-3 h-3" /> Interface and targets
                  </h3>
                  <p className="text-neutral-400 mb-1.5 leading-snug">
                    {project.brief.interfaceDescription}
                  </p>
                  <ul className="space-y-0.5">
                    {(project.brief.platformTargets ?? []).map((t, i) => (
                      <li key={i} className="text-neutral-400">{t}</li>
                    ))}
                  </ul>
                </div>
                {/* Validation requirements */}
                <div>
                  <h3 className="flex items-center gap-1.5 font-medium text-neutral-200 mb-1.5">
                    <ListChecks className="w-3 h-3" /> Validation requirements
                  </h3>
                  <ul className="space-y-1 text-neutral-400">
                    {(project.brief.validationRequirements ?? []).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
                {/* Evidence log */}
                <div>
                  <h3 className="flex items-center gap-1.5 font-medium text-neutral-200 mb-1.5">
                    <ShieldCheck className="w-3 h-3" /> Evidence log
                  </h3>
                  <ul className="space-y-1 text-neutral-400">
                    {project.brief.evidence.map(item => (
                      <li key={`${item.grade}-${item.check}`}>
                        <span className={item.pass ? "text-emerald-400" : "text-rose-400"}>
                          {item.pass ? "PASS" : "FAIL"}
                        </span>{" "}
                        <span className="uppercase text-[9px] text-neutral-500">{item.grade}</span>{" "}
                        {item.check}: {item.detail}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Controls and targets */}
                <div>
                  <h3 className="flex items-center gap-1.5 font-medium text-neutral-200 mb-1.5">
                    <SlidersHorizontal className="w-3 h-3" /> Controls and targets
                  </h3>
                  <ul className="space-y-1 text-neutral-400">
                    {project.brief.controls.map(c => (
                      <li key={c.id}>{c.label} ({c.role})</li>
                    ))}
                    {project.brief.targets.map(t => (
                      <li key={t.target} className={t.supported ? "text-emerald-400" : "text-neutral-500"}>
                        {t.target}: {t.stage}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Repair history */}
                {project.repairHistory.length > 0 && (
                  <div className="sm:col-span-2">
                    <h3 className="font-medium text-neutral-200 mb-1.5">Revision and repair history</h3>
                    <ul className="space-y-1 text-neutral-400">
                      {project.repairHistory.map((entry, i) => <li key={i}>{entry}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {classification && (
            <p
              data-testid="text-classification-rationale"
              className="text-[10px] text-neutral-500 pt-2 border-t border-neutral-800 leading-snug"
            >
              {classification.rationale}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
