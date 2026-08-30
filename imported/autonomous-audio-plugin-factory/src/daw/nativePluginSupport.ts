import type { DawProject, PluginInstance } from "./model";

export const NATIVE_PLUGIN_ADAPTER_IDS = ["generated.gain/v1", "generated.ducker/v1"] as const;

const supported = new Set<string>(NATIVE_PLUGIN_ADAPTER_IDS);

export interface UnsupportedNativeProcessor {
  owner: string;
  instanceId: string;
  pluginId: string;
  name: string;
}

export function unsupportedNativeProcessors(project: DawProject): UnsupportedNativeProcessor[] {
  const owners: Array<{ owner: string; inserts: PluginInstance[] }> = [
    ...project.tracks.map((track) => ({ owner: `track ${track.name}`, inserts: track.inserts })),
    ...project.buses.map((bus) => ({ owner: `${bus.kind} bus ${bus.name}`, inserts: bus.inserts })),
  ];
  return owners.flatMap(({ owner, inserts }) => inserts
    .filter((insert) => insert.enabled && !supported.has(insert.pluginId))
    .map((insert) => ({
      owner, instanceId: insert.id, pluginId: insert.pluginId, name: insert.name,
    })));
}

export function assertNativeProcessorSupport(project: DawProject): void {
  const unsupported = unsupportedNativeProcessors(project);
  if (!unsupported.length) return;
  throw new Error(`Portable native export rejected unsupported enabled processor(s): ${
    unsupported.map((item) => `${item.name} (${item.pluginId}) on ${item.owner}`).join(", ")
  }. Native playback accepts only versioned adapters: ${NATIVE_PLUGIN_ADAPTER_IDS.join(", ")}.`);
}