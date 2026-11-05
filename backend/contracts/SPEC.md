# Smart contract specification

Draft for review. Nothing here is implemented yet. It implements `PRD.md` v1.1, mainly sections 10, 11 and 13.3.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Network | Base Sepolia (chain ID 84532) | Available on the ETHGlobal faucet and already claimed by the team |
| Tooling | Remix IDE, OpenZeppelin Contracts v5 | Nothing to install. Compiles, tests and deploys in the browser through MetaMask |
| Upgrades | None; contracts are immutable | No admin path can redirect user funds (SEC-07). New version means new deployment |
| Testing | Remix unit tests on the Remix VM first, then a rehearsal on Base Sepolia | Catches contract bugs before spending test ETH, then proves the full flow on the real network |

## The three contracts

| Contract | Job | Holds funds? |
| --- | --- | --- |
| `FilterCoin` | Our ERC-20 betting token, bought with and sold back for Base Sepolia test ETH | Test ETH, held as escrow for all FILTER |
| `TournamentManager` | Rules, roles, bracket, results, deadlines, cancellation | No |
| `BettingPools` | Stakes, settlement, claims, refunds | Yes, FilterCoin stakes |

`BettingPools` reads from `TournamentManager`. `TournamentManager` knows nothing about `BettingPools`, and neither contract can be changed after deployment.

### What stays off chain

Repositories, artifacts, test logs, prompts, transcripts, full scorecards, drafts, submission review and animation stay off chain. The chain stores their hashes only (PRD 13.3).

No LLM ever calls a contract. Agents have no keys. The result service submits validated scores with its own key.

## Roles

| Role | Who | Can | Cannot |
| --- | --- | --- | --- |
| Operator | Platform deployer | Grant organizer and publisher roles, pause new bets | Move funds, change results |
| Organizer | Per tournament | Create, freeze, cancel | Bet, change frozen data, reverse a result |
| Reviewer | Per tournament, may be the organizer | Decide a match in human review | Decide any other match, bet |
| Publisher | Result service key, per tournament | Open matches, publish scores, void a match | Pick a winner directly, access funds |
| Anyone | Any wallet | Settle pools, expire overdue matches, pay out frozen recipients | Redirect any payment |

## `FilterCoin`

Standard 18-decimal ERC-20 named "FilterCoin", symbol `FILTER`. Testnet only: it trades for Base Sepolia test ETH and cannot be redeemed for anything of value (BET-04).

The price is fixed at 0.00001 test ETH for 1,000 FILTER, which is `RATE = 100,000,000` base units per wei.

| Function | Caller | Rule |
| --- | --- | --- |
| `buy()` | Anyone | Payable. Mints `msg.value × RATE` base units to the caller. Reverts on zero value |
| `sell(amount)` | Any holder | Burns `amount` and sends the caller `floor(amount / RATE)` wei. Reverts if that payout is zero |

- Tokens exist only through `buy()`. There is no owner mint and no pre-mine.
- The price cannot change after deployment.
- No admin can withdraw ETH. It only leaves through `sell()`, so `balance × RATE ≥ totalSupply` always holds.
- `sell()` burns before sending and has a reentrancy guard. A failed ETH transfer reverts, so the seller keeps their FILTER.
- FILTER staked in a pool cannot be sold until it is paid out by a claim or refund.
- Plain ETH transfers without `buy()` revert.
- Users pay their own gas for every transaction, using Base Sepolia ETH they get themselves.

## `TournamentManager`

### Bracket layout

Projects are stored in seeded order. With `N` projects there are `N − 1` matches, indexed in round order:

- A first-round match `i` has projects `2i` and `2i + 1`.
- A later match `i` takes the winners of matches `2(i − N/2)` and `2(i − N/2) + 1`.
- The last match, `N − 2`, is the final. Its winner is the champion.

The contract works out participants itself, so nobody can place an invented opponent in a match. A round can only open once every match in earlier rounds is finalized.

### Functions

