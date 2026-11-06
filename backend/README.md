# Backend

Everything that runs off the user's browser.

## Run

```bash
cd backend
npm install
cp .env.example .env      # then put your 0G Compute Router key in ZG_API_KEY
npm start                 # http://localhost:3000, API under /api
npm test                  # judge, scoring, security and 0G Storage tests (no network)
npm run zg:status         # 0G Storage wallet, balance, head manifest, outbox
```

The web app (`frontend/web`) proxies `/api` here in dev and preview.

## What's built

**Judge agents** (`src/judges/`, PRD 7.2):

- **Personas.** A judge fills the form on `/judge`: background, what they expect, how much each of 9 criteria matters (0–5), brownie points, deal-breakers and tone. `persona.mjs` compiles that into a versioned persona and prompt. Weights always total 100. The platform rules come last so persona text can't override them.
- **Reviews.** `review.mjs` sends each judge the submission, the reviewer's dossier and the live test results, and asks the LLM for structured scores. **0G by default** (`JUDGE_PROVIDER=0g`): the [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart), chat completions with a `json_schema` response format and reasoning effort `high`, model `0gm-1.0-35b-a3b` (0G's own model on a TDX TEE provider). `JUDGE_MODEL=gpt-5.4` also works through 0G; Claude models through 0G reject `json_schema`, so don't use them for judges. To skip 0G, set `JUDGE_PROVIDER=openai` (`gpt-5.4` via the Responses API, needs `OPENAI_API_KEY`) or `JUDGE_PROVIDER=anthropic` (`claude-opus-5-5`, needs `ANTHROPIC_API_KEY`). `JUDGE_MODEL` overrides the model. Reviews contain all 9 criteria scored 0–100, each with a comment and cited evidence, plus a headline and overall comment. A malformed review gets one repair attempt; after that it's marked invalid and no score is invented. A refusal is recorded as "declined".
- **Scoring.** Each judge's overall score is computed here, not by the model: the sum of weight% × score, in exact integer hundredths. The panel score is the mean of the three, rounded half up.
- **Independence.** The three judges run in parallel and never see each other's output. Project materials are passed as untrusted data.
- **0G proof.** Every 0G call keeps its trace: request ID, provider address, cost in micro-dollars, and the `ZG-Res-Key` chat ID for an independent signature check. Each review stores one trace per attempt (two if it needed a repair), and the result stores panel totals (`zg.requestIds`, `zg.costUsdMicro`). 0G errors follow the [errors page](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/errors): 402 is never retried and shows "0G balance empty", 429 waits for `Retry-After` (up to 3 times), and 502, 503 and a timeout (180 s) are each retried once.
- **Screenshot evidence (optional).** With `--evidence` (or `JUDGE_EVIDENCE=1` for the API), `evidence.mjs` first sends each live-test screenshot (`fixtures/<id>/smoke/<device>/`) to `0gm-1.0-35b-a3b` on 0G, which writes down what is on screen. Judges get these observations as untrusted evidence with IDs they can cite (`V-laptop-d1`…), and each one keeps its 0G request ID. Results are cached in `data/evidence/`.
- **Voice notes.** On `/judge`, a judge can record or upload a voice note. `POST /api/judges/voice-note` sends it to `whisper-large-v3` on 0G with `verify_tee=true`, and the transcript goes into a free-text field of the persona. The form shows the request ID, and says "TEE verified" only when 0G returned `tee_verified: true` for that call.
- **On submit.** `POST /api/submissions` saves the project and starts the panel review in the background.

From the command line: `npm run judge -- --project go-health-me`. This also writes `fixtures/<id>/reviews.json`, so the static site can show the review. Add `--no-fixture --out <file>` to compare models without overwriting it, and `--evidence` to run the screenshot step first.

**Reviewer pipeline** (`src/reviewer/`): runs automatically for every submission, in a queue (`REVIEW_CONCURRENCY`, default 1; unfinished reviews resume on restart), with live status at `GET /api/projects/:id/pipeline`:

