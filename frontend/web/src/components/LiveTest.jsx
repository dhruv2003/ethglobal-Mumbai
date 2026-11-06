/*
 * Live test: the project's real app on cloud browsers (laptop + phone), recorded.
 * 1. Demo replay  - did the screens shown in the demo really exist?  (shown first)
 * 2. Major flows  - do the main features work without an account?
 * 3. Health       - load, errors, layout
 * Each step links to its moment in the recording. Statuses always carry words.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { StatusPill } from "@ds/ui.jsx";

const OUTCOME = {
  passed: { tone: "success", word: "✓ Passed" },
  issues: { tone: "neutral", word: "! Issues found" },
  failed: { tone: "danger", word: "✕ Failed" },
  error: { tone: "neutral", word: "Couldn't run" },
};
const STEP = {
  passed: { mark: "✓", cls: "good", word: "Works" },
  failed: { mark: "✕", cls: "bad", word: "Broken" },
  blocked: { mark: "–", cls: "skip", word: "Can't run in a browser" },
  missing: { mark: "?", cls: "bad", word: "Not found on the live site" },
};
const NEEDS = { "android-device": "an Android phone", "2x-android-device": "two Android phones", nfc: "NFC", wallet: "a wallet", "sign-in": "an account" };
/** "Needs android-device,nfc; not run." -> "Needs an Android phone + NFC" */
const needsText = (detail) =>
  "Needs " +
  detail
    .replace(/^Needs /, "")
    .replace(/; not run\.$/, "")
    .split(/\s*,\s*/)
    .map((x) => NEEDS[x] ?? x.replace(/-/g, " "))
    .join(" + ");
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const count = (steps, st) => steps.filter((s) => s.status === st).length;

function PhaseLine({ phase, noun }) {
  const ok = count(phase.steps, "passed");
  const bad = count(phase.steps, "failed") + count(phase.steps, "missing");
  const skip = count(phase.steps, "blocked");
  const checkable = ok + bad;
  return (
    <div className="phase-line">
      <span className={`fact__mark fact__mark--${bad ? "bad" : "good"}`} aria-hidden="true">
        {bad ? "!" : "✓"}
      </span>
      <div>
        <span className="t-body-strong">{phase.title}</span>
        <span className="t-caption">
          {" "}
          {ok} of {checkable} {noun}
          {count(phase.steps, "failed") ? ` · ${count(phase.steps, "failed")} broken` : ""}
          {count(phase.steps, "missing") ? ` · ${count(phase.steps, "missing")} not on the live site` : ""}
          {skip ? ` · ${skip} can't run in a browser` : ""}
        </span>
      </div>
    </div>
  );
}

