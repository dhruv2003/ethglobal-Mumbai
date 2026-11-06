# Why Arkiv

## If we swapped Arkiv for Postgres, what would users lose?

AI judging is only worth watching if people can trust the scores. In Postgres, the scores live in a database **we** control. We could change a score after the fact and nobody could tell.

With Arkiv:
- **Nobody can change a published score, including us.** Scorecards are created read-only under the arena's wallet. A spectator, a team or a betting pool (PRD §10) can check the score shown on the page against the entity in the Arkiv explorer.
- **Anyone can read the results without our server.** Other apps, sponsors or a team's own site can query `battle-arena.panel` by project or score range, filtered by our publisher address. With Postgres they would need an API from us.
- **Records expire automatically.** Results stay for the event's review window (120 days) and then disappear, with no cleanup job.
- **Each result links to its evidence.** The panel's `swarmRef` points at the exact review, dossier, live-test report and recordings the judges used, stored on Swarm. A result and its evidence can't drift apart unnoticed.

## What we keep off Arkiv, and why

| Kept off Arkiv | Where | Why |
| --- | --- | --- |
| Full reviews (per-criterion comments, 0G traces), dossier, live-test report, videos, screenshots | **Swarm**, linked from `swarmRef` | Too large for entities (128 KiB of bytes per entity; videos are MBs). Swarm stores the files, Arkiv indexes them. |
| Judge personas, submissions in progress, review queue, pipeline status | Backend JSON store | Working state that changes constantly. Publishing it would add cost and noise without helping anyone verify anything. |
| Wallet signatures, API keys, organizer token | Server only | Secrets. Arkiv is public. |
| Repository clones | Server disk | Large, and untrusted code. |
| Encrypted Swarm references | Nowhere | An encrypted reference contains its key, and Arkiv is public. The bundle is uploaded unencrypted because it is public evidence. |
