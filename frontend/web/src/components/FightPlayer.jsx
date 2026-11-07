/* Plays a recorded fight: the ring, its controls, every hit with its reason, and the verdict. Shared by the fight page and its full-screen view. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FightStage } from "../fight/FightStage.jsx";
import { stateAt } from "../fight/reducer.js";
import { CRITERIA, CRITERION_LABEL, RULING_OUTCOME, fmtHealth } from "../fight/score.js";
import { useFightSound } from "../fight/useFightSound.js";
import { eventDuration } from "../fight/choreo.js";
import { useReel } from "../fight/usePlayback.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { Link } from "../lib/router.jsx";

const SAY = { pitch: "pitches", question: "asks", answer: "answers", challenge: "challenges", rebuttal: "replies", closing: "closes" };
const INTRO = { seq: 1, ts: new Date(0).toISOString(), type: "intro" };
const NOT_STARTED = stateAt([INTRO], INTRO.seq);

const fighterOf = (p) => ({ id: p.id, name: p.name, tracks: p.tracks ?? [], pitch: p.pitch, fighterSeed: p.fighterSeed, seed: p.seed });

export function matchFor(tournament, match, fight, a, b) {
  return {
    id: `${tournament.id}-${match.index}`,
    title: match.roundName,
    event: tournament.title,
    fighters: { a: fighterOf(a), b: fighterOf(b) },
    judges: fight?.judges ?? {},
  };
}

export const canPlay = (fight) => fight?.status === "done" && fight.events?.length > 0;

/** The ring before the fight: both fighters squared up, nothing said yet. */
export function WaitingRing({ match, fit }) {
  return <FightStage match={match} state={NOT_STARTED} event={INTRO} ms={eventDuration(INTRO)} reduced captions={false} typing={false} fit={fit} />;
}

export function Player({ fightMatch, events, fight, theater = false, onResult }) {
  const pb = useReel(events, { autoPlay: theater });
  // Tell the theater once the winner's banner has had a moment on screen.
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !onResult || pb.event?.type !== "result" || pb.ms < 1600) return;
    told.current = true;
    onResult(pb.event.winner);
  }, [pb.event, pb.ms, onResult]);
  const sound = useFightSound(events, pb);
  const state = useMemo(() => stateAt(events, events[pb.index].seq), [events, pb.index]);
  // A fight that's over (not playing): show every hit and the verdict straight away.
  const full = useMemo(() => stateAt(events, events[events.length - 1].seq), [events]);
  const shown = !theater && !pb.playing && !state.result && pb.index === 0 ? full : state;
  const [reduced] = useState(() => !!prefersReducedMotion());
  const lines = state.log.filter((e) => SAY[e.type]).slice(-4).reverse();
  const who = (e) => fightMatch.fighters[e.actor]?.name ?? `Judge ${fightMatch.judges[e.actor]?.name ?? ""}`;
  const proof = pb.event?.proof;

  const controls = (
      <div className="fight-controls">
        <button type="button" className="btn btn--secondary btn--sm" onClick={sound.togglePlay}>
          {pb.playing ? "Pause" : "Play"}
        </button>

        <span className="fight-round t-label">
          <span className="live-dot" aria-hidden="true" /> {state.result ? "Result" : state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}
          <span className="t-caption t-num">{Math.ceil(pb.leftMs / 1000)}s</span>
        </span>
        <span className="t-caption t-num fight-controls__health">
          {fmtHealth(state.health.a)} · {fmtHealth(state.health.b)} HP
        </span>
        <button type="button" className="fd__toggle" aria-pressed={!sound.muted} onClick={sound.toggleMute}>
          Sound
        </button>
      </div>
  );
  if (theater) {
    return (
      <>
        <div className="theater__stage">
          <FightStage match={fightMatch} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions typing={pb.playing} fit />
        </div>
        <div className="theater__controls">{controls}</div>
      </>
    );
  }
  return (
    <div className="stack">
      <FightStage match={fightMatch} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions typing={pb.playing} />
      {controls}
      <Hits fightMatch={fightMatch} state={shown} />
      {shown.result ? (
        <Verdict fightMatch={fightMatch} fight={fight} winner={shown.result.winner} />
      ) : (
        lines.length > 0 && (
          <details className="fight-talk">
            <summary>What they said ({state.round ? `${CRITERION_LABEL[state.round]} round` : "opening pitches"})</summary>
            <ol className="fight-lines">
              {lines.map((e) => (
                <li key={e.seq}>
                  <span className="t-label">
                    {who(e)} {SAY[e.type]}
                  </span>
                  <span className="t-body">{e.text}</span>
                </li>
              ))}
            </ol>
          </details>
        )
      )}
      {proof?.requestId && (
        <p className="t-caption m0 t-mono">
          0G request {proof.requestId}
          {proof.teeVerified ? " · TEE verified" : ""}
        </p>
      )}
    </div>
  );
}

