/*
 * The betting panel on tournament and fight pages. Before cutoff: choose, preview, bet.
 * After: positions, settlement and payouts. PRD 10 and UI-08.
 * Pool shares are never shown as win chances (BET-12).
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button, Card, Chip, Input, OddsBar, Progress, StatusPill } from "@ds/ui.jsx";
import { formatAmount, manager, pools, read, toUnits, token, usePoll, useToken, useTx } from "../lib/chain.js";
import { usePayouts } from "../lib/payouts.js";
import { OUTCOME, POOL_LABEL, POOL_STATE, estimatePayout, percent } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { TESTNET_NOTE, TxStatus, WalletGate, useCountdown } from "./ChainBits.jsx";
import { FighterEnsLine } from "./EnsName.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { celebrate } from "./WalletPage.jsx";
import { bouncy, stagger, popIn } from "./fx.jsx";
import { CONTRACTS } from "../config/event.js";

function Selection({ selection, selected, share, stakeText, mine, onSelect, disabled }) {
  return (
    <motion.button
      type="button"
      variants={popIn}
      className="bet-pick"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
    >
      <PixelFighter project={selection.project} scale={2.5} label="" />
      <span className="bet-pick__text">
        <span className="t-body-strong">{selection.project.name}</span>
        <FighterEnsLine projectId={selection.project.id} />
        <span className="t-caption t-num">
          {share}% of pool · {stakeText}
        </span>
        {mine ? <span className="t-caption bet-pick__mine t-num">You: {mine}</span> : null}
      </span>
      <AnimatePresence>
        {selected && (
          <motion.span className="bet-pick__tick" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={bouncy} aria-hidden="true">
            ✓
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function Header({ title, state }) {
  const label = POOL_LABEL[state] ?? POOL_LABEL.NOT_OPEN;
  return (
    <div className="section-head">
      <h2 className="t-heading m0">{title}</h2>
      <StatusPill tone={label.tone}>{label.word}</StatusPill>
    </div>
  );
}

/** This wallet's bet in a pool (the first selection it staked on), formatted; null if none or still loading. */
export function myBet(data, info, selections) {
  if (!data || !info) return null;
  const i = data.mine.findIndex((v) => v > 0n);
  return i >= 0 ? { amount: formatAmount(data.mine[i], info.decimals), symbol: info.symbol, name: selections[i].project.name } : null;
}

/** Live chain reads for one pool and this wallet: stakes, limits, balance, allowance. */
export function usePoolData(wallet, tournamentId, market, selections) {
  const address = wallet.address;
  const key = `${market}:${selections.map((s) => s.id).join(",")}:${address}`;
  return usePoll(
    async () => {
      const [pool, stateIndex, view, limits] = await Promise.all([
        read(pools, "getPool", [market]),
        read(pools, "poolState", [market]),
        read(manager, "getMarket", [market]),
        read(manager, "betLimits", [BigInt(tournamentId)]),
      ]);
      const stakes = await Promise.all(selections.map((s) => read(pools, "selectionStake", [market, BigInt(s.id)])));
      const mine = address ? await Promise.all(selections.map((s) => read(pools, "stakes", [market, BigInt(s.id), address]))) : selections.map(() => 0n);
      const [walletTotal, claimable, refundable, paid, blocked, balance, allowance] = address
        ? await Promise.all([
            read(pools, "walletTotal", [market, address]),
            read(pools, "claimable", [market, address]),
            read(pools, "refundable", [market, address]),
            read(pools, "paidOut", [market, address]),
            read(manager, "isBlocked", [BigInt(tournamentId), address]),
            read(token, "balanceOf", [address]),
            read(token, "allowance", [address, CONTRACTS.pools]),
          ])
        : [0n, 0n, 0n, false, false, 0n, 0n];
      return { pool, state: POOL_STATE[stateIndex], view, minBet: limits[0], maxBet: limits[1], stakes, mine, walletTotal, claimable, refundable, paid, blocked, balance, allowance };
    },
    [key],
    8000,
  );
}

