/*
 * The bet popup. Pick a side, type an amount, place it. Nothing else.
 * It sends the real approve + bet.
 * On success it calls onPlaced(bet), and the caller takes the bettor into the fight.
 */
import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CONTRACTS } from "../config/event.js";
import { formatAmount, pools, toUnits, token, useToken, useTx } from "../lib/chain.js";
import { estimatePayout, percent } from "../lib/pools.js";
import { usePoolData } from "./BetPanel.jsx";
import { TxStatus, WalletGate, useCountdown } from "./ChainBits.jsx";
import { FighterEnsLine } from "./EnsName.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { easeOut } from "./fx.jsx";

const TICKS = [25, 50, 75, 100];

/* ---------- bet placed: an 8-bit tick, a chiptune chime, and the bet in two lines ---------- */

// The tick, as pixels on a 12×12 grid, in the order they're drawn (short stroke, then the long one).
const TICK = [[2, 6], [3, 7], [4, 8], [5, 7], [6, 6], [7, 5], [8, 4], [9, 3]].flatMap(([x, y]) => [[x, y], [x, y + 1]]);
// The badge: a rounded pixel square (corners notched).
const BADGE = [];
for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (!((x < 1 || x > 10) && (y < 1 || y > 10)) && !((x === 0 || x === 11) && (y === 1 || y === 10)) && !((y === 0 || y === 11) && (x === 1 || x === 10))) BADGE.push([x, y]);

/** Square-wave arpeggio, like an old console's "got it". Quiet, and skipped when audio is unavailable. */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.075;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.32 : 0.09));
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.35);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {
    /* no sound, no problem */
  }
}

const CONTINUE_MS = 4200;

function BetPlaced({ bet, onDone }) {
  // Once per bet: the parent's callback changes on every render, so hold it in a ref.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    chime();
    const t = setTimeout(() => done.current(), CONTINUE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <motion.div className="placed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="status" aria-live="polite">
      <svg className="placed__tick" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
        {BADGE.map(([x, y]) => (
          <rect key={`b${x}-${y}`} x={x} y={y} width="1" height="1" className="placed__badge" />
        ))}
        {BADGE.filter(([x, y]) => y >= 10 || x >= 10).map(([x, y]) => (
          <rect key={`s${x}-${y}`} x={x} y={y} width="1" height="1" className="placed__shade" />
        ))}
        {TICK.map(([x, y], i) => (
          <rect key={`t${i}`} x={x} y={y} width="1" height="1" className="placed__px" style={{ animationDelay: `${0.32 + Math.floor(i / 2) * 0.045}s` }} />
        ))}
      </svg>
      <span className="placed__spark placed__spark--1" aria-hidden="true" />
      <span className="placed__spark placed__spark--2" aria-hidden="true" />
      <span className="placed__spark placed__spark--3" aria-hidden="true" />
      <h3 className="placed__title">Bet placed</h3>
      <dl className="placed__rows t-num">
        <div>
          <dt>On</dt>
          <dd>
            <PixelFighter project={bet.project} scale={1} label="" /> {bet.project.name}
          </dd>
        </div>
        <div>
          <dt>Stake</dt>
          <dd>
            {bet.amount} {bet.symbol}
          </dd>
        </div>
        <div>
          <dt>If they win</dt>
          <dd className="placed__win">
            ≈ {bet.payout} {bet.symbol}
          </dd>
        </div>
      </dl>
      <button type="button" className="bm__go placed__go" onClick={() => done.current()} style={{ "--ms": `${CONTINUE_MS}ms` }}>
        <span>Watch the fight →</span>
      </button>
    </motion.div>
  );
}
const START_PCT = 10;

/** The shared sheet: two fighters, one amount, one button. */
function Sheet({ pool, symbol, shares, balance, mine, problemFor, payoutFor, onPlace, busy, gate, footer, amountAt, pctOf }) {
  const [picked, setPicked] = useState(null);
  const [text, setText] = useState(() => amountAt(START_PCT));
  const pct = Math.max(0, Math.min(100, Math.round(pctOf(text) || 0)));
  const empty = amountAt(100) === "";
  const input = useRef(null);
  const index = pool.selections.findIndex((s) => s.id === picked);
  const selection = index >= 0 ? pool.selections[index] : null;
  const problem = text ? problemFor(text) : null;
  const ready = selection && text && !problem;
  const payout = ready ? payoutFor(index, text) : null;

  useEffect(() => {
    if (selection) input.current?.focus({ preventScroll: true });
  }, [selection]);

  const submit = (e) => {
    e.preventDefault();
    if (ready && !busy) onPlace(index, text);
  };

  return (
    <form className="bm__form" onSubmit={submit}>
      <div className="bm__sides" role="radiogroup" aria-label="Pick a fighter">
        {pool.selections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={picked === s.id}
            className="bm__side"
            disabled={busy || !!gate}
            onClick={() => setPicked(s.id)}
          >
            <PixelFighter project={s.project} scale={3} label="" />
            <span className="bm__side-name">{s.project.name}</span>
            <FighterEnsLine projectId={s.project.id} />
            <span className="bm__side-meta t-num">
              {shares[i]}%{mine[i] ? ` · you ${mine[i]}` : ""}
            </span>
          </button>
        ))}
      </div>

      {gate ?? (
        <>
          <label className="bm__amount" data-invalid={problem ? "true" : "false"}>
            <span className="visually-hidden">Amount in {symbol}</span>
            <input
              ref={input}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={!!problem}
              aria-describedby="bm-hint"
            />
            <span className="bm__symbol">{symbol}</span>
          </label>
          <div className="bm__slider">
            <div className="bm__slider-head">
              <span className="t-caption">Share of your balance</span>
              <span className="bm__pct t-num">{pct}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              disabled={busy || empty}
              style={{ "--pct": `${pct}%` }}
              onChange={(e) => setText(amountAt(Number(e.target.value)))}
              aria-label="Share of your balance to bet"
              aria-valuetext={`${pct}% · ${text || 0} ${symbol}`}
            />
            <div className="bm__ticks">
              {TICKS.map((v) => (
                <button key={v} type="button" aria-pressed={pct === v} disabled={busy || empty} onClick={() => setText(amountAt(v))}>
                  {v === 100 ? "All in" : `${v}%`}
                </button>
              ))}
            </div>
          </div>
          <p id="bm-hint" className={`bm__hint t-num ${problem ? "is-error" : ""}`} aria-live="polite">
            {problem ?? (payout ? `Pays about ${payout} ${symbol} if ${selection.project.name} wins` : `Balance ${balance} ${symbol}`)}
          </p>
          <button type="submit" className="bm__go" disabled={!ready || busy}>
            {busy ? "Placing…" : selection ? `Bet on ${selection.project.name}` : "Pick a fighter"}
          </button>
        </>
      )}
      {footer}
    </form>
  );
}

