# How we use Arkiv

FightClub has three AI judges score every hackathon project. When a run finishes, the backend writes the result to Arkiv:
- one panel entity for the run
- one scorecard entity per judge

The project page then reads those back from Arkiv and shows them. Entity details are in [schema.md](schema.md).

## Does what we filter on fit the app?

| Filter / sort | Why the app needs it |
| --- | --- |
| `projectId = …` | A project page shows that project's published result. |
| `ORDER BY runAt DESC`, limit 1 | A project can be re-judged, and the page shows the latest run. (`$createdAt` can't be sorted on, so we store `runAt`.) |
| `panel = key(…)` | Loads exactly the three scorecards of that run, not those from older runs. |
| `ownedBy(publisher)` | Only the arena's wallet counts. Anyone can write entities with our tag, and this filter keeps them out. |
| `panelScore`, `overall`, `status`, `judgeId`, `complete` (indexed) | Anyone can ask Arkiv for "every project scoring 70 or more" or "every scorecard from this judge" without our server. The app doesn't use these filters yet. |

## Does who can edit fit?

The publisher wallet owns every entity, and each one is created **read-only**. A published score can never be changed, matching the PRD rule that a finalized result is never reversed (REC-09). A re-judge creates **new** entities, and the old ones stay readable until they expire.

## Does expiry fit?

Entities live **120 days**. Scorecards matter while an event and its follow-up run, and the PRD keeps them at least 90 days afterwards (DAT-05). We don't need them forever, and a shorter lifetime costs less.

## What users see from each feature

| Arkiv feature | What changes for the user |
| --- | --- |
| Query by `projectId`, sorted by `runAt` | The **"Published on Arkiv"** block in the project's judges' panel shows the panel score read from Arkiv ([ArkivRecord.jsx](../frontend/web/src/components/ArkivRecord.jsx), via `GET /api/projects/:id/arkiv`). |
| `key` link from scorecard to panel | Each judge's on-chain score is listed under that panel. |
| `readonly` flag | The block says "read-only". The score is final. |
| `$expiresAt` | The block shows "expires <date>". |
| Owner filter, entity keys | Each judge has a "check on Arkiv" link, plus a link to the panel in the Arkiv explorer, so anyone can verify the score without trusting our server. |
| `swarmRef` | "Evidence on Swarm" links: full review, dossier, live-test report and recordings ([swarm.md](swarm.md)). |

## Code

| File | Does |
| --- | --- |
| [backend/src/arkiv/arkiv.mjs](../backend/src/arkiv/arkiv.mjs) | Schemas, write (`publishPanel`), read (`readLatest`) |
| [backend/src/arkiv/publish.mjs](../backend/src/arkiv/publish.mjs) | After each saved review: Swarm upload, then the Arkiv write |
| [backend/src/api.mjs](../backend/src/api.mjs) | `GET` / `POST /api/projects/:id/arkiv` |
| [backend/src/arkiv/run.mjs](../backend/src/arkiv/run.mjs) | CLI: `npm run arkiv -- publish\|read --project <id>` |
| [backend/test/arkiv.test.mjs](../backend/test/arkiv.test.mjs) | Tests with a fake chain and a fake Bee node |
| [backend/src/arkiv/records/](../backend/src/arkiv/records/) | `schemas.mjs` (one schema per record type), `builders.mjs` (local data → record), `store.mjs` (write/read: dedup by hash, gzip, split big payloads), `sync.mjs` (what to push when) |
| [backend/test/arkiv-records.test.mjs](../backend/test/arkiv-records.test.mjs) | Every record checked against the SDK's own schema validation, round trips, dedup |

## Every arena record, not only scores

Besides the panel and scorecards, the backend writes the arena's other records to Arkiv as they happen. Each one carries `projectId` and `projectName`; a fight carries both projects.

| Record | Written when |
| --- | --- |
| Project details | Submitted |
| Review pipeline, dossier (bug report), demo transcript, live-test report | The review pipeline finishes |
| Screenshot notes | After judging |
| Full judging review: every judge's comment, per-criterion scores and reasoning | After judging |
| Files: demo screenshots, live-test recordings and step screenshots (raw bytes in 120 KB parts, checked by sha256). The demo video only with `ARKIV_DEMO_VIDEO=1`. | After the review pipeline and after judging |
| Judge personas | Added or edited |
| Tournament bracket | Registered |
| 1v1 fight result | Recorded |

Files are on Arkiv too (and on Swarm when it is set up). Each one is split into parts of at most 120 KB, one entity per part. The demo video is left off by default: a 4-minute demo is about 70 entities, ~10 minutes and ~1 testnet ETH, and it still plays from our copy and the team's link. Set `ARKIV_DEMO_VIDEO=1` to include it. Download one straight from the chain with `GET /api/arkiv-file?projectId=<id>&name=demo.mp4` (the parts are reassembled and the sha256 checked). Details are in [schema.md](schema.md).

Read them back from Arkiv:
- `GET /api/arkiv/<type>?projectId=<id>`: list
- `GET /api/arkiv/<type>/latest?projectId=<id>`: the newest one with its full payload
- `npm run arkiv -- get <type> --project <id>`

Backfill everything on a server: `npm run arkiv -- sync --all`.
