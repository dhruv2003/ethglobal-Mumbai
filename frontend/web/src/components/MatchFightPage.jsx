/*
 * /fights/:tournament/:match: the ring on the left, betting on the right, dialogue below. PRD UI-08.
 * The fight is the recorded transcript the 0G judges and fighters produced for these two
 * projects (backend /api/arena/fights). Until it is recorded and revealed, the ring waits.
 * Bets go to the chain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Card, OddsBar, StatusPill } from "@ds/ui.jsx";
import { FightStage } from "../fight/FightStage.jsx";
import { stateAt } from "../fight/reducer.js";
import { CRITERION_LABEL, fmtHealth } from "../fight/score.js";
import { useFightSound } from "../fight/useFightSound.js";
import { eventDuration } from "../fight/choreo.js";
import { useReel } from "../fight/usePlayback.js";
import { formatAmount, usePoll, useToken } from "../lib/chain.js";
import { getFight, loadTournament } from "../lib/arena.js";
import { findMockTournament } from "../lib/demoArena.js";
import { MATCH_LABEL } from "../lib/labels.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { POOL_LABEL, matchMarket, percent } from "../lib/pools.js";
import { Link, navigate } from "../lib/router.jsx";
import { chainBetPool, isMatchOpen } from "../lib/tournamentView.js";
import { PRACTICE_SYMBOL, isPracticeOpen, lastBet, matchBetPool, settlePractice } from "../lib/practice.js";
import { BetPanel, SamplePool, usePoolData } from "./BetPanel.jsx";
import { BetModal } from "./BetModal.jsx";
import { easeOut } from "./fx.jsx";
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
  const open = isMatchOpen(tournament, match) || isPracticeOpen(tournament, match);
  let title = "The fight hasn't started";
  let note;
  if (open) note = "Bets are open. Place yours and the fight opens full screen.";
  else if (!match.opened && !tournament.demo) note = "The organizer hasn't opened this match yet.";
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

function Player({ fightMatch, events, fight, theater = false, onResult }) {
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

/** The game view after a bet: the ring at 90% of the screen, nothing else in the way. */
function Theater({ tournament, match, fight, a, b, bet, onClose }) {
  const fightMatch = useMemo(() => matchFor(tournament, match, fight, a, b), [tournament, match, fight, a, b]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("no-scroll");
    };
  }, [onClose]);
  const ready = fight?.status === "done" && fight.events?.length;
  const [outcome, setOutcome] = useState(null);
  const [run, setRun] = useState(0);
  const onResult = useCallback(
    (winnerSide) => {
      if (!bet) return;
      const won = bet.side === winnerSide;
      let amount = bet.payout;
      let balance = null;
      if (bet.practice) {
        const settled = settlePractice(bet.market, winnerSide === "a" ? match.a : match.b);
        if (settled.won) amount = settled.won.toLocaleString("en-US");
        balance = settled.balance.toLocaleString("en-US");
      }
      setOutcome({ won, winner: winnerSide === "a" ? a.name : b.name, amount, balance });
    },
    [bet, match.a, match.b, a.name, b.name],
  );
  return createPortal(
    <motion.div className="theater" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="theater__frame"
        role="dialog"
        aria-modal="true"
        aria-label={`${a.name} vs ${b.name}`}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: easeOut }}
      >
        <header className="theater__bar">
          <span className="theater__live">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
          <span className="theater__title">
            {a.name} <span className="muted">vs</span> {b.name}
          </span>
          {bet && (
            <span className="theater__bet t-num">
              Your bet · {bet.amount} {bet.symbol} on <b>{bet.name}</b>
            </span>
          )}
          <button type="button" className="bm__close" aria-label="Close the fight view" onClick={onClose}>
            ×
          </button>
        </header>
        {ready ? (
          <Player key={run} fightMatch={fightMatch} events={fight.events} fight={fight} theater onResult={onResult} />
        ) : (
          <div className="theater__stage theater__stage--wait">
            <FightStage match={fightMatch} state={NOT_STARTED} event={INTRO} ms={eventDuration(INTRO)} reduced captions={false} typing={false} fit />
            <p className="theater__note t-body">{fight?.status === "running" ? "The judges are in session. The fight plays here the moment it's sealed." : "Your bet is in. The fight plays here when it starts."}</p>
          </div>
        )}
        {outcome && <ResultCard outcome={outcome} bet={bet} onClose={onClose} onReplay={() => { setOutcome(null); setRun((n) => n + 1); }} />}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

const BURST = ["#ffd43b", "#ff5c93", "#2f4bf0", "#17141f"];

/** Two bursts from the sides, then a rain from the top. Skipped for reduced motion. */
function winConfetti() {
  if (prefersReducedMotion()) return;
  const opts = { particleCount: 70, spread: 65, startVelocity: 55, colors: BURST, zIndex: 120, disableForReducedMotion: true };
  confetti({ ...opts, angle: 60, origin: { x: 0.08, y: 0.75 } });
  confetti({ ...opts, angle: 120, origin: { x: 0.92, y: 0.75 } });
  setTimeout(() => confetti({ ...opts, particleCount: 120, spread: 140, startVelocity: 30, origin: { x: 0.5, y: 0.1 } }), 350);
}