function Steps({ steps, onSeek, demo }) {
  return (
    <ol className="steps">
      {steps.map((s) => {
        const st = STEP[s.status] ?? STEP.failed;
        return (
          <li key={s.id} className={`step step--${st.cls}`}>
            <span className={`step__mark step__mark--${st.cls}`} aria-hidden="true">
              {st.mark}
            </span>
            <div className="step__text">
              <span className="t-body">{s.title}</span>
              <span className="t-caption">
                {s.status === "blocked" && s.detail?.startsWith("Needs ") ? needsText(s.detail) : st.word}
                {demo && s.demoAt ? ` · at ${s.demoAt} in their demo` : ""}
                {s.status === "failed" && s.detail ? ` · ${s.detail}` : ""}
              </span>
            </div>
            {s.status !== "blocked" && s.at != null && (
              <button type="button" className="step__seek t-mono-caption" onClick={() => onSeek(s.at)} aria-label={`Play recording from ${fmt(s.at)}`}>
                ▶ {fmt(s.at)}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Sample projects carry their live test in the bundle; submitted projects load
 * it from the API (refreshing while their review is running).
 */
export function LiveTest({ project, pending = false }) {
  const [remote, setRemote] = useState(null);
  useEffect(() => {
    if (project.liveTest || project.kind !== "submitted") return undefined;
    let alive = true;
    let timer;
    const load = async () => {
      const r = await api(`/projects/${encodeURIComponent(project.id)}/live`).catch(() => null);
      if (!alive) return;
      if (r?.liveTest) {
        const base = `/api/projects/${encodeURIComponent(project.id)}/live/files`;
        setRemote({
          ...r.liveTest,
          runs: r.liveTest.runs.map((run) => ({
            ...run,
            videoUrl: run.video ? `${base}/${run.video.file}` : null,
            posterUrl: run.phases?.[0]?.steps?.find((x) => x.screenshot)?.screenshot ? `${base}/${run.phases[0].steps.find((x) => x.screenshot).screenshot}` : null,
          })),
        });
      } else if (pending) timer = setTimeout(load, 8000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.kind, project.liveTest, pending]);
  return <LiveTestView liveTest={project.liveTest ?? remote} />;
}

function LiveTestView({ liveTest }) {
  const runs = liveTest?.runs ?? [];
  const [device, setDevice] = useState(runs[0]?.device);
  const videoRef = useRef(null);
  if (!runs.length) return null;
  const r = runs.find((x) => x.device === device) ?? runs[0];
  const outcome = OUTCOME[r.outcome?.status] ?? OUTCOME.issues;
  const demo = r.phases?.find((p) => p.id === "demo");
  const flows = r.phases?.find((p) => p.id === "features");
  const apis = [...new Set(r.failedRequests.map((f) => `${new URL(f.url).pathname}${f.status ? ` (${f.status})` : ""}`))];

  const seek = (t) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t - 0.5);
    v.play().catch(() => {});
    v.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

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
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`live__body live__body--${r.device}`}>
        <div className={`live__screen live__screen--${r.device}`}>
          {r.videoUrl ? (
            <video ref={videoRef} key={r.videoUrl} src={r.videoUrl} poster={r.posterUrl ?? undefined} controls muted playsInline preload="metadata" aria-label={`${r.label} test recording`} />
          ) : (
            <p className="t-body m0">No recording for this run.</p>
          )}
        </div>
        <div className="stack">
          <StatusPill tone={outcome.tone}>
            {outcome.word} on {r.label.toLowerCase()}
          </StatusPill>
          {demo && <PhaseLine phase={demo} noun="demo screens found" />}
          {flows && <PhaseLine phase={flows} noun="flows work" />}
          <div className="phase-line">
            <span className={`fact__mark fact__mark--${apis.length || r.consoleErrors.length ? "bad" : "good"}`} aria-hidden="true">
              {apis.length || r.consoleErrors.length ? "!" : "✓"}
            </span>
            <div>
              <span className="t-body-strong">Health</span>
              <span className="t-caption">
                {" "}
                Home {r.home?.status} in {((r.home?.loadMs ?? r.home?.wallMs ?? 0) / 1000).toFixed(1)} s
                {r.home?.horizontalScroll ? " · scrolls sideways" : " · fits the screen"}
              </span>
              {apis.length > 0 && <div className="t-caption">Server errors: {apis.map((a) => <code key={a} className="t-mono-caption">{a} </code>)}</div>}
            </div>
          </div>
          <p className="t-mono-caption m0">
            Chrome {r.browserVersion?.split(".")[0]} · {r.viewport.width}×{r.viewport.height} · {r.video ? `${fmt(r.video.seconds)} recording` : "no video"}
            {r.retriedAfter ? " · retried once after a cloud browser error" : ""}
          </p>
        </div>
      </div>

      {demo && (
        <div className="stack-xs">
          <span className="t-label">Demo replay: does the app match what the demo showed?</span>
          <Steps steps={demo.steps} onSeek={seek} demo />
        </div>
      )}
      {flows && (
        <details className="flows">
          <summary>
            <span className="t-label">Major flows</span>
            <span className="t-caption">
              {count(flows.steps, "passed")} work · {count(flows.steps, "failed")} broken · {count(flows.steps, "blocked")} can't run here
            </span>
          </summary>
          <Steps steps={flows.steps} onSeek={seek} />
        </details>
      )}
      <p className="t-caption m0">Never signs in, connects a wallet, stakes or pays. Steps that need an account, a wallet or a phone app are marked, not faked.</p>
    </section>
  );
}
