# FightClub: demo build

The real web app (`frontend/web`) with every backend, chain and wallet call answered locally,
for pitching to judges. Same routes, same nav, same buttons. No backend, no MetaMask, no network
needed (only the two demo videos stream from Loom and ETHGlobal).

```bash
cd demo
npm i && npm run dev      # http://localhost:5190
```

## The story

> Two fitness + crypto projects sound the same on stage. Which one actually works?

| | Go Health Me | FitterCoin |
| --- | --- | --- |
| Live app | 16 of 16 flows pass on Windows, Android **and** iPhone | Loads everywhere; the stake escrows 0 ETH and a winning bet pays 0 (MetaMask test wallet) |
| Claims vs code | 11 of 16 supported | 4 of 6 contradicted (file:line refs) |
| Judges' panel | 76.6 | 35.9 |
| The fight | wins 80.13 to 35.07 | the crowd's favourite: ~84% of the pool |

In the fight, every hit cites that evidence. Three judge calls land on FitterCoin:
**Priya Raman** (product lead): "Your UI breaks on mobile." **Marcus Lee** (smart-contract engineer):
"That feature has no code behind it." **Ana Okafor** (investor): "Your project doesn't work in
production." Spectators who backed the flashier demo lose.

The other three fights each have a twist: Mozark App Studio (the agentic tester that ran every
live test here, 1,232 tests of its own) vs QAgent (an AI testing pitch with zero tests); Vaultline
(the best contracts in the room, a demo that breaks at deposit) vs SplitSafe (works end to end on a
phone, thin contracts); Kirana Credit (14 real shops in Dadar) vs MetroMint (slick on a laptop,
breaks on a phone, mints on a mock).

## 3-minute click path

1. **`/` (20 s).** "Same pitch. Only one works." Point at the tale of the tape: 32/32 live flows vs no app, 11/16 vs 2/6 claims.
2. **Click Go Health Me (40 s).** Overview: panel 76.6, claim bar, judges. **Testing** tab: the real laptop and phone recordings, a marker per step, 32/32. Press **↻ Replay the review** and open **Pipeline**: code → demo → live app → fact-check → judges tick through in about 40 s.
3. **Back, open FitterCoin → Evidence (30 s).** Its demo video is great. The claims aren't: 4 contradicted, each with its file:line (`contract/solidity/bet.sol:42-59`: betting `settle()` is an empty view). **Judges** tab: scores, and the proof drawer with 0G request ids, the Arkiv record and the evidence root hashes.
4. **Arena (10 s).** Two fights live, two finished. Open **Go Health Me vs FitterCoin**.
5. **Bet (20 s).** Odds move as the crowd's bets land (see the ticker). **Place a bet** → **Connect wallet** (simulated, 250 FILTER) → back **FitterCoin**, like the crowd.
6. **Watch (45 s).** Betting closes, the fight plays full screen: HP bars, every hit with the judges' reason. Go Health Me wins. "Not this time: 84% of the pool backed FitterCoin."
7. **Close the fight (15 s).** Scroll: every hit and its proof (file:line), the verdict per round, and the result's Arkiv record, transcript and both projects' evidence roots on 0G.

Bet on Go Health Me instead to see the win (confetti, auto-payout). A full page reload resets the
session (wallet, bets, live fights); navigating inside the app keeps it.

## How the demo is wired

Components are untouched in how they load data; the swap happens underneath them:

| Real app | Demo |
| --- | --- |
| `lib/api.js` → backend `/api` | `lib/demo/server.js`: every route answered from `src/data/*.json` |
| `lib/chain.js` → Base Sepolia RPC, MetaMask txs | `lib/demo/sim.js`: tournament, pools, FILTER token and txs in memory |
| `lib/wallet.js` → MetaMask | a simulated wallet on the target network |
| live-test files, screenshots | `public/media/` (Go Health Me's and Mozark's real recordings) |

Live behaviour: a replayed review ticks through the real step timings; live fights stay sealed
until betting closes (placing a bet closes it 7 s later), then reveal, play, and settle the pool
from the same scores the fight shows.

## Changing the story

All data is generated, so names, scores, hashes and timestamps agree everywhere:

```bash
# edit scripts/story.mjs (projects, claims, fights, bets), then
npm run data              # rewrites src/data/*.json and the SVG screens in public/media
```

`scripts/seed/` holds the real Go Health Me fact-check and live-test run and the judges' profiles.
Hashes are deterministic (sha256 of the record's id), so a rebuild changes nothing unless the story does.

Not in the story path: Submit, Wallet buy/sell and Transactions work against the simulated chain;
the organizer and judges-admin pages stay behind the organizer gate as in the real app.