1. **Fetch:** shallow clone of a public github.com repo. Hooks, submodules and LFS are off; blobs over 1 MB are skipped; 300 MB cap. Nothing from the repo is ever run.
2. **Pin:** the exact commit reviewed, plus history split at `EVENT_START`.
3. **Tests:** counted by reading files. **Not run**: that needs the sandbox (PRD TST-05), which isn't built yet.
4. **Demo:** a timed transcript of the demo video. Loom uses its captions; direct video files (MP4, Mux, ETHGlobal storage) are downloaded through `safeFetch` (https only, public addresses only, 300 MB cap), turned into audio with `ffmpeg` and transcribed with OpenAI (`TRANSCRIBE_MODEL`, default `gpt-4o-transcribe`). YouTube is skipped with a reason.
5. **Dossier:** the reviewer agent reads a bounded, line-numbered pack of the repo plus the transcript and writes the evidence dossier. Every `file:line` it cites is checked against the clone; a "supported" claim with no real line is downgraded to "unverified".
6. **Live test:** the live URL is the team's optional field, else the GitHub repo's homepage. `discoverSite` explores up to 6 pages on a Mozark cloud browser. The reviewer agent then writes the demo replay and major flows (`flows.mjs`): major flows may only target text the explorer saw, and demo screens it never saw are flagged so a miss reads as "not found on the live site". The flows run on laptop and phone through `tester/runner.mjs`, recorded. Results go to `data/live/<id>/`. Needs `MOZARK_TOKEN`, or the KEY=VALUE file at `MOZARK_ENV_FILE` (default `~/.mozark.env`).
7. **Judges:** the panel scores with the dossier and the live test.

The dossier and flow writer use the same `JUDGE_PROVIDER`, `JUDGE_MODEL`, and credentials as the judges, including 0G by default. Each request keeps its own output schema; demo transcription still uses the separate OpenAI transcription step described above.

Re-run one by hand: `npm run review -- --project <id>`. Delete a project with `DELETE /api/projects/:id` (organizer).

Needs on the server: `git`, `ffmpeg`/`ffprobe`, and `npm install` in `backend/tester` (Playwright, no browsers).

**Store** (`src/store.mjs`): JSON files in `data/` (gitignored), standing in for the database, written with sorted keys. With `ZG_STORAGE=1` every write is also archived on 0G Storage (see below). Swap those functions for real queries later.

**Routes** (`src/api.mjs`): health, criteria, judges (CRUD, max 3), submissions, and project reviews (get, run).

**Security** (`src/security.mjs`):

- **Organizer routes** (add, edit or remove judges; run the panel by hand) need `ADMIN_TOKEN` as a Bearer token when it's set. Without `ADMIN_TOKEN` they only accept requests from this machine. The `/judge` page has an organizer key field for this.
- **Submissions** must carry the owner wallet's signature over a message naming the project and repo, issued in the last 15 minutes (PRD SUB-04), and are limited to 5 per IP per hour, because each one starts paid judge runs.
- **CORS** only allows the app's own origins (`CORS_ORIGIN`).

**Tester** (`tester/`): the live smoke test on Mozark cloud browsers. See its README.

## 0G (ETHGlobal Mumbai: Build with 0G Private Computer)

All AI inference in the main flow runs on the 0G Compute Router (`https://router-api.0g.ai/v1`, OpenAI-compatible, key in `ZG_API_KEY`):

| Job | Model on 0G | Code |
| --- | --- | --- |
| Judge reviews (3 judges in parallel) | `0gm-1.0-35b-a3b` (TDX TEE provider); `gpt-5.4` optional | `src/judges/review.mjs` (`callZeroG`) |
| Screenshot evidence for judges | `0gm-1.0-35b-a3b` (image input) | `src/judges/evidence.mjs` |
| Judge voice notes → persona text | `whisper-large-v3`, `verify_tee=true` | `POST /api/judges/voice-note` in `src/api.mjs` |
| Public "Watch the judges score this on 0G" (sample projects) | as judge reviews | `POST /api/projects/:id/reviews/public` |

### 0G Storage: the durable, verifiable record

Every model call runs on 0G Compute; everything the arena produces is kept on [0G Storage](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk). Local `data/` stays the fast read cache; 0G is the record anyone can check, and `data/` can be rebuilt from 0G alone.

