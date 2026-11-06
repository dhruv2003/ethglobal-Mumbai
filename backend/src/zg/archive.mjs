/*
 * Write-through archive of everything the arena produces onto 0G Storage.
 *
 * The local JSON files stay the fast read path. Every store write also lands
 * here as an outbox item (data/zg-outbox.json); a background worker uploads it
 * to 0G and records the result in data/zg-manifest.json:
 *
 *   records["<kind>:<id>"] = { rootHash, txHash, txSeq, sha256, size, uploadedAt, history: [rootHash...] }
 *
 * Every JSON record goes up wrapped in an envelope whose `prev` is the root hash
 * of the previous version of the same kind+id, so the versions form a chain.
 * The manifest itself is uploaded (debounced) as kind "manifest"; its latest root
 * hash goes in data/zg-head.json. That one hash is enough to rebuild data/.
 *
 * A 0G failure never fails or slows the caller: archive() only appends to the
 * outbox. Retries back off exponentially; after ZG_STORAGE_MAX_ATTEMPTS the item
 * is "failed" with the reason kept, until POST /api/storage/flush retries it.
 * Several processes (server + `npm run judge`) can share one data/ folder: every
 * outbox/manifest change is a locked read-modify-write.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, readJSON, safeId, writeJSON } from "../datafiles.mjs";
import { contentSha256, downloadBytes, downloadJSON, explorerLinks, storageConfig, uploadBytes, uploadFile, uploadJSON, ZgStorageError, sha256 } from "./storage.mjs";

export const SCHEMA = "arena.v1";
const OUTBOX = "zg-outbox.json";
const MANIFEST = "zg-manifest.json";
const HEAD = "zg-head.json";
const SPOOL = "zg-spool";
const INSTANCE = `${process.pid}:${crypto.randomUUID().slice(0, 8)}`;

const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
const opts = () => ({
  maxAttempts: num(process.env.ZG_STORAGE_MAX_ATTEMPTS, 10),
  backoffMs: num(process.env.ZG_STORAGE_BACKOFF_MS, 5_000),
  maxBackoffMs: num(process.env.ZG_STORAGE_MAX_BACKOFF_MS, 10 * 60_000),
  manifestDebounceMs: num(process.env.ZG_STORAGE_MANIFEST_DEBOUNCE_MS, 30_000),
});
export const enabled = () => storageConfig().enabled;

let appCommit;
function commit() {
  if (appCommit !== undefined) return appCommit;
  try {
    appCommit = execSync("git rev-parse HEAD", { cwd: path.dirname(new URL(import.meta.url).pathname), stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    appCommit = null;
  }
  return appCommit;
}

// ---------- a cross-process lock around outbox/manifest edits ----------

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withLock(fn) {
  const lock = path.join(DATA_DIR, ".zg-lock");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (let i = 0; ; i++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmdirSync(lock); // left by a crashed process
      } catch {
        /* gone already */
      }
      if (i > 2000) throw new Error("data/.zg-lock is stuck");
      sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(lock);
  }
}

const loadOutbox = () => readJSON(OUTBOX, { seq: 0, items: [] });
const emptyManifest = () => ({ network: storageConfig().network, updatedAt: null, records: {} });
export const loadManifest = () => readJSON(MANIFEST, emptyManifest());
export const loadHead = () => readJSON(HEAD, null);
const keyOf = (kind, id) => `${kind}:${id}`;

// ---------- secrets never leave the server ----------

