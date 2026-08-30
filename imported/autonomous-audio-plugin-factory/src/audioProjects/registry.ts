import type { AudioProjectKind, AudioSoftwareProject } from "./contracts";

export interface ProjectCapability {
  plan(project: AudioSoftwareProject): string[];
  emit(project: AudioSoftwareProject): string;
  preview(project: AudioSoftwareProject): { runnable: true; entry: string };
  validate(project: AudioSoftwareProject): string[];
}
const capabilities = new Map<AudioProjectKind, ProjectCapability>();
export function registerAudioProjectCapability(kind: AudioProjectKind, capability: ProjectCapability): void { capabilities.set(kind, capability); }
export function getAudioProjectCapability(kind: AudioProjectKind): ProjectCapability {
  const value = capabilities.get(kind);
  if (!value) throw new Error(`No audio project capability registered for ${kind}`);
  return value;
}
export function registeredAudioProjectKinds(): AudioProjectKind[] { return [...capabilities.keys()]; }