export function BetPanel({ wallet, tournamentId, market, selections, title }) {
  const info = useToken();
  const address = wallet.address;
  const payouts = usePayouts();
  const auto = payouts.enabled;
  const { data, error, refresh } = usePoolData(wallet, tournamentId, market, selections);
  const countdown = useCountdown(data?.state === "OPEN" ? Number(data.view.cutoff) * 1000 : null);
  const { tx, run, reset, busy } = useTx(wallet, refresh);
  const [picked, setPicked] = useState(null);
  const [text, setText] = useState("");

  if (error && !data) {
    return (
      <Card className="bet">
        <p className="t-body m0" role="alert">
          Couldn't read this pool from the chain. Retrying…
        </p>
      </Card>
    );
  }
  if (!data || !info) return <Card className="bet"><div className="skeleton bet__skeleton" aria-label="Loading pool" /></Card>;

  const { symbol, decimals } = info;
  const fmt = (v) => formatAmount(v, decimals);
  const open = data.state === "OPEN";
  const outcome = OUTCOME[data.pool.outcome];
  const total = data.pool.total;
  const index = selections.findIndex((s) => s.id === picked);
  const selection = index >= 0 ? selections[index] : null;
  const amount = toUnits(text, decimals);
  const room = data.maxBet - data.walletTotal;

  let problem = null;
  if (text && amount == null) problem = "Enter a number.";
  else if (amount != null && amount > 0n) {
    if (amount < data.minBet) problem = `The minimum bet is ${fmt(data.minBet)} ${symbol}.`;
    else if (amount > room) problem = `This wallet can add up to ${fmt(room)} ${symbol} to this pool.`;
    else if (amount > data.balance) problem = `You only have ${fmt(data.balance)} ${symbol}.`;
  }
  const ready = selection && amount != null && amount > 0n && !problem;

  const payout = ready
    ? estimatePayout({ total, selectionStake: data.stakes[index], myStake: data.mine[index], amount })
    : null;
  const staked = ready ? data.mine[index] + amount : 0n;
  const loses = ready && payout < staked;

  const placeBet = async () => {
    const calls = [
      data.allowance < amount ? { ...token, functionName: "approve", args: [CONTRACTS.pools, amount], label: `Approve ${symbol}` } : null,
      { ...pools, functionName: "bet", args: [market, BigInt(selection.id), amount], label: "Place your bet" },
    ];
    if (await run(calls, `You backed ${selection.project.name} with ${fmt(amount)} ${symbol}.`)) {
      setText("");
      celebrate();
    }
  };

  const collect = async (functionName, label, party) => {
    if ((await run({ ...pools, functionName, args: [market], label }, `${label} confirmed.`)) && party) celebrate();
  };

  const isWinner = (s) => outcome === "Resolved" && data.pool.winner === s.id;
  const two = selections.length === 2;

  return (
    <Card className="bet">
      <Header title={title} state={data.state} />

      {open && countdown && (
        <span className="t-caption bet__cutoff" aria-live="off">
          <span className="live-dot" aria-hidden="true" /> Betting closes in <b className="t-num">{countdown.text}</b>
        </span>
      )}

      {total > 0n && two ? (
        <OddsBar yesPct={Math.round(percent(data.stakes[0], total))} yesLabel={selections[0].project.name} noLabel={selections[1].project.name} />
      ) : null}

      <div className="bet__total">
        <span className="t-caption">Pool total</span>
        <span className="bet__total-value t-num">
          {fmt(total)} {symbol}
        </span>
      </div>

      <motion.div className="bet-picks" variants={stagger(0.05)} initial="hidden" animate="show">
        {selections.map((s, i) => {
          const share = total > 0n ? Math.round(percent(data.stakes[i], total)) : 0;
          return (
            <div key={s.id} className="bet-pick-wrap">
              <Selection
                selection={s}
                selected={picked === s.id || isWinner(s)}
                share={share}
                stakeText={`${fmt(data.stakes[i])} ${symbol}`}
                mine={data.mine[i] > 0n ? `${fmt(data.mine[i])} ${symbol}` : null}
                disabled={!open || data.blocked}
                onSelect={() => setPicked(s.id)}
              />
              {!two && <Progress value={share} label={`${s.project.name} has ${share}% of the pool`} tone="reward" />}
            </div>
          );
        })}
      </motion.div>

      {open && (
        <>
          <WalletGate wallet={wallet} reason="to bet" />
          {data.blocked ? (
            <p className="t-body m0 bet__blocked">This wallet is running or competing in this tournament, so it can't bet here. Switch to a different MetaMask account to bet.</p>
          ) : wallet.onTargetNetwork && address ? (
            <div className="stack">
              {data.balance === 0n ? (
                <p className="t-body m0">
                  You have no {symbol} yet.{" "}
                  <Link to="/wallet" className="link">
                    Buy some in your wallet
                  </Link>
                  .
                </p>
              ) : null}
              <Input
                id={`bet-${market}`}
                label={`Your bet (${symbol})`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={text}
                onChange={(e) => setText(e.target.value)}
                error={problem ?? undefined}
                help={`Balance ${fmt(data.balance)} · limit left ${fmt(room)}`}
              />
              <div className="trade__presets">
                {["1", "10", "100"].map((v) => (
                  <Chip key={v} selected={text === v} onClick={() => setText(v)}>
                    {v}
                  </Chip>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {ready && (
                  <motion.div className="bet__preview" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <div className="bet__preview-row">
                      <span className="t-caption">If {selection.project.name} wins, about</span>
                      <span className="t-body-strong t-num">
                        {fmt(payout)} {symbol}
                      </span>
                    </div>
                    <p className="t-caption m0">
                      {loses
                        ? "Careful: so much is on this side that a correct pick pays back less than your stake."
                        : "This estimate moves until betting closes."}{" "}
                      No early withdrawal.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button variant="primary" full disabled={!ready || busy} onClick={placeBet}>
                {busy ? "Working…" : selection ? `Back ${selection.project.name}` : "Choose a fighter"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {data.state === "LOCKED" && total === 0n && <p className="t-body m0 muted">Betting is closed. Nobody bet in this pool.</p>}

      {data.state === "LOCKED" && total > 0n && (
        <div className="stack">
          <p className="t-body m0 muted">{auto ? "Betting is closed. Winners are paid automatically as soon as the result is published." : "Betting is closed. This pool pays out once it's settled."}</p>
          {!auto && <WalletGate wallet={wallet} reason="to settle" />}
          {!auto && wallet.onTargetNetwork && address && (
            <Button variant="secondary" disabled={busy} onClick={() => collect("settle", "Settle")}>
              Settle this pool
            </Button>
          )}
        </div>
      )}

      {outcome === "Empty" && <p className="t-body m0 muted">Nobody bet in this pool, so there's nothing to pay.</p>}

      {outcome === "Resolved" && (
        <div className="stack">
          <p className="t-body m0">
            <b>{selections.find((s) => s.id === data.pool.winner)?.project.name ?? `Project ${data.pool.winner + 1}`} won.</b> Bettors share 70%, the project gets 20% and the platform 10%.
          </p>
          {!auto && <WalletGate wallet={wallet} reason="to collect" />}
          {auto && address && data.claimable > 0n && <p className="t-body m0">Sending {fmt(data.claimable)} {symbol} to your wallet automatically…</p>}
          {!auto && wallet.onTargetNetwork && address && data.claimable > 0n && (
            <Button variant="crush" full disabled={busy} onClick={() => collect("claim", "Claim", true)}>
              Claim {fmt(data.claimable)} {symbol}
            </Button>
          )}
          {data.paid && <StatusPill tone="success">You've been paid</StatusPill>}
          {(auto || (wallet.onTargetNetwork && address)) && (
            <div className="bet__payouts">
              <Button variant="ghost" size="sm" disabled={auto || busy || data.pool.projectPaid} onClick={() => collect("claimProject", "Project payout")}>
                {data.pool.projectPaid ? "Project paid" : `${auto ? "Paying" : "Pay"} project ${fmt(data.pool.projectBucket)}`}
              </Button>
              <Button variant="ghost" size="sm" disabled={auto || busy || data.pool.platformPaid} onClick={() => collect("claimPlatform", "Platform payout")}>
                {data.pool.platformPaid ? "Platform paid" : `${auto ? "Paying" : "Pay"} platform ${fmt(data.pool.platformBucket)}`}
              </Button>
            </div>
          )}
        </div>
      )}

      {outcome === "Void" && (
        <div className="stack">
          <p className="t-body m0">This pool is void, so every stake is refunded in full.</p>
          {!auto && <WalletGate wallet={wallet} reason="to get your refund" />}
          {auto && address && data.refundable > 0n && <p className="t-body m0">Sending your {fmt(data.refundable)} {symbol} back automatically…</p>}
          {!auto && wallet.onTargetNetwork && address && data.refundable > 0n && (
            <Button variant="primary" full disabled={busy} onClick={() => collect("refund", "Refund")}>
              Refund {fmt(data.refundable)} {symbol}
            </Button>
          )}
          {data.paid && <StatusPill tone="success">You've been refunded</StatusPill>}
        </div>
      )}

      <TxStatus tx={tx} onDismiss={reset} />
      <p className="t-caption m0">{TESTNET_NOTE}</p>
    </Card>
  );
}

