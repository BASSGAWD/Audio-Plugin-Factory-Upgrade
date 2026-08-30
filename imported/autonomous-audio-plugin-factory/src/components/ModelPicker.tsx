import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, Cpu, GitMerge, RefreshCw, Server, Settings2, Zap } from "lucide-react";
import {
  LLMConfig,
  LLMProvider,
  getLLMConfig,
  saveLLMConfig,
  testProviderConnection,
} from "../utils/llmGateway";

/**
 * The one model picker: a dropdown that unifies engine selection (Offline
 * Compiler / Gemini Cloud / Ollama / LM Studio), live connection status, and
 * per-provider model choice. Used in both the Pro header and Simple Mode --
 * it replaces the old scattered controls (status-only pills, a hidden
 * ONLINE/OFFLINE toggle in the chat tab).
 *
 * Config reads/writes go straight to the shared llmGateway localStorage
 * config, so every generation path picks the change up on its next call.
 */

export type EngineId = "offline" | LLMProvider;

/**
 * Raw Ollama/LM Studio model tags are internal identifiers, not names meant
 * for a user to read ("orangey", "qwen2.5-coder:14b"). This app's own
 * fine-tune deserves to be visible as a real product name, not a backend
 * string, so it doesn't just look like a silent swap in Settings -- see
 * local-model/README.md for what "orangey" actually is.
 */
function prettyModelName(rawModel: string): string {
  return rawModel === "orangey" ? "Orangey 1.0" : rawModel;
}

interface LocalProbe {
  checking: boolean;
  ok: boolean;
  models: string[];
  message: string;
}

const IDLE_PROBE: LocalProbe = { checking: false, ok: false, models: [], message: "Not checked yet" };

interface ModelPickerProps {
  /** null while the /api/health check is still in flight. */
  hasGeminiKey: boolean | null;
  /** Server-reported credential availability; never infer this from a model name. */
  remoteProviderHealth?: Partial<Record<"gemini" | "openai" | "anthropic" | "online_free", boolean>> | null;
  offlineForced: boolean;
  /** Called when the user picks an engine; App owns the offlineForced state. */
  onEngineChange: (change: { offlineForced: boolean; engine: EngineId }) => void;
  /** Called after any config write so the host can refresh dependent labels. */
  onConfigChange?: () => void;
  /** Open the full LLM Gateway settings (Models & Memory tab). */
  onOpenAdvanced?: () => void;
  /** "pro" = compact mono pill (dense header), "simple" = friendly button. */
  variant?: "pro" | "simple";
}

