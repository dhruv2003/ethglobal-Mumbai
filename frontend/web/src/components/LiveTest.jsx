/*
 * Live test: the project's real app, opened on cloud browsers (laptop + phone),
 * recorded. Results are facts in words; the video is the evidence.
 */
import { useState } from "react";
import { StatusPill } from "@ds/ui.jsx";

const OUTCOME = {
  passed: { tone: "success", word: "✓ Passed" },
  issues: { tone: "neutral", word: "! Issues found" },
  failed: { tone: "danger", word: "✕ Failed" },
};

function Fact({ label, value, good }) {
  return (
    <div className="fact">
      <dt className="t-caption">{label}</dt>
      <dd className="t-body-strong">
        <span className={`fact__mark ${good ? "fact__mark--good" : "fact__mark--bad"}`} aria-hidden="true">
          {good ? "✓" : "!"}
        </span>
        {value}
      </dd>
    </div>
  );
}

export function LiveTest({ liveTest }) {
  const runs = liveTest?.runs ?? [];
  const [device, setDevice] = useState(runs[0]?.device);
  if (!runs.length) return null;
  const r = runs.find((x) => x.device === device) ?? runs[0];
  const pagesOk = (r.pages ?? []).filter((p) => p.status && p.status < 400).length;
  const outcome = OUTCOME[r.outcome?.status] ?? OUTCOME.issues;
  const ranAt = new Date(liveTest.ranAt);

  return (
    <section className="card stack live rise" style={{ "--i": 1 }} aria-labelledby="live-h">
      <div className="verdict__head">
        <div className="stack-xs">
          <span className="t-label" id="live-h">
            Live test on cloud browsers
          </span>
          <a className="t-mono-caption ref" href={liveTest.target} target="_blank" rel="noreferrer">
            {liveTest.target.replace(/^https:\/\//, "")} ↗
          </a>
        </div>
        <div className="chips" role="group" aria-label="Device">
          {runs.map((x) => (
            <button key={x.device} type="button" className="chip" aria-pressed={x.device === r.device} onClick={() => setDevice(x.device)}>
              {x.label} <span className="chip__count">{OUTCOME[x.outcome?.status]?.word.slice(0, 1)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`live__body live__body--${r.device}`}>
        <div className={`live__screen live__screen--${r.device}`}>
          {r.videoUrl ? (
            <video key={r.videoUrl} src={r.videoUrl} poster={r.posterUrl ?? undefined} controls muted playsInline preload="metadata" aria-label={`${r.label} test recording`} />
          ) : (
            <p className="t-body m0">No recording for this run.</p>
          )}
        </div>
        <div className="stack">
          <StatusPill tone={outcome.tone}>
            {outcome.word} on {r.label.toLowerCase()}
          </StatusPill>
          <dl className="facts-grid">
            <Fact label="Home page" value={`${r.home?.status ?? "no response"} in ${((r.home?.loadMs ?? r.home?.wallMs ?? 0) / 1000).toFixed(1)} s`} good={r.home?.status < 400} />
            <Fact label="Linked pages" value={`${pagesOk} of ${(r.pages ?? []).length} load`} good={pagesOk === (r.pages ?? []).length} />
            <Fact label="Console errors" value={r.consoleErrors.length} good={!r.consoleErrors.length} />
            <Fact label="Failed requests" value={r.failedRequests.length} good={!r.failedRequests.length} />
            <Fact label="Fits the screen" value={r.home?.horizontalScroll ? "Scrolls sideways" : "Yes"} good={!r.home?.horizontalScroll} />
            <Fact label="Broken images" value={r.home?.brokenImages ?? 0} good={!r.home?.brokenImages} />
          </dl>
          {r.outcome?.reasons?.length > 0 && <p className="t-caption m0">{r.outcome.reasons.join(" · ")}</p>}
          <p className="t-mono-caption m0">
            Chrome {r.browserVersion?.split(".")[0]} · {r.viewport.width}×{r.viewport.height} · {r.video ? `${Math.round(r.video.seconds)} s recording` : "no video"} · {ranAt.toLocaleString()}
          </p>
        </div>
      </div>
      <p className="t-caption m0">Read-only: loads the app, scrolls, visits up to 3 of its pages. It never signs in, connects a wallet or pays.</p>
    </section>
  );
}
