# 0G Storage in FightClub

> **Outdated (Nov 2026):** this describes the earlier 0G archive of every record, with a local `data/` folder. Now records live in the Arkiv database and only files (uploads, demo videos, live-test recordings and screenshots) go to 0G Storage, with nothing kept on disk. The `zg:*` scripts are gone. See "Where the data lives" in `backend/README.md`.


**One line:** every record the arena produces is saved locally *and* uploaded to [0G Storage](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk), so anyone can download it from 0G and check it hasn't changed.

## What gets stored

| Record | Example | When |
| --- | --- | --- |
| `submission` | team, project, repo, wallet + signature | a team submits |
| `judges` | the 3 judge personas (every version) | a judge is added or edited |
| `review` | scores, comments, **0G Compute request IDs** | the judges finish |
| `dossier` | the reviewer's evidence dossier (cited `file:line`s) | the review pipeline |
| `transcript` / `video` | demo-video transcript / facts about our saved copy | the review pipeline |
| `evidence` | what the vision model saw in each screenshot | the evidence step runs |
| `voice-note` / `voice-audio` | transcript / recording (**AES-256 encrypted**) | a judge records a voice note |
| `fixture-file`, `evidence-bundle` | sample project's frozen files | `npm run zg:seed-fixtures` |
| `manifest` | index of all of the above (the **head**) | ~30 s after uploads |

Never stored: API keys, wallet keys, the organizer token, World ID data, browser drafts, review-progress state (`data/pipeline/`). Uploads that contain a secret are refused.

0G is permanent: deleting a project here uploads a small "deleted" version of each of its records, so a restore leaves it out, but older versions stay on 0G.

## How it works

```
 API request ──► store.save()  ──► data/*.json          (1) local write, the API answers right away
                                └► data/zg-outbox.json  (2) queued
 background worker ─► 0G Storage upload ─► root hash + tx hash
                   └► data/zg-manifest.json  (kind:id → rootHash, txHash, history)
                   └► manifest uploaded too ─► data/zg-head.json  (ONE hash to recover everything)
```

- **Never blocks.** If 0G is slow or down, the API still answers. Uploads retry with backoff, then show *Failed* until an organizer retries them (`POST /api/storage/flush`).
- **Versioned.** Each upload is `{ schema, kind, id, createdAt, prev, data }`. `prev` points at the previous version's root hash, so edits form a chain.
- **Checked.** On download we recompute the 0G Merkle root of the bytes and compare it with the root hash recorded on chain, then compare the content hash with ours.

## Sample flow: one submission

1. A team submits **"Atlas"** and signs it with their wallet. The API saves it and answers `201` at once:

   ```json
   { "id": "b43792d8-…", "zgStorage": { "status": "pending" } }
   ```

2. About 15 seconds later the worker has uploaded it:

   ```json
   { "status": "stored",
     "rootHash": "0x7b156d38…d7a17",
     "txHash":   "0x0df9bb40…e8f3",
     "links": { "tx":   "https://chainscan-galileo.0g.ai/tx/0x0df9bb40…",
                "file": "https://storagescan-galileo.0g.ai/submission/159584" } }
   ```

3. The project page shows **✓ Stored on 0G Storage** under the team's details, with the root hash, both links and **Verify against 0G**. Verify downloads the copy from 0G and answers **✓ Matches 0G copy**.

4. Anyone can fetch it without our server, using only the root hash:

   ```ts
   const indexer = new Indexer("https://indexer-storage-testnet-turbo.0g.ai");
   await indexer.download("0x7b156d38…d7a17", "./atlas.json", true);
   ```

The same happens for the judges' review (with its 0G Compute request IDs), a persona edit, and a voice note.

## Try it

```bash
# backend/.env
ZG_STORAGE=1
ZG_STORAGE_PRIVATE_KEY=0x…   # testnet-only wallet with some 0G (https://faucet.0g.ai)
ZG_STORAGE_AES_KEY=…         # optional, 64 hex: only then is voice audio uploaded (encrypted)

cd backend
npm run zg:status            # wallet, balance, head hash, queue
npm start                    # then submit a project in the web app
```

| Command | What it does |
| --- | --- |
| `npm run zg:status` | wallet, balance, head root hash, queue counts |
| `npm run zg:check` | downloads **every** upload from 0G to `zg-downloads/` (`indexer.download(root, file, true)`), checks Merkle root + sha256, counts storage nodes |
| `npm run zg:verify` | re-downloads every record and compares it with `data/` |
| `npm run zg:restore -- --head <hash> --into /tmp/r` | rebuilds `data/` from 0G alone |
| `npm run zg:seed-fixtures -- --project go-health-me` | uploads a sample project's files (skips ones already there) |
| `npm run test:0g-storage` | live round trips on testnet |

In the web app, **0G Storage** in the top bar (`/storage`) lists every upload with **Download from 0G**, **Storage Scan**, **Transaction** and **Verify**.

## API

| Route | |
| --- | --- |
| `GET /api/storage` | on/off, network, wallet + balance, head, queue |
| `GET /api/storage/records` | every record: kind, id, root hash, tx hash, links, history |
| `GET /api/storage/status/:kind/:id` | `off` / `pending` / `stored` / `failed` |
| `GET /api/storage/blob/:rootHash` | the stored bytes, from 0G (our root hashes only; `?fresh=1` skips the cache, `?download=1` saves a file) |
| `POST /api/storage/verify/:kind/:id` | re-download and compare: `{ match, rootHash, localSha256, remoteSha256 }` |
| `POST /api/storage/flush` | retry failed uploads now (organizer) |

Tested end to end on testnet (submission, judges, persona edit, voice note, 61 sample files, failure drill, restore): see [`0G-STORAGE-E2E.md`](0G-STORAGE-E2E.md), which lists the real root hashes.

Code: `backend/src/zg/storage.mjs` (0G SDK client), `backend/src/zg/archive.mjs` (queue, manifest, verify, restore), `backend/src/store.mjs` (where writes are queued). Fight, bracket and payout data (`src/arena/`, `src/payouts/`) is not archived yet; call `archive(kind, id, obj)` from `src/zg/archive.mjs` to add it.
