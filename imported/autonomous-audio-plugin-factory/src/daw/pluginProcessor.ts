import type { AudioPlugin } from "../types";
import { sanitizeDspCode } from "../utils/healthcheckRunner";
import type { PluginProcessor } from "./bounce";

/** Compiles only the already validated active plugin body. A failed compile has no processor,
 * so callers retain transparent/bypass behavior rather than inventing an effect. */
export function createActivePluginProcessor(plugin?: AudioPlugin): PluginProcessor | undefined {
  if (!plugin || plugin.isPlaceholder || !plugin.dspFunction) return undefined;
  let fn: (input: number, params: Record<string, number>, state: Record<string, unknown>, inputR: number, inputKey: number) => number;
  try { fn = new Function("inputSample", "params", "state", "inputR", "inputKey", sanitizeDspCode(plugin.dspFunction)) as typeof fn; }
  catch { return undefined; }
  const states = new Map<string, Record<string, unknown>>();
  return (instance, left, right, sidechain) => {
    if (instance.pluginId !== plugin.id) return [left, right];
    const state = states.get(instance.id) ?? {};
    states.set(instance.id, state);
    try {
      const output = fn(left, instance.parameters, state, right, sidechain);
      const outputRight = state.outR;
      const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
      return [finite(output, left), finite(outputRight, finite(output, left))];
    } catch { return [left, right]; }
  };
}