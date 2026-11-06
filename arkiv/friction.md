# Arkiv friction

What slowed us down while connecting FightClub to Arkiv (Rabdi testnet, `@arkiv-network/sdk` 1.0.1, Node 24).

## What to improve

1. **There's no documented link to one entity in the explorer.**
   - Expected: a page like `/entity/<key>` we could link from our UI.
   - What we found: the explorer only links queries, as `/entity-explorer?q=<query>`. So we link `$key = key(0x…)` as a query.
   - Fix: a stable, documented per-entity URL.
2. **No event when an entity expires.**
   - The docs say so clearly. Still, any app that caches Arkiv data has to work out expiry itself from `$expiresAt`, `getBlockTiming()` and the 2-second block time.
   - Fix: an `expiresAt` timestamp helper in the SDK, or an expiry event.
3. **`$createdAt` can't be sorted on.**
   - "Latest run for a project" is the most common query we have. To answer it we had to add our own `runAt` u64 column and sort on that.
   - Fix: a sortable creation time.
4. **`str` is capped at 128 bytes.**
   - Fine for IDs, but a judge's one-line headline often runs past it, so we cut it to fit by bytes.
   - A note in the docs on when to use `bytes` versus `str` for short text would help.
5. **The public RPC is rate-limited, and the SDK warns at import time.**
   - Calling `rabdi({ accessKey: "" })` prints a warning even in unit tests that never touch the network.
   - Fix: a way to silence it for tests.
6. **Node 22.10+ is required.** This is stated, but a clearer error on older Node would save time.

## When something broke

- **Nothing in the SDK broke for us.** The reads we ran against Rabdi (a schema query, `getBlockTiming()`) returned what the docs describe.
- **What the team still needs to record:** if the first real write hits a problem, add it here with what you expected, what happened, and the exact command (`npm run arkiv -- publish --project go-health-me`).
- **TODO (team):** add anything else you hit during the event, with steps to reproduce it.
