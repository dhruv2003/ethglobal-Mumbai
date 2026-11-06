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
import { myBet, usePoolData } from "./BetPanel.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { BetModal } from "./BetModal.jsx";
import { useCountdown } from "./ChainBits.jsx";
import { Player, Verdict, WaitingRing, canPlay, matchFor } from "./FightPlayer.jsx";
import { Theater } from "./FightTheater.jsx";
import { StartCountdown } from "./StartCountdown.jsx";
import { CrowdChat } from "./CrowdChat.jsx";
import { useRecentBets } from "../lib/bets.js";

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
  let title = "Sealed until betting closes";
  let note;
  if (open) note = "Pick a side. The fight starts when betting closes.";
  else if (!match.opened) note = "The organizer hasn't opened this match yet.";
  else if (fight?.status === "running") (title = "The judges are finishing"), (note = "The fight plays here as soon as the judges finish.");
  else if (fight?.status === "sealed") (title = "Fight recorded"), (note = "The fight has been judged. The replay unlocks when betting closes.");
  else if (fight?.status === "failed") (title = "The fight hit a problem"), (note = `The organizer will run it again. (${fight.error})`);
  else note = "Betting is closed. The organizer runs the fight next.";
  return (
    <div className="prefight">
      <div className="prefight__ring">
        <WaitingRing match={fightMatch} />
        <StartCountdown at={revealMs ?? (open ? match.cutoffMs : null)} />
      </div>
      <div className="prefight-status">
        <span className="prefight-status__icon" aria-hidden="true">
          {open ? "🔒" : "⏳"}
        </span>
        <span className="prefight-status__text">
          <b>{title}</b>
          <span>{note}</span>
        </span>
        {countdown && countdown.left > 0 && (
          <span className="prefight-status__clock t-num">
            <small>Starts in</small> {countdown.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** The panel for this fight: three judges, each with their lens. */
function JudgesRow({ judges }) {
  const list = Object.entries(judges ?? {});
  if (!list.length) return null;
  return (
    <ul className="fjudges m0" aria-label="The judges">
      <li className="fjudges__label">Judged by</li>
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

const R = 66;
const C = 2 * Math.PI * R;
const GAP = 6;

/** Where the pool went: a donut split between the two fighters, each arc wearing its fighter. */
function PoolDonut({ pctA, a, b, total, symbol }) {
  const lenA = Math.max(0, (pctA / 100) * C - GAP);
  const lenB = Math.max(0, ((100 - pctA) / 100) * C - GAP);
  const pos = (frac) => {
    const ang = -Math.PI / 2 + frac * 2 * Math.PI;
    return { left: `${50 + 41 * Math.cos(ang)}%`, top: `${50 + 41 * Math.sin(ang)}%` };
  };
  return (
    <div className="pdonut" role="img" aria-label={`${a.name} ${pctA}% of the pool, ${b.name} ${100 - pctA}%`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <g transform="rotate(-90 90 90)">
          <circle cx="90" cy="90" r={R} className="pdonut__track" />
          <motion.circle cx="90" cy="90" r={R} className="pdonut__arc pdonut__arc--a" initial={false} animate={{ strokeDasharray: `${lenA} ${C}`, strokeDashoffset: -GAP / 2 }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
          <motion.circle cx="90" cy="90" r={R} className="pdonut__arc pdonut__arc--b" initial={false} animate={{ strokeDasharray: `${lenB} ${C}`, strokeDashoffset: -((pctA / 100) * C + GAP / 2) }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        </g>
      </svg>
      <div className="pdonut__center">
        <span className="pdonut__total t-num">{total}</span>
        <span className="pdonut__unit">{symbol} pooled</span>
      </div>
      {pctA > 0 && (
        <span className="pdonut__face pdonut__face--a" style={pos(pctA / 200)}>
          <PixelFighter project={a} scale={2} label={a.name} />
        </span>
      )}
      {pctA < 100 && (
        <span className="pdonut__face pdonut__face--b" style={pos(pctA / 100 + (100 - pctA) / 200)}>
          <PixelFighter project={b} scale={2} label={b.name} />
        </span>
      )}
    </div>
  );
}

/** The crowd's call: the pool split, what each side pays, and one button. The wallet only comes up after a click. */
function PredictionCard({ wallet, tournament, match, a, b, onBet }) {
  const info = useToken();
  const selections = useMemo(() => [{ id: match.a, project: a }, { id: match.b, project: b }], [match.a, match.b, a, b]);
  const market = matchMarket(tournament.id, match.index);
  const { data } = usePoolData(wallet, tournament.id, market, selections);
  const open = isMatchOpen(tournament, match);
  const countdown = useCountdown(open ? match.cutoffMs : null);
  if (!match.opened) return null;
  const total = data?.pool?.total ?? 0n;
  const pctA = data && total > 0n ? Math.round(percent(data.stakes[0], total)) : 50;
  const fmt = (v) => (info ? formatAmount(v, info.decimals) : "–");
  const pays = (stake) => (stake > 0n ? (Number(total) / Number(stake)).toFixed(2) : "–");
  const bet = data && info ? myBet(data, info, selections) : null;
  const sides = [
    { key: "a", p: a, pct: pctA, stake: data?.stakes[0] ?? 0n },
    { key: "b", p: b, pct: 100 - pctA, stake: data?.stakes[1] ?? 0n },
  ];
  const fav = pctA === 50 ? null : pctA > 50 ? "a" : "b";
  return (
    <aside className="pcard" aria-labelledby="pcard-h">
      <header className="pcard__head">
        <h2 id="pcard-h" className="m0">Crowd prediction</h2>
        {open ? (
          <span className="pcard__clock t-num">
            <i aria-hidden="true" /> {countdown?.left > 0 ? `Closes in ${countdown.text}` : "Closing"}
          </span>
        ) : (
          <span className="pcard__clock pcard__clock--off">Betting closed</span>
        )}
      </header>
      <PoolDonut pctA={pctA} a={a} b={b} total={fmt(total)} symbol={info?.symbol ?? ""} />
      <ul className="pside m0">
        {sides.map((x) => (
          <li key={x.key} className={`pside__row pside__row--${x.key}`}>
            <span className="pside__key" aria-hidden="true" />
            <span className="pside__name">
              <b>{x.p.name}</b>
              <small className="t-num">
                {fmt(x.stake)} {info?.symbol} · pays {pays(x.stake)}×{fav === x.key && <span className="pside__fav">Crowd pick</span>}
              </small>
            </span>
            <span className="pside__pct t-num">{x.pct}%</span>
          </li>
        ))}
      </ul>
      {bet ? (
        <p className="pcard__mine m0">
          Your bet · <b className="t-num">{bet.amount} {bet.symbol}</b> on <b>{bet.name}</b>
        </p>
      ) : null}
      {open ? (
        <button type="button" className="btn btn--crush pcard__go" onClick={onBet}>
          {bet ? "Add to your bet" : "Place a bet"}
        </button>
      ) : null}
    </aside>
  );
}

/** The crowd's latest bets, as they land: this is what moves the odds. */
function BetTicker({ tournament, match, a, b, symbol }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);
  const bets = useRecentBets(tournament, match).slice(0, 4);
  if (!bets.length) return null;
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
  };
  return (
    <ul className="ticker ticker--list m0" aria-label="Latest bets">
      <li className="ticker__h">Latest bets</li>
      <AnimatePresence initial={false}>
        {bets.map((x) => (
          <motion.li key={x.txHash} layout initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className={`ticker__bet ticker__bet--${x.side} ${x.mine ? "is-mine" : ""}`}>
            <span className="ticker__who">{x.mine ? "You" : x.bettor}</span>
            <span className="t-num ticker__amt">
              {Number(x.amount).toLocaleString()} {symbol}
            </span>
            <span className="ticker__on">on {x.side === "a" ? a.name : b.name}</span>
            <span className="t-caption t-num muted">{ago(x.time)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
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
          <h1 className="t-display-lg m0 rise fight-title">
            <span className="fight-title__a">{a?.name ?? "To be decided"}</span> <span className="fight-title__vs">vs</span> <span className="fight-title__b">{b?.name ?? "To be decided"}</span>
          </h1>
          {tournament.taglines?.[match.index] && <p className="fight-tagline m0">{tournament.taglines[match.index]}</p>}
        </div>
        <div className="fight-head__side">
          <JudgesRow judges={fight?.judges} />
          {a && b && canPlay(fight) && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={theater.watch}>
              Watch full screen
            </button>
          )}
        </div>
      </header>
      {match.status === "review" && (
        <motion.div className="notice" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <span>Tied twice. Waiting for the organizer to decide. Payouts are paused.</span>
        </motion.div>
      )}
      {a && b ? (
        <div className={`fight-grid ${isMatchOpen(tournament, match) || match.opened ? "" : "fight-grid--solo"}`}>
          <div className="fight-grid__main">
            <Stage tournament={tournament} match={match} fight={fight} a={a} b={b} covered={theater.open} />
          </div>
          <div className="fight-side">
            <PredictionCard wallet={wallet} tournament={tournament} match={match} a={a} b={b} onBet={onBet} />
            {!theater.open && <CrowdChat tournament={tournament} match={match} a={a} b={b} symbol="FILTER" />}
          </div>
        </div>
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
