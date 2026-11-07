# FightClub

Hackathon projects become AI fighters, and three AI judges score them. The product spec is in [PRD.md](PRD.md); the code is in [backend/](backend/README.md) and [frontend/](frontend/README.md).

- **Live demo:** https://fightclub-seven.vercel.app
- **Demo video (under 3 min):** TODO (team): video URL
- **Setup:** [backend/README.md](backend/README.md) and [frontend/web/README.md](frontend/web/README.md)
- **License:** [MIT](LICENSE)

**Why people come back the next day:**
- **Teams:** a project can be judged again after it improves. Its new score replaces the old one on its ENS name, and the earlier runs stay readable on Arkiv.
- **Bettors:** every match opens a new pool, with payouts handled by the contracts. Rankings show how fighters compare before the next bet.
- **Organizers:** each new hackathon can run as its own tournament, with the same judges and record of past results.

## Team

| Name | GitHub | X | Telegram |
| --- | --- | --- | --- |
| Dhruv Bhagatkar | [dhruv2003](https://github.com/dhruv2003) | [@thisissdhruv](https://x.com/thisissdhruv) | [@dhruvdbajajajs](https://t.me/dhruvdbajajajs) |
| Aryan Kyatham | [ARYANK-08](https://github.com/ARYANK-08) | [@kyathamaryan_](https://x.com/kyathamaryan_) | |
| Shivam Musterya | [musterya-sm](https://github.com/musterya-sm) | [@musteryaSM](https://x.com/musteryaSM) | |
| Aditi | [uyaditi](https://github.com/uyaditi) | [@uyaditi_](https://x.com/uyaditi_) | [@uyaditi](https://t.me/uyaditi) |
| Aryan Surve | [XeHunter](https://github.com/XeHunter) | [@ARYANSURVE16](https://x.com/ARYANSURVE16) | [@aryansurve](https://t.me/aryansurve) |

## Contracts (Base Sepolia, chain ID 84532)

| Contract | Address |
| --- | --- |
| TournamentManager | [`0x45cdb8fc0b250f70f56675e8b6c0c25ac6bd6c03`](https://base-sepolia.blockscout.com/address/0x45cdb8fc0b250f70f56675e8b6c0c25ac6bd6c03) |
| BettingPools | [`0xb73e35494272ec09044893c585b40e0cedb7eb95`](https://base-sepolia.blockscout.com/address/0xb73e35494272ec09044893c585b40e0cedb7eb95) |
| FilterCoin (token) | [`0x564B51f96406328Ad3dBD6E89b63219938F4fbb7`](https://base-sepolia.blockscout.com/address/0x564B51f96406328Ad3dBD6E89b63219938F4fbb7) |

Deployment record: [backend/contracts/deployments/base-sepolia-v2.json](backend/contracts/deployments/base-sepolia-v2.json). For the ENS contracts behind `fightclub.eth` on Sepolia, see [ENS](#ens-ensv2-on-sepolia).

## 0G (Build with 0G Private Computer)

**What breaks if 0G is removed:** no project can be scored, because all three AI judges, the screenshot reader and the voice-note transcriber run on 0G Compute, and every uploaded file and demo recording is stored on 0G Storage.

- **0G Compute Router** runs every model call in the main flow. Judge reviews and screenshot evidence use `0gm-1.0-35b-a3b` on a TEE provider. Judge voice notes use `whisper-large-v3` with `verify_tee=true`.
- **Request IDs are shown in the product.** The project page shows each judge's request ID as soon as that judge answers, along with the provider address and cost. Each result stores them too (`zg.requestIds`).
- **0G Storage** holds every file: uploads, demo videos, and live-test recordings and screenshots. The Arkiv `files` index keeps each file's root hash.
- **Try it without an account:** open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**.

Sample request IDs from live judging runs (model `0gm-1.0-35b-a3b`, provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`):

| Project | 0G request ID |
| --- | --- |
| Go Health Me | `28f56730-dad3-4efb-9b20-0682fba35f96` |
| FitterCoin | `40b30406-96dc-444f-a49b-ddfacddf0749` |
| Mozark App Studio | `9883a36f-cb26-459e-95ef-8f9feeac313a` |

Full details: [backend/README.md](backend/README.md#0g-ethglobal-mumbai-build-with-0g-private-computer).

## Arkiv

After every judged run:
- the run's panel and its three judge scorecards are written to **Arkiv** (Rabdi testnet) as read-only, expiring entities
- each project's judges' panel reads them back from Arkiv and shows them
- the code can also upload the run's evidence bundle to **Swarm** and link it from the panel, but this needs a Bee node with a postage stamp. It isn't enabled on the live deployment, so no published panel has a Swarm reference yet.

Details: [arkiv/](arkiv/):
- [schema](arkiv/schema.md)
- [how we use it](arkiv/how-you-use-arkiv.md)
- [why Arkiv](arkiv/why-arkiv.md)
- [reach](arkiv/reach.md)
- [friction](arkiv/friction.md)
- [Swarm](arkiv/swarm.md)

**Wallet that writes our entities:** `0x429C0C8C8cDBf6b24D02075D808088983988B515`

**One query you can run.** Paste it into https://rabdi.explorer.arkiv.network/entity-explorer:
```
arkiv.schema = str('battle-arena.panel') AND $owner = addr(0x429C0C8C8cDBf6b24D02075D808088983988B515) ORDER BY runAt:u64 DESC
```
It lists every published panel, newest first. From the repo, `cd backend && npm run arkiv -- read --project go-health-me` runs the same query for one project.

## ENS (ENSv2 on Sepolia)

Every fighter and every AI judge is a name under **`fightclub.eth`**:
- **`<project>.fightclub.eth`**: issued when a project is submitted. The subname is owned by the team's wallet, which can only transfer it. After every judged run, the arena writes the score to it, including `arena.score`, `arena.judges` and `arena.ranAt`. It also writes `arena.arkiv`, which links the Arkiv panel entity that backs the score.
- **`judge-<name>.fightclub.eth`**: each AI judge's persona, published as ENSIP-26 `agent-context` with `agent-endpoint[web]`.
- The project page and the judges' panel read these records in the browser, straight from ENS through the Universal Resolver.

The parent has its own UserRegistry and PermissionedResolver, both made through ENS's VerifiableFactory. Enhanced Access Control decides who can write what. Teams can't re-point their name's resolver. An optional score-writer wallet can set only the `arena.*` keys (`grantSetterRoles`). Fight records (`arena.record` W-L, `arena.titles`, `arena.lastFight`) are tallied from matches the TournamentManager contract finalized, so the winner on ENS is the one the contract derived.

**On Sepolia (`fightclub.eth`):**

| Contract | Address |
| --- | --- |
| UserRegistry | [`0x81bB4AB8FbF29A5e5F1a3c6d56cc37803A09488b`](https://sepolia.etherscan.io/address/0x81bB4AB8FbF29A5e5F1a3c6d56cc37803A09488b) |
| PermissionedResolver | [`0x707D91427a17748bFd4e810613A32a04B506eF25`](https://sepolia.etherscan.io/address/0x707D91427a17748bFd4e810613A32a04B506eF25) |

Code: [backend/src/ens/](backend/src/ens/) and [frontend/web/src/lib/ens.js](frontend/web/src/lib/ens.js). Setup and commands: [backend/README.md](backend/README.md#ens-ensv2-on-sepolia).

## How we used AI

- **In the product:** LLM judges (on 0G by default) score projects; a reviewer agent writes dossiers and live-test steps.
- **Building it:** the team used Claude Code, an AI coding assistant, to write and review parts of the code and docs, including the Arkiv and Swarm integration.
