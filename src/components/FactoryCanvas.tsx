import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Plus,
  Minus,
  Maximize2,
  Send,
  X,
  Copy,
  RefreshCw,
  Trash2,
  ExternalLink,
  Sparkles,
  Volume2,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Guitar,
  BookOpen,
  LayoutGrid,
} from "lucide-react";
import { AudioPlugin, PluginParameter } from "../types";
import {
  CanvasCard,
  buildCanvasPlugin,
  loadCanvasWorkspace,
  saveCanvasWorkspace,
  placeNewCard,
  mergeRebuildChanges,
  CARD_FOOTPRINT_W,
  CARD_FOOTPRINT_H,
  CARD_FOOTPRINT_GAP,
} from "../utils/canvasFactory";
import { PluginControl, groupParamsForPlayback } from "./PluginControl";
import GenerativeFaceplate from "./GenerativeFaceplate";
import { PluginManual } from "./PluginManual";
import { resolveSkinFontFamily } from "../utils/customSkin";

/**
 * Factory Canvas: the autonomous plugin factory as a spatial workspace.
 *
 * Every prompt spawns a card on an infinite pan/zoom canvas; each card runs
 * the full deterministic pipeline (spec -> best-of-N build -> quality gate ->
 * perfecting loop) in a sequential queue and lands as a playable, tweakable
 * plugin with its measured scores on the badge. One card auditions at a time
 * through the app's single live audio engine.
 */

