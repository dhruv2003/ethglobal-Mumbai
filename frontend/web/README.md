# Web app: project submission

The page where a team enters its project (`PRD.md` sections 5 and 12.3). It's an installable PWA.

## Run it

```bash
cd frontend/web
npm install
npm run dev      # http://localhost:5173
npm test         # validation tests
npm run build && npm run preview   # test the PWA (service worker only runs on the build)
```

Needs Node 18+. MetaMask must be installed in the browser. On a phone without it, the button opens the page inside MetaMask's browser.

## What it does

- One card, seven fields: team name, project name, short pitch, what it does and how it's built, GitHub repo, demo video link, and 0 to 3 sponsor tracks (every project is also in the finalist competition, PRD SUB-06).
- **Connect wallet** uses MetaMask directly (`window.ethereum`). The connected wallet owns the entry and receives the project's rewards.
- **Submit** asks MetaMask to sign a message (no gas). The signature proves the owner wallet made the submission (PRD SUB-04).
- Drafts autosave to this browser.

## Where things live

| File | What it is |
| --- | --- |
| `src/config/event.js` | Event settings: **network and track list are placeholders** |
| `src/lib/validate.js` | Every validation rule, pure and tested |
| `src/lib/storage.js` | Drafts, and `saveSubmission()`: **the one function to replace with the DB/API call** |
| `src/lib/wallet.js` | MetaMask hook: connect, switch network, sign |
| `src/components/SubmissionForm.jsx` | The form |

## Design system

Styles come straight from `../design-system/src` through the `@ds` alias (see `vite.config.js`). Don't copy them in. App styles in `src/app.css` use tokens only.

## Not done yet

- Database (`saveSubmission`)
- GitHub ownership check (PRD SUB-03)
- Real event network and track list
