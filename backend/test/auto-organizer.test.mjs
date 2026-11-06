import { test } from "node:test";
import assert from "node:assert/strict";
import { organizerPass, pickField, schedule } from "../src/arena/autoOrganizer.mjs";

const sub = (id, ready = true) => ({ id, ready, submittedAt: id });
const bracket = (id, ids) => ({ id, projects: ids.map((submissionId) => ({ submissionId })) });

test("one ready project waits; two make a tournament", () => {
  assert.deepEqual(pickField([sub("a")], []), []);
  assert.deepEqual(pickField([sub("a"), sub("b")], []), ["a", "b"]);
});
test("the field is the largest allowed size, oldest first", () => {
  assert.deepEqual(pickField(["e", "b", "a", "d", "c"].map((x) => sub(x)), []), ["a", "b", "c", "d"]);
});
test("projects still in review or already in a bracket are left out", () => {
  assert.deepEqual(pickField([sub("a"), sub("b"), sub("c", false)], [bracket("1", ["a"])]), []);
  assert.deepEqual(pickField([sub("a"), sub("b"), sub("c")], [bracket("1", ["a"])]), ["b", "c"]);
});
test("the schedule meets the contract's minimum resolution window", () => {
  const s = schedule(1000n, 10, 4);
  assert.equal(s.bettingCutoff, 1600n);
  assert.equal(s.scheduledStart, 1660n);
  assert.ok(s.resolutionDeadline >= s.scheduledStart + 3n * 86400n);
});

function world({ tournament, matches = [{ status: 0 }], open = true }) {
  const calls = [];
  return {
    calls,
    deps: {
      submissions: () => [],
      brackets: () => [bracket("3", ["a", "b"])],
      createAndRegister: async () => assert.fail("nothing to create"),
      readTournament: async () => tournament,
      readMatch: async (id, i) => matches[Number(i)],
      freeze: async () => calls.push("freeze"),
      openMatch: async (id, i) => calls.push(`open:${i}`),
      canOpen: async () => open,
      botAddress: "0xBOT",
    },
  };
}
test("a created tournament gets frozen, then its match opens", async () => {
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
test("tournaments run by someone else are never touched", async () => {
  const w = world({ tournament: { organizer: "0xADMIN", status: 2 } });
  await organizerPass(w.deps);
  assert.deepEqual(w.calls, []);
});
test("a new field creates a tournament", async () => {
  const w = world({ tournament: { organizer: "0xADMIN", status: 2 } });
  w.deps.submissions = () => [sub("c"), sub("d")];
  let got;
  w.deps.createAndRegister = async (field) => ((got = field), 4n);
  await organizerPass(w.deps);
  assert.deepEqual(got, ["c", "d"]);
});
