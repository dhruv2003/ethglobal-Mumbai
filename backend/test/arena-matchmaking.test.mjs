import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-mm-"));
const { submissions, dossiers } = await import("../src/store.mjs");
const { proposeBracket, verifyProposal, embeddingText } = await import("../src/arena/matchmaking.mjs");

const kinds = { s1: "defi", s2: "game", s3: "defi", s4: "game" };
for (const id of Object.keys(kinds)) {
  submissions.add({ id, project: { name: `P-${id}` }, team: { name: `Team ${id}` }, ownerWallet: `0x${id}`, tracks: [kinds[id]] });
  dossiers.save(id, { summary: kinds[id], problem: kinds[id], intendedUsers: "x", coreJourney: [], architecture: [], dependencies: [{ name: "viem" }] });
}
// A fake embedding model: defi texts point one way, game texts another.
const embed = async (texts) => texts.map((t) => (t.includes("defi") ? [1, 0.1, 0] : [0, 0.1, 1]));

test("round one pairs the most similar projects and the bracket is hashed", async () => {
  const p = await proposeBracket({ submissionIds: ["s1", "s2", "s3", "s4"], seed: "0xseed", embed });
  const pairs = p.explain.map((m) => [m.a, m.b].sort().join("+")).sort();
  assert.deepEqual(pairs, ["s1+s3", "s2+s4"]);
  assert.match(p.resultHash, /^[0-9a-f]{64}$/);
  assert.equal(p.slots.length, 4);
  const again = await proposeBracket({ submissionIds: ["s1", "s2", "s3", "s4"], seed: "0xseed", embed });
  assert.equal(again.resultHash, p.resultHash, "same inputs, same bracket");
});

test("a stored proposal only verifies for exactly its bracket order", async () => {
  const p = await proposeBracket({ submissionIds: ["s1", "s2", "s3", "s4"], seed: "0xseed2", embed });
  assert.ok(verifyProposal(p.resultHash, p.slots));
  assert.equal(verifyProposal(p.resultHash, [...p.slots].reverse()), null);
  assert.equal(verifyProposal("nothex", p.slots), null);
});

test("two projects have one possible fight", async () => {
  const p = await proposeBracket({ submissionIds: ["s1", "s2"], seed: "x", embed });
  assert.deepEqual(p.slots, ["s1", "s2"]);
  assert.equal(p.explain[0].similarityPct, null);
});

test("the embedded text comes from the reviewer's dossier only", () => {
  assert.match(embeddingText({ problem: "P", intendedUsers: "U", summary: "S", coreJourney: ["a"], architecture: [{ component: "C", detail: "D" }] }), /Problem: P[\s\S]*C: D/);
});
