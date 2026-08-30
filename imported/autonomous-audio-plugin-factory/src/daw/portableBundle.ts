import { migrateProject } from "./persistence";
import type { DawProject } from "./model";

export const PORTABLE_PROJECT_FILE = "project.json";
export const PORTABLE_ASSET_DIRECTORY = "assets";

export interface PortableProjectBundle {
  project: DawProject;
  /** Bundle-relative paths. project.json is deliberately the canonical v3 JSON. */
  files: Map<string, Blob>;
}

export type PortableDirectoryPicker = (options: { mode: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;

/** The browser directory API is deliberately used directly: portable bundles
 * are directories of canonical JSON plus original asset bytes, never an
 * archive or a base64 transport container. */
export function supportsPortableBundleDirectories(): boolean {
  return typeof window !== "undefined" && typeof (window as Window & { showDirectoryPicker?: PortableDirectoryPicker }).showDirectoryPicker === "function";
}

export function portableDirectoryPicker(): PortableDirectoryPicker {
  if (typeof window === "undefined") throw new Error("This environment does not support the File System Access directory picker.");
  const picker = (window as Window & { showDirectoryPicker?: PortableDirectoryPicker }).showDirectoryPicker;
  if (!picker) throw new Error("This browser does not support the File System Access directory picker.");
  return picker.bind(window);
}

export async function writePortableProjectBundle(
  directory: FileSystemDirectoryHandle,
  bundle: PortableProjectBundle,
): Promise<void> {
  for (const [path, blob] of bundle.files) {
    const parts = path.split("/");
    const filename = parts.pop();
    if (!filename || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe portable bundle path: ${path}`);
    }
    let parent = directory;
    for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true });
    const handle = await parent.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort(); throw error; }
  }
}

export async function readPortableProjectBundle(directory: FileSystemDirectoryHandle): Promise<PortableProjectBundle> {
  let projectFile: File;
  try { projectFile = await (await directory.getFileHandle(PORTABLE_PROJECT_FILE)).getFile(); }
  catch (error) { throw new Error(`Portable bundle has no ${PORTABLE_PROJECT_FILE}: ${error instanceof Error ? error.message : String(error)}`); }
  let raw: unknown;
  try { raw = JSON.parse(await projectFile.text()); }
  catch (error) { throw new Error(`Portable project JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const project = migrateProject(raw);
  const files = new Map<string, Blob>([[PORTABLE_PROJECT_FILE, projectFile]]);
  let assets: FileSystemDirectoryHandle;
  try { assets = await directory.getDirectoryHandle(PORTABLE_ASSET_DIRECTORY); }
  catch (error) { throw new Error(`Portable bundle has no ${PORTABLE_ASSET_DIRECTORY} directory: ${error instanceof Error ? error.message : String(error)}`); }
  for (const asset of project.assets) {
    const relative = portableAssetPath(asset);
    const name = relative.slice(`${PORTABLE_ASSET_DIRECTORY}/`.length);
    try { files.set(relative, await (await assets.getFileHandle(name)).getFile()); }
    catch (error) { throw new Error(`Portable bundle is missing asset ${asset.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return openPortableProjectBundle(files);
}

const EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3",
  "audio/flac": "flac", "audio/ogg": "ogg", "audio/aac": "aac",
};

export function portableAssetPath(asset: Pick<DawProject["assets"][number], "id" | "mimeType">): string {
  if (!/^[A-Za-z0-9._-]+$/.test(asset.id) || asset.id === "." || asset.id === "..") {
    throw new Error(`Unsafe portable asset id: ${asset.id}`);
  }
  const extension = EXTENSIONS[asset.mimeType.toLowerCase()];
  if (!extension) throw new Error(`Unsupported portable audio type: ${asset.mimeType}`);
  return `${PORTABLE_ASSET_DIRECTORY}/${asset.id}.${extension}`;
}

/** Creates a dependency-free directory bundle suitable for File System Access
 * API writers and for the JUCE desktop scaffold. No metadata is rewritten. */
export function createPortableProjectBundle(
  projectInput: unknown,
  assets: ReadonlyMap<string, Blob>,
): PortableProjectBundle {
  const project = migrateProject(projectInput);
  const files = new Map<string, Blob>();
  const missing: string[] = [];
  for (const asset of project.assets) {
    const blob = assets.get(asset.id);
    if (!blob) { missing.push(asset.id); continue; }
    if (blob.size !== asset.byteLength) {
      throw new Error(`Asset ${asset.id} byte length is ${blob.size}; project declares ${asset.byteLength}`);
    }
    files.set(portableAssetPath(asset), blob);
  }
  if (missing.length) throw new Error(`Portable bundle is missing assets: ${missing.join(", ")}`);
  files.set(PORTABLE_PROJECT_FILE, new Blob([JSON.stringify(project, null, 2) + "\n"], { type: "application/json" }));
  return { project, files };
}

export async function openPortableProjectBundle(files: ReadonlyMap<string, Blob>): Promise<PortableProjectBundle> {
  const json = files.get(PORTABLE_PROJECT_FILE);
  if (!json) throw new Error(`Portable bundle has no ${PORTABLE_PROJECT_FILE}`);
  let raw: unknown;
  try { raw = JSON.parse(await json.text()); }
  catch (error) { throw new Error(`Portable project JSON is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const project = migrateProject(raw);
  for (const asset of project.assets) {
    const blob = files.get(portableAssetPath(asset));
    if (!blob) throw new Error(`Portable bundle is missing asset ${asset.id}`);
    if (blob.size !== asset.byteLength) throw new Error(`Portable asset ${asset.id} failed byte-length validation`);
  }
  return { project, files: new Map(files) };
}