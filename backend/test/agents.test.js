// Offline tests: no 0G calls. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { tallyRulings } = require("../src/agents");
const { parseJsonLoose } = require("../src/zg/client");
const { matchContext } = require("../src/agents/dossier");
const v = require("../src/agents/validate");
const { CRITERIA } = require("../src/agents/rubric");

const dossier = (ids) => ({ commit: "abc", summary: "s", evidence: ids.map((id) => ({ id, claim: `claim ${id}`, status: "supported_by_code" })) });
const ctx = matchContext({ A: { project: { name: "Alpha" }, dossier: dossier(["E1", "E2"]) }, B: { project: { name: "Beta" }, dossier: dossier(["E1"]) } });

test("rubric weights sum to 100", () => {
  assert.equal(CRITERIA.reduce((s, c) => s + c.weight, 0), 100);
});

test("evidence IDs are namespaced per corner", () => {
  assert.deepEqual([...ctx.evidenceIds].sort(), ["A:E1", "A:E2", "B:E1"]);
  assert.match(ctx.briefs.A, /<untrusted_data/);
});

test("tallyRulings: majority wins, otherwise mixed", () => {
  assert.equal(tallyRulings(["upheld", "upheld", "rejected"]), "upheld");
  assert.equal(tallyRulings(["upheld", "rejected", "inconclusive"]), "mixed");
});

test("parseJsonLoose handles fences and prose", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.throws(() => parseJsonLoose("no json here"));
});

test("turn validator enforces words, claim type and real evidence IDs", () => {
  const check = v.turn(5, ctx.evidenceIds);
  assert.deepEqual(check({ text: "short and true", claimType: "implemented_feature", evidenceIds: ["A:E1"] }), []);
  const bad = check({ text: "one two three four five six", claimType: "boast", evidenceIds: ["A:E9"] });
  assert.equal(bad.length, 3);
});

test("challenge turns must name the claim they target", () => {
  const p = v.turn(40, ctx.evidenceIds, { needsTarget: true })({ text: "x", claimType: "challenge", evidenceIds: [] });
  assert.ok(p.some((m) => m.includes("targetClaim")));
});

test("scorecard validator: bounds, uncertainty, rulings for every challenge", () => {
  const check = v.scorecard(ctx.evidenceIds, ["c1"]);
  const good = {
    scores: {
      A: { score: 70, justification: "ok", evidenceIds: ["A:E1"], uncertainty: "low" },
      B: { score: 55, justification: "ok", evidenceIds: [], uncertainty: "medium" },
    },
    rulings: [{ challengeId: "c1", label: "upheld", reason: "r" }],
  };
  assert.deepEqual(check(good), []);
  const bad = structuredClone(good);
  bad.scores.A.score = 101;
  bad.scores.B.uncertainty = "none";
  bad.rulings = [];
  assert.equal(check(bad).length, 3);
});
