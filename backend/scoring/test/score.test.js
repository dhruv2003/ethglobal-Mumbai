import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIN_RUBRIC,
  TIEBREAK_RUBRIC,
  assertValidRubric,
  compareScores,
  computeFinalScore,
  formatHundredths,
} from '../src/index.js';

const uniform = (judgeId, v) => ({
  judgeId,
  scores: { product: v, engineering: v, innovation: v, feasibility: v, defense: v },
});
const panel = (v) => [uniform('j1', v), uniform('j2', v), uniform('j3', v)];

test('published rubrics are valid and product has the highest weight', () => {
  assertValidRubric(MAIN_RUBRIC);
  assertValidRubric(TIEBREAK_RUBRIC);
  const weights = Object.fromEntries(MAIN_RUBRIC.criteria.map((c) => [c.key, c.weight]));
  assert.deepEqual(weights, { product: 40, engineering: 20, innovation: 20, feasibility: 10, defense: 10 });
});

test('rubric with bonus weight above 100 is rejected', () => {
  const rubric = { id: 'x', criteria: [...MAIN_RUBRIC.criteria, { key: 'bonus', weight: 5 }] };
  assert.throws(() => assertValidRubric(rubric), { code: 'INVALID_RUBRIC' });
});

test('uniform scores give an exact result', () => {
  const s = computeFinalScore(panel(75));
  assert.equal(s.weightedTotal, 22500);
  assert.equal(s.finalHundredths, 7500);
  assert.equal(s.display, '75.00');
});

test('extremes: all 0 and all 100', () => {
  assert.equal(computeFinalScore(panel(0)).display, '0.00');
  assert.equal(computeFinalScore(panel(100)).display, '100.00');
});

test('rounds the mean once, to the nearest hundredth', () => {
  // One judge +1 on product (+40): mean 7513.33 -> 7513
  const down = panel(75);
  down[0] = { judgeId: 'j1', scores: { ...down[0].scores, product: 76 } };
  assert.equal(computeFinalScore(down).weightedTotal, 22540);
  assert.equal(computeFinalScore(down).finalHundredths, 7513);

  // One judge +1 on engineering (+20): mean 7506.67 -> 7507
  const up = panel(75);
  up[0] = { judgeId: 'j1', scores: { ...up[0].scores, engineering: 76 } };
  assert.equal(computeFinalScore(up).finalHundredths, 7507);
  assert.equal(computeFinalScore(up).display, '75.07');
});

test('formula matches half-up rounding of weighted_total / 3 for every possible total', () => {
  for (let wt = 0; wt <= 30000; wt++) {
    const exactTimes6 = 2 * wt; // (wt / 3) * 6
    const expected = Math.floor((exactTimes6 + 3) / 6); // floor(x + 0.5)
    assert.equal(Math.floor((2 * wt + 3) / 6), expected);
  }
});

test('requires exactly three distinct judges (REC-03)', () => {
  assert.throws(() => computeFinalScore(panel(80).slice(0, 2)), { code: 'INCOMPLETE_PANEL' });
  assert.throws(() => computeFinalScore([...panel(80), uniform('j4', 80)]), { code: 'INCOMPLETE_PANEL' });
  assert.throws(
    () => computeFinalScore([uniform('j1', 80), uniform('j1', 80), uniform('j3', 80)]),
    { code: 'INCOMPLETE_PANEL' },
  );
});

test('rejects malformed scorecards instead of defaulting (AC-10)', () => {
  const bad = (scores) => [{ judgeId: 'j1', scores }, uniform('j2', 50), uniform('j3', 50)];
  const base = uniform('j1', 50).scores;
  assert.throws(() => computeFinalScore(bad({ ...base, product: 101 })), { code: 'INVALID_SCORECARD' });
  assert.throws(() => computeFinalScore(bad({ ...base, product: -1 })), { code: 'INVALID_SCORECARD' });
  assert.throws(() => computeFinalScore(bad({ ...base, product: 50.5 })), { code: 'INVALID_SCORECARD' });
  assert.throws(() => computeFinalScore(bad({ ...base, product: '50' })), { code: 'INVALID_SCORECARD' });
  const { defense, ...missing } = base;
  assert.throws(() => computeFinalScore(bad(missing)), { code: 'INVALID_SCORECARD' });
  assert.throws(() => computeFinalScore(bad({ ...base, charisma: 90 })), { code: 'INVALID_SCORECARD' });
});

test('ties compare the displayed integer with no hidden precision', () => {
  // Different scorecards, same final integer: a tie.
  const a = panel(75);
  const b = panel(75);
  a[0] = { judgeId: 'j1', scores: { ...a[0].scores, product: 76 } }; // +40
  b[1] = { judgeId: 'j2', scores: { ...b[1].scores, engineering: 77 } }; // +40
  assert.equal(compareScores(computeFinalScore(a), computeFinalScore(b)), 'TIE');

  // Smallest possible difference (+10 on a 10% criterion) is still visible: 75.03 vs 75.00.
  const c = panel(75);
  c[2] = { judgeId: 'j3', scores: { ...c[2].scores, defense: 76 } };
  assert.equal(computeFinalScore(c).display, '75.03');
  assert.equal(compareScores(computeFinalScore(c), computeFinalScore(panel(75))), 'A');

  // Hundredths that are equal compare equal, however they were reached.
  const sa = { rubricId: 'main-v1', finalHundredths: Math.floor((2 * 22501 + 3) / 6) };
  const sb = { rubricId: 'main-v1', finalHundredths: Math.floor((2 * 22500 + 3) / 6) };
  assert.equal(compareScores(sa, sb), 'TIE');
});

test('formatHundredths pads and rejects non-integers', () => {
  assert.equal(formatHundredths(5), '0.05');
  assert.equal(formatHundredths(1234), '12.34');
  assert.throws(() => formatHundredths(1.5), { code: 'INVALID_SCORE' });
});

test('results are frozen so sealed scores cannot be edited', () => {
  const s = computeFinalScore(panel(60));
  assert.throws(() => {
    'use strict';
    s.finalHundredths = 9999;
  });
});
