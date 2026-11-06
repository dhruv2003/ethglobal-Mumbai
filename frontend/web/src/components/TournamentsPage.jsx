/*
 * /tournaments: every event. /tournaments/:id: one event's bracket and tournament betting.
 * Everything here is read from the chain and the registered bracket. PRD UI-01, UI-02.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { Card, Chip, StatusPill } from "@ds/ui.jsx";
import { usePoll } from "../lib/chain.js";
import { loadTournament, loadTournaments } from "../lib/arena.js";
import { findMockTournament } from "../lib/demoArena.js";
import { MATCH_LABEL, PHASE_LABEL } from "../lib/labels.js";
import { POOL_LABEL, tournamentMarket } from "../lib/pools.js";
import { Link, navigate } from "../lib/router.jsx";
import { practicePools } from "../lib/practice.js";
import { BetModal } from "./BetModal.jsx";
import { isMatchOpen, openPools } from "../lib/tournamentView.js";
import { BetPanel, SamplePool } from "./BetPanel.jsx";
import { useCountdown } from "./ChainBits.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { Tilt, fadeUp, popIn, stagger } from "./fx.jsx";

const FILTERS = [
  ["all", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
];
const ORDER = { live: 0, upcoming: 1, completed: 2, canceled: 3 };

const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function TournamentCard({ t }) {
  const open = openPools(t).length > 0 || (t.demo && (t.phase === "live" || t.phase === "upcoming"));
  const label = open ? POOL_LABEL.OPEN : PHASE_LABEL[t.phase];
  const cta = t.demo && !open ? "View results" : open ? "Bet now" : t.phase === "live" ? "Watch" : t.phase === "upcoming" ? "View bracket" : "View results";
  return (
    <motion.div variants={fadeUp} layout>
      <Tilt className="tcard-tilt" sheen={false} max={4}>
        <Link to={`/tournaments/${t.id}`} className="tcard">
          <div className="tcard__parade" aria-hidden="true">
            {t.projects.slice(0, 4).map((p) => (
              <PixelFighter key={p.id} project={p} scale={2.5} label="" />
            ))}
          </div>
          <div className="tcard__body">
            <div className="section-head">
              <StatusPill tone={label.tone}>{label.word}</StatusPill>
              {!t.demo && <StatusPill tone="reward">On chain</StatusPill>}
            </div>
            <h2 className="t-heading m0">{t.title}</h2>
            <p className="t-caption m0 t-num">
              {t.count} projects · {when(t.startsAt)}
            </p>
            <span className="tcard__cta t-label">{cta} →</span>
          </div>
        </Link>
      </Tilt>
    </motion.div>
  );
}

function OpenPool({ pool, onBet }) {
  const countdown = useCountdown(pool.cutoffMs);
  const content = (
    <>
      {pool.fighters.length > 0 && (
        <span className="open-pool__fighters" aria-hidden="true">
          {pool.fighters.map((p) => (
            <PixelFighter key={p.id} project={p} scale={2} label="" />
          ))}
        </span>
      )}
      <span className="open-pool__text">
        <span className="t-body-strong">{pool.title}</span>
        <span className="t-caption">{pool.detail}</span>
      </span>
      <span className="t-caption t-num open-pool__clock">
        {pool.live ? (
          <span className="open-pool__live">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        ) : null}
        Closes in {countdown?.text}
      </span>
      <span className="btn btn--secondary btn--sm">Bet</span>
    </>
  );
  return (
    <motion.li variants={fadeUp} layout>
      {pool.selections ? (
        <button type="button" className="open-pool" onClick={() => onBet(pool)}>
          {content}
        </button>
      ) : (
        <Link to={pool.to} className="open-pool">
          {content}
        </Link>
      )}
    </motion.li>
  );
}

/** Everything you can bet on this second: real pools only, gone when their cutoff passes. */
function OpenForBetting({ tournaments, loaded, failed, wallet }) {
  const [betting, setBetting] = useState(null);
  const close = useCallback(() => setBetting(null), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Real chain pools first; the demo events take practice bets so there is always a live fight.
  const pools = useMemo(() => [...tournaments.flatMap((t) => openPools(t, now)), ...practicePools().slice(0, 6)], [tournaments, now]);
  return (
    <section className="stack" aria-label="Open for betting">
      <div className="section-head">
        <h2 className="t-heading m0">Open for betting</h2>
        {pools.length > 0 && <StatusPill tone="live">{pools.length} open</StatusPill>}
      </div>
      {pools.length > 0 ? (
        <motion.ol className="open-pools" variants={stagger(0.05)} initial="hidden" animate="show">
          {pools.map((pool) => (
            <OpenPool key={pool.key} pool={pool} onBet={setBetting} />
          ))}
        </motion.ol>
      ) : (
        <Card variant="surface" className="empty">
          <span className="t-body muted">{failed ? "Couldn't reach the chain. Retrying…" : loaded ? "Nothing is open for betting right now." : "Checking the chain…"}</span>
          {loaded && (
            <Link className="btn btn--secondary btn--sm" to="/organizer">
              Open a match in the organizer console
            </Link>
          )}
        </Card>
      )}
      <BetModal pool={betting} wallet={wallet} onClose={close} onPlaced={() => navigate(`${betting.to}?watch=1`)} />
    </section>
  );
}

export function TournamentsPage({ wallet }) {
  const [filter, setFilter] = useState("all");
  const { data: all, error } = usePoll(loadTournaments, [], 10000);
  const list = useMemo(() => [...(all ?? [])].sort((a, b) => ORDER[a.phase] - ORDER[b.phase]), [all]);
  const shown = filter === "all" ? list : list.filter((t) => t.phase === filter);
  const count = (id) => (id === "all" ? list.length : list.filter((t) => t.phase === id).length);
  const real = list;
  const chainList = all;

  return (
    <div className="stack stack--page">
      <header className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
            Tournaments
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
            Watch the brackets and bet on who wins.
          </p>
        </div>
        <Link className="btn btn--secondary" to="/arena">
          Open the arena map
        </Link>
      </header>
      <OpenForBetting wallet={wallet} tournaments={real} loaded={chainList != null} failed={!!error && chainList == null} />
      <h2 className="t-heading m0">All tournaments</h2>
      <div className="trade__presets" role="group" aria-label="Filter by status">
        {FILTERS.map(([id, word]) => (
          <Chip key={id} selected={filter === id} onClick={() => setFilter(id)}>
            {word} <span className="chip__count">{count(id)}</span>
          </Chip>
        ))}
      </div>
      <motion.div key={filter} className="tgrid" variants={stagger(0.06)} initial="hidden" animate="show">
        {shown.map((t) => (
          <TournamentCard key={t.id} t={t} />
        ))}
      </motion.div>
      {!shown.length && (
        <Card variant="surface" className="empty">
          <span className="t-body muted">{all == null ? "Checking the chain…" : filter === "all" ? "No tournaments yet. An organizer creates the first one." : `No ${filter} tournaments right now.`}</span>
          {all != null && filter === "all" && (
            <Link className="btn btn--secondary btn--sm" to="/organizer">
              Open the organizer console
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}

function BracketMatch({ t, match }) {
  const label = isMatchOpen(t, match) ? POOL_LABEL.OPEN : MATCH_LABEL[match.status];
  const name = (p) => (p == null ? "TBD" : t.projects[p].name);
  const line = (p) => (
    <span className={`bracket-line ${match.winner != null && match.winner === p ? "is-winner" : ""} ${match.winner != null && match.winner !== p ? "is-out" : ""}`}>
      {p != null ? <PixelFighter project={t.projects[p]} scale={1.2} label="" /> : <span className="bracket-line__empty" aria-hidden="true" />}
      <span className={`t-label ${p == null ? "muted" : ""}`}>{name(p)}</span>
      {match.winner != null && match.winner === p ? <span className="bracket-line__tick" aria-label="winner">★</span> : null}
    </span>
  );
  const canOpen = t.demo ? match.a != null && match.b != null : match.opened;
  const body = (
    <>
      <StatusPill tone={label.tone}>{label.word}</StatusPill>
      {line(match.a)}
      {line(match.b)}
    </>
  );
  return (
    <motion.li variants={popIn}>
      {canOpen ? (
        <Link to={`/fights/${t.id}/${match.index}`} className="bracket-match">
          {body}
        </Link>
      ) : (
        <div className="bracket-match bracket-match--idle">{body}</div>
      )}
    </motion.li>
  );
}

function Bracket({ t }) {
  return (
    <div className="bracket" role="group" aria-label="Bracket">
      {t.rounds.map((round) => (
        <motion.section key={round.round} className="bracket-round" variants={stagger(0.05)} initial="hidden" animate="show">
          <h3 className="t-label m0 bracket-round__name">{round.name}</h3>
          <ol className="bracket-round__list">
            {round.matches.map((i) => (
              <BracketMatch key={i} t={t} match={t.matches[i]} />
            ))}
          </ol>
        </motion.section>
      ))}
    </div>
  );
}

function ChampionBanner({ t }) {
  const project = t.projects[t.champion];
  useEffect(() => {
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.45 }, colors: ["#ffd43b", "#ff5c93", "#2f4bf0"], disableForReducedMotion: true });
  }, []);
  return (
    <motion.div initial={{ scale: 0.8, opacity: 0, rotate: -2 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}>
      <Card variant="sticker" className="champion">
        <PixelFighter project={project} scale={5} className="fighter--victory" />
        <div className="stack stack--tight">
          <span className="t-caption champion__eyebrow">Champion</span>
          <span className="t-display-md">{project.name}</span>
        </div>
      </Card>
    </motion.div>
  );
}

function RulesCard() {
  return (
    <Card variant="surface" className="stack">
      <h2 className="t-heading m0">Rules</h2>
      <ul className="rules t-body">
        <li>Three judges score five rounds: product 40%, engineering 20%, innovation 20%, feasibility 10%, defense 10%.</li>
        <li>Ties go to a tie-break round, then to an organizer.</li>
        <li>Pools pay 70% to winning bettors, 20% to the winning project, 10% to the platform.</li>
        <li>One-sided pools are refunded.</li>
      </ul>
    </Card>
  );
}

function HowDrawn({ t }) {
  const m = t.matching;
  if (!m) return null;
  return (
    <Card variant="surface" className="stack">
      <h2 className="t-heading m0">How the bracket was drawn</h2>
      {m.manual ? (
        <p className="t-body m0">The organizer set the bracket order by hand.</p>
      ) : (
        <>
          <p className="t-body m0">
            Round one pairs the most similar projects (60% what they do and for whom, 20% shared tracks, 20% shared tech); later rounds keep similar projects apart. Model {m.embeddingModel ?? "none needed"}. Bracket hash <span className="t-mono">{m.resultHash?.slice(0, 12)}…</span>
          </p>
          <ul className="rules t-body">
            {m.firstRound.map((f) => (
              <li key={f.match}>
                {t.projects.find((p) => p.id === f.a)?.name} vs {t.projects.find((p) => p.id === f.b)?.name}
                {f.similarity != null ? `: ${Math.round(f.similarity / 100)}% similar` : ": the only possible fight"}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Lobby({ t, wallet }) {
  const label = openPools(t).length ? POOL_LABEL.OPEN : PHASE_LABEL[t.phase];
  const countdown = useCountdown(t.phase === "upcoming" ? (t.demo ? new Date(t.startsAt).getTime() : t.cutoffMs) : null);
  const shares = useMemo(() => {
    const raw = t.projects.map((_, i) => 1 + ((i * 37 + t.count * 11) % 19));
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((v) => Math.round((v / sum) * 100));
  }, [t.projects, t.count]);
  const selections = t.projects.map((project, i) => ({ id: i, project }));

  return (
    <div className="stack stack--page">
      <Link to="/tournaments" className="back btn btn--ghost btn--sm">
        ← Tournaments
      </Link>
      <header className="intro intro--row">
        <div className="intro">
          <span className="org-roles">
            <StatusPill tone={label.tone}>{label.word}</StatusPill>
            {!t.demo && <StatusPill tone="reward">On chain</StatusPill>}
          </span>
          <h1 className="t-display-lg m0 rise">{t.title}</h1>
          <p className="t-body m0 muted">
            {t.track} · {t.count} projects · {t.phase === "upcoming" ? "starts" : "started"} {when(t.startsAt)}
          </p>
        </div>
        {countdown && countdown.left > 0 && (
          <motion.div className="lobby-clock" variants={popIn} initial="hidden" animate="show">
            <span className="t-caption">{t.demo ? "Starts in" : "Betting closes in"}</span>
            <span className="t-display-md t-num">{countdown.text}</span>
          </motion.div>
        )}
      </header>

      {t.champion != null && <ChampionBanner t={t} />}

      {!t.demo && !t.frozen && t.phase !== "canceled" ? (
        <Card variant="surface" className="empty">
          <span className="t-body muted">Betting opens once the organizer locks the bracket.</span>
          <Link className="btn btn--secondary btn--sm" to="/organizer">
            Organizer tools
          </Link>
        </Card>
      ) : (
        <div className="lobby-grid">
          <div className="stack">
            <Bracket t={t} />
            <HowDrawn t={t} />
            <RulesCard />
          </div>
          <div className="lobby-side">
            {t.demo ? (
              <SamplePool title="Who wins it all?" total={t.poolTotal ?? 0} selections={selections} shares={shares} />
            ) : (
              <BetPanel wallet={wallet} tournamentId={t.id} market={tournamentMarket(t.id)} selections={selections} title="Who wins it all?" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChainLobby({ id, wallet }) {
  const { data, loading, error } = usePoll(() => loadTournament(id), [id], 10000);
  if (loading && !data) return <div className="skeleton skeleton--seat" aria-label="Loading tournament" />;
  if (error && !data) return <Missing word="Couldn't read this tournament from the chain." />;
  if (!data) return <Missing word={`There's no tournament #${id} on chain.`} />;
  return <Lobby t={data} wallet={wallet} />;
}

function Missing({ word }) {
  return (
    <Card variant="surface" className="empty">
      <span className="t-body muted">{word}</span>
      <Link className="btn btn--secondary btn--sm" to="/tournaments">
        See tournaments
      </Link>
    </Card>
  );
}

export function TournamentPage({ id, wallet }) {
  return /^\d+$/.test(id) || findMockTournament(id) ? <ChainLobby id={id} wallet={wallet} /> : <Missing word="We couldn't find that tournament." />;
}
