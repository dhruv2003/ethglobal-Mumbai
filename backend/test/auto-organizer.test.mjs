import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketsToCreate, organizerPass, pickField, schedule } from "../src/arena/autoOrganizer.mjs";

const OVERALL = { id: "overall", name: "Overall finalist" };
const entry = (id, tracks = ["base"], extra = {}) => ({ id, tracks, ready: true, reviewing: false, submittedAt: id, ...extra });
const event = { id: "eth", name: "ETH", deadline: "2026-01-01T00:00:00Z", tracks: [{ id: "base", name: "Base" }, { id: "ens", name: "ENS" }], bettingMinutes: 10 };
const AFTER = Date.parse("2026-01-02T00:00:00Z");
const BEFORE = Date.parse("2025-12-31T00:00:00Z");

test("the bracket is the largest allowed size, earliest submissions first", () => {
  assert.deepEqual(pickField(["e", "b", "a", "d", "c"].map((x) => entry(x))), ["a", "b", "c", "d"]);
  assert.deepEqual(pickField([entry("a")]), []);
});
test("a project with no dossier doesn't enter", () => {
  assert.deepEqual(pickField([entry("a"), entry("b"), entry("c", [], { ready: false })]), ["a", "b"]);
});
test("nothing is created before the deadline or while reviews are running", () => {
  assert.deepEqual(bracketsToCreate(event, [entry("a"), entry("b")], [], OVERALL, BEFORE), []);
  assert.deepEqual(bracketsToCreate(event, [entry("a"), entry("b", ["base"], { reviewing: true })], [], OVERALL, AFTER), []);
});
test("each track with enough projects gets a bracket, plus the overall one", () => {
  const out = bracketsToCreate(event, [entry("a", ["base", "ens"]), entry("b", ["base"]), entry("c", ["ens"])], [], OVERALL, AFTER);
  assert.deepEqual(out.map((x) => [x.track.id, x.field]), [["base", ["a", "b"]], ["ens", ["a", "c"]]]);
});
test("a track with one project has no bracket", () => {
  const out = bracketsToCreate(event, [entry("a", ["base"]), entry("b", ["base"]), entry("c", ["ens"])], [], OVERALL, AFTER);
  assert.deepEqual(out.map((x) => x.track.id), ["base"]);
});
test("a bracket is only ever created once", () => {
  const made = [{ eventId: "eth", trackId: "base" }, { eventId: "eth", trackId: "overall" }];
  assert.deepEqual(bracketsToCreate(event, [entry("a"), entry("b")], made, OVERALL, AFTER), []);
});
test("the schedule meets the contract's minimum resolution window", () => {
  const s = schedule(1000n, 10, 4);
  assert.equal(s.bettingCutoff, 1600n);
  assert.equal(s.scheduledStart, 1660n);
  assert.ok(s.resolutionDeadline >= s.scheduledStart + 3n * 86400n);
});

const bracket = { id: "3", eventId: "eth", trackId: "base", projects: [{}, {}] };
function world({ tournament, open = true }) {
  const calls = [];
  return {
    calls,
    deps: {
      events: () => [],
      entries: () => [],
      brackets: () => [bracket],
      overall: OVERALL,
      createAndRegister: async () => assert.fail("nothing to create"),
      readTournament: async () => tournament,
      readMatch: async () => ({ status: 0 }),
      freeze: async () => calls.push("freeze"),
      openMatch: async (b, i) => calls.push(`open:${i}`),
      canOpen: async () => open,
      botAddress: "0xBOT",
    },
  };
}
test("a created bracket gets frozen, then its match opens", async () => {
  const a = world({ tournament: { organizer: "0xbot", status: 1 } });
  await organizerPass(a.deps);
  assert.deepEqual(a.calls, ["freeze"]);
  const b = world({ tournament: { organizer: "0xbot", status: 2 } });
  await organizerPass(b.deps);
  assert.deepEqual(b.calls, ["open:0"]);
});
test("a later round waits until the contract says it can open", async () => {
  const w = world({ tournament: { organizer: "0xbot", status: 2 }, open: false });
  await organizerPass(w.deps);
  assert.deepEqual(w.calls, []);
});
test("brackets run by someone else are never touched", async () => {
  const w = world({ tournament: { organizer: "0xADMIN", status: 2 } });
  await organizerPass(w.deps);
  assert.deepEqual(w.calls, []);
});
test("the overall bracket runs only when it differs from every track", () => {
  const four = [entry("a", ["base"]), entry("b", ["base"]), entry("c", ["ens"]), entry("d", ["ens"])];
  const out = bracketsToCreate(event, four, [], OVERALL, AFTER);
  assert.deepEqual(out.map((x) => [x.track.id, x.field]), [["base", ["a", "b"]], ["ens", ["c", "d"]], ["overall", ["a", "b", "c", "d"]]]);
});
test("an existing bracket with the same projects also stops a repeat", () => {
  const made = [{ eventId: "eth", trackId: "base", projects: [{ submissionId: "a" }, { submissionId: "b" }] }];
  assert.deepEqual(bracketsToCreate(event, [entry("a"), entry("b")], made, OVERALL, AFTER), []);
});
