/**
 * DAW cross-device sync backend. Originally built against Clerk (auth) +
 * Google Cloud Storage via Replit's App Storage sidecar -- both replaced,
 * at the user's explicit request, with a self-contained mechanism that
 * needs no external account or service:
 *
 *  - Identity: a "pairing code" (src/daw/pairing.ts) generated on one
 *    device and typed into another. Possession of the code IS the
 *    authorization -- the same trust model as a shared link -- sent as the
 *    `X-Sync-Code` header on every request instead of a Clerk session
 *    cookie. Every route below is otherwise UNCHANGED from the original:
 *    the code was always just an opaque string used to namespace storage
 *    (nothing here was ever Clerk-specific beyond how that string was
 *    obtained), so only `requireUser` needed to change.
 *  - Storage: the local filesystem under `.daw-sync-data/`, instead of a
 *    GCS bucket. GCS's `generation` numbers and 32-way `compose()` batching
 *    existed to solve problems specific to an external object store; a
 *    single local Node process doesn't have them, so this is genuinely
 *    simpler, not a 1:1 port: optimistic concurrency uses the project's own
 *    `revision` field (already the semantic conflict-detection value) plus
 *    an in-process per-project mutex, and chunk assembly is a plain
 *    sequential file concatenation.
 */
import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

interface StoredProject {
  revision: number;
  project: { id: string; assets?: Array<{ id: string }> };
  assetVersions?: Record<string, string>;
}

const router = Router();
const idPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const pairingCodePattern = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const CHUNK_BYTES = 5 * 1024 * 1024;

// Gitignored data directory for synced projects/assets -- see .gitignore.
const DATA_ROOT = path.resolve(process.cwd(), ".daw-sync-data");

