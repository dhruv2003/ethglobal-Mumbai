import { StatusPill } from "@ds/ui.jsx";
import { shortAddress } from "../lib/wallet.js";

/** The one sticker moment on this screen. */
export function Success({ record, onStartOver }) {
  function download() {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `submission-${record.id}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="success">
      <div className="card card--sticker success__card">
        <StatusPill tone="success">✓ Submitted</StatusPill>
        <h1 className="t-display-lg m0">{record.project.name} is in</h1>
        <p className="t-body m0">
          Next we fetch your repo, pin the commit and build your fighter's dossier. You can still edit until freeze.
        </p>
        <dl className="success__meta">
          <div>
            <dt className="t-label">Team</dt>
            <dd className="t-body">{record.team.name}</dd>
          </div>
          <div>
            <dt className="t-label">Tracks</dt>
            <dd className="t-body">{record.tracks.length ? `Finalist + ${record.tracks.length}` : "Finalist"}</dd>
          </div>
          <div>
            <dt className="t-label">Owner</dt>
            <dd className="t-mono">{shortAddress(record.team.ownerWallet)}</dd>
          </div>
        </dl>
        <p className="t-mono-caption m0">
          id {record.id} · signed {new Date(record.auth.issuedAt).toLocaleString()}
        </p>
      </div>
      <div className="success__actions">
        <button type="button" className="btn btn--secondary" onClick={download}>
          Download a copy
        </button>
        <button type="button" className="btn btn--ghost" onClick={onStartOver}>
          Enter another project
        </button>
      </div>
    </div>
  );
}
