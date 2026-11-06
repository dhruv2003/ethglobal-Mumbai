/*
 * 0G Storage client: upload and download bytes, JSON and files on 0G Storage.
 * Docs: https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
 *
 * - Off unless ZG_STORAGE=1, so tests and offline dev need no wallet. The SDK
 *   (and ethers) are imported lazily: the server boots without them.
 * - One signer, one upload at a time (a per-process queue), so our own
 *   transactions never race for a nonce.
 * - Every call has a timeout, and SDK `[result, err]` tuples become thrown
 *   ZgStorageErrors with a `code` the caller can act on.
 * - Downloads are checked by recomputing the 0G Merkle root of the bytes we got
 *   and comparing it with the root we asked for. (The SDK's own `proof` flag is
 *   currently a no-op: its Downloader.downloadTask has "TODO: add proof check".)
 *   Since the root hash is what the Flow contract on 0G Chain recorded, a match
 *   means these are exactly the bytes that were committed on chain.
 * - AES-256 (ZG_STORAGE_AES_KEY) only where a caller asks for it (voice notes).
 *
 * Everything uploaded here is public and permanent. Callers decide what to send;
 * archive.mjs also refuses any bytes that contain a known secret.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { sortKeys } from "../datafiles.mjs";

const NETWORKS = {
  testnet: {
    chainId: 16602,
    rpc: "https://evmrpc-testnet.0g.ai",
    indexer: "https://indexer-storage-testnet-turbo.0g.ai",
    txUrl: "https://chainscan-galileo.0g.ai/tx/",
    fileUrl: "https://storagescan-galileo.0g.ai/submission/",
  },
  mainnet: {
    chainId: 16661,
    rpc: "https://evmrpc.0g.ai",
    indexer: "https://indexer-storage-turbo.0g.ai",
    txUrl: "https://chainscan.0g.ai/tx/",
    fileUrl: "https://storagescan.0g.ai/submission/",
  },
};

export class ZgStorageError extends Error {
  /** code: insufficient_funds | timeout | indexer_unavailable | nonce_conflict | upload_failed | not_found | hash_mismatch | not_configured | secret_detected */
  constructor(message, code = "upload_failed", cause) {
    super(message);
    this.name = "ZgStorageError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function storageConfig(env = process.env) {
  const network = env.ZG_STORAGE_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const n = NETWORKS[network];
  return {
    enabled: env.ZG_STORAGE === "1" || env.ZG_STORAGE === "true",
    network,
    chainId: n.chainId,
    rpc: env.ZG_STORAGE_RPC || n.rpc,
    indexer: env.ZG_STORAGE_INDEXER || n.indexer,
    timeoutMs: Number(env.ZG_STORAGE_TIMEOUT_MS) || 180_000,
    hasKey: /^(0x)?[0-9a-fA-F]{64}$/.test(env.ZG_STORAGE_PRIVATE_KEY ?? ""),
    hasAesKey: /^(0x)?[0-9a-fA-F]{64}$/.test(env.ZG_STORAGE_AES_KEY ?? ""),
  };
}

/** Explorer links for a stored item (txSeq is the storage submission number). */
export function explorerLinks({ txHash, txSeq } = {}, network = storageConfig().network) {
  const n = NETWORKS[network] ?? NETWORKS.testnet;
  return {
    tx: txHash ? `${n.txUrl}${txHash}` : null,
    file: Number.isInteger(txSeq) ? `${n.fileUrl}${txSeq}` : null,
  };
}

// ---------- canonical JSON + hashing ----------

/** JSON with object keys sorted at every level: the same content always gives the same bytes. */
export function canonicalJSON(value) {
  return JSON.stringify(sortKeys(value));
}
export const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
/** Hash of a JSON value's content, independent of key order. */
export const contentSha256 = (value) => sha256(Buffer.from(canonicalJSON(value)));

// ---------- the SDK, loaded lazily ----------

