/*
 * Write and read arena records on Arkiv, whatever their type (schemas.mjs).
 *
 *   writeRecord(type, attrs, payload)   skips an unchanged record (same hash), splits
 *                                       big payloads into parts, writes read-only entities
 *   readRecord(type, identity)          the newest record, payload reassembled
 *   listRecords(type, filters)          the newest record of each kind, columns only
 *
 * Only entities owned by the publisher wallet are trusted: anyone can write our tags.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { ExpirationTime } from "@arkiv-network/sdk";
import { and, asc, desc, eq } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/schema";
import { hexToBytes } from "viem";
import { canWrite, publicClient, publisher, ttlDays, walletClient } from "../arkiv.mjs";
import { RECORDS } from "./schemas.mjs";

export const PART_BYTES = 120_000; // under the 128 KiB a single entity's bytes may hold

const spec = (type) => {
  const s = RECORDS[type];
  if (!s) throw new Error(`Unknown Arkiv record type: ${type}`);
  return s;
};

const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** sha256 of the payload's JSON (64 hex). */
export const hashOf = (payload) => sha256Hex(JSON.stringify(payload));

/** Bytes -> parts of at most PART_BYTES (always at least one, possibly empty). */
function split(buf) {
  const parts = [];
  for (let i = 0; i < buf.length; i += PART_BYTES) parts.push(new Uint8Array(buf.subarray(i, i + PART_BYTES)));
  return parts.length ? parts : [new Uint8Array()];
}

/** Parts (hex or bytes, in order) -> one buffer. */
const join = (parts) => Buffer.concat(parts.map((p) => Buffer.from(typeof p === "string" ? hexToBytes(p) : p)));

/** Payload -> gzip JSON split into parts of at most PART_BYTES. */
export function encode(payload) {
  return split(zlib.gzipSync(Buffer.from(JSON.stringify(payload))));
}

/** Parts (hex or bytes, in order) -> payload. */
export function decode(parts) {
  return JSON.parse(zlib.gunzipSync(join(parts)).toString("utf8"));
}

const identityWhere = (type, attrs) => spec(type).identity.map((k) => eq(k, attrs[k]));

/**
 * Write one record. attrs are the typed column values (projectId, projectName and the
 * type's own columns). Returns { entityKeys, hash, skipped }.
 */
export async function writeRecord(type, attrs, payload, opts = {}) {
  return writeParts(type, attrs, hashOf(payload), encode(payload), "gzip-json", opts);
}

/**
 * Write a file's raw bytes (no compression: videos and JPEGs are compressed already).
 * Dedup by the file's own sha256, so an unchanged file is never uploaded twice.
 * onPart(i, n) reports progress.
 */
export async function writeBlob(type, attrs, buf, opts = {}) {
  return writeParts(type, attrs, sha256Hex(buf), split(buf), "raw", opts);
}

async function writeParts(type, attrs, hash, chunks, enc, { client = null, reader = null, onPart = null } = {}) {
  const { schema } = spec(type);
  if (!client && !canWrite()) throw new Error("Arkiv is not set up: set ARKIV_PRIVATE_KEY in backend/.env.");
  const r = reader ?? publicClient();
  const owner = publisher();
  // Unchanged since the last write: keep the existing entity.
  const same = await r
    .select({ $key: true })
    .from(schema)
    .ownedBy(owner)
    .where(and(...identityWhere(type, attrs), eq("hash", hash), eq("part", 0)))
    .limit(1)
    .fetch();
  if (same.entities.length) return { entityKeys: [same.entities[0].$key], hash, skipped: true };

  const w = client ?? walletClient();
  const writtenAt = u64(BigInt(Math.floor(Date.now() / 1000)));
  const options = { expiration: ExpirationTime.fromDays(ttlDays()), flags: { readonly: true } };
  const entityKeys = [];
  for (const [i, chunk] of chunks.entries()) {
    const values = { ...attrs, writtenAt, hash, part: i, parts: chunks.length, enc, payload: chunk };
    const { entityKey } = await w.createEntity(schema, values, options);
    entityKeys.push(entityKey);
    onPart?.(i + 1, chunks.length);
  }
  return { entityKeys, hash, skipped: false };
}

