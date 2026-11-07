# Tester: live check on cloud browsers

Opens a project's live app on Mozark cloud Chrome as a **laptop** (1440×900) and a **phone** (390×844, touch, iPhone user agent), records each session, and runs three phases:

1. **Demo replay:** the screens the team's demo video shows. Proves the demo wasn't faked: a screen the demo shows but the live app doesn't have fails here.
2. **Major flows:** the app's main features, exercised without an account.
3. **Health:** status, load time, console errors, failed requests, layout.

4. **Wallet (MetaMask)**, for dapps only (the site shows a connect-wallet button): connect, then use the app's on-chain features.

The steps come from `backend/fixtures/<project>/flows.json`, written by the reviewer from the demo video and the code. Steps marked `requires` (sign-in, wallet) are reported as blocked, never faked.

## Wallet phase

Real MetaMask is a browser extension, and Mozark's remote Chrome can't load extensions (Synpress and similar tools need a locally launched browser). So every page gets a **MetaMask-compatible test wallet** (`wallet.mjs`): an injected EIP-1193 provider with `isMetaMask` and an EIP-6963 announcement, so wallet pickers (RainbowKit, ConnectKit, Reown/AppKit, wagmi) list it as "MetaMask".

- A fresh throwaway key per run, kept in Node; the page only gets a forwarding function.
- Connects, switches between the chains in `chains.mjs`, and really signs messages and typed data (Sign-In with Ethereum works).
- `eth_sendTransaction` is **simulated** (`eth_call` + `eth_estimateGas` on a public RPC), recorded, then rejected with 4001. Nothing is ever broadcast.
- In the wallet phase, money words (mint, stake, approve…) may be clicked; submit, delete, sign-up and card payment stay refused.
- Actions: `connectWallet` (press the site's connect button, pick MetaMask) and `expectWallet: "connected" | "signature" | "transaction"`.

Each run records `wallet` (address, chains, every request with its second in the recording) and each step its `walletEvents`.

## Local browser (development)

`TESTER_LOCAL_BROWSER=1` runs on a local headless Chromium instead of Mozark (no token needed); add `TESTER_LOCAL_CHANNEL=chrome` to use an installed Chrome instead of `npx playwright install chromium`.

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
