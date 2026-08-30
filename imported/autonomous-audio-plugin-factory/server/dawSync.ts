import { getAuth } from "@clerk/express";
import { Storage, type File } from "@google-cloud/storage";
import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";

interface StoredProject {
  revision: number;
  project: { id: string; assets?: Array<{ id: string }> };
  assetVersions?: Record<string, string>;
}
interface VersionedProject { value: StoredProject; generation: number }

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
// App Storage is authenticated by Replit's local sidecar. Using the default
// Google credential chain works on developer machines with gcloud configured,
// but fails in previews and deployments where App Storage is actually hosted.
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});
const router = Router();
const idPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const CHUNK_BYTES = 5 * 1024 * 1024;

function bucket() {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("Cloud storage is not configured.");
  return storage.bucket(id);
}
function privatePrefix() { return (process.env.PRIVATE_OBJECT_DIR || ".private").replace(/^\/+|\/+$/g, ""); }
function safeId(value: unknown, label: string) {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function projectFile(userId: string, projectId: string) {
  return bucket().file(`${privatePrefix()}/daw/${userId}/projects/${projectId}.json`);
}
function assetFile(userId: string, projectId: string, assetId: string, version: string) {
  return bucket().file(`${privatePrefix()}/daw/${userId}/assets/${projectId}/${assetId}/versions/${version}`);
}
function uploadPrefix(userId: string, projectId: string, assetId: string, uploadId: string) {
  return `${privatePrefix()}/daw/${userId}/assets/${projectId}/${assetId}/uploads/${uploadId}`;
}
function uploadMetaFile(userId: string, projectId: string, assetId: string, uploadId: string) {
  return bucket().file(`${uploadPrefix(userId, projectId, assetId, uploadId)}/meta.json`);
}
function chunkFile(userId: string, projectId: string, assetId: string, uploadId: string, offset: number) {
  return bucket().file(`${uploadPrefix(userId, projectId, assetId, uploadId)}/chunks/${String(offset).padStart(16, "0")}`);
}
function isQuotaError(error: any) { return [403, 413, 429, 507].includes(Number(error?.code)) || /quota|capacity|limit/i.test(String(error?.message || "")); }

const requireUser: RequestHandler = (req, res, next) => {
  const auth = getAuth(req as unknown as Parameters<typeof getAuth>[0]);
  const userId = "userId" in auth && typeof auth.userId === "string" ? auth.userId : null;
  if (!userId) { res.status(401).json({ error: "Sign in before using cloud sync." }); return; }
  res.locals.userId = userId; next();
};

async function readProject(userId: string, projectId: string): Promise<VersionedProject | null> {
  const file = projectFile(userId, projectId);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
  return { value: JSON.parse(bytes.toString("utf8")) as StoredProject, generation: Number(metadata.generation) };
}

async function uploadChunks(userId: string, projectId: string, assetId: string, uploadId: string) {
  const [files] = await bucket().getFiles({ prefix: `${uploadPrefix(userId, projectId, assetId, uploadId)}/chunks/` });
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function contiguousUploadOffset(userId: string, projectId: string, assetId: string, uploadId: string) {
  let offset = 0;
  for (const file of await uploadChunks(userId, projectId, assetId, uploadId)) {
    const start = Number(file.name.split("/").pop());
    const [metadata] = await file.getMetadata();
    if (start !== offset) break;
    offset += Number(metadata.size);
  }
  return offset;
}

async function composeChunks(files: File[], destination: File) {
  let current = files;
  let level = 0;
  while (current.length > 32) {
    const next: File[] = [];
    for (let index = 0; index < current.length; index += 32) {
      const part = bucket().file(`${destination.name}.compose-${level}-${index / 32}`);
      await bucket().combine(current.slice(index, index + 32), part);
      next.push(part);
    }
    current = next; level++;
  }
  await bucket().combine(current, destination);
}

router.use(requireUser);

router.get("/projects/:projectId", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id");
    const stored = await readProject(res.locals.userId, projectId);
    if (!stored) { res.status(204).end(); return; }
    const missingAssetIds: string[] = [];
    for (const asset of stored.value.project.assets ?? []) {
      const version = stored.value.assetVersions?.[asset.id];
      const [exists] = version ? await assetFile(res.locals.userId, projectId, asset.id, version).exists() : [false];
      if (!exists) missingAssetIds.push(asset.id);
    }
    res.json({ ...stored.value, missingAssetIds });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/projects/:projectId", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id");
    if (!req.body?.project || req.body.project.id !== projectId) throw new Error("Project payload does not match the route.");
    const baseRevision = req.body.baseRevision === null ? null : Number(req.body.baseRevision);
    const assetVersions = req.body.assetVersions && typeof req.body.assetVersions === "object" ? req.body.assetVersions as Record<string, string> : {};
    const current = await readProject(res.locals.userId, projectId);
    if (current && baseRevision !== current.value.revision) { res.status(409).json({ ...current.value, missingAssetIds: [] }); return; }
    if (!current && baseRevision !== null) { res.status(409).json({ project: req.body.project, revision: 0, assetVersions: {}, missingAssetIds: [] }); return; }
    for (const asset of req.body.project.assets ?? []) {
      const assetId = safeId(asset.id, "asset id");
      const version = safeId(assetVersions[assetId], "asset version");
      const [exists] = await assetFile(res.locals.userId, projectId, assetId, version).exists();
      if (!exists) throw new Error(`Audio asset ${assetId} has not completed uploading.`);
    }
    const revision = (current?.value.revision ?? 0) + 1;
    try {
      await projectFile(res.locals.userId, projectId).save(JSON.stringify({ revision, project: req.body.project, assetVersions }), {
        resumable: false, contentType: "application/json", metadata: { cacheControl: "no-store" },
        preconditionOpts: { ifGenerationMatch: current?.generation ?? 0 },
      });
    } catch (error: any) {
      if (error?.code !== 412) throw error;
      const newer = await readProject(res.locals.userId, projectId);
      if (!newer) throw error;
      res.status(409).json({ ...newer.value, missingAssetIds: [] }); return;
    }
    res.json({ revision, missingAssetIds: [] });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.post("/projects/:projectId/assets/:assetId/uploads", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id");
    const assetId = safeId(req.params.assetId, "asset id");
    const size = Number(req.body?.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Invalid audio size.");
    const uploadId = randomUUID();
    await uploadMetaFile(res.locals.userId, projectId, assetId, uploadId).save(JSON.stringify({ size, mimeType: String(req.body?.mimeType || "application/octet-stream") }), {
      resumable: false, contentType: "application/json", preconditionOpts: { ifGenerationMatch: 0 },
    });
    res.status(201).json({ uploadId, offset: 0 });
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Cloud storage quota or capacity is unavailable." : error?.message || "Upload creation failed." }); }
});

router.get("/projects/:projectId/assets/:assetId/uploads/:uploadId", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    const [exists] = await uploadMetaFile(res.locals.userId, projectId, assetId, uploadId).exists();
    if (!exists) { res.status(404).json({ error: "Upload session expired; retry to start a new one." }); return; }
    res.json({ uploadId, offset: await contiguousUploadOffset(res.locals.userId, projectId, assetId, uploadId) });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

router.put("/projects/:projectId/assets/:assetId/uploads/:uploadId/chunks", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.get("content-range") || "");
    if (!match || !Buffer.isBuffer(req.body)) throw new Error("A valid Content-Range and chunk body are required.");
    const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
    const [metaBytes] = await uploadMetaFile(res.locals.userId, projectId, assetId, uploadId).download();
    const meta = JSON.parse(metaBytes.toString("utf8")) as { size: number };
    if (total !== meta.size || end - start + 1 !== req.body.length || req.body.length > CHUNK_BYTES) throw new Error("Chunk range does not match the upload session.");
    const file = chunkFile(res.locals.userId, projectId, assetId, uploadId, start);
    try { await file.save(req.body, { resumable: false, contentType: "application/octet-stream", preconditionOpts: { ifGenerationMatch: 0 } }); }
    catch (error: any) {
      if (error?.code !== 412) throw error;
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) !== req.body.length) throw new Error("A different chunk already exists at this offset.");
    }
    res.status(204).end();
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Cloud storage quota or capacity is unavailable." : error?.message || "Chunk upload failed." }); }
});