/** Values that must never appear in an upload (raw and without a 0x prefix). */
function secretValues() {
  const names = ["ZG_API_KEY", "ADMIN_TOKEN", "ZG_STORAGE_PRIVATE_KEY", "ZG_STORAGE_AES_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
  const out = [];
  for (const n of names) {
    const v = process.env[n];
    if (!v || v.length < 8) continue;
    out.push(v);
    if (v.startsWith("0x")) out.push(v.slice(2));
  }
  return out;
}
function assertNoSecrets(buf) {
  const s = Buffer.from(buf).toString("latin1");
  for (const v of secretValues()) if (s.includes(v)) throw new ZgStorageError("Refusing to upload: the content contains a server secret.", "secret_detected");
}

// ---------- enqueue ----------

/**
 * Archive a JSON record. Writes nothing to 0G now: it appends to the outbox and
 * wakes the worker. Skips the upload when the content equals the latest stored
 * or queued version of the same record.
 */
export function archive(kind, id, payload) {
  if (!enabled()) return null;
  const hash = contentSha256(payload);
  const item = withLock(() => {
    const ob = loadOutbox();
    const key = keyOf(kind, id);
    const queued = ob.items.filter((i) => i.key === key && i.status !== "failed").at(-1);
    const stored = loadManifest().records[key];
    if ((queued ? queued.sha256 : stored?.sha256) === hash) return null;
    const it = { seq: ++ob.seq, key, kind, id: String(id), sha256: hash, payload, createdAt: new Date().toISOString(), status: "pending", attempts: 0, nextAttemptAt: 0 };
    ob.items.push(it);
    writeJSON(OUTBOX, ob);
    return it;
  });
  if (item) kick();
  return item;
}

/**
 * Archive a file as-is (fixture media, screenshots). With { encrypt: true } it is
 * AES-256 encrypted on upload; { spool: true } copies the bytes into data/zg-spool
 * first (deleted after upload), for content that otherwise lives only in memory.
 */
export function archiveFile(kind, id, file, { encrypt = false, contentType = null, bytes = null } = {}) {
  if (!enabled()) return null;
  let filePath = file;
  let hash;
  let size;
  let spooled = false;
  if (bytes) {
    hash = sha256(bytes);
    size = bytes.length;
  } else {
    const buf = fs.readFileSync(filePath);
    hash = sha256(buf);
    size = buf.length;
  }
  const key = keyOf(kind, id);
  const dup = withLock(() => {
    const queued = loadOutbox().items.filter((i) => i.key === key && i.status !== "failed").at(-1);
    return (queued ? queued.sha256 : loadManifest().records[key]?.sha256) === hash;
  });
  if (dup) return null;
  if (bytes) {
    fs.mkdirSync(path.join(DATA_DIR, SPOOL), { recursive: true, mode: 0o700 });
    filePath = path.join(DATA_DIR, SPOOL, `${safeId(kind)}-${safeId(id)}-${hash.slice(0, 12)}`);
    fs.writeFileSync(filePath, bytes, { mode: 0o600 });
    spooled = true;
  }
  const item = withLock(() => {
    const ob = loadOutbox();
    const it = { seq: ++ob.seq, key, kind, id: String(id), sha256: hash, size, file: filePath, spooled, encrypt, contentType, createdAt: new Date().toISOString(), status: "pending", attempts: 0, nextAttemptAt: 0 };
    ob.items.push(it);
    writeJSON(OUTBOX, ob);
    return it;
  });
  kick();
  return item;
}

// ---------- the worker ----------

let timer = null;
let timerAt = Infinity;
let working = null;
let manifestTimer = null;

/** Wake the worker after `delay` ms (keeps the earliest wake-up). */
export function kick(delay = 0) {
  if (!enabled()) return;
  const at = Date.now() + Math.max(0, delay);
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    timerAt = Infinity;
    tick();
  }, Math.max(0, delay));
  timer.unref?.();
}

