/*
 * DEMO: the simulated chain. Holds the tournament, the betting pools, the token and the
 * demo wallet in memory for this tab. lib/chain.js routes every contract read and write
 * here, so the components read it exactly as they would read Base Sepolia.
 *
 * Live fights: betting is open when the page loads and the crowd's bets (src/data/bets.json)
 * arrive over time, so the odds move. Placing a bet closes betting a few seconds later, the
 * recorded fight is revealed, and when it has played the match is finalized and the pool
 * settles from the same scores the fight shows.
 */
import { formatUnits, parseUnits } from "viem";
import tournamentData from "@data/tournament.json";
import betsData from "@data/bets.json";
import chainData from "@data/chain.json";
import { CONTRACTS } from "../../config/event.js";

export const T0 = Date.now();
const D = 18;
const units = (n) => parseUnits(String(n), D);
const sec = (ms) => BigInt(Math.floor(ms / 1000));
const low = (a) => String(a ?? "").toLowerCase();
const hex = (n = 64) => `0x${Array.from({ length: n }, () => "0123456789abcdef"[(Math.random() * 16) | 0]).join("")}`;

export const DEMO_ADDRESS = chainData.demoWallet.address;
const TID = BigInt(tournamentData.id);
export const matchMarket = (m) => (TID << 8n) | BigInt(m + 1);
const marketMatch = (market) => Number(BigInt(market) & 0xffn) - 1;

/* ---------- listeners: anything that changed pokes subscribers (polls refresh at once) ---------- */
const subs = new Set();
export const onChange = (fn) => (subs.add(fn), () => subs.delete(fn));
const changed = () => subs.forEach((fn) => fn());

/* ---------- state ---------- */
const LIVE_OPEN_MS = 12 * 60 * 1000; // a live fight's betting stays open this long if nobody bets
const CLOSE_AFTER_BET_MS = 7000; // after your bet, betting closes and the fight starts
const FALLBACK_FINISH_MS = 75 * 1000; // if nobody watches it, the result lands this long after cutoff

const state = {
  eth: new Map([[low(DEMO_ADDRESS), units(chainData.demoWallet.eth)]]),
  filter: new Map([[low(DEMO_ADDRESS), units(chainData.demoWallet.filter)]]),
  allowance: new Map(),
  myBets: [], // { market, selection, amount, at, hash }
  txs: [], // the demo wallet's history
  matches: tournamentData.matches.map((m) =>
    m.live
      ? { ...m, status: 1, cutoffMs: T0 + LIVE_OPEN_MS, startMs: T0 - 90 * 1000, finalizedAt: null }
      : { ...m, status: 3, cutoffMs: Date.parse(m.finishedAt) - 20 * 60 * 1000, startMs: Date.parse(m.finishedAt) - 10 * 60 * 1000, finalizedAt: Date.parse(m.finishedAt) },
  ),
  paid: new Set(), // markets the demo wallet has been paid in
};

export const matchState = (m) => state.matches[m];
export const cutoffOf = (m) => state.matches[m]?.cutoffMs ?? 0;

/** The fight for match m has played to its result (FightTheater tells us). Finalize it now. */
export function fightFinished(m) {
  const s = state.matches[m];
  if (!s || s.status === 3 || Date.now() < s.cutoffMs) return;
  finalize(m);
}

function finalize(m) {
  const s = state.matches[m];
  s.status = 3;
  s.finalizedAt = Date.now();
  // Payout bot: winners are paid a moment after the result is published.
  setTimeout(() => {
    payOut(matchMarket(m));
    changed();
  }, 2500);
  changed();
}

function tick() {
  const now = Date.now();
  for (const [m, s] of state.matches.entries()) {
    if (s.live && s.status === 1 && now > s.cutoffMs + FALLBACK_FINISH_MS) finalize(m);
  }
}
setInterval(tick, 1000);

/* ---------- tournament (TournamentManager) ---------- */
const ZERO32 = `0x${"0".repeat(64)}`;
function getMatch(i) {
  const tm = state.matches[i];
  if (tm) {
    return {
      status: tm.status,
      source: tm.status === 3 ? 1 : 0,
      projectA: tm.projectA,
      projectB: tm.projectB,
      winner: tm.status === 3 ? tm.winner : 0,
      scoreA: tm.status === 3 ? tm.scoreA : 0,
      scoreB: tm.status === 3 ? tm.scoreB : 0,
      tieA: 0,
      tieB: 0,
      cutoff: sec(tm.cutoffMs),
      scheduledStart: sec(tm.startMs),
      deadline: sec(tm.cutoffMs + 3 * 3600 * 1000),
      resultHash: tm.status === 3 ? tm.resultHash : ZERO32,
      rationaleHash: ZERO32,
    };
  }
  return { status: 0, source: 0, projectA: 0, projectB: 0, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff: 0n, scheduledStart: 0n, deadline: 0n, resultHash: ZERO32, rationaleHash: ZERO32 };
}