interface FactoryCanvasProps {
  onOpenStudio: () => void;
  onOpenPro: () => void;
  /** Load a card's plugin as the studio's active plugin and switch modes. */
  onLoadInStudio: (plugin: AudioPlugin) => void;
  /** Start (or retarget) the live engine on this plugin. */
  onAudition: (plugin: AudioPlugin) => Promise<void>;
  onStopAudition: () => void;
  /** Push one param change into the live engine (audition path only). */
  onLiveParamChange: (paramId: string, value: number) => void;
  isPlaying: boolean;
  analyserNode: AnalyserNode | null;
  /** Perfecting passes per build (shared app setting). */
  refineLoops: number;
  refineControl?: React.ReactNode;
  /** Fired at most once per mount the first time a workspace save fails
   *  (localStorage full/unavailable) -- lets the app surface a real toast
   *  instead of the failure being invisible (console.warn only). */
  onPersistFailure?: () => void;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.75;
const CARD_W = 360;

const SUGGESTIONS: Array<{ emoji: string; label: string; prompt: string }> = [
  { emoji: "🎛️", label: "Warm tape delay", prompt: "Make a warm tape echo delay with a bit of wobble and a dry/wet mix knob." },
  { emoji: "🌊", label: "Dreamy shimmer", prompt: "Make a big dreamy shimmer reverb with size, tone, and mix controls." },
  { emoji: "🎸", label: "Crunchy amp", prompt: "Create a crunchy vintage guitar amp with drive, tone, and level controls." },
  { emoji: "🤖", label: "Robot voice", prompt: "A robotic ring modulator voice mangler with a metallic resonator." },
  { emoji: "🕳️", label: "Underwater", prompt: "An underwater dream machine that makes everything sound deep and distant." },
];

const STAGE_SEQUENCE = ["spec", "build", "gate", "perfect"] as const;
const STAGE_LABELS: Record<string, string> = {
  spec: "Spec",
  build: "Build",
  gate: "Gate",
  perfect: "Perfect",
};

function scoreTone(min: number | undefined): string {
  if (min === undefined) return "bg-neutral-800 text-neutral-400 border-neutral-700";
  if (min >= 97) return "bg-emerald-950/70 text-emerald-300 border-emerald-800/70";
  if (min >= 90) return "bg-amber-950/70 text-amber-300 border-amber-800/70";
  return "bg-rose-950/70 text-rose-300 border-rose-800/70";
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

interface CardProps {
  card: CanvasCard;
  selected: boolean;
  isLive: boolean;
  enginePlaying: boolean;
  analyserNode: AnalyserNode | null;
  onSelect: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRebuild: () => void;
  onToggleAudition: () => void;
  onOpenInStudio: () => void;
  onOpenManual: () => void;
  onParamChange: (paramId: string, value: number) => void;
}

const CanvasPluginCard: React.FC<CardProps> = ({
  card,
  selected,
  isLive,
  enginePlaying,
  analyserNode,
  onSelect,
  onDragStart,
  onDelete,
  onDuplicate,
  onRebuild,
  onToggleAudition,
  onOpenInStudio,
  onOpenManual,
  onParamChange,
}) => {
  // Replaces the old permanently-visible prompt/evidence text and the
  // click-to-toggle "Quality evidence" drawer: the card's resting state now
  // shows just the plugin itself (name up top, its own controls, the
  // action row at bottom) -- all of that explanatory detail lives in one
  // panel that fades in on hover and fades back out on mouse-leave.
  const [isHovering, setIsHovering] = useState(false);
  const plugin = card.plugin;
  const live = isLive && enginePlaying;

  const grouped = useMemo(() => (plugin ? groupParamsForPlayback(plugin) : null), [plugin]);
  // Cards show the knob/slider surface; full showpieces (amp heads, cabs,
  // mic stands, pads) live in the Studio where there's room for them.
  const knobParams = useMemo(() => {
    if (!grouped) return [] as PluginParameter[];
    return grouped.regular.filter((p) => p.controlType !== "meter" && p.controlType !== "label").slice(0, 8);
  }, [grouped]);
  const hasShowpiece = (grouped?.showpiece.length ?? 0) > 0 || (grouped?.pads.length ?? 0) > 0;

  const building = card.status === "building" || card.status === "queued";
  const currentStageIdx = STAGE_SEQUENCE.indexOf((card.stage as (typeof STAGE_SEQUENCE)[number]) ?? "spec");

  // Everything explanatory (the prompt it was built from, the measured
  // functional-fitness evidence, the "why this design" rationale, and the
  // four quality scores + refinement/fixes notes) lives in ONE panel that
  // fades/expands in on hover and collapses back out on mouse-leave --
  // replacing both the old permanently-visible callouts and the separate
  // click-to-toggle "Quality evidence" drawer. Rendered above the knobs (in
  // normal document flow, not an absolute overlay), so it never competes
  // with dragging a knob for the same pixels the way a floating overlay
  // covering the controls would.
  const infoPanel = (
    <div
      className={`overflow-hidden transition-all duration-200 ease-out ${
        isHovering ? "max-h-[640px] opacity-100 mb-3" : "max-h-0 opacity-0"
      }`}
    >
      <div className="space-y-2.5 pt-0.5">
        <p className="text-[10.5px] leading-relaxed text-neutral-400 line-clamp-2" title={card.prompt}>
          “{card.prompt}”
        </p>

        {/* Measured: the build measurably does its family's job. The four
            gate scores say it's correct; this says it WORKS, with real
            numbers. */}
        {card.plugin?.buildReport?.functionalFitness && (
          <div
            className="flex items-start gap-1.5 rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-2.5 py-1.5"
            title={`Measured ${card.plugin.buildReport.functionalFitness.metric}: ${card.plugin.buildReport.functionalFitness.evidence}`}
          >
            <CheckCircle2 className="w-3 h-3 mt-px shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-400/90">
                Measured · {card.plugin.buildReport.functionalFitness.metric}
              </span>
              <p className="text-[10px] leading-relaxed text-neutral-300 line-clamp-2">
                {card.plugin.buildReport.functionalFitness.evidence}
              </p>
            </div>
          </div>
        )}

        {/* Why this design — the engineering brain made visible */}
        {card.plugin?.buildReport?.engineeringChoice && (
          <div
            className="rounded-lg border border-orange-900/40 bg-orange-950/20 px-2.5 py-2"
            title={`Read from your wording: ${card.plugin.buildReport.engineeringChoice.evidence.join("; ")}`}
          >
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-orange-400/90">
              <Sparkles className="w-2.5 h-2.5" />
              Why this design
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-neutral-300">
              <span className="font-mono text-orange-300">{card.plugin.buildReport.engineeringChoice.topology}</span>
              {" — "}
              {card.plugin.buildReport.engineeringChoice.rationale}
            </p>
          </div>
        )}

        {/* Quality evidence: the four scores + refinement trace -- no
            longer click-to-expand, it's part of the same hover reveal. */}
        {plugin && plugin.quality && (
          <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 px-2.5 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Quality evidence
              {card.versionsTried ? ` · ${card.versionsTried} versions gated` : ""}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  ["Looks", plugin.quality.looks],
                  ["Perf", plugin.quality.performance],
                  ["Latency", plugin.quality.latency],
                  ["Musical", plugin.quality.musicality],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="text-center rounded-md bg-neutral-900 border border-neutral-800 py-1">
                  <div className={`text-[11px] font-bold ${v >= 97 ? "text-emerald-400" : v >= 90 ? "text-amber-400" : "text-rose-400"}`}>{v}</div>
                  <div className="text-[8px] uppercase tracking-wider text-neutral-500">{label}</div>
                </div>
              ))}
            </div>
            {plugin.buildReport?.refinement && plugin.buildReport.refinement.length > 0 && (
              <div className="text-[9.5px] text-neutral-500 leading-relaxed">
                Perfecting loop: {plugin.buildReport.refinement.filter((r) => r.accepted).length} of{" "}
                {plugin.buildReport.refinement.length} rework passes scored strictly higher and were kept.
              </div>
            )}
            {plugin.buildReport && plugin.buildReport.fixes.length > 0 && (
              <div className="text-[9.5px] text-neutral-500 leading-relaxed">
                {plugin.buildReport.fixes.length} deterministic fixes/notes applied by the gate.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const body = (
    <div className="px-4 pb-3 pt-2 space-y-3">
      {infoPanel}

      {card.status === "failed" && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-rose-300 text-[11px] font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            Build failed
          </div>
          <p className="text-[10.5px] text-rose-200/80 leading-relaxed">{card.error || "Unknown error."}</p>
          <button
            onClick={onRebuild}
            className="flex items-center gap-1.5 text-[10.5px] font-bold text-white bg-rose-700 hover:bg-rose-600 px-2.5 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {building && (
        <div className="space-y-2.5" aria-live="polite">
          <div className="flex items-center gap-1">
            {STAGE_SEQUENCE.map((s, i) => {
              const isDone = card.status === "building" && i < currentStageIdx;
              const isActive = card.status === "building" && i === currentStageIdx;
              return (
                <React.Fragment key={s}>
                  {i > 0 && <span className={`flex-1 h-px ${isDone || isActive ? "bg-orange-700" : "bg-neutral-800"}`} />}
                  <span
                    className={`text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      isActive
                        ? "bg-orange-600/20 text-orange-300 border border-orange-800"
                        : isDone
                        ? "text-emerald-400"
                        : "text-neutral-600"
                    }`}
                  >
                    {STAGE_LABELS[s]}
                    {isActive && card.stageDetail ? ` ${card.stageDetail}` : ""}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[10.5px] text-neutral-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
            {card.status === "queued" ? (
              <span>Queued — waiting for the build slot…</span>
            ) : (
              <span>
                Autonomous build running
                {card.versionsTried ? ` — ${card.versionsTried} version${card.versionsTried === 1 ? "" : "s"} gated` : ""}
              </span>
            )}
          </div>
          {/* Skeleton knobs */}
          <div className="grid grid-cols-4 gap-3 pt-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-neutral-800/80 animate-pulse" />
                <div className="w-8 h-1.5 rounded bg-neutral-800/80 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      )}

      {plugin && card.status === "ready" && (
        <>
          {knobParams.length > 0 && (
            <div
              className={`grid gap-x-3 gap-y-2 ${knobParams.length <= 4 ? "grid-cols-4" : "grid-cols-4"}`}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {knobParams.map((p) => (
                <PluginControl
                  key={p.id}
                  param={p}
                  allParams={plugin.parameters}
                  onChange={onParamChange}
                  analyserNode={isLive ? analyserNode : null}
                  isPlaying={live}
                />
              ))}
            </div>
          )}
          {hasShowpiece && (
            <button
              onClick={onOpenInStudio}
              className="w-full flex items-center justify-center gap-1.5 text-[10px] text-neutral-400 hover:text-orange-300 border border-dashed border-neutral-800 hover:border-orange-800 rounded-lg py-1.5 transition-colors cursor-pointer"
              title="This build carries a full rig (amp/cab/mic or pads) — open the Studio to play it"
            >
              <Guitar className="w-3 h-3" />
              Full rig &amp; showpiece controls in Studio →
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      data-canvas-card="true"
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className={`absolute rounded-2xl border bg-neutral-900 shadow-xl shadow-black/50 transition-shadow select-none ${
        selected ? "border-orange-600 ring-2 ring-orange-600/30" : "border-neutral-800 hover:border-neutral-700"
      } ${live ? "shadow-orange-950/40" : ""}`}
      style={{ left: card.x, top: card.y, width: CARD_W }}
      role="group"
      aria-label={`Plugin card: ${plugin?.name ?? card.prompt}`}
    >
      {/* Header = drag handle */}
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect();
          onDragStart(e);
        }}
        className="flex items-center gap-2 px-3.5 py-2.5 cursor-grab active:cursor-grabbing border-b border-neutral-800/70"
        title="Drag to move"
      >
        <button
          onClick={onToggleAudition}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={card.status !== "ready"}
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
            live
              ? "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-950/60"
              : "bg-neutral-100 hover:bg-white text-neutral-950"
          }`}
          title={live ? "Stop audio" : "Play — hear this plugin"}
          aria-label={live ? `Stop ${plugin?.name ?? "plugin"}` : `Play ${plugin?.name ?? "plugin"}`}
        >
          {live ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div
            className="text-[12.5px] font-semibold text-neutral-100 truncate"
            style={{ fontFamily: resolveSkinFontFamily(plugin?.customSkin?.fontStyle) }}
          >
            {plugin?.name ?? (card.status === "failed" ? "Failed build" : "Building…")}
          </div>
          <div className="text-[9.5px] text-neutral-500 capitalize truncate">
            {plugin ? `${plugin.category} · ${plugin.parameters.length} controls` : card.status}
          </div>
        </div>

        <span
          className={`shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md border ${scoreTone(card.minScore)}`}
          title="Lowest of the four quality-gate scores (looks / performance / latency / musicality)"
        >
          {card.minScore !== undefined ? card.minScore : "—"}
        </span>

        {plugin && (
          <button
            onClick={onOpenManual}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Open this plugin's manual — every control, explained"
            aria-label="Open plugin manual"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={onDelete}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          title="Remove this card"
          aria-label="Remove this card"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Height-capped with internal scroll: a card's content is unbounded
          (param count, whether "Quality evidence" is expanded, whether the
          engineering-choice/functional-fitness callouts are present), but
          placeNewCard's collision-avoidance spacing has to assume SOME
          fixed worst-case height to keep neighboring cards apart. Without
          this cap, a card that grows past that assumption visually
          overlaps text in the next card instead of just... growing.
          Scrolling inside the card keeps every fact reachable either way. */}
      <div className="max-h-[440px] overflow-y-auto overflow-x-hidden scrollbar-thin" onWheel={(e) => e.stopPropagation()}>
        {plugin && card.status === "ready" ? (
          <GenerativeFaceplate plugin={plugin} analyserNode={isLive ? analyserNode : null} isPlaying={live}>
            {body}
          </GenerativeFaceplate>
        ) : (
          body
        )}
      </div>

      {/* Footer actions */}
      {card.status === "ready" && plugin && (
        <div
          className="flex items-center gap-1 px-2.5 py-2 border-t border-neutral-800/70"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={onOpenInStudio}
            className="flex items-center gap-1 text-[10px] font-semibold text-neutral-300 hover:text-white px-2 py-1 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Load this plugin in the Studio (chat, annotate, export)"
          >
            <ExternalLink className="w-3 h-3" />
            Studio
          </button>
          <button
            onClick={onDuplicate}
            className="flex items-center gap-1 text-[10px] font-semibold text-neutral-300 hover:text-white px-2 py-1 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Duplicate this card"
          >
            <Copy className="w-3 h-3" />
            Duplicate
          </button>
          <button
            onClick={onRebuild}
            className="flex items-center gap-1 text-[10px] font-semibold text-neutral-300 hover:text-white px-2 py-1 rounded-md hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Re-run the autonomous pipeline on this prompt"
          >
            <RefreshCw className="w-3 h-3" />
            Rebuild
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1 text-[10px] font-semibold text-neutral-300 hover:text-rose-300 px-2 py-1 rounded-md hover:bg-rose-950/40 transition-colors cursor-pointer"
            title="Delete this card"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
          {live && (
            <span className="ml-auto flex items-center gap-1 text-[9.5px] font-bold text-orange-300">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export default function FactoryCanvas({
  onOpenStudio,
  onOpenPro,
  onLoadInStudio,
  onAudition,
  onStopAudition,
  onLiveParamChange,
  isPlaying,
  analyserNode,
  refineLoops,
  refineControl,
  onPersistFailure,
}: FactoryCanvasProps) {
  const initial = useMemo(() => loadCanvasWorkspace(), []);
  const [cards, setCards] = useState<CanvasCard[]>(initial.cards);
  const [view, setView] = useState(initial.view);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveCardId, setLiveCardId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  // Fire onPersistFailure at most once per mount -- a failing save repeats
  // on every debounced write (pan, drag, param tweak); one toast is a
  // useful warning, a toast per keystroke is spam.
  const persistFailureReportedRef = useRef(false);
  const reportPersistFailure = useCallback(() => {
    if (persistFailureReportedRef.current) return;
    persistFailureReportedRef.current = true;
    onPersistFailure?.();
  }, [onPersistFailure]);

  /* ---- persistence (debounced, flushed on leave) ---- */
  useEffect(() => {
    const t = setTimeout(() => {
      if (!saveCanvasWorkspace({ cards, view })) reportPersistFailure();
    }, 350);
    return () => clearTimeout(t);
  }, [cards, view, reportPersistFailure]);
  useEffect(() => {
    // The debounce loses the newest state if the tab closes/reloads (or the
    // user switches modes) inside the 350 ms window — flush from refs on
    // pagehide and on unmount so a just-spawned card always survives.
    const flush = () => {
      if (!saveCanvasWorkspace({ cards: cardsRef.current, view: viewRef.current })) reportPersistFailure();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- engine stopped externally -> no card is live ---- */
  useEffect(() => {
    if (!isPlaying) setLiveCardId(null);
  }, [isPlaying]);

  /* ---- sequential build queue ---- */
  const buildingRef = useRef(false);
  const pumpQueue = useCallback(() => {
    if (buildingRef.current) return;
    const next = cardsRef.current.find((c) => c.status === "queued");
    if (!next) return;
    buildingRef.current = true;
    const id = next.id;
    const patch = (partial: Partial<CanvasCard>) =>
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));

    patch({ status: "building", stage: "spec", stageDetail: undefined });
    buildCanvasPlugin(next.prompt, {
      refineLoops,
      onProgress: (p) =>
        patch({
          stage: p.stage === "done" ? "perfect" : p.stage,
          stageDetail: p.detail,
          versionsTried: p.versionsTried,
          minScore: p.bestMinScore,
        }),
    })
      .then((result) => {
        patch({
          status: "ready",
          plugin: result.plugin,
          minScore: result.minScore,
          versionsTried: result.versionsTried,
          error: undefined,
          stage: undefined,
          stageDetail: undefined,
        });
      })
      .catch((err: any) => {
        patch({
          status: "failed",
          error: String(err?.message || err).slice(0, 200),
          stage: undefined,
          stageDetail: undefined,
        });
      })
      .finally(() => {
        buildingRef.current = false;
        // Chain to the next queued card on a fresh tick.
        setTimeout(() => pumpRef.current(), 30);
      });
  }, [refineLoops]);
  const pumpRef = useRef(pumpQueue);
  pumpRef.current = pumpQueue;

  useEffect(() => {
    // Resume queued cards from a previous session, and pick up new ones.
    pumpQueue();
  }, [cards, pumpQueue]);

  /* ---- spawn ---- */
  const spawnCard = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const el = containerRef.current;
    const v = viewRef.current;
    const cx = el ? (el.clientWidth / 2 - v.x) / v.zoom : 200;
    const cy = el ? (el.clientHeight / 2.4 - v.y) / v.zoom : 160;
    const pos = placeNewCard(cardsRef.current, cx, cy);
    const card: CanvasCard = {
      id: `card-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
      prompt: trimmed,
      x: pos.x,
      y: pos.y,
      status: "queued",
      createdAt: Date.now(),
    };
    setCards((prev) => [...prev, card]);
    setSelectedId(card.id);
    setPrompt("");
  };

  /* ---- card actions ---- */
  const deleteCard = (id: string) => {
    if (liveCardId === id) {
      onStopAudition();
      setLiveCardId(null);
    }
    setCards((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((sel) => (sel === id ? null : sel));
  };

  const duplicateCard = (id: string) => {
    const src = cardsRef.current.find((c) => c.id === id);
    if (!src || !src.plugin) return;
    const copy: CanvasCard = {
      ...src,
      id: `card-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
      x: src.x + 44,
      y: src.y + 44,
      plugin: JSON.parse(JSON.stringify(src.plugin)),
      createdAt: Date.now(),
    };
    setCards((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  };

  const rebuildCard = (id: string, changes: string = "") => {
    if (liveCardId === id) {
      onStopAudition();
      setLiveCardId(null);
    }
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              prompt: mergeRebuildChanges(c.prompt, changes),
              status: "queued",
              plugin: undefined,
              minScore: undefined,
              versionsTried: undefined,
              error: undefined,
            }
          : c
      )
    );
  };

  /* ---- per-plugin manual: one shared modal instance, not one per card ---- */
  const [manualCardId, setManualCardId] = useState<string | null>(null);

  /* ---- rebuild confirmation modal: "any changes you'd like made?" ---- */
  const [rebuildModalCardId, setRebuildModalCardId] = useState<string | null>(null);
  const [rebuildChangesText, setRebuildChangesText] = useState("");
  const openRebuildModal = (id: string) => {
    setRebuildChangesText("");
    setRebuildModalCardId(id);
  };
  const confirmRebuild = () => {
    if (rebuildModalCardId) rebuildCard(rebuildModalCardId, rebuildChangesText);
    setRebuildModalCardId(null);
  };

  const toggleAudition = async (id: string) => {
    const card = cardsRef.current.find((c) => c.id === id);
    if (!card?.plugin) return;
    if (liveCardId === id && isPlaying) {
      onStopAudition();
      setLiveCardId(null);
      return;
    }
    try {
      await onAudition(card.plugin);
      setLiveCardId(id);
    } catch (err) {
      console.error("Audition failed to start:", err);
    }
  };

  const cardParamChange = (id: string, paramId: string, value: number) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== id || !c.plugin) return c;
        return {
          ...c,
          plugin: {
            ...c.plugin,
            parameters: c.plugin.parameters.map((p) => (p.id === paramId ? { ...p, value } : p)),
          },
        };
      })
    );
    if (liveCardId === id) onLiveParamChange(paramId, value);
  };

  /* ---- pan / zoom / drag ---- */
  const dragRef = useRef<
    | { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number }
    | { kind: "card"; id: string; startX: number; startY: number; cardX: number; cardY: number }
    | null
  >(null);

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSelectedId(null);
    dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, viewX: viewRef.current.x, viewY: viewRef.current.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCardDragStart = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const card = cardsRef.current.find((c) => c.id === id);
    if (!card) return;
    dragRef.current = { kind: "card", id, startX: e.clientX, startY: e.clientY, cardX: card.x, cardY: card.y };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, x: drag.viewX + dx, y: drag.viewY + dy }));
    } else {
      const z = viewRef.current.zoom;
      const nx = drag.cardX + dx / z;
      const ny = drag.cardY + dy / z;
      setCards((prev) => prev.map((c) => (c.id === drag.id ? { ...c, x: nx, y: ny } : c)));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView((v) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
      if (zoom === v.zoom) return v;
      const scale = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
    });
  };

  // Wheel zoom must preventDefault (or the page scrolls/over-zooms), and
  // React attaches wheel listeners passively — so bind it manually.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accepts an optional explicit card list so a caller that JUST changed
  // positions (alignCards, below) can center the view around the NEW
  // layout immediately, without waiting a tick for cardsRef.current to
  // catch up with an async setCards -- avoids a setTimeout/effect just to
  // sequence "reposition, then fit" correctly.
  const fitView = (cardsOverride?: CanvasCard[]) => {
    const el = containerRef.current;
    const list = cardsOverride ?? cardsRef.current;
    if (!el || list.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const xs = list.map((c) => c.x);
    const ys = list.map((c) => c.y);
    const minX = Math.min(...xs) - 60;
    const minY = Math.min(...ys) - 60;
    const maxX = Math.max(...xs) + CARD_W + 60;
    const maxY = Math.max(...ys) + 380 + 60;
    const zoom = Math.max(ZOOM_MIN, Math.min(1, Math.min(el.clientWidth / (maxX - minX), (el.clientHeight - 160) / (maxY - minY))));
    setView({
      zoom,
      x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (el.clientHeight - 140 - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  };

  // "Align all cards": snaps every card into a clean grid (creation order,
  // roughly square column count) using the SAME footprint/gap the
  // collision-avoidance placement already uses, then centers the view on
  // the freshly-tidied layout. Distinct from fitView alone, which only
  // ever adjusts pan/zoom -- it never moves a card that's been dragged
  // somewhere scattered.
  const alignCards = () => {
    if (cardsRef.current.length === 0) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(cardsRef.current.length)));
    const sorted = [...cardsRef.current].sort((a, b) => a.createdAt - b.createdAt);
    const updated = sorted.map((c, i) => ({
      ...c,
      x: (i % cols) * (CARD_FOOTPRINT_W + CARD_FOOTPRINT_GAP),
      y: Math.floor(i / cols) * (CARD_FOOTPRINT_H + CARD_FOOTPRINT_GAP),
    }));
    setCards(updated);
    fitView(updated);
  };

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteCard(selectedId);
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, liveCardId]);

  const buildingCount = cards.filter((c) => c.status === "building" || c.status === "queued").length;

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-200 font-sans antialiased overflow-hidden selection:bg-orange-900/50 selection:text-white">
      {/* Header */}
      <header className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-neutral-900 z-20 bg-neutral-950/90 backdrop-blur">
        <div className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded-lg bg-orange-600 flex items-center justify-center shadow-md shadow-orange-950/50">
            <Volume2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-sm text-neutral-100 tracking-tight">OrangeJuce</span>
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-orange-400/90 border border-orange-900/70 bg-orange-950/40 rounded-md px-1.5 py-0.5 ml-1">
            Factory Canvas
          </span>
          <span className="text-[10px] text-neutral-500 hidden md:inline ml-1">
            {cards.length === 0
              ? "— every prompt becomes a plugin card"
              : `${cards.length} plugin${cards.length === 1 ? "" : "s"}${buildingCount > 0 ? ` · ${buildingCount} building` : ""}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {refineControl}
          <button
            onClick={onOpenStudio}
            className="text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 transition-colors cursor-pointer"
            title="Back to the chat studio"
          >
            Studio
          </button>
          <button
            onClick={onOpenPro}
            className="text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 transition-colors cursor-pointer"
            title="Open the full workspace: code editor, analyzers, VST3 export"
          >
            Pro mode
          </button>
        </div>
      </header>

      {/* Canvas surface */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="application"
        aria-label="Plugin factory canvas — drag to pan, scroll to zoom"
      >
        {/* Dot grid that tracks the viewport */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(115,115,115,0.18) 1px, transparent 1px)",
            backgroundSize: `${28 * view.zoom}px ${28 * view.zoom}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        />

        {/* World */}
        <div
          className="absolute top-0 left-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}
        >
          {cards.map((card) => (
            <CanvasPluginCard
              key={card.id}
              card={card}
              selected={selectedId === card.id}
              isLive={liveCardId === card.id}
              enginePlaying={isPlaying}
              analyserNode={analyserNode}
              onSelect={() => setSelectedId(card.id)}
              onDragStart={onCardDragStart(card.id)}
              onDelete={() => deleteCard(card.id)}
              onDuplicate={() => duplicateCard(card.id)}
              onRebuild={() => openRebuildModal(card.id)}
              onToggleAudition={() => toggleAudition(card.id)}
              onOpenInStudio={() => card.plugin && onLoadInStudio(card.plugin)}
              onOpenManual={() => setManualCardId(card.id)}
              onParamChange={(pid, v) => cardParamChange(card.id, pid, v)}
            />
          ))}
        </div>

        {/* Empty state */}
        {cards.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none pb-32">
            <div className="text-center space-y-4 max-w-md px-6 animate-fadeIn">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-950/40">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">Your plugin factory floor</h1>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Describe a sound below. Each prompt becomes a card that builds itself — spec, DSP, quality gate,
                perfecting loop — and lands here ready to play, tweak, and compare side by side.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pointer-events-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => spawnCard(s.prompt)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-2 text-xs text-neutral-300 hover:text-white bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-3.5 py-2 rounded-full transition-all cursor-pointer"
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div
          className="absolute bottom-28 right-4 flex flex-col gap-1 z-10"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              { icon: <LayoutGrid className="w-3.5 h-3.5" />, label: "Align all cards", act: alignCards },
              { icon: <Plus className="w-3.5 h-3.5" />, label: "Zoom in", act: () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.2) },
              { icon: <Minus className="w-3.5 h-3.5" />, label: "Zoom out", act: () => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.2) },
              { icon: <Maximize2 className="w-3.5 h-3.5" />, label: "Fit all cards", act: () => fitView() },
            ] as const
          ).map((b) => (
            <button
              key={b.label}
              onClick={b.act}
              className="w-8 h-8 rounded-lg bg-neutral-900/90 border border-neutral-800 hover:border-neutral-600 text-neutral-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer backdrop-blur"
              title={b.label}
              aria-label={b.label}
            >
              {b.icon}
            </button>
          ))}
          <div className="text-center text-[9px] font-mono text-neutral-500 pt-0.5 select-none">{Math.round(view.zoom * 100)}%</div>
        </div>
      </div>

      {/* Composer */}
      <div className="absolute bottom-0 inset-x-0 z-20 px-4 pb-4 pt-8 bg-gradient-to-t from-neutral-950 via-neutral-950/85 to-transparent pointer-events-none">
        <div className="w-full max-w-2xl mx-auto pointer-events-auto">
          <div className="flex items-end gap-2 bg-neutral-900 border border-neutral-800 focus-within:border-neutral-600 rounded-3xl px-4 py-3 shadow-lg shadow-black/40 transition-colors">
            <textarea
              rows={1}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  spawnCard(prompt);
                }
              }}
              placeholder="Describe a sound — a new card builds itself…"
              aria-label="Describe a sound to build a new plugin card"
              className="flex-1 resize-none bg-transparent outline-none text-sm text-neutral-100 placeholder-neutral-500 leading-relaxed max-h-32 scrollbar-thin"
            />
            <button
              onClick={() => spawnCard(prompt)}
              disabled={!prompt.trim()}
              className="shrink-0 w-9 h-9 rounded-full bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Build this plugin on the canvas"
              aria-label="Build plugin"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-center text-[10px] text-neutral-600 mt-2 select-none">
            Builds run in your browser and queue automatically · drag cards, scroll to zoom, drag the background to pan
          </p>
        </div>
      </div>

      <PluginManual
        plugin={cards.find((c) => c.id === manualCardId)?.plugin}
        isOpen={!!manualCardId}
        onClose={() => setManualCardId(null)}
      />

      {/* Rebuild confirmation modal: re-running the full pipeline is a
          from-scratch build (not an incremental edit), so this is the
          moment to ask whether the user wants anything different this
          time -- rather than silently reproducing the exact same plugin. */}
      {rebuildModalCardId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setRebuildModalCardId(null);
          }}
        >
          <div
            className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-5 space-y-4"
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Rebuild confirmation"
          >
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">
                Rebuild {cards.find((c) => c.id === rebuildModalCardId)?.plugin?.name ?? "this plugin"}?
              </h2>
              <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                Any changes you'd like made this time? Leave it blank to rebuild exactly as before.
              </p>
            </div>
            <textarea
              autoFocus
              rows={3}
              value={rebuildChangesText}
              onChange={(e) => setRebuildChangesText(e.target.value)}
              placeholder="e.g. make the drive knob more aggressive, add a mix control…"
              className="w-full resize-none bg-neutral-950 border border-neutral-800 focus:border-neutral-600 rounded-lg px-3 py-2 text-xs text-neutral-100 placeholder-neutral-600 outline-none transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  confirmRebuild();
                }
                if (e.key === "Escape") setRebuildModalCardId(null);
              }}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setRebuildModalCardId(null)}
                className="text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmRebuild}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rebuild
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