const alive = (owner) => {
  const pid = Number(String(owner ?? "").split(":")[0]);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Claim the next due item: oldest first, never two versions of one record at once. */
function claim() {
  return withLock(() => {
    const ob = loadOutbox();
    const now = Date.now();
    const staleMs = storageConfig().timeoutMs + 60_000;
    const busyKeys = new Set();
    for (const it of ob.items) {
      if (it.status === "uploading") {
        const orphan = it.owner !== INSTANCE && (!alive(it.owner) || now - Date.parse(it.claimedAt) > staleMs);
        if (orphan) it.status = "pending";
        else {
          busyKeys.add(it.key);
          continue;
        }
      }
      if (it.status !== "pending") continue;
      if (busyKeys.has(it.key)) continue;
      busyKeys.add(it.key); // later versions of this record wait for this one
      if (it.nextAttemptAt > now) continue;
      it.status = "uploading";
      it.owner = INSTANCE;
      it.claimedAt = new Date().toISOString();
      writeJSON(OUTBOX, ob);
      return it;
    }
    writeJSON(OUTBOX, ob);
    return null;
  });
}

function nextWake() {
  const ob = loadOutbox();
  const due = ob.items.filter((i) => i.status === "pending").map((i) => i.nextAttemptAt || 0);
  return due.length ? Math.max(0, Math.min(...due) - Date.now()) : null;
}

/** Build the bytes for one item and upload them. */
async function uploadItem(it) {
  if (it.file) {
    if (!fs.existsSync(it.file)) throw new ZgStorageError(`File is gone: ${path.basename(it.file)}`, "upload_failed");
    const buf = fs.readFileSync(it.file);
    if (sha256(buf) !== it.sha256) throw new ZgStorageError(`File changed since it was queued: ${path.basename(it.file)}`, "hash_mismatch");
    if (!it.encrypt) assertNoSecrets(buf);
    const res = it.encrypt ? await uploadBytes(buf, { encrypt: true }) : await uploadFile(it.file);
    return { ...res, sha256: it.sha256 };
  }
  const prev = it.kind === "manifest" ? (loadHead()?.rootHash ?? null) : (loadManifest().records[it.key]?.rootHash ?? null);
  const snapshotAt = new Date().toISOString();
  const data = it.kind === "manifest" ? manifestSnapshot() : it.payload;
  const envelope = { schema: SCHEMA, kind: it.kind, id: it.id, createdAt: it.createdAt, prev, app: { commit: commit() }, data };
  assertNoSecrets(Buffer.from(JSON.stringify(envelope)));
  const res = await uploadJSON(envelope);
  if (it.kind === "manifest") return { ...res, sha256: contentSha256(data), prev, snapshotAt, records: Object.keys(data.records).length };
  return { ...res, sha256: it.sha256, prev };
}

function manifestSnapshot() {
  const m = loadManifest();
  return { network: m.network, updatedAt: m.updatedAt, records: m.records };
}

function recordSuccess(it, res) {
  withLock(() => {
    const now = new Date().toISOString();
    const ob = loadOutbox();
    if (it.kind === "manifest") {
      const prevHead = loadHead();
      writeJSON(HEAD, { rootHash: res.rootHash, txHash: res.txHash, txSeq: res.txSeq, uploadedAt: now, network: storageConfig().network, records: res.records, prev: prevHead?.rootHash ?? null });
      // Records stored while this manifest was uploading still need the next one.
      ob.manifestDirty = Boolean(ob.lastRecordAt && ob.lastRecordAt > res.snapshotAt);
    } else {
      const m = loadManifest();
      const old = m.records[it.key];
      m.network = storageConfig().network;
      m.updatedAt = now;
      m.records[it.key] = {
        kind: it.kind,
        id: it.id,
        rootHash: res.rootHash,
        txHash: res.txHash,
        txSeq: res.txSeq,
        sha256: res.sha256,
        size: res.size,
        uploadedAt: now,
        ...(it.file ? { file: true, contentType: it.contentType ?? undefined, encrypted: Boolean(it.encrypt) } : {}),
        history: [...(old?.history ?? []), res.rootHash],
      };
      writeJSON(MANIFEST, m);
      ob.manifestDirty = true;
      ob.lastRecordAt = now;
    }
    ob.items = ob.items.filter((x) => x.seq !== it.seq);
    writeJSON(OUTBOX, ob);
  });
  if (it.spooled) fs.rmSync(it.file, { force: true });
  if (it.kind !== "manifest") scheduleManifest();
}

function recordFailure(it, err) {
  const o = opts();
  withLock(() => {
    const ob = loadOutbox();
    const x = ob.items.find((i) => i.seq === it.seq);
    if (!x) return;
    x.attempts += 1;
    x.lastError = { code: err.code ?? "upload_failed", message: String(err.message).slice(0, 300), at: new Date().toISOString() };
    const permanent = err.code === "secret_detected";
    if (permanent || x.attempts >= o.maxAttempts) {
      x.status = "failed";
      if (x.spooled && permanent) fs.rmSync(x.file, { force: true });
    } else {
      x.status = "pending";
      const jitter = 0.8 + Math.random() * 0.4;
      x.nextAttemptAt = Date.now() + Math.min(o.maxBackoffMs, o.backoffMs * 2 ** (x.attempts - 1)) * jitter;
    }
    delete x.owner;
    ob.lastError = { key: x.key, ...x.lastError };
    writeJSON(OUTBOX, ob);
  });
  console.warn(`[0g-storage] ${it.key} upload failed (${err.code ?? "error"}): ${String(err.message).slice(0, 160)}`);
}

async function processOne(it) {
  try {
    recordSuccess(it, await uploadItem(it));
    return true;
  } catch (e) {
    recordFailure(it, e);
    return false;
  }
}

/** Upload everything that is due, one at a time. Safe to call repeatedly. */
export function tick() {
  if (!enabled()) return Promise.resolve();
  if (working) return working;
  working = (async () => {
    for (;;) {
      const it = claim();
      if (!it) break;
      await processOne(it);
    }
  })().finally(() => {
    working = null;
    const wake = nextWake();
    if (wake != null) kick(wake);
  });
  return working;
}

/** Queue a manifest upload after the debounce window (at most one queued at a time). */
export function scheduleManifest(delay = opts().manifestDebounceMs) {
  if (!enabled() || manifestTimer) return;
  manifestTimer = setTimeout(() => {
    manifestTimer = null;
    queueManifest();
  }, delay);
  manifestTimer.unref?.();
}

function queueManifest() {
  const added = withLock(() => {
    const ob = loadOutbox();
    if (!ob.manifestDirty) return false;
    if (ob.items.some((i) => i.kind === "manifest" && (i.status === "pending" || i.status === "uploading"))) return false;
    if (!Object.keys(loadManifest().records).length) return false;
    ob.items.push({ seq: ++ob.seq, key: "manifest:head", kind: "manifest", id: "head", createdAt: new Date().toISOString(), status: "pending", attempts: 0, nextAttemptAt: 0 });
    writeJSON(OUTBOX, ob);
    return true;
  });
  if (added) kick();
  return added;
}

/**
 * Wait until nothing is pending (CLI scripts call this before exiting), then
 * upload the manifest right away. Returns the outbox counts left over.
 */
export async function drain({ timeoutMs = 10 * 60_000, manifest = true } = {}) {
  if (!enabled()) return counts();
  const until = Date.now() + timeoutMs;
  const pendingLeft = () => loadOutbox().items.some((i) => i.status === "pending" || i.status === "uploading");
  while (Date.now() < until) {
    await tick();
    if (!pendingLeft()) {
      if (manifest && queueManifest()) continue;
      break;
    }
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(50, nextWake() ?? 1000))));
  }
  clearTimeout(manifestTimer);
  manifestTimer = null;
  return counts();
}

