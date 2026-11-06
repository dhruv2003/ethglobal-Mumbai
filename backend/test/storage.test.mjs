/*
 * 0G Storage archive, with no network: a fake storage client stands in for 0G,
 * and a stubbed fetch stands in for the 0G Compute Router (judges, whisper).
 * Env is set before any module loads.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "arena-zg-test-"));
const SECRETS = {
  ZG_API_KEY: "sk-zg-test-SECRET-4f1c2b9a77",
  ADMIN_TOKEN: "admin-test-SECRET-91be0c3d",
  ZG_STORAGE_PRIVATE_KEY: `0x${"5ec7e7".repeat(10)}abcd`,
  ZG_STORAGE_AES_KEY: crypto.randomBytes(32).toString("hex"),
};
Object.assign(process.env, SECRETS, {
  ARENA_DATA_DIR: DATA,
  ZG_STORAGE: "1",
  ZG_STORAGE_BACKOFF_MS: "1",
  ZG_STORAGE_MAX_ATTEMPTS: "3",
  ZG_STORAGE_MANIFEST_DEBOUNCE_MS: "600000",
  ZG_STORAGE_TIMEOUT_MS: "2000",
  JUDGE_PROVIDER: "0g",
});
delete process.env.ALLOW_LOCAL_ORGANIZER;
delete process.env.JUDGE_EVIDENCE;
delete process.env.JUDGE_MODEL;

// ---- the 0G Compute Router, faked at the fetch level (the real review + voice-note code runs) ----
const { CRITERION_IDS } = await import("../src/judges/criteria.mjs");
const realFetch = globalThis.fetch;
let routerCalls = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith("https://router-api.0g.ai")) return realFetch(url, init);
  routerCalls++;
  const headers = { "content-type": "application/json", "x-request-id": `gw, router-${routerCalls}` };
  if (u.includes("/audio/transcriptions")) {
    return new Response(JSON.stringify({ text: " Weigh working demos most. ", x_0g_trace: { request_id: `whisper-${routerCalls}`, provider: "0xWhisper", tee_verified: true, billing: { total_cost_usd_micro: 120 } } }), { headers });
  }
  const review = { criteria: CRITERION_IDS.map((id) => ({ id, score: 72, comment: "ok", evidence: ["E1"] })), headline: "Solid.", comment: "Fine.", strengths: [], concerns: [], dealBreakerHit: false, dealBreakerNote: "", certainty: "medium" };
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      model: "0gm-1.0-35b-a3b",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(review), refusal: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      x_0g_trace: { request_id: `req-${routerCalls}`, provider: "0xProvider", billing: { total_cost_usd_micro: 3000 } },
    }),
    { headers },
  );
};

const { fakeStorage } = await import("./helpers/fake-zg-storage.mjs");
const storage = await import("../src/zg/storage.mjs");
const fake = fakeStorage();
storage.setStorageClient(fake);
const archive = await import("../src/zg/archive.mjs");
const store = await import("../src/store.mjs");
const express = (await import("express")).default;
const { router, reviewNow } = await import("../src/api.mjs");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api", router);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
after(() => server.close());
const api = (p, init = {}) => realFetch(base + p, init);
const outbox = () => JSON.parse(fs.readFileSync(path.join(DATA, "zg-outbox.json"), "utf8"));
const manifest = () => archive.loadManifest();

// A fresh random wallet for signed submissions; nothing is funded.
const account = privateKeyToAccount(generatePrivateKey());
/** Every submission enters a tournament, judged by the panel saved at the time. */
async function openTournament() {
  const { events } = await import("../src/events.mjs");
  if (!events.get("test-event")) events.add({ id: "test-event", name: "Test", tracks: [{ id: "0g", name: "0G", prize: "" }], deadline: new Date(Date.now() + 3600_000).toISOString(), bettingMinutes: 10, judgeIds: [] });
  events.update("test-event", { judgeIds: store.judges.list().slice(0, 3).map((j) => j.id) });
  return "test-event";
}

