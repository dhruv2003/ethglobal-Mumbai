/*
 * /fights/:tournament/:match: demo-first. The two names, the three judges, the ring at full
 * width, then every hit with the judges' reason, then the verdict. Betting is a slim strip;
 * wallet prompts only appear once someone presses "Place a bet". PRD UI-08.
 * The fight is the recorded transcript the 0G judges and fighters produced for these two
 * projects (backend /api/arena/fights). Until it is recorded and revealed, the ring waits.
 * Bets go to the chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card, StatusPill } from "@ds/ui.jsx";
import { formatAmount, usePoll, useToken } from "../lib/chain.js";
import { cachedTournament, getFight, loadTournament } from "../lib/arena.js";
import { MATCH_LABEL } from "../lib/labels.js";
import { POOL_LABEL, matchMarket, percent } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { chainBetPool, isMatchOpen } from "../lib/tournamentView.js";
import { BetPanel, myBet, usePoolData } from "./BetPanel.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { BetModal } from "./BetModal.jsx";
import { useCountdown } from "./ChainBits.jsx";
import { Player, Verdict, WaitingRing, canPlay, matchFor } from "./FightPlayer.jsx";
import { Theater } from "./FightTheater.jsx";

function Stage({ tournament, match, fight, a, b, covered }) {
  const fightMatch = useMemo(() => matchFor(tournament, match, fight, a, b), [tournament, match, fight, a, b]);
  // The full-screen view plays the fight while it's open, so two copies never play at once.
  if (!covered && canPlay(fight)) return <Player fightMatch={fightMatch} events={fight.events} fight={fight} />;
  return <PreFight tournament={tournament} match={match} fight={fight} fightMatch={fightMatch} />;
}

function PreFight({ tournament, match, fight, fightMatch }) {
  const revealMs = fight?.status === "sealed" ? fight.revealAt : null;
  const countdown = useCountdown(revealMs && revealMs > Date.now() ? revealMs : match.startMs > Date.now() ? match.startMs : null);
  const open = isMatchOpen(tournament, match);
  if (match.status === "finalized") {
    return <Verdict fightMatch={fightMatch} fight={fight} winner={match.winner === match.a ? "a" : "b"} scores={{ a: match.scoreA, b: match.scoreB }} />;
  }
  let title = "The fight hasn't started";
  let note;
  if (open) note = "Bets are open. Place yours and the fight opens full screen.";
  else if (!match.opened) note = "The organizer hasn't opened this match yet.";
  else if (fight?.status === "running") (title = "The judges are finishing"), (note = "The fight plays here as soon as the judges finish.");
  else if (fight?.status === "sealed") (title = "Fight recorded"), (note = "The fight has been judged. The replay unlocks when betting closes.");
  else if (fight?.status === "failed") (title = "The fight hit a problem"), (note = `The organizer will run it again. (${fight.error})`);
  else note = "Betting is closed. The organizer runs the fight next.";
  return (
    <div className="stack">
      <WaitingRing match={fightMatch} />
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

/** The panel for this fight: three judges, each with their lens. */
function JudgesRow({ judges }) {
  const list = Object.entries(judges ?? {});
  if (!list.length) return null;
  return (
    <ul className="fjudges m0" aria-label="The judges">
      {list.map(([id, j]) => (
        <li key={id} className="fjudge">
          <span className="fjudge__face" aria-hidden="true">
            <PixelFighter project={{ seed: id, name: j.name, tracks: [] }} scale={2} />
          </span>
          <span className="fjudge__text">
            <span className="fjudge__name">{j.name}</span>
            <span className="fjudge__focus t-caption">{j.focus}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One line for betting: who the crowd backs, the pool, and a button. The wallet only comes up after a click. */
function BetStrip({ wallet, tournament, match, a, b, onBet }) {
  const info = useToken();
  const selections = useMemo(() => [{ id: match.a, project: a }, { id: match.b, project: b }], [match.a, match.b, a, b]);
  const market = matchMarket(tournament.id, match.index);
  const { data } = usePoolData(wallet, tournament.id, market, selections);
  const [mineOpen, setMineOpen] = useState(false);
  const open = isMatchOpen(tournament, match);
  if (!match.opened) return null;
  const total = data?.pool?.total ?? 0n;
  const pctA = data && total > 0n ? Math.round(percent(data.stakes[0], total)) : 50;
  const bet = data && info ? myBet(data, info, selections) : null;
  const mine = bet ? `${bet.amount} ${bet.symbol} on ${bet.name}` : null;
  return (
    <div className="betstrip">
      <span className="betstrip__odds" aria-label={`${a.name} ${pctA}%, ${b.name} ${100 - pctA}%`}>
        <span className="betstrip__name">{a.name}</span>
        <span className="betstrip__bar" aria-hidden="true">
          <span style={{ width: `${pctA}%` }} />
        </span>
        <span className="betstrip__name">{b.name}</span>
        <span className="t-caption t-num">
          {pctA}% · {100 - pctA}%
        </span>
      </span>
      <span className="betstrip__pool t-caption t-num">{data && info ? `Pool ${formatAmount(total, info.decimals)} ${info.symbol} · testnet` : "Testnet pool"}</span>
      {mine && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMineOpen((o) => !o)} aria-expanded={mineOpen}>
          Your bet: {mine}
        </button>
      )}
      {open ? (
        <button type="button" className="btn btn--crush btn--sm" onClick={onBet}>
          Place a bet
        </button>
      ) : (
        <StatusPill tone="neutral">Betting closed</StatusPill>
      )}
      {mine && mineOpen && (
        <div className="betstrip__mine">
          <BetPanel wallet={wallet} tournamentId={tournament.id} market={market} title="Your bet" selections={selections} />
        </div>
      )}
    </div>
  );
}

function Layout({ tournament, match, fight, theater, wallet, onBet }) {
  const a = match.a != null ? tournament.projects[match.a] : null;
  const b = match.b != null ? tournament.projects[match.b] : null;
  const label = isMatchOpen(tournament, match) ? POOL_LABEL.OPEN : MATCH_LABEL[match.status];
  return (
    <div className="stack stack--page fight-page">
      <Link to="/arena" className="back btn btn--ghost btn--sm">
        ← Arena
      </Link>
      <header className="fight-head">
        <div className="intro">
          <span className="org-roles">
            <StatusPill tone={label.tone}>{label.word}</StatusPill>
            <span className="t-caption">{tournament.title}</span>
          </span>
          <h1 className="t-display-lg m0 rise">
            {a?.name ?? "To be decided"} <span className="muted">vs</span> {b?.name ?? "To be decided"}
          </h1>
        </div>
        {a && b && canPlay(fight) && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={theater.watch}>
            Watch full screen
          </button>
        )}
      </header>
      <JudgesRow judges={fight?.judges} />
      {a && b && <BetStrip wallet={wallet} tournament={tournament} match={match} a={a} b={b} onBet={onBet} />}
      {match.status === "review" && (
        <motion.div className="notice" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Tied twice. Waiting for the organizer to decide. Payouts are paused.</span>
        </motion.div>
      )}
      {a && b ? (
        <Stage tournament={tournament} match={match} fight={fight} a={a} b={b} covered={theater.open} />
      ) : (
        <Card variant="surface" className="empty">
          <span className="t-body muted">The fighters for this match aren't decided yet.</span>
        </Card>
      )}
      <AnimatePresence>{a && b && theater.open && <Theater tournament={tournament} match={match} fight={fight} a={a} b={b} wallet={theater.wallet} onClose={theater.close} />}</AnimatePresence>
    </div>
  );
}

function NoFight({ word = "We couldn't find that fight." }) {
  return (
    <Card variant="surface" className="empty">
      <span className="t-body muted">{word}</span>
      <Link className="btn btn--secondary btn--sm" to="/arena">
        Back to the arena
      </Link>
    </Card>
  );
}

const wantsWatch = () => new URLSearchParams(location.search).has("watch");

export function MatchFightPage({ id, matchIndex, wallet }) {
  const { data: t, loading, error } = usePoll(() => loadTournament(id), [id], 10000, { key: `tournament:${id}`, initial: () => cachedTournament(id) });
  const { data: fight } = usePoll(() => getFight(id, matchIndex), [id, matchIndex], 4000, { key: `fight:${id}:${matchIndex}` });
  const [watching, setWatching] = useState(wantsWatch);
  const [betting, setBetting] = useState(null);
  const closeBet = useCallback(() => setBetting(null), []);
  // When the fight is ready to play, it opens full screen by itself, once.
  const autoOpened = useRef(false);
  const ready = canPlay(fight);
  useEffect(() => {
    if (ready && !autoOpened.current) {
      autoOpened.current = true;
      setWatching(true);
    }
  }, [ready]);
  const closeTheater = useCallback(() => {
    setWatching(false);
    if (wantsWatch()) history.replaceState({}, "", location.pathname);
  }, []);
  if (!/^\d+$/.test(id)) return <NoFight />;
  if (loading && !t) return <div className="skeleton skeleton--seat" aria-label="Loading match" />;
  if (error && !t) return <NoFight word="Couldn't read this fight from the chain. Retrying…" />;
  const match = t?.matches[matchIndex];
  if (!match) return <NoFight />;

  const chainOpen = isMatchOpen(t, match);
  const placed = () => {
    setBetting(null);
    setWatching(true);
  };

  return (
    <>
      <Layout
        tournament={t}
        match={match}
        fight={fight}
        wallet={wallet}
        onBet={() => chainOpen && setBetting(chainBetPool(t, match))}
        theater={{ open: watching, wallet, close: closeTheater, watch: () => setWatching(true) }}
      />
      <BetModal pool={betting} wallet={wallet} onClose={closeBet} onPlaced={placed} />
    </>
  );
}
