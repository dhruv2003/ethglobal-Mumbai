import { test } from "node:test";
import assert from "node:assert/strict";

// Under node --test the database is in memory only (arkiv/db.mjs): nothing touches Arkiv, 0G or the disk.
const { db, deleteProject, dossiers, evidence, liveTests, pipelines, reviews, submissions, videos } = await import("../src/store.mjs");
const { fileInfo, filesOf, getFile, putFile } = await import("../src/zg/files.mjs");

test("deleting a project removes it and everything stored for it, and nothing else", async () => {
  submissions.add({ id: "del-1", project: { name: "Gone" } });
  submissions.add({ id: "keep-1", project: { name: "Stays" } });
  for (const store of [reviews, pipelines, dossiers, evidence, liveTests]) {
    store.save("del-1", { x: 1 });
    store.save("keep-1", { x: 2 });
  }
  videos.save("del-1", { ext: "mp4" });
  putFile("del-1", "demo.mp4", Buffer.from("video"), { mime: "video/mp4", kind: "demo-video" });
  putFile("del-1", "live/laptop/video.mp4", Buffer.from("rec"), { mime: "video/mp4", kind: "live-recording" });
  putFile("keep-1", "demo.mp4", Buffer.from("other"), { mime: "video/mp4", kind: "demo-video" });
  deleteProject("del-1");
  assert.equal(submissions.get("del-1"), null);
  assert.ok(submissions.get("keep-1"));
  for (const store of [reviews, pipelines, dossiers, evidence, liveTests]) {
    assert.equal(store.get("del-1"), null);
    assert.deepEqual(store.get("keep-1"), { x: 2 });
  }
  assert.equal(videos.get("del-1"), null);
  assert.deepEqual(filesOf("del-1"), []);
  assert.equal((await getFile("keep-1", "demo.mp4")).toString(), "other");
});

test("reads are copies: changing what you read never changes the store", () => {
  pipelines.save("p1", { steps: [{ status: "queued" }] });
  const got = pipelines.get("p1");
  got.steps[0].status = "done";
  assert.equal(pipelines.get("p1").steps[0].status, "queued");
  const value = { n: 1 };
  db.put("c", "a", value);
  value.n = 2;
  assert.equal(db.get("c", "a").n, 1);
});

test("submissions list oldest first, and the database reports what it holds", () => {
  submissions.add({ id: "late", submittedAt: "2026-02-01T00:00:00Z" });
  submissions.add({ id: "early", submittedAt: "2026-01-01T00:00:00Z" });
  const ids = submissions.list().map((s) => s.id);
  assert.ok(ids.indexOf("early") < ids.indexOf("late"));
  const st = db.status();
  assert.equal(st.backend, "memory");
  assert.ok(st.collections.submissions >= 2);
});

test("a file is indexed with its size and sha256, and the same bytes are stored once", async () => {
  const a = putFile("uploads", "x.png", Buffer.from("png-bytes"), { mime: "image/png", kind: "upload-image" });
  assert.equal(a.size, 9);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(putFile("uploads", "x.png", Buffer.from("png-bytes"), { mime: "image/png" }).savedAt, a.savedAt);
  assert.equal(fileInfo("uploads", "x.png").mime, "image/png");
  assert.equal((await getFile("uploads", "x.png")).toString(), "png-bytes");
  assert.equal(await getFile("uploads", "nope.png"), null);
});
