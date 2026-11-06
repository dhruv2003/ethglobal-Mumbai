/*
 * Testing sub-tab: the project's real app, driven on cloud browsers.
 *
 *  - A stage with the laptop and phone cloud browsers, each playing its recording. A strip
 *    under each device marks every test step at the moment it ran; click one
 *    to jump there. The step on screen is labelled on the device.
 *  - The steps as a matrix (step × device) per phase, each with its actions,
 *    its screenshots and why it failed.
 *  - Artifacts: health checks, server errors, console errors, screenshots.
 * While the test is still running, the devices show the live cloud browsers.
 */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { api, apiUrl } from "../../lib/api.js";
import { Icon, OsLogo, osOf } from "../Icon.jsx";
import { Device, LiveStage } from "./TestDevices.jsx";
import { Steps } from "./TestSteps.jsx";
import { ST, allSteps } from "./testRun.js";
import { API } from "../../lib/apiBase.js";

const host = (u) => String(u ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Load the live test (bundled for samples, from the API for submissions), polling while it's pending. */
function useLiveTest(project, pending) {
  const [remote, setRemote] = useState({ id: project.id, lt: null });
  useEffect(() => {
    setRemote((r) => (r.id === project.id ? r : { id: project.id, lt: null }));
    if (project.liveTest || project.kind !== "submitted") return undefined;
    let alive = true;
    let timer;
    const load = async () => {
      const r = await api(`/projects/${encodeURIComponent(project.id)}/live`).catch(() => null);
      if (!alive) return;
      if (r?.liveTest) {
        const base = apiUrl(`/api/projects/${encodeURIComponent(project.id)}/live/files`);
        setRemote({ id: project.id, lt: {
          ...r.liveTest,
          runs: r.liveTest.runs.map((run) => ({
            ...run,
            videoUrl: run.video ? `${base}/${run.video.file}` : null,
            phases: run.phases?.map((ph) => ({ ...ph, steps: ph.steps.map((st) => ({ ...st, shotUrl: st.screenshot ? `${base}/${st.screenshot}` : null })) })),
          })),
        } });
      } else if (pending) timer = setTimeout(load, 6000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.kind, project.liveTest, pending]);
  // Never another project's results.
  return project.liveTest ?? (remote.id === project.id ? remote.lt : null);
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
              <OsLogo os={osOf(x)} size={15} />
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
        {r.model ? `${r.model} · ` : ""}{r.browser ?? `Chrome ${r.browserVersion?.split(".")[0]}`} · {r.viewport?.width}×{r.viewport?.height}
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
  const [view, setView] = useState("all");

  // A re-run in progress shows the live browsers, not the previous run's recordings.
  if (liveStep?.status === "running") return <LiveStage project={project} liveStep={liveStep} />;
  if (!lt?.runs?.length) {
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
    const go = () => seekRef.current[device]?.(at);
    // The other device isn't mounted yet: show both, then seek once it has rendered.
    if (view !== "all" && view !== device) {
      setView("all");
      requestAnimationFrame(() => requestAnimationFrame(go));
    } else go();
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
              ["all", "All"],
              ...runs.map((r) => [r.device, r.label]),
            ].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                {id !== "all" && <OsLogo os={osOf(runs.find((r) => r.device === id))} size={13} />} {label}
              </button>
            ))}
          </div>
        </div>
        <div className={`tstage__devices tstage__devices--${view}`}>
          {runs.map((r) =>
            view === "all" || view === r.device ? <Device key={r.device} run={r} focus={view === r.device} onTime={onTime} seekRef={seekRef} /> : null,
          )}
        </div>
        <p className="tstage__note m0">Tap a marker to jump to that step</p>
      </section>

      <div className="tv__grid">
        <Steps runs={runs} onSeek={seek} now={now} />
        <Artifacts runs={runs} onSeek={seek} />
      </div>
    </div>
  );
}
