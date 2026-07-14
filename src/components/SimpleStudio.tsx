import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Send,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  SlidersHorizontal,
  Volume2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { AudioPlugin, ChatMessage } from "../types";
import Visualizer from "./Visualizer";
import { PluginControl, groupParamsForPlayback } from "./PluginControl";
import GenerativeFaceplate from "./GenerativeFaceplate";
import BuildProgressBar, { BuildStage, BuildVersion } from "./BuildProgressBar";

interface SimpleStudioProps {
  plugin: AudioPlugin;
  chatHistory: ChatMessage[];
  chatLoading: boolean;
  dspError: string | null;
  isPlaying: boolean;
  bypass: boolean;
  sourceType: "synth" | "sine" | "noise";
  analyserNode: AnalyserNode | null;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onClearChat: () => void;
  onTogglePlay: () => void;
  onToggleBypass: () => void;
  onSourceTypeChange: (source: "synth" | "sine" | "noise") => void;
  onSliderChange: (paramId: string, value: number) => void;
  onOpenPro: (tab?: string) => void;
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
  onSliderChange,
  onOpenPro,
  modelPicker,
  refineControl,
  buildStages = [],
  buildVersions = [],
  onJudgeByEar,
  canJudgeByEar = false,
}: SimpleStudioProps) {
  const [input, setInput] = useState("");
  const [dockOpen, setDockOpen] = useState(false);
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
                <div className="text-sm font-medium text-neutral-100 truncate group-hover:text-white">
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
              <GenerativeFaceplate plugin={plugin} analyserNode={analyserNode} isPlaying={isPlaying} className="border-t border-neutral-800 animate-fadeIn">
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
                          {showpiece.map((p) => (
                            <PluginControl key={p.id} param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />
                          ))}
                        </div>
                      )}

                      {visualizers.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {visualizers.map((p) => (
                            <PluginControl key={p.id} param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />
                          ))}
                        </div>
                      )}

                      {pads.length > 0 && (
                        <div className="grid grid-cols-4 gap-2 max-w-xs">
                          {pads.map((p) => (
                            <PluginControl key={p.id} param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />
                          ))}
                        </div>
                      )}

                      {regular.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-3">
                          {regular.map((p) => (
                            <PluginControl key={p.id} param={p} allParams={plugin.parameters} onChange={onSliderChange} analyserNode={analyserNode} isPlaying={isPlaying} />
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

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