| Kind | What | Written by |
| --- | --- | --- |
| `submission` | the full signed submission (team, project, repo, video, tracks, fighter seed, wallets, chain, the wallet signature and message) | `POST /api/submissions` |
| `judges` | the whole judge panel on every change, so each persona version stays recoverable | seed, `POST/PUT/DELETE /api/judges` |
| `review` | the panel review: per-criterion scores and comments, panel score, **0G Compute request IDs, providers and costs** (PRD JDG-08) | `reviewNow()`, `npm run judge` |
| `evidence` | screenshot observations from the vision model on 0G, with their traces | `collectScreenshotEvidence` |
| `dossier`, `transcript`, `video` | the reviewer's dossier, the demo transcript, facts about our copy of the demo video | review pipeline (`src/reviewer/`) |
| `voice-note` | a judge's voice-note transcript and its whisper trace | `POST /api/judges/voice-note` |
| `voice-audio` | the recording, **AES-256 encrypted**, only when `ZG_STORAGE_AES_KEY` is set | same |
| `fixture-file`, `evidence-bundle` | a sample project's frozen evidence files as-is, plus a bundle listing every file's root hash and sha256 and the repo's pinned commit | `npm run zg:seed-fixtures` |
| `manifest` | the index of all of the above (the "head") | debounced, after uploads |

Never uploaded: API keys and wallet keys (incl. Arkiv, publisher, relayer, starter), `ADMIN_TOKEN`, World ID data, the AES key, browser drafts, rate-limit state, in-memory progress and `data/pipeline/`. Deleting a project uploads a "deleted" version of each of its records so a restore leaves it out (0G itself is permanent). The archive refuses any upload whose bytes contain one of those secrets (`secret_detected`). Fight code can call `archive(kind, id, obj)` from `src/zg/archive.mjs` later.

**How it works** (`src/zg/storage.mjs`, `src/zg/archive.mjs`):

