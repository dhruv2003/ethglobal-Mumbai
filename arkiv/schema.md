# Arkiv schema

Network: Arkiv **Rabdi** testnet (chain ID 7794095).

Everything the arena records goes to Arkiv. Files (recordings, screenshots, the demo video) go to Swarm instead ([swarm.md](swarm.md)).

Code:
- [backend/src/arkiv/arkiv.mjs](../backend/src/arkiv/arkiv.mjs): panel and scorecards
- [backend/src/arkiv/records/](../backend/src/arkiv/records/): every other record

| Schema | One per | Written when |
| --- | --- | --- |
| `battle-arena.project` | project | submitted (and `sync`) |
| `battle-arena.pipeline` | project | the review pipeline finishes |
| `battle-arena.dossier` | project | the pipeline finishes (the reviewer's evidence report / bug report) |
| `battle-arena.transcript` | project | the pipeline finishes (demo video transcript) |
| `battle-arena.livetest` | project | the pipeline finishes (live-test report; media on Swarm) |
| `battle-arena.vision` | project | after judging, if screenshot notes exist (judge context) |
| `battle-arena.panel` | judging run | the judges finish |
| `battle-arena.scorecard` | judge per run | the judges finish |
| `battle-arena.judge` | judge persona | a judge is added or edited |
| `battle-arena.tournament` | tournament | the bracket is registered |
| `battle-arena.fight` | 1v1 match | the fight is recorded |

## Columns every record shares (all except panel and scorecard)

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `projectId` | str, optional | yes | Project ID, for example `go-health-me` (all project records) |
| `projectName` | str, optional | yes | Project name, for example `Go Health Me` |
| `writtenAt` | u64 | yes | When it was written (unix seconds). The newest one is current. |
| `hash` | str | yes | sha256 of the payload. An unchanged record is never written twice. |
| `part` / `parts` | i32 | `part` yes | A payload over 120 KB compressed is split across entities |
| `enc` | str | no | `gzip-json` |
| `payload` | bytes | no | The full record as gzip-compressed JSON |

## Columns of each type (indexed unless noted)

| Schema | Columns |
| --- | --- |
| `project` | `teamName`, `kind` (sample / submitted), `ownerWallet` (addr), `tracks` (count, not indexed) |
| `pipeline` | `status` (done / failed); `steps` and `failedSteps` (not indexed) |
| `dossier` | `commit`, `claims`, `contradicted`; `supported` and `unverified` (not indexed) |
| `transcript` | `source` (loom / openai / fixture) |
| `livetest` | `laptop` and `phone` (passed / issues / failed / error), `failedSteps`; `target` (not indexed) |
| `vision` | `model`; `shots` (not indexed) |
| `judge` | `judgeId`, `judgeName`, `version`, `promptVersion`; `tone` (not indexed) |
| `tournament` | `tournamentId`, `track`, `bracketHash`; `title` and `size` (not indexed) |
| `fight` | `tournamentId`, `match`, `projectA`, `projectB`, `projectAName`, `projectBName`, `winner` (a / b / review / failed), `scoreA`, `scoreB`, `resultHash` |

## `battle-arena.panel` (one per judged run)

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `projectId` / `projectName` | str | yes | The project (`projectName` is optional) |
| `runAt` | u64 | yes | When the judges ran. Sorted on to find the latest run. |
| `panelScore` | dec | yes | Panel average, 0 to 100 |
| `complete` | bool | yes | All three judges scored |
| `judges`, `provider`, `model` | i32, str, str | no | Panel size and the model used |
| `swarmRef` | str, optional | no | **Swarm reference** of the run's evidence bundle |

## `battle-arena.scorecard` (one per judge per run)

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `panel` | key | yes | This run's panel entity |
| `projectId` / `projectName` | str | yes | The project |
| `judgeId`, `status` | str | yes | Who scored, and `scored` / `invalid` / `declined` / `error` |
| `overall` | dec, optional | yes | The judge's weighted score (only when scored) |
| `judgeName`, `headline` | str | no | Name and one-line verdict (cut to 128 bytes) |

## Owner, edits, expiry (all schemas)

- **Owner:** the arena's publisher wallet (`ARKIV_PRIVATE_KEY`).
- **Edits:** none. Every entity is created `readonly`. A change is written as a new record with a newer `writtenAt`, and older ones stay readable.
- **Expires:** 120 days after it's written (`ARKIV_TTL_DAYS`). The PRD (DAT-05) keeps records at least 90 days.
- **Trust:** readers only accept entities owned by the publisher wallet, so every query has `$owner = addr(<publisher>)`.

## Queries you can run

Paste these at https://rabdi.explorer.arkiv.network/entity-explorer.

Everything about one project:
```
projectId = str('go-health-me') AND $owner = addr(<publisher>)
```

The latest dossier of a project:
```
arkiv.schema = str('battle-arena.dossier') AND projectId = str('go-health-me') AND part = i32(0) AND $owner = addr(<publisher>) ORDER BY writtenAt:u64 DESC
```

Every fight a project was in:
```
arkiv.schema = str('battle-arena.fight') AND (projectA = str('<id>') OR projectB = str('<id>')) AND $owner = addr(<publisher>)
```

Projects whose live test had issues on phone:
```
arkiv.schema = str('battle-arena.livetest') AND phone = str('issues') AND $owner = addr(<publisher>)
```
