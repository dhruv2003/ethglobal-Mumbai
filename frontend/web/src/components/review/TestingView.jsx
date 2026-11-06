/*
 * Testing sub-tab: the project's real app, driven on cloud browsers.
 *
 *  - A stage with a laptop and a phone, each playing its recording. A strip
 *    under each device marks every test step at the moment it ran; click one
 *    to jump there. The step on screen is labelled on the device.
 *  - The steps as a matrix (step × device) per phase, each with its actions,
 *    its screenshots and why it failed.
 *  - Artifacts: health checks, server errors, console errors, screenshots.
 * While the test is still running, the devices show the live cloud browsers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../lib/api.js";
import { Spinner } from "../Feedback.jsx";
import { Icon, LiveScreen } from "../PipelineView.jsx";

const ST = {
  passed: { mark: "✓", tone: "good", word: "Works" },
  failed: { mark: "✕", tone: "bad", word: "Broken" },
  missing: { mark: "?", tone: "warn", word: "Not on the live site" },
  blocked: { mark: "–", tone: "skip", word: "Can't run in a browser" },
};
const OUTCOME = {
  passed: { tone: "good", word: "Passed" },
  issues: { tone: "warn", word: "Issues" },
  failed: { tone: "bad", word: "Failed" },
  error: { tone: "skip", word: "Couldn't run" },
};
const NEEDS = { "android-device": "an Android phone", "2x-android-device": "two Android phones", nfc: "NFC", wallet: "a wallet", "sign-in": "an account" };
const needsText = (d) =>
  "Needs " +
  d
    .replace(/^Needs /, "")
    .replace(/; not run\.$/, "")
    .split(/\s*,\s*/)
    .map((x) => NEEDS[x] ?? x.replace(/-/g, " "))
    .join(" + ");
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const host = (u) => String(u ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Load the live test (bundled for samples, from the API for submissions), polling while it's pending. */
function useLiveTest(project, pending) {
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
            phases: run.phases?.map((ph) => ({ ...ph, steps: ph.steps.map((st) => ({ ...st, shotUrl: st.screenshot ? `${base}/${st.screenshot}` : null })) })),
          })),
        });
      } else if (pending) timer = setTimeout(load, 6000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.kind, project.liveTest, pending]);
  return project.liveTest ?? remote;
}

/* ---------- devices ---------- */

function Frame({ kind, children, label }) {
  return kind === "phone" ? (
    <div className="dev dev--phone" aria-label={label}>
      <div className="dev__body">
        <span className="dev__notch" aria-hidden="true" />
        <div className="dev__screen">{children}</div>
      </div>
    </div>
  ) : (
    <div className="dev dev--laptop" aria-label={label}>
      <div className="dev__lid">
        <span className="dev__cam" aria-hidden="true" />
        <div className="dev__screen">{children}</div>
      </div>
      <div className="dev__base" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

const allSteps = (run) => (run.phases ?? []).flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.id })));