/** Retry failed items now (organizer action). */
export function flush() {
  if (!enabled()) return counts();
  const n = withLock(() => {
    const ob = loadOutbox();
    let k = 0;
    for (const it of ob.items) {
      if (it.status === "failed" && it.lastError?.code !== "secret_detected") {
        it.status = "pending";
        it.attempts = 0;
        it.nextAttemptAt = 0;
        k++;
      } else if (it.status === "pending") it.nextAttemptAt = 0;
    }
    writeJSON(OUTBOX, ob);
    return k;
  });
  kick();
  return { retried: n, ...counts() };
}

// ---------- status ----------

export function counts() {
  const ob = loadOutbox();
  const c = { pending: 0, uploading: 0, failed: 0 };
  for (const i of ob.items) c[i.status] = (c[i.status] ?? 0) + 1;
  return { ...c, lastError: ob.lastError ?? null };
}

/**
 * What the UI shows for one record: off | pending | stored | failed, with the
 * root hash and explorer links of the latest stored version.
 */
export function statusOf(kind, id) {
  if (!enabled()) return { status: "off" };
  const key = keyOf(kind, id);
  const latest = loadOutbox().items.filter((i) => i.key === key).at(-1);
  const stored = loadManifest().records[key];
  const base = stored ? { rootHash: stored.rootHash, txHash: stored.txHash, txSeq: stored.txSeq, uploadedAt: stored.uploadedAt, versions: stored.history.length, links: explorerLinks(stored) } : {};
  if (latest?.status === "failed") return { status: "failed", error: latest.lastError?.message ?? null, ...base };
  if (latest) return { status: "pending", attempts: latest.attempts, error: latest.lastError?.message ?? null, ...base };
  if (stored) return { status: "stored", ...base };
  return { status: "pending" };
}

/** Is this root hash one of ours (a record version, or a manifest head)? */
export function isKnownRoot(rootHash) {
  const r = String(rootHash).toLowerCase();
  const head = loadHead();
  if (head?.rootHash?.toLowerCase() === r) return { kind: "manifest" };
  for (const rec of Object.values(loadManifest().records)) {
    if (rec.history.some((h) => h.toLowerCase() === r)) return rec;
  }
  return null;
}

// ---------- verify ----------

/**
 * Download the stored copy of one record, check it against its 0G root and the
 * manifest hash, and compare its content with the local value.
 */
export async function verifyRecord(kind, id, localValue, { localBytes } = {}) {
  const rec = loadManifest().records[keyOf(kind, id)];
  if (!rec) throw new ZgStorageError(`${kind}:${id} is not on 0G yet.`, "not_found");
  const out = { kind, id, rootHash: rec.rootHash, txHash: rec.txHash, txSeq: rec.txSeq, links: explorerLinks(rec), manifestSha256: rec.sha256, versions: rec.history.length };
  try {
    return await compare(rec, out, localValue, localBytes);
  } catch (e) {
    // The copy on 0G doesn't hash to its root, or isn't what we stored: report, don't throw.
    if (e.code === "hash_mismatch") return { ...out, match: false, reason: e.message, localSha256: null, remoteSha256: null };
    throw e;
  }
}