let sdkPromise = null;
async function sdk() {
  sdkPromise ??= (async () => {
    try {
      const [zg, ethers] = await Promise.all([import("@0gfoundation/0g-storage-ts-sdk"), import("ethers")]);
      quietSdkLogs();
      return { zg, ethers };
    } catch (e) {
      sdkPromise = null;
      throw new ZgStorageError(`0G Storage SDK not installed (npm install in backend/): ${e.message}`, "not_configured", e);
    }
  })();
  return sdkPromise;
}

/*
 * The SDK logs a lot with console.log, including its merged upload options,
 * which would print the AES key. Drop any console line that comes from inside
 * the SDK (shown with ZG_STORAGE_DEBUG=1, minus the encryption key).
 */
let quieted = false;
function quietSdkLogs() {
  if (quieted) return;
  quieted = true;
  for (const level of ["log", "warn", "error", "info", "debug"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      const stack = new Error().stack ?? "";
      if (!stack.includes("0g-storage-ts-sdk")) return orig(...args);
      if (process.env.ZG_STORAGE_DEBUG === "1") orig("[0g-sdk]", ...args.map((a) => (a && typeof a === "object" && "encryption" in a ? { ...a, encryption: "[redacted]" } : a)));
    };
  }
}

function keyBytes(hex) {
  return Uint8Array.from(Buffer.from(String(hex).replace(/^0x/, ""), "hex"));
}

function classify(err, fallback = "upload_failed") {
  if (err instanceof ZgStorageError) return err;
  const msg = String(err?.shortMessage ?? err?.message ?? err);
  let code = fallback;
  if (/insufficient funds|INSUFFICIENT_FUNDS|insufficient balance/i.test(msg)) code = "insufficient_funds";
  else if (/timed? ?out|ETIMEDOUT/i.test(msg)) code = "timeout";
  // Two processes (server + CLI) sharing one wallet can race for a nonce; a retry fixes it.
  else if (/replacement fee too low|nonce too low|nonce has already been used|already known|NONCE_EXPIRED|REPLACEMENT_UNDERPRICED/i.test(msg)) code = "nonce_conflict";
  else if (/create uploader|create downloader|ENOTFOUND|ECONNREFUSED|fetch failed|getaddrinfo|indexer|socket hang up|EAI_AGAIN|Not Found|404|502|503/i.test(msg)) code = fallback === "not_found" ? "not_found" : "indexer_unavailable";
  return new ZgStorageError(msg.slice(0, 300), code, err);
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new ZgStorageError(`${what} took longer than ${Math.round(ms / 1000)} s`, "timeout")), ms);
      t.unref?.();
    }),
  ]).finally(() => clearTimeout(t));
}

/** Recompute the 0G Merkle root of some bytes (what the Flow contract stores). */
export async function merkleRoot(bytes) {
  const { zg } = await sdk();
  const [tree, err] = await new zg.MemData(bytes).merkleTree();
  if (err || !tree) throw new ZgStorageError(`Merkle tree failed: ${err?.message ?? err}`, "upload_failed");
  return tree.rootHash();
}

/**
 * The real client on the 0G SDK. Tests inject a fake with the same shape:
 *   upload(bytes, { encryptKey? }) -> { rootHash, txHash, txSeq }
 *   uploadFile(path)               -> { rootHash, txHash, txSeq }
 *   download(rootHash)             -> Uint8Array (raw, as stored: ciphertext if encrypted)
 *   verifyRoot(bytes, rootHash)    -> boolean
 *   address()                      -> "0x..." | null
 *   balance()                      -> bigint (wei) | null
 */
