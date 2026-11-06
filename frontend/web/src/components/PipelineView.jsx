/*
 * The review pipeline, live.
 *
 * Top: a flow map in three stages, so work that runs at the same time sits
 * side by side:  1 Gather (code review | demo) -> 2 Test and check (live test |
 * fact-check) -> 3 Judge.  Each step is a tile with its live line and progress.
 *
 * Below: the selected step. Parts that run at the same time (judges, laptop and
 * phone) show as lane cards next to each other; parts that run one after the
 * other show as a checklist. A failed step or part gets a cross and the rest
 * still run. Status always carries a mark or a word, never colour alone.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { api, health } from "../lib/api.js";
import { RERUN_EVENT, rerunReview } from "../lib/review.js";
import { Spinner } from "./Feedback.jsx";

const PLACEHOLDER = [
  ["code", "Code review", "Fetch the repo, pin the commit, count the tests"],
  ["demo", "Process the demo", "Save the video, transcribe it, read the screenshots"],
  ["live", "Test the live app on cloud browsers", "Replay the demo, then the main flows, on a laptop and a phone"],
  ["dossier", "Fact-check the claims", "Check what the team says against the code"],
  ["judges", "Judges score it", "Every judge on the panel scores it with all of the above"],
].map(([id, title, about]) => ({ id, title, about, status: "queued", parts: [], facts: [] }));

const STAGES = [
  { n: 1, label: "Gather", ids: ["code", "demo"] },
  { n: 2, label: "Test and check", ids: ["live", "dossier"] },
  { n: 3, label: "Judge", ids: ["judges"] },
];
const SHORT = { code: "Code", demo: "Demo", live: "Live app", dossier: "Fact-check", judges: "Judges" };
/** Parts of a step that run at the same time, shown as lanes. */
const LANES = { judges: () => true, live: (p) => p.id === "laptop" || p.id === "phone" };

const WORD = { queued: "Waiting", running: "Working", done: "Done", failed: "Failed", skipped: "Skipped" };
const TONES = ["crush", "oracle", "sunny"];

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

