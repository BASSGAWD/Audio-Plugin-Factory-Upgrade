import React from "react";
import { X, BookOpen } from "lucide-react";
import { AudioPlugin } from "../types";
import { buildPluginManual, ManualEntry } from "../utils/featureManifest";

/**
 * Per-plugin auto-generated manual -- documents THIS plugin's actual
 * controls, not the app itself (the existing "?" Help Manual in App.tsx is
 * hand-written app-usage docs, Pro-mode-only, and unrelated to any specific
 * plugin; this is a separate, new thing, deliberately not merged into it).
 * Every entry's purpose text comes straight from FEATURE_MANIFEST
 * (featureManifest.ts) via buildPluginManual -- the same vocabulary that
 * already drives the LLM build prompt and the featureDepth quality metric,
 * now finally read for a human instead of only a model.
 */

const TIER_SECTIONS: Array<{ tier: ManualEntry["tier"]; heading: string; blurb: string }> = [
  { tier: "required", heading: "Core controls", blurb: "Without these it wouldn't honestly be this kind of plugin." },
  { tier: "expected", heading: "What rounds it out", blurb: "A real unit of this type has these too." },
  { tier: "advanced", heading: "Advanced", blurb: "Differentiators -- worth knowing, not essential." },
  { tier: "custom", heading: "Other controls", blurb: "Specific to this build." },
];

export function PluginManualContent({ plugin }: { plugin: AudioPlugin }) {
  const entries = buildPluginManual(plugin.parameters, plugin.family);
  const byTier = (tier: ManualEntry["tier"]) => entries.filter((e) => e.tier === tier);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">{plugin.category}</div>
        <h2 className="text-lg font-semibold text-neutral-100">{plugin.name}</h2>
        {plugin.description && <p className="text-[12px] text-neutral-400 leading-relaxed mt-1">{plugin.description}</p>}
      </div>

      {entries.length === 0 ? (
        <p className="text-[12px] text-neutral-500">This plugin has no documented controls yet.</p>
      ) : (
        TIER_SECTIONS.map(({ tier, heading, blurb }) => {
          const rows = byTier(tier);
          if (rows.length === 0) return null;
          return (
            <div key={tier} className="space-y-1.5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-400/90">{heading}</div>
                <div className="text-[10px] text-neutral-500">{blurb}</div>
              </div>
              <div className="space-y-1">
                {rows.map((entry) => (
                  <div key={entry.paramId} className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 px-3 py-2">
                    <div className="text-[12px] font-semibold text-neutral-200">{entry.name}</div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed mt-0.5">{entry.purpose}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export function PluginManual({
  plugin,
  isOpen,
  onClose,
}: {
  plugin: AudioPlugin | undefined;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen || !plugin) return null;
  return (
    <div
      className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`${plugin.name} manual`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] overflow-y-auto bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-5 scrollbar-thin"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 text-neutral-400">
            <BookOpen className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Manual</span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close manual"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <PluginManualContent plugin={plugin} />
      </div>
    </div>
  );
}
