# Backend

Everything that runs off the user's browser. No code has been written yet.

These services from `PRD.md` section 13.2 belong here:

- Application service: sign-in and role checks
- Submission service: fetches repositories and processes artifacts
- Testing service: runs project tests in isolated sandboxes
- Evidence service: stores frozen snapshots and serves them to agents
- Tournament orchestrator: schedules rounds and advances the bracket
- Agent service: generates advocates, questions, rulings and scorecards
- Event service: saves and streams battle events
- Settlement service: publishes finalized results on chain
- Chain indexer: tracks bets, locks, outcomes, claims and refunds
- Monitoring service: tracks reliability and resource use

Smart contracts go in `contracts/` in this folder.

## Modules

| Folder | What it is |
| --- | --- |
| `scoring/` | Rubric, fixed-point scoring, tie-breaks and organizer review (`PRD.md` section 9). See its README. |
| `matching/` | Similarity-based round-one pairing and bracket placement (`PRD.md` ORG-05). See its README. |
