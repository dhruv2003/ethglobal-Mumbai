/*
 * /fights/:tournament/:match: the ring on the left, betting on the right, dialogue below. PRD UI-08.
 * The fight is the recorded transcript the 0G judges and fighters produced for these two
 * projects (backend /api/arena/fights). Until it is recorded and revealed, the ring waits.
 * Bets go to the chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card, OddsBar, StatusPill } from "@ds/ui.jsx";
import { formatAmount, usePoll, useToken } from "../lib/chain.js";
import { cachedTournament, getFight, loadTournament } from "../lib/arena.js";
import { MATCH_LABEL } from "../lib/labels.js";
import { POOL_LABEL, matchMarket, percent } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { chainBetPool, isMatchOpen } from "../lib/tournamentView.js";
import { BetPanel, myBet, usePoolData } from "./BetPanel.jsx";
import { BetModal } from "./BetModal.jsx";
import { useCountdown } from "./ChainBits.jsx";
import { Player, WaitingRing, canPlay, matchFor } from "./FightPlayer.jsx";
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
    const winner = tournament.projects[match.winner]?.name ?? "The winning project";
    return (
      <Card variant="surface" className="stack">
        <StatusPill tone="success">Finalized on chain</StatusPill>
        <h2 className="t-heading m0">{winner} won</h2>
        <p className="t-body m0 t-num">{fightMatch.fighters.a.name} {(match.scoreA / 100).toFixed(2)} · {fightMatch.fighters.b.name} {(match.scoreB / 100).toFixed(2)}</p>
        <p className="t-body m0 muted">The published result is final. No recorded fight replay is available for this match.</p>
      </Card>
    );
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

/** Minimal side card: who's ahead, pool size, one button. The bet itself happens in the popup. */
function BetCard({ shares, names, total, symbol, mine, onBet, live }) {
  return (
    <Card className="bet bet--mini">
      <div className="section-head">
        <h2 className="t-heading m0">Who wins this match?</h2>
        <StatusPill tone="live">{live ? "Live" : "Betting open"}</StatusPill>
      </div>
      <OddsBar yesPct={shares[0]} yesLabel={names[0]} noLabel={names[1]} />
      <div className="bet-mini__row">
        <span className="t-caption">Pool</span>
        <span className="t-body-strong t-num">
          {total} {symbol}
        </span>
      </div>
      {mine && (
        <div className="bet-mini__row">
          <span className="t-caption">Your bet</span>
          <span className="t-body-strong t-num">
            {mine.amount} {mine.symbol} on {mine.name}
          </span>
        </div>
      )}
      <button type="button" className="bm__go" onClick={onBet}>
        Place a bet
      </button>
    </Card>
  );
}

function ChainBetCard({ pool, wallet, ...rest }) {
  const info = useToken();
  const { data } = usePoolData(wallet, pool.tournamentId, pool.market, pool.selections);
  if (!data || !info) return <Card className="bet"><div className="skeleton bet__skeleton" aria-label="Loading pool" /></Card>;
  const total = data.pool.total;
  const pctA = total > 0n ? Math.round(percent(data.stakes[0], total)) : 50;
  const mine = myBet(data, info, pool.selections);
  return <BetCard shares={[pctA, 100 - pctA]} names={pool.selections.map((s) => s.project.name)} total={formatAmount(total, info.decimals)} symbol={info.symbol} mine={mine} {...rest} />;
}

function Layout({ tournament, match, side, fight, theater }) {
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
          <span className="org-roles">
            <StatusPill tone={label.tone}>{label.word}</StatusPill>
            <span className="t-caption">
              {match.roundName} · Match {match.index + 1}
            </span>
          </span>
          <h1 className="t-display-lg m0 rise">
            {a?.name ?? "To be decided"} <span className="muted">vs</span> {b?.name ?? "To be decided"}
          </h1>
        </div>
        {a && b && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={theater.watch}>
            Watch full screen
          </button>
        )}
      </header>
      {match.status === "review" && (
        <motion.div className="notice" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Tied twice. Waiting for the organizer to decide. Payouts are paused.</span>
        </motion.div>
      )}
      <div className="fight-layout">
        <div className="fight-layout__stage">
          {a && b ? (
            <Stage tournament={tournament} match={match} fight={fight} a={a} b={b} covered={theater.open} />
          ) : (
            <Card variant="surface" className="empty">
              <span className="t-body muted">The fighters for this match aren't decided yet.</span>
            </Card>
          )}
        </div>
        <aside className="fight-layout__side">{side(a, b)}</aside>
      </div>
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
        theater={{ open: watching, wallet, close: closeTheater, watch: () => setWatching(true) }}
        side={(a, b) =>
          a && b && chainOpen ? (
            <ChainBetCard wallet={wallet} pool={chainBetPool(t, match)} live={match.status === "live"} onBet={() => setBetting(chainBetPool(t, match))} />
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
      <BetModal pool={betting} wallet={wallet} onClose={closeBet} onPlaced={placed} />
    </>
  );
}
