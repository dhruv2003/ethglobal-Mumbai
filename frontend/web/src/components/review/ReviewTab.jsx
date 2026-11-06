/*
 * The Review tab of a project, split into four sub-tabs so each one does one job:
 *   Overview  – the score, the verdict and the gist, at a glance
 *   Pipeline  – the 1→4 flow the agents ran, live
 *   Judges    – each judge's take and the panel side by side
 *   Evidence  – claims vs. code, the live test, screenshots
 * The sub-tab lives in the URL (?view=judge&tab=…), so links keep it.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useCountUp } from "../../lib/motion.js";
import { judgeAsFighter } from "../JudgesPage.jsx";
import { PixelFighter } from "../PixelFighter.jsx";
import { FlowStrip, Icon, PipelineView, usePipeline } from "../PipelineView.jsx";
import { ClaimBar } from "./EvidenceView.jsx";
import { EvidenceView } from "./EvidenceView.jsx";
import { JudgesView } from "./JudgesView.jsx";
import { TestingView } from "./TestingView.jsx";
import { BAND_WORD, CLAIM, JUDGE_TONES, band, fmt, secs, useReviewData } from "./useReviewData.js";

const TABS = [
  { id: "overview", label: "Overview", icon: "trophy" },
  { id: "pipeline", label: "Pipeline", icon: "flow" },
  { id: "testing", label: "Testing", icon: "browser" },
  { id: "judges", label: "Judges", icon: "gavel" },
  { id: "evidence", label: "Evidence", icon: "search" },
];

function useTab(initial) {
  const [tab, set] = useState(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return TABS.some((x) => x.id === t) ? t : initial;
  });
  const setTab = (t) => {
    set(t);
    const q = new URLSearchParams(location.search);
    q.set("tab", t);
    history.replaceState({}, "", `${location.pathname}?${q}`);
  };
  return [tab, setTab];
}

/* ---------- overview ---------- */

const RG = 70;
const CG = 2 * Math.PI * RG;
function ScoreOrb({ hundredths }) {
  const v = useCountUp(Math.round(hundredths ?? 0), 1100);
  const b = band(hundredths == null ? null : hundredths / 100);
  const pct = hundredths == null ? 0 : Math.min(1, hundredths / 10000);
  return (
    <div className={`orb orb--${b}`} role="img" aria-label={hundredths == null ? "Not scored yet" : `Panel score ${(hundredths / 100).toFixed(1)} out of 100, ${BAND_WORD[b]}`}>
      <svg viewBox="0 0 168 168" aria-hidden="true">
        <circle className="orb__track" cx="84" cy="84" r={RG} />
        {[0.5, 0.7].map((t) => (
          <line key={t} className="orb__tick" x1="84" y1="6" x2="84" y2="16" transform={`rotate(${t * 360} 84 84)`} />
        ))}
        <motion.circle className="orb__fill" cx="84" cy="84" r={RG} strokeDasharray={CG} initial={{ strokeDashoffset: CG }} animate={{ strokeDashoffset: CG * (1 - pct) }} transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <span className="orb__n t-num">{hundredths == null ? "—" : (v / 100).toFixed(1)}</span>
      <span className={`orb__band orb__band--${b}`}>{BAND_WORD[b]}</span>
    </div>
  );
}

function Tile({ tone, icon, value, label, onClick, i, children }) {
  return (
    <motion.button type="button" className={`ovt ovt--${tone}`} onClick={onClick} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.15 + i * 0.06 }}>
      <span className="ovt__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ovt__value t-num">{value}</span>
      <span className="ovt__label">{label}</span>
      {children}
      <span className="ovt__go" aria-hidden="true">
        →
      </span>
    </motion.button>
  );
}

