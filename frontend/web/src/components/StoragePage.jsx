/*
 * /storage: everything this arena has put on 0G Storage. One row per record
 * (submissions, judge panel, reviews, evidence, voice notes, sample-project files),
 * each with its root hash, a download straight from 0G (?fresh=1 skips the
 * server's cache), the file on Storage Scan, the transaction, and Verify.
 */
import { useEffect, useState } from "react";
import { StatusPill } from "@ds/ui.jsx";
import { api } from "../lib/api.js";
import { CopyId } from "./ZeroGProof.jsx";

const KIND_LABEL = {
  submission: "Submissions",
  judges: "Judge panel",
  review: "Panel reviews",
  evidence: "Screenshot evidence",
  "voice-note": "Voice-note transcripts",
  "voice-audio": "Voice-note audio (encrypted)",
  "evidence-bundle": "Sample evidence bundles",
  "fixture-file": "Sample project files",
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
        <span className="t-body-strong">{r.id}</span>
        <span className="t-caption">
          {size(r.size)}
          {r.history.length > 1 ? ` · version ${r.history.length}` : ""}
          {r.encrypted ? " · AES-256 encrypted" : ""} · {new Date(r.uploadedAt).toLocaleString()}
        </span>
      </div>
      <CopyId value={r.rootHash} label="0G Storage root hash" />
      <div className="zgstore__links">
        <a className="btn btn--secondary btn--sm" href={`/api/storage/blob/${r.rootHash}?fresh=1&download=1`}>
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
  const [data, setData] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/storage/records").then(setData, (e) => setError(e.message));
    api("/storage").then(setInfo, () => {});
  }, []);

  if (error) return <p className="t-body">0G Storage records aren't available: {error}</p>;
  if (!data) return <p className="t-caption">Loading 0G Storage records…</p>;
  const groups = ORDER.map((k) => [k, data.records.filter((r) => r.kind === k)]).filter(([, rows]) => rows.length);

  return (
    <div className="zgfiles">
      <div className="intro">
        <span className="eyebrow">0G Storage</span>
        <h1 className="t-display-lg m0">Everything the arena stored on 0G</h1>
        <p className="t-body m0">
          Every submission, judge panel, review and piece of evidence is uploaded to 0G Storage on {data.network}. Download any of them straight from the 0G storage nodes, open the file on Storage Scan,
          or press Verify to re-download it and compare it with the copy this server serves.
        </p>
      </div>
      <div className="zgstore">
        <div className="zgpanel__head">
          <StatusPill tone={info?.enabled ? "success" : "neutral"}>{info?.enabled ? "✓ Archiving to 0G Storage" : "0G Storage off"}</StatusPill>
          <span className="t-caption">
            {data.records.length} records{info?.outbox?.pending ? ` · ${info.outbox.pending} waiting to upload` : ""}
            {info?.outbox?.failed ? ` · ${info.outbox.failed} failed` : ""}
          </span>
        </div>
        {data.head?.rootHash && (
          <div className="zgstore__row">
            <span className="t-label">Head manifest (rebuild everything from this one hash)</span>
            <CopyId value={data.head.rootHash} label="head manifest root hash" />
            <div className="zgstore__links">
              <a className="btn btn--secondary btn--sm" href={`/api/storage/blob/${data.head.rootHash}?fresh=1&download=1`}>
                Download manifest from 0G
              </a>
            </div>
          </div>
        )}
      </div>
      {groups.map(([kind, rows]) => (
        <section key={kind} className="zgfiles__group">
          <h2 className="t-heading m0">
            {KIND_LABEL[kind]} <span className="t-caption">({rows.length})</span>
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
