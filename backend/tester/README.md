# Tester: live smoke check on cloud browsers

Opens a project's live app on Mozark cloud Chrome as a **laptop** (1440×900) and a **phone** (390×844, touch, iPhone user agent), records both, and saves the results where the dashboard picks them up.

## Run

```bash
# once: save the Mozark token (portal → Automation → Playwright Testing → Bearer Token, ~24 h)
read -rs "MOZARK_TOKEN?Paste token: " && export MOZARK_TOKEN && echo
umask 077 && printf 'MOZARK_TOKEN=%s\n' "$MOZARK_TOKEN" > ~/.mozark.env

# each run
cd backend/tester
npm install            # Playwright only; no browsers needed, Mozark provides them
set -a; source ~/.mozark.env; set +a
node smoke.mjs --project go-health-me --url https://www.gohealthme.app
```

Options: `--devices laptop` or `--devices phone` to run one. `MOZARK_PROJECT_ID` overrides the hub project.

## What it does (read-only)

1. Loads the URL, waits for the network to settle, reads status, load time, title, sideways scroll, broken images.
2. Scrolls to the bottom and back.
3. Visits up to 3 same-site links (skips sign-in, wallet, API and file links).
4. Never clicks buttons or fills forms: no sign-ins, wallets or payments.

Recording comes from Chrome's screencast over CDP, stitched with `ffmpeg` at real timing. Mozark also keeps its own video and logs per session (portal → Automation → Sessions).

## Output

`backend/fixtures/<project>/smoke/`:

- `smoke.json`: every run's facts and an outcome of `passed`, `issues` or `failed`, with reasons
- `<device>/video.mp4`: the recording
- `<device>/smoke-<device>-*.png`: home, bottom and each visited page

Requests cancelled by our own navigation (`net::ERR_ABORTED`, e.g. Next.js prefetches) are listed under `cancelledRequests` and don't count as failures.

The web app shows this in **Agent judge → Live test** (laptop/phone switch, video, key facts).

## Needs

Node 18+, `ffmpeg` with libx264 on the machine running the script.
