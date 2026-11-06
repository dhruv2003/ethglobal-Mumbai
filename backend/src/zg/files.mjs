/*
 * Files (artifacts): uploads, demo videos, live-test recordings and step screenshots.
 * The bytes are stored on 0G Storage only (zg/storage.mjs); the database on Arkiv
 * (collection "files", db.mjs) records which files exist and where: their 0G root
 * hash, transaction, size and sha256. Nothing is kept on this server's disk.
 *
 *   putFile(scope, name, bytes, { mime, kind })   store; 0G gets it in the background
 *   fileInfo(scope, name)                          { mime, size, sha256, rootHash, stored } or null
 *   getFile(scope, name)                           the bytes (memory while uploading, then 0G)
 *   removeFile(scope, name)
 *
 * scope is a project id, or "uploads". A file waits in memory until 0G has it (info.stored
 * turns true and its rootHash is set), and the last files read are kept in memory
 * (ARKIV_FILE_CACHE_MB, default 256) so a page doesn't download from 0G every time.
 * 0G Storage is public and permanent: only what a team chose to submit, or what our live
 * test recorded of their public app, is ever put here.
 */
import crypto from "node:crypto";
import * as db from "../arkiv/db.mjs";
import { downloadBytes, explorerLinks, storageConfig, uploadBytes } from "./storage.mjs";

const INDEX = "files";
export const MAX_FILE_BYTES = Number(process.env.ZG_FILE_MAX_MB || 300) * 1024 * 1024;
const MAX_CACHE_BYTES = Number(process.env.ARKIV_FILE_CACHE_MB || 256) * 1024 * 1024;

const idOf = (scope, name) => `${scope}/${name}`;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Bytes not on 0G yet (or, in memory-only mode, ever): key -> Buffer */
const uploading = new Map();
/** Recently read: key -> Buffer, oldest first */
const cache = new Map();
let cacheBytes = 0;

function remember(key, buf) {
  if (buf.length > MAX_CACHE_BYTES / 4) return;
  if (cache.has(key)) {
    cacheBytes -= cache.get(key).length;
    cache.delete(key);
  }
  cache.set(key, buf);
  cacheBytes += buf.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    cache.delete(k);
    cacheBytes -= v.length;
  }
}

/** Is 0G Storage set up to take files? (ZG_STORAGE=1 and ZG_STORAGE_PRIVATE_KEY) */
export const filesConfigured = () => {
  const c = storageConfig();
  return c.enabled && c.hasKey;
};

export function fileInfo(scope, name) {
  return db.get(INDEX, idOf(scope, name));
}

/** Every file of a scope as [name, info]. */
export function filesOf(scope) {
  const prefix = `${scope}/`;
  return db
    .entries(INDEX)
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, info]) => [id.slice(prefix.length), info]);
}

const writes = new Map(); // key -> Promise of the upload in flight

/**
 * Store a file. Returns its info at once; info.stored turns true when 0G has it.
 * The same bytes under the same name again: nothing is uploaded.
 */
export function putFile(scope, name, bytes, { mime = "application/octet-stream", kind = "file" } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length > MAX_FILE_BYTES) throw Object.assign(new Error(`${name} is ${Math.round(buf.length / 1048576)} MB; files can be at most ${Math.round(MAX_FILE_BYTES / 1048576)} MB.`), { status: 413 });
  if (!db.memoryOnly() && !filesConfigured()) throw Object.assign(new Error("Files are stored on 0G Storage: set ZG_STORAGE=1 and ZG_STORAGE_PRIVATE_KEY in backend/.env."), { status: 503 });
  const key = idOf(scope, name);
  const hash = sha256(buf);
  const prior = db.get(INDEX, key);
  if (prior?.sha256 === hash && (prior.stored || uploading.has(key))) return prior;
  const info = { scope, name, mime, kind, size: buf.length, sha256: hash, savedAt: new Date().toISOString(), stored: false, rootHash: null };
  db.put(INDEX, key, info);
  uploading.set(key, buf);
  remember(key, buf);
  if (db.memoryOnly()) return info;
  const run = uploadBytes(buf)
    .then(
      (r) => {
        // Only record it if nobody replaced the file meanwhile.
        const cur = db.get(INDEX, key);
        if (cur?.sha256 === hash) db.put(INDEX, key, { ...cur, stored: true, rootHash: r.rootHash, txHash: r.txHash ?? null, txSeq: r.txSeq ?? null, storedAt: new Date().toISOString(), error: undefined });
      },
      (e) => {
        const error = `${e?.code ? `${e.code}: ` : ""}${String(e?.message ?? e).slice(0, 220)}`;
        console.error(`[0g-files] ${key} didn't reach 0G Storage: ${error}`);
        const cur = db.get(INDEX, key);
        if (cur?.sha256 === hash) db.put(INDEX, key, { ...cur, error });
      },
    )
    .finally(() => {
      if (uploading.get(key) === buf) uploading.delete(key);
      if (writes.get(key) === run) writes.delete(key);
    });
  writes.set(key, run);
  return info;
}