async function compare(rec, out, localValue, localBytes) {
  if (rec.file) {
    // Encrypted files are decrypted with our key; their sha256 is of the plaintext.
    const canDecrypt = rec.encrypted && storageConfig().hasAesKey;
    const bytes = await downloadBytes(rec.rootHash, { decrypt: canDecrypt });
    const remoteSha256 = rec.encrypted && !canDecrypt ? null : sha256(bytes);
    const localSha256 = localBytes ? sha256(localBytes) : null;
    return { ...out, encrypted: Boolean(rec.encrypted), localSha256, remoteSha256, match: remoteSha256 === rec.sha256 && (localSha256 == null || localSha256 === remoteSha256) };
  }
  const env = await downloadJSON(rec.rootHash);
  const remoteSha256 = contentSha256(env.data);
  const localSha256 = localValue === undefined ? null : contentSha256(localValue);
  return { ...out, localSha256, remoteSha256, prev: env.prev ?? null, match: remoteSha256 === rec.sha256 && (localSha256 == null || localSha256 === remoteSha256) };
}

// ---------- restore ----------

/** Where each restorable kind lives under data/. */
export const RESTORE_KINDS = {
  judges: () => "judges.json",
  review: (id) => `reviews/${safeId(id)}.json`,
  evidence: (id) => `evidence/${safeId(id)}.json`,
  "voice-note": (id) => `voice-notes/${safeId(id)}.json`,
  submission: null, // collected into submissions.json
};

/**
 * Rebuild a data/ folder from the 0G head manifest alone. Only reads 0G.
 * Returns { manifest, written: [paths], records }.
 */
export async function restoreFromHead(headRoot, intoDir, { log = () => {} } = {}) {
  const head = await downloadJSON(headRoot);
  if (head.schema !== SCHEMA || head.kind !== "manifest") throw new ZgStorageError(`${headRoot} is not an arena manifest.`, "hash_mismatch");
  const manifest = head.data;
  if (!manifest?.records) throw new ZgStorageError("Manifest has no records.", "hash_mismatch");
  fs.mkdirSync(intoDir, { recursive: true });
  const written = [];
  const subs = [];
  for (const rec of Object.values(manifest.records)) {
    if (!(rec.kind in RESTORE_KINDS)) continue;
    const env = await downloadJSON(rec.rootHash);
    if (contentSha256(env.data) !== rec.sha256) throw new ZgStorageError(`${rec.kind}:${rec.id} content doesn't match the manifest.`, "hash_mismatch");
    log(`  ${rec.kind}:${rec.id} <- ${rec.rootHash}`);
    if (rec.kind === "submission") subs.push(env.data);
    else {
      const file = RESTORE_KINDS[rec.kind](rec.id);
      writeJSON(file, env.data, intoDir);
      written.push(file);
    }
  }
  if (subs.length) {
    subs.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    writeJSON("submissions.json", subs, intoDir);
    written.push("submissions.json");
  }
  writeJSON(MANIFEST, manifest, intoDir);
  writeJSON(HEAD, { rootHash: headRoot, restoredAt: new Date().toISOString() }, path.join(intoDir, ".restore"));
  return { manifest, written, records: Object.keys(manifest.records).length };
}

/** Default restore target: a fresh temp dir. */
export const freshRestoreDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "arena-restore-"));

// ---------- backfill ----------

let started = false;
/**
 * On boot: queue any local record that 0G doesn't have yet (data written while
 * ZG_STORAGE was off), and resume the outbox left by an earlier process.
 * `local` maps kind -> () => [[id, value]...] and comes from the store.
 */
export function start(local) {
  if (!enabled() || started) return;
  started = true;
  const m = loadManifest();
  for (const [kind, list] of Object.entries(local)) {
    for (const [id, value] of list()) {
      if (m.records[keyOf(kind, id)]?.sha256 !== contentSha256(value)) archive(kind, id, value);
    }
  }
  // A restart is a good moment to retry: pending items don't wait out the old backoff.
  const ob = withLock(() => {
    const o = loadOutbox();
    for (const it of o.items) if (it.status === "pending") it.nextAttemptAt = 0;
    writeJSON(OUTBOX, o);
    return o;
  });
  if (ob.manifestDirty) scheduleManifest();
  kick();
}
