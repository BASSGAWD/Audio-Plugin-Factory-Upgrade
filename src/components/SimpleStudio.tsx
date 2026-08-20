import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Send,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  SlidersHorizontal,
  LayoutGrid,
  Volume2,
  AlertTriangle,
  Sparkles,
  Crosshair,
  X,
} from "lucide-react";
import { AudioPlugin, ChatMessage, PluginParameter } from "../types";
import type { ElementNote } from "../utils/editPass";
import Visualizer from "./Visualizer";
import { PluginControl, groupParamsForPlayback } from "./PluginControl";
import GenerativeFaceplate from "./GenerativeFaceplate";
import BuildProgressBar, { BuildStage, BuildVersion } from "./BuildProgressBar";
import { resolveCustomSkinStyle } from "../utils/customSkin";

interface SimpleStudioProps {
  plugin: AudioPlugin;
  chatHistory: ChatMessage[];
  chatLoading: boolean;
  dspError: string | null;
  isPlaying: boolean;
  bypass: boolean;
  sourceType: "synth" | "sine" | "noise" | "live_input";
  analyserNode: AnalyserNode | null;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onClearChat: () => void;
  onTogglePlay: () => void;
  onToggleBypass: () => void;
  onSourceTypeChange: (source: "synth" | "sine" | "noise" | "live_input") => void;
  /** Real input devices (only populated, with real labels, after the user has
   *  granted mic/line permission at least once — see App.tsx's
   *  refreshAudioDeviceList). Optional: absent/empty just means "use the
   *  OS default input," which is a perfectly valid choice. */
  audioInputDevices?: MediaDeviceInfo[];
  selectedInputDeviceId?: string | null;
  onSelectInputDevice?: (deviceId: string | null) => void;
  onSliderChange: (paramId: string, value: number) => void;
  onOpenPro: (tab?: string) => void;
  /** Opens the Factory Canvas: the spatial multi-plugin workspace. */
  onOpenCanvas?: () => void;
  /** Rendered ModelPicker from App — keeps engine/config state in one owner. */
  modelPicker?: React.ReactNode;
  /** Rendered RefineControl (perfecting loop toggle + count) from App. */
  refineControl?: React.ReactNode;
  /** Live build checkpoints (real pipeline callbacks) while building. */
  buildStages?: BuildStage[];
  /** Ranked versions from the perfecting loop, for the live leaderboard. */
  buildVersions?: BuildVersion[];
  /** Opens the blind A/B/C listening test (shown when >=2 versions exist). */
  onJudgeByEar?: () => void;
  /** True when >=2 distinct ranked candidates exist — enables the ear test. */
  canJudgeByEar?: boolean;
  /** Annotation canvas: point at a control and pin an improvement note. */
  annotateMode?: boolean;
  onToggleAnnotate?: () => void;
  annotations?: ElementNote[];
  onAddNote?: (paramId: string, paramName: string, note: string) => void;
  onRemoveNote?: (index: number) => void;
  /** Runs one edit pass that applies every pinned note. */
  onApplyNotes?: () => void;
}

const SUGGESTIONS: Array<{ emoji: string; label: string; prompt: string }> = [
  {
    emoji: "🎛️",
    label: "Warm tape delay",
    prompt: "Make a warm tape echo delay with a bit of wobble and a dry/wet mix knob.",
  },
  {
    emoji: "🎤",
    label: "Vocal autotune",
    prompt: "Build a vocal pitch corrector like Auto-Tune with a retune speed knob.",
  },
  {
    emoji: "🎸",
    label: "Crunchy guitar amp",
    prompt: "Create a crunchy vintage guitar amp with drive, tone, and level controls.",
  },
  {
    emoji: "🌊",
    label: "Dreamy reverb",
    prompt: "Make a big dreamy shimmer reverb with size, tone, and mix controls.",
  },
];

