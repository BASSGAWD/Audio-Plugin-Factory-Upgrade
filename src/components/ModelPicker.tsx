import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, Cpu, RefreshCw, Server, Settings2, Zap } from "lucide-react";
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

  // Probe once on mount so the trigger's status dot is honest before the
  // menu is ever opened, and re-probe every time it opens.
  useEffect(() => {
    probeAll(getLLMConfig());
  }, [probeAll]);

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

  const dotFor = (engine: EngineId): { color: string; pulse: boolean } => {
    if (engine === "offline") return { color: "bg-emerald-500", pulse: false };
    if (engine === "gemini") {
      if (hasGeminiKey === null) return { color: "bg-amber-500", pulse: true };
      return hasGeminiKey ? { color: "bg-emerald-500", pulse: false } : { color: "bg-red-500", pulse: false };
    }
    const probe = probes[engine];
    if (probe.checking) return { color: "bg-amber-500", pulse: true };
    return probe.ok ? { color: "bg-emerald-500", pulse: false } : { color: "bg-red-500", pulse: false };
  };

  const statusLineFor = (engine: EngineId): string => {
    if (engine === "offline") return "Instant deterministic builds — runs entirely in your browser.";
    if (engine === "gemini") {
      if (hasGeminiKey === null) return "Checking server key…";
      return hasGeminiKey
        ? "Cloud reasoning via the secure server proxy."
        : "No API key — set GEMINI_API_KEY in .env.local. Builds fall back to the offline compiler.";
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
    cfg.provider === "ollama" ? cfg.ollamaModel : cfg.provider === "lm_studio" ? cfg.lmStudioModel : "";

  const triggerLabel =
    activeEngine === "offline"
      ? "Offline Compiler"
      : activeEngine === "gemini"
      ? "Gemini Cloud"
      : `${activeEngine === "ollama" ? "Ollama" : "LM Studio"} · ${currentModelName}`;

  const triggerDot = dotFor(activeEngine);

  /* ----------------------------- options ---------------------------- */

  const OPTIONS: Array<{ id: EngineId; name: string; icon: React.ElementType }> = [
    { id: "offline", name: "Offline Compiler", icon: Zap },
    { id: "gemini", name: "Gemini Cloud", icon: Cloud },
    { id: "ollama", name: "Ollama (local)", icon: Cpu },
    { id: "lm_studio", name: "LM Studio (local)", icon: Server },
  ];

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
                {value} (not loaded)
              </option>
            )}
            {probe.models.map((m) => (
              <option key={m} value={m}>
                {m}
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

          <div className="space-y-0.5">
            {OPTIONS.map((opt) => {
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
                  <p className="pl-[22px] mt-0.5 text-[10px] leading-snug text-neutral-500">
                    {statusLineFor(opt.id)}
                  </p>
                  {isActive && (opt.id === "ollama" || opt.id === "lm_studio") && renderModelChooser(opt.id)}
                </div>
              );
            })}
          </div>

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
