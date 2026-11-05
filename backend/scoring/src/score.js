// PRD 9.2: fixed-point score calculation. Integers only (PRD DAT-04); no floats decide winners.

import {
  JUDGE_COUNT,
  MAIN_RUBRIC,
  MAX_CRITERION_SCORE,
  MIN_CRITERION_SCORE,
  ScoringError,
  assertValidRubric,
} from './rubric.js';

/**
 * Validates one judge's scorecard against a rubric.
 * A scorecard is { judgeId: string, scores: { [criterionKey]: integer 0..100 } }.
 * Extra or missing criteria are rejected rather than ignored or defaulted (PRD AC-10).
 */
export function assertValidScorecard(scorecard, rubric = MAIN_RUBRIC) {
  if (!scorecard || typeof scorecard.judgeId !== 'string' || scorecard.judgeId === '') {
    throw new ScoringError('INVALID_SCORECARD', 'Scorecard needs a judgeId');
  }
  const scores = scorecard.scores;
  if (!scores || typeof scores !== 'object') {
    throw new ScoringError('INVALID_SCORECARD', `Scorecard from ${scorecard.judgeId} has no scores`);
  }
  const expected = new Set(rubric.criteria.map((c) => c.key));
  for (const key of Object.keys(scores)) {
    if (!expected.has(key)) {
      throw new ScoringError('INVALID_SCORECARD', `Judge ${scorecard.judgeId} scored unknown criterion "${key}"`);
    }
  }
  for (const key of expected) {
    const value = scores[key];
    if (!Number.isInteger(value) || value < MIN_CRITERION_SCORE || value > MAX_CRITERION_SCORE) {
      throw new ScoringError(
        'INVALID_SCORECARD',
        `Judge ${scorecard.judgeId} must give "${key}" an integer from 0 to 100, got ${String(value)}`,
      );
    }
  }
}

/**
 * Computes a project's final score from exactly three judges' scorecards.
 *
 *   weighted_total = sum over judges and criteria of (weight_percent × criterion_score)
 *   final_score_in_hundredths = floor((2 × weighted_total + 3) / 6)
 *
 * This is the mean of the three judges' weighted scores, rounded half-up once to 0.01.
 * Returns integers plus a display string; compare `finalHundredths`, never `display`.
 */
export function computeFinalScore(scorecards, rubric = MAIN_RUBRIC) {
  assertValidRubric(rubric);
  if (!Array.isArray(scorecards) || scorecards.length !== JUDGE_COUNT) {
    throw new ScoringError(
      'INCOMPLETE_PANEL',
      `Exactly ${JUDGE_COUNT} valid scorecards are required, got ${scorecards?.length ?? 0}`,
    );
  }
  const judgeIds = new Set();
  let weightedTotal = 0;
  const perJudge = [];
  for (const card of scorecards) {
    assertValidScorecard(card, rubric);
    if (judgeIds.has(card.judgeId)) {
      throw new ScoringError('INCOMPLETE_PANEL', `Judge ${card.judgeId} submitted more than one scorecard`);
    }
    judgeIds.add(card.judgeId);
    let judgeTotal = 0;
    for (const c of rubric.criteria) judgeTotal += c.weight * card.scores[c.key];
    perJudge.push({ judgeId: card.judgeId, weightedTotal: judgeTotal });
    weightedTotal += judgeTotal;
  }

  const finalHundredths = Math.floor((2 * weightedTotal + 3) / 6);
  return Object.freeze({
    rubricId: rubric.id,
    weightedTotal,
    finalHundredths,
    display: formatHundredths(finalHundredths),
    perJudge: Object.freeze(perJudge.map((j) => Object.freeze(j))),
  });
}

/** Formats an integer number of hundredths as "NN.NN" without floating-point math. */
export function formatHundredths(hundredths) {
  if (!Number.isInteger(hundredths) || hundredths < 0) {
    throw new ScoringError('INVALID_SCORE', `Expected a non-negative integer, got ${String(hundredths)}`);
  }
  const whole = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

/**
 * Compares two computed scores. Returns 'A', 'B', or 'TIE'.
 * A tie means the displayed integers are equal; there is no hidden epsilon (PRD 9.2).
 */
export function compareScores(scoreA, scoreB) {
  if (scoreA.rubricId !== scoreB.rubricId) {
    throw new ScoringError('RUBRIC_MISMATCH', 'Cannot compare scores computed under different rubrics');
  }
  if (scoreA.finalHundredths > scoreB.finalHundredths) return 'A';
  if (scoreB.finalHundredths > scoreA.finalHundredths) return 'B';
  return 'TIE';
}
