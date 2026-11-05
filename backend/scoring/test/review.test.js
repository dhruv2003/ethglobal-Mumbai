import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_STATUS,
  canOpenNextRound,
  canSubmitResult,
  expireUnresolvedReview,
  matchResolutionDeadline,
  reviewStatus,
} from '../src/index.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const start = 1_800_000_000_000;
const reviewStartedAt = start + 15 * MIN;

test('deadline is scheduled start plus 24 hours (TIE-08)', () => {
  assert.equal(matchResolutionDeadline(start), start + 24 * HOUR);
});

test('review moves from pending to overdue at 30 minutes (TIE-07)', () => {
  const s = (now) => reviewStatus({ reviewStartedAt, scheduledStartAt: start, now });
  assert.equal(s(reviewStartedAt + 29 * MIN), REVIEW_STATUS.PENDING);
  assert.equal(s(reviewStartedAt + 30 * MIN), REVIEW_STATUS.OVERDUE);
  assert.equal(s(start + 24 * HOUR - 1), REVIEW_STATUS.OVERDUE);
  assert.equal(s(start + 24 * HOUR), REVIEW_STATUS.EXPIRED);
});

test('results at or after the deadline are rejected', () => {
  const deadline = matchResolutionDeadline(start);
  assert.equal(canSubmitResult({ deadline, now: deadline - 1 }), true);
  assert.equal(canSubmitResult({ deadline, now: deadline }), false);
});

test('expiry voids the match and cancels the rest of the event (AC-16)', () => {
  const now = start + 24 * HOUR;
  const r = expireUnresolvedReview({ matchId: 'm-1', scheduledStartAt: start, now, callerId: 'keeper' });
  assert.equal(r.matchState, 'VOID');
  assert.equal(r.cancelRemainingRounds, true);
  assert.equal(r.voidUnresolvedPools, true);
  assert.equal(r.keepFinalizedPools, true);
  assert.equal(r.audit.actor, 'keeper');
  assert.equal(r.audit.at, now);
});

test('expiry is refused before the deadline', () => {
  assert.throws(
    () => expireUnresolvedReview({ matchId: 'm-1', scheduledStartAt: start, now: start + 23 * HOUR, callerId: 'keeper' }),
    { code: 'DEADLINE_NOT_REACHED' },
  );
});

test('next round waits for every current-round match (TIE-06)', () => {
  assert.equal(canOpenNextRound([{ state: 'FINALIZED' }, { state: 'HUMAN_REVIEW_REQUIRED' }]), false);
  assert.equal(canOpenNextRound([{ state: 'FINALIZED' }, { state: 'FINALIZED' }]), true);
});
