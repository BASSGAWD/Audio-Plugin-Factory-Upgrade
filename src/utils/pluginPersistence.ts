/**
 * Persistence for the single "currently loaded plugin".
 *
 * Extracted from App.tsx so the rules below are testable in isolation (the
 * same reason canvasFactory.ts owns the Canvas workspace's persistence
 * rather than App.tsx doing it inline).
 *
 * Two real data-loss bugs motivated this file, both confirmed in the code
 * before it existed:
 *
 *  1. The boot-verification path did `localStorage.setItem(KEY, DEFAULT)`
 *     when a cached plugin failed to compile -- overwriting the user's work
 *     with the stock default, permanently and unrecoverably, reporting
 *     nothing but a console.warn. A plugin that fails to load is a reason to
 *     fall back IN MEMORY, never a reason to destroy the stored copy.
 *  2. The save path called setItem unguarded. localStorage.setItem THROWS on
 *     quota exhaustion, and this app fills quota for real (a full plugin is
 *     appended to the Canvas history on every build). That throw escaped into
 *     the caller's catch -- which called save again, throwing a second time
 *     OUTSIDE any try -- so the build's own success message was suppressed and
 *     React showed a plugin storage never received, silently reverting on the
 *     next reload.
 */
import { AudioPlugin } from "../types";

export const PLUGIN_STORAGE_KEY = "audio_factory_plugin_state";

/** Where a plugin goes when it fails boot verification -- preserved for
 *  recovery instead of being overwritten by the default. */
export const PLUGIN_REJECTED_KEY = "audio_factory_plugin_rejected_v1";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Persist the loaded plugin. Returns false when the write did NOT stick
 * (quota exhausted, storage unavailable) so the caller can tell the user
 * their work is in memory only -- rather than throwing and derailing a build
 * that already succeeded. Never throws.
 */
export function savePersistedPlugin(plugin: AudioPlugin): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(plugin));
    return true;
  } catch (err) {
    console.warn("Could not persist the plugin (storage full or unavailable):", err);
    return false;
  }
}

export function readPersistedPluginRaw(): string | null {
  try {
    return storage()?.getItem(PLUGIN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Set aside a cached plugin that failed verification, so falling back to the
 * default is recoverable rather than destructive. Best-effort: if even the
 * backup write fails, the caller still falls back in memory -- but it must
 * NEVER respond by overwriting PLUGIN_STORAGE_KEY, which is exactly the bug
 * this replaces.
 */
export function preserveRejectedPlugin(rawCachedPlugin: string): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(PLUGIN_REJECTED_KEY, rawCachedPlugin);
    return true;
  } catch (err) {
    console.warn("Could not preserve the rejected plugin for recovery:", err);
    return false;
  }
}

export function readRejectedPluginRaw(): string | null {
  try {
    return storage()?.getItem(PLUGIN_REJECTED_KEY) ?? null;
  } catch {
    return null;
  }
}
