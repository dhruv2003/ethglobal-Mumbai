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
import { and, desc, eq } from "@arkiv-network/sdk/query";
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

/** sha256 of the payload's JSON (64 hex). */
export const hashOf = (payload) => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

/** Payload -> gzip JSON split into parts of at most PART_BYTES. */
export function encode(payload) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  const parts = [];
  for (let i = 0; i < buf.length; i += PART_BYTES) parts.push(new Uint8Array(buf.subarray(i, i + PART_BYTES)));
  return parts.length ? parts : [new Uint8Array()];
}

/** Parts (hex or bytes, in order) -> payload. */
export function decode(parts) {
  const buf = Buffer.concat(parts.map((p) => Buffer.from(typeof p === "string" ? hexToBytes(p) : p)));
  return JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
}

const identityWhere = (type, attrs) => spec(type).identity.map((k) => eq(k, attrs[k]));

/**
 * Write one record. attrs are the typed column values (projectId, projectName and the
 * type's own columns). Returns { entityKeys, hash, skipped }.
 */
export async function writeRecord(type, attrs, payload, { client = null, reader = null } = {}) {
  const { schema } = spec(type);
  if (!client && !canWrite()) throw new Error("Arkiv is not set up: set ARKIV_PRIVATE_KEY in backend/.env.");
  const hash = hashOf(payload);
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
  const chunks = encode(payload);
  const writtenAt = u64(BigInt(Math.floor(Date.now() / 1000)));
  const options = { expiration: ExpirationTime.fromDays(ttlDays()), flags: { readonly: true } };
  const entityKeys = [];
  for (const [i, chunk] of chunks.entries()) {
    const values = { ...attrs, writtenAt, hash, part: i, parts: chunks.length, enc: "gzip-json", payload: chunk };
    const { entityKey } = await w.createEntity(schema, values, options);
    entityKeys.push(entityKey);
  }
  return { entityKeys, hash, skipped: false };
}

const selection = (type, withPayload) => Object.fromEntries([["$key", true], ["$owner", true], ["$expiresAt", true], ...spec(type).columnNames.filter((c) => withPayload || c !== "payload").map((c) => [c, true])]);

/** Row -> plain object of column values. */
const plain = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, k.startsWith("$") ? (typeof v === "bigint" ? String(v) : v) : v == null ? null : typeof v.value === "bigint" ? String(v.value) : v.value]));

/** The newest record of this identity, with its payload, or null. */
export async function readRecord(type, identity, { reader = null } = {}) {
  const { schema } = spec(type);
  const owner = publisher();
  if (!owner) throw new Error("Arkiv reads need ARKIV_PRIVATE_KEY or ARKIV_PUBLISHER in backend/.env.");
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
    const rest = await r
      .select({ $key: true, part: true, writtenAt: true, payload: true })
      .from(schema)
      .ownedBy(owner)
      .where(and(eq("hash", columns.hash), eq("writtenAt", u64(BigInt(columns.writtenAt)))))
      .limit(100)
      .fetch();
    const byPart = new Map(rest.entities.map((e) => [e.part.value, e.payload.value]));
    chunks = Array.from({ length: columns.parts }, (_, i) => byPart.get(i));
    if (chunks.some((c) => c == null)) throw new Error(`Arkiv ${type} record ${columns.hash} is missing parts.`);
  }
  delete columns.payload;
  return { ...columns, payload: decode(chunks) };
}

/** First parts (one per record version) matching the filters, newest first, without payloads. */
export async function listRecords(type, filters = {}, { reader = null, limit = 50 } = {}) {
  const { schema } = spec(type);
  const owner = publisher();
  if (!owner) throw new Error("Arkiv reads need ARKIV_PRIVATE_KEY or ARKIV_PUBLISHER in backend/.env.");
  const r = reader ?? publicClient();
  const where = [eq("part", 0), ...Object.entries(filters).map(([k, v]) => eq(k, v))];
  const { entities } = await r.select(selection(type, false)).from(schema).ownedBy(owner).where(and(...where)).orderBy(desc("writtenAt")).limit(limit).fetch();
  return entities.map(plain);
}
