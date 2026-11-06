/*
 * /fights/:tournament/:match: the ring on the left, betting on the right, dialogue below. PRD UI-08.
 * The fight is the recorded transcript the 0G judges and fighters produced for these two
 * projects (backend /api/arena/fights). Until it is recorded and revealed, the ring waits.
 * Bets go to the chain.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card, StatusPill } from "@ds/ui.jsx";
import { FightStage } from "../fight/FightStage.jsx";
import { stateAt } from "../fight/reducer.js";
import { CRITERION_LABEL, fmtHealth } from "../fight/score.js";
import { useFightSound } from "../fight/useFightSound.js";
import { eventDuration } from "../fight/choreo.js";
import { usePlayback } from "../fight/usePlayback.js";
import { usePoll } from "../lib/chain.js";
import { getFight, loadTournament } from "../lib/arena.js";
import { findMockTournament } from "../lib/demoArena.js";
import { MATCH_LABEL } from "../lib/labels.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { POOL_LABEL, matchMarket } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { isMatchOpen } from "../lib/tournamentView.js";
import { BetPanel, SamplePool } from "./BetPanel.jsx";
import { useCountdown } from "./ChainBits.jsx";

const SAY = { pitch: "pitches", question: "asks", answer: "answers", challenge: "challenges", rebuttal: "replies", closing: "closes" };
const INTRO = { seq: 1, ts: new Date(0).toISOString(), type: "intro" };
const NOT_STARTED = stateAt([INTRO], INTRO.seq);

const fighterOf = (p) => ({ id: p.id, name: p.name, tracks: p.tracks ?? [], pitch: p.pitch, fighterSeed: p.fighterSeed, seed: p.seed });

function matchFor(tournament, match, fight, a, b) {
  return {
    id: `${tournament.id}-${match.index}`,
    title: match.roundName,
    event: tournament.title,
    fighters: { a: fighterOf(a), b: fighterOf(b) },
    judges: fight?.judges ?? {},
  };
}

function Stage({ tournament, match, fight, a, b }) {
  const fightMatch = useMemo(() => matchFor(tournament, match, fight, a, b), [tournament, match, fight, a, b]);
  if (fight?.status === "done" && fight.events?.length && !(tournament.demo && match.status === "scheduled")) return <Player fightMatch={fightMatch} events={fight.events} fight={fight} />;
  return <PreFight tournament={tournament} match={match} fight={fight} fightMatch={fightMatch} />;
}

function PreFight({ tournament, match, fight, fightMatch }) {
  const revealMs = fight?.status === "sealed" ? fight.revealAt : null;
  const countdown = useCountdown(revealMs && revealMs > Date.now() ? revealMs : match.startMs > Date.now() ? match.startMs : null);
  const open = isMatchOpen(tournament, match);
  let title = "The fight hasn't started";
  let note;
  if (!match.opened) note = "The organizer hasn't opened this match yet.";
  else if (open) note = "Bets are open now. They close before the first bell, so place yours before the fight.";
  else if (tournament.demo) note = "This demo fight hasn't started.";
  else if (fight?.status === "running") (title = "The judges are in session"), (note = `The fighters are arguing live on 0G: ${fight.note ?? "starting"}. The replay appears here when it is sealed.`);
  else if (fight?.status === "sealed") (title = "Fight recorded"), (note = "The fight has been judged. The replay unlocks when betting closes.");
  else if (fight?.status === "failed") (title = "The fight hit a problem"), (note = `The organizer will run it again. (${fight.error})`);
  else note = "Betting is closed. The organizer runs the fight next.";
  return (
    <div className="stack">
      <FightStage match={fightMatch} state={NOT_STARTED} event={INTRO} ms={eventDuration(INTRO)} reduced captions={false} typing={false} />
      <Card variant="surface" className="stack">
        <div className="section-head">
          <h2 className="t-heading m0">{title}</h2>
          {countdown && countdown.left > 0 && (
            <span className="t-caption t-num">
              {revealMs ? "Replay in" : "Starts in"} <b>{countdown.text}</b>
            </span>
          )}
        </div>
        <p className="t-body m0 muted">{note}</p>
      </Card>
    </div>
  );
}

function Player({ fightMatch, events, fight }) {
  const pb = usePlayback(events, {});
  const sound = useFightSound(events, pb);
  const state = useMemo(() => stateAt(events, events[pb.index].seq), [events, pb.index]);
  const [reduced] = useState(() => !!prefersReducedMotion());
  const lines = state.log.filter((e) => SAY[e.type]).slice(-4).reverse();
  const who = (e) => fightMatch.fighters[e.actor]?.name ?? `Judge ${fightMatch.judges[e.actor]?.name ?? ""}`;
  const proof = pb.event?.proof;

  return (
    <div className="stack">
      <FightStage match={fightMatch} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions typing={pb.playing} />
      <div className="fight-controls">
        <button type="button" className="btn btn--secondary btn--sm" onClick={sound.togglePlay}>
          {pb.playing ? "Pause" : "Play"}
        </button>
        <input
          className="fight-seek"
          type="range"
          min={0}
          max={events.length - 1}
          value={pb.index}
          onChange={(e) => pb.seek(Number(e.target.value))}
          aria-label="Seek through the match"
          aria-valuetext={state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}
        />
        <span className="t-caption t-num fight-controls__health">
          {fmtHealth(state.health.a)} · {fmtHealth(state.health.b)} HP
        </span>
        <button type="button" className="fd__toggle" aria-pressed={!sound.muted} onClick={sound.toggleMute}>
          Sound
        </button>
      </div>
      <Card variant="surface" className="stack">
        <div className="section-head">
          <h2 className="t-heading m0">{state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}</h2>
          {!fight.demo && <StatusPill tone="reward">Judged on 0G</StatusPill>}
        </div>
        {lines.length ? (
          <ol className="fight-lines">
            <AnimatePresence initial={false} mode="popLayout">
              {lines.map((e) => (
                <motion.li key={e.seq} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <span className="t-label">
                    {who(e)} {SAY[e.type]}
                  </span>
                  <span className="t-body">{e.text}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        ) : (
          <p className="t-body muted m0">Nothing said yet. Press play.</p>
        )}
        <p className="t-caption m0 t-mono">
          {proof?.requestId ? `0G request ${proof.requestId}${proof.teeVerified ? " · TEE verified" : ""}` : `${fight.calls ?? "Many"} 0G calls · ${fight.fighters?.a?.fighterName ?? "A"} vs ${fight.fighters?.b?.fighterName ?? "B"}`}
        </p>
      </Card>
    </div>
  );
}

function Layout({ tournament, match, side, fight }) {
  const a = match.a != null ? tournament.projects[match.a] : null;
  const b = match.b != null ? tournament.projects[match.b] : null;
  const label = isMatchOpen(tournament, match) ? POOL_LABEL.OPEN : MATCH_LABEL[match.status];
  return (
    <div className="stack stack--page">
      <Link to={`/tournaments/${tournament.id}`} className="back btn btn--ghost btn--sm">
        ← {tournament.title}
      </Link>
      <header className="intro intro--row">
        <div className="intro">
          <span className="t-caption">
            {match.roundName} · Match {match.index + 1}
          </span>
          <h1 className="t-display-lg m0 rise">
            {a?.name ?? "To be decided"} <span className="muted">vs</span> {b?.name ?? "To be decided"}
          </h1>
        </div>
        <StatusPill tone={label.tone}>{label.word}</StatusPill>
      </header>
      {match.status === "review" && (
        <motion.div className="notice" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Both rounds tied. Awaiting the organizer's decision; advancement and payouts are paused until then.</span>
        </motion.div>
      )}
      <div className="fight-layout">
        <div className="fight-layout__stage">
          {a && b ? (
            <Stage tournament={tournament} match={match} fight={fight} a={a} b={b} />
          ) : (
            <Card variant="surface" className="empty">
              <span className="t-body muted">The fighters for this match aren't decided yet.</span>
            </Card>
          )}
        </div>
        <aside className="fight-layout__side">{side(a, b)}</aside>
      </div>
    </div>
  );
}

function NoFight() {
  return (
    <Card variant="surface" className="empty">
      <span className="t-body muted">We couldn't find that fight.</span>
      <Link className="btn btn--secondary btn--sm" to="/arena">
        Back to the arena
      </Link>
    </Card>
  );
}

export function MatchFightPage({ id, matchIndex, wallet }) {
  const { data: t, loading } = usePoll(() => loadTournament(id), [id], 10000);
  const { data: fight } = usePoll(() => getFight(id, matchIndex).catch(() => null), [id, matchIndex], 4000);
  if (!/^\d+$/.test(id) && !findMockTournament(id)) return <NoFight />;
  if (loading && !t) return <div className="skeleton skeleton--seat" aria-label="Loading match" />;
  const match = t?.matches[matchIndex];
  if (!match) return <NoFight />;
  return (
    <Layout
      tournament={t}
      match={match}
      fight={fight}
      side={(a, b) =>
        t.demo ? (
          <SamplePool
            title="Who wins this match?"
            total={Math.round((t.poolTotal ?? 0) / t.count)}
            selections={[
              { id: match.a, project: a },
              { id: match.b, project: b },
            ]}
            shares={[35 + ((matchIndex * 13) % 31), 100 - (35 + ((matchIndex * 13) % 31))]}
          />
        ) : match.opened ? (
          <BetPanel
            wallet={wallet}
            tournamentId={t.id}
            market={matchMarket(t.id, matchIndex)}
            title="Who wins this match?"
            selections={[
              { id: match.a, project: a },
              { id: match.b, project: b },
            ]}
          />
        ) : (
          <Card variant="surface">
            <p className="t-body m0 muted">This match's pool isn't open yet.</p>
          </Card>
        )
      }
    />
  );
}
