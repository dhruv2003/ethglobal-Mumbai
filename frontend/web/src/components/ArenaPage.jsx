/*
 * /arena: one 8-bit world under the header, painted in the site's own palette. Each
 * tournament is a walled area with its track and prize on a sticker plaque, and every
 * ring in it opens that fight. Original art, drawn in the same pixel style as the
 * fighters. Everything on the map is read from the chain.
 */
import { useMemo } from "react";
import { motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { usePoll } from "../lib/chain.js";
import { loadTournaments } from "../lib/arena.js";
import { MATCH_LABEL, PHASE_LABEL } from "../lib/labels.js";
import { POOL_LABEL } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { isMatchOpen, openPools } from "../lib/tournamentView.js";
import { AerialRing } from "./AerialRing.jsx";
import { bouncy, stagger } from "./fx.jsx";

/** Health bar from the published scores: 20% floor plus 0.008% per score hundredth, as the fight player draws it. */
function withHealth(match) {
  if (match.status !== "finalized" && match.status !== "review") return match;
  const hp = (score) => 20 + score * 0.008;
  return { ...match, healthA: hp(match.scoreA ?? 0), healthB: hp(match.scoreB ?? 0) };
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
  const label = isMatchOpen(t, match) ? POOL_LABEL.OPEN : MATCH_LABEL[match.status];
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

function District({ t, size }) {
  const label = openPools(t).length ? POOL_LABEL.OPEN : PHASE_LABEL[t.phase];
  const rings = useMemo(() => ringsFor(t).map(withHealth), [t]);
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
  const { data, error } = usePoll(loadTournaments, [], 15000, { key: "tournaments" });
  const real = useMemo(() => (data ?? []).map((t) => ({ ...t, prize: "On chain" })), [data]);
  const open = real.flatMap((t) => openPools(t)).length;

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
          <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
            Arena
          </h1>
          <span className="t-body muted rise" style={{ "--i": 2 }}>
            Every fight, live. Tap a ring to watch.
          </span>
        </div>
        <div className="village__sign-right">
          {open ? (
            <Link className="btn btn--secondary btn--sm" to="/tournaments">
              {open} open for betting
            </Link>
          ) : (
            <StatusPill tone="neutral">Nothing open for betting</StatusPill>
          )}
        </div>
      </header>

      <motion.div className="village__map" variants={stagger(0.1)} initial="hidden" animate="show">
        {real.map((t) => (
          <District key={t.id} t={t} size={sizeOf(t)} />
        ))}
        {data == null && error && <p className="plot__empty m0">Couldn't reach the chain. Retrying…</p>}
        {data != null && !real.length && <p className="plot__empty m0">No tournaments yet. Create one in the organizer console.</p>}
      </motion.div>
    </section>
  );
}
