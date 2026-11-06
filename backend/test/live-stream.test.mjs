import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";

process.env.ARENA_SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-live-stream-"));
delete process.env.ARENA_SERVER;
const { router } = await import("../src/api.mjs");
const { liveDir } = await import("../src/store.mjs");
const app = express().use("/api", router);
const server = app.listen(0);
const port = await new Promise((r) => server.on("listening", () => r(server.address().port)));
after(() => {
  server.close();
  fs.rmSync(process.env.ARENA_SCRATCH_DIR, { recursive: true, force: true });
});

const get = (p) =>
  new Promise((resolve) => {
    const req = http.get({ port, path: p }, (res) => {
      const chunks = [];
      res.on("data", (c) => {
        chunks.push(c);
        if (Buffer.concat(chunks).includes(Buffer.from([0xff, 0xd9]))) req.destroy();
      });
      res.on("close", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
    });
  });

test("a running device can be watched live as MJPEG; unknown devices can't", async () => {
  const dir = path.join(liveDir("p1"), "laptop");
  fs.mkdirSync(dir, { recursive: true });
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7), Buffer.from([0xff, 0xd9])]);
  fs.writeFileSync(path.join(dir, "live.jpg"), jpg);
  const r = await get("/api/projects/p1/live/stream/laptop");
  assert.equal(r.status, 200);
  assert.match(r.type, /multipart\/x-mixed-replace; boundary=arenaframe/);
  assert.ok(r.body.includes(Buffer.from("content-type: image/jpeg")));
  assert.ok(r.body.includes(jpg), "the newest frame is sent");
  const now = await new Promise((res) => http.get({ port, path: "/api/projects/p1/live/now" }, (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => res(JSON.parse(b))); }));
  assert.deepEqual(now, { laptop: true, phone: false });
  assert.equal((await get("/api/projects/p1/live/stream/..%2Fsecrets")).status, 404);
});
