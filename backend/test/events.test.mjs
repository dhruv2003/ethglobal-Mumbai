import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-events-test-"));
const { submissionProblem, validateEvent } = await import("../src/events.mjs");

const NOW = Date.parse("2026-01-01T00:00:00Z");
const form = { name: "ETH Global", tracks: [{ name: "Base", prize: "$5,000" }, { name: "ENS" }], deadline: "2026-01-02T00:00:00Z", bettingMinutes: 10, judgeIds: ["a", "b", "c"] };
const opts = { judgeIds: ["a", "b", "c", "d"], now: NOW, createdBy: "0xORG" };

test("a good form makes a tournament with its tracks", () => {
  const { event, errors } = validateEvent(form, opts);
  assert.equal(errors, undefined);
  assert.equal(event.id, "eth-global");
  assert.deepEqual(event.tracks.map((t) => t.id), ["base", "ens"]);
  assert.equal(event.tracks[0].prize, "$5,000");
  assert.equal(event.createdBy, "0xORG");
});
test("names must be unique and not look like a bracket number", () => {
  assert.ok(validateEvent(form, { ...opts, existing: [{ id: "eth-global" }] }).errors.name);
  assert.ok(validateEvent({ ...form, name: "2026" }, opts).errors.name);
});
test("it needs tracks, a future deadline, a betting window and exactly 3 known judges", () => {
  assert.ok(validateEvent({ ...form, tracks: [] }, opts).errors.tracks);
  assert.ok(validateEvent({ ...form, tracks: [{ name: "Base" }, { name: "base" }] }, opts).errors.tracks);
  assert.ok(validateEvent({ ...form, tracks: [{ name: "Overall" }] }, opts).errors.tracks);
  assert.ok(validateEvent({ ...form, deadline: "2025-01-01T00:00:00Z" }, opts).errors.deadline);
  assert.ok(validateEvent({ ...form, bettingMinutes: 0 }, opts).errors.bettingMinutes);
  assert.ok(validateEvent({ ...form, judgeIds: ["a", "b"] }, opts).errors.judgeIds);
  assert.ok(validateEvent({ ...form, judgeIds: ["a", "b", "z"] }, opts).errors.judgeIds);
});
test("a submission must be on time and use this tournament's tracks", () => {
  const { event } = validateEvent(form, opts);
  assert.equal(submissionProblem(event, ["base"], NOW), null);
  assert.match(submissionProblem(null, [], NOW), /tournament/);
  assert.match(submissionProblem(event, ["base"], Date.parse("2026-01-03T00:00:00Z")), /closed/);
  assert.match(submissionProblem(event, ["world"], NOW), /isn't part/);
  assert.match(submissionProblem(event, ["a", "b", "c", "d"], NOW), /at most/);
});
