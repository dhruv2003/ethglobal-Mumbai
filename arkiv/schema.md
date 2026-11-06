# Arkiv schema

Network: Arkiv **Rabdi** testnet (chain ID 7794095). Code: [backend/src/arkiv/arkiv.mjs](../backend/src/arkiv/arkiv.mjs).

Every judged run of a project writes **one panel** and **one scorecard per judge** (three).

## `battle-arena.panel`

One per judged run.

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `projectId` | str | yes | Project ID, for example `go-health-me` |
| `runAt` | u64 | yes | When the judges ran (unix seconds). We sort on it to find the latest run. |
| `panelScore` | dec | yes | Panel average from 0.00 to 100.00, computed from integer hundredths |
| `complete` | bool | yes | True when all three judges scored |
| `judges` | i32 | no | Number of judges on the panel |
| `provider` | str | no | Inference provider, `0g` by default |
| `model` | str | no | Model ID |
| `swarmRef` | str, optional | no | **Swarm reference** (64 hex characters, unencrypted) of the run's evidence bundle. See [swarm.md](swarm.md). |

## `battle-arena.scorecard`

One per judge per run.

| Field | Type | Indexed | Holds |
| --- | --- | --- | --- |
| `panel` | key | yes | Key of this run's `battle-arena.panel` entity |
| `projectId` | str | yes | Project ID |
| `judgeId` | str | yes | Judge persona ID |
| `status` | str | yes | `scored`, `invalid`, `declined` or `error` |
| `overall` | dec, optional | yes | The judge's weighted score from 0.00 to 100.00; set only when `scored` |
| `judgeName` | str | no | Judge's public name |
| `headline` | str, optional | no | The judge's one-line verdict, cut to 128 bytes |

## Owner, edits, expiry

| | Panel | Scorecard |
| --- | --- | --- |
| Owner | The arena's publisher wallet (`ARKIV_PRIVATE_KEY`) | Same |
| Who can edit | Nobody. Created with `flags: { readonly: true }`. | Same |
| Expires | 120 days after the run (`ARKIV_TTL_DAYS`). The PRD (DAT-05) keeps scorecards at least 90 days after an event. | Same |

Readers only trust entities owned by the publisher wallet. Anyone can write entities with our schema tag, so every query filters with `ownedBy(publisher)`.

## Queries the app runs

Latest panel for a project:
```
arkiv.schema = str('battle-arena.panel') AND projectId = str('go-health-me') AND $owner = addr(<publisher>) ORDER BY runAt:u64 DESC
```

That run's scorecards:
```
arkiv.schema = str('battle-arena.scorecard') AND panel = key(<panel entity key>) AND $owner = addr(<publisher>)
```
