/*
 * /wallet/transactions: everything this wallet has done, newest first.
 * Public RPCs only serve logs 200 blocks at a time, so history comes from the explorer's API.
 */
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Card, Chip, StatusPill } from "@ds/ui.jsx";
import { CONTRACTS, EVENT } from "../config/event.js";
import { addressUrl, formatAmount, txUrl, usePoll, useToken } from "../lib/chain.js";
import { FILTERS, inFilter } from "../lib/history.js";
import { simHistory } from "../lib/demo/sim.js";
import { Link } from "../lib/router.jsx";
import { WalletGate } from "./ChainBits.jsx";
import { fadeUp, stagger } from "./fx.jsx";

const PAGES = 4; // about 200 rows per source; older ones are a click away on the explorer

const TITLE = { buy: "Bought", sell: "Sold", bet: "Bet placed", payout: "Payout", refund: "Refund", received: "Received", sent: "Sent", approve: "Approved spending" };
const SIGN = { buy: "+", payout: "+", refund: "+", received: "+", sell: "−", bet: "−", sent: "−" };

/* Demo: the history comes from the simulated chain (lib/demo/sim.js), not an explorer. */
async function readHistory(address) {
  return { rows: simHistory(address), truncated: false };
}

const when = (ms) => new Date(ms).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Row({ row, info }) {
  const sign = SIGN[row.kind];
  return (
    <motion.li className="txn" variants={fadeUp}>
      <div className="txn__what">
        <span className="t-body-strong">{row.title ? (row.failed ? `${row.title} failed` : row.title) : TITLE[row.kind]}</span>
        <span className="t-caption">
          {when(row.time)}
          {row.market && (
            <>
              {" · "}
              <Link to={row.market.href}>{row.market.label}</Link>
            </>
          )}
          {row.auto && row.kind === "payout" ? " · Paid automatically" : ""}
        </span>
      </div>
      {row.failed ? (
        <StatusPill tone="danger">Failed</StatusPill>
      ) : row.amount != null ? (
        <span className={`txn__amount t-num ${sign === "+" ? "txn__amount--in" : ""}`}>
          <span>
            {sign}
            {formatAmount(row.amount, info.decimals)} {info.symbol}
          </span>
          {row.paid ? <span className="t-caption">for {formatAmount(row.paid, 18, 6)} {EVENT.network.symbol}</span> : null}
        </span>
      ) : null}
      <a className="t-mono-caption tx__link txn__link" href={txUrl(row.hash)} target="_blank" rel="noreferrer">
        View ↗
      </a>
    </motion.li>
  );
}

function History({ address, info }) {
  const { data, loading, error } = usePoll(() => readHistory(address), [address], 20000);
  const [filter, setFilter] = useState("all");
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, data?.rows.filter((r) => inFilter(r, f.id)).length ?? 0])), [data]);
  const rows = data?.rows.filter((r) => inFilter(r, filter)) ?? [];
  const explorer = (
    <a className="btn btn--secondary btn--sm" href={addressUrl(address)} target="_blank" rel="noreferrer">
      Open the explorer ↗
    </a>
  );

  if (!data && loading) return <div className="skeleton positions__skeleton" aria-label="Loading transactions" />;
  if (!data && error) {
    return (
      <Card variant="surface" className="empty" role="alert">
        <span className="t-body muted">Couldn't load your history just now. It'll retry shortly.</span>
        {explorer}
      </Card>
    );
  }
  if (!data?.rows.length) {
    return (
      <Card variant="surface" className="empty">
        <span className="t-body muted">No transactions yet.</span>
        <Link className="btn btn--secondary btn--sm" to="/tournaments">
          See tournaments
        </Link>
      </Card>
    );
  }
  return (
    <section className="stack" aria-label="Your transactions">
      <div className="txn-filters" role="group" aria-label="Filter transactions">
        {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
          <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="chip__count">{counts[f.id]}</span>
          </Chip>
        ))}
      </div>
      <motion.ul key={filter} className="positions" variants={stagger(0.03)} initial="hidden" animate="show">
        {rows.map((row) => (
          <Row key={row.id} row={row} info={info} />
        ))}
      </motion.ul>
      <p className="t-caption m0">
        New transactions can take a minute to appear.
        {data.truncated && (
          <>
            {" "}
            Showing the latest only.{" "}
            <a href={addressUrl(address)} target="_blank" rel="noreferrer">
              See everything on the explorer ↗
            </a>
          </>
        )}
      </p>
    </section>
  );
}

/** Overview and Transactions, the two halves of the wallet. */
export function WalletTabs({ current }) {
  return (
    <nav className="trade__tabs" aria-label="Wallet sections">
      <Link className="trade__tab" to="/wallet" aria-current={current === "overview" ? "page" : undefined}>
        Overview
      </Link>
      <Link className="trade__tab" to="/wallet/transactions" aria-current={current === "transactions" ? "page" : undefined}>
        Transactions
      </Link>
    </nav>
  );
}

export function TransactionsPage({ wallet }) {
  const info = useToken();
  const address = wallet.address;
  return (
    <div className="stack stack--page">
      <header className="intro">
        <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
          Wallet
        </h1>
        <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
          Every buy, bet and payout on this wallet, read from {EVENT.network.name}.
        </p>
      </header>
      <WalletTabs current="transactions" />
      {!address && <WalletGate wallet={wallet} reason="to see your transactions" />}
      {address && !EVENT.network.historyApi && (
        <Card variant="surface" className="empty">
          <span className="t-body muted">Transaction history isn't available on this network here.</span>
          <a className="btn btn--secondary btn--sm" href={addressUrl(address)} target="_blank" rel="noreferrer">
            Open the explorer ↗
          </a>
        </Card>
      )}
      {address && EVENT.network.historyApi && (info ? <History address={address} info={info} /> : <div className="skeleton positions__skeleton" aria-label="Loading transactions" />)}
    </div>
  );
}
