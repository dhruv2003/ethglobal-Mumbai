/*
 * The review pipeline, live: five steps in order (code review, demo, live
 * test, fact-check, judges). Each step expands to show its parts; the side
 * panel summarises the selected step. A failed step gets a cross and the
 * steps after it still run. Status always carries a word or a mark, never
 * colour alone.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { api, health } from "../lib/api.js";
import { RERUN_EVENT, rerunReview } from "../lib/review.js";
import { Spinner } from "./Feedback.jsx";

const PLACEHOLDER = [
  ["code", "Code review", "Fetch the repo, pin the commit, count the tests"],
  ["demo", "Process the demo", "Save the video, transcribe it, check the screenshots"],
  ["live", "Test the live app on cloud browsers", "Replay the demo, then the main flows, on a laptop and a phone"],
  ["dossier", "Fact-check the claims", "Check what the team says against the code"],
  ["judges", "Judges score it", "Every judge on the panel scores it with all of the above"],
].map(([id, title, about]) => ({ id, title, about, status: "queued", parts: [], facts: [] }));

const WORD = { queued: "Waiting", running: "Working", done: "Done", failed: "Failed", skipped: "Skipped" };

function Mark({ status, n, size = 28 }) {
  if (status === "running")
    return (
      <span className="pmark pmark--running" style={{ "--s": `${size}px` }}>
        <Spinner size={size - 8} label="Working" />
      </span>
    );
  const glyph = status === "done" ? "✓" : status === "failed" ? "✕" : status === "skipped" ? "–" : n;
  return (
    <span className={`pmark pmark--${status}`} style={{ "--s": `${size}px` }} aria-hidden="true">
      {glyph}
    </span>
  );
}

const took = (s) => {
  if (!s.startedAt || !s.finishedAt) return null;
  const sec = Math.max(0, Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000));
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`;
};

/** Polls the pipeline while it's queued or running. */
export function usePipeline(project) {
  const [live, setLive] = useState({ state: null, running: false, review: null, offline: false, loaded: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (project.kind !== "submitted") return undefined;
    let alive = true;
    let timer;
    const started = Date.now();
    const load = async () => {
      const h = await health();
      if (!alive) return;
      if (!h) return setLive((l) => ({ ...l, offline: true, loaded: true }));
      const p = await api(`/projects/${encodeURIComponent(project.id)}/pipeline`).catch(() => null);
      if (!alive) return;
      setLive({ state: p?.state ?? null, running: Boolean(p?.running), review: p?.review ?? null, offline: false, loaded: true });
      const waiting = p?.running || p?.review?.status === "queued" || (p?.state && !p.state.finishedAt);
      if (waiting && Date.now() - started < 45 * 60 * 1000) timer = setTimeout(load, 3000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.kind, tick]);
  // "Run the review again" anywhere on the page: start polling again.
  useEffect(() => {
    const on = (e) => e.detail?.projectId === project.id && setTick((t) => t + 1);
    window.addEventListener(RERUN_EVENT, on);
    return () => window.removeEventListener(RERUN_EVENT, on);
  }, [project.id]);
  return [live, () => setTick((t) => t + 1)];
}

export function PipelineView({ project, live, onChanged }) {
  const steps = live.state?.steps?.length ? live.state.steps : PLACEHOLDER;
  const queued = live.review?.status === "queued";
  const running = !queued && (live.running || (live.state && !live.state.finishedAt && live.state.startedAt));
  const finished = Boolean(live.state?.finishedAt) && !running && !queued;
  const failedN = steps.filter((s) => s.status === "failed").length;
  const doneN = steps.filter((s) => ["done", "failed", "skipped"].includes(s.status)).length;
  const current = steps.findIndex((s) => s.status === "running");

  const pick = () => {
    const r = steps.findIndex((s) => s.status === "running");
    if (r >= 0) return steps[r].id;
    const f = steps.find((s) => s.status === "failed");
    return f ? f.id : steps[0].id;
  };
  const [selected, setSelected] = useState(pick);
  const [open, setOpen] = useState(() => new Set([pick()]));
  const [follow, setFollow] = useState(true);
  // While running, follow the active step until the viewer picks one.
  useEffect(() => {
    if (!follow || current < 0) return;
    setSelected(steps[current].id);
    setOpen((o) => new Set([...o, steps[current].id]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, follow]);

  const [err, setErr] = useState("");
  const [asking, setAsking] = useState(false);
  const rerun = async () => {
    setErr("");
    setAsking(true);
    try {
      await rerunReview(project.id);
      setFollow(true);
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setAsking(false);
    }
  };

  const head = live.offline
    ? { tone: "neutral", word: "Review service offline" }
    : queued
      ? { tone: "neutral", word: live.review.position ? `In the queue · #${live.review.position}` : "In the queue" }
      : running
        ? { tone: "live", word: `Reviewing · step ${Math.max(1, current + 1)} of ${steps.length}` }
        : finished
          ? failedN
            ? { tone: "neutral", word: `Reviewed · ${failedN} step${failedN === 1 ? "" : "s"} failed` }
            : { tone: "success", word: "✓ Reviewed" }
          : { tone: "neutral", word: "Waiting for the reviewer" };

  const sel = steps.find((s) => s.id === selected) ?? steps[0];
  const selIndex = steps.indexOf(sel);
  const toggle = (id) =>
    setOpen((o) => {
      const n = new Set(o);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <section className="card pipe rise" style={{ "--i": 1 }} aria-labelledby="pipe-h">
      <header className="pipe__head">
        <div className="stack-xs">
          <span className="t-label" id="pipe-h">
            Review pipeline
          </span>
          <span className="t-caption">Runs on its own after every submission. A failed step is marked and the next one still runs.</span>
        </div>
        <div className="pipe__status">
          {(running || queued) && <Spinner size={18} label={head.word} />}
          <StatusPill tone={head.tone}>{head.word}</StatusPill>
        </div>
      </header>
      {queued && live.review.ahead > 0 && (
        <p className="t-caption m0">
          Reviews run one at a time. {live.review.ahead} {live.review.ahead === 1 ? "project is" : "projects are"} ahead of {project.name}.
        </p>
      )}
      <div className="pipe__bar" aria-hidden="true">
        <motion.span initial={false} animate={{ scaleX: doneN / steps.length }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>

      <div className="pipe__grid">
        <ol className="pipe__steps">
          {steps.map((s, i) => {
            const isOpen = open.has(s.id);
            const hasParts = s.parts?.length > 0;
            return (
              <li key={s.id} className={`pstep pstep--${s.status} ${s.id === sel.id ? "pstep--sel" : ""}`}>
                <div className="pstep__row">
                  <Mark status={s.status} n={i + 1} />
                  <button
                    type="button"
                    className="pstep__main"
                    onClick={() => {
                      setFollow(false);
                      setSelected(s.id);
                    }}
                    aria-current={s.id === sel.id ? "step" : undefined}
                  >
                    <span className="pstep__title">
                      {s.title}
                      <span className="visually-hidden"> · {WORD[s.status] ?? s.status}</span>
                    </span>
                    <span className="pstep__detail">{s.detail || s.about || WORD[s.status]}</span>
                  </button>
                  {hasParts && (
                    <button type="button" className="pstep__toggle" onClick={() => toggle(s.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the parts of ${s.title}`}>
                      <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden="true">
                        ▾
                      </motion.span>
                    </button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {hasParts && isOpen && (
                    <motion.ul className="pparts" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                      {s.parts.map((p) => (
                        <li key={p.id} className={`ppart ppart--${p.status}`}>
                          <Mark status={p.status} n="·" size={20} />
                          <span className="ppart__text">
                            <span className="ppart__label">
                              {p.label}
                              <span className="visually-hidden"> · {WORD[p.status] ?? p.status}</span>
                            </span>
                            {p.detail && <span className="ppart__detail">{p.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>

        <aside className="pipe__side" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sel.id} className="stack" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
              <div className="pipe__side-head">
                <span className="t-label">
                  Step {selIndex + 1} of {steps.length}
                </span>
                <span className={`pword pword--${sel.status}`}>
                  {sel.status === "done" ? "✓ " : sel.status === "failed" ? "✕ " : ""}
                  {WORD[sel.status] ?? sel.status}
                </span>
              </div>
              <h3 className="t-heading m0">{sel.title}</h3>
              {sel.about && <p className="t-caption m0">{sel.about}</p>}
              {sel.status === "failed" && sel.detail && (
                <p className="pipe__fail m0" role="note">
                  ✕ {sel.detail}
                </p>
              )}
              {sel.status === "skipped" && sel.detail && <p className="pipe__skip m0">– {sel.detail}</p>}
              {sel.facts?.length ? (
                <dl className="pfacts">
                  {sel.facts.map((f) => (
                    <div key={f.label}>
                      <dt>{f.label}</dt>
                      <dd className="t-num">{String(f.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : sel.status !== "failed" && sel.status !== "skipped" ? (
                sel.status === "running" ? (
                  <div className="pipe__now" role="status">
                    <span className="t-label">Now</span>
                    <span>{sel.detail || "Starting…"}</span>
                    {sel.parts?.length > 0 && (
                      <span className="t-caption">
                        {sel.parts.filter((x) => x.status === "done").length} of {sel.parts.length} parts done
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="t-caption m0">{sel.status === "queued" ? "Hasn't started yet." : sel.detail}</p>
                )
              ) : null}
              {took(sel) && <span className="t-mono-caption">took {took(sel)}</span>}
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>

      {project.kind === "submitted" && (
        <div className="pipe__foot">
          {err && <span className="field__error">✕ {err}</span>}
          <button type="button" className="btn btn--secondary btn--sm" onClick={rerun} disabled={asking || running || queued}>
            {running ? "Review running…" : queued ? "Waiting in the queue…" : asking ? "Starting…" : "↻ Run the review again"}
          </button>
        </div>
      )}
    </section>
  );
}
