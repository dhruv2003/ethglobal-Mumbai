# Tester: live check on cloud browsers

Opens a project's live app on Mozark cloud Chrome as a **laptop** (1440×900) and a **phone** (390×844, touch, iPhone user agent), records each session, and runs three phases:

1. **Demo replay:** the screens the team's demo video shows. Proves the demo wasn't faked: a screen the demo shows but the live app doesn't have fails here.
2. **Major flows:** the app's main features, exercised without an account.
3. **Health:** status, load time, console errors, failed requests, layout.

The steps come from `backend/fixtures/<project>/flows.json`, written by the reviewer from the demo video and the code. Steps marked `requires` (sign-in, wallet) are reported as blocked, never faked.

## Run

```bash
# once: save the Mozark token (portal → Automation → Playwright Testing → Bearer Token, ~24 h)
read -rs "MOZARK_TOKEN?Paste token: " && export MOZARK_TOKEN && echo
umask 077 && printf 'MOZARK_TOKEN=%s\n' "$MOZARK_TOKEN" > ~/.mozark.env

# each run
cd backend/tester
npm install            # Playwright only; no browsers needed, Mozark provides them
set -a; source ~/.mozark.env; set +a
node smoke.mjs --project go-health-me            # target comes from flows.json
```

Options: `--url` overrides the target. `--devices laptop` or `--devices phone` runs one; its results replace only that device's results. `MOZARK_PROJECT_ID` overrides the hub project.

## flows.json

```json
{ "target": "https://app.example",
  "phases": [
    { "id": "demo", "title": "Demo replay", "steps": [
      { "id": "d1", "title": "Landing", "demoAt": "0:00", "do": [{ "goto": "/" }, { "expectText": "Welcome" }] },
      { "id": "d2", "title": "Signed-in dashboard", "requires": "sign-in" } ] },
    { "id": "features", "title": "Major flows", "steps": [ ... ] } ] }
```

Actions: `goto`, `click` (exact visible text), `clickMatch` (partial text), `clickSelector`, `openLink` (follow a rendered link's href), `fill` (type, never submit), `expectText`, `expectUrl`, `expectSelected`, `expectCountAtLeast`, `wait`.

## Safety

- **Clicks:** every click is checked against a deny-list (pay, stake, sign in, connect, wallet, submit, join, confirm, claim…) and refused if it matches. A refused click is reported as blocked.
- **Typing:** allowed, but Enter is never pressed.
- **Cloud browser failures:** if the remote browser dies, the run is reported as a cloud problem (`error`), not an app failure, and retried once in a fresh session (PRD TST-08).

## Output

`backend/fixtures/<project>/smoke/`:

- `smoke.json`: every run's facts and an outcome of `passed`, `issues` or `failed`, with reasons
- `<device>/video.mp4`: the recording
- `<device>/smoke-<device>-<step>.jpg`: one screenshot per step

Each step records `at`: its second in the recording. The dashboard uses it to jump the video to that step.

Requests cancelled by our own navigation (`net::ERR_ABORTED`, e.g. Next.js prefetches) are listed under `cancelledRequests` and don't count as failures.

The web app shows this in **Agent judge → Live test**: laptop/phone switch, recording, demo replay steps with ▶ timestamps, major flows, and health.

## Needs

Node 18+, `ffmpeg` with libx264 on the machine running the script.
