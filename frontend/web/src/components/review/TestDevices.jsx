/* The Testing tab's stage: laptop and phone frames playing their recordings, or the live cloud browsers. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Spinner } from "../Feedback.jsx";
import { Icon } from "../Icon.jsx";
import { LiveScreen } from "./LiveScreen.jsx";
import { ST, allSteps, clock } from "./testRun.js";

const OUTCOME = {
  passed: { tone: "good", word: "Passed" },
  issues: { tone: "warn", word: "Issues" },
  failed: { tone: "bad", word: "Failed" },
  error: { tone: "skip", word: "Couldn't run" },
};

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

/** One device on the stage: frame + recording + step strip. */
export function Device({ run, focus, onTime, seekRef }) {
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
    const refs = seekRef.current;
    return () => {
      delete refs[run.device];
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
export function LiveStage({ project, liveStep }) {
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