const secs = (a, b) => Math.max(0, Math.round((Date.parse(b ?? new Date().toISOString()) - Date.parse(a)) / 1000));
const fmt = (sec) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`);
const took = (x) => (x.startedAt && x.finishedAt ? fmt(secs(x.startedAt, x.finishedAt)) : null);

/** Ticks once a second while something is running, so elapsed times move. */
function useClock(on) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

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
      if (waiting && Date.now() - started < 45 * 60 * 1000) timer = setTimeout(load, 2500);
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

/* ---------- flow map ---------- */

function Tile({ s, selected, onPick }) {
  const total = s.parts?.length ?? 0;
  const done = s.parts?.filter((p) => ["done", "failed", "skipped"].includes(p.status)).length ?? 0;
  const pct = s.status === "done" || s.status === "failed" || s.status === "skipped" ? 1 : total ? done / total : 0;
  return (
    <button type="button" className={`ptile ptile--${s.status} ${selected ? "ptile--sel" : ""}`} onClick={onPick} aria-pressed={selected}>
      <span className="ptile__top">
        <Mark status={s.status} n="" size={24} />
        <span className="ptile__name">{SHORT[s.id] ?? s.title}</span>
        <span className="ptile__time t-num">{s.startedAt ? fmt(secs(s.startedAt, s.finishedAt)) : ""}</span>
      </span>
      <span className="ptile__line">
        {s.detail || (s.status === "queued" ? "Waiting" : s.about)}
        <span className="visually-hidden"> · {WORD[s.status]}</span>
      </span>
      <span className={`ptile__bar ${s.status === "running" ? "ptile__bar--live" : ""}`} aria-hidden="true">
        <motion.span initial={false} animate={{ scaleX: s.status === "running" ? Math.max(0.08, pct) : pct }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </span>
    </button>
  );
}

function FlowMap({ steps, sel, onPick }) {
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  const stageStatus = (ids) => {
    const st = ids.map((id) => by[id]?.status ?? "queued");
    if (st.some((x) => x === "running")) return "running";
    if (st.every((x) => x === "queued")) return "queued";
    return st.every((x) => x !== "queued") ? "done" : "running";
  };
  return (
    <div className="flow" role="group" aria-label="Review steps by stage">
      {STAGES.map((g, i) => {
        const ids = g.ids.filter((id) => by[id]);
        const together = ids.filter((id) => by[id].status === "running").length > 1;
        return (
          <div key={g.n} className="flow__cell">
            {i > 0 && (
              <span className={`flow__arrow flow__arrow--${stageStatus(STAGES[i - 1].ids)}`} aria-hidden="true">
                →
              </span>
            )}
            <div className={`flow__stage flow__stage--${stageStatus(ids)}`}>
              <div className="flow__head">
                <span className="flow__n">{g.n}</span>
                <span className="t-label">{g.label}</span>
                {ids.length > 1 && <span className={`flow__par ${together ? "flow__par--on" : ""}`}>{together ? "⇉ running together" : "⇉ in parallel"}</span>}
              </div>
              <div className="flow__lanes">
                {ids.map((id) => (
                  <Tile key={id} s={by[id]} selected={sel === id} onPick={() => onPick(id)} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- parts ---------- */

const initials = (name) =>
  String(name)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function DeviceIcon({ kind }) {
  return kind === "phone" ? (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="24" height="22" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M2 19h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The cloud browser's screen, live, while its test runs: an MJPEG stream the
 * backend serves from the newest screencast frame. Reconnects when frames
 * start (the browser takes a few seconds to come up).
 */
function LiveScreen({ projectId, device }) {
  const [on, setOn] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const r = await api(`/projects/${encodeURIComponent(projectId)}/live/now`).catch(() => null);
      if (!alive) return;
      setOn((was) => {
        if (r?.[device] && !was) setN((k) => k + 1); // (re)connect when frames appear
        return Boolean(r?.[device]);
      });
    };
    check();
    const t = setInterval(check, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [projectId, device]);
  return (
    <div className={`screen screen--${device}`}>
      {on ? (
        <img key={n} src={`/api/projects/${encodeURIComponent(projectId)}/live/stream/${device}?n=${n}`} alt={`Live view of the ${device} cloud browser`} />
      ) : (
        <span className="screen__wait">
          <Spinner size={18} label="Starting" /> Starting the {device} browser…
        </span>
      )}
      {on && (
        <span className="screen__live">
          <span aria-hidden="true">●</span> LIVE
        </span>
      )}
    </div>
  );
}

/** One lane: a judge or a device, working at the same time as its neighbours. */
function Lane({ p, i, stepId, projectId }) {
  const score = /Scored ([\d.]+)/.exec(p.detail ?? "")?.[1];
  const quote = /"(.+)"$/.exec(p.detail ?? "")?.[1];
  const name = stepId === "judges" ? p.label.split(",")[0] : p.label.replace(/ browser$/, "");
  return (
    <motion.li layout className={`lane lane--${p.status} lane--${TONES[i % 3]}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
      <div className="lane__head">
        <span className="lane__badge" aria-hidden="true">
          {stepId === "judges" ? initials(name) : <DeviceIcon kind={p.id} />}
        </span>
        <span className="lane__who">
          <span className="lane__name">{name}</span>
          {p.role && <span className="lane__role">{p.role}</span>}
        </span>
        <span className={`pword pword--${p.status}`}>
          {p.status === "done" ? "✓ " : p.status === "failed" ? "✕ " : ""}
          {WORD[p.status]}
        </span>
      </div>
      {p.focus && (
        <div className="lane__focus">
          <span className="t-label">Weighs most</span>
          <span>{p.focus}</span>
        </div>
      )}
      {score && (
        <div className="lane__score">
          <span className="lane__num t-num">{score}</span>
          <span className="t-caption">/ 100</span>
        </div>
      )}
      {stepId === "live" && p.status === "running" && projectId && <LiveScreen projectId={projectId} device={p.id} />}
      <p className={`lane__now m0 ${p.status === "running" ? "lane__now--live" : ""}`}>{quote ?? (score ? "" : p.detail ?? "Waiting")}</p>
      <span className={`lane__bar ${p.status === "running" ? "lane__bar--live" : ""}`} aria-hidden="true" />
      {took(p) && <span className="t-mono-caption">took {took(p)}</span>}
    </motion.li>
  );
}

