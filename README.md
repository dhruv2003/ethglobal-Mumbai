# 🥊 FightClub

**Hackathon projects become AI fighters, and three AI judges score them.**

Teams submit their project and get a fighter with its own ENS name. A reviewer agent reads the code and tests the live site, then three AI judges running on 0G score it. Every result is published to Arkiv, where anyone can check it. Fighters meet in on-chain tournament brackets, and people can bet on each match.

| | |
| --- | --- |
| 🌐 **Live demo** | https://fightclub-seven.vercel.app |
| 🎬 **Demo video** (under 3 min) | [Watch on Google Drive](https://drive.google.com/drive/folders/1GGanbgIbKdQawt7-NzCdqjqIbEcO9Zvm?usp=drive_link) |
| 📄 **Product spec** | [PRD.md](PRD.md) |
| ⚖️ **License** | [MIT](LICENSE) |

## Contents

- [How it works](#how-it-works)
- [Why people come back](#why-people-come-back)
- [Run it locally](#run-it-locally)
- [0G](#0g-build-with-0g-private-computer)
- [Arkiv](#arkiv-build-on-arkiv)
- [ENS](#ens-ensv2-on-sepolia)
- [Contracts](#contracts-base-sepolia-chain-id-84532)
- [Team](#team)
- [How we used AI](#how-we-used-ai)

## How it works

```
 Team submits project ──► gets <project>.fightclub.eth (ENS, Sepolia)
          │
          ▼
 Reviewer agent reads the repo, tests the live site ──► files on 0G Storage
          │
          ▼
 3 AI judges score it on 0G Compute (request IDs shown in the app)
          │
          ▼
 Panel + scorecards published to Arkiv ──► score written to the ENS name
          │
          ▼
 Tournament brackets and betting pools (Base Sepolia contracts)
```

| Layer | What it does |
| --- | --- |
| **0G Compute** | Runs every model call: the judges, the screenshot reader and voice notes |
| **0G Storage** | Holds every file: uploads, demo videos, live-test recordings |
| **Arkiv** | The app's database: every record, plus the public judging results |
| **ENS (ENSv2)** | One name per fighter and per AI judge, with score records |
| **Base Sepolia** | TournamentManager and BettingPools contracts |

## Why people come back

- **Teams:** a project can be judged again after it improves. Its new score replaces the old one on its ENS name, and the earlier runs stay readable on Arkiv.
- **Bettors:** every match opens a new pool, with payouts handled by the contracts. Rankings show how fighters compare before the next bet.
- **Organizers:** each new hackathon can run as its own tournament, with the same judges and record of past results.

## Run it locally

### What you need

- **Node.js 22.10+** and npm
- **MetaMask** in the browser, for submitting projects and betting
- A **0G Compute Router** API key, for the judges
- A **Rabdi testnet wallet** funded with tGLM ([faucet](https://hub.arkiv.network/faucet)), used as the Arkiv database
- Optional: a Sepolia wallet with ETH for ENS, and a 0G testnet wallet ([faucet](https://faucet.0g.ai)) for 0G Storage

Use new test wallets for all of these, never a wallet that holds real funds.

### 1. Backend (API on http://localhost:3000)

```bash
cd backend
npm install
cp .env.example .env    # then fill in your own values (see the table below)
npm start
```

Main settings in `backend/.env`:

| Variable | Needed? | What it's for |
| --- | --- | --- |
| `ZG_API_KEY` | Yes, for judging | 0G Compute Router key. Without it, judging is turned off. |
| `ARKIV_PRIVATE_KEY` | Yes | Wallet that writes the Arkiv database. The server won't start without it. |
| `ZG_STORAGE=1`, `ZG_STORAGE_PRIVATE_KEY` | For file uploads | Turns on 0G Storage and sets the wallet that pays for uploads |
| `ENS_PRIVATE_KEY` | For ENS names | Owner of `fightclub.eth` on Sepolia |
| `ENS_WRITER_PRIVATE_KEY` | Optional | Scoped wallet that can write only the `arena.*` score records |
| `JUDGE_PROVIDER` | Optional | `0g` (default), `openai` or `anthropic` |

The full list is in [backend/README.md](backend/README.md).

### 2. Web app (http://localhost:5173)

In a second terminal:

```bash
cd frontend/web
npm install
npm run dev
```

In dev, the web app sends `/api` requests to the backend on port 3000. Contract addresses default to the Base Sepolia deployment below.

### 3. Try it

1. Open http://localhost:5173 and go to **Projects**.
2. Open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**.
3. Each judge's 0G request ID appears as soon as that judge answers, about a minute per run.
4. When the run finishes, the judges' panel shows the result read back from Arkiv, plus the project's ENS records.

### Tests

```bash
cd backend && npm test        # judging, scoring, security and store tests; in memory, no network
cd frontend/web && npm test   # validation tests
```

### Useful CLI commands (from `backend/`)

| Command | What it does |
| --- | --- |
| `npm run judge` | Runs the three judges from the terminal and prints each 0G request ID and cost |
| `npm run arkiv -- read --project go-health-me` | Reads a project's published panel and scorecards from Arkiv |
| `npm run ens` | ENS setup and name commands (see [backend/README.md](backend/README.md#ens-ensv2-on-sepolia)) |

### Docker (one container for the whole app)

```bash
docker build -t fightclub .
docker run -p 8080:8080 --env-file backend/.env fightclub   # http://localhost:8080
```

The image builds the web app, and the backend serves both the app and `/api`.

## 0G (Build with 0G Private Computer)

**What breaks if 0G is removed:** no project can be scored, because all three AI judges, the screenshot reader and the voice-note transcriber run on 0G Compute, and every uploaded file and demo recording is stored on 0G Storage.

- **0G Compute Router** runs every model call in the main flow. Judge reviews and screenshot evidence use `0gm-1.0-35b-a3b` on a TEE provider. Judge voice notes use `whisper-large-v3` with `verify_tee=true`.
- **Request IDs are shown in the product.** The project page shows each judge's request ID as soon as that judge answers, along with the provider address and cost. Each result stores them too (`zg.requestIds`).
- **0G Storage** holds every file: uploads, demo videos, and live-test recordings and screenshots. The Arkiv `files` index keeps each file's root hash.
- **Try it without an account:** on the live site, open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**.

Sample request IDs from live judging runs (model `0gm-1.0-35b-a3b`, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`):

| Project | 0G request ID |
| --- | --- |
| Go Health Me | `28f56730-dad3-4efb-9b20-0682fba35f96` |
| FitterCoin | `40b30406-96dc-444f-a49b-ddfacddf0749` |
| Mozark App Studio | `9883a36f-cb26-459e-95ef-8f9feeac313a` |

Full details: [backend/README.md](backend/README.md#0g-ethglobal-mumbai-build-with-0g-private-computer).

## Arkiv (Build on Arkiv)

After every judged run:
- the run's panel and its three judge scorecards are written to **Arkiv** (Rabdi testnet) as read-only, expiring entities
- each project's judges' panel reads them back from Arkiv and shows them
- the code can also upload the run's evidence bundle to **Swarm** and link it from the panel, but this needs a Bee node with a postage stamp. It isn't enabled on the live deployment, so no published panel has a Swarm reference yet.

**Wallet that writes our entities:** `0x429C0C8C8cDBf6b24D02075D808088983988B515`

**One query you can run.** Paste it into the [Rabdi entity explorer](https://rabdi.explorer.arkiv.network/entity-explorer):
```
arkiv.schema = str('battle-arena.panel') AND $owner = addr(0x429C0C8C8cDBf6b24D02075D808088983988B515) ORDER BY runAt:u64 DESC
```
It lists every published panel, newest first. From the repo, `cd backend && npm run arkiv -- read --project go-health-me` runs the same query for one project.

| Doc | What it covers |
| --- | --- |
| [schema.md](arkiv/schema.md) | Every entity type and its fields |
| [how-you-use-arkiv.md](arkiv/how-you-use-arkiv.md) | What we filter on, and which features read from Arkiv |
| [why-arkiv.md](arkiv/why-arkiv.md) | What people couldn't do if this data sat in Postgres |
| [reach.md](arkiv/reach.md) | Who uses the data today |
| [data-quality.md](arkiv/data-quality.md) | How fresh and complete the data is |
| [friction.md](arkiv/friction.md) | What got in our way |
| [swarm.md](arkiv/swarm.md) | The Swarm upload (built, not deployed) |

## ENS (ENSv2 on Sepolia)

Every fighter and every AI judge is a name under **`fightclub.eth`**:
- **`<project>.fightclub.eth`**: issued when a project is submitted. The subname is owned by the team's wallet, which can only transfer it. After every judged run, the arena writes the score to it, including `arena.score`, `arena.judges` and `arena.ranAt`. It also writes `arena.arkiv`, which links the Arkiv panel entity that backs the score.
- **`judge-<name>.fightclub.eth`**: each AI judge's persona, published as ENSIP-26 `agent-context` with `agent-endpoint[web]`.
- The project page and the judges' panel read these records in the browser, straight from ENS through the Universal Resolver.

The parent has its own UserRegistry and PermissionedResolver, both made through ENS's VerifiableFactory. Enhanced Access Control decides who can write what. Teams can't re-point their name's resolver. An optional score-writer wallet can set only the `arena.*` keys (`grantSetterRoles`). Fight records (`arena.record` W-L, `arena.titles`, `arena.lastFight`) are tallied from matches the TournamentManager contract finalized, so the winner on ENS is the one the contract derived.

| Contract (Sepolia, `fightclub.eth`) | Address |
| --- | --- |
| UserRegistry | [`0x81bB4AB8FbF29A5e5F1a3c6d56cc37803A09488b`](https://sepolia.etherscan.io/address/0x81bB4AB8FbF29A5e5F1a3c6d56cc37803A09488b) |
| PermissionedResolver | [`0x707D91427a17748bFd4e810613A32a04B506eF25`](https://sepolia.etherscan.io/address/0x707D91427a17748bFd4e810613A32a04B506eF25) |

Code: [backend/src/ens/](backend/src/ens/) and [frontend/web/src/lib/ens.js](frontend/web/src/lib/ens.js). Setup and commands: [backend/README.md](backend/README.md#ens-ensv2-on-sepolia).

## Contracts (Base Sepolia, chain ID 84532)

| Contract | Address |
| --- | --- |
| TournamentManager | [`0x45cdb8fc0b250f70f56675e8b6c0c25ac6bd6c03`](https://base-sepolia.blockscout.com/address/0x45cdb8fc0b250f70f56675e8b6c0c25ac6bd6c03) |
| BettingPools | [`0xb73e35494272ec09044893c585b40e0cedb7eb95`](https://base-sepolia.blockscout.com/address/0xb73e35494272ec09044893c585b40e0cedb7eb95) |
| FilterCoin (token) | [`0x564B51f96406328Ad3dBD6E89b63219938F4fbb7`](https://base-sepolia.blockscout.com/address/0x564B51f96406328Ad3dBD6E89b63219938F4fbb7) |

Deployment record: [backend/contracts/deployments/base-sepolia-v2.json](backend/contracts/deployments/base-sepolia-v2.json). Contract spec: [backend/contracts/SPEC.md](backend/contracts/SPEC.md).

## Repo layout

| Folder | What's in it |
| --- | --- |
| [backend/](backend/README.md) | API server, judges, reviewer agent, 0G, Arkiv and ENS clients, contracts |
| [frontend/web/](frontend/web/README.md) | The web app (PWA) |
| [frontend/design-system/](frontend/design-system/README.md) | Shared styles |
| [arkiv/](arkiv/) | Arkiv prize docs |
| [docs/](docs/) | Extra notes and end-to-end test guides |

## Team

| Name | GitHub | X | Telegram |
| --- | --- | --- | --- |
| Dhruv Bhagatkar | [dhruv2003](https://github.com/dhruv2003) | [@thisissdhruv](https://x.com/thisissdhruv) | [@dhruvdbajajajs](https://t.me/dhruvdbajajajs) |
| Aryan Kyatham | [ARYANK-08](https://github.com/ARYANK-08) | [@kyathamaryan_](https://x.com/kyathamaryan_) | @aryankyatham |
| Shivam Musterya | [musterya-sm](https://github.com/musterya-sm) | [@musteryaSM](https://x.com/musteryaSM) | @shivammusterya |
| Aditi | [uyaditi](https://github.com/uyaditi) | [@uyaditi_](https://x.com/uyaditi_) | [@uyaditi](https://t.me/uyaditi) |
| Aryan Surve | [XeHunter](https://github.com/XeHunter) | [@ARYANSURVE16](https://x.com/ARYANSURVE16) | [@aryansurve](https://t.me/aryansurve) |

## How we used AI

- **In the product:** LLM judges (on 0G by default) score projects; a reviewer agent writes dossiers and live-test steps.
- **Building it:** the team used Claude Code, an AI coding assistant, to write and review parts of the code and docs, including the Arkiv and Swarm integration.

## License

[MIT](LICENSE)