/** One device on the stage: frame + recording + step strip. */
function Device({ run, focus, onTime, seekRef }) {
  const v = useRef(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dur = run.video?.seconds || 1;
  const steps = useMemo(() => allSteps(run).filter((s) => s.at != null && s.status !== "blocked"), [run]);
  const current = [...steps].reverse().find((s) => s.at <= t + 0.25);
  const poster = allSteps(run).find((s) => s.shotUrl)?.shotUrl;

  useEffect(() => {
    seekRef.current[run.device] = (at) => {
      const el = v.current;
      if (!el) return;
      el.currentTime = Math.max(0, at - 0.3);
      el.play().catch(() => {});
    };
  }, [run.device, seekRef]);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  };
  const o = OUTCOME[run.outcome?.status] ?? OUTCOME.issues;

  return (
    <div className={`tvdev tvdev--${run.device} ${focus ? "tvdev--focus" : ""}`}>
      <div className="tvdev__top">
        <span className="tvdev__name">
          <Icon name={run.device} size={16} /> {run.label}
        </span>
        <span className={`tpill tpill--${o.tone}`}>{o.word}</span>
      </div>
      <Frame kind={run.device} label={`${run.label} recording`}>
        {run.videoUrl ? (
          <video
            ref={v}
            src={run.videoUrl}
            poster={poster}
            muted
            playsInline
            preload="metadata"
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              setT(e.currentTarget.currentTime);
              onTime?.(run.device, e.currentTarget.currentTime);
            }}
          />
        ) : poster ? (
          <img src={poster} alt="" />
        ) : (
          <span className="dev__empty">No recording</span>
        )}
        <AnimatePresence mode="wait">
          {current && (
            <motion.span key={current.id} className={`dev__step dev__step--${ST[current.status]?.tone}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <b>{ST[current.status]?.mark}</b> {current.title}
            </motion.span>
          )}
        </AnimatePresence>
        {run.videoUrl && !playing && (
          <button type="button" className="dev__play" onClick={toggle} aria-label={`Play the ${run.label.toLowerCase()} recording`}>
            ▶
          </button>
        )}
      </Frame>
      <div className="tline">
        <button type="button" className="tline__btn" onClick={toggle} disabled={!run.videoUrl} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="tline__track">
          <span className="tline__played" style={{ width: `${(t / dur) * 100}%` }} />
          {steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`tline__mark tline__mark--${ST[s.status]?.tone} ${current?.id === s.id ? "tline__mark--on" : ""}`}
              style={{ left: `${(s.at / dur) * 100}%` }}
              onClick={() => seekRef.current[run.device]?.(s.at)}
              title={`${clock(s.at)} · ${s.title} · ${ST[s.status]?.word}`}
              aria-label={`Jump to ${s.title}`}
            />
          ))}
        </div>
        <span className="tline__time t-num">
          {clock(t)} / {clock(dur)}
        </span>
      </div>
    </div>
  );
}

/** While the test runs: the live cloud browsers in the same frames. */
function LiveStage({ project, liveStep }) {
  const parts = liveStep?.parts ?? [];
  return (
    <section className="tstage">
      <div className="tstage__bar">
        <span className="tpill tpill--live">
          <span className="tpill__dot" /> Testing live
        </span>
        <span className="tstage__hint">{liveStep?.detail ?? "Starting the cloud browsers"}</span>
      </div>
      <div className="tstage__devices">
        {["laptop", "phone"].map((d) => {
          const p = parts.find((x) => x.id === d);
          return (
            <div key={d} className={`tvdev tvdev--${d}`}>
              <div className="tvdev__top">
                <span className="tvdev__name">
                  <Icon name={d} size={16} /> {d === "laptop" ? "Laptop" : "Phone"}
                </span>
                {p?.status === "running" ? <Spinner size={14} label="Running" /> : p?.status === "done" ? <span className="tpill tpill--good">Done</span> : <span className="tpill tpill--skip">Waiting</span>}
              </div>
              <Frame kind={d} label={`${d} live view`}>
                {p?.status === "running" ? <LiveScreen projectId={project.id} device={d} /> : <span className="dev__empty">{p?.status === "done" ? "Finished, saving the recording…" : "Waiting to start"}</span>}
              </Frame>
              {p?.detail && <p className="tvdev__now m0">{p.detail}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- steps ---------- */

function Actions({ detail }) {
  const bits = String(detail ?? "")
    .split(" · ")
    .filter(Boolean);
  return (
    <span className="tacts">
      {bits.map((b, i) => {
        const m = /^(click|see|land on|follow|type|fill|select|open|scroll)\s+(.*)$/i.exec(b);
        return (
          <span key={i} className={`tact tact--${m ? m[1].toLowerCase().split(" ")[0] : "plain"}`}>
            {m ? (
              <>
                <b>{m[1]}</b> {m[2]}
              </>
            ) : (
              b
            )}
          </span>
        );
      })}
    </span>
  );
}

function Steps({ runs, onSeek, now }) {
  const phases = runs[0]?.phases ?? [];
  const [ph, setPh] = useState(phases[0]?.id);
  const [open, setOpen] = useState(null);
  const phase = phases.find((p) => p.id === ph) ?? phases[0];
  if (!phase) return null;
  const by = (run, id) => run.phases?.find((p) => p.id === phase.id)?.steps.find((s) => s.id === id);
  const tally = (p) => {
    const all = runs.flatMap((r) => r.phases?.find((x) => x.id === p.id)?.steps ?? []);
    return { ok: all.filter((s) => s.status === "passed").length, n: all.filter((s) => s.status !== "blocked").length };
  };
  return (
    <section className="rv-card tsteps" aria-labelledby="tsteps-h">
      <header className="rv-card__head">
        <h3 id="tsteps-h" className="m0">
          Test steps
        </h3>
        <div className="tphase" role="tablist">
          {phases.map((p) => {
            const c = tally(p);
            return (
              <button key={p.id} type="button" role="tab" aria-selected={p.id === phase.id} onClick={() => setPh(p.id)}>
                {p.title}
                <span className="t-num">
                  {c.ok}/{c.n}
                </span>
              </button>
            );
          })}
        </div>
      </header>
      {phase.about && <p className="tsteps__about m0">{phase.about}</p>}
      <div className="tmx" role="table" aria-label={phase.title}>
        <div className="tmx__head" role="row">
          <span role="columnheader">Step</span>
          {runs.map((r) => (
            <span key={r.device} role="columnheader" className="tmx__dev">
              <Icon name={r.device} size={15} />
              <span className="visually-hidden">{r.label}</span>
            </span>
          ))}
          <span />
        </div>
        {phase.steps.map((s, i) => {
          const isOpen = open === s.id;
          const cells = runs.map((r) => ({ r, st: by(r, s.id) }));
          const playing = cells.some(({ r }) => now[r.device] === s.id);
          return (
            <div key={s.id} className={`tmx__row ${isOpen ? "tmx__row--open" : ""} ${playing ? "tmx__row--now" : ""}`} role="row">
              <button type="button" className="tmx__main" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                <span className="tmx__n t-num">{i + 1}</span>
                <span className="tmx__title">
                  {s.title}
                  {s.demoAt && <span className="tmx__demo">demo {s.demoAt}</span>}
                </span>
              </button>
              {cells.map(({ r, st }) => {
                const k = ST[st?.status] ?? ST.blocked;
                return (
                  <button
                    key={r.device}
                    type="button"
                    className={`tmx__cell tmx__cell--${k.tone}`}
                    onClick={() => st?.at != null && st.status !== "blocked" && onSeek(r.device, st.at)}
                    title={`${r.label}: ${k.word}${st?.at != null ? ` · play from ${clock(st.at)}` : ""}`}
                    aria-label={`${r.label}: ${k.word}`}
                  >
                    {k.mark}
                  </button>
                );
              })}
              <span className="tmx__chev" aria-hidden="true">
                ›
              </span>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div className="tmx__more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    {s.status === "blocked" && s.detail?.startsWith("Needs ") ? <p className="m0 tmx__why">{needsText(s.detail)}</p> : <Actions detail={s.detail} />}
                    {cells.some(({ st }) => st?.status === "failed" || st?.status === "missing") && (
                      <ul className="tmx__fails m0">
                        {cells
                          .filter(({ st }) => st?.status === "failed" || st?.status === "missing")
                          .map(({ r, st }) => (
                            <li key={r.device}>
                              <b>{r.label}:</b> {ST[st.status].word}
                              {st.why ? ` · ${st.why}` : ""}
                            </li>
                          ))}
                      </ul>
                    )}
                    <div className="tmx__shots">
                      {cells
                        .filter(({ st }) => st?.shotUrl)
                        .map(({ r, st }) => (
                          <button key={r.device} type="button" className={`tshot tshot--${r.device}`} onClick={() => st.at != null && onSeek(r.device, st.at)}>
                            <img src={st.shotUrl} alt={`${r.label} screenshot: ${s.title}`} loading="lazy" />
                            <span className="tshot__cap">
                              <Icon name={r.device} size={12} /> {st.at != null ? clock(st.at) : r.label} {st.ms ? `· ${(st.ms / 1000).toFixed(1)}s` : ""}
                            </span>
                          </button>
                        ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- artifacts ---------- */

function Artifacts({ runs, onSeek }) {
  const [dev, setDev] = useState(runs[0]?.device);
  const r = runs.find((x) => x.device === dev) ?? runs[0];
  const errs = Object.entries(
    (r.failedRequests ?? []).reduce((a, f) => {
      let p = f.url;
      try {
        p = new URL(f.url).pathname;
      } catch {
        /* keep the raw url */
      }
      const k = `${p}|${f.status ?? "—"}`;
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {}),
  );
  const shots = allSteps(r).filter((s) => s.shotUrl);
  const h = r.home ?? {};
  const checks = [
    { ok: h.status >= 200 && h.status < 400, label: "Home loads", value: h.status ?? "—" },
    { ok: (h.loadMs ?? h.wallMs ?? 0) < 3000, label: "Load time", value: `${((h.loadMs ?? h.wallMs ?? 0) / 1000).toFixed(1)}s` },
    { ok: !h.horizontalScroll, label: "Fits the screen", value: h.horizontalScroll ? "scrolls sideways" : "yes" },
    { ok: !h.brokenImages, label: "Broken images", value: h.brokenImages ?? 0 },
    { ok: !(r.consoleErrors?.length), label: "Console errors", value: r.consoleErrors?.length ?? 0 },
    { ok: !(r.failedRequests?.length), label: "Failed requests", value: r.failedRequests?.length ?? 0 },
  ];
  return (
    <aside className="rv-card tart" aria-labelledby="tart-h">
      <header className="rv-card__head">
        <h3 id="tart-h" className="m0">
          Artifacts
        </h3>
        <div className="tart__dev" role="group" aria-label="Device">
          {runs.map((x) => (
            <button key={x.device} type="button" aria-pressed={x.device === r.device} onClick={() => setDev(x.device)} aria-label={x.label}>
              <Icon name={x.device} size={15} />
            </button>
          ))}
        </div>
      </header>
      <ul className="thealth m0">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? "thealth--ok" : "thealth--bad"}>
            <span className="thealth__mark" aria-hidden="true">
              {c.ok ? "✓" : "!"}
            </span>
            <span className="thealth__l">{c.label}</span>
            <span className="thealth__v t-num">{String(c.value)}</span>
          </li>
        ))}
      </ul>
      {errs.length > 0 && (
        <div className="terrs">
          <span className="ov-kicker">Server errors</span>
          <ul className="m0">
            {errs.map(([k, n]) => {
              const [p, st] = k.split("|");
              return (
                <li key={k}>
                  <span className="terrs__code t-num">{st}</span>
                  <code>{p}</code>
                  {n > 1 && <span className="terrs__n t-num">×{n}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {shots.length > 0 && (
        <div className="tfilm">
          <span className="ov-kicker">Screenshots · {shots.length}</span>
          <div className={`tfilm__strip tfilm__strip--${r.device}`}>
            {shots.map((s) => (
              <button key={s.id} type="button" className={`tfilm__shot tfilm__shot--${ST[s.status]?.tone}`} onClick={() => s.at != null && onSeek(r.device, s.at)} title={s.title}>
                <img src={s.shotUrl} alt={s.title} loading="lazy" />
                <span className="tfilm__mark" aria-hidden="true">
                  {ST[s.status]?.mark}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="tart__meta m0 t-num">
        Chrome {r.browserVersion?.split(".")[0]} · {r.viewport?.width}×{r.viewport?.height}
        {r.durationMs ? ` · ${Math.round(r.durationMs / 1000)}s run` : ""}
      </p>
    </aside>
  );
}

/* ---------- the tab ---------- */

export function TestingView({ project, live }) {
  const liveStep = live?.state?.steps?.find((s) => s.id === "live");
  const pending = liveStep?.status === "running" || liveStep?.status === "queued" || live?.review?.status === "queued";
  const lt = useLiveTest(project, pending);
  const seekRef = useRef({});
  const [now, setNow] = useState({});
  const [view, setView] = useState("both");

  if (!lt?.runs?.length) {
    if (liveStep?.status === "running") return <LiveStage project={project} liveStep={liveStep} />;
    return (
      <div className="rv-empty">
        <span className="rv-empty__art" aria-hidden="true">
          <Icon name="browser" size={34} />
        </span>
        <p className="m0">{liveStep?.status === "skipped" ? liveStep.detail || "The live test was skipped." : pending ? "The live test hasn't started yet." : "No live test for this project."}</p>
      </div>
    );
  }

  const runs = lt.runs;
  const steps = runs.flatMap((r) => allSteps(r));
  const count = (st) => steps.filter((s) => s.status === st).length;
  const checkable = steps.filter((s) => s.status !== "blocked").length;
  const ok = count("passed");
  const C = 2 * Math.PI * 22;
  const onTime = (device, t) => {
    const run = runs.find((r) => r.device === device);
    const cur = [...allSteps(run)].reverse().find((s) => s.at != null && s.status !== "blocked" && s.at <= t + 0.25);
    setNow((n) => (n[device] === cur?.id ? n : { ...n, [device]: cur?.id }));
  };
  const seek = (device, at) => {
    if (view !== "both" && view !== device) setView("both");
    seekRef.current[device]?.(at);
    document.querySelector(`.tvdev--${device}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="tv">
      <section className="tstage">
        <div className="tstage__bar">
          <div className="tsum">
            <svg viewBox="0 0 52 52" className="tsum__ring" aria-hidden="true">
              <circle cx="26" cy="26" r="22" className="tsum__track" />
              <motion.circle cx="26" cy="26" r="22" className="tsum__fill" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - ok / (checkable || 1)) }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
            </svg>
            <span className="tsum__n t-num">
              {ok}
              <small>/{checkable}</small>
            </span>
            <span className="tsum__l">
              checks pass
              <span className="tsum__chips">
                {count("failed") > 0 && <span className="tpill tpill--bad">✕ {count("failed")} broken</span>}
                {count("missing") > 0 && <span className="tpill tpill--warn">? {count("missing")} missing</span>}
                {count("blocked") > 0 && <span className="tpill tpill--skip">– {count("blocked")} can't run</span>}
              </span>
            </span>
          </div>
          <a className="tstage__site" href={lt.target} target="_blank" rel="noreferrer">
            <span className="tstage__lock" aria-hidden="true">
              ●
            </span>
            {host(lt.target)} ↗
          </a>
          <div className="tview" role="group" aria-label="Devices shown">
            {[
              ["both", "Both"],
              ...runs.map((r) => [r.device, r.label]),
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={`tstage__devices tstage__devices--${view}`}>
          {runs.map((r) =>
            view === "both" || view === r.device ? <Device key={r.device} run={r} focus={view === r.device} onTime={onTime} seekRef={seekRef} /> : null,
          )}
        </div>
        <p className="tstage__note m0">Tap a marker to jump to that step · never signs in, pays or connects a wallet</p>
      </section>

      <div className="tv__grid">
        <Steps runs={runs} onSeek={seek} now={now} />
        <Artifacts runs={runs} onSeek={seek} />
      </div>
    </div>
  );
}