/** The file's bytes, or null when there is no such file (or its upload never reached 0G). */
export async function getFile(scope, name) {
  const key = idOf(scope, name);
  const info = db.get(INDEX, key);
  if (!info) return null;
  const local = uploading.get(key) ?? cache.get(key);
  if (local && sha256(local) === info.sha256) return local;
  if (!info.rootHash) return null;
  const buf = Buffer.from(await downloadBytes(info.rootHash, { sha256: info.sha256 }));
  remember(key, buf);
  return buf;
}

/** Forget a file. 0G Storage is permanent: its bytes stay there, but nothing points at them any more. */
export function removeFile(scope, name) {
  const key = idOf(scope, name);
  uploading.delete(key);
  if (cache.has(key)) {
    cacheBytes -= cache.get(key).length;
    cache.delete(key);
  }
  return db.remove(INDEX, key);
}

export function removeScope(scope) {
  for (const [name] of filesOf(scope)) removeFile(scope, name);
}

/** Resolves when every file put so far is on 0G (or failed) and Arkiv has the index. */
export async function flushFiles() {
  while (writes.size) await Promise.allSettled([...writes.values()]);
  await db.flush();
}

/** Upload progress, for /api/health. */
export function filesStatus() {
  const all = db.list(INDEX);
  return {
    store: "0G Storage",
    configured: db.memoryOnly() || filesConfigured(),
    files: all.length,
    uploading: uploading.size && !db.memoryOnly() ? uploading.size : 0,
    failed: all.filter((f) => f.error && !f.stored).map((f) => ({ file: `${f.scope}/${f.name}`, error: f.error })),
  };
}

/** Where to see a stored file on the 0G explorers. */
export const fileLinks = (info) => (info?.rootHash ? explorerLinks(info) : null);

/** Send a stored file as an HTTP response (Range requests too, so videos can seek). */
export async function sendFile(req, res, scope, name, { headers = {} } = {}) {
  const info = fileInfo(scope, name);
  if (!info) return res.status(404).end();
  let buf;
  try {
    buf = await getFile(scope, name);
  } catch (e) {
    return res.status(502).json({ error: `Couldn't read the file from 0G Storage: ${String(e?.message ?? e).slice(0, 200)}` });
  }
  if (!buf) return res.status(404).json({ error: info.error ? `That file never reached 0G Storage (${info.error}).` : "That file isn't on 0G Storage yet." });
  res.set({ "content-type": info.mime, "accept-ranges": "bytes", "x-content-type-options": "nosniff", "x-content-sha256": info.sha256, ...(info.rootHash ? { "x-0g-root-hash": info.rootHash } : {}), ...headers });
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : buf.length - 1;
    start = Math.max(0, start);
    end = Math.min(buf.length - 1, end);
    if (start > end) return res.status(416).set("content-range", `bytes */${buf.length}`).end();
    res.status(206).set({ "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": String(end - start + 1) });
    return res.end(buf.subarray(start, end + 1));
  }
  res.set("content-length", String(buf.length));
  res.end(buf);
}