| Function | Caller | What it does |
| --- | --- | --- |
| `createTournament(config)` | Organizer | Stores `configHash`, capacity, schedule, wallets and bet limits. Validates ORG-02, including the resolution deadline being at least `(rounds + 1) × 24h` after start |
| `freeze(id, projects, seed, bracketHash)` | Organizer | Stores seeded projects (owner wallet, reward wallet, snapshot hash). Count must be 4, 8 or 16 and within capacity. Fixes recipients, blocks participant wallets from betting, and opens the tournament pool |
| `openMatch(id, match, cutoff, start)` | Publisher | Opens a match pool. Requires `now < cutoff ≤ start`, `start` at or after the tournament cutoff and before its deadline. Deadline is `min(start + 24h, tournament deadline)` |
| `publishResult(id, match, scoreA, scoreB, tieA, tieB, resultHash)` | Publisher | Requires `now ≥ cutoff`, `now < deadline`, scores ≤ 10000. Contract applies the tie rule below |
| `resolveHumanReview(id, match, winner, rationaleHash)` | Reviewer | Only in human review, only before the deadline, and the winner must be one of the two participants |
| `voidMatch(id, match, reasonHash)` | Publisher | Voids an unrecoverable match and cancels the tournament (REC-07) |
| `cancelTournament(id, reasonHash)` | Organizer | Cancels unfinished competition. Finalized matches are unaffected |
| `expireMatch(id, match)` | Anyone | After a match deadline: voids the unresolved match and cancels the tournament (TIE-07) |
| `expireTournament(id)` | Anyone | After the tournament deadline: cancels an unfinished tournament (TIE-08) |

### The contract applies the tie rule

The publisher submits scores, and the contract derives the outcome. Scores are integer hundredths, as in PRD 9.2.

| Scores | Outcome |
| --- | --- |
| `scoreA ≠ scoreB`, tie fields both zero | Higher score wins (`SCORE`) |
| `scoreA = scoreB`, `tieA ≠ tieB` | Higher tie-break score wins (`TIEBREAK`) |
| `scoreA = scoreB`, `tieA = tieB` | Match enters human review |
| Reviewer decides | Selected project wins (`ORGANIZER`) |

A result can be set only once, so a repeated job reverts rather than changing anything.

### States stored on chain

- Tournament: `Configured → Frozen → Completed`, or `Canceled`
- Match: `None → Open → (HumanReview) → Finalized`, or `Void`

Other PRD states, such as `RUNNING`, `VALIDATING` and `PAUSED`, belong to the backend. Pausing never extends a deadline.

## `BettingPools`

Each tournament pool and match pool is a market with its own ID. Markets need no creation transaction, because they exist as soon as `TournamentManager` reports them open. Lock also needs no transaction: betting simply stops at chain time `cutoff`.

| Function | Caller | What it does |
| --- | --- | --- |
| `bet(market, project, amount)` | Bettor | Requires market open, `now < cutoff`, not paused, wallet not blocked, valid selection, stake ≥ min, wallet total in this pool ≤ max across all selections |
| `settle(market)` | Anyone | Fixes the pool outcome once, using the order below |
| `claim(market)` | Winning bettor | Pays `floor(bettorBucket × stake / winningStake)` once |
| `refund(market)` | Bettor in a void pool | Returns all accepted stake once |
| `claimProject(market)` | Anyone | Pays 20% to the frozen winning reward wallet once |
| `claimPlatform(market)` | Anyone | Pays the platform bucket to the frozen recipient once |
| `sweepDust(market)` | Anyone | After all winning stake has claimed, sends only the remaining rounding dust to the platform |
| `pause()` / `unpause()` | Operator | Blocks new bets only. Claims and refunds keep working |
| `poolState(market)` | Anyone | Returns the PRD state: `OPEN`, `LOCKED`, `RESOLVED` or `VOID` |

### Settlement order

```text
1. Match or tournament has a winner:
     no stakes                    -> EMPTY
     stake on only one selection  -> VOID
     no stake on the winner       -> VOID
     otherwise                    -> RESOLVED
2. Canceled, void, or deadline passed:
     no stakes -> EMPTY, otherwise -> VOID
3. now >= cutoff:
     no stakes                    -> EMPTY
     stake on only one selection  -> VOID
4. Anything else -> revert NotReady
```

