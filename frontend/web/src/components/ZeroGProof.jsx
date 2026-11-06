/*
 * Proof that a model call ran on 0G: the request ID (copyable), the provider
 * address and the cost the Router reported. Everything has a text label; colour
 * is never the only signal. We only say "TEE verified" when 0G itself reported
 * tee_verified: true for that call (whisper does; 0gm chat currently doesn't).
 *
 * StorageProof: where a record lives on 0G Storage (root hash, tx link) and a
 * Verify button that re-downloads it from 0G and compares it with ours.
 */
import { useEffect, useState } from "react";
import { StatusPill } from "@ds/ui.jsx";
import { api } from "../lib/api.js";

/** Micro-dollars -> "$0.0110". Small runs need four decimals to show anything. */
export const usd = (micro) => (Number.isFinite(micro) ? `$${(micro / 1e6).toFixed(micro < 10_000 ? 5 : 4)}` : "not reported");
const shortAddr = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function CopyId({ value, label = "0G request ID" }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the ID is still selectable */
    }
  }
  return (
    <span className="zgid">
      <code className="t-mono-caption zgid__value" title={value}>
        {value}
      </code>
      <button type="button" className="btn btn--ghost btn--sm zgid__copy" onClick={copy} aria-label={`Copy ${label} ${value}`}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </span>
  );
}

