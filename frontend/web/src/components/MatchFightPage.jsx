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
import { MATCH_LABEL } from "../lib/labels.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { usePayouts } from "../lib/payouts.js";
import { POOL_LABEL, matchMarket, percent, settledResult } from "../lib/pools.js";
import { Link, navigate } from "../lib/router.jsx";
import { chainBetPool, isMatchOpen } from "../lib/tournamentView.js";
import { BetPanel, usePoolData } from "./BetPanel.jsx";
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

const canPlay = (fight) => fight?.status === "done" && fight.events?.length > 0;

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
  else if (fight?.status === "running") (title = open ? "The fight hasn't started" : "The judges are finishing"), (note = open ? "Bets are open. The fight plays when betting closes." : "The fight plays here as soon as the judges finish.");
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
          <StatusPill tone="reward">Judged on 0G</StatusPill>
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

/** The game view after a bet: the ring at 90% of the screen. What the wallet won comes from the chain, never from the replay. */
function Theater({ tournament, match, fight, a, b, wallet, onClose }) {
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
  const ready = canPlay(fight);
  const happening = ready || fight?.status === "running";
  const info = useToken();
  const payouts = usePayouts();
  const selections = useMemo(() => [{ id: match.a, project: a }, { id: match.b, project: b }], [match.a, match.b, a, b]);
  const { data } = usePoolData(wallet, tournament.id, matchMarket(tournament.id, match.index), selections);
  const [fought, setFought] = useState(false);
  const [run, setRun] = useState(0);
  const onResult = useCallback(() => setFought(true), []);
  const fmt = (v) => formatAmount(v, info.decimals);
  const betIndex = data ? data.mine.findIndex((v) => v > 0n) : -1;
  const bet = data && info && betIndex >= 0 ? { amount: fmt(data.mine[betIndex]), symbol: info.symbol, name: selections[betIndex].project.name } : null;
  const finalized = match.status === "finalized";
  const settled = fought && finalized && data && info ? settledResult({ stakes: data.stakes, mine: data.mine, winnerIndex: match.winner === match.a ? 0 : 1 }) : null;
  const outcome = settled && { kind: settled.kind, amount: fmt(settled.amount), winner: match.winner === match.a ? a.name : b.name, paid: data.paid, auto: payouts.enabled };
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
            {happening ? <span className="live-dot" aria-hidden="true" /> : null} {happening ? "Live" : "Waiting"}
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
            <p className="theater__note t-body">{fight?.status === "running" ? "The judges are finishing. The fight plays here as soon as they're done." : "Your bet is in. The fight plays here when it starts."}</p>
          </div>
        )}
        {fought && !finalized && <p className="theater__note t-body">The fight is over. The result is being published on chain.</p>}
        {outcome && <ResultCard outcome={outcome} bet={bet} onClose={onClose} onReplay={() => { setFought(false); setRun((n) => n + 1); }} />}
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
  const won = outcome.kind === "won";
  const refund = outcome.kind === "refund";
  useEffect(() => {
    if (won) winConfetti();
  }, [won]);
  return (
    <motion.div className="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        className={`result__card ${won ? "is-won" : ""}`}
        role="alertdialog"
        aria-labelledby="result-title"
        initial={{ opacity: 0, y: 20, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 22 }}
      >
        <p className="result__eyebrow">{outcome.winner} wins</p>
        <h2 id="result-title" className="result__title">
          {won ? "You won" : refund ? "Your bet comes back" : "Not this time"}
        </h2>
        {won || refund ? (
          <p className="result__amount t-num">
            +{outcome.amount} <span>{bet.symbol}</span>
          </p>
        ) : (
          <p className="result__lost t-num">
            Your {bet.amount} {bet.symbol} on {bet.name} didn't land.
          </p>
        )}
        <p className="result__fine t-num">
          {outcome.paid
            ? "Paid to your wallet."
            : won || refund
              ? outcome.auto
                ? "It's being sent to your wallet automatically."
                : "Collect it on the fight page."
              : "Winners are paid from this pool."}
        </p>
        <div className="result__actions">
          <button type="button" className="bm__go" onClick={() => navigate("/tournaments")}>
            {won ? "Bet on the next fight" : "Try another fight"}
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
  const betIndex = data.mine.findIndex((v) => v > 0n);
  const mine = betIndex >= 0 ? { amount: formatAmount(data.mine[betIndex], info.decimals), symbol: info.symbol, name: pool.selections[betIndex].project.name } : null;
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
  const { data: t, loading, error } = usePoll(() => loadTournament(id), [id], 10000);
  const { data: fight } = usePoll(() => getFight(id, matchIndex).catch(() => null), [id, matchIndex], 4000);
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