async function signedSubmission(name = "Atlas") {
  const { submissionDigest } = await import("../src/security.mjs");
  const eventId = await openTournament();
  const body = { eventId, team: { name: "Night Owls" }, project: { name, pitch: "p", description: "d" }, repoUrl: `https://github.com/team/${name.toLowerCase()}`, demoVideoUrl: "https://youtu.be/x", tracks: ["0g"], ownerWallet: account.address, fighterSeed: "abc", rewardWallet: account.address, chainId: 16602 };
  const message = [`Submit "${name}" to ETHGlobal Mumbai Battle Arena`, `Repository: ${body.repoUrl}`, `Owner: ${account.address}`, `Submission: ${submissionDigest(body)}`, `Issued at: ${new Date().toISOString()}`].join("\n");
  return { ...body, auth: { message, signature: await account.signMessage({ message }), issuedAt: new Date().toISOString() } };
}

test("canonical JSON: key order doesn't change the hash", () => {
  const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: "s" } };
  const b = { a: { x: "s", y: [1, { p: 2, q: 1 }] }, b: 1 };
  assert.equal(storage.canonicalJSON(a), storage.canonicalJSON(b));
  assert.equal(storage.contentSha256(a), storage.contentSha256(b));
  assert.notEqual(storage.contentSha256(a), storage.contentSha256({ ...b, b: 2 }));
});

test("boot archives the seeded judge panel", async () => {
  await archive.drain({ manifest: false });
  const r = manifest().records["judges:panel"];
  assert.ok(r, "judges:panel stored");
  assert.equal(r.history.length, 1);
  assert.match(r.rootHash, /^0x[0-9a-f]{64}$/);
});

test("each store write writes local JSON and queues one outbox item of the right kind", async () => {
  fake.state.hang = true; // nothing leaves the outbox while we look
  try {
    const cases = [
      ["submission", "sub-1", () => store.submissions.add({ id: "sub-1", project: { name: "A" }, submittedAt: new Date().toISOString() }), "submissions.json"],
      ["judges", "panel", () => store.judges.save([...store.judges.list(), { id: "extra", name: "Extra" }]), "judges.json"],
      ["review", "proj-1", () => store.reviews.save("proj-1", { projectId: "proj-1", panelHundredths: 7000 }), "reviews/proj-1.json"],
      ["evidence", "proj-1", () => store.evidence.save("proj-1", { model: "m", records: [] }), "evidence/proj-1.json"],
      ["voice-note", "vn-1", () => store.voiceNotes.save("vn-1", { id: "vn-1", transcript: "hi" }), "voice-notes/vn-1.json"],
    ];
    for (const [kind, id, write, file] of cases) {
      const before = outbox().items.length;
      write();
      assert.ok(fs.existsSync(path.join(DATA, file)), `${file} written`);
      const items = outbox().items;
      assert.equal(items.length, before + 1, `one item for ${kind}`);
      assert.equal(items.at(-1).kind, kind);
      assert.equal(items.at(-1).id, id);
      assert.equal(store.zgStatus(kind, id).status, "pending");
    }
    // Same content again: nothing new to upload.
    const n = outbox().items.length;
    store.reviews.save("proj-1", { panelHundredths: 7000, projectId: "proj-1" });
    assert.equal(outbox().items.length, n);
  } finally {
    fake.state.hang = false;
  }
  // The hung claim times out (2 s) and is retried.
  await archive.drain({ manifest: false });
  for (const k of ["submission:sub-1", "review:proj-1", "evidence:proj-1", "voice-note:vn-1"]) assert.ok(manifest().records[k], k);
  assert.equal(store.zgStatus("review", "proj-1").status, "stored");
});

test("success moves an item to the manifest with root, tx and history", async () => {
  store.reviews.save("proj-2", { v: 1 });
  await archive.drain({ manifest: false });
  const r = manifest().records["review:proj-2"];
  assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r.history.length, 1);
  assert.equal(r.sha256, storage.contentSha256({ v: 1 }));
  assert.equal(outbox().items.filter((i) => i.key === "review:proj-2").length, 0);
  const st = store.zgStatus("review", "proj-2");
  assert.equal(st.status, "stored");
  assert.match(st.links.tx, /^https:\/\/chainscan-galileo\.0g\.ai\/tx\/0x/);
  assert.match(st.links.file, /^https:\/\/storagescan-galileo\.0g\.ai\/submission\/\d+$/);
});

