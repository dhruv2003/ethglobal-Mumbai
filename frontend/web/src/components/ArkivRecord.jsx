/*
 * The judged result as it lives on Arkiv: read back from Arkiv (through the API),
 * not from the local store. Shows the panel score and each judge's score on chain,
 * when the record expires, links to check every entity in the Arkiv explorer, and
 * the evidence files on Swarm. Renders nothing until something is published.
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { CopyId } from "./ZeroGProof.jsx";

export function ArkivRecord({ projectId, ranAt }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    let tries = 0;
    let timer;
    const load = async () => {
      try {
        const r = await api(`/projects/${encodeURIComponent(projectId)}/arkiv`);
        if (!live) return;
        setData(r);
        // A fresh run publishes in the background: look again until this run is on chain.
        const fresh = r.onchain?.panel?.runAt && ranAt && new Date(r.onchain.panel.runAt) >= new Date(ranAt.slice(0, 19) + "Z");
        if ((r.publishing || (r.configured.write && !fresh)) && tries++ < 20) timer = setTimeout(load, 5000);
      } catch {
        /* backend offline: show nothing */
      }
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, ranAt]);

  const p = data?.onchain?.panel;
  if (!p) return data?.error ? <span className="t-caption">{data.error}</span> : null;
  const s = data.onchain.swarm;
  const files = s && [
    ["Full review", s.review],
    ["Dossier", s.dossier],
    ["Live-test report", s.liveTest],
    ["Laptop recording", s.laptopVideo],
    ["Phone recording", s.phoneVideo],
  ].filter(([, url]) => url);

  return (
    <div className="zgpanel" aria-label="Published on Arkiv">
      <div className="zgpanel__head">
        <span className="t-label">Published on Arkiv</span>
        <span className="t-caption">
          Panel {p.panelScore} · {data.onchain.scorecards.length} scorecards · read-only · expires {new Date(p.expiresAt).toLocaleDateString()}
        </span>
      </div>
      <CopyId value={p.entityKey} label="Arkiv entity key" />
      <ul className="zgtrace__list">
        {data.onchain.scorecards.map((c) => (
          <li key={c.entityKey}>
            <span className="t-caption">
              {c.judgeName}: {c.overall ?? c.status} ·{" "}
              <a href={c.explorer} target="_blank" rel="noreferrer">
                check on Arkiv
              </a>
            </span>
          </li>
        ))}
      </ul>
      <span className="t-caption">
        <a href={p.explorer} target="_blank" rel="noreferrer">
          Open the panel entity in the Arkiv explorer
        </a>
      </span>
      {files?.length > 0 && (
        <span className="t-caption">
          Evidence on Swarm:{" "}
          {files.map(([label, url], i) => (
            <span key={label}>
              {i > 0 && " · "}
              <a href={url} target="_blank" rel="noreferrer">
                {label}
              </a>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
