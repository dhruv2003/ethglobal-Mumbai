/*
 * The review pipeline as a live canvas.
 *
 *   1 Gather  ──▶  2 Test & check  ──▶  3 Judge  ──▶  4 Verdict
 *   code, demo     live app, fact-check   the panel     the score
 *
 * Each step is a node; edges light up and carry moving particles while work
 * flows into the next stage. Steps in the same column run at the same time.
 * Pick a node to see its parts and numbers underneath. Status always has a
 * mark or a word too, never colour alone.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, health } from "../lib/api.js";
import { RERUN_EVENT, rerunReview } from "../lib/review.js";
import { Spinner } from "./Feedback.jsx";
import { band, fmt, secs } from "./review/useReviewData.js";

const PLACEHOLDER = [
  ["code", "Code review", "Fetch the repo, pin the commit, count the tests"],
  ["demo", "Process the demo", "Save the video, transcribe it, read the screenshots"],
  ["live", "Test the live app", "Replay the demo, then the main flows, on a laptop and a phone"],
  ["dossier", "Fact-check the claims", "Check what the team says against the code"],
  ["judges", "Judges score it", "Every judge scores it with all of the above"],
].map(([id, title, about]) => ({ id, title, about, status: "queued", parts: [], facts: [] }));

/* Layout: x as a share of the width, y in px. */
const H = 410;
const COLS = [0.12, 0.38, 0.63, 0.88];
const STAGES = [
  { n: 1, label: "Gather" },
  { n: 2, label: "Test & check" },
  { n: 3, label: "Judge" },
  { n: 4, label: "Verdict" },
];
const NODES = [
  { id: "code", col: 0, y: 124, icon: "code", short: "Code", tone: "oracle" },
  { id: "demo", col: 0, y: 300, icon: "play", short: "Demo", tone: "crush" },
  { id: "live", col: 1, y: 124, icon: "browser", short: "Live app", tone: "sunny" },
  { id: "dossier", col: 1, y: 300, icon: "search", short: "Fact-check", tone: "mint" },
  { id: "judges", col: 2, y: 212, icon: "gavel", short: "Judges", tone: "oracle" },
  { id: "verdict", col: 3, y: 212, icon: "trophy", short: "Verdict", tone: "sunny" },
];
const EDGES = [
  ["code", "live"],
  ["code", "dossier"],
  ["demo", "live"],
  ["demo", "dossier"],
  ["live", "judges"],
  ["dossier", "judges"],
  ["judges", "verdict"],
];
const R = 38; // node radius
const FINISHED = ["done", "failed", "skipped"];
const WORD = { queued: "Waiting", running: "Working", done: "Done", failed: "Failed", skipped: "Skipped" };

/*
 * Older runs split "Code review" into fetch / pin / tests steps. Fold those
 * into one "code" step (they become its parts) so the canvas always has its
 * five known nodes; anything else unknown is dropped from the map.
 */
const LEGACY_CODE = ["fetch", "pin", "tests"];
function normalize(raw) {
  if (!raw?.length) return PLACEHOLDER;
  const legacy = raw.filter((s) => LEGACY_CODE.includes(s.id));
  let steps = raw;
  if (legacy.length && !raw.some((s) => s.id === "code")) {
    const st = legacy.map((s) => s.status);
    const status = st.includes("running") ? "running" : st.every((x) => FINISHED.includes(x)) ? (st.includes("failed") ? "failed" : "done") : st.every((x) => x === "queued") ? "queued" : "running";
    const starts = legacy.map((s) => s.startedAt).filter(Boolean).sort();
    const ends = legacy.map((s) => s.finishedAt).filter(Boolean).sort();
    const code = {
      id: "code",
      title: "Code review",
      about: "Fetch the repo, pin the commit, count the tests",
      status,
      detail: legacy.map((s) => s.detail).filter(Boolean).join(" · "),
      startedAt: starts[0],
      finishedAt: status === "running" ? null : ends[ends.length - 1],
      parts: legacy.map((s) => ({ id: s.id, label: s.title ?? s.id, status: s.status, detail: s.detail })),
      facts: legacy.flatMap((s) => s.facts ?? []),
    };
    steps = [code, ...raw.filter((s) => !LEGACY_CODE.includes(s.id))];
  }
  const known = new Set(NODES.map((n) => n.id));
  const out = PLACEHOLDER.map((p) => steps.find((s) => s.id === p.id) ?? p);
  return out.filter((s) => known.has(s.id));
}

/* ---------- polling ---------- */

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

