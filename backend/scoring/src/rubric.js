// PRD 9.1 and 9.3: the published rubrics. Weights are whole percentages that sum to 100.

/** Main five-criterion rubric (PRD 9.1). Product carries the highest weight; engineering is 20%. */
export const MAIN_RUBRIC = Object.freeze({
  id: 'main-v1',
  criteria: Object.freeze([
    Object.freeze({ key: 'product', label: 'Product usefulness and user journey', weight: 40 }),
    Object.freeze({ key: 'engineering', label: 'Engineering and implementation', weight: 20 }),
    Object.freeze({ key: 'innovation', label: 'Innovation and differentiation', weight: 20 }),
    Object.freeze({ key: 'feasibility', label: 'Feasibility and business model', weight: 10 }),
    Object.freeze({ key: 'defense', label: 'Evidence-backed defense', weight: 10 }),
  ]),
});

/** Tie-break rubric (PRD TIE-01): product reasoning 60%, evidence/defense accuracy 40%. */
export const TIEBREAK_RUBRIC = Object.freeze({
  id: 'tiebreak-v1',
  criteria: Object.freeze([
    Object.freeze({ key: 'productReasoning', label: 'Product reasoning', weight: 60 }),
    Object.freeze({ key: 'evidenceDefense', label: 'Evidence and defense accuracy', weight: 40 }),
  ]),
});

/** Exactly three judges must score; partial panels are never averaged (PRD REC-03). */
export const JUDGE_COUNT = 3;

export const MIN_CRITERION_SCORE = 0;
export const MAX_CRITERION_SCORE = 100;

/**
 * Checks that a rubric is well formed: unique keys, integer weights, total of 100.
 * Bonus ("brownie") points must be a subcriterion inside an existing weight, so a
 * rubric whose weights exceed 100 is rejected (PRD 9.1).
 */
export function assertValidRubric(rubric) {
  if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new ScoringError('INVALID_RUBRIC', 'Rubric must list at least one criterion');
  }
  const keys = new Set();
  let total = 0;
  for (const c of rubric.criteria) {
    if (typeof c.key !== 'string' || c.key === '' || keys.has(c.key)) {
      throw new ScoringError('INVALID_RUBRIC', `Rubric criterion key "${c.key}" is missing or duplicated`);
    }
    if (!Number.isInteger(c.weight) || c.weight <= 0) {
      throw new ScoringError('INVALID_RUBRIC', `Weight for "${c.key}" must be a positive integer`);
    }
    keys.add(c.key);
    total += c.weight;
  }
  if (total !== 100) {
    throw new ScoringError('INVALID_RUBRIC', `Rubric weights must sum to 100, got ${total}`);
  }
}

export class ScoringError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScoringError';
    this.code = code;
  }
}
