# 0G Storage: end-to-end test

How to check by hand that every arena record lands on 0G Storage, can be downloaded and verified, and can be restored from 0G alone. Results from the run on 2026-11-06 (Galileo testnet, wallet `0x1528…fc1c`) are under each step. Overview: [`0G-STORAGE.md`](0G-STORAGE.md).

## Real records from this run

| Record | Root hash | Transaction | Storage Scan |
| --- | --- | --- | --- |
| `submission` | `0x7b156d383746789adf1962854017d9cebb287c37d9cbcc9028362ed9e17d7a17` | [0x0df9bb40…](https://chainscan-galileo.0g.ai/tx/0x0df9bb405730a336bd4a330fb158e486acaa8e196a6eae8a1f6b29b25049e8f3) | [159584](https://storagescan-galileo.0g.ai/submission/159584) |
| `review` (with 0G Compute request IDs) | `0xe6cfe35345bdfc955d9ccc898456f18a58257524f8bc67a352faffdea4f8cb7d` | [0x572fdf2d…](https://chainscan-galileo.0g.ai/tx/0x572fdf2df55f26c12458dcd838231854bccfcc056bb8d1165343730015d3d73b) | [159588](https://storagescan-galileo.0g.ai/submission/159588) |
| `judges` (panel, version 2) | `0xcb744a9eeeca37a2842cf22911d5cb19e34a0d4e7f126eceba077362f17ed374` | [0x5196eff5…](https://chainscan-galileo.0g.ai/tx/0x5196eff5b45b658252a98f6153481275edc214aa5d215cfa18ca744f04cac6f0) | [159608](https://storagescan-galileo.0g.ai/submission/159608) |
| `voice-note` | `0x8a7819b68b0b851ba0adbc7d129051255d553b23acd4811c442b54b6e62d3a2f` | [0x8645632d…](https://chainscan-galileo.0g.ai/tx/0x8645632dcb89908265698826cf532e65d1bc832341ee2b68084dcab68d5606a5) | [159610](https://storagescan-galileo.0g.ai/submission/159610) |
| `voice-audio` (AES-256) | `0x0b840333002d2811df78063506906d8d040de116e8a8e8a9f69204939269517f` | [0xc0a04663…](https://chainscan-galileo.0g.ai/tx/0xc0a0466384b67e9486c45764692895f49144bd8d9a2c315a99cbd1afe736c25d) | [159611](https://storagescan-galileo.0g.ai/submission/159611) |
| `evidence-bundle` (61 files) | `0x25fe7ded7db2078cb5922e90f6fb6d7e02859bd271bd4c84272e7297a5809ee5` | [0xd40e254b…](https://chainscan-galileo.0g.ai/tx/0xd40e254bd17bb6a94bed97f769abfc304528c367d4bd25bf5e860e27dd76a281) | [159719](https://storagescan-galileo.0g.ai/submission/159719) |
| **head manifest** | `0x429d90d7af7fda9aac47ad3285cfb6fd24754364fd5264617423a3ac6f2d02b8` | [0xa04237e3…](https://chainscan-galileo.0g.ai/tx/0xa04237e3d3730294685ccc6b77bcf96795b21fd5c2cdbf18a290d83fb0a868e7) | [159720](https://storagescan-galileo.0g.ai/submission/159720) |

68 records + the head, about 100 uploads in all (50 MB of sample files included) for ~0.107 testnet 0G.

## 0. Before you start

- A **testnet-only** wallet with some 0G for gas (https://faucet.0g.ai, 0.1 0G a day). One upload cost about 0.001–0.002 0G.
- `backend/.env`:

  ```
  ZG_API_KEY=...                 # 0G Compute Router key (judges, whisper)
  ZG_STORAGE=1
  ZG_STORAGE_NETWORK=testnet
  ZG_STORAGE_PRIVATE_KEY=...     # the funded testnet wallet; never commit
  ZG_STORAGE_AES_KEY=...         # optional, 64 hex: voice-note audio is uploaded only with it, encrypted
  ALLOW_LOCAL_ORGANIZER=1
  ```

- `npm install` in `backend/`, `backend/tester/` and `frontend/web/`.

## 1. Wallet and live round trips

```bash
cd backend
npm run zg:status          # "0G Storage: on · testnet (chain 16602)" and a balance > 0
npm run test:0g-storage    # live: JSON round trip, tx receipt, AES-256, a 5 MB file
```

> 5/5 passed. Small JSON: upload 15.2 s, download 2.7 s, Merkle root + sha256 match. Receipt `status: success`. AES: `peekHeader` finds the header, our key decrypts, no key gives ciphertext. 5 MB file: upload 15.6 s, download 27.2 s.

## 2. Submit a project

`npm start` in `backend/`, `npm run dev` in `frontend/web/`. Submit on `/submit` with a wallet signature. Open the project page: under the team's details, **◌ Pending upload to 0G Storage** becomes **✓ Stored on 0G Storage** (about 15–60 s) with the root hash, **Transaction on 0G Chain ↗**, **File on 0G Storage Scan ↗** and **Verify against 0G** → **✓ Matches 0G copy**.

> Ran in headless Chromium with an injected test wallet signing `personal_sign`: Pending → Stored → "✓ Matches 0G copy". Both explorer links open the right transaction and file.

## 3. Judges

```bash
npm run judge -- --project <submission id>
```

Prints each 0G Compute request ID, waits for the upload, then prints the review's root hash, tx link and the head manifest. On the project page the judges' panel shows "Ran on 0G Compute Router" with the request IDs and, below it, "✓ Stored on 0G Storage" with Verify.

> 3 judges on `0gm-1.0-35b-a3b`, $0.0084, panel 58.25. Review stored; Verify: "✓ Matches 0G copy". One attempt hit `replacement fee too low` (server and CLI share one wallet and raced for a nonce); the automatic retry stored it. Now reported as `nonce_conflict`.

## 4. Edit a judge persona

Edit a judge on `/judge` (or `PUT /api/judges/:id`). `GET /api/storage/records` → `judges:panel` history grows by one, and the new envelope's `prev` is the previous root hash.

> Persona version 1 → 2; `judges:panel` history 1 → 2.

## 5. Voice note

Record a voice note on `/judge`. The transcript + whisper trace is stored as `voice-note`. With `ZG_STORAGE_AES_KEY` the recording is stored as `voice-audio`, AES-256 encrypted; without it only its sha256 is kept.

> Whisper on 0G, `teeVerified: true`. The public blob starts with the 0G encryption header (byte `0x01`) and has no `RIFF` header; `POST /api/storage/verify/voice-audio/<id>` decrypts with our key and matches the original sha256. The local spool copy is deleted after upload.

## 6. Sample project evidence

```bash
npm run zg:seed-fixtures -- --project go-health-me      # every file except repo/, then the bundle
npm run zg:seed-fixtures -- --project go-health-me      # second run
```

> First run: 61 files (50 MB) in 20 min; two hit the 180 s timeout and were stored on retry. Second run: "0 to upload, 61 already on 0G", bundle unchanged.

## 7. Failure drill

Start the backend with `ZG_STORAGE_INDEXER=https://indexer-storage-testnet-turbo.invalid` and submit. Restart with the right indexer, then `POST /api/storage/flush` (organizer).

> 201 in 95 ms → pending → failed (`indexer_unavailable`, `getaddrinfo ENOTFOUND …`) → restart: still failed, no duplicate → flush → stored, `versions: 1`. (The first drill found a bug where a restart queued a duplicate; fixed in `d90c0b4`.)

## 8. Download every file the docs' way, and check Storage Scan

```bash
npm run zg:check     # indexer.download(rootHash, file, true) for every upload, into backend/zg-downloads/
```

Each row: Merkle root of the downloaded bytes = the root hash, sha256 = what we uploaded, and how many storage nodes hold it. Then open any `Storage Scan` link: it shows the root hash, our wallet and a green ✓ under **File Status**. In the web app, **0G Storage** (`/storage`) lists every upload with **Download from 0G** (fresh from the nodes, not our cache).

> `zg:check`: **69/69 OK** (68 records + head), 53 MB downloaded; replicas: 57 files on 4 nodes, 2 on 5, 1 on 3, 9 on 2. Storage Scan: **69/69** pages show our root hash, our wallet and a finalized status. `/storage`: download and Verify work.

Note: the TS SDK's `proof` flag is currently a no-op (`Downloader.downloadTask`: "TODO: add proof check"), so our code recomputes the Merkle root itself after every download.

## 9. Disaster drill

```bash
npm run zg:restore -- --head 0x429d90d7…2d02b8 --into /tmp/arena-restore
diff -r data /tmp/arena-restore
```

> Rebuilt from the head alone. `diff -r` shows only: `.restore` (marker), `zg-cache`, `zg-head.json`, `zg-outbox.json`, `zg-spool` (empty). Every data file, the manifest included, is byte-identical.

## 10. Verify and tests

```bash
npm run zg:verify                         # 69 match
cd backend && npm test                    # 163 pass (storage tests need no network)
cd ../frontend/web && npm test            # 123 pass
```
