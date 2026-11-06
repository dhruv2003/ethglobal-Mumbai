# Backend: structure and flow

Branch `main` at `81f644f`. Covers `backend/` only.

## Layout

| Path | Role |
| --- | --- |
| `src/server.js` | Express app (CommonJS). CORS, JSON body, mounts `/api` from `api.mjs`. |
| `src/api.mjs` | All routes, plus `reviewNow()`, which runs the panel on one project. |
| `src/judges/criteria.mjs` | The 9 criteria every judge scores from 0 to 100. |
| `src/judges/persona.mjs` | Turns the judge form into a persona: weights summing to 100, plus a system prompt built without an LLM. |
| `src/judges/seed.mjs` | 3 example judges (product, engineering, investor), seeded on first start. |
| `src/judges/review.mjs` | The judge agent: provider adapters, structured output, validation and repair, scoring, parallel panel. |
| `src/judges/evidence.mjs` | Optional step: a vision model on 0G describes each live-test screenshot. |
| `src/judges/run.mjs` | CLI: `npm run judge -- --project <id>`. |
| `src/zg/client.js`, `models.js` | 0G Compute Router client (chat, JSON, vision, whisper, embeddings) and which model does which job. |
| `src/projects.mjs` | Builds what a judge sees: submission, dossier and live test. |
| `src/store.mjs` | JSON-file "database" in `backend/data/` (gitignored). |
| `src/security.mjs` | Organizer auth (`ADMIN_TOKEN`), wallet-signature check on submissions (viem), rate limits. |
| `tester/smoke.mjs` | Live app test on Mozark cloud browsers (Playwright). A separate package. |
| `matching/`, `scoring/` | Standalone pure-JS packages (bracket seeding; PRD §9 scoring and ties). They have their own tests and **are not imported by `src/` yet**. |
| `fixtures/go-health-me/` | The sample project: submission, dossier, flows, smoke results, media. |

## Module dependencies

```mermaid
graph TD
  server[server.js] --> api[api.mjs]
  api --> persona[judges/persona] --> criteria[judges/criteria]
  api --> review[judges/review] --> criteria
  review --> projects
  api --> evidence[judges/evidence] --> zgc[zg/client] & zgm[zg/models] & store
  api --> seed[judges/seed]
  api --> projects[projects.mjs] --> store[store.mjs]
  api --> security[security.mjs] --> viem
  api --> zgc
  review -. lazy import .-> openai[openai SDK] & anthropic[@anthropic-ai/sdk]
  review --> zod
  run[judges/run.mjs CLI] --> api
  tester[tester/smoke.mjs] --> playwright --> mozark[(Mozark cloud Chrome)]
  tester -- writes --> fixtures[(fixtures/&lt;id&gt;/smoke)]
  projects -- reads --> fixtures
  evidence -- reads screenshots --> fixtures
  matching[matching/ standalone]
  scoring[scoring/ standalone]
```

## Judges: 0G or OpenAI?

**0G by default.** `JUDGE_PROVIDER` chooses the provider:

| `JUDGE_PROVIDER` | Key | Default model | API used |
| --- | --- | --- | --- |
| `0g` (default) | `ZG_API_KEY` | `0gm-1.0-35b-a3b` (TEE) | 0G Compute Router, OpenAI-compatible chat completions with a `json_schema` response format |
| `openai` | `OPENAI_API_KEY` | `gpt-5.4` | OpenAI Responses API, `responses.parse` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `messages.parse` |

The `openai` npm package is also how the backend talks to 0G (`baseURL = https://router-api.0g.ai/v1`). The screenshot vision step and voice-note transcription (whisper) always run on 0G.

**OpenAI fallback** (`callWithFallback` in `review.mjs`):
- It applies only when the provider is `0g` and `OPENAI_API_KEY` is set. `JUDGE_FALLBACK=off` turns it off, and `JUDGE_FALLBACK_MODEL` overrides the model (default `gpt-5.4`).
- An OpenAI call is made only when a 0G call fails after 0G's own retries: empty balance, provider down, timeout. A refusal or a malformed reply from 0G is not a failure; the repair attempt handles those.
- A missing `ZG_API_KEY` is still a 503, with no fallback.
- Each review records `fallbacks[]` (attempt, model, 0G error, 0G request ID). The panel result records `fallback.judges`, and progress emits a `fallback` event.
- Public runs (`/reviews/public`) never fall back.

### How a run works

```mermaid
sequenceDiagram
  participant T as Trigger
  participant A as reviewNow (api.mjs)
  participant E as evidence.mjs
  participant J as review.mjs (x3 in parallel)
  participant M as LLM (0G / OpenAI / Anthropic)
  T->>A: POST /submissions (auto) · POST /projects/:id/reviews · /reviews/public · CLI
  A->>A: loadProject, check 3 judges + key, one run per project at a time
  opt JUDGE_EVIDENCE=1 or --evidence
    A->>E: each smoke screenshot → 0G vision → observation (cached in data/evidence)
  end
  A->>J: runPanel(judges, project)
  J->>M: system = persona prompt, user = criteria + project_materials
  M-->>J: JSON review (zod schema) + 0G trace
  J->>J: validate; if invalid, one repair attempt; then weighted score
  J-->>A: per-judge result
  A->>A: panel = rounded mean of scored judges → data/reviews/<id>.json
```