function ChainSheet({ pool, wallet, onPlaced }) {
  const info = useToken();
  const { data, refresh } = usePoolData(wallet, pool.tournamentId, pool.market, pool.selections);
  const { tx, run, reset, busy } = useTx(wallet, refresh);
  const [placed, setPlaced] = useState(null);
  if (placed) return <BetPlaced bet={placed} onDone={onPlaced} />;
  if (!data || !info) return <div className="bm__loading skeleton" aria-label="Loading pool" />;
  const { symbol, decimals } = info;
  const fmt = (v) => formatAmount(v, decimals);
  const total = data.pool.total;
  const room = data.maxBet - data.walletTotal;
  const problemFor = (t) => {
    const amount = toUnits(t, decimals);
    if (amount == null) return "Enter a number.";
    if (amount < data.minBet) return `Minimum ${fmt(data.minBet)} ${symbol}.`;
    if (amount > room) return `This wallet can add up to ${fmt(room)} ${symbol}.`;
    if (amount > data.balance) return `You have ${fmt(data.balance)} ${symbol}.`;
    return null;
  };
  const payoutFor = (i, t) => fmt(estimatePayout({ total, selectionStake: data.stakes[i], myStake: data.mine[i], amount: toUnits(t, decimals) }));
  const onPlace = async (i, t) => {
    const amount = toUnits(t, decimals);
    const s = pool.selections[i];
    const calls = [
      data.allowance < amount ? { ...token, functionName: "approve", args: [CONTRACTS.pools, amount], label: `Approve ${symbol}` } : null,
      { ...pools, functionName: "bet", args: [pool.market, BigInt(s.id), amount], label: "Place your bet" },
    ];
    const payout = payoutFor(i, t);
    if (await run(calls, null)) setPlaced({ project: s.project, amount: fmt(amount), payout, symbol });
  };
  const ok = wallet.status === "connected" && wallet.onTargetNetwork;
  const gate = !ok ? (
    <WalletGate wallet={wallet} reason="to bet" />
  ) : data.blocked ? (
    <p className="bm__fine">This wallet is in this tournament, so it can't bet here.</p>
  ) : data.state !== "OPEN" ? (
    <p className="bm__fine">Betting has closed for this fight.</p>
  ) : null;
  return (
    <Sheet
      pool={pool}
      symbol={symbol}
      shares={data.stakes.map((v) => (total > 0n ? Math.round(percent(v, total)) : 50))}
      balance={fmt(data.balance)}
      mine={data.mine.map((v) => (v > 0n ? fmt(v) : null))}
      problemFor={problemFor}
      payoutFor={payoutFor}
      onPlace={onPlace}
      busy={busy}
      gate={gate}
      amountAt={(p) => {
        const v = (data.balance * BigInt(p)) / 100n;
        return v > 0n ? formatUnits(v, decimals) : "";
      }}
      pctOf={(t) => {
        const v = toUnits(t, decimals);
        return v != null && data.balance > 0n ? Number((v * 10000n) / data.balance) / 100 : 0;
      }}
      footer={<TxStatus tx={tx} onDismiss={reset} />}
    />
  );
}

/** pool: from the chain open-pool list. null closes it. */
export function BetModal({ pool, wallet, onClose, onPlaced }) {
  const countdown = useCountdown(pool?.cutoffMs ?? null);
  const card = useRef(null);

  useEffect(() => {
    if (!pool) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("no-scroll");
    card.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("no-scroll");
      prev?.focus?.({ preventScroll: true });
    };
  }, [pool, onClose]);

  return createPortal(
    <AnimatePresence>
      {pool && (
        <motion.div className="bm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={card}
            className="bm__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bm-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: easeOut }}
          >
            <header className="bm__head">
              <div>
                <p className="bm__eyebrow">
                  {pool.live && <span className="live-dot" aria-hidden="true" />}
                  {pool.live ? "Live" : "Open"}
                  {countdown?.left > 0 && <span className="t-num"> · closes {countdown.text}</span>}
                </p>
                <h2 id="bm-title" className="bm__title">
                  {pool.title}
                </h2>
              </div>
              <button type="button" className="bm__close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </header>
            <ChainSheet pool={pool} wallet={wallet} onPlaced={onPlaced} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