export default function ModelPicker({
  hasGeminiKey,
  remoteProviderHealth,
  offlineForced,
  onEngineChange,
  onConfigChange,
  onOpenAdvanced,
  variant = "pro",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<LLMConfig>(() => getLLMConfig());
  const [probes, setProbes] = useState<Record<"ollama" | "lm_studio", LocalProbe>>({
    ollama: IDLE_PROBE,
    lm_studio: IDLE_PROBE,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const activeEngine: EngineId = offlineForced ? "offline" : cfg.provider;

  const probeProvider = useCallback(async (provider: "ollama" | "lm_studio", config: LLMConfig) => {
    setProbes((prev) => ({ ...prev, [provider]: { ...prev[provider], checking: true } }));
    const result = await testProviderConnection(provider, config);
    setProbes((prev) => ({
      ...prev,
      [provider]: { checking: false, ok: result.ok, models: result.models, message: result.message },
    }));
  }, []);

  const probeAll = useCallback(
    (config: LLMConfig) => {
      probeProvider("ollama", config);
      probeProvider("lm_studio", config);
    },
    [probeProvider]
  );

  // Local model servers are optional. Probe only when the user opens the
  // picker instead of issuing localhost requests during every offline preview.
  useEffect(() => {
    if (!open) return;
    const fresh = getLLMConfig();
    setCfg(fresh);
    probeAll(fresh);

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, probeAll]);

  const persist = (next: LLMConfig) => {
    setCfg(next);
    saveLLMConfig(next);
    onConfigChange?.();
  };

  const selectEngine = (engine: EngineId) => {
    if (engine === "offline") {
      onEngineChange({ offlineForced: true, engine });
    } else {
      if (cfg.provider !== engine) persist({ ...cfg, provider: engine });
      onEngineChange({ offlineForced: false, engine });
    }
    setOpen(false);
  };

  const setModel = (provider: "ollama" | "lm_studio", model: string) => {
    persist(provider === "ollama" ? { ...cfg, ollamaModel: model } : { ...cfg, lmStudioModel: model });
  };

  /* ----------------------------- status ----------------------------- */

  // A fusion is "recognized" when every member backend answers with a loaded
  // model — derived live from the same probes that drive the status dots.
  const fusionReady =
    probes.ollama.ok && probes.ollama.models.length > 0 && probes.lm_studio.ok && probes.lm_studio.models.length > 0;
  const fusionChecking = probes.ollama.checking || probes.lm_studio.checking;

  const dotFor = (engine: EngineId): { color: string; pulse: boolean } => {
    if (engine === "offline") return { color: "bg-emerald-500", pulse: false };
    if (engine === "gemini" || engine === "openai" || engine === "anthropic" || engine === "online_free") {
      const available = engine === "gemini" ? (remoteProviderHealth?.gemini ?? hasGeminiKey) : remoteProviderHealth?.[engine];
      if (available === null || available === undefined) return { color: "bg-amber-500", pulse: true };
      return available ? { color: "bg-emerald-500", pulse: false } : { color: "bg-red-500", pulse: false };
    }
    if (engine === "fusion") {
      if (fusionChecking) return { color: "bg-amber-500", pulse: true };
      return fusionReady ? { color: "bg-emerald-500", pulse: false } : { color: "bg-red-500", pulse: false };
    }
    const probe = probes[engine];
    if (probe.checking) return { color: "bg-amber-500", pulse: true };
    return probe.ok ? { color: "bg-emerald-500", pulse: false } : { color: "bg-red-500", pulse: false };
  };

  const statusLineFor = (engine: EngineId): string => {
    if (engine === "offline") return "Instant deterministic builds — runs entirely in your browser.";
    if (engine === "gemini" || engine === "openai" || engine === "anthropic" || engine === "online_free") {
      const available = engine === "gemini" ? (remoteProviderHealth?.gemini ?? hasGeminiKey) : remoteProviderHealth?.[engine];
      const name = engine === "gemini" ? "Gemini" : engine === "openai" ? "OpenAI" : engine === "anthropic" ? "Anthropic" : "Online Free";
      if (available === null || available === undefined) return `Server health has not checked ${name} yet.`;
      return available
        ? engine === "online_free"
          ? `Rotates strictly free cloud models through the secure gateway; falls back to the offline compiler when exhausted.`
          : `${name} is configured on the server; requests use the secure gateway.`
        : `${name} is not configured on this server. Select a local engine or ask an administrator to add its API key.`;
    }
    if (engine === "fusion") {
      if (fusionChecking) return "Checking both engines…";
      if (fusionReady)
        return `Recognized: Ollama (${prettyModelName(cfg.ollamaModel)}) + LM Studio (${cfg.lmStudioModel}) can work together — every request races both (fastest valid answer wins), and perfecting-loop reworks alternate between the models with the quality gate as judge.`;
      const missing: string[] = [];
      if (!(probes.ollama.ok && probes.ollama.models.length > 0)) missing.push("Ollama needs a running server with a model pulled");
      if (!(probes.lm_studio.ok && probes.lm_studio.models.length > 0)) missing.push("LM Studio needs its server started with a chat model loaded");
      return `Not available yet — ${missing.join("; ")}.`;
    }
    const probe = probes[engine];
    if (probe.checking) return "Checking connection…";
    if (probe.ok) {
      const host = engine === "ollama" ? cfg.ollamaUrl : cfg.lmStudioUrl;
      return `Connected — ${probe.models.length || "no"} model(s) at ${host.replace(/^https?:\/\//, "")}`;
    }
    return engine === "ollama"
      ? "Not reachable — is `ollama serve` running?"
      : "Not reachable — is the LM Studio server started?";
  };

  const currentModelName =
    cfg.provider === "ollama" ? cfg.ollamaModel : cfg.provider === "lm_studio" ? cfg.lmStudioModel : cfg.provider === "openai" ? (cfg.openaiModel || "gpt-5-nano") : cfg.provider === "anthropic" ? (cfg.anthropicModel || "claude-haiku-4-5") : "";

  const triggerLabel =
    activeEngine === "offline"
      ? "Offline Compiler"
      : activeEngine === "gemini"
      ? "Gemini Cloud"
      : activeEngine === "openai"
      ? `OpenAI · ${cfg.openaiModel || "gpt-5-nano"}`
      : activeEngine === "anthropic"
      ? `Claude · ${cfg.anthropicModel || "claude-haiku-4-5"}`
      : activeEngine === "online_free"
      ? `Online Free · ${cfg.onlineFreeActiveModel || "Auto"}`
      : activeEngine === "fusion"
      ? "Fusion · Ollama + LM Studio"
      : `${activeEngine === "ollama" ? "Ollama" : "LM Studio"} · ${prettyModelName(currentModelName)}`;

  const triggerDot = dotFor(activeEngine);

  /* ----------------------------- options ---------------------------- */

  const OPTIONS: Array<{ id: EngineId; name: string; icon: React.ElementType }> = [
    { id: "offline", name: "Offline Compiler", icon: Zap },
    { id: "gemini", name: "Gemini Cloud", icon: Cloud },
    { id: "online_free", name: "Online Free (rotating)", icon: Cloud },
    { id: "openai", name: "OpenAI GPT", icon: Cloud },
    { id: "anthropic", name: "Anthropic Claude", icon: Cloud },
    { id: "ollama", name: "Ollama (local)", icon: Cpu },
    { id: "lm_studio", name: "LM Studio (local)", icon: Server },
  ];

  // Recognized multi-model combinations. One combo exists today (the two
  // local backends); the list is data-driven so future members slot in.
  const FUSIONS: Array<{ id: EngineId; name: string; icon: React.ElementType }> = [
    { id: "fusion", name: "Ollama + LM Studio", icon: GitMerge },
  ];

  const renderEngineRow = (opt: { id: EngineId; name: string; icon: React.ElementType }) => {
    const isActive = activeEngine === opt.id;
    const dot = dotFor(opt.id);
    const Icon = opt.icon;
    return (
      <div
        key={opt.id}
        role="menuitemradio"
        aria-checked={isActive}
        tabIndex={0}
        onClick={() => selectEngine(opt.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectEngine(opt.id);
          }
        }}
        className={`rounded-lg px-2.5 py-2 cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-orange-700 ${
          isActive ? "bg-neutral-800/80" : "hover:bg-neutral-850/60"
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`shrink-0 w-3.5 h-3.5 ${isActive ? "text-orange-400" : "text-neutral-500"}`} />
          <span className={`flex-1 text-xs font-semibold ${isActive ? "text-neutral-100" : "text-neutral-300"}`}>
            {opt.name}
          </span>
          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot.color} ${dot.pulse ? "animate-pulse" : ""}`} />
          {isActive && <Check className="shrink-0 w-3.5 h-3.5 text-orange-400" />}
        </div>
        <p className="pl-[22px] mt-0.5 text-[10px] leading-snug text-neutral-500">{statusLineFor(opt.id)}</p>
        {isActive && (opt.id === "ollama" || opt.id === "lm_studio") && renderModelChooser(opt.id)}
        {isActive && (opt.id === "openai" || opt.id === "anthropic") && renderRemoteModelChooser(opt.id)}
        {isActive && opt.id === "fusion" && (
          <div className="space-y-1">
            {renderModelChooser("ollama")}
            {renderModelChooser("lm_studio")}
          </div>
        )}
      </div>
    );
  };

  const renderModelChooser = (provider: "ollama" | "lm_studio") => {
    const probe = probes[provider];
    const value = provider === "ollama" ? cfg.ollamaModel : cfg.lmStudioModel;
    const listId = `model-options-${provider}`;
    return (
      <div className="mt-1.5 pl-7 pr-1" onClick={(e) => e.stopPropagation()}>
        <label className="block text-[8px] font-mono font-bold uppercase tracking-wider text-neutral-500 mb-1">
          Model
        </label>
        {probe.ok && probe.models.length > 0 ? (
          <select
            value={probe.models.includes(value) ? value : ""}
            onChange={(e) => e.target.value && setModel(provider, e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 focus:border-orange-700 outline-none rounded-lg px-2 py-1.5 text-[11px] text-neutral-200 cursor-pointer transition-colors"
            aria-label={`${provider === "ollama" ? "Ollama" : "LM Studio"} model`}
          >
            {!probe.models.includes(value) && (
              <option value="" disabled>
                {prettyModelName(value)} (not loaded)
              </option>
            )}
            {probe.models.map((m) => (
              <option key={m} value={m}>
                {prettyModelName(m)}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setModel(provider, e.target.value)}
            placeholder={provider === "ollama" ? "e.g. qwen2.5-coder:14b" : "e.g. qwen/qwen3-14b"}
            list={listId}
            className="w-full bg-neutral-950 border border-neutral-800 focus:border-orange-700 outline-none rounded-lg px-2 py-1.5 text-[11px] text-neutral-200 placeholder-neutral-600 transition-colors"
            aria-label={`${provider === "ollama" ? "Ollama" : "LM Studio"} model name`}
          />
        )}
      </div>
    );
  };

  const renderRemoteModelChooser = (provider: "openai" | "anthropic") => {
    const value = provider === "openai" ? (cfg.openaiModel || "gpt-5-nano") : (cfg.anthropicModel || "claude-haiku-4-5");
    const choices = provider === "openai"
      ? ["gpt-5-nano", "gpt-5.6-luna", "gpt-5.6-terra"]
      : ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"];
    return (
      <div className="mt-1.5 pl-7 pr-1" onClick={(e) => e.stopPropagation()}>
        <label className="block text-[8px] font-mono font-bold uppercase tracking-wider text-neutral-500 mb-1">Model</label>
        <select
          value={value}
          onChange={(e) => persist(provider === "openai" ? { ...cfg, openaiModel: e.target.value } : { ...cfg, anthropicModel: e.target.value })}
          className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 focus:border-orange-700 outline-none rounded-lg px-2 py-1.5 text-[11px] text-neutral-200 cursor-pointer"
          aria-label={`${provider === "openai" ? "OpenAI" : "Anthropic"} model`}
        >
          {choices.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose which AI engine builds your plugins"
        className={
          variant === "pro"
            ? "flex items-center gap-1.5 bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700 px-2.5 py-1 rounded-full select-none cursor-pointer transition-colors max-w-[260px]"
            : "flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900 transition-colors cursor-pointer select-none max-w-[240px]"
        }
      >
        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${triggerDot.color} ${triggerDot.pulse ? "animate-pulse" : ""}`} />
        <span
          className={
            variant === "pro"
              ? "text-[8px] font-mono font-bold tracking-wider text-neutral-400 truncate"
              : "truncate"
          }
        >
          {variant === "pro" ? triggerLabel.toUpperCase() : triggerLabel}
        </span>
        <ChevronDown
          className={`shrink-0 ${variant === "pro" ? "w-2.5 h-2.5" : "w-3.5 h-3.5"} text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="AI engine"
          className="absolute right-0 top-full mt-2 w-80 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl shadow-black/60 z-50 p-1.5 animate-fadeIn"
        >
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
            <span className="text-[8px] font-mono font-black uppercase tracking-widest text-neutral-500">
              AI Engine
            </span>
            <button
              type="button"
              onClick={() => probeAll(cfg)}
              className="flex items-center gap-1 text-[9px] font-semibold text-neutral-500 hover:text-neutral-200 transition-colors cursor-pointer"
              title="Re-check local server connections"
            >
              <RefreshCw className={`w-2.5 h-2.5 ${probes.ollama.checking || probes.lm_studio.checking ? "animate-spin" : ""}`} />
              Re-check
            </button>
          </div>

          <div className="space-y-0.5">{OPTIONS.map(renderEngineRow)}</div>

          <div className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5">
            <span className="text-[8px] font-mono font-black uppercase tracking-widest text-neutral-500">
              Fusions
            </span>
            <span
              className={`text-[8px] font-mono px-1.5 py-px rounded ${
                fusionReady
                  ? "text-emerald-300 bg-emerald-950/60"
                  : "text-neutral-500 bg-neutral-850/80"
              }`}
            >
              {fusionChecking ? "checking…" : fusionReady ? "1 recognized" : "none available"}
            </span>
          </div>
          <div className="space-y-0.5">{FUSIONS.map(renderEngineRow)}</div>

          {onOpenAdvanced && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenAdvanced();
              }}
              className="w-full mt-1.5 flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold text-neutral-500 hover:text-neutral-200 hover:bg-neutral-850/60 transition-colors cursor-pointer border-t border-neutral-850"
            >
              <Settings2 className="w-3 h-3" />
              Advanced settings — server URLs, VRAM &amp; prompt tuning
            </button>
          )}
        </div>
      )}
    </div>
  );
}