function getTournament() {
  const t = tournamentData;
  return {
    configHash: t.configHash,
    seed: t.seed,
    bracketHash: t.bracketHash,
    organizer: t.organizer,
    reviewer: t.reviewer,
    publisher: t.publisher,
    platformRecipient: t.platformRecipient,
    minBet: units(t.minBet),
    maxBet: units(t.maxBet),
    scheduledStart: sec(Date.parse(t.scheduledStart)),
    bettingCutoff: sec(Date.parse(t.bettingCutoff)),
    resolutionDeadline: sec(Date.parse(t.resolutionDeadline)),
    status: 2,
    capacity: t.capacity,
    projectCount: t.projects.length,
    finalizedCount: state.matches.filter((m) => m.status === 3).length,
    champion: 0,
  };
}

/* ---------- pools (BettingPools) ---------- */
function poolBets(market) {
  const m = marketMatch(market);
  const s = state.matches[m];
  if (!s) return [];
  const now = Date.now();
  const crowd = (betsData[m] ?? [])
    .filter((b) => (s.live ? T0 + b.at * 1000 <= Math.min(now, s.cutoffMs) : true))
    .map((b) => ({ selection: b.selection, amount: units(b.amount), who: low(b.address) }));
  const mine = state.myBets.filter((b) => b.market === market).map((b) => ({ selection: b.selection, amount: b.amount, who: low(DEMO_ADDRESS) }));
  return [...crowd, ...mine];
}

/** The crowd's bets on match m so far (for the live ticker on the fight page). */
export function recentBets(m) {
  const s = state.matches[m];
  if (!s) return [];
  const now = Date.now();
  const crowd = (betsData[m] ?? []).filter((b) => (s.live ? T0 + b.at * 1000 <= Math.min(now, s.cutoffMs) : true)).map((b) => ({ ...b, time: s.live ? T0 + b.at * 1000 : s.cutoffMs - 600000 + b.at * 1000 }));
  const mine = state.myBets.filter((b) => b.market === matchMarket(m)).map((b) => ({ bettor: "you", side: b.selection === s.projectA ? "a" : "b", selection: b.selection, amount: formatUnits(b.amount, D), time: b.at, txHash: b.hash, mine: true }));
  return [...crowd, ...mine].sort((x, y) => y.time - x.time);
}

function poolView(market) {
  const m = marketMatch(market);
  const s = state.matches[m];
  const bets = poolBets(market);
  const total = bets.reduce((x, b) => x + b.amount, 0n);
  const sel = (id) => bets.filter((b) => b.selection === id).reduce((x, b) => x + b.amount, 0n);
  const resolved = s?.status === 3;
  const winner = resolved ? s.winner : 0;
  const winningStake = resolved ? sel(winner) : 0n;
  const bettorBucket = resolved ? (total * 70n) / 100n : 0n;
  return {
    m,
    s,
    bets,
    sel,
    pool: {
      total,
      selectionsStaked: BigInt(new Set(bets.map((b) => b.selection)).size),
      winningStake,
      bettorBucket,
      projectBucket: resolved ? (total * 20n) / 100n : 0n,
      platformBucket: resolved ? total - bettorBucket - (total * 20n) / 100n : 0n,
      claimedStake: 0n,
      paidToBettors: resolved ? bettorBucket : 0n,
      outcome: resolved ? (total === 0n ? 1 : 3) : 0,
      winner,
      projectPaid: resolved,
      platformPaid: resolved,
      dustSwept: false,
    },
  };
}

function poolState(market) {
  const { s } = poolView(market);
  if (!s) return 0;
  if (s.status === 3) return 3;
  if (s.status === 1) return Date.now() < s.cutoffMs ? 1 : 2;
  return 0;
}

const mineIn = (market, selection) => state.myBets.filter((b) => b.market === market && (selection == null || b.selection === selection)).reduce((x, b) => x + b.amount, 0n);

