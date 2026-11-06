/*
 * With ZG_STORAGE off (the default), the store behaves exactly as before:
 * no outbox, no manifest, no SDK loaded, and every record reports status "off".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "arena-zg-off-"));
process.env.ARENA_DATA_DIR = DATA;
delete process.env.ZG_STORAGE;

const store = await import("../src/store.mjs");
const archive = await import("../src/zg/archive.mjs");

test("ZG_STORAGE off: writes stay local, no outbox, status off", async () => {
  store.startArchive();
  store.judges.save([{ id: "a" }]);
  store.submissions.add({ id: "s1", submittedAt: "2026-11-06T00:00:00.000Z" });
  store.reviews.save("p1", { x: 1 });
  store.evidence.save("p1", { model: "m", records: [] });
  store.voiceNotes.save("v1", { id: "v1", transcript: "t", audio: { sha256: "00", size: 1 } }, { audio: Buffer.alloc(2000), mime: "audio/webm" });
  await archive.drain();
  assert.deepEqual(store.reviews.get("p1"), { x: 1 });
  assert.equal(store.submissions.get("s1").id, "s1");
  for (const f of ["zg-outbox.json", "zg-manifest.json", "zg-head.json", "zg-spool"]) assert.equal(fs.existsSync(path.join(DATA, f)), false, f);
  assert.deepEqual(store.zgStatus("submission", "s1"), { status: "off" });
  assert.deepEqual(store.zgStatus("review", "p1"), { status: "off" });
  assert.equal(store.voiceNotes.get("v1").audio.encryptedOn0G, false);
});