router.post("/projects/:projectId/assets/:assetId/uploads/:uploadId/complete", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id"), uploadId = safeId(req.params.uploadId, "upload id");
    const [metaBytes] = await uploadMetaFile(res.locals.userId, projectId, assetId, uploadId).download();
    const meta = JSON.parse(metaBytes.toString("utf8")) as { size: number; mimeType: string };
    const files = await uploadChunks(res.locals.userId, projectId, assetId, uploadId);
    if (await contiguousUploadOffset(res.locals.userId, projectId, assetId, uploadId) !== meta.size || !files.length) throw new Error("Upload is incomplete and can be resumed.");
    const destination = assetFile(res.locals.userId, projectId, assetId, uploadId);
    const [exists] = await destination.exists();
    if (!exists) await composeChunks(files, destination);
    await destination.setMetadata({ contentType: meta.mimeType, cacheControl: "private, max-age=0, no-store" });
    res.json({ version: uploadId, size: meta.size });
  } catch (error: any) { res.status(isQuotaError(error) ? 507 : 400).json({ error: isQuotaError(error) ? "Cloud storage quota or capacity is unavailable." : error?.message || "Upload completion failed." }); }
});

router.get("/projects/:projectId/assets/:assetId/versions/:version", async (req, res) => {
  try {
    const projectId = safeId(req.params.projectId, "project id"), assetId = safeId(req.params.assetId, "asset id");
    const version = safeId(req.params.version, "asset version");
    const file = assetFile(res.locals.userId, projectId, assetId, version);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    const range = /^bytes=(\d+)-(\d+)?$/.exec(req.get("range") || "");
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(size - 1, range?.[2] ? Number(range[2]) : size - 1);
    if (start < 0 || start >= size || end < start) { res.status(416).end(); return; }
    res.setHeader("Content-Type", metadata.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Accept-Ranges", "bytes");
    if (range) { res.status(206); res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`); }
    file.createReadStream({ start, end }).on("error", () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  } catch { res.status(404).json({ error: "Cloud audio asset was not found." }); }
});

export default router;