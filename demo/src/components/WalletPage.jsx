/*
 * /wallet: connect MetaMask, buy and sell back FilterCoin, see every position and collect it.
 * PRD UI-11.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { formatUnits } from "viem";
import { Button, Card, Chip, Input, StatusPill } from "@ds/ui.jsx";
import { CONTRACTS, EVENT } from "../config/event.js";
import { formatAmount, listTournaments, pools, publicClient, read, toUnits, token, usePoll, useToken, useTx } from "../lib/chain.js";
import { POOL_LABEL, POOL_STATE, matchMarket, tournamentMarket } from "../lib/pools.js";
import { Link } from "../lib/router.jsx";
import { AddressLink, AnimatedNumber, TxStatus, WalletGate } from "./ChainBits.jsx";
import { WalletTabs } from "./TransactionsPage.jsx";
import { fadeUp, popIn, stagger } from "./fx.jsx";

const BURST = ["#ffd43b", "#ff5c93", "#2f4bf0"];

export function celebrate() {
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: BURST, disableForReducedMotion: true });
}

const num = (value, decimals) => (value == null ? 0 : Number(formatUnits(value, decimals)));

function Tile({ label, value, format, hint, tone }) {
  return (
    <motion.div variants={popIn} className={`wallet-tile ${tone ? `wallet-tile--${tone}` : ""}`}>
      <span className="t-caption">{label}</span>
      <AnimatedNumber value={value} format={format} className="wallet-tile__value" />
      {hint && <span className="t-caption">{hint}</span>}
    </motion.div>
  );
}

function BuySell({ wallet, info, data, onChanged }) {
  const [mode, setMode] = useState("buy");
  const [text, setText] = useState("");
  const { tx, run, reset, busy } = useTx(wallet, onChanged);
  const symbol = info.symbol;
  const native = EVENT.network.symbol;

  const amount = toUnits(text, mode === "buy" ? 18 : info.decimals);
  const valid = amount != null && amount > 0n;
  const quote = valid ? (mode === "buy" ? amount * info.rate : amount / info.rate) : null;
  const tooMuch = valid && (mode === "buy" ? amount > (data?.eth ?? 0n) : amount > (data?.balance ?? 0n));

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || tooMuch) return;
    const ok =
      mode === "buy"
        ? await run({ ...token, functionName: "buy", value: amount, label: `Buy ${symbol}` }, `You bought ${formatAmount(quote, info.decimals)} ${symbol}.`)
        : await run({ ...token, functionName: "sell", args: [amount], label: `Sell ${symbol}` }, `You sold ${symbol} for ${formatAmount(quote, 18, 6)} ${native}.`);
    if (ok) {
      setText("");
      if (mode === "buy") celebrate();
    }
  };

  const presets = mode === "buy" ? ["0.00001", "0.0001", "0.001"] : data?.balance ? [formatUnits(data.balance, info.decimals)] : [];

  return (
    <Card className="trade">
      <div className="trade__tabs" role="group" aria-label="Buy or sell">
        {[
          ["buy", `Buy ${symbol}`],
          ["sell", "Sell back"],
        ].map(([id, label]) => (
          <button key={id} type="button" className="trade__tab" aria-pressed={mode === id} onClick={() => { setMode(id); setText(""); reset(); }}>
            {mode === id && <motion.span layoutId="trade-pill" className="trade__pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            <span className="trade__tab-label">{label}</span>
          </button>
        ))}
      </div>
      <form className="stack" onSubmit={submit}>
        <Input
          id="trade-amount"
          label={mode === "buy" ? `You pay (${native})` : `You sell (${symbol})`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={text && amount == null ? "Enter a number." : tooMuch ? `That's more ${mode === "buy" ? native : symbol} than you have.` : undefined}
        />
        <div className="trade__presets">
          {presets.map((p) => (
            <Chip key={p} selected={text === p} onClick={() => setText(p)}>
              {mode === "buy" ? `${p} ${native}` : "Sell all"}
            </Chip>
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={mode} className="trade__quote" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <span className="t-caption">You get</span>
            <span className="trade__quote-value t-num">
              {quote == null ? "—" : mode === "buy" ? `${formatAmount(quote, info.decimals)} ${symbol}` : `${formatAmount(quote, 18, 8)} ${native}`}
            </span>
          </motion.div>
        </AnimatePresence>
        <Button type="submit" variant="primary" full disabled={!valid || tooMuch || busy || !wallet.onTargetNetwork}>
          {busy ? "Working…" : mode === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
        </Button>
      </form>
      <TxStatus tx={tx} onDismiss={reset} />
      <p className="t-caption m0">{`0.00001 ${native} = 1,000 ${symbol}, plus gas.`}</p>
    </Card>
  );
}

function BackingCard({ info, data }) {
  const backed = data?.backed;
  return (
    <Card variant="surface" className="backing">
      <div className="section-head">
        <h2 className="t-heading m0">Reserves</h2>
        {backed == null ? <StatusPill>Checking…</StatusPill> : <StatusPill tone={backed ? "success" : "danger"}>{backed ? "Fully backed" : "Not backed"}</StatusPill>}
      </div>
      <p className="t-body m0 muted">Every {info.symbol} is backed by {EVENT.network.symbol} held in the contract. It only leaves when someone sells back.</p>
      <dl className="backing__rows">
        <div>
          <dt className="t-caption">{EVENT.network.symbol} held</dt>
          <dd className="t-num t-body-strong">{data ? formatAmount(data.heldEth, 18, 6) : "—"}</dd>
        </div>
        <div>
          <dt className="t-caption">{info.symbol} supply</dt>
          <dd className="t-num t-body-strong">{data ? formatAmount(data.supply, info.decimals) : "—"}</dd>
        </div>
        <div>
          <dt className="t-caption">Contract</dt>
          <dd>
            <AddressLink address={CONTRACTS.token} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

async function readPositions(address) {
  const tournaments = await listTournaments();
  const markets = tournaments.flatMap((t) => [
    { tournament: t, label: "Tournament winner", market: tournamentMarket(t.id), href: `/tournaments/${t.id}` },
    ...t.matches.flatMap((m, i) => (m.status === 0 ? [] : [{ tournament: t, label: `Match ${i + 1}`, market: matchMarket(t.id, i), href: `/fights/${t.id}/${i}` }])),
  ]);
  const rows = await Promise.all(
    markets.map(async (entry) => {
      const stake = await read(pools, "walletTotal", [entry.market, address]);
      if (stake === 0n) return null;
      const [state, claimable, refundable, paid] = await Promise.all([
        read(pools, "poolState", [entry.market]),
        read(pools, "claimable", [entry.market, address]),
        read(pools, "refundable", [entry.market, address]),
        read(pools, "paidOut", [entry.market, address]),
      ]);
      return { ...entry, stake, state: POOL_STATE[state], claimable, refundable, paid };
    }),
  );
  return rows.filter(Boolean);
}

function Positions({ wallet, info, onChanged }) {
  const { data, loading, error, refresh } = usePoll(() => (wallet.address ? readPositions(wallet.address) : Promise.resolve([])), [wallet.address], 15000, { key: wallet.address ? `positions:${wallet.address.toLowerCase()}` : null });
  const done = async () => {
    await refresh();
    await onChanged?.();
  };
  const { tx, run, reset, busy } = useTx(wallet, done);

  const collect = async (row, functionName, word) => {
    const ok = await run({ ...pools, functionName, args: [row.market], label: word }, `${word} confirmed.`);
    if (ok && functionName === "claim") celebrate();
  };

  return (
    <section className="stack" aria-label="Your positions">
      <div className="section-head">
        <h2 className="t-heading m0">Your positions</h2>
        {data?.length ? <span className="t-caption">{data.length} open or settled</span> : null}
      </div>
      <TxStatus tx={tx} onDismiss={reset} />
      {error && !data ? (
        <p className="t-body m0" role="alert">
          Couldn't read your positions from the chain. They'll retry shortly.
        </p>
      ) : loading && !data ? (
        <div className="skeleton positions__skeleton" aria-label="Loading positions" />
      ) : !data?.length ? (
        <Card variant="surface" className="empty">
          <span className="t-body muted">No bets yet.</span>
          <Link className="btn btn--secondary btn--sm" to="/tournaments">
            See tournaments
          </Link>
        </Card>
      ) : (
        <motion.ul className="positions" variants={stagger(0.05)} initial="hidden" animate="show">
          {data.map((row) => {
            const label = POOL_LABEL[row.state];
            return (
              <motion.li key={String(row.market)} className="position" variants={fadeUp} layout>
                <div className="position__what">
                  <Link className="t-body-strong" to={row.href}>
                    Tournament #{row.tournament.id} · {row.label}
                  </Link>
                  <span className="t-caption t-num">
                    Staked {formatAmount(row.stake, info.decimals)} {info.symbol}
                  </span>
                </div>
                <StatusPill tone={label.tone}>{label.word}</StatusPill>
                {row.claimable > 0n ? (
                  <Button variant="oracle" size="sm" disabled={busy} onClick={() => collect(row, "claim", "Claim")}>
                    Claim {formatAmount(row.claimable, info.decimals)}
                  </Button>
                ) : row.refundable > 0n ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => collect(row, "refund", "Refund")}>
                    Refund {formatAmount(row.refundable, info.decimals)}
                  </Button>
                ) : (
                  <span className="t-caption">{row.paid ? "Paid out" : row.state === "RESOLVED" ? "Didn't win" : "Nothing to collect yet"}</span>
                )}
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </section>
  );
}

export function WalletPage({ wallet }) {
  const info = useToken();
  const address = wallet.address;
  const { data, refresh } = usePoll(
    async () => {
      const [heldEth, supply, backed, eth, balance] = await Promise.all([
        publicClient.getBalance({ address: CONTRACTS.token }),
        read(token, "totalSupply"),
        read(token, "isFullyBacked").catch(() => null),
        address ? publicClient.getBalance({ address }) : 0n,
        address ? read(token, "balanceOf", [address]) : 0n,
      ]);
      return { heldEth, supply, backed, eth, balance };
    },
    [address],
    12000,
  );

  const decimals = info?.decimals ?? 18;
  const format4 = useMemo(() => (v) => v.toLocaleString("en-US", { maximumFractionDigits: 5 }), []);

  return (
    <div className="stack stack--page">
      <header className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
            Wallet
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
            Buy FILTER to bet on fights.
          </p>
        </div>
      </header>

      <WalletTabs current="overview" />

      <WalletGate wallet={wallet} reason="to buy and bet" />

      {address && (
        <motion.div className="wallet-tiles" variants={stagger(0.08)} initial="hidden" animate="show">
          <Tile label={`${info?.symbol ?? "Token"} balance`} value={num(data?.balance, decimals)} tone="sunny" />
          <Tile label={`${EVENT.network.symbol} balance`} value={num(data?.eth, 18)} format={format4} hint="Pays your gas" />
          <Tile label="Network" value={EVENT.network.chainId} format={(v) => String(Math.round(v))} hint={EVENT.network.name} />
        </motion.div>
      )}


      {info ? (
        <div className="wallet-grid">
          {info.rate ? (
            <BuySell wallet={wallet} info={info} data={data} onChanged={refresh} />
          ) : (
            <Card className="stack">
              <h2 className="t-heading m0">Get {info.symbol}</h2>
              <p className="t-body m0 muted">This network's betting token isn't sold here. Use its faucet to get some.</p>
            </Card>
          )}
          {info.rate ? <BackingCard info={info} data={data} /> : null}
        </div>
      ) : (
        <div className="skeleton positions__skeleton" aria-label="Loading token details" />
      )}

      {info && address ? <Positions wallet={wallet} info={info} onChanged={refresh} /> : null}
    </div>
  );
}