function Overview({ project, data, live, open, pickJudge }) {
  const { result, dossier: d } = data;
  const reviews = result?.reviews ?? [];
  const ev = d?.evidence ?? [];
  const supported = ev.filter((e) => e.status === "supported_by_code").length;
  const c = d?.continuity;
  const t = d?.tests?.found ?? {};
  const tests = (t.vitestCases ?? 0) + (t.forgeTests ?? 0) + (t.pyTests ?? 0);
  const step = (id) => live.state?.steps?.find((s) => s.id === id);
  const liveStep = step("live");
  const fact = (s, label) => s?.facts?.find((f) => f.label === label)?.value;
  const devices = ["Laptop", "Phone"].map((k) => [k, fact(liveStep, k)]).filter(([, v]) => v);
  const took = live.state?.startedAt && live.state?.finishedAt ? fmt(secs(live.state.startedAt, live.state.finishedAt)) : null;
  const headline = d?.highlights?.headline ?? (result ? `${reviews.filter((r) => r.status === "scored").length} of ${reviews.length} judges scored ${project.name}.` : `${project.name} hasn't been judged yet.`);

  return (
    <div className="ov">
      <section className="ov-hero" aria-label="Verdict">
        <ScoreOrb hundredths={result?.panelHundredths ?? null} />
        <div className="ov-hero__main">
          <span className="ov-kicker">Verdict</span>
          <p className="ov-hero__headline m0">{headline}</p>
          {ev.length > 0 && (
            <button type="button" className="ov-hero__claims" onClick={() => open("evidence")}>
              <ClaimBar evidence={ev} />
              <span className="ov-hero__legend">
                {CLAIM.map((x) => [x, ev.filter((e) => e.status === x.id).length])
                  .filter(([, n]) => n)
                  .map(([x, n]) => (
                    <span key={x.id}>
                      <span className={`ev-mark ev-mark--${x.tone}`} aria-hidden="true">
                        {x.mark}
                      </span>
                      <span className="t-num">{n}</span> {x.word.toLowerCase()}
                    </span>
                  ))}
              </span>
            </button>
          )}
        </div>
        {reviews.length > 0 && (
          <ul className="ov-judges m0" aria-label="Each judge's score">
            {reviews.map((r, i) => {
              const s = r.status === "scored" ? r.overallHundredths / 100 : null;
              return (
                <motion.li key={r.judge.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.08 }}>
                  <button type="button" className={`ov-judge ov-judge--${JUDGE_TONES[i % 3]}`} onClick={() => pickJudge(i)}>
                    <span className="ov-judge__face">
                      <PixelFighter project={judgeAsFighter(r.judge)} scale={2} label={`${r.judge.name}, judge`} />
                    </span>
                    <span className="ov-judge__name">{r.judge.name.split(" ")[0]}</span>
                    <span className="ov-judge__bar" aria-hidden="true">
                      <motion.span initial={{ width: 0 }} animate={{ width: `${s ?? 0}%` }} transition={{ duration: 0.9, delay: 0.35 + i * 0.08, ease: [0.16, 1, 0.3, 1] }} />
                    </span>
                    <span className={`ov-judge__n ov-judge__n--${band(s)} t-num`}>{s == null ? "—" : s.toFixed(1)}</span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="ov-tiles">
        <Tile i={0} tone="mint" icon="✓" value={ev.length ? `${supported}/${ev.length}` : "—"} label="claims backed by code" onClick={() => open("evidence")} />
        <Tile i={1} tone="oracle" icon="⚗︎" value={d ? tests : "—"} label="tests in the repo" onClick={() => open("evidence")} />
        <Tile i={2} tone="sunny" icon="⌚︎" value={c ? `${c.commitsDuringEvent}/${(c.commitsBefore ?? 0) + (c.commitsDuringEvent ?? 0)}` : "—"} label="commits at the event" onClick={() => open("evidence")} />
        <Tile i={3} tone="crush" icon={<Icon name="browser" size={18} />} value={devices.length ? "" : liveStep?.status === "skipped" ? "Skipped" : liveStep?.status === "running" ? "Testing" : "—"} label="live app test" onClick={() => open("testing")}>
          {devices.length > 0 && (
            <span className="ovt__devices">
              {devices.map(([k, v]) => (
                <span key={k} className={`ovt__dev ovt__dev--${/pass/i.test(v) ? "good" : /fail|broken/i.test(v) ? "bad" : "meh"}`}>
                  <Icon name={k.toLowerCase()} size={16} /> {/pass/i.test(v) ? "✓" : /fail|broken/i.test(v) ? "✕" : "!"}
                  <span className="visually-hidden">
                    {k}: {v}
                  </span>
                </span>
              ))}
            </span>
          )}
        </Tile>
      </div>

      {d?.highlights && (
        <div className="ov-two">
          {[
            ["good", "Holds up", "✓", d.highlights.holdsUp],
            ["watch", "Watch out", "!", d.highlights.watch],
          ].map(([tone, title, mark, items], k) =>
            items?.length ? (
              <motion.section key={tone} className={`ov-hl ov-hl--${tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + k * 0.08 }}>
                <h3 className="ov-hl__title m0">
                  <span className="ov-hl__badge" aria-hidden="true">
                    {mark}
                  </span>
                  {title}
                </h3>
                <ul className="m0">
                  {items.slice(0, 3).map((x) => (
                    <li key={x.text}>{x.text}</li>
                  ))}
                </ul>
              </motion.section>
            ) : null,
          )}
        </div>
      )}

      {project.kind === "submitted" && (
        <section className="ov-flow">
          <div className="ov-flow__text">
            <span className="ov-kicker">How it was judged</span>
            <span className="ov-flow__took">{took ? `4 stages · ${took}` : "4 stages, run by agents"}</span>
          </div>
          <FlowStrip live={live} onOpen={() => open("pipeline")} />
        </section>
      )}
    </div>
  );
}

/* ---------- shell ---------- */

export function ReviewTab({ project }) {
  const [live, refresh] = usePipeline(project);
  const data = useReviewData(project, live);
  const busy = live.running || live.review?.status === "queued" || (live.state && !live.state.finishedAt);
  const [tab, setTab] = useTab(busy ? "pipeline" : "overview");
  const [judge, setJudge] = useState(0);
  const tabs = TABS.filter((t) => (t.id !== "pipeline" && t.id !== "testing") || project.kind === "submitted" || (t.id === "testing" && project.liveTest));
  const liveRunning = live.state?.steps?.find((s) => s.id === "live")?.status === "running";
  const badge = {
    pipeline: busy ? "live" : null,
    testing: liveRunning ? "live" : null,
    judges: data.result?.reviews?.length || null,
    evidence: data.dossier?.evidence?.length || null,
  };
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].id;
    setTab(next);
    document.getElementById(`rtab-${next}`)?.focus();
  };

  return (
    <div className="rv">
      <nav className="rtabs" role="tablist" aria-label="Review sections" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`rtab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`rpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`rtab ${tab === t.id ? "rtab--on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {tab === t.id && <motion.span layoutId="rtab-thumb" className="rtab__thumb" transition={{ type: "spring", stiffness: 420, damping: 34 }} aria-hidden="true" />}
            <span className="rtab__icon">
              <Icon name={t.icon} size={18} />
            </span>
            <span className="rtab__label">{t.label}</span>
            {badge[t.id] === "live" ? (
              <span className="rtab__live">
                <span aria-hidden="true" />
                live
              </span>
            ) : badge[t.id] ? (
              <span className="rtab__badge t-num">{badge[t.id]}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} id={`rpanel-${tab}`} role="tabpanel" aria-labelledby={`rtab-${tab}`} className="rv__panel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
          {tab === "overview" && (
            <Overview
              project={project}
              data={data}
              live={live}
              open={setTab}
              pickJudge={(i) => {
                setJudge(i);
                setTab("judges");
              }}
            />
          )}
          {tab === "pipeline" && <PipelineView project={project} live={live} onChanged={refresh} panelScore={data.result?.panelHundredths} onOpen={setTab} />}
          {tab === "testing" && <TestingView project={project} live={live} />}
          {tab === "judges" && <JudgesView project={project} data={data} sel={judge} onSel={setJudge} />}
          {tab === "evidence" && <EvidenceView project={project} data={data} live={live} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
