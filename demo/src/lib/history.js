/*
 * Turns a wallet's raw explorer data into the rows on /wallet/transactions. Pure: no network here.
 *
 * Token transfers carry the money, including payouts the bot sends for you, which never appear
 * among the wallet's own transactions. The wallet's own transactions add what moves no tokens:
 * approvals, organizer actions and anything that failed.
 */
import { decodeFunctionData } from "viem";
import tokenAbi from "@contracts/abi/FilterCoin.json";
import managerAbi from "@contracts/abi/TournamentManager.json";
import poolsAbi from "@contracts/abi/BettingPools.json";

const ABI = [...tokenAbi, ...managerAbi, ...poolsAbi];
const ZERO = "0x0000000000000000000000000000000000000000";
const POOL_CALLS = new Set(["bet", "claim", "claimFor", "claimPlatform", "claimProject", "refund", "refundFor", "settle", "sweepDust"]);
const REFUND_CALLS = new Set(["refund", "refundFor"]);

const low = (a) => (a ?? "").toLowerCase();

export function decodeCall(input) {
  if (!input || input === "0x") return null;
  try {
    return decodeFunctionData({ abi: ABI, data: input });
  } catch {
    return null;
  }
}

/** The inverse of tournamentMarket and matchMarket in pools.js. */
export function describeMarket(market) {
  const tournament = market >> 8n;
  const slot = market & 0xffn;
  if (slot === 0n) return { label: `Tournament #${tournament} · Winner`, href: `/tournaments/${tournament}` };
  return { label: `Tournament #${tournament} · Match ${slot}`, href: `/fights/${tournament}/${slot - 1n}` };
}

function marketOf(call) {
  if (!call) return null;
  if (call.functionName === "betFor") return describeMarket(call.args[0].market);
  return POOL_CALLS.has(call.functionName) ? describeMarket(call.args[0]) : null;
}

/** "createTournament" -> "Create tournament". */
export function callName(functionName) {
  if (!functionName) return "Contract call";
  const words = functionName.replace(/([A-Z])/g, " $1").toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}

function transferKind({ from, to, me, pools, functionName }) {
  if (from === ZERO && to === me) return "buy";
  if (from === me && to === ZERO) return "sell";
  if (from === me && to === pools) return "bet";
  if (from === pools && to === me) return REFUND_CALLS.has(functionName) ? "refund" : "payout";
  return to === me ? "received" : "sent";
}

/**
 * address: the wallet. transfers and txs: explorer items. contracts: { token, manager, pools }.
 * lookups: Map of hash -> { input, from }, for transactions someone else sent to this wallet's benefit.
 */
export function buildHistory({ address, transfers = [], txs = [], contracts, lookups = new Map() }) {
  const me = low(address);
  const pools = low(contracts.pools);
  const ours = new Set(Object.values(contracts).map(low));
  const sent = new Map(txs.map((t) => [t.hash, t]));
  const moved = new Set(transfers.map((t) => t.transaction_hash));

  const rows = transfers.map((t) => {
    const hash = t.transaction_hash;
    const tx = sent.get(hash);
    const known = lookups.get(hash);
    const call = decodeCall(tx?.raw_input ?? known?.input);
    const kind = transferKind({ from: low(t.from?.hash), to: low(t.to?.hash), me, pools, functionName: call?.functionName });
    return {
      id: `${hash}:${t.log_index}`,
      hash,
      time: Date.parse(t.timestamp),
      kind,
      amount: BigInt(t.total?.value ?? 0),
      paid: kind === "buy" && tx ? BigInt(tx.value ?? 0) : null,
      market: marketOf(call),
      // Someone else called our contracts directly: the payout bot, or a sponsored bet. A call we
      // can't decode went through another contract, such as a wallet's own delegation.
      auto: Boolean(call && known?.from && low(known.from) !== me),
      failed: false,
    };
  });

  for (const tx of txs) {
    if (low(tx.from?.hash) !== me || !ours.has(low(tx.to?.hash)) || moved.has(tx.hash)) continue;
    if (tx.status !== "ok" && tx.status !== "error") continue; // still pending: TxStatus shows those
    const call = decodeCall(tx.raw_input);
    const failed = tx.status === "error";
    rows.push({
      id: tx.hash,
      hash: tx.hash,
      time: Date.parse(tx.timestamp),
      kind: failed ? "failed" : call?.functionName === "approve" ? "approve" : "call",
      amount: null,
      paid: null,
      market: marketOf(call),
      auto: false,
      failed,
      title: callName(call?.functionName),
    });
  }

  return rows.sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "bets", label: "Bets", kinds: ["bet"] },
  { id: "payouts", label: "Payouts", kinds: ["payout", "refund"] },
  { id: "trades", label: "Buy & sell", kinds: ["buy", "sell"] },
  { id: "other", label: "Other", kinds: ["received", "sent", "approve", "call", "failed"] },
];

export const inFilter = (row, filterId) => {
  const kinds = FILTERS.find((f) => f.id === filterId)?.kinds;
  return !kinds || kinds.includes(row.kind);
};
