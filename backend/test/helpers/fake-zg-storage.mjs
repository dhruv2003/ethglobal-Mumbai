/*
 * A fake 0G Storage client for tests: content-addressed blobs in memory (or in a
 * folder, so a second process can see them). Root hash = 0x + sha256 of the
 * stored bytes, so tampering is detectable like a real Merkle root.
 * Encryption uses the SDK's real header + AES-CTR, so downloadBytes can decrypt.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as zg from "@0gfoundation/0g-storage-ts-sdk";

const hex = (b) => crypto.createHash("sha256").update(b).digest("hex");

export function fakeStorage({ dir = null } = {}) {
  const mem = new Map();
  const blobs = {
    get: (r) => (dir ? (fs.existsSync(path.join(dir, r)) ? new Uint8Array(fs.readFileSync(path.join(dir, r))) : undefined) : mem.get(r)),
    set: (r, b) => (dir ? fs.writeFileSync(path.join(dir, r), b) : mem.set(r, b)),
    has: (r) => (dir ? fs.existsSync(path.join(dir, r)) : mem.has(r)),
  };
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const state = { failNext: 0, failCode: "upload failed: node rejected segment", hang: false, uploads: [], txSeq: 0 };
  const fail = () => {
    if (state.hang) return new Promise(() => {});
    if (state.failNext > 0) {
      state.failNext--;
      throw new Error(state.failCode);
    }
    return null;
  };
  function store(stored, plaintext) {
    state.uploads.push(Buffer.from(plaintext));
    const rootHash = `0x${hex(stored)}`;
    blobs.set(rootHash, stored);
    return { rootHash, txHash: `0x${hex(`tx${rootHash}`)}`, txSeq: ++state.txSeq };
  }
  return {
    state,
    blobs,
    async upload(bytes, { encryptKey } = {}) {
      await fail();
      if (!encryptKey) return store(Uint8Array.from(bytes), bytes);
      const key = Uint8Array.from(Buffer.from(encryptKey.replace(/^0x/, ""), "hex"));
      const header = zg.newSymmetricHeader();
      const body = Uint8Array.from(bytes);
      zg.cryptAt(key, header.nonce, 0, body);
      const h = header.toBytes();
      const out = new Uint8Array(h.length + body.length);
      out.set(h, 0);
      out.set(body, h.length);
      return store(out, bytes);
    },
    async uploadFile(p) {
      await fail();
      const b = new Uint8Array(fs.readFileSync(p));
      return store(b, b);
    },
    async download(rootHash) {
      if (state.hang) return new Promise(() => {});
      const b = blobs.get(rootHash);
      if (!b) throw new Error(`No storage node has ${rootHash}`);
      return b;
    },
    async verifyRoot(bytes, rootHash) {
      return `0x${hex(bytes)}` === rootHash;
    },
    async address() {
      return "0x000000000000000000000000000000000000fa4e";
    },
    async balance() {
      return 10n ** 18n;
    },
  };
}
