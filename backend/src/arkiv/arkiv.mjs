/*
 * Arkiv: every judged run is published as public, read-only records anyone can
 * query and check against the arena's publisher wallet.
 *
 *   battle-arena.panel      one per run: project, panel score, when, and the Swarm
 *                           reference of the evidence bundle (field swarmRef)
 *   battle-arena.scorecard  one per judge per run, linked to its panel by key
 *
 * Owner: the arena's publisher wallet. Entities are created
 * readonly, so a published score can't be edited (PRD REC-09), and expire after
 * ARKIV_TTL_DAYS (default 120: PRD DAT-05 keeps evidence 90+ days after an event).
 *
 *   ARKIV_PRIVATE_KEY  optional dedicated test wallet that writes (fund it with tGLM)
 *   PUBLISHER_PRIVATE_KEY  existing arena publisher wallet; used when ARKIV_PRIVATE_KEY is absent
 *   ARKIV_ACCESS_KEY   RPC access key (hub.arkiv.network/access-keys); without it the
 *                      rate-limited public RPC is used
 *   ARKIV_PUBLISHER    address to read from when this server doesn't write (optional)
 */
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { bool, dec, defineSchema, i32, key, str, u64 } from "@arkiv-network/sdk/schema";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gatewayUrl } from "./swarm.mjs";

export const EXPLORER = "https://rabdi.explorer.arkiv.network";
const TTL_DAYS = Number(process.env.ARKIV_TTL_DAYS || 120);
const BLOCK_SECONDS = 2;

export const Panels = defineSchema("battle-arena.panel", {
  projectId: str().indexed(),
  runAt: u64().indexed(), // unix seconds
  panelScore: dec().indexed(), // 0.00-100.00
  complete: bool().indexed(), // all three judges scored
  judges: i32(),
  provider: str(),
  model: str(),
  swarmRef: str().optional(), // Swarm collection reference (64 hex, unencrypted)
  projectName: str().indexed().optional(),
});

export const Scorecards = defineSchema("battle-arena.scorecard", {
  panel: key().indexed(), // the battle-arena.panel entity of this run
  projectId: str().indexed(),
  judgeId: str().indexed(),
  status: str().indexed(), // scored | invalid | declined | error
  overall: dec().indexed().optional(), // only when scored
  judgeName: str(),
  headline: str().optional(),
  projectName: str().indexed().optional(),
});