/** Ticks once a second while something is running, so elapsed times move. */
function useClock(on) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

function useWidth(ref) {
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/* ---------- icons ---------- */

const ICONS = {
  code: <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  browser: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5M8 10.5l1.8 1.8L13.5 8.6" />
    </>
  ),
  gavel: (
    <>
      <path d="m13.5 4.5 6 6M10.5 7.5l6 6M12 6l-4.5 4.5 6 6L18 12" />
      <path d="M9.5 14.5 3.5 20.5M3 21h9" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z" />
    </>
  ),
  flow: (
    <>
      <circle cx="5" cy="7" r="2.5" />
      <circle cx="5" cy="17" r="2.5" />
      <circle cx="19" cy="12" r="2.5" />
      <path d="M7.5 7c4 0 4 5 9 5M7.5 17c4 0 4-5 9-5" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="4.5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M12 18h.01" />
    </>
  ),
};
export function Icon({ name, size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* ---------- canvas ---------- */

const partPct = (s) => {
  if (FINISHED.includes(s.status)) return 1;
  const total = s.parts?.length ?? 0;
  const done = s.parts?.filter((p) => FINISHED.includes(p.status)).length ?? 0;
  return total ? done / total : 0;
};

function edgeState(a, b) {
  if (!a || !b) return "idle";
  if (FINISHED.includes(a.status) && b.status === "running") return "active";
  if (FINISHED.includes(a.status) && FINISHED.includes(b.status)) return "done";
  if (a.status === "running") return "waiting";
  return "idle";
}

function Node({ n, s, x, selected, onPick, score, i }) {
  const pct = partPct(s);
  const C = 2 * Math.PI * (R + 7);
  const glyph = s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.status === "skipped" ? "–" : null;
  const time = s.startedAt ? fmt(secs(s.startedAt, s.finishedAt)) : null;
  return (
    <motion.button
      type="button"
      className={`fnode fnode--${n.tone} fnode--${s.status} ${selected ? "fnode--sel" : ""}`}
      style={{ left: x, top: n.y, x: "-50%", y: -48 }}
      onClick={onPick}
      aria-pressed={selected}
      aria-label={`${n.short}: ${WORD[s.status]}${time ? `, ${time}` : ""}`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.08 + i * 0.07 }}
    >
      <span className="fnode__orb">
        {s.status === "running" && <span className="fnode__halo" aria-hidden="true" />}
        <svg className="fnode__ring" viewBox={`0 0 ${2 * (R + 10)} ${2 * (R + 10)}`} aria-hidden="true">
          <circle className="fnode__track" cx={R + 10} cy={R + 10} r={R + 7} />
          <motion.circle
            className="fnode__prog"
            cx={R + 10}
            cy={R + 10}
            r={R + 7}
            strokeDasharray={C}
            initial={false}
            animate={{ strokeDashoffset: C * (1 - (s.status === "running" ? Math.max(0.12, pct) : pct)) }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
        </svg>
        {s.status === "running" && (
          <svg className="fnode__orbit" viewBox="0 0 116 116" aria-hidden="true">
            <circle cx="58" cy="58" r="55" />
          </svg>
        )}
        <span className="fnode__face">{score != null ? <span className="fnode__score t-num">{score}</span> : <span className="fnode__glyph"><Icon name={n.icon} size={26} /></span>}</span>
        {glyph && (
          <span className={`fnode__badge fnode__badge--${s.status}`} aria-hidden="true">
            {glyph}
          </span>
        )}
        {s.status === "running" && (
          <span className="fnode__badge fnode__badge--running" aria-hidden="true">
            <Spinner size={12} label="" />
          </span>
        )}
      </span>
      <span className="fnode__name">{n.short}</span>
      <span className="fnode__meta t-num">{s.status === "queued" ? "waiting" : s.status === "running" ? time ?? "starting" : time ?? WORD[s.status]}</span>
      {s.status === "running" && <NowBubble s={s} />}
    </motion.button>
  );
}

/** Under a running node: one dot per sub-step and what it's doing right now. */
function NowBubble({ s }) {
  const parts = s.parts ?? [];
  const live = parts.filter((p) => p.status === "running");
  const text = live.length > 1 ? `${live.length} at once` : live[0] ? live[0].label.replace(/ browser$/, "") : (s.detail ?? "Starting").replace(/…$/, "");
  return (
    <motion.span className="fnow" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} aria-hidden="true">
      {parts.length > 0 && (
        <span className="fnow__dots">
          {parts.map((p) => (
            <span key={p.id} className={`fnow__dot fnow__dot--${p.status}`} />
          ))}
        </span>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={text} className="fnow__text" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {text}
        </motion.span>
      </AnimatePresence>
      <span className="fnow__ell">
        <span />
        <span />
        <span />
      </span>
    </motion.span>
  );
}

function Edge({ d, state, i }) {
  return (
    <g className={`fedge fedge--${state}`}>
      <path className="fedge__track" d={d} />
      {(state === "done" || state === "active") && (
        <motion.path className="fedge__line" d={d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.25 + i * 0.06, ease: [0.16, 1, 0.3, 1] }} />
      )}
      {state === "active" && <path className="fedge__flow" d={d} />}
      {state === "active" &&
        [0, 0.5].map((b) => (
          <circle key={b} className="fedge__dot" r="4.5">
            <animateMotion dur="1.8s" begin={`${b * 1.8}s`} repeatCount="indefinite" path={d} />
          </circle>
        ))}
      {state === "waiting" && <path className="fedge__wait" d={d} />}
    </g>
  );
}

function FlowCanvas({ steps, sel, onPick, verdict }) {
  const ref = useRef(null);
  const w = Math.max(640, useWidth(ref));
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  by.verdict = verdict;
  const pos = (id) => {
    const n = NODES.find((x) => x.id === id);
    return [COLS[n.col] * w, n.y];
  };
  const path = (a, b) => {
    const [x1, y1] = pos(a);
    const [x2, y2] = pos(b);
    const sx = x1 + R + 10;
    const ex = x2 - R - 10;
    const mx = (sx + ex) / 2;
    return `M ${sx} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${ex} ${y2}`;
  };
  const stageState = (col) => {
    const st = NODES.filter((n) => n.col === col).map((n) => by[n.id]?.status ?? "queued");
    if (st.some((x) => x === "running")) return "running";
    if (st.every((x) => FINISHED.includes(x))) return "done";
    return "queued";
  };
  return (
    <div className="fcanvas" ref={ref}>
      <div className="fcanvas__inner" style={{ width: w, height: H }}>
        {STAGES.map((g, i) => (
          <div key={g.n} className={`fstage fstage--${stageState(i)}`} style={{ left: COLS[i] * w }}>
            <span className="fstage__n">{g.n}</span>
            <span className="fstage__label">{g.label}</span>
            {NODES.filter((n) => n.col === i).length > 1 && (
              <span className="fstage__par" title="These steps run at the same time">
                ⇉ parallel
              </span>
            )}
          </div>
        ))}
        <svg className="fcanvas__edges" width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
          {EDGES.map(([a, b], i) => (
            <Edge key={`${a}-${b}`} d={path(a, b)} state={edgeState(by[a], by[b])} i={i} />
          ))}
        </svg>
        {NODES.map((n, i) => (
          <Node key={n.id} n={n} i={i} s={by[n.id] ?? { status: "queued" }} x={pos(n.id)[0]} selected={sel === n.id} onPick={() => onPick(n.id)} score={n.id === "verdict" ? verdict.score : null} />
        ))}
      </div>
    </div>
  );
}

/* ---------- detail ---------- */

const initials = (name) =>
  String(name)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The cloud browser's screen, live, while its test runs: an MJPEG stream the
 * backend serves from the newest screencast frame. Reconnects when frames
 * start (the browser takes a few seconds to come up).
 */
export function LiveScreen({ projectId, device }) {
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
          <Spinner size={18} label="Starting" /> Starting the {device}…
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

function Mark({ status }) {
  if (status === "running") return <Spinner size={14} label="Working" />;
  return (
    <span className={`dmark dmark--${status}`} aria-hidden="true">
      {status === "done" ? "✓" : status === "failed" ? "✕" : status === "skipped" ? "–" : ""}
    </span>
  );
}

const TONES = ["crush", "oracle", "amber"];

/** Parts that run side by side (judges, laptop + phone) as cards; the rest as a stepper. */
function Parts({ s, projectId }) {
  const lanes = (s.parts ?? []).filter((p) => s.id === "judges" || p.id === "laptop" || p.id === "phone");
  const seq = (s.parts ?? []).filter((p) => !lanes.includes(p));
  return (
    <>
      {seq.length > 0 && (
        <ol className="dsteps">
          {seq.map((p, i) => (
            <motion.li key={p.id} className={`dstep dstep--${p.status}`} title={p.detail ?? ""} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Mark status={p.status} />
              <span className="dstep__label">{p.label}</span>
              {p.detail && <span className="dstep__detail">{p.detail}</span>}
              <span className="visually-hidden"> · {WORD[p.status]}</span>
            </motion.li>
          ))}
        </ol>
      )}
      {lanes.length > 0 && (
        <ul className={`dlanes ${s.id === "judges" ? "dlanes--judges" : ""}`}>
          {lanes.map((p, i) => {
            const score = /Scored ([\d.]+)/.exec(p.detail ?? "")?.[1];
            const name = s.id === "judges" ? p.label.split(",")[0] : p.label.replace(/ browser$/, "");
            const device = p.id === "phone" || p.id === "laptop" ? p.id : null;
            return (
              <motion.li key={p.id} className={`dlane dlane--${p.status} dlane--${TONES[i % 3]}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <span className="dlane__badge" aria-hidden="true">
                  {device ? <Icon name={device} size={18} /> : initials(name)}
                </span>
                <span className="dlane__name">{name}</span>
                {score ? (
                  <span className={`dlane__score dlane__score--${band(+score)} t-num`}>{Number(score).toFixed(1)}</span>
                ) : (
                  <span className="dlane__state">
                    <Mark status={p.status} /> {WORD[p.status]}
                  </span>
                )}
                {device && p.status === "running" && projectId && <LiveScreen projectId={projectId} device={device} />}
                {!score && p.detail && <span className={`dlane__now ${p.status === "running" ? "dlane__now--live" : ""}`}>{p.detail}</span>}
              </motion.li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Detail({ s, n, projectId, verdict, onOpen }) {
  const time = s.startedAt ? fmt(secs(s.startedAt, s.finishedAt)) : null;
  return (
    <motion.div key={n.id} className="fdetail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} aria-live="polite">
      <header className="fdetail__head">
        <span className={`fdetail__icon fnode--${n.tone}`}>
          <Icon name={n.icon} size={20} />
        </span>
        <div className="fdetail__title">
          <h3 className="m0">{s.title ?? n.short}</h3>
          <span className="t-caption">{s.about}</span>
        </div>
        <span className={`dword dword--${s.status}`}>
          <Mark status={s.status} /> {WORD[s.status]}
          {time && <span className="t-num"> · {time}</span>}
        </span>
      </header>

      {s.status === "running" && s.detail && (
        <p className="fdetail__now m0" role="status">
          <span className="fdetail__pulse" aria-hidden="true" />
          {s.detail}
        </p>
      )}
      {s.status === "failed" && s.detail && <p className="fdetail__fail m0">✕ {s.detail}</p>}
      {s.status === "skipped" && s.detail && <p className="fdetail__skip m0">– {s.detail}</p>}

      {n.id === "verdict" ? (
        verdict.score != null ? (
          <div className="fverdict">
            <span className={`fverdict__n fverdict__n--${band(+verdict.score)} t-num`}>{verdict.score}</span>
            <span className="t-caption">panel average out of 100</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onOpen?.("judges")}>
              See how each judge scored →
            </button>
          </div>
        ) : (
          <p className="t-caption m0">The score lands here when the judges finish.</p>
        )
      ) : (
        <div className={`fdetail__body ${s.facts?.length ? "" : "fdetail__body--solo"}`}>
          <div className="fdetail__parts">
            <Parts s={s} projectId={projectId} />
            {s.status === "queued" && <p className="t-caption m0">Starts when the steps before it finish.</p>}
          </div>
          {s.facts?.length > 0 && (
            <dl className="ffacts">
              {s.facts.map((f, i) => (
                <motion.div key={f.label} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 + i * 0.04 }}>
                  <dd className="t-num">{String(f.value)}</dd>
                  <dt>{f.label}</dt>
                </motion.div>
              ))}
            </dl>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ---------- the card ---------- */

export function PipelineView({ project, live, onChanged, panelScore, onOpen }) {
  const steps = normalize(live.state?.steps);
  const queued = live.review?.status === "queued";
  const running = !queued && (live.running || (live.state && !live.state.finishedAt && live.state.startedAt));
  const finished = Boolean(live.state?.finishedAt) && !running && !queued;
  const failedN = steps.filter((s) => s.status === "failed").length;
  const runningIds = steps.filter((s) => s.status === "running").map((s) => s.id);
  useClock(Boolean(running));

  const judges = steps.find((s) => s.id === "judges");
  const verdict = {
    id: "verdict",
    title: "Verdict",
    about: "The panel's average becomes the project's score",
    status: judges?.status === "done" ? "done" : judges?.status === "failed" ? "failed" : "queued",
    score: judges?.status === "done" && panelScore != null ? (panelScore / 100).toFixed(1) : null,
  };

  const pick = () => runningIds[runningIds.length - 1] ?? steps.find((s) => s.status === "failed")?.id ?? (finished ? "verdict" : steps[0].id);
  const [selected, setSelected] = useState(pick);
  const [follow, setFollow] = useState(true);
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
      ? { tone: "neutral", word: live.review.position ? `Queued · #${live.review.position}` : "Queued" }
      : running
        ? { tone: "live", word: "Reviewing live" }
        : finished
          ? failedN
            ? { tone: "neutral", word: `Reviewed · ${failedN} step${failedN === 1 ? "" : "s"} failed` }
            : { tone: "success", word: "✓ Reviewed" }
          : { tone: "neutral", word: "Waiting for the reviewer" };
  const total = live.state?.startedAt ? fmt(secs(live.state.startedAt, live.state.finishedAt)) : null;
  const all = [...steps, verdict];
  const sel = all.find((s) => s.id === selected) ?? steps[0];
  const node = NODES.find((n) => n.id === sel.id) ?? NODES[0];

  return (
    <div className="flow-wrap">
      <section className="fcard" aria-label="Review pipeline">
        <header className="fcard__head">
          <span className={`pill pill--${head.tone}`}>{head.word}</span>
          <ol className="fcard__segs" aria-hidden="true">
            {steps.map((s) => (
              <li key={s.id} className={`fseg fseg--${s.status}`} />
            ))}
          </ol>
          {total && <span className="fcard__time t-num">{finished ? `took ${total}` : total}</span>}
          {project.kind === "submitted" && (
            <button type="button" className="fcard__rerun" onClick={rerun} disabled={asking || running || queued} title="Run the review again">
              <span aria-hidden="true">↻</span>
              <span>{running ? "Running" : queued ? "Queued" : asking ? "Starting" : "Re-run"}</span>
            </button>
          )}
        </header>
        {queued && live.review.ahead > 0 && (
          <p className="fcard__queue m0">
            {live.review.ahead} {live.review.ahead === 1 ? "project" : "projects"} ahead in the queue
          </p>
        )}
        {err && <p className="field__error m0">✕ {err}</p>}
        <FlowCanvas
          steps={steps}
          sel={sel.id}
          verdict={verdict}
          onPick={(id) => {
            setFollow(false);
            setSelected(id);
          }}
        />
        <ul className="flegend" aria-label="Legend">
          <li>
            <span className="flegend__k flegend__k--done" /> done
          </li>
          <li>
            <span className="flegend__k flegend__k--active" /> working
          </li>
          <li>
            <span className="flegend__k flegend__k--idle" /> waiting
          </li>
          <li className="flegend__tip">Tap a step to look inside</li>
        </ul>
      </section>

      <AnimatePresence mode="wait" initial={false}>
        <Detail key={sel.id} s={sel} n={node} verdict={verdict} onOpen={onOpen} projectId={project.kind === "submitted" ? project.id : null} />
      </AnimatePresence>
    </div>
  );
}

/** A compact 1→4 strip for the overview; opens the full canvas. */
export function FlowStrip({ live, onOpen }) {
  const steps = normalize(live.state?.steps);
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  const col = (ids) => {
    const st = ids.map((id) => by[id]?.status ?? "queued");
    if (st.some((x) => x === "failed") && st.every((x) => FINISHED.includes(x))) return "warn";
    if (st.some((x) => x === "running")) return "running";
    if (st.every((x) => FINISHED.includes(x))) return "done";
    return "queued";
  };
  const cols = [col(["code", "demo"]), col(["live", "dossier"]), col(["judges"]), by.judges?.status === "done" ? "done" : "queued"];
  return (
    <button type="button" className="fstrip" onClick={onOpen} aria-label="Open the review pipeline">
      {STAGES.map((g, i) => (
        <span key={g.n} className="fstrip__cell">
          {i > 0 && <span className={`fstrip__line fstrip__line--${cols[i - 1] === "queued" ? "idle" : cols[i] === "running" ? "active" : cols[i - 1]}`} aria-hidden="true" />}
          <span className={`fstrip__dot fstrip__dot--${cols[i]}`}>{cols[i] === "done" ? "✓" : cols[i] === "warn" ? "!" : g.n}</span>
          <span className="fstrip__label">{g.label}</span>
        </span>
      ))}
    </button>
  );
}