const HIT_WORD = { hit: "Hit", graze: "Glancing hit", block: "Blocked", clash: "No clear call" };
/** The project page holds the evidence a hit cites; slots without a project have none. */
const evidenceHref = (p) => (p?.id && !String(p.id).startsWith("chain-") ? `/projects/${encodeURIComponent(p.id)}?tab=evidence#evidence` : null);

/** Every ruling so far, newest first: who hit whom, and the judges' one-line reason. */
function Hits({ fightMatch, state }) {
  const items = [
    ...state.rulings.map((r) => ({ key: `r${r.seq}`, seq: r.seq, round: r.round, attacker: r.attacker, target: r.target, outcome: RULING_OUTCOME[r.label] ?? "clash", reason: r.reason, evidence: state.challenges[r.challengeId]?.evidence ?? [] })),
    ...state.penalties.map((p) => ({ key: `p${p.seq}`, seq: p.seq, round: p.round, attacker: null, target: p.target, outcome: "hit", reason: p.reason, judge: fightMatch.judges[p.judge]?.name, evidence: p.evidence ?? [], penalty: true })),
  ]
    .filter((x) => x.reason)
    .sort((x, y) => y.seq - x.seq);
  const [tab, setTab] = useState("all");
  if (!items.length) return null;
  const name = (side) => fightMatch.fighters[side]?.name ?? "";
  const landed = (side) => items.filter((x) => x.target === side && (x.outcome === "hit" || x.outcome === "graze")).length;
  const tabs = [
    { id: "all", label: "All", n: items.length },
    { id: "a", label: `On ${name("a")}`, n: items.filter((x) => x.target === "a").length },
    { id: "b", label: `On ${name("b")}`, n: items.filter((x) => x.target === "b").length },
  ];
  const shown = tab === "all" ? items : items.filter((x) => x.target === tab);
  return (
    <section className="hits2" aria-label="Every hit and why">
      <header className="hits2__head">
        <div>
          <span className="eyebrow">The case file</span>
          <h2 className="t-heading m0">Every hit, with its proof</h2>
        </div>
        <div className="hits2__score t-num" aria-label="Hits landed">
          <span className="hits2__side hits2__side--a">
            <b>{landed("a")}</b> on {name("a")}
          </span>
          <span className="hits2__side hits2__side--b">
            <b>{landed("b")}</b> on {name("b")}
          </span>
        </div>
      </header>
      <div className="hits2__tabs" role="tablist" aria-label="Filter hits">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`hits2__tab hits2__tab--${t.id}`} onClick={() => setTab(t.id)}>
            {t.label} <span className="t-num">{t.n}</span>
            {tab === t.id && <motion.span layoutId="hits-tab" className="hits2__tabon" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          </button>
        ))}
      </div>
      <ol className="hits2__list m0">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((x) => {
            const href = evidenceHref(fightMatch.fighters[x.target]);
            const by = x.penalty ? x.judge : x.attacker ? name(x.attacker) : x.judge ?? "The judges";
            return (
              <motion.li key={x.key} className={`hcard hcard--${x.outcome} hcard--on-${x.target}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}>
                <div className="hcard__top">
                  <span className={`hcard__tag hcard__tag--${x.outcome}`}>{HIT_WORD[x.outcome]}</span>
                  {x.round && <span className="hcard__round">{CRITERION_LABEL[x.round] ?? x.round}</span>}
                  <span className="hcard__who">
                    {x.penalty && <span className="hcard__judge">Judge</span>}
                    <b>{by}</b> <span aria-hidden="true">→</span> {name(x.target)}
                  </span>
                </div>
                <p className="hcard__reason m0">{x.reason}</p>
                {(href || x.evidence.length > 0) && (
                  <div className="hcard__proof">
                    {x.evidence.slice(0, 2).map((e) => (
                      <code key={e.label} className="hcard__ev" title={e.label}>
                        {e.label}
                      </code>
                    ))}
                    {href && (
                      <Link to={href} className="hcard__go">
                        Evidence →
                      </Link>
                    )}
                  </div>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}

/** Average of the three judges for one side of a sealed round. */
const avg = (xs) => (xs?.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

/** The end of the fight: who won, the score per round, and where the proof lives. */
export function Verdict({ fightMatch, fight, winner, scores }) {
  const sealed = Object.fromEntries((fight?.events ?? []).filter((e) => e.type === "round_sealed").map((e) => [e.round, e.scores]));
  const rows = CRITERIA.filter((c) => sealed[c]).map((c) => ({ id: c, a: avg(sealed[c].a), b: avg(sealed[c].b) }));
  const final = scores ?? (fight?.scores?.a != null && typeof fight.scores.a === "number" ? fight.scores : null);
  const w = fightMatch.fighters[winner];
  const href = evidenceHref(w);
  return (
    <section className="verdict" aria-label="Verdict">
      <span className="eyebrow">Verdict</span>
      <h2 className="t-display-md m0">{w?.name ?? "The winner"} wins</h2>
      {final && (
        <p className="verdict__final t-num m0">
          {fightMatch.fighters.a.name} <b>{(final.a / 100).toFixed(1)}</b> <span className="muted">·</span> {fightMatch.fighters.b.name} <b>{(final.b / 100).toFixed(1)}</b>
        </p>
      )}
      {rows.length > 0 && (
        <table className="verdict__table">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">{fightMatch.fighters.a.name}</th>
              <th scope="col">{fightMatch.fighters.b.name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{CRITERION_LABEL[r.id]}</th>
                <td className={`t-num ${r.a > r.b ? "verdict__win" : ""}`}>{r.a.toFixed(0)}</td>
                <td className={`t-num ${r.b > r.a ? "verdict__win" : ""}`}>{r.b.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Proofs fight={fight} fightMatch={fightMatch} />
      {href && (
        <p className="verdict__proof t-caption m0">
          <Link to={href}>See {w.name}'s evidence →</Link>
        </p>
      )}
    </section>
  );
}

const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "");

/** Where this result can be checked: the judges' inference and the evidence on 0G, the record on Arkiv. */
function Proofs({ fight, fightMatch }) {
  const p = fight?.proofs;
  if (!p) return null;
  const rows = [
    ["Result record", "Arkiv", p.arkiv.entityKey, p.arkiv.explorer],
    ["Transcript", "0G Storage", p.transcript.rootHash, p.transcript.file],
    [`${fightMatch.fighters.a.name} evidence`, "0G root", p.evidence.a.dossier, `/projects/${p.evidence.a.project}?tab=evidence#evidence`],
    [`${fightMatch.fighters.b.name} evidence`, "0G root", p.evidence.b.dossier, `/projects/${p.evidence.b.project}?tab=evidence#evidence`],
  ];
  return (
    <div className="proofs">
      <ul className="proofs__list m0">
        {rows.map(([label, where, hash, href]) => (
          <li key={label}>
            <span className="proofs__label">{label}</span>
            <span className="proofs__where">{where}</span>
            {href.startsWith("/") ? (
              <Link to={href} className="t-mono proofs__hash">
                {short(hash)}
              </Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" className="t-mono proofs__hash">
                {short(hash)} ↗
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="t-caption m0 muted">
        Judged in {fight.calls} calls to 0G Compute ({p.inference.model}) · result hash <span className="t-mono">{short(p.resultHash)}</span>
      </p>
    </div>
  );
}
