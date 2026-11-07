# Arkiv feedback

What got in our way while building FightClub on Arkiv (Rabdi testnet, `@arkiv-network/sdk` 1.0.1). We use Arkiv as the app's whole database, not only for publishing results, so we hit its limits quickly. Everything below was checked against the SDK and our live data on 7 November 2026.

## What to improve today

### 1. A guide for using Arkiv as a database

This would have saved us the most time. We hand-built a write queue, version handling and retries. Only while writing this file did we notice that the SDK already has `executeBatch`, `predictEntityKeys` and `extendEntity`.

A short guide could cover: writing linked entities together, keeping versions of a record, paging, and keeping data alive past its expiry.

### 2. Search inside a list of values

A project can enter several tracks, and people want "every project in this track". `str` columns support equality, ranges and `startsWith`, but there's no `contains` and no list column.

Today the only options are one extra entity per track, or one column per track. Because of this, we store only the number of tracks, and that can't be searched ([data-quality.md](data-quality.md)).

**Would help:** a list column, or a `contains` filter.

### 3. Sort by creation time

"The latest result for this project" is our most common query, but sorting on `$createdAt` fails:

```js
client.select({ $key: true }).from(Panels).orderBy(desc("$createdAt")).limit(3).fetch();
// "$createdAt" is returned in query results but cannot be sorted on.
```

We added our own `runAt` column to work around it. The error message is clear, but this column could be built in.

### 4. An event when an entity expires

`watchEntityEvents` covers created, patched, expiry extended, ownership transferred and deleted, but has no expired event. Anything that keeps a copy of Arkiv data has to work out expiry itself from `$expiresAt`, `getBlockTiming()` and the 2-second block time.

### 5. A link to a single entity

The explorer links only to queries (`/entity-explorer?q=...`), so we link to `$key = key(0x…)` as a query. We'd like a stable `/entity/<key>` page to link from our app.

### 6. Faster or cheaper large writes

- One wallet sends one transaction at a time, which takes about 7 seconds per write for us.
- A 4-minute demo video takes about 70 entities, 10 minutes and 1 testnet ETH, so we leave video off by default.

### 7. Smaller things

- **`str` limit of 128 bytes:** a judge's one-line headline often runs past it, so we cut it to fit. The docs could say when to use `bytes` for short text.
- **Warning in tests:** creating a client with no access key prints a rate-limit warning, even in tests that never touch the network. A way to silence it would help.

## When something broke

### A half-written result stays forever

| | |
|---|---|
| **Expected** | A panel and its three scorecards either all appear or none do. |
| **What happened** | The write failed partway. The panel stayed, read-only, and can't be removed. **Tripwire has 1 of 3 scorecards and Mozark App Studio has 2 of 3, and both are still live.** Both panels still say `complete = true`, because that column means the judges finished, not that every write landed. |
| **Whose fault** | Mostly ours: we write the panel, then each scorecard, as separate transactions. Scorecards link to the panel's key, so writing the panel first felt natural. `executeBatch` with `predictEntityKeys` may solve this, but we haven't tried it. |
| **Our workaround** | Our reader checks the 5 newest panels and shows the newest one with all its scorecards. |
| **Would help** | A docs example of writing linked entities together. |

**To see it:**
```
arkiv.schema = str('battle-arena.panel') AND $owner = addr(0x429C0C8C8cDBf6b24D02075D808088983988B515) AND projectName = str('Tripwire')
```
Take the `$key` from the result, then run:
```
arkiv.schema = str('battle-arena.scorecard') AND $owner = addr(0x429C0C8C8cDBf6b24D02075D808088983988B515) AND panel = key(<that key>)
```

### Writes fail with an error that doesn't explain why

| | |
|---|---|
| **Expected** | An error that says what went wrong, such as a nonce clash or a rate limit. |
| **What happened** | Some writes failed with `Execution error without revert data`, then worked when retried. Our other temporary failures were nonce clashes between processes sharing a wallet, and rate limits. |
| **Our workaround** | Up to 4 tries with increasing waits; schema and validation errors fail straight away. Fixed in commit `f5c6e25`. |
| **To reproduce** | We can't trigger this error on demand. Running two processes that write with the same wallet at once is the closest we have, and that causes the nonce clashes. |

## What worked well

- **Errors that teach:** asking for 200 rows returned `limit 200 exceeds the node maximum of 100. Page through the results with an offset instead.` Using the wrong type in a filter tells you how to fix it before the query runs.
- **Fast reads:** our filtered queries took about 0.25 to 0.35 seconds.
