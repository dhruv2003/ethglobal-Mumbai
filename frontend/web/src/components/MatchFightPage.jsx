/*
 * /fights/:tournament/:match: the ring on the left, betting on the right, dialogue below. PRD UI-08.
 * The fight itself is Aryan's player running the mock match until real fights exist.
 * Bets are real on on-chain tournaments.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card, StatusPill } from "@ds/ui.jsx";
import { FightStage } from "../fight/FightStage.jsx";
import { MOCK_EVENTS, MOCK_MATCH } from "../fight/mockFight.js";
import { stateAt } from "../fight/reducer.js";
import { CRITERION_LABEL, fmtHealth } from "../fight/score.js";
import { useFightSound } from "../fight/useFightSound.js";
import { usePlayback } from "../fight/usePlayback.js";
import { readTournament, usePoll } from "../lib/chain.js";
import { MATCH_LABEL, findMockTournament } from "../lib/mockArena.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { matchMarket } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { viewOfChain } from "../lib/tournamentView.js";
import { BetPanel, SamplePool } from "./BetPanel.jsx";

const SAY = { pitch: "pitches", question: "asks", answer: "answers", challenge: "challenges", rebuttal: "replies", closing: "closes" };

function Stage({ tournament, match }) {
  const a = tournament.projects[match.a];
  const b = tournament.projects[match.b];
  const fightMatch = useMemo(
    () => ({
      ...MOCK_MATCH,
      event: tournament.title,
      title: match.roundName,
      fighters: {
        a: { ...MOCK_MATCH.fighters.a, ...a },
        b: { ...MOCK_MATCH.fighters.b, ...b },
      },
    }),
    [tournament.title, match.roundName, a, b],
  );
  const pb = usePlayback(MOCK_EVENTS, {});
  const sound = useFightSound(MOCK_EVENTS, pb);
  const state = useMemo(() => stateAt(MOCK_EVENTS, MOCK_EVENTS[pb.index].seq), [pb.index]);
  const [reduced] = useState(() => !!prefersReducedMotion());
  const lines = state.log.filter((e) => SAY[e.type]).slice(-4).reverse();
  const who = (e) => fightMatch.fighters[e.actor]?.name ?? `Judge ${fightMatch.judges[e.actor]?.name ?? ""}`;

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
          max={MOCK_EVENTS.length - 1}
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
          <StatusPill tone="neutral">Demo fight</StatusPill>
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
        <p className="t-caption m0">This fight is a demo recording, not generated from these projects yet.</p>
      </Card>
    </div>
  );
}

function Layout({ tournament, match, side }) {
  const a = match.a != null ? tournament.projects[match.a] : null;
  const b = match.b != null ? tournament.projects[match.b] : null;
  const label = MATCH_LABEL[match.status];
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
          <span>Awaiting organizer decision. Advancement and payouts are paused until then.</span>
        </motion.div>
      )}
      <div className="fight-layout">
        <div className="fight-layout__stage">{a && b ? <Stage tournament={tournament} match={match} /> : <Card variant="surface" className="empty"><span className="t-body muted">The fighters for this match aren't decided yet.</span></Card>}</div>
        <aside className="fight-layout__side">{side(a, b)}</aside>
      </div>
    </div>
  );
}

function ChainFight({ id, matchIndex, wallet }) {
  const { data, loading } = usePoll(() => readTournament(id), [id], 10000);
  if (loading && !data) return <div className="skeleton skeleton--seat" aria-label="Loading match" />;
  const t = data ? viewOfChain(data) : null;
  const match = t?.matches[matchIndex];
  if (!match) return <NoFight />;
  return (
    <Layout
      tournament={t}
      match={match}
      side={(a, b) =>
        match.opened ? (
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
          <Card variant="surface"><p className="t-body m0 muted">This match's pool isn't open yet.</p></Card>
        )
      }
    />
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
  if (/^\d+$/.test(id)) return <ChainFight id={id} matchIndex={matchIndex} wallet={wallet} />;
  const t = findMockTournament(id);
  const match = t?.matches[matchIndex];
  if (!match) return <NoFight />;
  const shareA = 35 + ((matchIndex * 13) % 31);
  return (
    <Layout
      tournament={t}
      match={match}
      side={(a, b) =>
        a && b ? (
          <SamplePool
            title="Who wins this match?"
            total={Math.round(t.poolTotal / t.count)}
            selections={[
              { id: match.a, project: a },
              { id: match.b, project: b },
            ]}
            shares={[shareA, 100 - shareA]}
          />
        ) : null
      }
    />
  );
}
