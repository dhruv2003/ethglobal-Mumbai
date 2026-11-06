/*
 * A separate process sharing one ARENA_DATA_DIR, to test that a restart resumes
 * the outbox. Blobs live in FAKE_ZG_DIR so both processes see the same "0G".
 *   node archive-child.mjs write   -> save a judge panel while 0G fails, exit
 *   node archive-child.mjs resume  -> boot the archive with 0G working, drain
 */
import { setStorageClient } from "../../src/zg/storage.mjs";
import { fakeStorage } from "./fake-zg-storage.mjs";

const fake = fakeStorage({ dir: process.env.FAKE_ZG_DIR });
if (process.env.FAKE_ZG_FAIL === "1") fake.state.failNext = 1e9;
setStorageClient(fake);
const store = await import("../../src/store.mjs");
const archive = await import("../../src/zg/archive.mjs");

if (process.argv[2] === "write") {
  store.judges.save([{ id: "j1", name: "Ada", version: 1 }]);
  await archive.tick(); // one failed attempt; the item stays pending
} else {
  store.startArchive();
  await archive.drain({ manifest: false, timeoutMs: 20_000 });
}
console.log(JSON.stringify({ outbox: archive.counts(), manifest: archive.loadManifest() }));
process.exit(0);
