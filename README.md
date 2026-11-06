# AI Hackathon Battle Arena

Hackathon projects become AI fighters, and three AI judges score them. The product spec is in [PRD.md](PRD.md); the code is in [backend/](backend/README.md) and [frontend/](frontend/README.md).

## Arkiv

After every judged run:
- the evidence bundle goes to **Swarm**
- the run's panel and its three judge scorecards are written to **Arkiv** (Rabdi testnet) as read-only, expiring entities
- each project's judges' panel reads them back from Arkiv and shows them

Details: [arkiv/](arkiv/):
- [schema](arkiv/schema.md)
- [how we use it](arkiv/how-you-use-arkiv.md)
- [why Arkiv](arkiv/why-arkiv.md)
- [reach](arkiv/reach.md)
- [friction](arkiv/friction.md)
- [Swarm](arkiv/swarm.md)

**Wallet that writes our entities:** `TODO: publisher address (the address of ARKIV_PRIVATE_KEY, also shown at GET /api/health → arkiv.publisher)`

**One query you can run.** Paste it into https://rabdi.explorer.arkiv.network/entity-explorer, replacing the address:
```
arkiv.schema = str('battle-arena.panel') AND $owner = addr(<publisher address>) ORDER BY runAt:u64 DESC
```
It lists every published panel, newest first. From the repo, `cd backend && npm run arkiv -- read --project go-health-me` runs the same query for one project.

## ENS (ENSv2 on Sepolia)

Every fighter and every AI judge is a name under **`hackarena.eth`**:
- **`<project>.hackarena.eth`**: issued when a project is submitted. The subname is owned by the team's wallet, which can only transfer it. After every judged run, the arena writes the score to it, including `arena.score`, `arena.judges` and `arena.ranAt`. It also writes `arena.arkiv`, which links the Arkiv panel entity that backs the score.
- **`judge-<name>.hackarena.eth`**: each AI judge's persona, published as ENSIP-26 `agent-context` with `agent-endpoint[web]`.
- The project page and the judges' panel read these records in the browser, straight from ENS through the Universal Resolver.

The parent has its own UserRegistry and PermissionedResolver, both made through ENS's VerifiableFactory. Enhanced Access Control decides who can write what. Teams can't re-point their name's resolver. An optional score-writer wallet can set only the `arena.*` keys (`grantSetterRoles`). Fight records (`arena.record` W-L, `arena.titles`, `arena.lastFight`) are tallied from matches the TournamentManager contract finalized, so the winner on ENS is the one the contract derived.

Code: [backend/src/ens/](backend/src/ens/) and [frontend/web/src/lib/ens.js](frontend/web/src/lib/ens.js). Setup and commands: [backend/README.md](backend/README.md#ens-ensv2-on-sepolia).

## How we used AI

- **In the product:** LLM judges (on 0G by default) score projects; a reviewer agent writes dossiers and live-test steps.
- **Building it:** the team used Claude Code, an AI coding assistant, to write and review parts of the code and docs, including the Arkiv and Swarm integration.
