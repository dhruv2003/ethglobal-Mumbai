/* The Testing tab's stage: a Windows laptop, an Android phone and an iPhone playing their recordings, or the live devices. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Spinner } from "../Feedback.jsx";
import { OsLogo, osOf } from "../Icon.jsx";
import { LiveScreen } from "./LiveScreen.jsx";
import { ST, allSteps, clock } from "./testRun.js";

const OUTCOME = {
  passed: { tone: "good", word: "Passed" },
  issues: { tone: "warn", word: "Issues" },
  failed: { tone: "bad", word: "Failed" },
  error: { tone: "skip", word: "Couldn't run" },
};

/** The devices on the stage, in order. Recordings name them by id. */
export const STAGE = [
  { device: "laptop", label: "Windows", model: "Windows 11 laptop", os: "windows" },
  { device: "android", label: "Android", model: "Pixel 8", os: "android" },
  { device: "ios", label: "iPhone", model: "iPhone 15", os: "ios" },
];

function Frame({ kind, children, label, url }) {
  return kind !== "laptop" ? (
    <div className={`dev dev--phone dev--${kind}`} aria-label={label}>
      <div className="dev__body">
        <span className={kind === "android" ? "dev__punch" : "dev__notch"} aria-hidden="true" />
        <div className="dev__screen">{children}</div>
      </div>
    </div>
  ) : (
    <div className="dev dev--laptop" aria-label={label}>
      <div className="dev__lid">
        <span className="dev__cam" aria-hidden="true" />
        <div className="dev__screen">
          {url && (
            <span className="dev__url" aria-hidden="true">
              <span className="dev__lock">●</span> {url}
            </span>
          )}
          {children}
        </div>
      </div>
      <div className="dev__base" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

/**
 * The MetaMask popup the test agent approved at a wallet step. A mock drawn over the recording:
 * the run used a throwaway test wallet on testnet, and this is what it was asked to sign.
 */
function WalletMock({ step, t, phone }) {
  const w = step.wallet;
  const since = t - step.at;
  const approved = since > 2.4;
  const connect = w.type === "connect";
  return (
    <motion.div className={`mm ${phone ? "mm--sheet" : ""}`} initial={{ opacity: 0, y: phone ? 40 : -12, scale: phone ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: phone ? 40 : -8 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} role="img" aria-label={`MetaMask test wallet: ${connect ? "connect request" : `confirm ${w.action}`}`}>
      <div className="mm__bar">
        <span className="mm__logo" aria-hidden="true" />
        <b>MetaMask</b>
        <span className="mm__net">{w.network}</span>
      </div>
      <div className="mm__acct">
        <span className="mm__avatar" aria-hidden="true" />
        <span>
          <b>{w.account}</b>
          <small className="t-mono">{w.address}</small>
        </span>
      </div>
      {connect ? (
        <div className="mm__body">
          <span className="mm__site">{w.site}</span>
          <b className="mm__title">Connect to this site?</b>
          <small>Allow the site to see your address and suggest transactions.</small>
        </div>
      ) : (
        <div className="mm__body">
          <span className="mm__site">{w.site}</span>
          <b className="mm__title">Confirm transaction</b>
          <dl className="mm__rows">
            <div><dt>Call</dt><dd className="t-mono">{w.action}</dd></div>
            <div><dt>Amount</dt><dd className="t-num">{w.value}</dd></div>
            <div><dt>Network fee</dt><dd className="t-num">{w.fee}</dd></div>
          </dl>
        </div>
      )}
      <div className="mm__actions">
        <span className="mm__btn mm__btn--ghost">{connect ? "Cancel" : "Reject"}</span>
        <span className={`mm__btn ${approved ? "mm__btn--done" : ""}`}>{approved ? (connect ? "✓ Connected" : `✓ ${w.result ?? "Confirmed"}`) : connect ? "Connect" : "Confirm"}</span>
      </div>
      <small className="mm__note">Approved by the test agent</small>
    </motion.div>
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
  // A wallet popup stays up from just before its step until a few seconds after the agent approves it.
  const walletStep = steps.find((s) => s.wallet && t >= s.at - 1.2 && t < s.at + 5.5);

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
          <OsLogo os={osOf(run)} size={17} /> {run.label}
          {run.model && <small className="tvdev__model">{run.model} · {run.browser ?? "Chrome"}</small>}
        </span>
        <span className={`tpill tpill--${o.tone}`}>{o.word}</span>
      </div>
      <Frame kind={run.device} label={`${run.label} recording`} url={run.device === "laptop" && run.chrome ? run.home?.url?.replace(/^https?:\/\//, "").replace(/\/$/, "") : null}>
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
        <AnimatePresence>{walletStep && <WalletMock key={walletStep.id} step={walletStep} t={t} phone={run.device !== "laptop"} />}</AnimatePresence>
        <AnimatePresence mode="wait">
          {current && !walletStep && (
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
        {STAGE.map(({ device: d, label, model, os }) => {
          const p = parts.find((x) => x.id === d);
          return (
            <div key={d} className={`tvdev tvdev--${d}`}>
              <div className="tvdev__top">
                <span className="tvdev__name">
                  <OsLogo os={os} size={17} /> {label}
                  <small className="tvdev__model">{model}</small>
                </span>
                {p?.status === "running" ? <Spinner size={14} label="Running" /> : p?.status === "done" ? <span className="tpill tpill--good">Done</span> : <span className="tpill tpill--skip">Waiting</span>}
              </div>
              <Frame kind={d} label={`${d} live view`}>
                {p?.status === "running" ? <LiveScreen projectId={project.id} device={d} label={label} /> : <span className="dev__empty">{p?.status === "done" ? "Finished, saving the recording…" : "Waiting to start"}</span>}
              </Frame>
              {p?.detail && <p className="tvdev__now m0">{p.detail}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