function Parts({ s, projectId }) {
  const isLane = LANES[s.id] ?? (() => false);
  // Keep the order: sequential parts as a checklist, consecutive lane parts as one row of lanes.
  const groups = [];
  for (const p of s.parts ?? []) {
    const lane = isLane(p);
    const last = groups[groups.length - 1];
    if (last && last.lane === lane) last.items.push(p);
    else groups.push({ lane, items: [p] });
  }
  if (!groups.length) return null;
  return (
    <div className="pparts-wrap">
      {groups.map((g, gi) =>
        g.lane && g.items.length > 1 ? (
          <div key={gi} className="lanes-wrap">
            <span className="lanes__label">
              <span aria-hidden="true">⇉</span> {s.id === "judges" ? `${g.items.length} judges score at the same time` : "Laptop and phone run at the same time"}
            </span>
            <ul className="lanes">
              {g.items.map((p, i) => (
                <Lane key={p.id} p={p} i={i} stepId={s.id} projectId={projectId} />
              ))}
            </ul>
          </div>
        ) : (
          <ol key={gi} className="pparts">
            {g.items.map((p) => (
              <li key={p.id} className={`ppart ppart--${p.status}`}>
                <Mark status={p.status} n="·" size={22} />
                <span className="ppart__text">
                  <span className="ppart__label">
                    {p.label}
                    <span className="visually-hidden"> · {WORD[p.status]}</span>
                  </span>
                  {p.detail && <span className="ppart__detail">{p.detail}</span>}
                </span>
                {took(p) && <span className="ppart__took t-mono-caption">{took(p)}</span>}
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/* ---------- the card ---------- */

export function PipelineView({ project, live, onChanged }) {
  const steps = live.state?.steps?.length ? live.state.steps : PLACEHOLDER;
  const queued = live.review?.status === "queued";
  const running = !queued && (live.running || (live.state && !live.state.finishedAt && live.state.startedAt));
  const finished = Boolean(live.state?.finishedAt) && !running && !queued;
  const failedN = steps.filter((s) => s.status === "failed").length;
  const runningIds = steps.filter((s) => s.status === "running").map((s) => s.id);
  const doneN = steps.filter((s) => ["done", "failed", "skipped"].includes(s.status)).length;
  useClock(Boolean(running));

  const pick = () => runningIds[runningIds.length - 1] ?? steps.find((s) => s.status === "failed")?.id ?? steps[steps.length - 1].id;
  const [selected, setSelected] = useState(pick);
  const [follow, setFollow] = useState(true);
  // While running, follow the newest active step until the viewer picks one.
  const key = runningIds.join("|");
  useEffect(() => {
    if (follow && runningIds.length) setSelected(runningIds[runningIds.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow]);

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
        ? { tone: "live", word: runningIds.length > 1 ? `Reviewing · ${runningIds.length} steps at once` : "Reviewing" }
        : finished
          ? failedN
            ? { tone: "neutral", word: `Reviewed · ${failedN} step${failedN === 1 ? "" : "s"} failed` }
            : { tone: "success", word: "✓ Reviewed" }
          : { tone: "neutral", word: "Waiting for the reviewer" };
  const total = live.state?.startedAt ? fmt(secs(live.state.startedAt, live.state.finishedAt)) : null;

  const sel = steps.find((s) => s.id === selected) ?? steps[0];

  return (
    <section className="card pipe rise" style={{ "--i": 1 }} aria-labelledby="pipe-h">
      <header className="pipe__head">
        <div className="stack-xs">
          <span className="t-label" id="pipe-h">
            Review pipeline
          </span>
          <span className="t-caption">Runs on its own after every submission. Steps that don't depend on each other run at the same time; a failed step is crossed and the rest still run.</span>
        </div>
        <div className="pipe__status">
          {(running || queued) && <Spinner size={18} label={head.word} />}
          <StatusPill tone={head.tone}>{head.word}</StatusPill>
          {total && <span className="t-mono-caption">{finished ? `took ${total}` : total}</span>}
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

      <FlowMap
        steps={steps}
        sel={sel.id}
        onPick={(id) => {
          setFollow(false);
          setSelected(id);
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={sel.id} className={`pdetail ${sel.facts?.length ? "" : "pdetail--solo"}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} aria-live="polite">
          <div className="pdetail__main">
            <div className="pdetail__head">
              <Mark status={sel.status} n={steps.indexOf(sel) + 1} size={32} />
              <div className="stack-xs">
                <h3 className="t-heading m0">{sel.title}</h3>
                <span className="t-caption">{sel.about}</span>
              </div>
              <span className={`pword pword--${sel.status}`}>
                {sel.status === "done" ? "✓ " : sel.status === "failed" ? "✕ " : ""}
                {WORD[sel.status]}
              </span>
            </div>
            {sel.status === "running" && sel.detail && (
              <div className="pipe__now" role="status">
                <span className="t-label">Now</span>
                <span>{sel.detail}</span>
              </div>
            )}
            {sel.status === "failed" && sel.detail && (
              <p className="pipe__fail m0" role="note">
                ✕ {sel.detail}
              </p>
            )}
            {sel.status === "skipped" && sel.detail && <p className="pipe__skip m0">– {sel.detail}</p>}
            <Parts s={sel} projectId={project.kind === "submitted" ? project.id : null} />
            {sel.status === "queued" && <p className="t-caption m0">Hasn't started yet.</p>}
          </div>
          {sel.facts?.length > 0 && (
            <aside className="pdetail__side">
              <span className="t-label">Summary</span>
              <dl className="pfacts">
                {sel.facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd className="t-num">{String(f.value)}</dd>
                  </div>
                ))}
              </dl>
              {took(sel) && <span className="t-mono-caption">took {took(sel)}</span>}
            </aside>
          )}
        </motion.div>
      </AnimatePresence>

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
