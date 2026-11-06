/*
 * Practice betting on the demo events. The chain has no open pools between real events, so the
 * demo tournaments take bets in practice credits instead. Credits live in this browser only and are
 * never mixed with on-chain money: every practice pool is flagged `practice: true`.
 */
import { MOCK_TOURNAMENTS } from "./demoArena.js";

const SLOT = "arena.practice.v1";
export const PRACTICE_SYMBOL = "CREDITS";
export const PRACTICE_START = 1000;
export const PRACTICE_MIN = 1;

const WINDOW_MS = 15 * 60 * 1000;

function read() {
  try {
    const raw = localStorage.getItem(SLOT);
    const data = raw ? JSON.parse(raw) : null;
    if (data && typeof data.balance === "number" && Array.isArray(data.bets)) return data;
  } catch {
    /* storage blocked: fall through to a fresh ledger */
  }
  return { balance: PRACTICE_START, bets: [] };
}

function write(data) {
  try {
    localStorage.setItem(SLOT, JSON.stringify(data));
  } catch {
    /* private window: the bet still counts for this visit */
  }
  window.dispatchEvent(new Event("arena:practice"));
}

let memory = null;
export const practiceLedger = () => (memory ??= read());

/** Place a practice bet. Returns the updated ledger, or throws with a friendly message. */
export function placePracticeBet({ market, selection, amount, payout = 0 }) {
  const ledger = practiceLedger();
  if (!(amount >= PRACTICE_MIN)) throw new Error(`The minimum bet is ${PRACTICE_MIN} ${PRACTICE_SYMBOL}.`);
  if (amount > ledger.balance) throw new Error(`You only have ${ledger.balance} ${PRACTICE_SYMBOL}.`);
  memory = { balance: ledger.balance - amount, bets: [...ledger.bets, { market, selection, amount, payout, at: Date.now() }] };
  write(memory);
  return memory;
}

/**
 * Settle one practice market once its fight has a winner: winning bets pay their locked-in
 * payout, losing bets are gone. Each bet settles once. Returns what was won and lost this time.
 */
export function settlePractice(market, winnerSelection) {
  const ledger = practiceLedger();
  let won = 0;
  let lost = 0;
  const bets = ledger.bets.map((b) => {
    if (b.market !== market || b.settled) return b;
    if (b.selection === winnerSelection) won += b.payout || b.amount;
    else lost += b.amount;
    return { ...b, settled: true };
  });
  if (won || lost) {
    memory = { balance: ledger.balance + won, bets };
    write(memory);
  }
  return { won, lost, balance: practiceLedger().balance };
}

export const myPracticeStake = (market, selection) =>
  practiceLedger().bets.filter((b) => b.market === market && b.selection === selection).reduce((s, b) => s + b.amount, 0);

export const practiceMarket = (tournamentId, matchIndex) => `${tournamentId}:${matchIndex}`;

/** A demo match takes practice bets while both fighters are known and it hasn't been decided. */
export const isPracticeOpen = (t, match) =>
  Boolean(t?.demo) && (t.phase === "live" || t.phase === "upcoming") && match.a != null && match.b != null && (match.status === "live" || match.status === "scheduled");

/** Seeded stakes on each side, the same split the fight page always showed for demo pools. */
export function practiceStakes(t, matchIndex) {
  const total = Math.round((t.poolTotal ?? 0) / t.count);
  const shareA = 35 + ((matchIndex * 13) % 31);
  const match = t.matches[matchIndex];
  const base = [Math.round((total * shareA) / 100), total - Math.round((total * shareA) / 100)];
  return [base[0] + myPracticeStake(practiceMarket(t.id, matchIndex), match.a), base[1] + myPracticeStake(practiceMarket(t.id, matchIndex), match.b)];
}

/** Rolling cutoff: always the end of the current 15-minute window, staggered per match. */
export const practiceCutoff = (matchIndex, now = Date.now()) => {
  const offset = (matchIndex % 5) * 60 * 1000;
  return Math.floor((now - offset) / WINDOW_MS) * WINDOW_MS + WINDOW_MS + offset;
};

/** Everything a bet popup needs for one match, practice or chain. */
export function matchBetPool(t, matchIndex, { practice }) {
  const match = t.matches[matchIndex];
  const a = t.projects[match.a];
  const b = t.projects[match.b];
  return {
    key: `${t.id}-${matchIndex}`,
    practice,
    tournamentId: t.id,
    matchIndex,
    market: practice ? practiceMarket(t.id, matchIndex) : null,
    title: `${a.name} vs ${b.name}`,
    detail: `${t.title} · ${match.roundName}`,
    to: `/fights/${t.id}/${matchIndex}`,
    live: match.status === "live",
    cutoffMs: practice ? practiceCutoff(matchIndex) : match.cutoffMs,
    fighters: [a, b],
    stakes: practice ? practiceStakes(t, matchIndex) : null,
    selections: [
      { id: match.a, project: a },
      { id: match.b, project: b },
    ],
  };
}

/** Every demo match taking practice bets right now, live fights first. */
export function practicePools(tournaments = MOCK_TOURNAMENTS) {
  return tournaments
    .filter((t) => t.demo)
    .flatMap((t) => t.matches.filter((m) => isPracticeOpen(t, m)).map((m) => matchBetPool(t, m.index, { practice: true })))
    .sort((x, y) => Number(y.live) - Number(x.live));
}

/** The bet just placed, so the fight view can show it. Per tab. */
const LAST = "arena.lastBet";
export function rememberBet(bet) {
  try {
    sessionStorage.setItem(LAST, JSON.stringify(bet));
  } catch {
    /* ignore */
  }
}
export function lastBet(poolKey) {
  try {
    const bet = JSON.parse(sessionStorage.getItem(LAST) ?? "null");
    return bet?.poolKey === poolKey ? bet : null;
  } catch {
    return null;
  }
}
