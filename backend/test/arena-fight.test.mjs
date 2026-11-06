import test from "node:test";
import assert from "node:assert/strict";
import agents from "../src/agents/index.js";
import { runFight } from "../src/arena/fight.mjs";

const dossier = (p) => ({ summary: p, evidence: [{ id: "E1", status: "verified", claim: `${p} works`, observation: "seen" }] });
const corners = { A: { project: { name: "Alpha" }, dossier: dossier("Alpha") }, B: { project: { name: "Beta" }, dossier: dossier("Beta") } };
const tr = { requestId: "req", teeVerified: true, costUsdMicro: 1000 };

function stub({ a, b, tbA = 50, tbB = 50 }) {
  let tiebreak = false;
  agents.createFighter = async ({ project }) => ({ fighterName: project.name, openingPitch: "hi", archetype: "x", catchphrase: "y", traces: [tr], trace: tr });
  agents.judgeQuestion = async ({ tiebreak: t }) => { if (t) tiebreak = true; return { question: "Why?", trace: tr, traces: [tr] }; };
  agents.advocateTurn = async ({ side, kind }) => ({ side, kind, text: `${side} ${kind}`, claimType: "challenge", targetClaim: "x", evidenceIds: [`${side}:E1`], trace: tr, traces: [tr] });
  agents.judgeScorecard = async ({ judge, challenges }) => ({
    judgeId: judge.id,
    scores: tiebreak ? { A: { score: tbA, justification: "j", uncertainty: "low" }, B: { score: tbB, justification: "j", uncertainty: "low" } } : { A: { score: a, justification: "j", uncertainty: "low" }, B: { score: b, justification: "j", uncertainty: "low" } },
    rulings: challenges.map((c) => ({ challengeId: c.challengeId, label: "rejected", reason: "r" })),
    trace: tr,
    traces: [tr],
  });
}

test("a clear winner is decided on score, in the player's event format", async () => {
  stub({ a: 80, b: 60 });
  const r = await runFight({ corners });
  assert.equal(r.scores.a, 8000);
  assert.equal(r.scores.b, 6000);
  assert.deepEqual(r.tie, { a: 0, b: 0 });
  assert.equal(r.needsReview, false);
  assert.equal(r.events.filter((e) => e.type === "round_sealed").length, 6);
  assert.deepEqual(r.ui, { ran: false, images: { a: 0, b: 0 }, sources: { a: null, b: null } });
  assert.deepEqual(r.events.at(-1), { ...r.events.at(-1), type: "result", winner: "a", reason: "score" });
  assert.match(r.resultHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(r.events.map((e) => e.seq), r.events.map((_, i) => i + 1));
});

test("tied scores run one tie-break round", async () => {
  stub({ a: 70, b: 70, tbA: 90, tbB: 40 });
  const r = await runFight({ corners });
  assert.equal(r.scores.a, r.scores.b);
  assert.equal(r.tie.a, 9000);
  assert.equal(r.tie.b, 4000);
  assert.equal(r.events.at(-1).reason, "tie_break");
});

test("a double tie goes to human review with no winner", async () => {
  stub({ a: 70, b: 70, tbA: 55, tbB: 55 });
  const r = await runFight({ corners });
  assert.equal(r.needsReview, true);
  assert.equal(r.events.at(-1).type, "human_review");
  assert.ok(!r.events.some((e) => e.type === "result"));
});

const realCompareUi = agents.compareUi;
const img = (id) => ({ id, label: "team screenshot", image: Buffer.from("x"), mime: "image/jpeg" });

test("the UI face-off runs first and its findings become evidence for the ui round", async () => {
  stub({ a: 80, b: 60 });
  let seen = null;
  const asked = [];
  agents.compareUi = async ({ images }) => {
    seen = images;
    return {
      A: { screens: "A dashboard", strengths: ["clear primary button"], issues: [], demoMatchesLive: "yes" },
      B: { screens: "B landing page", strengths: [], issues: [{ detail: "overlapping text on phone", severity: 4, images: ["B1"] }], demoMatchesLive: "no" },
      comparison: "A1 shows a working flow; B1 is a landing page.",
      edge: "A",
      trace: tr,
      traces: [tr],
    };
  };
  const scorecard = agents.judgeScorecard;
  agents.judgeScorecard = async (args) => {
    asked.push(args);
    return scorecard(args);
  };
  const r = await runFight({ corners: { A: { ...corners.A, ui: { images: [img("A1")], sources: { team: 1 } } }, B: { ...corners.B, ui: { images: [img("B1")], sources: { team: 1 } } } } });
  assert.deepEqual(seen.A.map((x) => x.id), ["A1"]);
  const uiRound = asked.find((x) => x.criterionId === "ui");
  assert.ok(uiRound.ctx.evidenceIds.has("A:U1") && uiRound.ctx.evidenceIds.has("B:U3"));
  assert.match(uiRound.ctx.briefs.B, /overlapping text on phone/);
  assert.equal(r.ui.ran, true);
  assert.equal(r.ui.edge, "a");
  assert.ok(r.rounds.ui);
  agents.compareUi = realCompareUi;
  agents.judgeScorecard = scorecard;
});

test("a failed UI face-off doesn't stop the fight", async () => {
  stub({ a: 80, b: 60 });
  agents.compareUi = async () => {
    throw new Error("0G timed out");
  };
  const r = await runFight({ corners: { A: { ...corners.A, ui: { images: [img("A1")], sources: null } }, B: corners.B } });
  assert.equal(r.ui.ran, false);
  assert.match(r.ui.error, /timed out/);
  assert.equal(r.events.at(-1).type, "result");
  agents.compareUi = realCompareUi;
});
