/*
 * The arena's database, on Arkiv. Nothing is kept on this server's disk.
 *
 * Every record is a document in a collection ("events", "submissions", "reviews"...),
 * stored as battle-arena.doc entities owned by the publisher wallet (records/schemas.mjs):
 * gzip JSON, split into parts when it is over one entity's 128 KiB.
 *
 *   load()                 read the newest version of every document from Arkiv (at boot)
 *   get / list / entries   read (from what load() read, plus every write since)
 *   put / remove           change a document; it is written to Arkiv in the background
 *   flush()                wait until Arkiv has every write
 *
 * Reads don't go to Arkiv each time: a query takes ~0.5 s and a page needs dozens of
 * records. The copy in memory is only ever what Arkiv holds plus writes on their way there.
 *
 * Writes: Arkiv entities are read-only, so a change is a new version (the newest wins;
 * writtenAt is a strictly increasing millisecond clock). One wallet sends one transaction at
 * a time (~7 s each), so a document that changes again while its write waits is written once,
 * with the newest value. A delete is a newer version with deleted = 1.
 *
 * ARENA_DB=memory keeps everything in memory and never touches Arkiv (the default under node --test).
 */
import crypto from "node:crypto";
import { canWrite } from "./arkiv.mjs";
import { hashOf, listAllHeads, readRecord, writeRecord } from "./records/store.mjs";

const TYPE = "doc";
// Under `node --test` (NODE_TEST_CONTEXT is set) the database is memory-only unless ARENA_DB=arkiv.
export const memoryOnly = () => process.env.ARENA_DB === "memory" || (Boolean(process.env.NODE_TEST_CONTEXT) && process.env.ARENA_DB !== "arkiv");

/** collection -> Map(id -> value) */
const data = new Map();
/** "collection\0id" -> sha256 of the newest value Arkiv has (or is getting), for dedup */
const written = new Map();

const keyOf = (collection, id) => `${collection}\u0000${id}`;
const docIdOf = (id) => (Buffer.byteLength(String(id)) <= 128 ? String(id) : `sha256:${crypto.createHash("sha256").update(String(id)).digest("hex")}`);
const coll = (c) => {
  let m = data.get(c);
  if (!m) data.set(c, (m = new Map()));
  return m;
};
// Callers change what they read (a pipeline state, a list): hand out copies so the stored value
// only changes through put().
const copy = (v) => (v === undefined ? undefined : structuredClone(v));

let loaded = false;
let loading = null;

