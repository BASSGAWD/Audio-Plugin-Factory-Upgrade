import React, { useEffect, useRef, useState } from "react";
import { Cpu, Play, FolderOpen, PackagePlus, CheckCircle2, XCircle, AlertTriangle, Loader2, Info } from "lucide-react";
import { AudioPlugin } from "../types";
import { getLLMConfig, isLocalProvider, memberConfig, testProviderConnection } from "../utils/llmGateway";
import JobTimer from "./JobTimer";

interface NativeBuildPanelProps {
  plugin: AudioPlugin;
  triggerToast: (msg: string) => void;
}

type Stage = "idle" | "scaffolding" | "building" | "success" | "failed";

export default function NativeBuildPanel({ plugin, triggerToast }: NativeBuildPanelProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [log, setLog] = useState("");
  const [vst3Path, setVst3Path] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const pollRef = useRef<any>(null);

  const llmConfig = getLLMConfig();
  const localReady = isLocalProvider(llmConfig);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollBuild = (buildId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/native/build/${buildId}`);
        if (!res.ok) throw new Error(`Build status check failed (${res.status})`);
        const data = await res.json();
        setLog(data.log || "");
        if (data.status !== "running") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setVst3Path(data.vst3Path || null);
          setStage(data.status === "success" ? "success" : "failed");
          triggerToast(
            data.status === "success"
              ? "Native build succeeded! Real .vst3 written to disk."
              : "Native build failed -- see the log below for the real compiler error."
          );
        }
      } catch (err: any) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setErrorMsg(err.message);
        setStage("failed");
      }
    }, 1500);
  };

  const handleBuild = async () => {
    setStage("scaffolding");
    setLog("");
    setVst3Path(null);
    setErrorMsg(null);
    setWarning(null);

    try {
      // The native pipeline drives ONE concrete backend for the C++
      // translation and compile-repair loop. Fusion resolves to whichever
      // member is actually reachable right now (Ollama preferred).
      let buildConfig = llmConfig;
      if (llmConfig.provider === "fusion") {
        const [ollama, lmStudio] = await Promise.all([
          testProviderConnection("ollama", llmConfig),
          testProviderConnection("lm_studio", llmConfig),
        ]);
        const member = ollama.ok && ollama.models.length > 0 ? "ollama" : lmStudio.ok ? "lm_studio" : "ollama";
        buildConfig = memberConfig(llmConfig, member);
      }

      const scaffoldRes = await fetch("/api/native/scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugin: {
            name: plugin.name,
            category: plugin.category,
            attributes: plugin.buildReport?.attributes,
            parameters: plugin.parameters,
            dspFunction: plugin.dspFunction,
            customSkin: plugin.customSkin,
          },
          llmConfig: buildConfig,
        }),
      });

      const scaffoldData = await scaffoldRes.json();
      if (!scaffoldRes.ok) throw new Error(scaffoldData.error || "Scaffold failed.");
      if (scaffoldData.warning) {
        setWarning(scaffoldData.warning);
        triggerToast(scaffoldData.warning);
      }

      setStage("building");
      const buildRes = await fetch("/api/native/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // llmConfig enables the compile -> analyze -> fix -> recompile loop:
        // real compiler errors go back to the local model between passes.
        body: JSON.stringify({ projectDir: scaffoldData.projectDir, llmConfig: buildConfig }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || "Failed to start build.");

      setLog("Project scaffolded. cmake configure + build starting -- first run also fetches JUCE from GitHub and compiles it, so this can take 5-15+ minutes.\n");
      pollBuild(buildData.buildId);
    } catch (err: any) {
      setErrorMsg(err.message);
      setStage("failed");
    }
  };

  const handleReveal = async () => {
    if (!vst3Path) return;
    try {
      await fetch("/api/native/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vst3Path }),
      });
    } catch (err: any) {
      triggerToast(`Couldn't open Explorer: ${err.message}`);
    }
  };

  const handleInstall = async () => {
    if (!vst3Path) return;
    const confirmed = window.confirm(
      `Copy this plugin into your system VST3 folder (Program Files\\Common Files\\VST3) so your DAW can find it?\n\n${vst3Path}`
    );
    if (!confirmed) return;

    setIsInstalling(true);
    try {
      const res = await fetch("/api/native/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vst3Path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Install failed.");
      triggerToast(`Installed to ${data.installedTo}. Rescan plugins in your DAW to pick it up.`);
    } catch (err: any) {
      triggerToast(`Install failed: ${err.message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="bg-neutral-900/10 border border-neutral-900 rounded-3xl p-5 md:p-6 shadow-2xl space-y-6 font-sans text-neutral-100">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-850/65">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <span className="font-mono text-[9px] font-bold uppercase text-indigo-400 tracking-wider bg-indigo-950/40 border border-indigo-900/50 px-2 py-0.5 rounded">
              Native VST3 Build
            </span>
          </div>
          <h2 className="text-lg font-extrabold text-neutral-150 tracking-tight flex items-center gap-1.5">
            <span>Compile a real, loadable VST3</span>
            <Info
              className="w-3.5 h-3.5 text-neutral-500 cursor-help"
              title="Writes a real JUCE + CMake project and runs a real compiler. Local dev server only (needs CMake + a C++ toolchain). First build fetches and compiles JUCE itself, so expect 5-15+ minutes; later builds are incremental."
            />
          </h2>
          <p className="text-xs text-neutral-400 leading-normal max-w-2xl">Compiles "{plugin.name}" into an actual .vst3 you can load in a DAW.</p>
        </div>
      </div>

      {!localReady && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-300">A local model is required for this step</p>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              The native build needs a local model (Ollama or LM Studio) to port the tested DSP function into C++. Open the "Memory & LLMs" tab
              and confirm Ollama or LM Studio is connected, then come back here.
            </p>
          </div>
        </div>
      )}

      <button
        onClick={handleBuild}
        disabled={!localReady || stage === "scaffolding" || stage === "building"}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-mono font-black text-xs tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer select-none"
      >
        {stage === "scaffolding" || stage === "building" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{stage === "scaffolding" ? "SCAFFOLDING PROJECT..." : "COMPILING (this can take a while)..."}</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            <span>BUILD VST3</span>
          </>
        )}
      </button>

      {warning && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3 text-[11px] text-amber-300">{warning}</div>
      )}

      {stage !== "idle" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {stage === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {stage === "failed" && <XCircle className="w-4 h-4 text-rose-400" />}
            {(stage === "scaffolding" || stage === "building") && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />}
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">
              Status: {stage}
            </span>
          </div>

          <JobTimer active={stage === "scaffolding"} jobKey="native_scaffold" label="Scaffolding + DSP translation" />
          <JobTimer active={stage === "building"} jobKey="native_build" label="CMake configure + compile" />

          {errorMsg && <div className="text-[11px] text-rose-400 font-mono">{errorMsg}</div>}

          <pre className="bg-black/50 border border-neutral-900 rounded-xl p-4 text-[10.5px] font-mono text-neutral-300 whitespace-pre-wrap max-h-[360px] overflow-y-auto scrollbar-thin">
            {log || "No build output yet."}
          </pre>

          {stage === "success" && vst3Path && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono text-emerald-400 break-all">{vst3Path}</div>
              <div className="flex gap-2">
                <button
                  onClick={handleReveal}
                  className="flex items-center gap-1.5 px-3 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 rounded-lg text-[10.5px] font-bold cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Reveal in Explorer</span>
                </button>
                <button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-neutral-800 text-white rounded-lg text-[10.5px] font-bold cursor-pointer"
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  <span>{isInstalling ? "Installing..." : "Install to system VST3 folder"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