test("failures back off, then end as failed with the reason; flush retries", async () => {
  fake.state.failNext = 3;
  fake.state.failCode = "insufficient funds for gas * price + value";
  store.reviews.save("proj-3", { v: 1 });
  await archive.drain({ manifest: false });
  const it = outbox().items.find((i) => i.key === "review:proj-3");
  assert.equal(it.status, "failed");
  assert.equal(it.attempts, 3);
  assert.equal(it.lastError.code, "insufficient_funds");
  const st = store.zgStatus("review", "proj-3");
  assert.equal(st.status, "failed");
  assert.match(st.error, /insufficient funds/);
  // Organizer retries once the wallet is funded.
  const res = await api("/storage/flush", { method: "POST", headers: { authorization: `Bearer ${SECRETS.ADMIN_TOKEN}` } });
  assert.equal(res.status, 200);
  await archive.drain({ manifest: false });
  assert.equal(store.zgStatus("review", "proj-3").status, "stored");
});

test("a new version replaces a failed one; a restart doesn't duplicate a failed item", async () => {
  fake.state.failNext = 3;
  fake.state.failCode = "Failed to create uploader: fetch failed";
  store.reviews.save("proj-4", { v: 1 });
  await archive.drain({ manifest: false });
  assert.equal(store.zgStatus("review", "proj-4").status, "failed");
  // Same content again (e.g. the boot backfill): no second item.
  assert.equal(archive.archive("review", "proj-4", { v: 1 }), null);
  assert.equal(outbox().items.filter((i) => i.key === "review:proj-4").length, 1);
  // Newer content: the failed old version is dropped, only the new one uploads.
  store.reviews.save("proj-4", { v: 2 });
  assert.deepEqual(outbox().items.filter((i) => i.key === "review:proj-4").map((i) => i.status), ["pending"]);
  await archive.drain({ manifest: false });
  archive.flush();
  await archive.drain({ manifest: false });
  const r = manifest().records["review:proj-4"];
  assert.equal(r.history.length, 1);
  assert.equal(r.sha256, storage.contentSha256({ v: 2 }));
});

test("a nonce race between two processes is reported as nonce_conflict and retried", async () => {
  fake.state.failNext = 1;
  fake.state.failCode = "replacement fee too low";
  store.reviews.save("proj-5", { v: 1 });
  await archive.drain({ manifest: false });
  assert.equal(store.zgStatus("review", "proj-5").status, "stored");
  assert.equal(archive.counts().lastError.code, "nonce_conflict");
});

test("prev chaining: three judge panel saves give a 3-long history linked by prev", async () => {
  const before = manifest().records["judges:panel"].history.length;
  for (let i = 0; i < 3; i++) {
    store.judges.save([{ id: "j", name: `Judge v${i}`, version: i + 1 }]);
    await archive.drain({ manifest: false });
  }
  const hist = manifest().records["judges:panel"].history;
  assert.equal(hist.length, before + 3);
  const last3 = hist.slice(-3);
  const envs = await Promise.all(last3.map((h) => storage.downloadJSON(h)));
  assert.equal(envs[0].prev, hist[hist.length - 4]);
  assert.equal(envs[1].prev, last3[0]);
  assert.equal(envs[2].prev, last3[1]);
  assert.equal(envs[2].schema, "arena.v1");
  assert.equal(envs[2].kind, "judges");
  assert.deepEqual(envs[2].data, [{ id: "j", name: "Judge v2", version: 3 }]);
});

test("a restart resumes pending items (two real processes, one data folder)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-zg-restart-"));
  const env = { ...process.env, ARENA_DATA_DIR: dir, FAKE_ZG_DIR: path.join(dir, "_blobs"), ZG_STORAGE_BACKOFF_MS: "60000" };
  const child = path.join(here, "helpers/archive-child.mjs");
  const first = JSON.parse(execFileSync(process.execPath, [child, "write"], { env: { ...env, FAKE_ZG_FAIL: "1" } }).toString().trim().split("\n").pop());
  assert.equal(first.outbox.pending, 1);
  assert.equal(Object.keys(first.manifest.records).length, 0);
  const second = JSON.parse(execFileSync(process.execPath, [child, "resume"], { env: { ...env, ZG_STORAGE_BACKOFF_MS: "1" } }).toString().trim().split("\n").pop());
  assert.equal(second.outbox.pending, 0);
  assert.equal(second.manifest.records["judges:panel"].history.length, 1);
});

