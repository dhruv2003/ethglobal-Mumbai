/*
 * /arena: one 8-bit world under the header, painted in the site's own palette. Each
 * tournament is a walled area with its track and prize on a sticker plaque, and every
 * ring in it opens that fight. Original art, drawn in the same pixel style as the
 * fighters. Sample tournaments are labelled; real ones from the chain appear first.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { listTournaments, usePoll } from "../lib/chain.js";
import { MATCH_LABEL, MOCK_TOURNAMENTS, PHASE_LABEL } from "../lib/mockArena.js";
import { Link } from "../lib/router.jsx";
import { viewOfChain } from "../lib/tournamentView.js";
import { AerialRing } from "./AerialRing.jsx";
import { bouncy, stagger } from "./fx.jsx";

const TICK_MS = 4000;

/** Sample live matches seal a round every few seconds, then start over. */
function withLiveHealth(match, tick) {
  if (match.status !== "live" || match.healthA === undefined) return match;
  const sealed = Math.min((match.index * 2 + tick) % 7, 5);
  const hit = (side) => Array.from({ length: sealed }, (_, r) => 3 + ((match.index * 7 + r * 5 + side * 11) % 9)).reduce((sum, v) => sum + v, 0);
  return { ...match, healthA: 100 - hit(0), healthB: 100 - hit(1) };
}

/** Which rings stand in an area: the round being fought, or the last one played. */
function ringsFor(t) {
  const ready = t.matches.filter((m) => m.a != null && m.b != null);
  const active = ready.filter((m) => m.status === "live" || m.status === "review");
  if (active.length) return active;
  if (t.phase === "completed") return ready.slice(-3);
  return ready.slice(0, Math.min(ready.length, 4));
}

function Tower({ className }) {
  return (
    <svg className={`tower ${className}`} viewBox="0 0 16 22" shapeRendering="crispEdges" aria-hidden="true">
      <rect className="t-wood" x="7" y="0" width="1" height="7" />
      <rect className="tower__flag" x="8" y="0" width="5" height="3" />
      <rect className="t-ink" x="1" y="5" width="3" height="3" />
      <rect className="t-ink" x="6" y="5" width="4" height="3" />
      <rect className="t-ink" x="12" y="5" width="3" height="3" />
      <rect className="t-stone-light" x="2" y="6" width="1" height="2" />
      <rect className="t-stone-light" x="7" y="6" width="2" height="2" />
      <rect className="t-stone-light" x="13" y="6" width="1" height="2" />
      <rect className="t-ink" x="1" y="8" width="14" height="14" />
      <rect className="t-stone" x="2" y="8" width="12" height="13" />
      <rect className="t-stone-light" x="2" y="8" width="12" height="2" />
      <rect className="t-stone-dark" x="2" y="18" width="12" height="3" />
      <rect className="t-stone-dark" x="4" y="12" width="3" height="1" />
      <rect className="t-stone-dark" x="9" y="15" width="3" height="1" />
      <rect className="t-ink" x="7" y="11" width="2" height="3" />
    </svg>
  );
}

function Gate({ open }) {
  return (
    <svg className="gate-arch" viewBox="0 0 24 14" shapeRendering="crispEdges" aria-hidden="true">
      <rect className="t-ink" x="0" y="0" width="24" height="14" />
      <rect className="t-stone" x="1" y="1" width="22" height="13" />
      <rect className="t-stone-light" x="1" y="1" width="22" height="2" />
      <rect className={open ? "t-path" : "t-ink"} x="7" y="4" width="10" height="10" />
      {!open && [8, 10, 12, 14].map((x) => <rect key={x} className="t-stone-dark" x={x} y="4" width="1" height="10" />)}
    </svg>
  );
}

function Sparkle({ tone, style }) {
  return (
    <svg className={`sparkle sparkle--${tone}`} style={style} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="3" y="0" width="1" height="7" />
      <rect x="0" y="3" width="7" height="1" />
      <rect x="2" y="2" width="3" height="3" />
    </svg>
  );
}