function claimable(market) {
  const { pool, s, sel } = poolView(market);
  if (!s || s.status !== 3 || state.paid.has(String(market))) return 0n;
  const mine = mineIn(market, s.winner);
  const winStake = sel(s.winner);
  return mine && winStake ? (pool.bettorBucket * mine) / winStake : 0n;
}

function payOut(market) {
  const amount = claimable(market);
  if (amount > 0n) {
    addFilter(DEMO_ADDRESS, amount);
    state.txs.push({ hash: hex(), time: Date.now(), kind: "payout", amount, market, auto: true });
  }
  if (amount > 0n) state.paid.add(String(market));
}

const addFilter = (who, v) => state.filter.set(low(who), (state.filter.get(low(who)) ?? 0n) + v);

/* ---------- reads ---------- */
const RATE = BigInt(chainData.token.rate);
const handlers = {
  // token
  symbol: () => chainData.token.symbol,
  decimals: () => D,
  name: () => chainData.token.name,
  RATE: () => RATE,
  totalSupply: () => units(48250),
  isFullyBacked: () => true,
  balanceOf: ([who]) => state.filter.get(low(who)) ?? 0n,
  allowance: ([owner]) => state.allowance.get(low(owner)) ?? 0n,
  // manager
  tournamentCount: () => 1n,
  getTournament: ([id]) => (BigInt(id) === TID ? getTournament() : { status: 0 }),
  getMatch: ([, i]) => getMatch(Number(i)),
  betLimits: () => [units(tournamentData.minBet), units(tournamentData.maxBet)],
  getMarket: ([market]) => {
    const m = marketMatch(market);
    const s = state.matches[m];
    return { exists: Boolean(s), hasWinner: s?.status === 3, isVoid: false, winner: s?.status === 3 ? s.winner : 0, cutoff: sec(s?.cutoffMs ?? 0), deadline: sec((s?.cutoffMs ?? 0) + 3 * 3600 * 1000), tournamentId: TID };
  },
  isBlocked: () => false,
  hasRole: () => false,
  ORGANIZER_ROLE: () => ZERO32,
  PUBLISHER_ROLE: () => ZERO32,
  DEFAULT_ADMIN_ROLE: () => ZERO32,
  // pools
  getPool: ([market]) => poolView(market).pool,
  poolState: ([market]) => poolState(market),
  selectionStake: ([market, sel]) => poolView(market).sel(Number(sel)),
  stakes: ([market, sel, who]) => (low(who) === low(DEMO_ADDRESS) ? mineIn(market, Number(sel)) : 0n),
  walletTotal: ([market, who]) => (low(who) === low(DEMO_ADDRESS) ? mineIn(market) : 0n),
  claimable: ([market, who]) => (low(who) === low(DEMO_ADDRESS) ? claimable(market) : 0n),
  refundable: () => 0n,
  paidOut: ([market, who]) => low(who) === low(DEMO_ADDRESS) && state.paid.has(String(market)),
};

export async function simRead(functionName, args = []) {
  tick();
  const h = handlers[functionName];
  if (!h) throw new Error(`The demo chain has no ${functionName}()`);
  return h(args);
}

export const ethBalance = (who) => (low(who) === low(CONTRACTS.token) ? units(482.5) / 1000n : (state.eth.get(low(who)) ?? 0n));

/* ---------- writes (the wallet's transactions) ---------- */
export async function simWrite({ functionName, args = [], value }) {
  const hash = hex();
  const me = low(DEMO_ADDRESS);
  if (functionName === "approve") {
    state.allowance.set(me, BigInt(args[1]));
    state.txs.push({ hash, time: Date.now(), kind: "approve" });
  } else if (functionName === "bet") {
    const [market, selection, amount] = args;
    const m = marketMatch(market);
    const s = state.matches[m];
    if (!s || poolState(market) !== 1) throw Object.assign(new Error("BettingClosed"), { shortMessage: "BettingClosed" });
    if ((state.filter.get(me) ?? 0n) < amount) throw Object.assign(new Error("ERC20InsufficientBalance"), { shortMessage: "ERC20InsufficientBalance" });
    state.filter.set(me, state.filter.get(me) - amount);
    state.myBets.push({ market: BigInt(market), selection: Number(selection), amount: BigInt(amount), at: Date.now(), hash });
    state.txs.push({ hash, time: Date.now(), kind: "bet", amount: BigInt(amount), market: BigInt(market) });
    // Your bet is in: betting closes in a few seconds and the fight starts.
    s.cutoffMs = Math.min(s.cutoffMs, Date.now() + CLOSE_AFTER_BET_MS);
  } else if (functionName === "buy") {
    const v = BigInt(value ?? 0);
    if ((state.eth.get(me) ?? 0n) < v) throw Object.assign(new Error("insufficient funds"), { shortMessage: "insufficient funds" });
    state.eth.set(me, state.eth.get(me) - v);
    addFilter(me, v * RATE);
    state.txs.push({ hash, time: Date.now(), kind: "buy", amount: v * RATE, paid: v });
  } else if (functionName === "sell") {
    const amount = BigInt(args[0]);
    state.filter.set(me, (state.filter.get(me) ?? 0n) - amount);
    state.eth.set(me, (state.eth.get(me) ?? 0n) + amount / RATE);
    state.txs.push({ hash, time: Date.now(), kind: "sell", amount });
  } else if (functionName === "claim" || functionName === "settle") {
    payOut(BigInt(args[0]));
  } else {
    state.txs.push({ hash, time: Date.now(), kind: "call", title: functionName });
  }
  changed();
  return hash;
}

