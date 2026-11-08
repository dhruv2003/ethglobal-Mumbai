/*
 * /rankings: every bettor, ranked by what they've won. Read from the same pools the fights
 * settle: a winning pick takes its share of the 70% bettor bucket of that match's pool.
 * Net counts settled fights only; stake on fights still running is shown apart.
 */
import { useMemo } from "react";
import { motion } from "motion/react";
import { formatUnits } from "viem";
import { usePoll, useToken } from "../lib/chain.js";
import { loadTournaments } from "../lib/arena.js";
import { leaderboard } from "../lib/demo/sim.js";
import { Link } from "../lib/router.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { bouncy, stagger } from "./fx.jsx";

const amt = (v) => Number(formatUnits(v ?? 0n, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const signed = (v) => (v > 0n ? `+${amt(v)}` : v < 0n ? `−${amt(-v)}` : "0");
const tone = (v) => (v > 0n ? "up" : v < 0n ? "down" : "flat");
const face = (r) => ({ seed: r.address, name: r.name, tracks: [] });

function Podium({ rows, symbol }) {
  const top = rows.slice(0, 3);
  // Second, first, third: the winner stands in the middle.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <motion.ol className="podium m0" variants={stagger(0.1)} initial="hidden" animate="show" aria-label="Top three">
      {order.map((r) => {
        const place = rows.indexOf(r) + 1;
        return (
          <motion.li key={r.address} className={`podium__spot podium__spot--${place} ${r.you ? "podium__spot--you" : ""}`} variants={{ hidden: { opacity: 0, y: 30 }, show: { opacity: 1, y: 0, transition: bouncy } }}>
            <span className="podium__face" aria-hidden="true">
              <PixelFighter project={face(r)} scale={4} />
            </span>
            <b className="podium__name">{r.you ? "You" : r.name}</b>
            <span className={`podium__net t-num rk-${tone(r.net)}`}>
              {signed(r.net)} <small>{symbol}</small>
            </span>
            <span className="t-caption muted">
              won {amt(r.won)} · {r.hits}/{r.settled} picks hit
            </span>
            <span className="podium__block" aria-hidden="true">
              {place}
            </span>
            <span className="visually-hidden">Place {place}</span>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}

/** One dot per fight the bettor picked: green hit, red miss, pulsing still running. */
function Picks({ picks, t }) {
  return (
    <span className="rk-picks">
      {picks.map((p) => {
        const name = t?.projects[p.selection]?.name ?? `slot ${p.selection + 1}`;
        const word = p.result === "won" ? `won ${amt(p.payout)}` : p.result === "lost" ? "missed" : "running";
        return (
          <Link key={p.match} to={`/fights/${t?.id ?? 1}/${p.match}`} className={`rk-pick rk-pick--${p.result}`} title={`Match ${p.match + 1}: picked ${name}, ${word}`}>
            <span className="visually-hidden">
              Match {p.match + 1}: picked {name}, {word}
            </span>
          </Link>
        );
      })}
    </span>
  );
}

export function RankingsPage() {
  const { data: rows } = usePoll(async () => leaderboard(), [], 3000);
  const { data: ts } = usePoll(loadTournaments, [], 15000, { key: "tournaments" });
  const token = useToken();
  const symbol = token?.symbol ?? "FILTER";
  const t = ts?.[0];
  const list = rows ?? [];
  const totals = useMemo(
    () => ({
      paid: list.reduce((x, r) => x + r.won, 0n),
      staked: list.reduce((x, r) => x + r.staked, 0n),
      riding: list.reduce((x, r) => x + r.open, 0n),
      best: list.reduce((x, r) => (r.best > x.best ? { best: r.best, who: r } : x), { best: 0n, who: null }),
    }),
    [list],
  );
  const youAt = list.findIndex((r) => r.you);

  return (
    <section className="rk stack" aria-labelledby="rk-h">
      <header className="rk__head">
        <h1 id="rk-h" className="t-display-lg m0 rise" style={{ "--i": 1 }}>
          Rankings
        </h1>
        <p className="t-body muted m0 rise" style={{ "--i": 2 }}>
          Who's called the fights right. Winning picks split 70% of each match's pool, in proportion to their stake. Updates as fights settle.
        </p>
      </header>

      <div className="rk-tiles">
        <div className="rk-tile">
          <span className="t-label">Paid to bettors</span>
          <b className="t-num">
            {amt(totals.paid)} <small>{symbol}</small>
          </b>
        </div>
        <div className="rk-tile">
          <span className="t-label">Total staked</span>
          <b className="t-num">
            {amt(totals.staked)} <small>{symbol}</small>
          </b>
        </div>
        <div className="rk-tile">
          <span className="t-label">Riding on live fights</span>
          <b className="t-num">
            {amt(totals.riding)} <small>{symbol}</small>
          </b>
        </div>
        <div className="rk-tile">
          <span className="t-label">Biggest single payout</span>
          <b className="t-num">
            {amt(totals.best.best)} <small>{symbol}</small>
          </b>
          {totals.best.who && <span className="t-caption muted">{totals.best.who.you ? "you" : totals.best.who.name}</span>}
        </div>
      </div>

      {list.length >= 3 && <Podium rows={list} symbol={symbol} />}

      {youAt < 0 && (
        <p className="rk-you-cta m0">
          You're not on the board yet. <Link to="/arena">Pick a side in a live fight →</Link>
        </p>
      )}

      <div className="rk-table" role="table" aria-label="All bettors">
        <div className="rk-row rk-row--head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">Bettor</span>
          <span role="columnheader" className="rk-num">Net</span>
          <span role="columnheader" className="rk-num rk-hide-sm">Won</span>
          <span role="columnheader" className="rk-num rk-hide-sm">Staked</span>
          <span role="columnheader" className="rk-hide-sm">Picks</span>
        </div>
        {list.map((r, i) => (
          <div key={r.address} className={`rk-row ${r.you ? "rk-row--you" : ""}`} role="row">
            <span role="cell" className="rk-rank t-num">
              {i + 1}
            </span>
            <span role="cell" className="rk-who">
              <span className="rk-who__face" aria-hidden="true">
                <PixelFighter project={face(r)} scale={2} />
              </span>
              <span className="rk-who__text">
                <b>{r.you ? "You" : r.name}</b>
                <span className="t-mono-caption muted">
                  {r.address.slice(0, 6)}…{r.address.slice(-4)} · {r.hits}/{r.settled} hit{r.open > 0n ? ` · ${amt(r.open)} riding` : ""}
                </span>
              </span>
            </span>
            <span role="cell" className={`rk-num t-num rk-net rk-${tone(r.net)}`}>
              {signed(r.net)}
            </span>
            <span role="cell" className="rk-num t-num rk-hide-sm">
              {amt(r.won)}
            </span>
            <span role="cell" className="rk-num t-num rk-hide-sm muted">
              {amt(r.staked)}
            </span>
            <span role="cell" className="rk-hide-sm">
              <Picks picks={r.picks} t={t} />
            </span>
          </div>
        ))}
        {rows && !list.length && <p className="plot__empty m0">No bets yet.</p>}
      </div>
      <p className="t-caption muted m0">
        Amounts in {symbol}. Net = payouts minus stake, on settled fights only. Payouts are paid on Base Sepolia by the BettingPools contract when a result is published.
      </p>
    </section>
  );
}
