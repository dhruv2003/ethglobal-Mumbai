# Scoring

The rules from `PRD.md` section 9 (Scoring and ties) as plain functions. Nothing here reads the clock, the database or the network, so the orchestrator, settlement service and frontend can all run the same code and get the same answer (AC-11).

## Run the tests

Needs Node 18 or later. No dependencies to install.

```sh
npm test
```

## What is in it

| File | PRD | What it does |
| --- | --- | --- |
| `src/rubric.js` | 9.1, TIE-01 | The main rubric (40/20/20/10/10) and the tie-break rubric (60/40). Rejects rubrics whose weights do not sum to 100, so bonus points cannot sit outside a weight. |
| `src/score.js` | 9.2 | Checks that each scorecard has integer scores from 0 to 100 and that there are exactly three judges. Computes `floor((2 × weighted_total + 3) / 6)` using integers only. |
| `src/ties.js` | 9.3, 9.4 | `decideMatch` walks the match through main scores, then one tie-break, then organizer review. It returns the next match state and never changes the original scores. |
| `src/review.js` | TIE-06 to TIE-08 | The 30-minute overdue alert, the 24-hour deadline, rejecting late results, the expiry actions, and holding the next round. |

## Using it

```js
import { decideMatch } from '@arena/scoring';

const r = decideMatch({
  a: { projectId: 'p-a', scorecards: [/* 3 judge scorecards */] },
  b: { projectId: 'p-b', scorecards: [/* 3 judge scorecards */] },
  // tiebreak: { a: [...], b: [...] },        // add once the tie-break round has run
  // organizerDecision: { organizerId, winnerProjectId, rationale, decidedAt, signature },
});

r.step;            // 'VALIDATING' | 'TIEBREAK_RUNNING' | 'HUMAN_REVIEW_REQUIRED'
r.winnerProjectId; // set when step is 'VALIDATING'
r.decisionSource;  // 'SCORES' | 'TIEBREAK' | 'ORGANIZER_DECISION'
```

A scorecard looks like this:

```js
{ judgeId: 'j1', scores: { product: 82, engineering: 70, innovation: 75, feasibility: 60, defense: 88 } }
```

Invalid input throws a `ScoringError` with a `code` such as `INCOMPLETE_PANEL` or `INVALID_SCORECARD`. The agent service should catch it, try one repair, and pause the match if the input is still invalid (AC-10). It must never fill in a score.

## Not covered here

- **Contract deadline (TIE-08).** The pool contract must also store the deadline and reject late results on chain. `canSubmitResult` mirrors that check off chain.
- **Signature verification.** `validateOrganizerDecision` only checks that a signature is present. The application service must verify it.
- **Review package screen (TIE-04).** This belongs in the organizer console.
- **Health and damage (8.2).** These depend on the final scores but are covered by section 8.
