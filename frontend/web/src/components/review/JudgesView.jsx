/*
 * Judges sub-tab. Pick a judge at the top; their take sits on the left (one
 * headline, then their scores per criterion as ranked bars), and the whole
 * panel is compared criterion by criterion on the right as a dot plot.
 * Proof (0G calls, Arkiv record) is folded away at the bottom.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCountUp } from "../../lib/motion.js";
import { Spinner } from "../Feedback.jsx";
import { judgeAsFighter } from "../JudgesPage.jsx";
import { PixelFighter } from "../PixelFighter.jsx";
import { JudgeTraces, LiveCalls, PanelProof, usd } from "../ZeroGProof.jsx";
import { ArkivRecord } from "../ArkivRecord.jsx";
import { JudgeEns } from "../EnsName.jsx";
import { BAND_WORD, CRITERIA, JUDGE_TONES, band } from "./useReviewData.js";

const STATUS_WORD = { declined: "Declined to review", invalid: "Answer rejected (bad format)", error: "Couldn't run" };
const first = (name) => name.split(" ")[0];

function Num({ hundredths }) {
  const v = useCountUp(Math.round(hundredths));
  return <>{(v / 100).toFixed(1)}</>;
}

function Switcher({ reviews, sel, onPick, panel }) {
  return (
    <div className="jsw" role="tablist" aria-label="Judges">
      <div className="jsw__panel">
        <span className="jsw__panel-n t-num">{panel == null ? "—" : <Num hundredths={panel} />}</span>
        <span className="jsw__panel-l">panel avg</span>
      </div>
      {reviews.map((r, i) => {
        const on = i === sel;
        const scored = r.status === "scored";
        return (
          <button key={r.judge.id} type="button" role="tab" aria-selected={on} className={`jsw__tab jsw__tab--${JUDGE_TONES[i % 3]} ${on ? "jsw__tab--on" : ""}`} onClick={() => onPick(i)}>
            {on && <motion.span layoutId="jsw-thumb" className="jsw__thumb" transition={{ type: "spring", stiffness: 420, damping: 34 }} aria-hidden="true" />}
            <span className="jsw__face">
              <PixelFighter project={judgeAsFighter(r.judge)} scale={3} label={`${r.judge.name}, judge`} />
            </span>
            <span className="jsw__who">
              <span className="jsw__name">{r.judge.name}</span>
              <span className="jsw__title">{r.judge.title}</span>
            </span>
            <span className={`jsw__score jsw__score--${scored ? band(r.overallHundredths / 100) : "none"} t-num`}>{scored ? (r.overallHundredths / 100).toFixed(1) : "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function Focus({ r, i }) {
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);
  const j = r.judge;
  if (r.status !== "scored") {
    return (
      <article className="jfocus">
        <span className="pill pill--neutral">{STATUS_WORD[r.status] ?? r.status}</span>
        <p className="t-body m0">{r.detail} No score was invented.</p>
        <JudgeTraces traces={r.traces} />
      </article>
    );
  }
  const rv = r.review;
  const rows = rv.criteria.map((c) => ({ ...c, w: j.weights?.[c.id] ?? 0 })).sort((a, b) => b.w - a.w || b.score - a.score);
  const cost = r.traces?.reduce((a, t) => a + (t.costUsdMicro ?? 0), 0);
  const b = band(r.overallHundredths / 100);
  return (
    <article className={`jfocus jfocus--${JUDGE_TONES[i % 3]}`}>
      <div className="jfocus__top">
        <span className={`jfocus__band jfocus__band--${b}`}>{BAND_WORD[b]}</span>
        <span className="jfocus__meta">
          {rv.certainty} certainty · {Math.round((r.ms ?? 0) / 1000)}s{cost ? ` · ${usd(cost)} on 0G` : ""}
        </span>
      </div>
      <JudgeEns judgeId={j.id} />
      <blockquote className="jfocus__quote m0">“{rv.headline}”</blockquote>
      {rv.dealBreakerHit && (
        <p className="jfocus__deal m0">
          <span aria-hidden="true">✕</span> Deal-breaker hit
        </p>
      )}
      <button type="button" className="jfocus__more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? "Hide" : "Read"} {first(j.name)}'s full note
      </button>
      <AnimatePresence initial={false}>
        {more && (
          <motion.div className="jfocus__note" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <p className="m0">{rv.comment}</p>
            {rv.dealBreakerHit && rv.dealBreakerNote && <p className="jfocus__deal-note m0">{rv.dealBreakerNote}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="jbars">
        <div className="jbars__head">
          <span>Criteria</span>
          <span>weight</span>
          <span>score</span>
        </div>
        <ul className="m0">
          {rows.map((c, k) => {
            const isOpen = open === c.id;
            return (
              <li key={c.id} className={`jbar ${isOpen ? "jbar--open" : ""}`}>
                <button type="button" className="jbar__btn" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} title="Why this score">
                  <span className="jbar__name">{CRITERIA[c.id] ?? c.id}</span>
                  <span className="jbar__w t-num" style={{ "--w": Math.min(1, c.w / 30) }}>
                    {c.w}%
                  </span>
                  <span className="jbar__track" aria-hidden="true">
                    <motion.span className={`jbar__fill jbar__fill--${band(c.score)}`} initial={{ width: 0 }} animate={{ width: `${c.score}%` }} transition={{ duration: 0.7, delay: 0.05 * k, ease: [0.16, 1, 0.3, 1] }} />
                  </span>
                  <span className="jbar__n t-num">{c.score}</span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.p className="jbar__why m0" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      {c.comment}
                    </motion.p>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
        <span className="jbars__hint">Tap a row to see why</span>
      </div>
    </article>
  );
}

/** Dot plot: one row per criterion, one dot per judge, on a shared 0–100 scale. */
function Compare({ reviews, sel, onPick }) {
  const scored = reviews.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "scored");
  if (!scored.length) return null;
  const ids = Object.keys(CRITERIA).filter((id) => scored.some(({ r }) => r.review.criteria.some((c) => c.id === id)));
  const rows = ids
    .map((id) => {
      const pts = scored.map(({ r, i }) => ({ i, name: r.judge.name, score: r.review.criteria.find((c) => c.id === id)?.score })).filter((p) => p.score != null);
      const avg = pts.reduce((a, p) => a + p.score, 0) / (pts.length || 1);
      return { id, pts, avg, spread: Math.max(...pts.map((p) => p.score)) - Math.min(...pts.map((p) => p.score)) };
    })
    .sort((a, b) => b.avg - a.avg);
  return (
    <section className="jcmp" aria-labelledby="jcmp-h">
      <header className="jcmp__head">
        <h3 id="jcmp-h" className="m0">
          The panel, side by side
        </h3>
        <ul className="jcmp__legend">
          {scored.map(({ r, i }) => (
            <li key={r.judge.id}>
              <button type="button" className={`jcmp__key jcmp__key--${JUDGE_TONES[i % 3]} ${i === sel ? "jcmp__key--on" : ""}`} onClick={() => onPick(i)}>
                <span className="jcmp__sw" aria-hidden="true" /> {first(r.judge.name)}
              </button>
            </li>
          ))}
        </ul>
      </header>
      <div className="jcmp__axis" aria-hidden="true">
        <span />
        <span className="jcmp__ticks">
          <span style={{ left: "0%" }}>0</span>
          <span style={{ left: "50%" }}>50</span>
          <span style={{ left: "70%" }}>70</span>
          <span style={{ left: "100%" }}>100</span>
        </span>
      </div>
      <ul className="jcmp__rows m0">
        {rows.map((row, k) => (
          <li key={row.id} className="jcmp__row">
            <span className="jcmp__label">
              {CRITERIA[row.id]}
              {row.spread >= 25 && (
                <span className="jcmp__split" title={`Judges are ${row.spread} points apart`}>
                  split
                </span>
              )}
            </span>
            <span className="jcmp__track">
              <span className="jcmp__grid" style={{ left: "50%" }} />
              <span className="jcmp__grid" style={{ left: "70%" }} />
              <span className="jcmp__range" style={{ left: `${Math.min(...row.pts.map((p) => p.score))}%`, width: `${row.spread}%` }} />
              {row.pts.map((p) => (
                <motion.span
                  key={p.i}
                  className={`jcmp__dot jcmp__dot--${JUDGE_TONES[p.i % 3]} ${p.i === sel ? "jcmp__dot--on" : ""}`}
                  style={{ left: `${p.score}%` }}
                  title={`${p.name}: ${p.score}`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22, delay: 0.1 + k * 0.04 + p.i * 0.03 }}
                >
                  <span className="visually-hidden">
                    {p.name} {p.score}
                  </span>
                </motion.span>
              ))}
            </span>
            <span className="jcmp__avg t-num">{Math.round(row.avg)}</span>
          </li>
        ))}
      </ul>
      <p className="jcmp__foot m0">Sorted by the panel's average · “split” marks 25+ points between judges</p>
    </section>
  );
}

