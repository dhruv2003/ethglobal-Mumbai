import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, isRunning, queueLength, queuePosition } from "../src/reviewer/pipeline.mjs";

const noJudge = async () => ({ reviews: [] });

test("projects wait in line one at a time, in order, and the line drains", async () => {
  // Unknown ids fail fast inside the job, which is enough to exercise the queue.
  const ids = ["q-a", "q-b", "q-c"];
  const positions = ids.map((id) => enqueue(id, { judge: noJudge }));
  assert.deepEqual(positions, [0, 1, 2]); // first starts now, then 1st and 2nd in line
  assert.ok(isRunning("q-a"));
  assert.equal(queuePosition("q-b"), 1);
  assert.equal(queuePosition("q-c"), 2);
  assert.equal(enqueue("q-b", { judge: noJudge }), 1); // enqueueing twice keeps its place
  for (let i = 0; i < 50 && (queueLength() || ids.some(isRunning)); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(queueLength(), 0);
  assert.ok(!ids.some(isRunning));
});