/**
 * Lightweight markdown-ish renderer: fenced code blocks, **bold**,
 * `inline code`, and "- " bullet lines. Keeps assistant replies readable
 * without pulling in a markdown dependency.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on **bold** and `code` spans
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-neutral-100">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="px-1 py-0.5 rounded bg-neutral-800 text-orange-300 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(part);
    }
  });
  return nodes;
}

function MessageBody({ text }: { text: string }) {
  const segments = text.split(/```(?:\w+)?\n?/);
  return (
    <div className="space-y-2">
      {segments.map((segment, idx) => {
        if (idx % 2 === 1) {
          // Code fence contents
          return (
            <pre
              key={idx}
              className="bg-neutral-950 border border-neutral-850 rounded-lg p-3 overflow-x-auto text-[11px] font-mono text-neutral-300 leading-relaxed"
            >
              {segment.replace(/\n$/, "")}
            </pre>
          );
        }
        const lines = segment.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length === 0) return null;
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, li) => {
              const trimmed = line.trim();
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div key={li} className="flex gap-2 pl-1">
                    <span className="text-orange-500 shrink-0 leading-relaxed">•</span>
                    <p className="leading-relaxed">{renderInline(trimmed.slice(2), `${idx}-${li}`)}</p>
                  </div>
                );
              }
              if (trimmed.startsWith("#")) {
                return (
                  <p key={li} className="font-semibold text-neutral-100 leading-relaxed">
                    {renderInline(trimmed.replace(/^#+\s*/, ""), `${idx}-${li}`)}
                  </p>
                );
              }
              if (trimmed === "---") {
                return <hr key={li} className="border-neutral-850 my-1" />;
              }
              return (
                <p key={li} className="leading-relaxed">
                  {renderInline(trimmed, `${idx}-${li}`)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function SimpleStudio({
  plugin,
  chatHistory,
  chatLoading,
  dspError,
  isPlaying,
  bypass,
  sourceType,
  analyserNode,
  onSend,
  onStop,
  onClearChat,
  onTogglePlay,
  onToggleBypass,
  onSourceTypeChange,
  audioInputDevices = [],
  selectedInputDeviceId = null,
  onSelectInputDevice,
  onSliderChange,
  onOpenPro,
  onOpenCanvas,
  modelPicker,
  refineControl,
  buildStages = [],
  buildVersions = [],
  onJudgeByEar,
  canJudgeByEar = false,
  annotateMode = false,
  onToggleAnnotate,
  annotations = [],
  onAddNote,
  onRemoveNote,
  onApplyNotes,
}: SimpleStudioProps) {
  const [input, setInput] = useState("");
  const [dockOpen, setDockOpen] = useState(false);
  // This plugin's actual configured skin -- resolved once so the card
  // header font and the faceplate's divider border read from the same
  // numbers as the faceplate itself, instead of each recomputing it.
  const resolvedSkin = useMemo(() => resolveCustomSkinStyle(plugin.customSkin), [plugin.customSkin]);
  // Annotation canvas: the control currently being annotated + draft text.
  const [noteTarget, setNoteTarget] = useState<{ id: string; name: string } | null>(null);
  const [noteText, setNoteText] = useState("");

  // Render-function wrapper (NOT a nested component — a new component
  // identity per render would remount the controls and break knob drags).
  // In annotate mode every control gets a crosshair overlay: clicking it
  // targets the note editor instead of turning the knob.
  const wrapAnnotatable = (p: PluginParameter, node: React.ReactNode) => {
    if (!annotateMode) return <React.Fragment key={p.id}>{node}</React.Fragment>;
    const count = annotations.filter((a) => a.paramId === p.id).length;
    return (
      <div key={p.id} className="relative">
        {node}
        <button
          type="button"
          onClick={() => {
            setNoteTarget({ id: p.id, name: p.name });
            setNoteText("");
          }}
          aria-label={`Add an improvement note on ${p.name}`}
          className={`absolute inset-0 z-10 rounded-lg border-2 border-dashed transition-colors cursor-crosshair ${
            noteTarget?.id === p.id
              ? "border-orange-400 bg-orange-500/25"
              : "border-orange-600/50 bg-orange-500/5 hover:bg-orange-500/15"
          }`}
        >
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-orange-600 text-white text-[10px] font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </button>
      </div>
    );
  };
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const hasMessages = chatHistory.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  // Auto-open the plugin dock when a build lands mid-conversation
  const lastPluginIdRef = useRef(plugin.id);
  useEffect(() => {
    if (plugin.id !== lastPluginIdRef.current) {
      lastPluginIdRef.current = plugin.id;
      if (hasMessages) setDockOpen(true);
    }
  }, [plugin.id, hasMessages]);

  const submit = () => {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const downloadPluginFiles = () => {
    const md = [
      `# ${plugin.name}`,
      "",
      plugin.description,
      "",
      "## Parameters",
      ...plugin.parameters.map(
        (p) => `- ${p.name} (\`${p.id}\`): ${p.min} to ${p.max} ${p.unit}, default ${p.defaultValue}`
      ),
      "",
      "## JavaScript DSP (Web Audio)",
      "```javascript",
      plugin.dspFunction,
      "```",
      "",
      "## Faust",
      "```faust",
      plugin.faustCode || "// not generated",
      "```",
      "",
      "## C++ (JUCE)",
      "```cpp",
      plugin.cppJuceCode || "// not generated",
      "```",
      "",
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${plugin.name.replace(/[^a-zA-Z0-9]+/g, "_") || "plugin"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const composer = (
    <div className="w-full max-w-2xl mx-auto">
      <div className="relative flex items-end gap-2 bg-neutral-900 border border-neutral-800 focus-within:border-neutral-600 rounded-3xl px-4 py-3 shadow-lg shadow-black/30 transition-colors">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe the sound you want…"
          aria-label="Describe the sound you want"
          className="flex-1 resize-none bg-transparent outline-none text-sm text-neutral-100 placeholder-neutral-500 leading-relaxed max-h-40 scrollbar-thin"
          disabled={chatLoading}
        />
        {chatLoading ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 w-9 h-9 rounded-full bg-neutral-700 hover:bg-neutral-600 text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Stop generating"
            aria-label="Stop generating"
          >
            <span className="w-3 h-3 bg-white rounded-[3px]" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!input.trim()}
            className="shrink-0 w-9 h-9 rounded-full bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Send"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-center text-[10px] text-neutral-600 mt-2 select-none">
        Builds run instantly in your browser — press play to hear them. Enter to send, Shift+Enter for a new line.
      </p>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-200 font-sans antialiased selection:bg-orange-900/50 selection:text-white">
      {/* Minimal header */}
      <header className="shrink-0 h-14 px-4 flex items-center justify-between border-b border-neutral-900">
        <div className="flex items-center gap-2 select-none">
          <div className="w-7 h-7 rounded-lg bg-orange-600 flex items-center justify-center shadow-md shadow-orange-950/50">
            <Volume2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-sm text-neutral-100 tracking-tight">OrangeJuce</span>
          <span className="text-[10px] text-neutral-500 hidden sm:inline">— describe a sound, get a plugin</span>
        </div>
        <div className="flex items-center gap-2">
          {hasMessages && (
            <button
              onClick={onClearChat}
              className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg hover:bg-neutral-900 transition-colors cursor-pointer"
              title="Start a new conversation"
            >
              <Plus className="w-3.5 h-3.5" />
              New chat
            </button>
          )}
          {refineControl}
          {modelPicker}
          {onOpenCanvas && (
            <button
              onClick={onOpenCanvas}
              className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 transition-colors cursor-pointer"
              title="Open the Factory Canvas: build many plugins side by side on an infinite canvas"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Canvas
            </button>
          )}
          <button
            onClick={() => onOpenPro()}
            className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 transition-colors cursor-pointer"
            title="Open the full workspace: code editor, analyzers, VST3 export"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Pro mode
          </button>
        </div>
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {!hasMessages ? (
          <div className="h-full flex flex-col items-center justify-center px-4 pb-24">
            <div className="w-full max-w-2xl mx-auto text-center space-y-8 animate-fadeIn">
              <div className="space-y-3">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-orange-600 flex items-center justify-center shadow-lg shadow-orange-950/40">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-semibold text-neutral-100 tracking-tight">
                  What do you want to hear?
                </h1>
                <p className="text-sm text-neutral-500 max-w-md mx-auto leading-relaxed">
                  Describe an audio effect in plain words. It gets built, loaded, and ready to
                  play in seconds — no settings needed.
                </p>
              </div>

              {composer}

              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => onSend(s.prompt)}
                    disabled={chatLoading}
                    className="flex items-center gap-2 text-xs text-neutral-300 hover:text-white bg-neutral-900/70 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-3.5 py-2 rounded-full transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full px-4 py-6 space-y-6">
            {chatHistory.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] bg-neutral-800 text-neutral-100 text-sm rounded-3xl rounded-br-lg px-4 py-2.5 leading-relaxed whitespace-pre-wrap">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center mt-0.5">
                    <Volume2 className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-neutral-300">
                    <MessageBody text={msg.text} />
                  </div>
                </div>
              )
            )}

            {chatLoading && (
              <div className="flex gap-3 animate-fadeIn">
                <div className="shrink-0 w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center mt-0.5 animate-pulse">
                  <Volume2 className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-neutral-400">
                    <span>Designing your plugin</span>
                    <span className="flex gap-1">
                      <span className="w-1 h-1 rounded-full bg-neutral-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 rounded-full bg-neutral-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 rounded-full bg-neutral-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                  {(buildStages.length > 0 || buildVersions.length > 0) && (
                    <BuildProgressBar
                      stages={buildStages}
                      versions={buildVersions}
                      onJudge={canJudgeByEar ? onJudgeByEar : undefined}
                    />
                  )}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Current plugin dock + composer (hidden composer duplication on empty state) */}
      {hasMessages && (
        <div className="shrink-0 px-4 pb-4 pt-2 space-y-3 bg-gradient-to-t from-neutral-950 via-neutral-950 to-transparent">
          {/* Plugin card */}
          <div className="w-full max-w-2xl mx-auto bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden backdrop-blur-sm">
            {/* Card header row — always visible */}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <button
                onClick={onTogglePlay}
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isPlaying
                    ? "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-950/50"
                    : "bg-neutral-100 hover:bg-white text-neutral-950"
                }`}
                title={isPlaying ? "Stop audio" : "Play — hear this plugin on a demo melody"}
                aria-label={isPlaying ? "Stop audio" : "Play audio preview"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                onClick={() => setDockOpen((v) => !v)}
                className="flex-1 min-w-0 text-left cursor-pointer group"
                aria-expanded={dockOpen}
                aria-label="Toggle plugin controls"
              >
                <div
                  className="text-sm font-medium text-neutral-100 truncate group-hover:text-white"
                  style={{ fontFamily: resolvedSkin.fontFamily }}
                >
                  {plugin.name}
                </div>
                <div className="text-[11px] text-neutral-500 truncate">
                  {dspError ? (
                    <span className="text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {dspError}
                    </span>
                  ) : (
                    `${plugin.parameters.length} controls · tap to ${dockOpen ? "hide" : "tweak"}`
                  )}
                </div>
              </button>
              {onToggleAnnotate && (
                <button
                  onClick={() => {
                    if (!dockOpen && !annotateMode) setDockOpen(true);
                    onToggleAnnotate();
                  }}
                  className={`relative shrink-0 p-2 rounded-lg transition-colors cursor-pointer ${
                    annotateMode
                      ? "text-orange-300 bg-orange-600/20 hover:bg-orange-600/30"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                  }`}
                  title="Annotate: point at controls and pin improvement notes"
                  aria-label="Toggle annotate mode"
                  aria-pressed={annotateMode}
                >
                  <Crosshair className="w-4 h-4" />
                  {annotations.length > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 rounded-full bg-orange-600 text-white text-[9px] font-bold flex items-center justify-center">
                      {annotations.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={downloadPluginFiles}
                className="shrink-0 p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Download the plugin code (JS, Faust, C++)"
                aria-label="Download plugin code"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDockOpen((v) => !v)}
                className="shrink-0 p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                title={dockOpen ? "Hide controls" : "Show controls"}
                aria-label={dockOpen ? "Hide controls" : "Show controls"}
              >
                {dockOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>

            {/* Expanded controls on the plugin's generative faceplate */}
            {dockOpen && (
              <GenerativeFaceplate
                plugin={plugin}
                analyserNode={analyserNode}
                isPlaying={isPlaying}
                className="border-t animate-fadeIn"
                style={{ borderTopColor: resolvedSkin.borderColor, borderTopWidth: resolvedSkin.borderWidth }}
              >
              <div className="px-4 py-3 space-y-3">
                {isPlaying && (
                  <div className="h-16 rounded-lg overflow-hidden border border-neutral-850">
                    <Visualizer analyserNode={analyserNode} isPlaying={isPlaying} />
                  </div>
                )}

                {(() => {
                  const { showpiece, visualizers, pads, regular } = groupParamsForPlayback(plugin);
                  return (
                    <>
                      {showpiece.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {showpiece.map((p) =>
                            wrapAnnotatable(p, <PluginControl param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />)
                          )}
                        </div>
                      )}

                      {visualizers.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {visualizers.map((p) =>
                            wrapAnnotatable(p, <PluginControl param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />)
                          )}
                        </div>
                      )}

                      {pads.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 max-w-xs">
                          {pads.map((p) =>
                            wrapAnnotatable(p, <PluginControl param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />)
                          )}
                        </div>
                      )}

                      {regular.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-3">
                          {regular.map((p) =>
                            wrapAnnotatable(p, <PluginControl param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />)
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}

                {annotateMode && !noteTarget && (
                  <p className="text-[11px] text-orange-300/90 px-1">
                    🎯 Annotate mode — click any control above and tell me what to improve about it.
                  </p>
                )}

                {annotateMode && noteTarget && (
                  <div className="rounded-lg border border-orange-800/60 bg-neutral-900/80 p-3 space-y-2 animate-fadeIn">
                    <div className="text-[11px] font-semibold text-orange-300">Note for {noteTarget.name}</div>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder='e.g. "too subtle — more aggressive", "wider range", "rename to Space"'
                      aria-label={`Improvement note for ${noteTarget.name}`}
                      className="w-full text-xs bg-neutral-950 border border-neutral-800 rounded-md p-2 text-neutral-200 outline-none focus:border-orange-700 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (!noteText.trim()) return;
                          onAddNote?.(noteTarget.id, noteTarget.name, noteText.trim());
                          setNoteTarget(null);
                          setNoteText("");
                        }}
                        disabled={!noteText.trim()}
                        className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                          noteText.trim()
                            ? "bg-orange-600 hover:bg-orange-500 text-white cursor-pointer"
                            : "bg-neutral-850 text-neutral-600 cursor-not-allowed"
                        }`}
                      >
                        Pin note
                      </button>
                      <button
                        onClick={() => {
                          setNoteTarget(null);
                          setNoteText("");
                        }}
                        className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-neutral-800 hover:bg-neutral-750 text-neutral-300 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {annotations.length > 0 && (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 space-y-1.5" aria-label="Pinned improvement notes">
                    <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold px-1">
                      Improvement notes
                    </div>
                    {annotations.map((a, i) => (
                      <div key={`${a.paramId}-${i}`} className="flex items-center gap-2 text-[11px] bg-neutral-950/60 rounded-md px-2 py-1">
                        <span className="font-semibold text-orange-300 shrink-0">{a.paramName}</span>
                        <span className="flex-1 text-neutral-300 truncate">{a.note}</span>
                        <button
                          onClick={() => onRemoveNote?.(i)}
                          aria-label={`Remove note on ${a.paramName}`}
                          className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={onApplyNotes}
                      disabled={chatLoading}
                      className={`w-full mt-1 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                        chatLoading ? "bg-neutral-850 text-neutral-600 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-500 text-white cursor-pointer"
                      }`}
                    >
                      Apply {annotations.length} note{annotations.length === 1 ? "" : "s"} →
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-neutral-850">
                  <span className="text-[10px] text-neutral-500 font-medium">Test sound:</span>
                  {(["synth", "sine", "noise"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => onSourceTypeChange(s)}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer capitalize ${
                        sourceType === s
                          ? "bg-orange-600/20 border-orange-700 text-orange-300"
                          : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {s === "synth" ? "Melody" : s === "sine" ? "Tone" : "Noise"}
                    </button>
                  ))}
                  <button
                    onClick={() => onSourceTypeChange("live_input")}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                      sourceType === "live_input"
                        ? "bg-orange-600/20 border-orange-700 text-orange-300"
                        : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200"
                    }`}
                    title="Play a real instrument/mic through your audio interface, instead of a built-in test tone"
                  >
                    🎤 Live In
                  </button>
                  {sourceType === "live_input" && audioInputDevices.length > 1 && (
                    <select
                      value={selectedInputDeviceId ?? ""}
                      onChange={(e) => onSelectInputDevice?.(e.target.value || null)}
                      className="text-[10px] bg-neutral-900 border border-neutral-800 text-neutral-300 rounded-full px-2 py-1 outline-none cursor-pointer"
                      title="Which input device to capture from"
                    >
                      <option value="">System default</option>
                      {audioInputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={onToggleBypass}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                      bypass
                        ? "bg-amber-600/20 border-amber-700 text-amber-300"
                        : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200"
                    }`}
                    title="Compare with and without the effect"
                  >
                    {bypass ? "Effect off (bypassed)" : "Effect on"}
                  </button>
                  <button
                    onClick={() => onOpenPro("export")}
                    className="ml-auto text-[10px] px-2.5 py-1 rounded-full border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                    title="Open the full exporter: VST3 project, installers, WebAssembly"
                  >
                    Export as VST3 →
                  </button>
                </div>
              </div>
              </GenerativeFaceplate>
            )}
          </div>

          {composer}
        </div>
      )}
    </div>
  );
}