function Plot({ t, match }) {
  const a = t.projects[match.a];
  const b = t.projects[match.b];
  const label = MATCH_LABEL[match.status];
  const winner = match.winner == null ? null : match.winner === match.a ? "a" : "b";
  const healthA = match.healthA ?? 100;
  const healthB = match.healthB ?? 100;
  return (
    <motion.div variants={{ hidden: { opacity: 0, scale: 0.7 }, show: { opacity: 1, scale: 1, transition: bouncy } }}>
      <Link to={`/fights/${t.id}/${match.index}`} className="plot" aria-label={`Open fight: ${a.name} against ${b.name}, ${label.word}`}>
        <span className="plot__ring">
          <AerialRing compact a={a} b={b} status={match.status} winner={winner} seed={match.index + 3} label="" />
        </span>
        <span className="plot__names">
          {a.name} vs {b.name}
        </span>
        <span className="plot__bars" aria-hidden="true">
          <span className="plot__bar">
            <motion.span animate={{ width: `${healthA}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
          </span>
          <span className="plot__bar plot__bar--b">
            <motion.span animate={{ width: `${healthB}%` }} transition={{ type: "spring", stiffness: 120, damping: 18 }} />
          </span>
        </span>
        <span className="plot__meta">
          <span>{label.word}</span>
          <span>
            {Math.round(healthA)} · {Math.round(healthB)} HP
          </span>
        </span>
      </Link>
    </motion.div>
  );
}

function District({ t, tick, size }) {
  const label = PHASE_LABEL[t.phase];
  const rings = useMemo(() => ringsFor(t).map((m) => withLiveHealth(m, tick)), [t, tick]);
  const open = t.phase === "live";
  return (
    <motion.section className={`district district--${t.phase} ${size}`} aria-label={`${t.track}: ${label.word}`} variants={{ hidden: { opacity: 0, y: 30 }, show: { opacity: 1, y: 0, transition: bouncy } }}>
      <span className="road" aria-hidden="true" />
      <span className="wall wall--top" aria-hidden="true" />
      <span className="wall wall--left" aria-hidden="true" />
      <span className="wall wall--right" aria-hidden="true" />
      <span className="wall wall--bottom" aria-hidden="true" />
      <Tower className="tower--tl" />
      <Tower className="tower--tr" />
      <Tower className="tower--bl" />
      <Tower className="tower--br" />
      <Gate open={open} />
      <Link to={`/tournaments/${t.id}`} className="plaque">
        <span className="plaque__track">{t.track}</span>
        <span className="plaque__row">
          {t.prize ? <span className="plaque__prize">{t.prize}</span> : null}
          <StatusPill tone={label.tone}>{label.word}</StatusPill>
        </span>
      </Link>
      <motion.div className="district__floor" variants={stagger(0.05)}>
        {rings.length ? rings.map((m) => <Plot key={m.index} t={t} match={m} />) : <p className="plot__empty m0">{t.frozen === false ? "Not frozen yet. Set it up in the organizer console." : "No fights to show."}</p>}
      </motion.div>
    </motion.section>
  );
}

const SPARKLES = [
  ["1%", "12%"], ["97%", "9%"], ["0.5%", "38%"], ["97.5%", "33%"], ["48%", "31%"], ["2%", "64%"],
  ["96%", "60%"], ["32%", "62%"], ["66%", "64%"], ["1%", "90%"], ["97%", "88%"], ["50%", "94%"],
];

export function ArenaPage() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  const { data: chainList } = usePoll(listTournaments, [], 20000);

  // Changing what you look at never restarts a fight: this one clock drives every ring.
  useEffect(() => {
    if (reduced) return undefined;
    const t = setInterval(() => setTick((v) => v + 1), TICK_MS);
    return () => clearInterval(t);
  }, [reduced]);

  const real = useMemo(() => (chainList ?? []).map((t) => ({ ...viewOfChain(t), track: `Tournament #${t.id}`, prize: "On chain" })), [chainList]);
  const live = [...real, ...MOCK_TOURNAMENTS].flatMap((t) => t.matches).filter((m) => m.status === "live").length;

  const sizeOf = (t) => (t.count >= 16 ? "district--wide" : t.count >= 8 ? "district--big" : "");

  return (
    <section className="village" aria-label="The arena map">
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
      {SPARKLES.map(([left, top], i) => (
        <Sparkle key={`${left}-${top}`} tone={i % 3} style={{ left, top, animationDelay: `${(parseFloat(left) * 37) % 2}s` }} />
      ))}

      <header className="intro intro--row village__sign">
        <div className="intro">
          <span className="eyebrow rise">Every fight, one map</span>
          <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
            <span className="hl hl--crush">The arena</span>
          </h1>
          <span className="t-caption rise" style={{ "--i": 2 }}>
            Click a ring to watch that fight. Click a plaque to see the whole tournament.
          </span>
        </div>
        <div className="village__sign-right">
          <StatusPill tone="live">
            {live} {live === 1 ? "fight" : "fights"} live
          </StatusPill>
          <StatusPill tone="neutral">Sample fights</StatusPill>
        </div>
      </header>

      <motion.div className="village__map" variants={stagger(0.1)} initial="hidden" animate="show">
        {real.map((t) => (
          <District key={t.id} t={t} tick={tick} size={sizeOf(t)} />
        ))}
        {MOCK_TOURNAMENTS.map((t) => (
          <District key={t.id} t={t} tick={tick} size={sizeOf(t)} />
        ))}
      </motion.div>
    </section>
  );
}
