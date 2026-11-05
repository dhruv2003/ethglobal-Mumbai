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

- One page, six sections (Team, Project, Tracks, Code, Demo, Review) with a sticky nav that shows each section's status in words.
- **Connect wallet** uses MetaMask directly (`window.ethereum`). The connected address becomes the owner wallet, and the reward wallet defaults to it.
- **Submit** asks MetaMask to sign a message (no gas). The signature proves the owner wallet made the submission (PRD SUB-04).
- Drafts autosave to this browser every half second. Files are not kept in drafts.
- Teams pick 0 to 3 sponsor tracks. Every project is also in the finalist competition (PRD SUB-06).

## Where things live

| File | What it is |
| --- | --- |
| `src/config/event.js` | Event settings: **network and track list are placeholders**, upload limits |
| `src/lib/validate.js` | Every validation rule, pure and tested |
| `src/lib/storage.js` | Drafts, and `saveSubmission()`: **the one function to replace with the DB/API call** |
| `src/lib/wallet.js` | MetaMask hook: connect, switch network, sign |
| `src/lib/files.js` | Upload checks; raw `File` objects wait in `fileStore` for the upload step |
| `src/sections/` | One component per form section |

## Design system

Styles come straight from `../design-system/src` through the `@ds` alias (see `vite.config.js`). Don't copy them in. App styles in `src/app.css` use tokens only.

## Not done yet

- Database and file upload (`saveSubmission`, `fileStore`)
- GitHub ownership check (PRD SUB-03)
- Real event network and track list