/** Rows for /wallet/transactions, in lib/history.js's row shape. */
export function simHistory(address) {
  if (low(address) !== low(DEMO_ADDRESS)) return [];
  const label = (market) => {
    if (market == null) return null;
    const m = marketMatch(market);
    return { label: `Tournament #${tournamentData.id} · Match ${m + 1}`, href: `/fights/${tournamentData.id}/${m}` };
  };
  const start = { id: "start", hash: "0x" + "d".repeat(64), time: T0 - 3600 * 1000, kind: "received", amount: units(chainData.demoWallet.filter), paid: null, market: null, auto: true, failed: false };
  return [start, ...state.txs.map((t) => ({ id: t.hash, hash: t.hash, time: t.time, kind: t.kind, amount: t.amount ?? null, paid: t.paid ?? null, market: label(t.market), auto: Boolean(t.auto), failed: false, title: t.title }))].sort((a, b) => b.time - a.time);
}

export const simTx = (hash) => state.txs.find((t) => t.hash === hash) ?? null;

/* ---------- rankings: what every bettor has won, from the same pools the fights settle ---------- */
/**
 * One row per bettor: staked, won (their share of the 70% bettor bucket of each settled pool),
 * net on settled fights, and stake still riding on live ones. Sorted by net, best first.
 */
export function leaderboard() {
  tick();
  const names = new Map();
  for (const list of Object.values(betsData)) for (const b of list) names.set(low(b.address), b.bettor);
  names.set(low(DEMO_ADDRESS), "you");
  const rows = new Map();
  const row = (who) => {
    if (!rows.has(who)) rows.set(who, { address: who, name: names.get(who) ?? `${who.slice(0, 6)}…${who.slice(-4)}`, you: who === low(DEMO_ADDRESS), bets: 0, staked: 0n, open: 0n, won: 0n, settledStake: 0n, hits: 0, settled: 0, best: 0n, picks: [] });
    return rows.get(who);
  };
  for (const [m, s] of state.matches.entries()) {
    const market = matchMarket(m);
    const { bets, pool, sel } = poolView(market);
    const resolved = s.status === 3;
    const winStake = resolved ? sel(s.winner) : 0n;
    // One bettor can stake more than once on a match: tally per (bettor, match).
    const per = new Map();
    for (const b of bets) {
      const k = b.who;
      const e = per.get(k) ?? { stake: 0n, onWinner: 0n, selection: b.selection };
      e.stake += b.amount;
      if (resolved && b.selection === s.winner) e.onWinner += b.amount;
      per.set(k, e);
    }
    for (const [who, e] of per) {
      const r = row(who);
      r.bets += 1;
      r.staked += e.stake;
      if (!resolved) {
        r.open += e.stake;
        r.picks.push({ match: m, selection: e.selection, result: "open" });
        continue;
      }
      const payout = e.onWinner && winStake ? (pool.bettorBucket * e.onWinner) / winStake : 0n;
      r.settled += 1;
      r.settledStake += e.stake;
      r.won += payout;
      if (payout > 0n) r.hits += 1;
      if (payout > r.best) r.best = payout;
      r.picks.push({ match: m, selection: e.selection, result: payout > 0n ? "won" : "lost", payout });
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, net: r.won - r.settledStake }))
    .sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : b.won > a.won ? 1 : b.won < a.won ? -1 : 0));
}