export function sdkClient(cfg = storageConfig()) {
  let signer = null;
  async function getSigner() {
    if (signer) return signer;
    if (!cfg.hasKey) throw new ZgStorageError("ZG_STORAGE_PRIVATE_KEY is not set (backend/.env)", "not_configured");
    const { ethers } = await sdk();
    const pk = process.env.ZG_STORAGE_PRIVATE_KEY.startsWith("0x") ? process.env.ZG_STORAGE_PRIVATE_KEY : `0x${process.env.ZG_STORAGE_PRIVATE_KEY}`;
    signer = new ethers.Wallet(pk, new ethers.JsonRpcProvider(cfg.rpc));
    return signer;
  }
  async function uploadAbstract(file, uploadOpts = {}) {
    const { zg } = await sdk();
    const indexer = new zg.Indexer(cfg.indexer);
    const [res, err] = await indexer.upload(file, cfg.rpc, await getSigner(), uploadOpts);
    if (err) throw classify(err);
    if (res.rootHashes) throw new ZgStorageError("File over 4 GB was split into fragments; not supported here.", "upload_failed");
    return { rootHash: res.rootHash, txHash: res.txHash || null, txSeq: Number.isInteger(res.txSeq) ? res.txSeq : null };
  }
  return {
    async upload(bytes, { encryptKey } = {}) {
      const { zg } = await sdk();
      const file = new zg.MemData(bytes);
      if (encryptKey) return uploadAbstract(file, { encryption: { type: "aes256", key: keyBytes(encryptKey) } });
      const [, terr] = await file.merkleTree(); // fills the file's internal state before upload
      if (terr) throw classify(terr);
      return uploadAbstract(file);
    },
    async uploadFile(filePath) {
      const { zg } = await sdk();
      const file = await zg.ZgFile.fromFilePath(filePath);
      try {
        const [, terr] = await file.merkleTree();
        if (terr) throw classify(terr);
        return await uploadAbstract(file);
      } finally {
        await file.close?.();
      }
    },
    async download(rootHash) {
      const { zg } = await sdk();
      const indexer = new zg.Indexer(cfg.indexer);
      let locations;
      try {
        locations = await indexer.getFileLocations(rootHash);
      } catch (e) {
        throw classify(e, "indexer_unavailable");
      }
      if (!locations?.length) throw new ZgStorageError(`No storage node has ${rootHash} (yet).`, "not_found");
      const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
      if (err) throw classify(err, "not_found");
      return new Uint8Array(await blob.arrayBuffer());
    },
    async verifyRoot(bytes, rootHash) {
      return (await merkleRoot(bytes)).toLowerCase() === String(rootHash).toLowerCase();
    },
    async address() {
      if (!cfg.hasKey) return null;
      return (await getSigner()).address;
    },
    async balance() {
      if (!cfg.hasKey) return null;
      const s = await getSigner();
      return s.provider.getBalance(s.address);
    },
  };
}

// ---------- the module-level API (queue, timeouts, hashes) ----------

let client = null;
/** Tests: inject a fake client. Pass null to go back to the SDK client. */
export function setStorageClient(c) {
  client = c;
}
const getClient = () => (client ??= sdkClient());

let queue = Promise.resolve();
/** One upload at a time per process: a single signer must not race itself for nonces. */
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Upload bytes. Returns { rootHash, txHash, txSeq, size, sha256, encrypted }. sha256 is of the plaintext. */
export function uploadBytes(bytes, { encrypt = false, timeoutMs = storageConfig().timeoutMs } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (encrypt && !storageConfig().hasAesKey) return Promise.reject(new ZgStorageError("ZG_STORAGE_AES_KEY is not set (64 hex chars).", "not_configured"));
  return enqueue(async () => {
    try {
      const res = await withTimeout(getClient().upload(data, encrypt ? { encryptKey: process.env.ZG_STORAGE_AES_KEY } : {}), timeoutMs, "0G Storage upload");
      return { ...res, size: data.length, sha256: sha256(data), encrypted: Boolean(encrypt) };
    } catch (e) {
      throw classify(e);
    }
  });
}

/** Upload a JSON value as canonical JSON (sorted keys). sha256 is the content hash. */
export function uploadJSON(value, opts) {
  return uploadBytes(Buffer.from(canonicalJSON(value)), opts);
}

