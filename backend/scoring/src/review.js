// PRD TIE-06 to TIE-08: organizer review timing and the absolute resolution deadline.
// All times are integer epoch milliseconds. Callers pass `now`; nothing here reads the clock.

import { ScoringError } from './rubric.js';

export const REVIEW_OVERDUE_AFTER_MS = 30 * 60 * 1000; // TIE-07: 30 minutes
export const RESOLUTION_WINDOW_MS = 24 * 60 * 60 * 1000; // TIE-07/TIE-08: 24 hours after scheduled start

export const REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  OVERDUE: 'OVERDUE', // alert the organizer in-app
  EXPIRED: 'EXPIRED', // anyone authorized may void the match
});

/** TIE-08: a match pool's fixed resolution deadline is its scheduled start plus 24 hours. */
export function matchResolutionDeadline(scheduledStartAt) {
  assertTime(scheduledStartAt, 'scheduledStartAt');
  return scheduledStartAt + RESOLUTION_WINDOW_MS;
}

/**
 * Status of a match waiting for organizer review.
 * Pausing never extends the deadline (TIE-08), so there is no pause input.
 */
export function reviewStatus({ reviewStartedAt, scheduledStartAt, now }) {
  assertTime(reviewStartedAt, 'reviewStartedAt');
  assertTime(now, 'now');
  const deadline = matchResolutionDeadline(scheduledStartAt);
  if (now >= deadline) return REVIEW_STATUS.EXPIRED;
  if (now >= reviewStartedAt + REVIEW_OVERDUE_AFTER_MS) return REVIEW_STATUS.OVERDUE;
  return REVIEW_STATUS.PENDING;
}

/**
 * TIE-08: the contract rejects any result submitted at or after the deadline.
 * Use this off-chain too so the settlement service never publishes a late result.
 */
export function canSubmitResult({ deadline, now }) {
  assertTime(deadline, 'deadline');
  assertTime(now, 'now');
  return now < deadline;
}

/**
 * TIE-07: what happens when review is not resolved by the deadline.
 * The transition must be callable by a keeper or any authorized caller, not only the organizer.
 * Returns the actions for the orchestrator and settlement service to carry out.
 */
export function expireUnresolvedReview({ matchId, scheduledStartAt, now, callerId }) {
  if (!matchId || !callerId) {
    throw new ScoringError('INVALID_EXPIRY', 'matchId and callerId are required');
  }
  const deadline = matchResolutionDeadline(scheduledStartAt);
  assertTime(now, 'now');
  if (now < deadline) {
    throw new ScoringError('DEADLINE_NOT_REACHED', 'The resolution deadline has not passed yet');
  }
  return Object.freeze({
    matchId,
    matchState: 'VOID',
    cancelRemainingRounds: true, // REC-07: no arbitrary project advances
    voidUnresolvedPools: true, // unresolved pools become refundable
    keepFinalizedPools: true, // previously settled match pools stay settled
    audit: Object.freeze({
      actor: callerId,
      action: 'REVIEW_DEADLINE_EXPIRED',
      object: matchId,
      priorState: 'HUMAN_REVIEW_REQUIRED',
      newState: 'VOID',
      reason: 'Organizer review unresolved at the 24-hour resolution deadline',
      at: now,
    }),
  });
}

/**
 * TIE-06: while any match in a round is in review, the next round cannot open
 * and the reviewing match's pool stays locked with no claims.
 */
export function canOpenNextRound(currentRoundMatches) {
  return currentRoundMatches.every((m) => m.state === 'FINALIZED');
}

function assertTime(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ScoringError('INVALID_TIME', `${name} must be an integer epoch timestamp in milliseconds`);
  }
}