/** What the bettor sees when the fight ends: the win (with confetti) or a quiet loss. */
function ResultCard({ outcome, bet, onClose, onReplay }) {
  useEffect(() => {
    if (outcome.won) winConfetti();
  }, [outcome.won]);
  return (
    <motion.div className="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        className={`result__card ${outcome.won ? "is-won" : ""}`}
        role="alertdialog"
        aria-labelledby="result-title"
        initial={{ opacity: 0, y: 20, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 22 }}
      >
        <p className="result__eyebrow">{outcome.winner} wins</p>
        <h2 id="result-title" className="result__title">
          {outcome.won ? "You won" : "Not this time"}
        </h2>
        {outcome.won ? (
          <p className="result__amount t-num">
            +{outcome.amount} <span>{bet.symbol}</span>
          </p>
        ) : (
          <p className="result__lost t-num">
            Your {bet.amount} {bet.symbol} on {bet.name} didn't land.
          </p>
        )}
        <p className="result__fine t-num">
          {bet.practice
            ? `Balance ${outcome.balance} ${bet.symbol}`
            : outcome.won
              ? "Claim it on the fight page once the pool settles."
              : "Pools pay out once the organizer settles them."}
        </p>
        <div className="result__actions">
          <button type="button" className="bm__go" onClick={() => navigate("/tournaments")}>
            {outcome.won ? "Bet on the next fight" : "Try another fight"}
          </button>
          <button type="button" className="result__link" onClick={onReplay}>
            Watch the replay
          </button>
          <button type="button" className="result__link" onClick={onClose}>
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Minimal side card: who's ahead, pool size, one button. The bet itself happens in the popup. */
function BetCard({ shares, names, total, symbol, mine, onBet, onWatch, live }) {
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
      <button type="button" className="btn btn--ghost btn--sm" onClick={onWatch}>
        Watch full screen
      </button>
    </Card>
  );
}

function PracticeBetCard({ pool, ...rest }) {
  const total = pool.stakes[0] + pool.stakes[1];
  const pctA = total ? Math.round((pool.stakes[0] / total) * 100) : 50;
  return <BetCard shares={[pctA, 100 - pctA]} names={pool.selections.map((s) => s.project.name)} total={total.toLocaleString("en-US")} symbol={PRACTICE_SYMBOL} {...rest} />;
}

function ChainBetCard({ pool, wallet, ...rest }) {
  const info = useToken();
  const { data } = usePoolData(wallet, pool.tournamentId, pool.market, pool.selections);
  if (!data || !info) return <Card className="bet"><div className="skeleton bet__skeleton" aria-label="Loading pool" /></Card>;
  const total = data.pool.total;
  const pctA = total > 0n ? Math.round(percent(data.stakes[0], total)) : 50;
  return <BetCard shares={[pctA, 100 - pctA]} names={pool.selections.map((s) => s.project.name)} total={formatAmount(total, info.decimals)} symbol={info.symbol} {...rest} />;
}

function Layout({ tournament, match, side, fight, theater }) {
  const a = match.a != null ? tournament.projects[match.a] : null;
  const b = match.b != null ? tournament.projects[match.b] : null;
  const practiceOpen = isPracticeOpen(tournament, match);
  const label = isMatchOpen(tournament, match) || practiceOpen ? POOL_LABEL.OPEN : MATCH_LABEL[match.status];
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
      </header>
      {match.status === "review" && (
        <motion.div className="notice" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Tied twice. Waiting for the organizer to decide. Payouts are paused.</span>
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
      <AnimatePresence>{a && b && theater.open && <Theater tournament={tournament} match={match} fight={fight} a={a} b={b} bet={theater.bet} onClose={theater.close} />}</AnimatePresence>
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

const wantsWatch = () => new URLSearchParams(location.search).has("watch");

export function MatchFightPage({ id, matchIndex, wallet }) {
  const { data: t, loading } = usePoll(() => loadTournament(id), [id], 10000);
  const { data: fight } = usePoll(() => getFight(id, matchIndex).catch(() => null), [id, matchIndex], 4000);
  const poolKey = `${id}-${matchIndex}`;
  const [watching, setWatching] = useState(wantsWatch);
  const [bet, setBet] = useState(() => lastBet(poolKey));
  const [betting, setBetting] = useState(null);
  const closeBet = useCallback(() => setBetting(null), []);
  const closeTheater = useCallback(() => {
    setWatching(false);
    if (wantsWatch()) history.replaceState({}, "", location.pathname);
  }, []);
  if (!/^\d+$/.test(id) && !findMockTournament(id)) return <NoFight />;
  if (loading && !t) return <div className="skeleton skeleton--seat" aria-label="Loading match" />;
  const match = t?.matches[matchIndex];
  if (!match) return <NoFight />;

  const practiceOpen = isPracticeOpen(t, match);
  const chainOpen = isMatchOpen(t, match);
  const placed = (b) => {
    setBet(b);
    setBetting(null);
    setWatching(true);
  };
  const cardProps = (pool) => ({ pool, live: match.status === "live", mine: bet, onBet: () => setBetting(pool), onWatch: () => setWatching(true) });

  return (
    <>
      <Layout
        tournament={t}
        match={match}
        fight={fight}
        theater={{ open: watching, bet, close: closeTheater }}
        side={(a, b) =>
          a && b && practiceOpen ? (
            <PracticeBetCard {...cardProps(matchBetPool(t, matchIndex, { practice: true }))} />
          ) : a && b && chainOpen ? (
            <ChainBetCard wallet={wallet} {...cardProps(chainBetPool(t, match))} />
          ) : t.demo ? (
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
      <BetModal pool={betting} wallet={wallet} onClose={closeBet} onPlaced={placed} />
    </>
  );
}
