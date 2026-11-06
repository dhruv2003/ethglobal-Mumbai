/*
 * Live round trips on 0G Storage (Galileo testnet by default). Skipped unless
 *   ZG_STORAGE_LIVE=1 and ZG_STORAGE_PRIVATE_KEY (a faucet-funded wallet) are set.
 *
 *   cd backend && npm run test:0g-storage      (reads backend/.env)
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicClient, http } from "viem";

const LIVE = process.env.ZG_STORAGE_LIVE === "1" && /^(0x)?[0-9a-fA-F]{64}$/.test(process.env.ZG_STORAGE_PRIVATE_KEY ?? "");
const skip = LIVE ? false : "set ZG_STORAGE_LIVE=1 and ZG_STORAGE_PRIVATE_KEY (funded) to run against 0G";
process.env.ZG_STORAGE = "1";
const storage = await import("../src/zg/storage.mjs");
const cfg = storage.storageConfig();
const log = (...a) => console.log("   ", ...a);

test("wallet is funded", { skip }, async () => {
  const w = await storage.walletInfo();
  log(`wallet ${w.address} · ${w.balance} · ${cfg.network}`);
  assert.ok(BigInt(w.balanceWei) > 0n, "fund it at https://faucet.0g.ai");
});

let small;
test("upload a small JSON, download it, Merkle root and sha256 match", { skip, timeout: 300_000 }, async () => {
  const obj = { schema: "arena.v1", kind: "live-test", id: crypto.randomUUID(), at: new Date().toISOString() };
  const t0 = Date.now();
  small = await storage.uploadJSON(obj);
  log(`upload ${Date.now() - t0} ms · root ${small.rootHash} · tx ${small.txHash} · seq ${small.txSeq}`);
  log(storage.explorerLinks(small).tx);
  assert.match(small.rootHash, /^0x[0-9a-f]{64}$/);
  assert.match(small.txHash, /^0x[0-9a-f]{64}$/);
  const t1 = Date.now();
  const back = await storage.downloadBytes(small.rootHash, { sha256: small.sha256 });
  log(`download ${Date.now() - t1} ms · ${back.length} bytes`);
  assert.equal(storage.sha256(back), small.sha256);
  assert.equal(await storage.merkleRoot(back), small.rootHash);
  assert.deepEqual(JSON.parse(Buffer.from(back).toString()), obj);
});

test("the upload transaction succeeded on chain", { skip, timeout: 60_000 }, async () => {
  assert.ok(small, "previous test uploaded");
  const client = createPublicClient({ transport: http(cfg.rpc) });
  const receipt = await client.getTransactionReceipt({ hash: small.txHash });
  log(`receipt block ${receipt.blockNumber} · status ${receipt.status} · to ${receipt.to}`);
  assert.equal(receipt.status, "success");
});

test("AES-256 round trip: header present, key decrypts, no key doesn't", { skip: skip || (!cfg.hasAesKey && "ZG_STORAGE_AES_KEY not set"), timeout: 300_000 }, async () => {
  const plain = Buffer.from(`voice note stand-in ${crypto.randomUUID()} `.repeat(40));
  const up = await storage.uploadBytes(plain, { encrypt: true });
  log(`encrypted upload · root ${up.rootHash} · tx ${up.txHash}`);
  const header = await storage.peekEncryption(up.rootHash);
  assert.ok(header, "peekHeader finds an encryption header");
  assert.equal(header.version, 1);
  const dec = await storage.downloadBytes(up.rootHash, { decrypt: true, sha256: storage.sha256(plain) });
  assert.ok(Buffer.from(dec).equals(plain));
  const raw = await storage.downloadBytes(up.rootHash);
  assert.ok(!Buffer.from(raw).equals(plain), "without the key we only get ciphertext");
  assert.ok(!Buffer.from(raw).toString("latin1").includes("voice note stand-in"));
});

test("a 5 MB binary file uploads and downloads intact", { skip, timeout: 900_000 }, async () => {
  // Fresh random bytes, so the network can't answer "already stored".
  const file = path.join(os.tmpdir(), `arena-zg-live-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(file, crypto.randomBytes(5 * 1024 * 1024));
  const size = fs.statSync(file).size;
  const t0 = Date.now();
  const up = await storage.uploadFile(file);
  const upMs = Date.now() - t0;
  log(`file ${(size / 1e6).toFixed(2)} MB · upload ${upMs} ms · root ${up.rootHash} · tx ${up.txHash || "(already on network)"}`);
  const t1 = Date.now();
  const back = await storage.downloadBytes(up.rootHash, { sha256: up.sha256 });
  log(`download ${Date.now() - t1} ms`);
  assert.equal(back.length, size);
  fs.rmSync(file, { force: true });
});
