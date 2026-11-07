# Data quality

All numbers come from live Arkiv data on 7 November 2026. Our publisher wallet is `0x429C0C8C8cDBf6b24D02075D808088983988B515`.

## Is the data up to date, and how does your import keep it that way?

**Yes for live activity, because records are written as things happen.** There's no nightly import that could fall behind.

| When | What gets written |
|---|---|
| A project is submitted | Project record |
| A review finishes | Pipeline, evidence report, transcript and live-test records |
| The judges finish | Panel, one scorecard per judge, and the full review |
| A judge is added or edited | Judge record |
| A bracket is registered | Tournament record |
| A fight is recorded | Fight record |

**How it stays correct:**

| Risk | What we do |
|---|---|
| Old and new versions both exist | Every version has `writtenAt`, and the newest one wins |
| The same data is written twice | Each record has a sha256 `hash`, and public records with no changes are skipped |
| A record changes while its write is waiting | Only the newest value is written |
| A write fails for a temporary reason | Up to 4 tries with increasing waits |
| Another process wrote something new | The server checks for newer versions every 30 seconds |
| Records are missing | `npm run arkiv -- sync --all` writes them again |
| A big record doesn't fit in one entity | It's split into parts of at most 120 KB |

**Not automatic:** the original source can change after we've reviewed it. If a team pushes new code, we don't notice until the project is reviewed again. Each evidence report records the commit it checked, so you can tell what the result covers.

## Can people filter it the way they actually search for it?

**Mostly, except by track.** We ran these filters on live data, and each one took about 0.25 to 0.35 seconds:

| What people ask | Filter | Live result |
|---|---|---|
| What's this project's latest score? | `projectId`, newest `runAt` first | `go-health-me`: 55.90 |
| Which results scored 50 or more? | `panelScore >= 50.00` | 10 of 19 panels |
| What did this judge score? | `judgeId` on scorecards | Works |
| Which entries are real submissions? | `kind = submitted` | 15 records |
| Whose claims didn't match their code? | `contradicted > 0` | 8 evidence reports |
| Whose app had problems on a phone? | `phone = issues` | 11 live-test records |

Counts are records, not unique projects, because a project reviewed twice appears twice.

These columns are also searchable, but we didn't run them in this check: `teamName`, `ownerWallet`, `status`, `overall`, `tournamentId`, `projectA`, `projectB` and `winner`.

**Always filter by our wallet.** Anyone can write a record with our label, so a query must include `$owner` or `.ownedBy()` to return only our data.

```js
import { gte } from "@arkiv-network/sdk/query";
import { dec } from "@arkiv-network/sdk/schema";

const { entities } = await client
  .select({ projectName: true, panelScore: true })
  .from(Panels)
  .ownedBy("0x429C0C8C8cDBf6b24D02075D808088983988B515")
  .where(gte("panelScore", dec("50.00")))
  .limit(100)
  .fetch();
```

`Panels` is defined in [backend/src/arkiv/arkiv.mjs](../backend/src/arkiv/arkiv.mjs). The node returns at most 100 rows per query, so use `.offset()` for more.

## Known problems

Published records are read-only, so we can't clean these up. We're listing them so nobody is misled.

| Problem | What you'll see | Effect | What to do |
|---|---|---|---|
| **Can't filter by track** | Only the number of tracks is stored, and it isn't searchable | People can't ask for "every project in this track" | Needs a schema change ([friction.md](friction.md)) |
| **Half-written results** | Tripwire has 1 of 3 scorecards; Mozark App Studio has 2 of 3 | Those panels still say `complete = true` | Count the scorecards; our app shows the newest panel with all of them |
| **Test entries mixed in** | Entries such as `bruh` and a review of this product under its earlier name | Totals include our testing | Don't read totals as real projects |
| **Inconsistent names** | `go health me` and `Go Health Me`; a URL used as a name; some blank names | Searching by name misses records | Search by `projectId`, not `projectName` |
| **Records expire** | Each record lasts 120 days, so the first ones go in about early March 2027 | Nothing renews them yet, so unchanged records, including the app's database, would disappear | We need to use `extendEntity` before then |
| **Few fights so far** | 2 fight records | Too little history to compare fighters | Grows with each tournament |
| **Swarm evidence links unused** | 0 of 19 panels have a `swarmRef` | Swarm is off on the live server | Use the app's stored evidence instead |
