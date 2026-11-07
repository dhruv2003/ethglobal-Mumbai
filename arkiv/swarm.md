# Swarm in FightClub

> **Status: built, not deployed.** The upload and read code is complete, but the live deployment has no Bee node or postage stamp. No published panel has a Swarm reference yet, and we are not entering the Arkiv + Swarm bonus. This file describes how the integration works and how to turn it on.

## What lives where

| | Where | What |
| --- | --- | --- |
| Evidence bundle | **Swarm**: one collection per judged run, **unencrypted** | `review.json` (the full panel review), `dossier.json`, `live/smoke.json` (live-test report), `live/<device>/video.mp4`, `live/<device>/smoke-*.jpg` |
| Index and scores | **Arkiv** | `battle-arena.panel` and `battle-arena.scorecard` entities ([schema.md](schema.md)) |
| The link | The **`swarmRef`** field of `battle-arena.panel` | The collection's 64-hex reference |

The bundle is public evidence, so we upload it unencrypted. An encrypted reference contains its key, and Arkiv entities are public, so we never put one on Arkiv.

Readers open files through the gateway as `https://api.gateway.ethswarm.org/bzz/<swarmRef>/<path>`.

When Swarm isn't set up (`BEE_URL` and `SWARM_BATCH_ID` unset), the panel is still published to Arkiv, just without `swarmRef`.

## Files that upload and read

| File | Does |
| --- | --- |
| [backend/src/arkiv/swarm.mjs](../backend/src/arkiv/swarm.mjs) | Builds the bundle (`stageBundle`), uploads it (`uploadBundle` → `bee.collection.uploadFromDirectory`), reads a file back (`readFile` → `bee.file.download`), builds gateway links (`gatewayUrl`) |
| [backend/src/arkiv/publish.mjs](../backend/src/arkiv/publish.mjs) | After each saved review: Swarm upload first, then the reference goes into the Arkiv panel |
| [backend/src/arkiv/run.mjs](../backend/src/arkiv/run.mjs) | CLI for one upload and one read |
| [frontend/web/src/components/ArkivRecord.jsx](../frontend/web/src/components/ArkivRecord.jsx) | Shows the "Evidence on Swarm" links when a panel has a `swarmRef` |

## Turning it on

You need:
- Node 22.10+
- A Bee node that can upload (not ultra-light) with a usable postage stamp batch
- A Rabdi test wallet funded with tGLM (https://hub.arkiv.network/faucet)
- Optionally, an access key (https://hub.arkiv.network/access-keys)

In `backend/.env`:
```
ARKIV_PRIVATE_KEY=<test wallet key>
ARKIV_ACCESS_KEY=<access key>
BEE_URL=http://localhost:1633
SWARM_BATCH_ID=<batch id>
```

Install the dependencies:
```bash
cd backend && npm install
```

Upload: Swarm first, then Arkiv.
```bash
npm run arkiv -- publish --project go-health-me
```
You should see `swarm: <reference> (N files)`, then `arkiv: panel 0x…`, then the full record. The record is also saved to `backend/data/arkiv/go-health-me.json`.

Read: query Arkiv, then fetch `review.json` from Swarm through the public gateway.
```bash
npm run arkiv -- read --project go-health-me
```
You should see:
- the panel score, 3 scorecards, the expiry date and an explorer link
- `Swarm <reference>`
- a line read from the downloaded `review.json` that matches the panel score

In the app, the sample project's judges' panel then shows "Evidence on Swarm" links under the "Published on Arkiv" block.

## What got in our way

- **The docs and the npm package describe different APIs.** The Swarm docs' Upload & Download guide shows `bee.uploadFile` and `bee.uploadFilesFromDirectory`. In `@ethersphere/bee-js` 13.2.0 (latest on npm) those methods don't exist. The API is namespaced instead: `bee.file.upload`, `bee.file.download`, `bee.collection.uploadFromDirectory`. We had to read the package's type definitions to find them.
- **Uploading needs a Bee node with a postage stamp.** You can't upload through the public gateway, and an ultra-light node can only download. A stamp costs real xBZZ, and getting a node and stamp running is why we didn't deploy Swarm during the event.