/** Integer hundredths -> exact decimal string ("7233" -> "72.33"), no floats. */
export function hundredthsToDec(h) {
  const n = Math.trunc(h);
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Cut a string to Arkiv's 128-byte str limit without splitting a character. */
export function clip128(s) {
  let out = "";
  let bytes = 0;
  for (const ch of String(s ?? "")) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 128) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** Explorer link that runs a query (the explorer's entity search takes the query language). */
export const explorerQuery = (q) => `${EXPLORER}/entity-explorer?q=${encodeURIComponent(q)}`;
export const explorerEntity = (k) => explorerQuery(`$key = key(${k})`);

const chain = () => rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
// An access key only identifies/rate-limits RPC calls; a wallet key signs writes.
// Prefer a dedicated Arkiv key, but reuse the arena publisher signer when configured.
const signingKey = () => process.env.ARKIV_PRIVATE_KEY || process.env.PUBLISHER_PRIVATE_KEY || null;
/** MetaMask exports keys without "0x"; viem needs it. Accept both, and stray quotes or spaces. */
export function normalizeKey(raw) {
  const k = String(raw).trim().replace(/^["']|["']$/g, "");
  const hex = k.startsWith("0x") || k.startsWith("0X") ? k.slice(2) : k;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("ARKIV_PRIVATE_KEY must be 64 hex characters (with or without 0x).");
  return `0x${hex}`;
}
const account = () => {
  const value = signingKey();
  return value ? privateKeyToAccount(normalizeKey(value)) : null;
};

/** The wallet whose entities this server trusts and shows. */
export const publisher = () => account()?.address ?? process.env.ARKIV_PUBLISHER ?? null;
export const canWrite = () => Boolean(signingKey());
export const canRead = () => Boolean(publisher());

let pub;
export const publicClient = () => (pub ??= createPublicClient({ chain: chain(), transport: http() }));
let wal;
// One wallet, one queue: writes from parallel background jobs would otherwise race for the same nonce.
let tail = Promise.resolve();
const serial = (fn) => {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
};
export const walletClient = () => {
  wal ??= createWalletClient({ chain: chain(), transport: http(), account: account() });
  return { createEntity: (...args) => serial(() => wal.createEntity(...args)) };
};
export const ttlDays = () => TTL_DAYS;

/** Entity values for one run (pure; tested). */
export function panelValues(projectId, result, swarmRef, projectName) {
  return {
    projectId: clip128(projectId),
    runAt: u64(BigInt(Math.floor(new Date(result.ranAt).getTime() / 1000))),
    panelScore: dec(hundredthsToDec(result.panelHundredths)),
    complete: Boolean(result.complete),
    judges: result.reviews.length,
    provider: clip128(result.provider),
    model: clip128(result.model),
    ...(swarmRef ? { swarmRef } : {}),
    ...(projectName ? { projectName: clip128(projectName) } : {}),
  };
}

export function scorecardValues(projectId, panelKey, r, projectName) {
  return {
    panel: key(panelKey),
    projectId: clip128(projectId),
    judgeId: clip128(r.judge.id),
    status: r.status,
    ...(r.status === "scored" ? { overall: dec(hundredthsToDec(r.overallHundredths)) } : {}),
    judgeName: clip128(r.judge.name),
    ...(r.review?.headline ? { headline: clip128(r.review.headline) } : {}),
    ...(projectName ? { projectName: clip128(projectName) } : {}),
  };
}

/**
 * Write one panel entity and one scorecard per judge. Returns the keys and tx hashes.
 * opts.client replaces the wallet client (tests).
 */
export async function publishPanel(projectId, result, { swarmRef = null, projectName = null, client = null } = {}) {
  if (!client && !canWrite()) throw new Error("Arkiv is not set up: set ARKIV_PRIVATE_KEY or PUBLISHER_PRIVATE_KEY in backend/.env.");
  if (result.panelHundredths == null) throw new Error("Nothing to publish: no judge scored this run.");
  const w = client ?? walletClient();
  const options = { expiration: ExpirationTime.fromDays(TTL_DAYS), flags: { readonly: true } };
  const panel = await w.createEntity(Panels, panelValues(projectId, result, swarmRef, projectName), options);
  const scorecards = [];
  for (const r of result.reviews) {
    const s = await w.createEntity(Scorecards, scorecardValues(projectId, panel.entityKey, r, projectName), options);
    scorecards.push({ judgeId: r.judge.id, entityKey: s.entityKey, txHash: s.txHash });
  }
  return { panelKey: panel.entityKey, txHash: panel.txHash, expiresAt: String(panel.expiresAt), scorecards };
}

const v = (col) => (col == null ? null : col.value);

/**
 * Read the latest published panel for a project, and its scorecards, from Arkiv.
 * Only entities owned by the publisher wallet count: anyone can write with our schema tag.
 * Returns null when there is none.
 */
export async function readLatest(projectId, { client = null } = {}) {
  const owner = publisher();
  if (!owner) throw new Error("Arkiv reads need a signer (ARKIV_PRIVATE_KEY or PUBLISHER_PRIVATE_KEY) or ARKIV_PUBLISHER in backend/.env.");
  const c = client ?? publicClient();
  const { entities } = await c
    .select({ $key: true, $owner: true, $expiresAt: true, projectId: true, runAt: true, panelScore: true, complete: true, judges: true, provider: true, model: true, swarmRef: true })
    .from(Panels)
    .ownedBy(owner)
    .where(eq("projectId", clip128(projectId)))
    .orderBy(desc("runAt"))
    .limit(1)
    .fetch();
  const p = entities[0];
  if (!p) return null;
  const cards = await c
    .select({ $key: true, judgeId: true, judgeName: true, status: true, overall: true, headline: true })
    .from(Scorecards)
    .ownedBy(owner)
    .where(eq("panel", key(p.$key)))
    .fetch();
  const { currentBlock, currentBlockTime, blockDuration } = await c.getBlockTiming();
  const expiresUnix = Number(currentBlockTime) + Number(BigInt(p.$expiresAt) - BigInt(currentBlock)) * Number(blockDuration || BLOCK_SECONDS);
  const swarmRef = v(p.swarmRef);
  return {
    panel: {
      entityKey: p.$key,
      owner: p.$owner,
      projectId: v(p.projectId),
      runAt: new Date(Number(v(p.runAt)) * 1000).toISOString(),
      panelScore: v(p.panelScore),
      complete: v(p.complete),
      judges: v(p.judges),
      provider: v(p.provider),
      model: v(p.model),
      expiresAtBlock: String(p.$expiresAt),
      expiresAt: new Date(expiresUnix * 1000).toISOString(),
      explorer: explorerEntity(p.$key),
    },
    scorecards: cards.entities.map((s) => ({
      entityKey: s.$key,
      judgeId: v(s.judgeId),
      judgeName: v(s.judgeName),
      status: v(s.status),
      overall: v(s.overall),
      headline: v(s.headline),
      explorer: explorerEntity(s.$key),
    })),
    swarm: swarmRef
      ? { reference: swarmRef, review: gatewayUrl(swarmRef, "review.json"), dossier: gatewayUrl(swarmRef, "dossier.json"), liveTest: gatewayUrl(swarmRef, "live/smoke.json"), laptopVideo: gatewayUrl(swarmRef, "live/laptop/video.mp4"), phoneVideo: gatewayUrl(swarmRef, "live/phone/video.mp4") }
      : null,
    query: `arkiv.schema = str('battle-arena.panel') AND $owner = addr(${owner}) AND projectId = str('${clip128(projectId).replace(/'/g, "''")}')`,
  };
}
