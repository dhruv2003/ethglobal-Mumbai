import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-pipeline-judges-"));
process.env.JUDGE_PROVIDER = "0g";
process.env.ZG_API_KEY = crypto.randomUUID();
// Keep the pre-fix helper credentialed too, so this test isolates queue reporting.
process.env.OPENAI_API_KEY = crypto.randomUUID();
process.env.REVIEW_CONCURRENCY = "1";
delete process.env.ARENA_SERVER;
const { router } = await import("../src/api.mjs");
const { enqueue, isRunning, queueLength } = await import("../src/reviewer/pipeline.mjs");
const { submissions, reviews } = await import("../src/store.mjs");
after(() => fs.rmSync(process.env.ARENA_DATA_DIR, { recursive: true, force: true }));

test("review polling stays active for both running and queued pipelines, retaining the last scores", async () => {
  const ids = ["pipeline-active", "pipeline-queued"];
  for (const id of ids) submissions.add({ id, repoUrl: "invalid-repo-url", project: { name: id } });
  const lastResult = { reviews: [], panelHundredths: 7000 };
  reviews.save(ids[0], lastResult);
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { started = resolve; });
  const judgeOptions = [];
  const judge = async (_id, options) => { judgeOptions.push(options); started(); await gate; return { reviews: [] }; };
  enqueue(ids[0], { judge });
  await ready;
  enqueue(ids[1], { judge });
  // Exercise the real route handler without opening a socket or calling an LLM.
  const route = router.stack.find((layer) => layer.route?.path === "/projects/:id/reviews" && layer.route.methods.get).route;
  const status = (id) => {
    let result;
    route.stack.at(-1).handle({ params: { id } }, { json: (body) => { result = body; } });
    return result;
  };
  try {
    assert.equal(status(ids[0]).running, true);
    assert.equal(status(ids[1]).running, true);
    assert.deepEqual(status(ids[0]).result, lastResult);
  } finally {
    release();
    for (let i = 0; i < 100 && (queueLength() || ids.some(isRunning)); i++) await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(status(ids[0]).running, false);
  assert.equal(status(ids[1]).running, false);
  assert.deepEqual(judgeOptions.map(({ onEvent, log, ...rest }) => rest), [{ freshEvidence: true }, { freshEvidence: true }]);
  assert.ok(judgeOptions.every((o) => typeof o.onEvent === "function"), "the pipeline listens for each judge finishing");
});
