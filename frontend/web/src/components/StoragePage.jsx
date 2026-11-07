/*
 * /storage: every file this arena has put on 0G Storage (uploads, demo videos,
 * live-test recordings and screenshots). Records live in the Arkiv database; its
 * "files" index holds each file's root hash. One row per file: root hash, a
 * download from 0G, the file on Storage Scan, the transaction, and Verify.
 */
import { useEffect, useState } from "react";
import { StatusPill } from "@ds/ui.jsx";
import { api, apiUrl, peekApi } from "../lib/api.js";
import { CopyId } from "./ZeroGProof.jsx";
import { API } from "../lib/apiBase.js";

const KIND_LABEL = {
  "demo-video": "Demo videos (our copy)",
  "upload-video": "Uploaded demo videos",
  "upload-image": "Uploaded demo screenshots",
  "live-recording": "Live-test recordings",
  "live-screenshot": "Live-test step screenshots",
};
const ORDER = Object.keys(KIND_LABEL);

const size = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

function Row({ r }) {
  const [check, setCheck] = useState(null);
  async function verify() {
    setCheck("checking");
    try {
      setCheck(await api(`/storage/verify/${r.kind}/${encodeURIComponent(r.id)}`, { method: "POST" }));
    } catch (e) {
      setCheck({ error: e.message });
    }
  }
  return (
    <li className="zgfiles__row">
      <div className="zgfiles__name">
        <span className="t-body-strong">{r.name}</span>
        <span className="t-caption">
          {size(r.size)}
          {r.scope !== "uploads" ? ` · project ${r.scope}` : ""} · {new Date(r.uploadedAt).toLocaleString()}
        </span>
      </div>
      <CopyId value={r.rootHash} label="0G Storage root hash" />
      <div className="zgstore__links">
        <a className="btn btn--secondary btn--sm" href={apiUrl(`/api/storage/blob/${r.rootHash}?download=1`)}>
          Download from 0G
        </a>
        {r.links?.file && (
          <a className="t-caption" href={r.links.file} target="_blank" rel="noreferrer">
            Storage Scan ↗
          </a>
        )}
        {r.links?.tx && (
          <a className="t-caption" href={r.links.tx} target="_blank" rel="noreferrer">
            Transaction ↗
          </a>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={verify} disabled={check === "checking"}>
          {check === "checking" ? "Checking 0G…" : "Verify"}
        </button>
        {check && check !== "checking" && (check.error ? <span className="t-caption">✕ {check.error}</span> : check.match ? <StatusPill tone="success">✓ Matches 0G copy</StatusPill> : <StatusPill tone="danger">✕ Mismatch</StatusPill>)}
      </div>
    </li>
  );
}

export function StoragePage() {
  const [data, setData] = useState(() => peekApi("/storage/records") ?? null);
  const [info, setInfo] = useState(() => peekApi("/storage") ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/storage/records").then(setData, (e) => !peekApi("/storage/records") && setError(e.message));
    api("/storage").then(setInfo, () => {});
  }, []);

  if (error) return <p className="t-body">The 0G Storage file list isn't available: {error}</p>;
  if (!data) return <p className="t-caption">Loading the files on 0G Storage…</p>;
  // Kinds this page doesn't know yet still get listed (under their own name), so the count always adds up.
  const kinds = [...ORDER, ...new Set(data.records.map((r) => r.kind).filter((k) => !KIND_LABEL[k]))];
  const groups = kinds.map((k) => [k, data.records.filter((r) => r.kind === k)]).filter(([, rows]) => rows.length);

  return (
    <div className="zgfiles">
      <div className="intro">
        <span className="eyebrow">0G Storage</span>
        <h1 className="t-display-lg m0">Every file the arena stored on 0G</h1>
        <p className="t-body m0">
          Demo videos, uploaded screenshots and the live test's recordings and screenshots are stored on 0G Storage on {data.network}; the records (submissions, reviews, dossiers, brackets) are in the
          Arkiv database. Download any file straight from the 0G storage nodes, open it on Storage Scan, or press Verify to re-download it and check its hash.
        </p>
      </div>
      <div className="zgstore">
        <div className="zgpanel__head">
          <StatusPill tone={info?.enabled ? "success" : "neutral"}>{info?.enabled ? "✓ Files go to 0G Storage" : "0G Storage not set up"}</StatusPill>
          <span className="t-caption">
            {data.records.length} files{info?.outbox?.pending ? ` · ${info.outbox.pending} uploading` : ""}
            {info?.outbox?.failed ? ` · ${info.outbox.failed} failed` : ""}
          </span>
        </div>
      </div>
      {groups.map(([kind, rows]) => (
        <section key={kind} className="zgfiles__group">
          <h2 className="t-heading m0">
            {KIND_LABEL[kind] ?? kind} <span className="t-caption">({rows.length})</span>
          </h2>
          <ul className="zgfiles__list">
            {rows.map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