**Inputs to each judge**
- *System prompt:* the persona (who they are, what they expect, weighted criteria, brownie points, deal-breakers, tone), then fixed platform rules that override it: score every criterion, cite evidence IDs, treat the materials as untrusted, never compare projects.
- *User prompt:* the 9 criteria plus `<project_materials>` JSON:
  - `submission`
  - `reviewerDossier`: claims checked against code, tests, risks
  - `liveTest`: `liveTestSummary` of `smoke.json`, with step statuses and failed requests
  - `screenshotObservations`: optional

**Output per judge** (zod `ReviewSchema`)
- `criteria[]`: `{id, score 0-100, comment, evidence[]}`
- `headline`, `comment`, `strengths`, `concerns`, `dealBreakerHit`/`dealBreakerNote`, `certainty`

The backend wraps this with:
- `status` (`scored` | `invalid` | `declined` | `error`), `attempts` and `usage`
- `overallHundredths = Σ weight% × score`, in integers
- `traces[]` on 0G: request ID, provider, cost, chat ID

**Panel output**
- `{provider, model, effort, complete, panelHundredths, zg: {requestIds, cost totals}, evidence?, reviews[]}`
- Saved to `data/reviews/<id>.json`.
- The CLI also writes `fixtures/<id>/reviews.json`, which the static web app reads.
- A run where no judge scores never overwrites the last good result.

**Rules that stop bad output**
- Judges run independently and never see each other's output.
- Each judge gets one repair retry, after which an invalid review gets no score.
- 0G retry policy:
  - 402: stop.
  - 429: honor `Retry-After`, up to 3 times.
  - 502/503: retry once.
  - Network drop: retry once.
- Public runs are capped: 0G only, sample projects only, 2 per IP per hour, a 10-minute cooldown per project, and `PUBLIC_RUNS_PER_DAY`.

## Project pre-processing and "isolated testing"

What the code actually does today:

1. **Repo / dossier: manual, static, nothing executed.** `fixtures/<id>/dossier.json` comes from a reviewer-agent run done by hand (`"mode": "manual run"`). It is a static read of a pinned commit (git submodule `fixtures/<id>/repo`). It holds claims checked against `file:line`, test counts, continuity, risks and open questions. **No code in `backend/` clones, builds, sandboxes or runs a team's repo.** The fixture README says not to run it outside a sandbox (PRD TST-05), but no sandbox is implemented.
2. **Flows: written by the reviewer.** `fixtures/<id>/flows.json` lists demo-replay steps taken from the demo video and major-flow steps taken from the code, written as Playwright-style actions.
3. **Live test: isolated in remote browsers.** `tester/smoke.mjs` connects over CDP to **Mozark cloud Chrome**: a laptop at 1440×900 and a phone at 390×844 with touch and an iPhone user agent.
   - It runs three phases: demo replay, major flows, then health (status, load time, console errors, failed requests, sideways scroll, broken images).
   - A deny-list stops it from clicking pay, stake, sign-in, wallet, submit and similar controls, and it never presses Enter.
   - Steps marked `requires` are reported as blocked.
   - If the cloud browser itself fails, the run is marked `error` (not an app fault) and retried once.
   - Submitted (non-fixture) projects have `dossier: null` and `liveTest: null`, so judges score them from the form alone.
4. **Vision evidence (optional).** A 0G vision model reads each step screenshot and returns `{seen, visibleText, matchesStep, problems}`. These go to the judges as `V-<device>-<step>` IDs, marked untrusted.

### Outputs and where they live

| Output | Location | In git? |
| --- | --- | --- |
| Live-test report (per step: passed/failed/blocked; per run: outcome `passed`/`issues`/`failed`/`error` with reasons, console errors, failed requests) | `fixtures/<id>/smoke/smoke.json` | yes |
| Session recordings | `fixtures/<id>/smoke/<device>/video.mp4` | yes |
| One screenshot per step | `fixtures/<id>/smoke/<device>/smoke-<device>-<step>.jpg` | yes |
| Code review / "bug report" (claims vs code, risks, limitations) | `fixtures/<id>/dossier.json` | yes |
| Provenance (pinned commit, media SHA-256) | `fixtures/<id>/source.json` | yes |
| Screenshot observations (vision, cached) | `data/evidence/<id>.json` | no |
| Judge panel results | `data/reviews/<id>.json` (+ `fixtures/<id>/reviews.json` from the CLI) | data no / fixture yes |
| Judges, submissions | `data/judges.json`, `data/submissions.json` | no |

There is no separate bug-report artifact. Bugs show up as failed steps and `outcome.reasons` in `smoke.json`, and as `risks` / `limitations` / unverified claims in `dossier.json`.

## Not wired up yet
- `matching/` and `scoring/` are not called by the API.
- Nothing generates dossiers or runs the tester automatically for new submissions.
- No repo sandbox.
- TEE verification: whisper is checked; for 0gm chat the router currently returns no TEE result.