`EMPTY` moves no tokens, and `poolState` reports it as `RESOLVED`. Human review falls through to step 4 until the reviewer decides or the deadline passes.

### Money math

Integer base units only, exactly as PRD 10.3:

```text
bettorBucket   = floor(P × 70 / 100)
projectBucket  = floor(P × 20 / 100)
platformBucket = P − bettorBucket − projectBucket
```

### Safety rules

- Update state before transferring, with a reentrancy guard on every payout.
- A failed transfer reverts the whole call, so the entitlement stays claimable (AC-22).
- No function lets an admin withdraw, and no timer makes unclaimed funds sweepable.

## Events for the indexer

`TournamentCreated`, `TournamentFrozen`, `TournamentCanceled`, `TournamentCompleted`, `MatchOpened`, `MatchFinalized`, `HumanReviewRequired`, `MatchVoided`, `BetPlaced`, `PoolSettled`, `Claimed`, `Refunded`, `ProjectPaid`, `PlatformPaid`, `DustSwept`.

## Required tests

| Area | Coverage |
| --- | --- |
| FilterCoin | Buy and sell price math, zero-value reverts, plain ETH transfer revert, reentrant sell, ETH backing after every buy and sell |
| Scoring and ties | All outcomes in the tie table, human review limits, no second result |
| Bracket | 4, 8 and 16 projects; a later round cannot open early; participants always derived |
| Betting | Cutoff (AC-17), limits, blocked wallets, paused state |
| Payouts | 700/200/100 split (AC-18), 175 claim (AC-19), BET-11 case below stake |
| Void paths | No stake on winner (AC-20), one-sided (AC-25), cancellation (AC-23), expiry (AC-16, AC-26) |
| Exactly once | Duplicate claim, refund and settle (AC-21); failed transfer (AC-22); dust (AC-24) |
| Accounting scenarios | Hand-picked pools with awkward amounts: token balance always covers every unpaid claim, refund and bucket (SEC-07), and total paid never exceeds total staked |

Remix has no built-in fuzz or invariant testing, so these scenarios replace it. They are weaker than the PRD's invariant-test release gate and could miss an unusual case. This is accepted for a testnet demo with no real funds.

## Known trust limits

These are PRD-accepted limits, and the app must not claim otherwise (SEC-12):

- The publisher can submit wrong scores. The chain proves what was published, not that the judging was correct.
- The organizer generates the seed and can cancel an event, which refunds unresolved pools.
- Wallet blocking is address-based, so alternate wallets are not stopped.

## Arkiv's role

Use Arkiv as the public archive for finished records, not as the main database.

| Store on Arkiv | Keep in a normal backend database |
| --- | --- |
| Sanitized dossiers and test summaries | Drafts and autosave |
| Final transcripts and scorecards | Login challenges and role data |
| Organizer rationales | Job queues and live battle events |
| | Anything not yet sanitized |

Each record goes up after a match finalizes. Its hash is the `resultHash` or `rationaleHash` stored on Base Sepolia, so anyone can check that the archive matches the chain.

Constraints from the Arkiv docs (Rabdi testnet, chain ID 7794095):

- Every write needs a signing wallet funded with tGLM.
- An entity's `bytes` data is limited to 128 KiB, so full test logs do not fit. Store a summary and hash.
- Maximum lifetime is about 182.5 days, which covers the PRD's 90-day retention requirement.
- Anyone can write under a schema name, so reads must filter with `ownedBy(publisher)`.
- All data is public, so nothing unsanitized can be written.
- The docs I checked make no promise about testnet data surviving resets, so the backend keeps its own copy.

## Open questions

1. **Arkiv for the database.** The split above needs agreement from whoever owns the backend.
2. **PRD difference.** The PRD still describes a faucet-funded token. This spec takes priority for the token, and the PRD stays unchanged for now.

## Deployment settings

- The owner's wallet is the platform recipient for demo tournaments, so the owner can sell back that FILTER after the event.
- Deploy in this order: `FilterCoin`, `TournamentManager`, `BettingPools`.