- The store writes local JSON first, then appends to `data/zg-outbox.json`. A background worker uploads one item at a time from a dedicated server wallet (`ZG_STORAGE_PRIVATE_KEY`), retrying with exponential backoff (10 attempts, then `failed` with the reason). **A 0G failure never fails or slows an API request.** `POST /api/storage/flush` (organizer) retries failed items.
- Each JSON record is uploaded as an envelope `{ schema: "arena.v1", kind, id, createdAt, prev, app: { commit }, data }`. `prev` is the root hash of the previous version of the same record, so re-judging and panel edits form an auditable chain.
- `data/zg-manifest.json` maps `kind:id` to `{ rootHash, txHash, txSeq, sha256, size, uploadedAt, history }`. It is uploaded itself (at most every 30 s); its latest root hash is in `data/zg-head.json`. **That head root hash is the one value needed to recover everything.**
- Downloads are checked by recomputing the 0G Merkle root of the bytes and comparing it with the requested root (the hash the Flow contract committed on chain). We do this ourselves because the TS SDK's `proof` option is currently a no-op (`Downloader.downloadTask` has "TODO: add proof check"). Record content is also compared by `sha256` of its canonical JSON.
- API: `zgStorage: { status: pending | stored | failed | off, rootHash, txHash, links }` on submissions and reviews; `GET /api/storage`, `/api/storage/records`, `/api/storage/status/:kind/:id`, `/api/storage/blob/:rootHash` (only root hashes in our manifest, so it isn't an open proxy), `POST /api/storage/verify/:kind/:id`.
- Web app: the project page (submission and judges' panel) shows "Stored on 0G Storage" with the root hash, a link to the transaction on chainscan and the file on storagescan, and **Verify against 0G**.

**Set up** (testnet): make a new wallet just for this, fund it at https://faucet.0g.ai, then in `.env` set `ZG_STORAGE=1` and `ZG_STORAGE_PRIVATE_KEY`. `npm run zg:status` shows the balance.

**Restore and verify:**

```bash
npm run zg:status                                            # head root hash
npm run zg:restore -- --head <rootHash> --into /tmp/arena-restore
diff -r data /tmp/arena-restore                              # only zg-outbox / zg-cache / zg-head differ
npm run zg:verify                                            # re-download every record, check hashes
npm run zg:check                                             # download every upload with indexer.download(root, file, true)
npm run zg:seed-fixtures -- --project go-health-me           # upload the sample's frozen evidence (idempotent)
npm run test:0g-storage                                      # live round trips on testnet (funded wallet)
```

Short overview with a sample flow: [`docs/0G-STORAGE.md`](../docs/0G-STORAGE.md). The full manual run, with real testnet root hashes: [`docs/0G-STORAGE-E2E.md`](../docs/0G-STORAGE-E2E.md). In the web app, `/storage` lists every upload with download and verify.

### What breaks if 0G is removed

Without 0G Storage there is no tamper-evident copy of submissions, judge personas or reviews: the scores and their 0G Compute request IDs live only in one server's `data/` folder, and nobody outside can check that a review shown today is the one the judges produced. Restoring after losing that folder becomes impossible.

Without 0G Compute no project gets a panel score, judges can't fill in their persona by voice, and the live-test screenshots go unread, because every model call in those flows goes through the 0G Compute Router.

In practice, with the default `JUDGE_PROVIDER=0g` and no `ZG_API_KEY`: `/api/health` reports `judgesReady: false`, the judge button is replaced by "Add `ZG_API_KEY`", review routes return 503, and new submissions are saved without a review. Switching judges to `openai` or `anthropic` brings scoring back, but with no 0G request IDs, provider addresses or costs to show. (The fight agents in `src/agents/` are written for 0G but not yet wired into the app.)

### Try it (no account needed)

Open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**. The three judges run live on the 0G Compute Router, and each request ID appears as soon as that judge answers (about a minute on `0gm-1.0-35b-a3b`, under $0.01 a run). Guards, because each run is paid: sample projects only, 2 runs per visitor per hour, 10 minutes between runs of one project, and `PUBLIC_RUNS_PER_DAY` in total (default 40). Screenshot observations already read on 0G are reused for free. A run where no judge could score never replaces the last good result.

### Where 0G request IDs appear in the product

- **Project page, while judging**: "Live on 0G", each judge's request ID (copyable) the moment their call answers, then their score.
- **Project page, judges' panel** (`frontend/web/src/components/JudgesPanel.jsx`): a "Ran on 0G Compute Router" label with the model, call count and panel cost; under each judge card, "Ran on 0G" with that judge's request ID(s) (copyable, monospace), provider address and cost; a list of every request ID for the panel.
- **Project page, screenshot evidence**: each screenshot observation with its request ID (when the evidence step ran).
- **`/judge` form, voice notes**: the whisper request ID, cost and the TEE status that 0G reported.
- **Stored results**: `data/reviews/<id>.json` and `fixtures/<id>/reviews.json` (`reviews[].traces[]`, `zg.requestIds`, `zg.costUsdMicro`, `evidence[].trace`), and on 0G Storage as `review` records, so the request IDs themselves are kept on 0G.
- **CLI**: `npm run judge` prints each request ID, provider and cost.

### What we claim about TEEs

- `0gm-1.0-35b-a3b` runs on a TEE provider, but the Router does not return a `tee_verified` field for it (the response is end-to-end sealed, `X-0g-E2ee: sealed`). For calls made through `src/zg/client.js` with `verifyTee` (the fight agents and the UI face-off), `src/zg/tee.js` runs the check from the [verifiable execution docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution) itself: it reads the provider's service record from the InferenceServing contract on 0G mainnet, fetches the signature for the `ZG-Res-Key` chat ID from the provider, and checks that it was signed by the TEE signer registered on chain. The trace then carries `teeVerified: true|false`, `teeCheck: "signature"` and the signer; `null` means the check couldn't run and is never shown as verified.
- What that proves: for a sealed provider the signed text is a hash of the encrypted exchange (`zg-sig-v1/e2ee-ct:…`), so a pass proves the chat ID was answered inside the attested TEE. It can't prove the plaintext we were handed is what was signed.
- Judge reviews (`src/judges/review.mjs`, `callZeroG`) use their own request path and don't run this check yet.
- Voice notes on `whisper-large-v3` do come back with `tee_verified: true`, and only then does the UI say "TEE verified by 0G".

## Still to build

Remaining services from `PRD.md` section 13.2:

- Application service: sign-in and role checks
- Submission service: fetches repositories and processes artifacts
- Testing service: runs project tests in isolated sandboxes
- Evidence service: stores frozen snapshots and serves them to agents
- Tournament orchestrator: schedules rounds and advances the bracket
- Agent service: generates advocates, questions, rulings and scorecards
- Event service: saves and streams battle events
- Settlement service: publishes finalized results on chain
- Chain indexer: tracks bets, locks, outcomes, claims and refunds
- Monitoring service: tracks reliability and resource use

Smart contracts go in `contracts/` in this folder.

## Modules

| Folder | What it is |
| --- | --- |
| `scoring/` | Rubric, fixed-point scoring, tie-breaks and organizer review (`PRD.md` section 9). See its README. |
| `matching/` | Similarity-based round-one pairing and bracket placement (`PRD.md` ORG-05). See its README. |