/** One judge's 0G calls: one line per attempt (a repair makes two). */
export function JudgeTraces({ traces }) {
  if (!traces?.length) return null;
  return (
    <div className="zgtrace">
      <span className="t-label">Ran on 0G</span>
      <ul className="zgtrace__list">
        {traces.map((t, i) => (
          <li key={t.requestId ?? i}>
            <span className="t-caption">
              {traces.length > 1 ? (i === 0 ? "First attempt · " : "Repair · ") : ""}
              {t.model}
              {t.provider ? (
                <>
                  {" · provider "}
                  <span className="t-mono-caption" title={t.provider}>
                    {shortAddr(t.provider)}
                  </span>
                </>
              ) : null}
              {" · "}
              {usd(t.costUsdMicro)}
            </span>
            <CopyId value={t.requestId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Panel-level proof: where it ran, how many calls, the total cost, every request ID. */
export function PanelProof({ result }) {
  const z = result?.zg;
  if (result?.provider !== "0g" || !z) return null;
  return (
    <div className="zgpanel">
      <div className="zgpanel__head">
        <StatusPill tone="live">⬢ Ran on 0G Compute Router</StatusPill>
        <span className="t-caption">
          {result.model} · {z.calls} {z.calls === 1 ? "call" : "calls"} · panel cost <span className="t-num t-body-strong">{usd(z.costUsdMicro)}</span>
          {z.evidenceCostUsdMicro ? ` (judges ${usd(z.judgeCostUsdMicro)}, screenshots ${usd(z.evidenceCostUsdMicro)})` : ""}
          {z.uncostedCalls ? ` · ${z.uncostedCalls} without a reported cost` : ""}
        </span>
      </div>
      <details className="zgpanel__ids">
        <summary className="t-caption">All {z.requestIds.length} 0G request IDs</summary>
        <ul className="zgtrace__list">
          {z.requestIds.map((id) => (
            <li key={id}>
              <CopyId value={id} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

const MATCH_WORD = { yes: "✓ Matches step", partly: "◐ Partly matches", no: "✕ Doesn't match", unclear: "? Unclear" };

/** What the vision model saw in each live-test screenshot, with its request ID. */
export function EvidenceList({ evidence }) {
  if (!evidence?.length) return null;
  const ok = evidence.filter((e) => e.observation);
  return (
    <details className="zgevidence">
      <summary className="t-label">
        Screenshot evidence read on 0G ({ok.length} of {evidence.length})
      </summary>
      <p className="t-caption m0">
        A vision model looked at each live-test screenshot{evidence.some((e) => e.cached) ? " in an earlier run (reused here, not paid for again)" : ""}. The judges saw these notes as untrusted evidence and
        could cite them by ID.
      </p>
      <ul className="zgevidence__list">
        {evidence.map((e) => (
          <li key={e.id} className="zgevidence__item">
            <div className="zgevidence__head">
              <span className="t-mono-caption">{e.id}</span>
              <span className="t-caption">{e.stepTitle}</span>
              {e.observation && <span className="t-caption">{MATCH_WORD[e.observation.matchesStep] ?? e.observation.matchesStep}</span>}
            </div>
            {e.observation ? (
              <>
                <span className="t-caption">{e.observation.seen}</span>
                {e.observation.problems?.length > 0 && <span className="t-caption">Problems seen: {e.observation.problems.join("; ")}</span>}
              </>
            ) : (
              <span className="t-caption">✕ Not read: {e.error}</span>
            )}
            {e.trace?.requestId && <CopyId value={e.trace.requestId} />}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** TEE status exactly as 0G reported it for one call. */
export function TeeStatus({ teeVerified }) {
  if (teeVerified === true) return <StatusPill tone="success">✓ TEE verified by 0G</StatusPill>;
  if (teeVerified === false) return <StatusPill tone="danger">✕ TEE check failed</StatusPill>;
  return <StatusPill tone="neutral">No TEE check reported</StatusPill>;
}

/** A run in progress: each 0G call as it answers, then each judge's score. */
export function LiveCalls({ progress }) {
  const events = progress?.events ?? [];
  return (
    <div className="zglive" aria-live="polite">
      <span className="t-label">Live on 0G</span>
      {events.length === 0 ? (
        <span className="t-caption">Waiting for the first judge to answer…</span>
      ) : (
        <ul className="zgtrace__list">
          {events.map((e, i) =>
            e.type === "call" ? (
              <li key={`c${i}`}>
                <span className="t-caption">
                  ⬢ {e.judgeName}
                  {e.attempt > 1 ? " (repair)" : ""} answered · {e.model} · {usd(e.costUsdMicro)}
                </span>
                <CopyId value={e.requestId} />
              </li>
            ) : (
              <li key={`j${i}`}>
                <span className="t-caption">
                  {e.status === "scored" ? `✓ ${e.judgeName} scored ${(e.overallHundredths / 100).toFixed(2)}` : `✕ ${e.judgeName}: ${e.status}`}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

const STORAGE_PILL = {
  pending: { tone: "neutral", text: "◌ Pending upload to 0G Storage" },
  stored: { tone: "success", text: "✓ Stored on 0G Storage" },
  failed: { tone: "danger", text: "✕ 0G Storage upload failed" },
  off: { tone: "neutral", text: "0G Storage off on this server" },
};

/**
 * "Stored on 0G Storage" row for one record (kind: submission | review | ...).
 * Polls while the upload is pending. `initial` is the zgStorage field the API returned.
 */
export function StorageProof({ kind, id, initial }) {
  const [st, setSt] = useState(initial ?? null);
  const [check, setCheck] = useState(null); // null | "checking" | result | { error }
  const status = st?.status;

  useEffect(() => setSt(initial ?? null), [initial?.status, initial?.rootHash]);

  useEffect(() => {
    if (status && status !== "pending") return undefined;
    let live = true;
    const tick = async () => {
      try {
        const r = await api(`/storage/status/${kind}/${encodeURIComponent(id)}`);
        if (live) setSt(r);
      } catch {
        /* backend offline: keep what we have */
      }
    };
    if (!status) tick();
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [kind, id, status]);

  if (!st) return null;
  const pill = STORAGE_PILL[status] ?? STORAGE_PILL.pending;

  async function verify() {
    setCheck("checking");
    try {
      setCheck(await api(`/storage/verify/${kind}/${encodeURIComponent(id)}`, { method: "POST" }));
    } catch (e) {
      setCheck({ error: e.message });
    }
  }

  return (
    <div className="zgstore">
      <div className="zgpanel__head">
        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
        {status === "stored" && st.versions > 1 && <span className="t-caption">version {st.versions}</span>}
        {status === "pending" && st.attempts > 0 && <span className="t-caption">retrying (attempt {st.attempts + 1})</span>}
      </div>
      {status === "failed" && st.error && <span className="t-caption">Reason: {st.error}</span>}
      {status === "pending" && st.error && <span className="t-caption">Last try: {st.error}</span>}
      {st.rootHash && (
        <div className="zgstore__row">
          <span className="t-label">Root hash</span>
          <CopyId value={st.rootHash} label="0G Storage root hash" />
        </div>
      )}
      {st.rootHash && (
        <div className="zgstore__links">
          {st.links?.tx && (
            <a className="t-caption" href={st.links.tx} target="_blank" rel="noreferrer">
              Transaction on 0G Chain ↗
            </a>
          )}
          {st.links?.file && (
            <a className="t-caption" href={st.links.file} target="_blank" rel="noreferrer">
              File on 0G Storage Scan ↗
            </a>
          )}
          <a className="t-caption" href={`/api/storage/blob/${st.rootHash}`} target="_blank" rel="noreferrer">
            Stored copy (JSON) ↗
          </a>
        </div>
      )}
      {status === "stored" && (
        <div className="zgstore__verify" aria-live="polite">
          <button type="button" className="btn btn--secondary btn--sm" onClick={verify} disabled={check === "checking"}>
            {check === "checking" ? "Checking 0G…" : "Verify against 0G"}
          </button>
          {check && check !== "checking" && (check.error ? <span className="t-caption">✕ Couldn't check: {check.error}</span> : check.match ? <StatusPill tone="success">✓ Matches 0G copy</StatusPill> : <StatusPill tone="danger">✕ Mismatch with 0G copy</StatusPill>)}
          {check?.reason && <span className="t-caption">{check.reason}</span>}
        </div>
      )}
    </div>
  );
}