test("API: a submission returns 201 while 0G is down, with zgStorage pending", async () => {
  fake.state.failNext = 1000;
  fake.state.failCode = "Failed to create uploader: fetch failed";
  const res = await api("/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await signedSubmission("Downtime")) });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.zgStorage.status, "pending");
  assert.equal(body.auth, undefined);
  await archive.drain({ manifest: false });
  assert.equal(store.zgStatus("submission", body.id).status, "failed");
  assert.equal(outbox().items.find((i) => i.key === `submission:${body.id}`).lastError.code, "indexer_unavailable");
  fake.state.failNext = 0;
  archive.flush();
  await archive.drain({ manifest: false });
  const st = await (await api(`/submissions/${body.id}/storage`)).json();
  assert.equal(st.status, "stored");
  // Wait for the background review the submission started, so it doesn't outlive the test.
  for (let i = 0; i < 100 && !store.reviews.get(body.id); i++) await new Promise((r) => setTimeout(r, 20));
});

test("API: blob only serves our root hashes; verify detects tampering", async () => {
  assert.equal((await api(`/storage/blob/0x${"ab".repeat(32)}`)).status, 404);
  assert.equal((await api("/storage/blob/not-a-hash")).status, 404);
  const rec = manifest().records["review:proj-2"];
  const blob = await api(`/storage/blob/${rec.rootHash}`);
  assert.equal(blob.status, 200);
  assert.equal(blob.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual((await blob.json()).data, { v: 1 });

  const ok = await (await api("/storage/verify/review/proj-2", { method: "POST" })).json();
  assert.equal(ok.match, true);
  assert.equal(ok.localSha256, ok.remoteSha256);

  // Someone swaps the bytes behind the root: the Merkle/root check catches it.
  const orig = fake.blobs.get(rec.rootHash);
  fake.blobs.set(rec.rootHash, Buffer.from(JSON.stringify({ data: { v: 999 } })));
  const bad = await (await api("/storage/verify/review/proj-2", { method: "POST" })).json();
  assert.equal(bad.match, false);
  assert.match(bad.reason, /don't hash to/);
  fake.blobs.set(rec.rootHash, orig);

  // The local record changed after upload: mismatch too.
  fs.writeFileSync(path.join(DATA, "reviews/proj-2.json"), JSON.stringify({ v: 2 }));
  const drift = await (await api("/storage/verify/review/proj-2", { method: "POST" })).json();
  assert.equal(drift.match, false);
  assert.notEqual(drift.localSha256, drift.remoteSha256);
  fs.writeFileSync(path.join(DATA, "reviews/proj-2.json"), JSON.stringify({ v: 1 }, null, 2));

  const storageInfo = await (await api("/storage")).json();
  assert.equal(storageInfo.enabled, true);
  assert.equal(storageInfo.wallet.address, "0x000000000000000000000000000000000000fa4e");
  const health = await (await api("/health")).json();
  assert.equal(health.storage.enabled, true);
});

test("no secret is ever uploaded: full submission + review + voice-note flow", async () => {
  const { EXAMPLE_FORMS } = await import("../src/judges/seed.mjs");
  const { validateForm } = await import("../src/judges/persona.mjs");
  store.judges.save(EXAMPLE_FORMS.map((f) => ({ ...validateForm(f).persona, example: true })));
  const sub = await (await api("/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await signedSubmission("Leakcheck")) })).json();
  // Main's pipeline may already be reviewing it; reviewNow joins that run.
  const result = await reviewNow(sub.id);
  assert.ok(result.zg.requestIds.length >= 3, "the review ran on the (fake) 0G router");
  const vn = await api("/judges/voice-note", { method: "POST", headers: { "content-type": "audio/webm", authorization: `Bearer ${SECRETS.ADMIN_TOKEN}` }, body: crypto.randomBytes(4000) });
  assert.equal(vn.status, 200);
  const note = await vn.json();
  assert.equal(note.text, "Weigh working demos most.");
  assert.ok(note.id);
  for (let i = 0; i < 100 && !store.reviews.get(sub.id); i++) await new Promise((r) => setTimeout(r, 20));
  await archive.drain();

  const m = manifest().records;
  assert.ok(m[`review:${sub.id}`]);
  assert.ok(m[`submission:${sub.id}`]);
  assert.ok(m[`voice-note:${note.id}`]);
  assert.equal(m[`voice-audio:${note.id}`]?.encrypted, true, "audio stored encrypted");
  // The encrypted audio decrypts with our key back to the same sha256.
  const v = await archive.verifyRecord("voice-audio", note.id);
  assert.equal(v.match, true);
  assert.equal(fs.existsSync(path.join(DATA, "zg-spool")) ? fs.readdirSync(path.join(DATA, "zg-spool")).length : 0, 0, "spooled audio deleted");

  const uploaded = Buffer.concat(fake.state.uploads).toString("latin1");
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!uploaded.includes(value), `${name} leaked`);
    assert.ok(!uploaded.includes(value.replace(/^0x/, "")), `${name} leaked (no 0x)`);
  }
  // The stored-on-0G blobs (ciphertext included) don't carry them either.
  const stored = Object.values(m).flatMap((r) => r.history.map((h) => Buffer.from(fake.blobs.get(h)))).map((b) => b.toString("latin1")).join("");
  for (const value of Object.values(SECRETS)) assert.ok(!stored.includes(value));

  // And the guard refuses a record that contains one.
  store.reviews.save("leaky", { note: `token ${SECRETS.ADMIN_TOKEN}` });
  await archive.drain({ manifest: false });
  const it = outbox().items.find((i) => i.key === "review:leaky");
  assert.equal(it.status, "failed");
  assert.equal(it.lastError.code, "secret_detected");
  assert.equal(store.zgStatus("review", "leaky").status, "failed");
});

test("deleting a project records tombstones on 0G, so a restore doesn't bring it back", async () => {
  store.submissions.add({ id: "gone-1", project: { name: "Gone" }, submittedAt: new Date().toISOString() });
  store.dossiers.save("gone-1", { summary: "x" });
  store.transcripts.save("gone-1", { text: "y" });
  await archive.drain({ manifest: false });
  assert.equal(manifest().records["dossier:gone-1"].history.length, 1);
  store.deleteProject("gone-1");
  await archive.drain({ manifest: false });
  for (const k of ["submission:gone-1", "dossier:gone-1", "transcript:gone-1"]) {
    const r = manifest().records[k];
    assert.equal(r.history.length, 2, k);
    const env = await storage.downloadJSON(r.rootHash);
    assert.equal(env.data.deleted, true);
    assert.equal(env.prev, r.history[0]);
  }
  assert.equal(manifest().records["review:gone-1"], undefined, "no tombstone for records 0G never had");
});

test("restore rebuilds data/ from the head manifest alone, byte for byte", async () => {
  // Drop the leaky record so local == what 0G has.
  fs.rmSync(path.join(DATA, "reviews/leaky.json"), { force: true });
  await archive.drain();
  const head = archive.loadHead();
  assert.ok(head?.rootHash, "manifest uploaded");
  const into = fs.mkdtempSync(path.join(os.tmpdir(), "arena-restore-test-"));
  const { written } = await archive.restoreFromHead(head.rootHash, into);
  assert.ok(written.includes("judges.json") && written.includes("submissions.json"));
  assert.ok(!written.some((f) => f.includes("gone-1")), "deleted project not restored");
  assert.ok(!JSON.parse(fs.readFileSync(path.join(into, "submissions.json"), "utf8")).some((s) => s.id === "gone-1"));
  const files = (dir) =>
    fs
      .readdirSync(dir, { recursive: true })
      // pipeline/ is review-progress state (like the in-memory progress map): not archived on purpose.
      // events.json holds tournaments, which aren't archived yet, like brackets and fights.
      .filter((f) => f.endsWith(".json") && !f.startsWith("zg-") && !f.startsWith(".") && !f.startsWith("pipeline/") && f !== "events.json")
      .sort();
  assert.deepEqual(files(into), files(DATA));
  for (const f of files(DATA)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(into, f), "utf8")), JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")), f);
    assert.equal(fs.readFileSync(path.join(into, f), "utf8"), fs.readFileSync(path.join(DATA, f), "utf8"), `${f} byte-identical`);
  }
});
