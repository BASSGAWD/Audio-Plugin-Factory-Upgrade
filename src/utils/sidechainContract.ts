import type { AudioPlugin, PluginRoutingContract } from "../types";
import type { AudioPluginSpec } from "./pluginSpec";

const EXPLICIT_EXTERNAL = /\b(side[ -]?chain|external (?:key|detector|control)|keyed|duck(?:ing)? .* (?:kick|voice|vocal|drum|track))\b/i;
const SIDECHAIN_BEHAVIOR = /\b(compress|limit|gate|duck|expand|dynamic\s+(?:eq|filter)|de-?ess|envelope[- ](?:filter|follow)|pump(?:s|ed|ing)?)\b/i;
const keyConsumptionCache = new Map<string, boolean>();

/** Proves that changing only the auxiliary signal changes rendered output.
 * Lexical inputKey presence is not evidence: comments and dead reads fail. */
export function dspConsumesExternalKey(dspFunction: string): boolean {
  const cached = keyConsumptionCache.get(dspFunction);
  if (cached !== undefined) return cached;
  if (!/\binputKey\b/.test(dspFunction)) return false;
  let consumed = false;
  try {
    const fn = new Function("inputSample", "params", "state", "inputR", "inputKey", dspFunction) as
      (input: number, params: Record<string, number>, state: Record<string, unknown>, inputR: number, inputKey: number) => number;
    // Verified recipes all carry audible defaults when a parameter is absent.
    // Supplying arbitrary 0.5 values can put dB thresholds above full scale
    // and incorrectly make a real detector appear inert.
    const params = {} as Record<string, number>;
    const quietState: Record<string, unknown> = {};
    const loudState: Record<string, unknown> = {};
    let difference = 0;
    let reference = 0;
    for (let i = 0; i < 12000; i++) {
      const main = 0.31 * Math.sin(i * 0.071) + 0.13 * Math.sin(i * 0.193);
      const quiet = fn(main, params, quietState, main, 0.001 * Math.sin(i * 0.13));
      const loud = fn(main, params, loudState, main, 0.9 * Math.sin(i * 0.13));
      if (!Number.isFinite(quiet) || !Number.isFinite(loud)) continue;
      if (i > 1000) {
        difference += Math.abs(quiet - loud);
        reference += Math.abs(quiet) + Math.abs(loud);
      }
    }
    consumed = difference > Math.max(1e-4, reference * 1e-5);
  } catch {
    consumed = false;
  }
  if (keyConsumptionCache.size > 100) keyConsumptionCache.clear();
  keyConsumptionCache.set(dspFunction, consumed);
  return consumed;
}

export function isSidechainEligible(family: string, text: string): boolean {
  if (family === "dynamics") return true;
  if (family === "eq" || family === "filter" || family === "hybrid_other") return SIDECHAIN_BEHAVIOR.test(text);
  if (family === "pitch") return /\b(key|scale|tune|backing|instrumental|beat)\b/i.test(text);
  return false;
}

export function routingContractFor(family: string, text: string, dspFunction = ""): PluginRoutingContract {
  const eligible = isSidechainEligible(family, text);
  const requested = eligible && EXPLICIT_EXTERNAL.test(text);
  const consumesKey = dspConsumesExternalKey(dspFunction);
  const supported = requested && consumesKey;
  return {
    version: "1.0",
    mainInput: { channels: "mono-or-stereo", required: true },
    auxiliaryInput: { role: "sidechain", supported, required: false, channels: "mono-or-stereo" },
    detectorMode: supported ? "external-optional" : "internal",
    disconnectedBehavior: supported ? "use-internal-detector" : "bypass-sidechain-processing",
    inputKeyArgument: supported,
  };
}

export function routingContractForSpec(spec: AudioPluginSpec, dspFunction = ""): PluginRoutingContract {
  return routingContractFor(spec.family, `${spec.interpretedGoal} ${spec.dspIdentity}`, dspFunction);
}

export function hasExternalSidechain(plugin: Pick<AudioPlugin, "routing">): boolean {
  return plugin.routing?.version === "1.0"
    && plugin.routing.auxiliaryInput.supported
    && plugin.routing.inputKeyArgument
    && plugin.routing.detectorMode !== "internal";
}

export function sidechainRuntimeStatus(
  plugin: Pick<AudioPlugin, "routing">,
  sourceSelected: boolean,
  engineRunning: boolean,
  consumed: boolean,
  level: number
): { mode: "internal" | "external-connected" | "external-active"; connected: boolean; active: boolean; level: number } {
  const connected = hasExternalSidechain(plugin) && sourceSelected && engineRunning;
  const safeLevel = connected && Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const active = connected && consumed && safeLevel > 1e-5;
  return {
    mode: active ? "external-active" : connected ? "external-connected" : "internal",
    connected,
    active,
    level: safeLevel,
  };
}

export function validateRoutingContract(contract: PluginRoutingContract | undefined, dspFunction: string): string[] {
  if (!contract) return [];
  const issues: string[] = [];
  if (contract.version !== "1.0") issues.push("unsupported routing contract version");
  if (contract.auxiliaryInput.required && contract.detectorMode !== "external-required") issues.push("required auxiliary input must use external-required detector mode");
  if (contract.auxiliaryInput.supported !== contract.inputKeyArgument) issues.push("auxiliary support and inputKey contract disagree");
  const consumesKey = dspConsumesExternalKey(dspFunction);
  if (contract.inputKeyArgument && !consumesKey) issues.push("routing advertises inputKey but differential audio probes show no consumption");
  if (!contract.inputKeyArgument && consumesKey) issues.push("DSP consumes inputKey but routing does not advertise it");
  return issues;
}