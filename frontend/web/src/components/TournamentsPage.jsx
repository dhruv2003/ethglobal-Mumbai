/*
 * /tournaments: every event. /tournaments/:id: one event's bracket and tournament betting.
 * On-chain tournaments are real. The rest are clearly labelled sample data. PRD UI-01, UI-02.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { Card, Chip, StatusPill } from "@ds/ui.jsx";
import { listTournaments, readTournament, usePoll } from "../lib/chain.js";
import { MATCH_LABEL, MOCK_TOURNAMENTS, PHASE_LABEL, findMockTournament } from "../lib/mockArena.js";
import { tournamentMarket } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { viewOfChain } from "../lib/tournamentView.js";
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
  const label = PHASE_LABEL[t.phase];
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
              <StatusPill tone={t.mock ? "neutral" : "reward"}>{t.mock ? "Sample" : "On chain"}</StatusPill>
            </div>
            <h2 className="t-heading m0">{t.title}</h2>
            <p className="t-caption m0 t-num">
              {t.track} · {t.count} projects · {when(t.startsAt)}
              {t.poolTotal ? ` · ${t.poolTotal.toLocaleString("en-US")} FILTER staked` : ""}
            </p>
            <span className="tcard__cta t-label">{t.phase === "live" ? "Watch and bet" : t.phase === "upcoming" ? "See the bracket" : "See the results"} →</span>
          </div>
        </Link>
      </Tilt>
    </motion.div>
  );
}

export function TournamentsPage() {
  const [filter, setFilter] = useState("all");
  const { data: chainList } = usePoll(listTournaments, [], 20000);
  const all = useMemo(() => {
    const real = (chainList ?? []).map(viewOfChain);
    return [...real, ...MOCK_TOURNAMENTS].sort((a, b) => ORDER[a.phase] - ORDER[b.phase] || Number(a.mock) - Number(b.mock));
  }, [chainList]);
  const shown = filter === "all" ? all : all.filter((t) => t.phase === filter);
  const count = (id) => (id === "all" ? all.length : all.filter((t) => t.phase === id).length);

  return (
    <div className="stack stack--page">
      <header className="intro intro--row">
        <div className="intro">
          <span className="eyebrow rise">Pick your fight night</span>
          <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
            <span className="hl hl--crush">Tournaments</span>
          </h1>
        </div>
        <Link className="btn btn--oracle" to="/arena">
          Enter the arena
        </Link>
      </header>
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
          <span className="t-body muted">No {filter} tournaments right now.</span>
        </Card>
      )}
    </div>
  );
}

function BracketMatch({ t, match }) {
  const label = MATCH_LABEL[match.status];
  const name = (p) => (p == null ? "To be decided" : t.projects[p].name);
  const line = (p) => (
    <span className={`bracket-line ${match.winner != null && match.winner === p ? "is-winner" : ""} ${match.winner != null && match.winner !== p ? "is-out" : ""}`}>
      {p != null ? <PixelFighter project={t.projects[p]} scale={1.2} label="" /> : <span className="bracket-line__empty" aria-hidden="true" />}
      <span className="t-label">{name(p)}</span>
      {match.winner != null && match.winner === p ? <span className="bracket-line__tick" aria-label="winner">★</span> : null}
    </span>
  );
  const canOpen = t.mock ? match.a != null && match.b != null : match.opened;
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
      <h2 className="t-heading m0">How it works</h2>
      <ul className="rules t-body">
        <li>Five rounds, three judges. Product 40%, engineering 20%, innovation 20%, feasibility 10%, defense 10%.</li>
        <li>A tie gets one tie-break round. A second tie goes to a human organizer.</li>
        <li>Each pool pays 70% to winning bettors, 20% to the winning project and 10% to the platform.</li>
        <li>Pools with bets on only one side, or none on the winner, are refunded.</li>
        <li>Tournament bets and match bets are separate pools.</li>
      </ul>
    </Card>
  );
}

function Lobby({ t, wallet }) {
  const label = PHASE_LABEL[t.phase];
  const target = t.mock ? (t.phase === "upcoming" ? new Date(t.startsAt).getTime() : null) : t.phase === "upcoming" ? t.cutoffMs : null;
  const countdown = useCountdown(target);
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
            <StatusPill tone={t.mock ? "neutral" : "reward"}>{t.mock ? "Sample data" : "On chain"}</StatusPill>
          </span>
          <h1 className="t-display-lg m0 rise">{t.title}</h1>
          <p className="t-body m0 muted">
            {t.track} · {t.count} projects · starts {when(t.startsAt)}
          </p>
        </div>
        {countdown && countdown.left > 0 && (
          <motion.div className="lobby-clock" variants={popIn} initial="hidden" animate="show">
            <span className="t-caption">{t.mock ? "Starts in" : "Betting closes in"}</span>
            <span className="t-display-md t-num">{countdown.text}</span>
          </motion.div>
        )}
      </header>

      {t.champion != null && <ChampionBanner t={t} />}

      {!t.mock && !t.frozen && t.phase !== "canceled" ? (
        <Card variant="surface" className="empty">
          <span className="t-body muted">This tournament isn't frozen yet, so its pool isn't open.</span>
          <Link className="btn btn--secondary btn--sm" to="/organizer">
            Open organizer console
          </Link>
        </Card>
      ) : (
        <div className="lobby-grid">
          <div className="stack">
            <Bracket t={t} />
            <RulesCard />
          </div>
          <div className="lobby-side">
            {t.mock ? (
              <SamplePool title="Who wins it all?" total={t.poolTotal} selections={selections} shares={shares} />
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
  const { data, loading, error } = usePoll(() => readTournament(id), [id], 10000);
  if (loading && !data) return <div className="skeleton skeleton--seat" aria-label="Loading tournament" />;
  if (error && !data) return <Missing word="Couldn't read this tournament from the chain." />;
  if (!data) return <Missing word={`There's no tournament #${id} on chain.`} />;
  return <Lobby t={viewOfChain(data)} wallet={wallet} />;
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
  if (/^\d+$/.test(id)) return <ChainLobby id={id} wallet={wallet} />;
  const t = findMockTournament(id);
  return t ? <Lobby t={t} wallet={wallet} /> : <Missing word="We couldn't find that tournament." />;
}