/** Upload a file from disk as-is. */
export function uploadFile(filePath, { timeoutMs = storageConfig().timeoutMs } = {}) {
  return enqueue(async () => {
    const buf = fs.readFileSync(filePath);
    try {
      const res = await withTimeout(getClient().uploadFile(filePath), timeoutMs, "0G Storage file upload");
      return { ...res, size: buf.length, sha256: sha256(buf), encrypted: false };
    } catch (e) {
      throw classify(e);
    }
  });
}

/**
 * Download by root hash, check the bytes against the root, decrypt if asked,
 * and (when `sha256` is given) check the plaintext hash too.
 * A wrong AES key does not throw in the SDK; here decryption is ours, and a
 * sha256 mismatch after decrypting is reported as hash_mismatch.
 */
export async function downloadBytes(rootHash, { decrypt = false, sha256: expected, timeoutMs = storageConfig().timeoutMs } = {}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(rootHash))) throw new ZgStorageError("Not a 0G root hash.", "not_found");
  const c = getClient();
  let raw;
  try {
    raw = await withTimeout(c.download(rootHash), timeoutMs, "0G Storage download");
  } catch (e) {
    throw classify(e, "not_found");
  }
  if (!(await c.verifyRoot(raw, rootHash))) throw new ZgStorageError(`Downloaded bytes don't hash to ${rootHash}.`, "hash_mismatch");
  let bytes = raw;
  if (decrypt) {
    if (!storageConfig().hasAesKey) throw new ZgStorageError("ZG_STORAGE_AES_KEY is not set.", "not_configured");
    const { zg } = await sdk();
    try {
      bytes = zg.decryptFile(keyBytes(process.env.ZG_STORAGE_AES_KEY), raw);
    } catch (e) {
      throw new ZgStorageError(`Not an encrypted 0G file: ${e.message}`, "hash_mismatch");
    }
  }
  if (expected && sha256(bytes) !== expected) throw new ZgStorageError(`Content hash mismatch for ${rootHash}.`, "hash_mismatch");
  return bytes;
}

export async function downloadJSON(rootHash, opts) {
  const bytes = await downloadBytes(rootHash, opts);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new ZgStorageError(`${rootHash} is not JSON.`, "hash_mismatch");
  }
}

/**
 * The docs' own download path, for manual checks: indexer.download(root, file, true)
 * writes the stored bytes to `filePath` (Node only). Note the SDK's `proof` flag
 * is currently a no-op, so callers should still compare merkleRoot(bytes) with the root.
 */
export async function sdkDownloadToFile(rootHash, filePath, { timeoutMs = storageConfig().timeoutMs } = {}) {
  const { zg } = await sdk();
  const indexer = new zg.Indexer(storageConfig().indexer);
  const err = await withTimeout(indexer.download(rootHash, filePath, true), timeoutMs, "0G Storage download");
  if (err) throw classify(err, "not_found");
  return filePath;
}

/** The storage nodes the indexer says hold this file (replicas). */
export async function fileLocations(rootHash) {
  const { zg } = await sdk();
  const locs = await new zg.Indexer(storageConfig().indexer).getFileLocations(rootHash);
  return (locs ?? []).map((l) => l.url);
}

/** Does this stored file start with a 0G encryption header? (null = plaintext) */
export async function peekEncryption(rootHash) {
  const { zg } = await sdk();
  const raw = await getClient().download(rootHash);
  try {
    const h = zg.parseEncryptionHeader(raw.slice(0, 50));
    return { version: h.version };
  } catch {
    return null;
  }
}

export async function walletInfo() {
  const cfg = storageConfig();
  if (!cfg.enabled) return { address: null, balanceWei: null, balance: null };
  try {
    const c = getClient();
    const [address, wei] = await Promise.all([c.address(), withTimeout(Promise.resolve(c.balance()), 10_000, "balance")]);
    return { address, balanceWei: wei == null ? null : String(wei), balance: wei == null ? null : `${(Number(wei) / 1e18).toFixed(6)} 0G` };
  } catch (e) {
    return { address: null, balanceWei: null, balance: null, error: String(e.message).slice(0, 200) };
  }
}