function safeId(value: unknown, label: string) {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function projectDir(code: string, projectId: string) {
  return path.join(DATA_ROOT, code, "projects", projectId);
}
function projectFilePath(code: string, projectId: string) {
  return path.join(projectDir(code, projectId), "project.json");
}
function assetDir(code: string, projectId: string, assetId: string) {
  return path.join(DATA_ROOT, code, "assets", projectId, assetId);
}
function assetVersionPath(code: string, projectId: string, assetId: string, version: string) {
  return path.join(assetDir(code, projectId, assetId), "versions", version);
}
function uploadDir(code: string, projectId: string, assetId: string, uploadId: string) {
  return path.join(assetDir(code, projectId, assetId), "uploads", uploadId);
}
function uploadMetaPath(code: string, projectId: string, assetId: string, uploadId: string) {
  return path.join(uploadDir(code, projectId, assetId, uploadId), "meta.json");
}
function chunkPath(code: string, projectId: string, assetId: string, uploadId: string, offset: number) {
  return path.join(uploadDir(code, projectId, assetId, uploadId), "chunks", String(offset).padStart(16, "0"));
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

// Simple in-process mutex per (code, projectId), so two concurrent writes
// to the same project from the same server process can't interleave and
// corrupt the revision check. A single Node process is the only writer
// here (no multi-instance deployment for this feature), so this is
// sufficient -- GCS's ifGenerationMatch precondition existed to guard
// against exactly the concurrency GCS itself introduced (multiple
// writers/regions); a local single-process store doesn't have that problem.
const locks = new Map<string, Promise<void>>();
async function withProjectLock<T>(code: string, projectId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${code}::${projectId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, previous.then(() => gate));
  await previous;
  try {
    return await fn();
  } finally {
    release!();
    if (locks.get(key) === previous.then(() => gate)) locks.delete(key);
  }
}

function isQuotaError(error: any) {
  return error?.code === "ENOSPC" || /no space|quota|capacity|limit/i.test(String(error?.message || ""));
}

/** Reads the pairing code from the request header and treats it as the
 *  identity namespace -- the direct replacement for Clerk's getAuth(req).
 *  Every route below is unchanged from the original beyond this function:
 *  `res.locals.userId` still means exactly what it always meant, "the
 *  opaque key this data is stored under". */
const requireUser: RequestHandler = (req, res, next) => {
  const code = req.get("X-Sync-Code");
  if (!code || !pairingCodePattern.test(code)) {
    res.status(401).json({ error: "Pair this device before using cloud sync." });
    return;
  }
  res.locals.userId = code;
  next();
};

async function readProject(code: string, projectId: string): Promise<StoredProject | null> {
  const file = projectFilePath(code, projectId);
  if (!(await exists(file))) return null;
  return JSON.parse(await fs.readFile(file, "utf8")) as StoredProject;
}

async function writeProject(code: string, projectId: string, stored: StoredProject) {
  const dir = projectDir(code, projectId);
  await fs.mkdir(dir, { recursive: true });
  // Atomic write: write to a temp file in the same directory, then rename
  // -- rename is atomic on the same filesystem, so a crash mid-write can
  // never leave a half-written project.json behind.
  const file = projectFilePath(code, projectId);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(stored));
  await fs.rename(tmp, file);
}

async function uploadChunkOffsets(code: string, projectId: string, assetId: string, uploadId: string): Promise<number[]> {
  const dir = path.join(uploadDir(code, projectId, assetId, uploadId), "chunks");
  if (!(await exists(dir))) return [];
  const names = await fs.readdir(dir);
  return names.map((n) => Number(n)).sort((a, b) => a - b);
}

async function contiguousUploadOffset(code: string, projectId: string, assetId: string, uploadId: string): Promise<number> {
  const dir = path.join(uploadDir(code, projectId, assetId, uploadId), "chunks");
  let offset = 0;
  for (const start of await uploadChunkOffsets(code, projectId, assetId, uploadId)) {
    if (start !== offset) break;
    const stat = await fs.stat(path.join(dir, String(start).padStart(16, "0")));
    offset += stat.size;
  }
  return offset;
}

/** Sequentially concatenates every chunk file, in offset order, into the
 *  final asset version file. Plain and correct -- local disk has no
 *  analogue to GCS's 32-object compose() limit, so there's no need for
 *  the tree-of-composes the original did. */
async function assembleChunks(code: string, projectId: string, assetId: string, uploadId: string, destination: string) {
  const dir = path.join(uploadDir(code, projectId, assetId, uploadId), "chunks");
  const offsets = await uploadChunkOffsets(code, projectId, assetId, uploadId);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const tmp = `${destination}.${randomUUID()}.tmp`;
  const out = fsSync.createWriteStream(tmp);
  for (const offset of offsets) {
    const chunkFile = path.join(dir, String(offset).padStart(16, "0"));
    await new Promise<void>((resolve, reject) => {
      const inStream = fsSync.createReadStream(chunkFile);
      inStream.on("error", reject);
      inStream.pipe(out, { end: false });
      inStream.on("end", () => resolve());
    });
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  await fs.rename(tmp, destination);
}

router.use(requireUser);

router.get("/projects/:projectId", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id");
    const stored = await readProject(res.locals.userId, projectId);
    if (!stored) { res.status(204).end(); return; }
    const missingAssetIds: string[] = [];
    for (const asset of stored.project.assets ?? []) {
      const version = stored.assetVersions?.[asset.id];
      const has = version ? await exists(assetVersionPath(res.locals.userId, projectId, asset.id, version)) : false;
      if (!has) missingAssetIds.push(asset.id);
    }
    res.json({ ...stored, missingAssetIds });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/projects/:projectId", async (req, res) => {
  const projectId = safeId(req.params.projectId, "project id");
  try {
    await withProjectLock(res.locals.userId, projectId, async () => {
      if (!req.body?.project || req.body.project.id !== projectId) throw new Error("Project payload does not match the route.");
      const baseRevision = req.body.baseRevision === null ? null : Number(req.body.baseRevision);
      const assetVersions = req.body.assetVersions && typeof req.body.assetVersions === "object" ? req.body.assetVersions as Record<string, string> : {};
      const current = await readProject(res.locals.userId, projectId);
      if (current && baseRevision !== current.revision) { res.status(409).json({ ...current, missingAssetIds: [] }); return; }
      if (!current && baseRevision !== null) { res.status(409).json({ project: req.body.project, revision: 0, assetVersions: {}, missingAssetIds: [] }); return; }
      for (const asset of req.body.project.assets ?? []) {
        const assetId = safeId(asset.id, "asset id");
        const version = safeId(assetVersions[assetId], "asset version");
        if (!(await exists(assetVersionPath(res.locals.userId, projectId, assetId, version)))) {
          throw new Error(`Audio asset ${assetId} has not completed uploading.`);
        }
      }
      const revision = (current?.revision ?? 0) + 1;
      await writeProject(res.locals.userId, projectId, { revision, project: req.body.project, assetVersions });
      res.json({ revision, missingAssetIds: [] });
    });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/projects/:projectId/assets/:assetId/uploads", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id");
    const assetId = safeId(req.params.assetId, "asset id");
    const size = Number(req.body?.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Invalid audio size.");
    const uploadId = randomUUID();
    const dir = uploadDir(res.locals.userId, projectId, assetId, uploadId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(uploadMetaPath(res.locals.userId, projectId, assetId, uploadId), JSON.stringify({ size, mimeType: String(req.body?.mimeType || "application/octet-stream") }));
    res.status(201).json({ uploadId, offset: 0 });
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Local storage quota or capacity is unavailable." : error?.message || "Upload creation failed." }); }
});

router.get("/projects/:projectId/assets/:assetId/uploads/:uploadId", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    if (!(await exists(uploadMetaPath(res.locals.userId, projectId, assetId, uploadId)))) {
      res.status(404).json({ error: "Upload session expired; retry to start a new one." }); return;
    }
    res.json({ uploadId, offset: await contiguousUploadOffset(res.locals.userId, projectId, assetId, uploadId) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/projects/:projectId/assets/:assetId/uploads/:uploadId/chunks", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.get("content-range") || "");
    if (!match || !Buffer.isBuffer(req.body)) throw new Error("A valid Content-Range and chunk body are required.");
    const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
    const meta = JSON.parse(await fs.readFile(uploadMetaPath(res.locals.userId, projectId, assetId, uploadId), "utf8")) as { size: number };
    if (total !== meta.size || end - start + 1 !== req.body.length || req.body.length > CHUNK_BYTES) throw new Error("Chunk range does not match the upload session.");
    const file = chunkPath(res.locals.userId, projectId, assetId, uploadId, start);
    if (await exists(file)) {
      const stat = await fs.stat(file);
      if (stat.size !== req.body.length) throw new Error("A different chunk already exists at this offset.");
    } else {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, req.body);
    }
    res.status(204).end();
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Local storage quota or capacity is unavailable." : error?.message || "Chunk upload failed." }); }
});

router.post("/projects/:projectId/assets/:assetId/uploads/:uploadId/complete", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    const meta = JSON.parse(await fs.readFile(uploadMetaPath(res.locals.userId, projectId, assetId, uploadId), "utf8")) as { size: number; mimeType: string };
    const offsets = await uploadChunkOffsets(res.locals.userId, projectId, assetId, uploadId);
    if (await contiguousUploadOffset(res.locals.userId, projectId, assetId, uploadId) !== meta.size || !offsets.length) throw new Error("Upload is incomplete and can be resumed.");
    const destination = assetVersionPath(res.locals.userId, projectId, assetId, uploadId);
    if (!(await exists(destination))) await assembleChunks(res.locals.userId, projectId, assetId, uploadId, destination);
    res.json({ version: uploadId, size: meta.size, mimeType: meta.mimeType });
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Local storage quota or capacity is unavailable." : error?.message || "Upload completion failed." }); }
});

router.get("/projects/:projectId/assets/:assetId/versions/:version", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id");
    const version = safeId(req.params.version, "asset version");
    const file = assetVersionPath(res.locals.userId, projectId, assetId, version);
    const stat = await fs.stat(file);
    const size = stat.size;
    const range = /^bytes=(\d+)-(\d+)?$/.exec(req.get("range") || "");
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(size - 1, range?.[2] ? Number(range[2]) : size - 1);
    if (start < 0 || start >= size || end < start) { res.status(416).end(); return; }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Accept-Ranges", "bytes");
    if (range) { res.status(206); res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`); }
    fsSync.createReadStream(file, { start, end }).on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  } catch { res.status(404).json({ error: "Synced audio asset was not found." }); }
});

export default router;
