import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_SOURCE, MATCH_STEP, ORGANIZER_DECISION_LABEL, decideMatch } from '../src/index.js';

const main = (v) =>
  ['j1', 'j2', 'j3'].map((judgeId) => ({
    judgeId,
    scores: { product: v, engineering: v, innovation: v, feasibility: v, defense: v },
  }));
const tb = (v) =>
  ['j1', 'j2', 'j3'].map((judgeId) => ({ judgeId, scores: { productReasoning: v, evidenceDefense: v } }));

const decision = {
  organizerId: 'org-1',
  winnerProjectId: 'p-b',
  rationale: 'Product criterion: B shows a working end-to-end journey backed by passing tests.',
  decidedAt: 1_800_000_000_000,
  signature: '0xsigned',
};

test('higher main score wins outright', () => {
  const r = decideMatch({ a: { projectId: 'p-a', scorecards: main(80) }, b: { projectId: 'p-b', scorecards: main(70) } });
  assert.equal(r.step, MATCH_STEP.DECIDED);
  assert.equal(r.winnerProjectId, 'p-a');
  assert.equal(r.decisionSource, DECISION_SOURCE.SCORES);
});

test('first tie asks for exactly one tie-break round (AC-13)', () => {
  const r = decideMatch({ a: { projectId: 'p-a', scorecards: main(80) }, b: { projectId: 'p-b', scorecards: main(80) } });
  assert.equal(r.step, MATCH_STEP.RUN_TIEBREAK);
  assert.equal(r.winnerProjectId, undefined);
});

test('tie-break decides and the main scores stay unchanged (TIE-02)', () => {
  const r = decideMatch({
    a: { projectId: 'p-a', scorecards: main(80) },
    b: { projectId: 'p-b', scorecards: main(80) },
    tiebreak: { a: tb(60), b: tb(70) },
  });
  assert.equal(r.step, MATCH_STEP.DECIDED);
  assert.equal(r.winnerProjectId, 'p-b');
  assert.equal(r.decisionSource, DECISION_SOURCE.TIEBREAK);
  assert.equal(r.scores.a.display, '80.00');
  assert.equal(r.scores.b.display, '80.00');
  assert.equal(r.tiebreakScores.b.display, '70.00');
});

test('second tie goes to human review, never a third AI round (AC-14)', () => {
  const r = decideMatch({
    a: { projectId: 'p-a', scorecards: main(80) },
    b: { projectId: 'p-b', scorecards: main(80) },
    tiebreak: { a: tb(65), b: tb(65) },
  });
  assert.equal(r.step, MATCH_STEP.HUMAN_REVIEW);
  assert.equal(r.winnerProjectId, undefined);
});

test('organizer decision picks the winner and keeps original scores (AC-15)', () => {
  const r = decideMatch({
    a: { projectId: 'p-a', scorecards: main(80) },
    b: { projectId: 'p-b', scorecards: main(80) },
    tiebreak: { a: tb(65), b: tb(65) },
    organizerDecision: decision,
  });
  assert.equal(r.step, MATCH_STEP.DECIDED);
  assert.equal(r.winnerProjectId, 'p-b');
  assert.equal(r.decisionSource, DECISION_SOURCE.ORGANIZER);
  assert.equal(r.label, ORGANIZER_DECISION_LABEL);
  assert.equal(r.scores.a.finalHundredths, r.scores.b.finalHundredths);
  assert.equal(r.organizerDecision.organizerId, 'org-1');
});

test('organizer decision must be complete and pick a tied project', () => {
  const base = {
    a: { projectId: 'p-a', scorecards: main(80) },
    b: { projectId: 'p-b', scorecards: main(80) },
    tiebreak: { a: tb(65), b: tb(65) },
  };
  assert.throws(() => decideMatch({ ...base, organizerDecision: { ...decision, winnerProjectId: 'p-c' } }), {
    code: 'INVALID_DECISION',
  });
  assert.throws(() => decideMatch({ ...base, organizerDecision: { ...decision, rationale: 'B is better' } }), {
    code: 'INVALID_DECISION',
  });
  const { signature, ...unsigned } = decision;
  assert.throws(() => decideMatch({ ...base, organizerDecision: unsigned }), { code: 'INVALID_DECISION' });
});

test('tie-break or review data is refused when it does not apply', () => {
  assert.throws(
    () =>
      decideMatch({
        a: { projectId: 'p-a', scorecards: main(80) },
        b: { projectId: 'p-b', scorecards: main(70) },
        tiebreak: { a: tb(60), b: tb(70) },
      }),
    { code: 'UNEXPECTED_TIEBREAK' },
  );
  assert.throws(
    () =>
      decideMatch({
        a: { projectId: 'p-a', scorecards: main(80) },
        b: { projectId: 'p-b', scorecards: main(80) },
        organizerDecision: decision,
      }),
    { code: 'UNEXPECTED_REVIEW' },
  );
  assert.throws(
    () =>
      decideMatch({
        a: { projectId: 'p-a', scorecards: main(80) },
        b: { projectId: 'p-b', scorecards: main(80) },
        tiebreak: { a: tb(60), b: tb(70) },
        organizerDecision: decision,
      }),
    { code: 'UNEXPECTED_REVIEW' },
  );
});

test('same inputs always give the same result (AC-11)', () => {
  const input = {
    a: { projectId: 'p-a', scorecards: main(77) },
    b: { projectId: 'p-b', scorecards: main(76) },
  };
  assert.deepEqual(decideMatch(input), decideMatch(structuredClone(input)));
});