/** The publisher wallet whose entities reads trust. */
function readOwner() {
  const owner = publisher();
  if (!owner) throw new Error("Arkiv reads need ARKIV_PRIVATE_KEY or ARKIV_PUBLISHER in backend/.env.");
  return owner;
}

const selection = (type, withPayload) => Object.fromEntries([["$key", true], ["$owner", true], ["$expiresAt", true], ...spec(type).columnNames.filter((c) => withPayload || c !== "payload").map((c) => [c, true])]);

/** Row -> plain object of column values. */
const plain = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k.startsWith("$") ? (typeof v === "bigint" ? String(v) : v) : v == null ? null : typeof v.value === "bigint" ? String(v.value) : v.value]));

/** The newest record of this identity, with its payload, or null. */
export async function readRecord(type, identity, opts = {}) {
  const got = await readParts(type, identity, opts);
  if (!got) return null;
  return { ...got.columns, payload: decode(got.chunks) };
}

/** The newest file of this identity as { ...columns, buffer }, checked against its sha256; or null. */
export async function readBlob(type, identity, opts = {}) {
  const got = await readParts(type, identity, { ...opts, maxParts: 400 });
  if (!got) return null;
  const buffer = join(got.chunks);
  if (sha256Hex(buffer) !== got.columns.hash) throw new Error(`Arkiv ${type} ${got.columns.name ?? ""} doesn't match its hash.`);
  return { ...got.columns, buffer };
}

async function readParts(type, identity, { reader = null, maxParts = 100 } = {}) {
  const { schema } = spec(type);
  const owner = readOwner();
  const r = reader ?? publicClient();
  const { entities } = await r
    .select(selection(type, true))
    .from(schema)
    .ownedBy(owner)
    .where(and(...identityWhere(type, identity), eq("part", 0)))
    .orderBy(desc("writtenAt"))
    .limit(1)
    .fetch();
  const head = entities[0];
  if (!head) return null;
  const columns = plain(head);
  let chunks = [head.payload.value];
  if (columns.parts > 1) {
    // Page through the parts: the node returns at most 100 rows, and caps a response's
    // size (~120 KB parts come back as hex), so ask for a few at a time.
    const PAGE = 8;
    const byPart = new Map();
    for (let offset = 0; offset < Math.min(columns.parts, maxParts); offset += PAGE) {
      const page = await r
        .select({ $key: true, part: true, writtenAt: true, payload: true })
        .from(schema)
        .ownedBy(owner)
        .where(and(eq("hash", columns.hash), eq("writtenAt", u64(BigInt(columns.writtenAt)))))
        .orderBy(asc("part")) // a fixed order, so pages neither overlap nor skip
        .limit(PAGE)
        .offset(offset)
        .fetch();
      for (const e of page.entities) byPart.set(e.part.value, e.payload.value);
      if (page.entities.length < PAGE) break;
    }
    chunks = Array.from({ length: columns.parts }, (_, i) => byPart.get(i));
    if (chunks.some((c) => c == null)) throw new Error(`Arkiv ${type} record ${columns.hash} is missing parts.`);
  }
  delete columns.payload;
  return { columns, chunks };
}

/** First parts (one per record version) matching the filters, newest first, without payloads. */
export async function listRecords(type, filters = {}, { reader = null, limit = 50 } = {}) {
  const { schema } = spec(type);
  const owner = readOwner();
  const r = reader ?? publicClient();
  const where = [eq("part", 0), ...Object.entries(filters).map(([k, v]) => eq(k, v))];
  const { entities } = await r.select(selection(type, false)).from(schema).ownedBy(owner).where(and(...where)).orderBy(desc("writtenAt")).limit(limit).fetch();
  return entities.map(plain);
}
