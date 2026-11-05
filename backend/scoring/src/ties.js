// PRD 9.3 and 9.4: deciding a match through the initial scores, one tie-break, and organizer review.

import { MAIN_RUBRIC, ScoringError, TIEBREAK_RUBRIC } from './rubric.js';
import { compareScores, computeFinalScore } from './score.js';

export const DECISION_SOURCE = Object.freeze({
  SCORES: 'SCORES',
  TIEBREAK: 'TIEBREAK',
  ORGANIZER: 'ORGANIZER_DECISION',
});

export const ORGANIZER_DECISION_LABEL = 'Organizer decision after two ties';

/** Next step for the match orchestrator. Values match the match states in PRD 11.3. */
export const MATCH_STEP = Object.freeze({
  DECIDED: 'VALIDATING',
  RUN_TIEBREAK: 'TIEBREAK_RUNNING',
  HUMAN_REVIEW: 'HUMAN_REVIEW_REQUIRED',
});

/**
 * Decides a match from its sealed scorecards.
 *
 * @param {object} input
 * @param {{ projectId: string, scorecards: object[] }} input.a  fighter A and its 3 main scorecards
 * @param {{ projectId: string, scorecards: object[] }} input.b  fighter B and its 3 main scorecards
 * @param {{ a: object[], b: object[] }} [input.tiebreak]  tie-break scorecards, once that round has run
 * @param {object} [input.organizerDecision]  signed organizer decision, once given (see validateOrganizerDecision)
 *
 * Returns { step, winnerProjectId?, decisionSource?, label?, scores, tiebreakScores? }.
 * The main scores are never changed by a tie-break or organizer decision (PRD TIE-02, TIE-05).
 */
export function decideMatch({ a, b, tiebreak, organizerDecision }) {
  if (!a?.projectId || !b?.projectId || a.projectId === b.projectId) {
    throw new ScoringError('INVALID_MATCH', 'A match needs two distinct project IDs');
  }

  const scores = Object.freeze({
    a: computeFinalScore(a.scorecards, MAIN_RUBRIC),
    b: computeFinalScore(b.scorecards, MAIN_RUBRIC),
  });

  const main = compareScores(scores.a, scores.b);
  if (main !== 'TIE') {
    if (tiebreak || organizerDecision) {
      throw new ScoringError('UNEXPECTED_TIEBREAK', 'Main scores are not tied, so no tie-break or review may apply');
    }
    return result(MATCH_STEP.DECIDED, main === 'A' ? a.projectId : b.projectId, DECISION_SOURCE.SCORES, scores);
  }

  // TIE-01: exactly one tie-break round.
  if (!tiebreak) {
    if (organizerDecision) {
      throw new ScoringError('UNEXPECTED_REVIEW', 'Organizer review requires a completed tie-break round');
    }
    return Object.freeze({ step: MATCH_STEP.RUN_TIEBREAK, scores });
  }

  const tiebreakScores = Object.freeze({
    a: computeFinalScore(tiebreak.a, TIEBREAK_RUBRIC),
    b: computeFinalScore(tiebreak.b, TIEBREAK_RUBRIC),
  });
  const tb = compareScores(tiebreakScores.a, tiebreakScores.b);
  if (tb !== 'TIE') {
    if (organizerDecision) {
      throw new ScoringError('UNEXPECTED_REVIEW', 'Tie-break scores are not tied, so no organizer review may apply');
    }
    return result(
      MATCH_STEP.DECIDED,
      tb === 'A' ? a.projectId : b.projectId,
      DECISION_SOURCE.TIEBREAK,
      scores,
      tiebreakScores,
    );
  }

  // TIE-03: second tie goes to a human. No third AI round, no random choice.
  if (!organizerDecision) {
    return Object.freeze({ step: MATCH_STEP.HUMAN_REVIEW, scores, tiebreakScores });
  }

  validateOrganizerDecision(organizerDecision, [a.projectId, b.projectId]);
  return Object.freeze({
    ...result(
      MATCH_STEP.DECIDED,
      organizerDecision.winnerProjectId,
      DECISION_SOURCE.ORGANIZER,
      scores,
      tiebreakScores,
    ),
    label: ORGANIZER_DECISION_LABEL,
    organizerDecision: Object.freeze({ ...organizerDecision }),
  });
}

/**
 * PRD TIE-05: the organizer picks one of the two projects and gives a public reason
 * that references the published criteria and evidence. Identity, timestamp and a
 * signature are recorded. Signature verification itself belongs to the application
 * service; this only checks the decision is complete.
 */
export function validateOrganizerDecision(decision, projectIds) {
  const missing = ['organizerId', 'winnerProjectId', 'rationale', 'decidedAt', 'signature'].filter(
    (f) => decision?.[f] === undefined || decision?.[f] === null || decision?.[f] === '',
  );
  if (missing.length) {
    throw new ScoringError('INVALID_DECISION', `Organizer decision is missing: ${missing.join(', ')}`);
  }
  if (!projectIds.includes(decision.winnerProjectId)) {
    throw new ScoringError('INVALID_DECISION', 'Organizer must choose one of the two tied projects');
  }
  if (typeof decision.rationale !== 'string' || decision.rationale.trim().length < 20) {
    throw new ScoringError('INVALID_DECISION', 'Organizer rationale must explain the decision (at least 20 characters)');
  }
  if (!Number.isInteger(decision.decidedAt)) {
    throw new ScoringError('INVALID_DECISION', 'decidedAt must be an integer epoch timestamp in milliseconds');
  }
}

function result(step, winnerProjectId, decisionSource, scores, tiebreakScores) {
  return Object.freeze({
    step,
    winnerProjectId,
    decisionSource,
    scores,
    ...(tiebreakScores ? { tiebreakScores } : {}),
  });
}
