# Backend

Everything that runs off the user's browser.

## Run

```bash
cd backend
npm install
cp .env.example .env      # then put your OpenAI key in OPENAI_API_KEY
npm start                 # http://localhost:3000, API under /api
npm test                  # judge, scoring and security tests
```

The web app (`frontend/web`) proxies `/api` here in dev and preview.

## What's built

**Judge agents** (`src/judges/`, PRD 7.2):

- **Personas.** A judge fills the form on `/judge`: background, what they expect, how much each of 9 criteria matters (0–5), brownie points, deal-breakers and tone. `persona.mjs` compiles that into a versioned persona and prompt. Weights always total 100. The platform rules come last so persona text can't override them.
- **Reviews.** `review.mjs` sends each judge the submission, the reviewer's dossier and the live test results, and asks the LLM for structured scores. **OpenAI by default** (`JUDGE_PROVIDER=openai`, `gpt-5.4` through the Responses API with reasoning effort `high`); set `JUDGE_PROVIDER=anthropic` to use Claude (`claude-opus-5-5`). `JUDGE_MODEL` overrides the model. Reviews contain all 9 criteria scored 0–100, each with a comment and cited evidence, plus a headline and overall comment. A malformed review gets one repair attempt; after that it's marked invalid and no score is invented. A refusal is recorded as "declined".
- **Scoring.** Each judge's overall score is computed here, not by the model: the sum of weight% × score, in exact integer hundredths. The panel score is the mean of the three, rounded half up.
- **Independence.** The three judges run in parallel and never see each other's output. Project materials are passed as untrusted data.
- **On submit.** `POST /api/submissions` saves the project and starts the panel review in the background.

From the command line: `npm run judge -- --project go-health-me`. This also writes `fixtures/<id>/reviews.json`, so the static site can show the review.

**Reviewer pipeline** (`src/reviewer/`): runs automatically for every submission, in a queue (`REVIEW_CONCURRENCY`, default 1; unfinished reviews resume on restart), with live status at `GET /api/projects/:id/pipeline`:

1. **Fetch:** shallow clone of a public github.com repo. Hooks, submodules and LFS are off; blobs over 1 MB are skipped; 300 MB cap. Nothing from the repo is ever run.
2. **Pin:** the exact commit reviewed, plus history split at `EVENT_START`.
3. **Tests:** counted by reading files. **Not run**: that needs the sandbox (PRD TST-05), which isn't built yet.
4. **Demo:** a timed transcript of the demo video. Loom uses its captions; direct video files (MP4, Mux, ETHGlobal storage) are downloaded through `safeFetch` (https only, public addresses only, 300 MB cap), turned into audio with `ffmpeg` and transcribed with OpenAI (`TRANSCRIBE_MODEL`, default `gpt-4o-transcribe`). YouTube is skipped with a reason.
5. **Dossier:** the reviewer agent reads a bounded, line-numbered pack of the repo plus the transcript and writes the evidence dossier. Every `file:line` it cites is checked against the clone; a "supported" claim with no real line is downgraded to "unverified".
6. **Live test:** the live URL is the team's optional field, else the GitHub repo's homepage. `discoverSite` explores up to 6 pages on a Mozark cloud browser. The reviewer agent then writes the demo replay and major flows (`flows.mjs`): major flows may only target text the explorer saw, and demo screens it never saw are flagged so a miss reads as "not found on the live site". The flows run on laptop and phone through `tester/runner.mjs`, recorded. Results go to `data/live/<id>/`. Needs `MOZARK_TOKEN`, or the KEY=VALUE file at `MOZARK_ENV_FILE` (default `~/.mozark.env`).
7. **Judges:** the panel scores with the dossier and the live test.

Re-run one by hand: `npm run review -- --project <id>`. Delete a project with `DELETE /api/projects/:id` (organizer).

Needs on the server: `git`, `ffmpeg`/`ffprobe`, and `npm install` in `backend/tester` (Playwright, no browsers).

**Store** (`src/store.mjs`): JSON files in `data/` (gitignored), standing in for the database. Swap those functions for real queries later.

**Routes** (`src/api.mjs`): health, criteria, judges (CRUD, max 3), submissions, and project reviews (get, run).

**Security** (`src/security.mjs`):

- **Organizer routes** (add, edit or remove judges; run the panel by hand) need `ADMIN_TOKEN` as a Bearer token when it's set. Without `ADMIN_TOKEN` they only accept requests from this machine. The `/judge` page has an organizer key field for this.
- **Submissions** must carry the owner wallet's signature over a message naming the project and repo, issued in the last 15 minutes (PRD SUB-04), and are limited to 5 per IP per hour, because each one starts paid judge runs.
- **CORS** only allows the app's own origins (`CORS_ORIGIN`).

**Tester** (`tester/`): the live smoke test on Mozark cloud browsers. See its README.

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
