# End-to-end test: a real tournament, two real projects, real bets

Nothing in the app is sample data any more. A tournament, its projects, its fight and its
bets are all real: chain for money, backend for projects and fights, 0G for the judging.

## 0. One-time setup

**Contracts (Remix).** The deployed Base Sepolia `TournamentManager` only accepts 4, 8 or 16
projects. To run with exactly **two** projects, redeploy two contracts (`FilterCoin` stays):

1. Compile and deploy `backend/contracts/src/TournamentManager.sol` (it now accepts 2).
2. Deploy `BettingPools(manager, filterCoin)` with the new manager address.
3. In `frontend/web/.env`: `VITE_TOURNAMENT_MANAGER_ADDRESS=...` and `VITE_BETTING_POOLS_ADDRESS=...`.
4. Mirror in `backend/.env` (`TOURNAMENT_MANAGER_ADDRESS`, `BETTING_POOLS_ADDRESS`).

On the old deployment, use 4 projects instead of 2. Everything else is identical.

**Backend `backend/.env`:**

```
ZG_API_KEY=<your 0G key>
JUDGE_PROVIDER=0g
ADMIN_TOKEN=<any long secret>      # the web app proxies /api, so the organizer needs a key
# Arkiv (optional): ARKIV_PRIVATE_KEY=<funded test wallet>
```

**Run:** `cd backend && npm start`, then `cd frontend/web && npm run dev`.

**Wallets (MetaMask on Base Sepolia).** You need four, all different:

| Wallet | Role |
| --- | --- |
| Admin | deployed the contracts; grants roles |
| Organizer | creates and runs the tournament (also publisher + reviewer) |
| Team 1, Team 2 | submit the two projects (they become the project owners) |
| Bettor | places bets (organizer, reviewer and project wallets are blocked from betting) |

Fund each with a little Base Sepolia ETH.

## 1. Submit two real projects

For each team wallet: **Submit** page, fill the form, sign. Each project goes through the review
queue (repo fetch, tests, live test, dossier, judge panel). Wait until **/projects** shows both as
reviewed. The organizer page only lists projects whose review is done.

## 2. Create the tournament (organizer wallet)

1. **Organizer** page. Paste the `ADMIN_TOKEN` into **Backend key**.
2. **Roles**: with the admin wallet, grant the organizer wallet *organizer* and *publisher*.
3. **Create a tournament**: pick 2 (or 4), set "betting closes in" to 10 minutes or more.
4. **Freeze**: tick the projects that enter, press **Match automatically** (similarity matching, see
   below), name the tournament, freeze. This saves the bracket to the backend, then freezes the same
   list on chain, with the matching's result hash as the on-chain bracket hash. The pool opens.
   With 2 projects there is only one possible fight; with 4, 8 or 16 matching decides.

## 3. Bet (bettor wallet)

1. **Wallet** page: buy FILTER with test ETH.
2. **Tournaments** page, open the tournament: bet on who wins it all.
3. Organizer: **Open match** for match 1 (betting closes in a few minutes). Bettor bets on the match.

## 4. Fight and settle (organizer wallet)

After the match betting cutoff passes:

1. **Run the fight on 0G** (a few minutes; five rounds, three judges, real 0G calls). Scores are
   filled in when it finishes, tie-break included if the main scores tie.
2. **Publish result** (one transaction). The contract decides the winner.
3. Anyone can now watch the replay on `/fights/<tournament>/<match>` (it unlocks at the cutoff, so
   it can't spoil bets).
4. Bettor: **Wallet** page, settle and claim winnings (losers see their stake lost; one-sided pools refund).

## What is real and what isn't

- Projects, wallets, hashes, scores, winners, bets, payouts: chain or backend, all real.
- Fighter dialogue, rulings, scores: generated live by the 0G agents from each project's dossier.
- The fight replay is a recording of that run, not a live stream.
- Matchmaking (`backend/matching`): the reviewer's dossier of each project (problem, users, journey,
  architecture) is embedded once on 0G (`qwen3-embedding-8b`) and stored. Similarity = 60% embeddings,
  20% shared tracks, 20% shared tech (from the repo's dependencies). Round one is the exact best
  pairing, later rounds keep similar projects in opposite halves, same-team projects never meet in
  round one. The bracket is hashed (inputs and result); the result hash is the on-chain bracket hash,
  and the tournament page shows why each first-round fight exists. Ticking projects by hand instead
  is allowed and recorded as a manual order.
- Not covered: disclosed forks (no field for it yet) and organizer-blocked pairs (supported by the API,
  no UI).

## Demo fallback

Every live loader (tournaments, one tournament, fights, projects list) tries live data first. Only if
the chain or backend is unreachable does it show labelled demo data (a "Demo" pill and a notice), with
betting off. A real answer such as "not found" or "forbidden" is never replaced. Wallet balances,
bets, claims and all organizer transactions never fall back. During real testing, set
`VITE_DEMO_FALLBACK=0` in `frontend/web/.env` so an outage is visible instead of covered.
