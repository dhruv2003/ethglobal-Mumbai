/*
 * /arena: the fights, four to a screen. Live ones first, then the newest finished.
 * One badge per ring, the two project names, and their health. Read from the chain.
 */
import { useMemo } from "react";
import { motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { usePoll } from "../lib/chain.js";
import { loadTournaments } from "../lib/arena.js";
import { Link } from "../lib/router.jsx";
import { listProjects } from "../lib/projects.js";
import { PixelFighter } from "./PixelFighter.jsx";
import { AerialRing } from "./AerialRing.jsx";
import { bouncy, stagger } from "./fx.jsx";

/** Health bar from the published scores: 20% floor plus 0.008% per score hundredth, as the fight player draws it. */
function withHealth(match) {
  if (match.status !== "finalized" && match.status !== "review") return match;
  const hp = (score) => 20 + score * 0.008;
  return { ...match, healthA: hp(match.scoreA ?? 0), healthB: hp(match.scoreB ?? 0) };
}

/**
 * A tournament counts once its bracket is registered with real projects. Contract
 * tournaments without one (left from testing) only have numbered slots and are not shown.
 */
const isReal = (t) => t.projects.length > 0 && t.projects.every((p) => p.registered);

/** Every fight worth showing, across real tournaments: live first, then the newest finished. */
function fightsOf(tournaments) {
  const rank = { live: 0, review: 1, finalized: 2, scheduled: 3 };
  return tournaments
    .filter(isReal)
    .flatMap((t) => t.matches.filter((m) => m.a != null && m.b != null && m.status !== "void").map((m) => ({ t, match: withHealth(m) })))
    .sort((x, y) => (rank[x.match.status] ?? 9) - (rank[y.match.status] ?? 9) || Number(y.t.id) - Number(x.t.id));
}

const BADGE = { live: ["live", "Live"], review: ["reward", "Judges deciding"], finalized: ["neutral", "Final"], scheduled: ["neutral", "Up next"] };

function FightCard({ t, match, big }) {
  const a = t.projects[match.a];
  const b = t.projects[match.b];
  const winner = match.winner == null ? null : match.winner === match.a ? "a" : "b";
  const [tone, word] = BADGE[match.status] ?? ["neutral", "Up next"];
  const healthA = match.healthA ?? 100;
  const healthB = match.healthB ?? 100;
  const won = winner ? (winner === "a" ? a : b) : null;
  return (
    <motion.div variants={{ hidden: { opacity: 0, scale: 0.9 }, show: { opacity: 1, scale: 1, transition: bouncy } }}>
      <Link to={`/fights/${t.id}/${match.index}`} className={`bout ${big ? "bout--big" : ""} bout--${match.status}`} aria-label={`Open fight: ${a.name} against ${b.name}, ${word}`}>
        <span className="bout__top">
          <StatusPill tone={tone}>{word}</StatusPill>
        </span>
        <span className="bout__ring">
          <AerialRing compact a={a} b={b} status={match.status} winner={winner} seed={match.index + Number(t.id) + 3} label="" />
        </span>
        <span className="bout__names">
          <span className={winner === "a" ? "bout__won" : ""}>{a.name}</span>
          <span className="bout__vs">vs</span>
          <span className={winner === "b" ? "bout__won" : ""}>{b.name}</span>
        </span>
        <span className="bout__bars" aria-hidden="true">
          <span className="plot__bar">
            <motion.span animate={{ width: `${healthA}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
          </span>
          <span className="plot__bar plot__bar--b">
            <motion.span animate={{ width: `${healthB}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
          </span>
        </span>
        <span className="bout__foot">{won ? `${won.name} won` : match.status === "live" ? "Watch now →" : "Open →"}</span>
      </Link>
    </motion.div>
  );
}

const PER_SCREEN = 4;

/** Before the first real tournament: the submitted projects, waiting for their bracket. */
function WaitingRoom() {
  const { data: projects } = usePoll(() => listProjects().catch(() => []), [], 30000, { key: "projects" });
  const list = projects ?? [];
  return (
    <div className="waiting">
      <p className="t-body m0">
        <strong>No fights yet.</strong> The first bouts start when the organizer opens a tournament. These fighters are ready:
      </p>
      {list.length > 0 ? (
        <ul className="waiting__line">
          {list.map((p, i) => (
            <li key={p.id} style={{ "--i": i }}>
              <Link to={`/projects/${encodeURIComponent(p.id)}`} className="waiting__fighter" title={p.pitch}>
                <span className="waiting__spot">
                  <PixelFighter project={p} scale={4} />
                </span>
                <span className="waiting__name">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption m0">No projects submitted yet.</p>
      )}
      <Link to="/rankings" className="btn btn--secondary btn--sm">
        See the rankings →
      </Link>
    </div>
  );
}

export function ArenaPage() {
  const { data, error } = usePoll(loadTournaments, [], 15000, { key: "tournaments" });
  const fights = useMemo(() => fightsOf(data ?? []), [data]);
  const shown = fights.slice(0, PER_SCREEN);
  const earlier = fights.slice(PER_SCREEN);
  const live = fights.filter((f) => f.match.status === "live").length;

  return (
    <section className="village" aria-label="The arena">
      <svg className="village__ground" aria-hidden="true" shapeRendering="crispEdges">
        <defs>
          <pattern id="ground" width="64" height="64" patternUnits="userSpaceOnUse">
            <rect className="ground-a" x="6" y="8" width="4" height="4" />
            <rect className="ground-a" x="10" y="4" width="4" height="4" />
            <rect className="ground-b" x="36" y="16" width="4" height="4" />
            <rect className="ground-a" x="50" y="36" width="4" height="4" />
            <rect className="ground-a" x="54" y="32" width="4" height="4" />
            <rect className="ground-b" x="18" y="46" width="4" height="4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ground)" />
      </svg>

      <header className="arena-head">
        <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
          Arena
        </h1>
        <p className="t-body muted m0 rise" style={{ "--i": 2 }}>
          {live ? `${live} ${live === 1 ? "fight" : "fights"} live now.` : "Every fight, judged on evidence."}
          {fights.length ? " Tap a ring to watch." : ""}
        </p>
      </header>

      <motion.div className="bouts" variants={stagger(0.08)} initial="hidden" animate="show">
        {shown.map(({ t, match }) => (
          <FightCard key={`${t.id}-${match.index}`} t={t} match={match} big />
        ))}
        {data == null && error && <p className="plot__empty m0">Couldn't reach the chain. Retrying…</p>}
        {data != null && !fights.length && <WaitingRoom />}
      </motion.div>

      {earlier.length > 0 && (
        <section className="bouts-earlier" aria-labelledby="earlier-h">
          <h2 id="earlier-h" className="t-heading m0">
            Earlier fights
          </h2>
          <ul className="bouts-earlier__list m0">
            {earlier.map(({ t, match }) => {
              const a = t.projects[match.a];
              const b = t.projects[match.b];
              const w = match.winner == null ? null : match.winner === match.a ? a : b;
              return (
                <li key={`${t.id}-${match.index}`}>
                  <Link to={`/fights/${t.id}/${match.index}`} className="bouts-earlier__row">
                    <span>
                      {a.name} vs {b.name}
                    </span>
                    <span className="muted">{w ? `${w.name} won` : (BADGE[match.status] ?? BADGE.scheduled)[1]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}
