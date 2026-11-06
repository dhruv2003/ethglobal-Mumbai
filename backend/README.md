# Backend

Everything that runs off the user's browser.

## Run

```bash
cd backend
npm install
cp .env.example .env      # then put your 0G Compute Router key in ZG_API_KEY
npm start                 # http://localhost:3000, API under /api
npm test                  # judge, scoring, security and store tests (in memory, no network)
npm run migrate -- data   # once: move an old backend/data folder to Arkiv (records) and 0G (files)
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

**Store** (`src/store.mjs`): nothing is kept on the server's disk. **Records** (submissions, tournaments, judges, reviews, dossiers, pipelines, transcripts, live-test reports, brackets, fights, payouts, World ID claims) are documents in the **Arkiv database** (`src/arkiv/db.mjs`). **Files** (uploaded videos and screenshots, our copy of each demo video, live-test recordings and step screenshots) are on **0G Storage** (`src/zg/files.mjs`), with each file's root hash kept in the Arkiv database. The only things written to disk are scratch work under the OS temp folder (a repo being read, a video being transcoded, a live test being recorded), removed when the work ends. See "Where the data lives" below.

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

### Where the data lives: Arkiv (records) and 0G Storage (files)

**Arkiv database** (`src/arkiv/db.mjs`). Every record is a document in a collection, stored as `battle-arena.doc` entities owned by the publisher wallet (`ARKIV_PRIVATE_KEY`): gzip JSON, split into parts over 128 KiB, read-only, expiring after `ARKIV_TTL_DAYS` (default 120).

- On boot the server reads the newest version of every document from Arkiv (about a second for a hackathon's worth) and serves reads from that copy. A page needs dozens of records and an Arkiv query takes ~0.5 s, so reads don't go to Arkiv one by one.
- A write changes that copy at once and goes to Arkiv in the background, one transaction at a time (~7 s each). A document that changes again while waiting is written once, with its newest value. Failed writes are retried with backoff; `/api/health` → `database` shows pending and failed writes.
- Arkiv entities can't be edited, so a change is a new version (the newest wins) and a delete is a newer version marked deleted.
- Collections: `submissions`, `events`, `judges`, `reviews`, `pipelines`, `dossiers`, `transcripts`, `evidence`, `livetests`, `videos`, `voice-notes`, `tournaments`, `fights`, `embeddings`, `proposals`, `payouts`, `world-claims`, `arkiv-publishes`, and `files` (the index of 0G files).
- Without `ARKIV_PRIVATE_KEY` (or `PUBLISHER_PRIVATE_KEY`) the server refuses to start: there is no other store. Tests (`node --test`) use an in-memory database.
- A CLI run (`npm run judge`, `npm run review`) writes to the same database and waits until Arkiv has everything; a server that is already running only sees those writes after a restart.
- Arkiv is public: everything in it can be read by anyone. Voice-note audio is never stored (only its transcript and sha256).

**0G Storage** (`src/zg/files.mjs`, `src/zg/storage.mjs`). Every file is uploaded to 0G Storage from `ZG_STORAGE_PRIVATE_KEY`'s wallet; the Arkiv `files` index keeps its root hash, transaction, size and sha256. A file waits in memory until 0G has it, and recently read files are kept in memory (`ARKIV_FILE_CACHE_MB`, default 256). Downloads are checked against the root hash (we recompute the 0G Merkle root, since the SDK's `proof` option is a no-op) and the sha256. Videos over `ZG_VIDEO_SHRINK_MB` (default 40) are re-encoded to at most 720p first.

- API: `GET /api/storage` (network, wallet, counts), `/api/storage/records` (every file with root hash and explorer links), `/api/storage/blob/:rootHash` (only our files, so it isn't an open proxy), `POST /api/storage/verify/:kind/:id` (download again from 0G and check the hash). The web app's `/storage` page lists them.
- Set up (testnet): make a new wallet just for this, fund it at https://faucet.0g.ai, then in `.env` set `ZG_STORAGE=1` and `ZG_STORAGE_PRIVATE_KEY`. Uploads are public and permanent.

**Moving an old `data/` folder:** `npm run migrate -- path/to/data` (`--dry-run` to list first) puts its records into Arkiv and its files onto 0G, skipping what's already there.

### What breaks if 0G is removed

Without 0G Storage the arena has nowhere to keep files: uploads are refused (503), demo videos aren't copied, and live-test recordings and screenshots are lost when the run ends, so the judges see no screenshots.

Without 0G Compute no project gets a panel score, judges can't fill in their persona by voice, and the live-test screenshots go unread, because every model call in those flows goes through the 0G Compute Router.

In practice, with the default `JUDGE_PROVIDER=0g` and no `ZG_API_KEY`: `/api/health` reports `judgesReady: false`, the judge button is replaced by "Add `ZG_API_KEY`", review routes return 503, and new submissions are saved without a review. Switching judges to `openai` or `anthropic` brings scoring back, but with no 0G request IDs, provider addresses or costs to show. (The fight agents in `src/agents/` are written for 0G but not yet wired into the app.)

### Try it (no account needed)

Open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**. The three judges run live on the 0G Compute Router, and each request ID appears as soon as that judge answers (about a minute on `0gm-1.0-35b-a3b`, under $0.01 a run). Guards, because each run is paid: sample projects only, 2 runs per visitor per hour, 10 minutes between runs of one project, and `PUBLIC_RUNS_PER_DAY` in total (default 40). Screenshot observations already read on 0G are reused for free. A run where no judge could score never replaces the last good result.

### Where 0G request IDs appear in the product

- **Project page, while judging**: "Live on 0G", each judge's request ID (copyable) the moment their call answers, then their score.
- **Project page, judges' panel** (`frontend/web/src/components/JudgesPanel.jsx`): a "Ran on 0G Compute Router" label with the model, call count and panel cost; under each judge card, "Ran on 0G" with that judge's request ID(s) (copyable, monospace), provider address and cost; a list of every request ID for the panel.
- **Project page, screenshot evidence**: each screenshot observation with its request ID (when the evidence step ran).
- **`/judge` form, voice notes**: the whisper request ID, cost and the TEE status that 0G reported.
- **Stored results**: the `reviews` collection in the Arkiv database and `fixtures/<id>/reviews.json` (`reviews[].traces[]`, `zg.requestIds`, `zg.costUsdMicro`, `evidence[].trace`).
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

## ENS (ENSv2 on Sepolia)

Fighters and judges get names under `fightclub.eth` (`src/ens/ens.mjs`). Contract addresses are the ENSv2 Sepolia deployment. The parent's registry and resolver are read from the .eth registry on chain; they aren't configured anywhere.

| Env var | What it does |
|---|---|
| `ENS_PRIVATE_KEY` | Owner of the parent. It signs setup, subname issuance and profile records, and needs Sepolia ETH. The registration fee is paid in Sepolia MockUSDC, which setup mints itself. |
| `ENS_WRITER_PRIVATE_KEY` | Optional. A scoped wallet that writes only the `arena.*` score keys. If it isn't set, the owner writes them. |
| `ENS_PARENT` | Default `fightclub.eth`. |
| `ENS_RPC_URL` | Sepolia RPC. Default: publicnode. |
| `ARENA_PUBLIC_URL` | The public site URL, used for the `url` and `agent-endpoint[web]` records. |

```
# With ENS_PRIVATE_KEY set, the server does setup, judges and backfill by itself at startup. These are for doing it by hand.
npm run ens -- setup                 # once: deploy resolver + subname registry, commit/register the parent (~2 min)
npm run ens -- judges                # judge names + ENSIP-26 agent records
npm run ens -- issue --all           # names for every submitted project (+ latest score)
npm run ens -- fights               # W-L / titles from finalized matches on the TournamentManager
npm run ens -- status                # parent, registry, resolver, names given out
npm run ens -- read <name>           # what any ENS client sees
```

Everything is automatic:
- Each server start sets up the parent if needed and issues whatever is missing.
- A new submission gets its name.
- A saved review writes the score, after the Arkiv publish so it can link the panel entity.
- Creating or editing a judge refreshes its agent records.
- The autorun loop tallies wins, losses and titles from finalized matches on the TournamentManager contract (at most once a minute). It maps each bracket slot back to its submission and writes only the records that changed.

None of these background writes can fail the request that started them. `GET /api/ens` returns the id-to-name map, and the web app reads every record from ENS itself. Names given out are kept in the Arkiv database (collection `ens`).
