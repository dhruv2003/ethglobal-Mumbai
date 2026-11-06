/* The Testing tab's step matrix: step × device per phase, each with its actions, screenshots and why it failed. */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../Icon.jsx";
import { ST, clock } from "./testRun.js";

const NEEDS = { "android-device": "an Android phone", "2x-android-device": "two Android phones", nfc: "NFC", wallet: "a wallet", "sign-in": "an account" };
const needsText = (d) =>
  "Needs " +
  d
    .replace(/^Needs /, "")
    .replace(/; not run\.$/, "")
    .split(/\s*,\s*/)
    .map((x) => NEEDS[x] ?? x.replace(/-/g, " "))
    .join(" + ");

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

export function Steps({ runs, onSeek, now }) {
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