/** Read every document from Arkiv. Throws when Arkiv isn't set up: there is no other store. */
export function load({ log = (m) => console.log(m) } = {}) {
  if (loaded || memoryOnly()) {
    loaded = true;
    return Promise.resolve();
  }
  loading ??= (async () => {
    if (!canWrite()) throw new Error("The arena keeps all its data on Arkiv: set ARKIV_PRIVATE_KEY (or PUBLISHER_PRIVATE_KEY) in backend/.env.");
    const started = Date.now();
    const heads = await listAllHeads(TYPE);
    // The newest version of each document.
    const newest = new Map();
    for (const h of heads) {
      const k = keyOf(h.collection, h.docId);
      if (!newest.has(k) || Number(h.writtenAt) > Number(newest.get(k).writtenAt)) newest.set(k, h);
    }
    const live = [...newest.values()].filter((h) => !h.deleted);
    let next = 0;
    const worker = async () => {
      while (next < live.length) {
        const h = live[next++];
        const r = await readRecord(TYPE, { collection: h.collection, docId: h.docId });
        if (!r || r.deleted || !r.payload) continue;
        coll(h.collection).set(String(r.payload.id), r.payload.value);
        written.set(keyOf(h.collection, r.payload.id), hashOf(r.payload.value));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    lastAt = Math.max(lastAt, ...heads.map((h) => Number(h.writtenAt) || 0));
    loaded = true;
    log(`[arkiv-db] loaded ${live.length} documents (${heads.length} versions) from Arkiv in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const ensureLoaded = () => {
  if (!loaded && !memoryOnly()) throw new Error("The Arkiv database isn't loaded yet (call load() first).");
};

export function get(collection, id) {
  ensureLoaded();
  return copy(data.get(collection)?.get(String(id)) ?? null);
}

export function has(collection, id) {
  ensureLoaded();
  return Boolean(data.get(collection)?.has(String(id)));
}

/** Every [id, value] of a collection. */
export function entries(collection) {
  ensureLoaded();
  return [...(data.get(collection)?.entries() ?? [])].map(([id, v]) => [id, copy(v)]);
}

export const list = (collection) => entries(collection).map(([, v]) => v);

/** Save a document. Returns the value. */
export function put(collection, id, value) {
  ensureLoaded();
  if (value === undefined) throw new Error(`Can't store undefined as ${collection}/${id}.`);
  coll(collection).set(String(id), copy(value));
  queueWrite(collection, String(id), value, false);
  return value;
}

/** Delete a document (Arkiv keeps the old versions until they expire; reads never see them). */
export function remove(collection, id) {
  ensureLoaded();
  const had = coll(collection).delete(String(id));
  if (had || written.has(keyOf(collection, id))) queueWrite(collection, String(id), null, true);
  return had;
}

/* ---------------- writes to Arkiv ---------------- */

const pending = new Map(); // key -> { collection, id, value, deleted, attempts }
const order = []; // keys, oldest first
const failed = new Map(); // key -> { collection, id, error, at }
let worker = null;
let lastAt = 0;
let stats = { written: 0, skipped: 0 };
const idleWaiters = [];

const MAX_ATTEMPTS = 6;

function queueWrite(collection, id, value, deleted) {
  if (memoryOnly()) return;
  const k = keyOf(collection, id);
  const hash = deleted ? "deleted" : hashOf(value);
  if (!pending.has(k) && written.get(k) === hash) {
    stats.skipped++;
    return; // Arkiv already has exactly this
  }
  if (!pending.has(k)) order.push(k);
  // Snapshot now: the caller may keep changing its object.
  pending.set(k, { collection, id, value: deleted ? null : structuredClone(value), deleted, hash, attempts: pending.get(k)?.attempts ?? 0 });
  failed.delete(k);
  worker ??= drain().finally(() => {
    worker = null;
    if (!pending.size) idleWaiters.splice(0).forEach((r) => r());
  });
}

async function drain() {
  while (order.length) {
    const k = order.shift();
    const job = pending.get(k);
    if (!job) continue;
    pending.delete(k);
    lastAt = Math.max(Date.now(), lastAt + 1);
    try {
      await writeRecord(TYPE, { collection: job.collection, docId: docIdOf(job.id), deleted: job.deleted ? 1 : 0 }, job.deleted ? null : { id: job.id, value: job.value }, { dedupe: false, writtenAt: lastAt });
      written.set(k, job.hash);
      stats.written++;
    } catch (e) {
      const error = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
      if (pending.has(k)) continue; // a newer value is already waiting: that write replaces this one
      if (job.attempts + 1 >= MAX_ATTEMPTS) {
        failed.set(k, { collection: job.collection, id: job.id, error, at: new Date().toISOString() });
        console.error(`[arkiv-db] gave up writing ${job.collection}/${job.id}: ${error}`);
        continue;
      }
      console.warn(`[arkiv-db] writing ${job.collection}/${job.id} failed (${error}); trying again`);
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** job.attempts)));
      if (!pending.has(k)) {
        order.push(k);
        pending.set(k, { ...job, attempts: job.attempts + 1 });
      }
    }
  }
}

/** Resolves once Arkiv has every write made so far (or gave up on it: see status().failed). */
export function flush() {
  if (!worker && !pending.size) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

/** What the database is doing, for /api/health. */
export function status() {
  return {
    backend: memoryOnly() ? "memory" : "arkiv",
    loaded,
    collections: Object.fromEntries([...data].map(([c, m]) => [c, m.size])),
    pendingWrites: pending.size,
    written: stats.written,
    failed: [...failed.values()],
  };
}

/** Tests: start empty. */
export function resetForTests() {
  data.clear();
  written.clear();
  pending.clear();
  order.length = 0;
  failed.clear();
  stats = { written: 0, skipped: 0 };
}
