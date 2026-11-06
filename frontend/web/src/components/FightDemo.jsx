/*
 * /fight-demo: plays the mock match through the fight player.
 * Ring, controls, and the two things you need beside it: what was said this
 * round, and the sealed scorecard. Nothing else.
 */
import { useMemo, useState } from "react";
import { FightStage } from "../fight/FightStage.jsx";
import { MOCK_EVENTS, MOCK_MATCH } from "../fight/mockFight.js";
import { useFightSound } from "../fight/useFightSound.js";
import { usePlayback } from "../fight/usePlayback.js";
import { scoreSoFar, stateAt } from "../fight/reducer.js";
import { CRITERIA, CRITERION_LABEL, RULING_TEXT, WEIGHTS, fmtHealth, fmtScore } from "../fight/score.js";
import { voteCount } from "../fight/choreo.js";
import { prefersReducedMotion } from "../lib/motion.js";

const SPEEDS = [1, 2, 4];
const OUTCOME = { upheld: "Hit", partially_upheld: "Graze", rejected: "Block", inconclusive: "Clash", mixed: "Clash" };

function PlayIcon({ playing }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {playing ? (
        <>
          <rect x="3" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
          <rect x="11" y="2" width="4" height="14" rx="1.5" fill="currentColor" />
        </>
      ) : (
        <path d="M5 2.8v12.4a1 1 0 0 0 1.5.9l10-6.2a1 1 0 0 0 0-1.8l-10-6.2A1 1 0 0 0 5 2.8z" fill="currentColor" />
      )}
    </svg>
  );
}

/** ?seq=N[&ms=M] opens the replay at that event: shareable highlights. */
function startFromUrl(events) {
  if (typeof location === "undefined") return { index: 0, ms: 0 };
  const q = new URLSearchParams(location.search);
  const index = events.findIndex((e) => e.seq === Number(q.get("seq")));
  return index < 0 ? { index: 0, ms: 0 } : { index, ms: Number(q.get("ms")) || 0 };
}

function LogLine({ match, e, state }) {
  if (e.type === "ruling") {
    const r = state.rulings.find((x) => x.challengeId === e.challengeId);
    return (
      <li className="fd-log__item fd-log__item--ruling">
        <span className={`fd-tag fd-tag--${OUTCOME[r.label].toLowerCase()}`}>{OUTCOME[r.label]}</span>
        <span>
          <b>{RULING_TEXT[r.label]} {voteCount(e.votes, r.label)}.</b> {e.reason}
        </span>
      </li>
    );
  }
  if (e.type === "penalty") {
    return (
      <li className="fd-log__item fd-log__item--ruling">
        <span className="fd-tag fd-tag--penalty">Penalty</span>
        <span>
          <b>{match.fighters[e.target].name}:</b> {e.reason}
        </span>
      </li>
    );
  }
  const who = match.fighters[e.actor]?.name ?? `Judge ${match.judges[e.actor]?.name}`;
  const kind = { question: "asks", answer: "answers", challenge: e.move ?? "challenges", rebuttal: "replies", pitch: "pitch", closing: "closing" }[e.type];
  return (
    <li className={`fd-log__item fd-log__item--${e.actor in match.fighters ? e.actor : "judge"}`}>
      <span className="fd-log__who">
        {who} · {kind}
      </span>
      <span>{e.text}</span>
    </li>
  );
}

