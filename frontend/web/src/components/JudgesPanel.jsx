/*
 * Each judge's score and comment on a project. Reads the latest review from
 * the backend; falls back to the review stored with a sample project when the
 * backend is offline. Scores are integer hundredths computed by the backend.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { api, health } from "../lib/api.js";
import { useCountUp } from "../lib/motion.js";
import { Ring } from "./Arena.jsx";
import { judgeAsFighter } from "./JudgesPage.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { EvidenceList, JudgeTraces, LiveCalls, PanelProof } from "./ZeroGProof.jsx";

const LABELS = {
  product_journey: "Product journey",
  real_world_value: "Real-world value",
  ui_ux: "UI / UX",
  code_quality: "Code quality",
  sdlc: "SDLC practices",
  feasibility: "Feasibility",
  scalability: "Scalability",
  business_model: "Business model",
  brownie_points: "Brownie points",
};
const pts = (h) => (h / 100).toFixed(2);
const STATUS_WORD = { declined: "Declined to review", invalid: "Review rejected (bad format)", error: "Couldn't run" };

function Score({ hundredths, big }) {
  const v = useCountUp(Math.round(hundredths));
  return (
    <span className={`jscore t-num ${big ? "jscore--big" : ""}`}>
      {pts(v)}
      <span className="jscore__of">/100</span>
    </span>
  );
}

function JudgeCard({ r, i }) {
  const j = r.judge;
  if (r.status !== "scored") {
    return (
      <article className="card jcard rise" style={{ "--i": i }}>
        <div className="jcard__who">
          <Ring compact className="jcard__ring">
            <PixelFighter project={judgeAsFighter(j)} scale={3} label={`${j.name}, judge`} />
          </Ring>
          <div>
            <span className="t-body-strong">{j.name}</span>
            <span className="t-caption jcard__title">{j.title}</span>
          </div>
        </div>
        <StatusPill tone="neutral">{STATUS_WORD[r.status] ?? r.status}</StatusPill>
        <p className="t-caption m0">{r.detail} No score was invented.</p>
        <JudgeTraces traces={r.traces} />
      </article>
    );
  }
  const rv = r.review;
  const rows = rv.criteria.map((c) => ({ ...c, w: j.weights?.[c.id] ?? 0 })).sort((a, b) => b.w - a.w);
  return (
    <article className="card jcard rise" style={{ "--i": i }}>
      <div className="jcard__who">
        <Ring compact className="jcard__ring">
          <PixelFighter project={judgeAsFighter(j)} scale={3} label={`${j.name}, judge`} />
        </Ring>
        <div className="jcard__name">
          <span className="t-body-strong">{j.name}</span>
          <span className="t-caption jcard__title">{j.title}</span>
        </div>
        <Score hundredths={r.overallHundredths} />
      </div>
      <p className="t-body-strong m0">{rv.headline}</p>
      <p className="t-body m0 jcard__comment">{rv.comment}</p>
      {rv.dealBreakerHit && <StatusPill tone="danger">✕ Deal-breaker: {rv.dealBreakerNote}</StatusPill>}
      <JudgeTraces traces={r.traces} />
      <details className="jcard__more">
        <summary className="t-label">How {j.name.split(" ")[0]} scored each part</summary>
        <ul className="crit">
          {rows.map((c) => (
            <li key={c.id}>
              <div className="crit__head">
                <span className="t-caption">
                  <span className="t-body-strong">{LABELS[c.id]}</span> · counts {c.w}%
                </span>
                <span className="t-caption t-num">{c.score}</span>
              </div>
              <span className="crit__track" aria-hidden="true">
                <motion.span initial={{ width: 0 }} whileInView={{ width: `${c.score}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
              </span>
              <span className="t-caption">{c.comment}</span>
            </li>
          ))}
        </ul>
        <p className="t-mono-caption m0">
          {rv.certainty} certainty · persona v{j.version} · {Math.round((r.ms ?? 0) / 1000)} s
        </p>
      </details>
    </article>
  );
}

export function JudgesPanel({ project }) {
  const [state, setState] = useState({ loading: true });
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const path = `/projects/${encodeURIComponent(project.id)}/reviews`;

  useEffect(() => {
    let live = true;
    (async () => {
      const h = await health();
      let result = null;
      let running = false;
      let progress = null;
      if (h) {
        try {
          const r = await api(path);
          result = r.result;
          running = r.running;
          progress = r.progress;
        } catch {
          /* keep the stored one */
        }
      }
      if (live) setState({ loading: false, health: h, result: result ?? project.reviews ?? null, running, progress });
    })();
    return () => {
      live = false;
    };
  }, [path, project.reviews]);

  // While a run is going, poll so each 0G request ID shows up as soon as that judge's call answers.
  useEffect(() => {
    if (!state.running) return undefined;
    let live = true;
    const tick = async () => {
      try {
        const r = await api(path);
        if (!live) return;
        setState((s) => ({ ...s, running: r.running, progress: r.progress, result: r.running ? s.result : (r.result ?? s.result) }));
        if (!r.running && r.progress?.error) setError(r.progress.error);
      } catch {
        /* try again next tick */
      }
    };
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [state.running, path]);

  // Anyone may re-judge a sample project on 0G; other projects need the organizer key.
  const isPublic = project.kind === "sample" && state.health?.provider === "0g";

  async function ask() {
    setAsking(true);
    setError("");
    try {
      if (isPublic) {
        const r = await api(`${path}/public`, { method: "POST" });
        setState((s) => ({ ...s, running: true, progress: r.progress }));
      } else {
        const r = await api(path, { method: "POST" });
        setState((s) => ({ ...s, result: r.result, running: false }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAsking(false);
    }
  }

  if (state.loading) return null;
  const { result, health: h } = state;
  const busy = asking || state.running;

  return (
    <section className="card stack judges rise" style={{ "--i": 1 }} aria-labelledby="judges-h">
      <div className="verdict__head">
        <div className="stack-xs">
          <span className="t-label" id="judges-h">
            Judges' panel
          </span>
          {result && (
            <span className="t-caption">
              {result.reviews.filter((r) => r.status === "scored").length} of {result.reviews.length} judges scored · {new Date(result.ranAt).toLocaleString()}
            </span>
          )}
        </div>
        {result?.panelHundredths != null && (
          <div className="judges__panel">
            <span className="t-caption">Panel average</span>
            <Score hundredths={result.panelHundredths} big />
          </div>
        )}
      </div>

      {busy && (
        <div className="judges__busy" role="status">
          <div className="judges__thinking" aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <span key={k} style={{ "--k": k }} />
            ))}
          </div>
          <span className="t-body">
            The judges are reading the dossier and the live test{h?.provider === "0g" ? " on 0G" : ""}. This takes a minute or two.
          </span>
        </div>
      )}
      {state.running && <LiveCalls progress={state.progress} />}

      <PanelProof result={result} />

      {result ? (
        <div className="jcards">
          {result.reviews.map((r, i) => (
            <JudgeCard key={r.judge.id} r={r} i={i} />
          ))}
        </div>
      ) : (
        !busy && <p className="t-body m0">No judge has reviewed {project.name} yet.</p>
      )}

      <EvidenceList evidence={result?.evidence} />

      {error && <span className="field__error">✕ {error}</span>}
      <div className="judges__foot">
        {!h ? (
          <span className="t-caption">Judge service offline. Showing the last stored review{result ? "" : " (none yet)"}.</span>
        ) : !h.judgesReady ? (
          <span className="t-caption">
            Add <code className="t-mono-caption">{h.keyName ?? "an API key"}</code> ({h.providerLabel ?? h.provider}) to the backend to let the judges score projects.
          </span>
        ) : (
          <div className="judges__ask">
            <button type="button" className="btn btn--oracle btn--sm" onClick={ask} disabled={busy}>
              {busy ? "Judging on 0G…" : isPublic ? "Watch the judges score this on 0G" : result ? "Ask the judges again" : "Ask the judges"}
            </button>
            {isPublic && !busy && <span className="t-caption">Three judges run live on the 0G Compute Router. You'll see each request ID as it comes back.</span>}
          </div>
        )}
      </div>
    </section>
  );
}