export function JudgesView({ project, data, sel: selIn = 0, onSel }) {
  const { result, running, progress, health: h, ask, asking, error } = data;
  const reviews = result?.reviews ?? [];
  const [own, setOwn] = useState(selIn);
  const sel = Math.min(onSel ? selIn : own, Math.max(0, reviews.length - 1));
  const setSel = onSel ?? setOwn;
  const busy = asking || running;

  return (
    <div className="jv">
      {busy && (
        <div className="jv__busy" role="status">
          <Spinner size={22} label="Judges at work" />
          <span>The judges are reading the evidence{h?.provider === "0g" ? " on 0G" : ""}…</span>
          {running && <LiveCalls progress={progress} />}
        </div>
      )}

      {reviews.length > 0 ? (
        <>
          <Switcher reviews={reviews} sel={sel} onPick={setSel} panel={result.panelHundredths} />
          <div className="jv__grid">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={sel} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
                <Focus r={reviews[sel]} i={sel} />
              </motion.div>
            </AnimatePresence>
            <Compare reviews={reviews} sel={sel} onPick={setSel} />
          </div>
        </>
      ) : (
        !busy && (
          <div className="rv-empty">
            <span className="rv-empty__art" aria-hidden="true">
              ⚖︎
            </span>
            <p className="m0">No judge has scored {project.name} yet.</p>
          </div>
        )
      )}

      {result && (
        <details className="rv-proof">
          <summary>
            <span className="rv-proof__chip">⬢ Proof</span>
            <span>
              {result.provider === "0g" && result.zg ? `${result.zg.calls} calls on 0G Compute · ${usd(result.zg.costUsdMicro)}` : result.model}
              {" · "}
              {new Date(result.ranAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </span>
          </summary>
          <div className="rv-proof__body">
            <PanelProof result={result} />
            {reviews.map((r) => r.traces?.length > 0 && (
              <div key={r.judge.id} className="rv-proof__judge">
                <span className="t-label">{r.judge.name}</span>
                <JudgeTraces traces={r.traces} />
              </div>
            ))}
            {h && <ArkivRecord projectId={project.id} ranAt={result?.ranAt} />}
          </div>
        </details>
      )}

      {error && <span className="field__error">✕ {error}</span>}
      <div className="jv__foot">
        {!h ? (
          <span className="t-caption">Judge service offline · showing the last stored review</span>
        ) : !h.judgesReady ? (
          <span className="t-caption">
            Add <code className="t-mono-caption">{h.keyName ?? "an API key"}</code> to the backend to let the judges score.
          </span>
        ) : (
          <button type="button" className="btn btn--oracle btn--sm" onClick={ask} disabled={busy}>
            {busy ? "Judging…" : result ? "↻ Ask the judges again" : "Ask the judges"}
          </button>
        )}
      </div>
    </div>
  );
}