export function FightDemo() {
  const events = MOCK_EVENTS;
  const match = MOCK_MATCH;
  const pb = usePlayback(events, { start: startFromUrl(events) });
  const sound = useFightSound(events, pb);
  const state = useMemo(() => stateAt(events, events[pb.index].seq), [events, pb.index]);
  const [captions, setCaptions] = useState(true);
  const [reduced, setReduced] = useState(() => !!prefersReducedMotion());

  const marks = useMemo(
    () => events.flatMap((e, i) => (e.type === "round_start" ? [{ i, label: `R${CRITERIA.indexOf(e.round) + 1}`, title: CRITERION_LABEL[e.round] }] : e.type === "result" ? [{ i, label: "End", title: "Result" }] : [])),
    [events],
  );
  const nextRuling = events.findIndex((e, i) => i > pb.index && (e.type === "ruling" || e.type === "round_sealed"));
  const roundLog = state.log.filter((e) => (state.round ? e.round === state.round || (e.type === "closing" && state.round === "defense") : e.type === "pitch")).slice(-5);
  const sa = scoreSoFar(state, "a");
  const sb = scoreSoFar(state, "b");

  return (
    <section className="fd" aria-label="Fight player demo">
      <div className="fd__head">
        <span className="t-caption">
          {match.event} · {match.title} · Mock replay
        </span>
        <h1 className="t-display-md m0">
          {match.fighters.a.name} <span className="fd__vs">vs</span> {match.fighters.b.name}
        </h1>
      </div>

      <FightStage match={match} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions={captions} typing={pb.playing} />

      <div className="fd__controls">
        <button type="button" className="fd__play" onClick={sound.togglePlay} aria-label={pb.playing ? "Pause" : "Play"}>
          <PlayIcon playing={pb.playing} />
        </button>
        <div className="fd__seg" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={pb.speed === s} onClick={() => pb.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <div className="fd__seek">
          <input
            type="range"
            min={0}
            max={events.length - 1}
            value={pb.index}
            onChange={(e) => pb.seek(Number(e.target.value))}
            aria-label="Seek through the match"
            aria-valuetext={`Event ${pb.index + 1} of ${events.length}${state.round ? `, ${CRITERION_LABEL[state.round]} round` : ""}`}
            style={{ "--p": `${(pb.index / (events.length - 1)) * 100}%` }}
          />
          <div className="fd__marks" aria-hidden="true">
            {marks.map((m) => (
              <button key={m.i} type="button" tabIndex={-1} style={{ left: `${(m.i / (events.length - 1)) * 100}%` }} title={m.title} onClick={() => pb.seek(m.i)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn--secondary btn--sm" disabled={nextRuling < 0} onClick={() => pb.seek(nextRuling)}>
          Next ruling
        </button>
        <div className="fd__toggles">
          <button type="button" className="fd__toggle" aria-pressed={!sound.muted} onClick={sound.toggleMute}>
            Sound
          </button>
          <button type="button" className="fd__toggle" aria-pressed={captions} onClick={() => setCaptions((v) => !v)}>
            Captions
          </button>
          <button type="button" className="fd__toggle" aria-pressed={reduced} onClick={() => setReduced((v) => !v)}>
            Reduce motion
          </button>
        </div>
      </div>

      <div className="fd__below">
        <section className="fd-card" aria-label="This round">
          <h2 className="t-heading m0">{state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}</h2>
          {roundLog.length ? (
            <ol className="fd-log">
              {roundLog.map((e) => (
                <LogLine key={e.seq} match={match} e={e} state={state} />
              ))}
            </ol>
          ) : (
            <p className="t-body muted m0">Nothing said yet. Press play.</p>
          )}
        </section>

        <section className="fd-card" aria-label="Scorecard">
          <h2 className="t-heading m0">Scorecard</h2>
          <table className="fd-score">
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col" className="fd-score__a">{match.fighters.a.name}</th>
                <th scope="col" className="fd-score__b">{match.fighters.b.name}</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c} className={state.sealed.a[c] ? "" : "is-open"}>
                  <th scope="row">
                    {CRITERION_LABEL[c]} <span className="muted">{WEIGHTS[c]}%</span>
                  </th>
                  <td className="t-num">{state.sealed.a[c]?.join(" · ") ?? "—"}</td>
                  <td className="t-num">{state.sealed.b[c]?.join(" · ") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Score</th>
                <td className="t-num">{sa == null ? "—" : fmtScore(sa)}</td>
                <td className="t-num">{sb == null ? "—" : fmtScore(sb)}</td>
              </tr>
              <tr>
                <th scope="row">Health</th>
                <td className="t-num">{fmtHealth(state.health.a)}</td>
                <td className="t-num">{fmtHealth(state.health.b)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="t-caption m0">Health = 20 + 0.8 × score. It only changes when a round seals.</p>
        </section>
      </div>
    </section>
  );
}
