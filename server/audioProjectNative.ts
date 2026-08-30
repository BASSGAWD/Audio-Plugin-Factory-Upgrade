import { validateAudioSoftwareProject, type AudioSoftwareProject } from "../src/audioProjects";
import type { NativePlugin, NativeParameter } from "./nativeBuild";

function parameterFromControl(control: AudioSoftwareProject["brief"]["controls"][number]): NativeParameter {
  const min = Number.isFinite(control.min) ? control.min! : 0;
  const max = Number.isFinite(control.max) ? control.max! : 1;
  const defaultValue = Number.isFinite(control.defaultValue) ? control.defaultValue! : (min + max) / 2;
  return {
    id: control.id,
    name: control.label,
    min,
    max,
    defaultValue,
    controlType: "knob",
  };
}

function extractDspFunction(source: string): string {
  const open = source.indexOf("{");
  const close = source.lastIndexOf("}");
  if (open < 0 || close <= open) throw new Error("Native DSP asset must export a function body.");
  const body = source.slice(open + 1, close).trim();
  if (!/\breturn\b/.test(body)) throw new Error("Native DSP asset must return an output sample.");
  return body;
}

/** Validated bridge from the renderer-neutral project contract to the proven
 * native scaffold. Workflow projects remain rejected before any export claim
 * or filesystem work occurs. */
export function audioProjectToNativePlugin(project: AudioSoftwareProject): NativePlugin {
  const validation = validateAudioSoftwareProject(project);
  if (!validation.valid) throw new Error(`Invalid audio software project: ${validation.issues.join("; ")}`);
  const target = project.brief.targets.find(item => item.target === "vst3");
  if (!target?.supported || target.stage !== "exportable") {
    throw new Error(`Audio project kind "${project.kind}" does not support VST3 export.`);
  }

  const native = project.native;
  if (!native) throw new Error("Exportable project is missing its native contract.");
  const dspAsset = project.codeAssets.find(asset => asset.id === native.dspAssetId);
  if (!dspAsset) throw new Error("Exportable project is missing its native DSP asset.");
  const base: NativePlugin = {
    name: project.name,
    family: native.family,
    category: native.category,
    parameters: project.brief.controls.map(parameterFromControl),
    dspFunction: extractDspFunction(dspAsset.source),
  };
  if (project.kind === "instrument") return { ...base, instrument: { voices: project.midi.voices, noteRange: project.midi.noteRange } };
  if (project.kind === "sampler") return { ...base, sampler: { pads: project.pads, assets: project.assets } };
  if (project.kind === "effect" || project.kind === "mastering" || project.kind === "utility") return base;
  throw new Error(`Audio project kind "${project.kind}" does not support VST3 export.`);
}