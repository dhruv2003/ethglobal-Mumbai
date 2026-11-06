# Backend

Everything that runs off the user's browser.

## Run

```bash
cd backend
npm install
cp .env.example .env      # then put your 0G Compute Router key in ZG_API_KEY
npm start                 # http://localhost:3000, API under /api
npm test                  # judge, scoring and security tests
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

**Store** (`src/store.mjs`): JSON files in `data/` (gitignored), standing in for the database. Swap those functions for real queries later.

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

### What breaks if 0G is removed

Without 0G no project gets a panel score, judges can't fill in their persona by voice, and the live-test screenshots go unread, because every model call in those flows goes through the 0G Compute Router.

In practice, with the default `JUDGE_PROVIDER=0g` and no `ZG_API_KEY`: `/api/health` reports `judgesReady: false`, the judge button is replaced by "Add `ZG_API_KEY`", review routes return 503, and new submissions are saved without a review. Switching judges to `openai` or `anthropic` brings scoring back, but with no 0G request IDs, provider addresses or costs to show. (The fight agents in `src/agents/` are written for 0G but not yet wired into the app.)

### Try it (no account needed)

Open a sample project, choose **Agent judge**, and press **Watch the judges score this on 0G**. The three judges run live on the 0G Compute Router, and each request ID appears as soon as that judge answers (about a minute on `0gm-1.0-35b-a3b`, under $0.01 a run). Guards, because each run is paid: sample projects only, 2 runs per visitor per hour, 10 minutes between runs of one project, and `PUBLIC_RUNS_PER_DAY` in total (default 40). Screenshot observations already read on 0G are reused for free. A run where no judge could score never replaces the last good result.

### Where 0G request IDs appear in the product

- **Project page, while judging**: "Live on 0G", each judge's request ID (copyable) the moment their call answers, then their score.
- **Project page, judges' panel** (`frontend/web/src/components/JudgesPanel.jsx`): a "Ran on 0G Compute Router" label with the model, call count and panel cost; under each judge card, "Ran on 0G" with that judge's request ID(s) (copyable, monospace), provider address and cost; a list of every request ID for the panel.
- **Project page, screenshot evidence**: each screenshot observation with its request ID (when the evidence step ran).
- **`/judge` form, voice notes**: the whisper request ID, cost and the TEE status that 0G reported.
- **Stored results**: `data/reviews/<id>.json` and `fixtures/<id>/reviews.json` (`reviews[].traces[]`, `zg.requestIds`, `zg.costUsdMicro`, `evidence[].trace`).
- **CLI**: `npm run judge` prints each request ID, provider and cost.

### What we claim about TEEs

- Judge reviews on `0gm-1.0-35b-a3b` run on a TEE provider, but 0G does not return a `tee_verified` field for that chat (the response is end-to-end sealed, `X-0g-E2ee: sealed`). We don't label judge output "TEE verified". We show the request ID and the provider address, and keep the `ZG-Res-Key` chat ID so the signature check from the [verifiable execution docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution) can be run independently. We have not implemented that check.
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
