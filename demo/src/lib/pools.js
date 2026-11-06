/*
 * Pure pool and bracket maths. Mirrors BettingPools.sol and TournamentManager.sol,
 * and uses integers only, so previews match what the contracts pay.
 */

export const POOL_STATE = ["NOT_OPEN", "OPEN", "LOCKED", "RESOLVED", "VOID"];
export const POOL_LABEL = {
  NOT_OPEN: { tone: "neutral", word: "Not open" },
  OPEN: { tone: "live", word: "Betting open" },
  LOCKED: { tone: "neutral", word: "Betting closed" },
  RESOLVED: { tone: "success", word: "Settled" },
  VOID: { tone: "danger", word: "Void: refunds open" },
};

export const OUTCOME = ["Unsettled", "Empty", "Void", "Resolved"];
export const MATCH_STATUS = ["None", "Open", "HumanReview", "Finalized", "Void"];
export const TOURNAMENT_STATUS = ["None", "Configured", "Frozen", "Completed", "Canceled"];
export const WIN_SOURCE = ["None", "Score", "Tiebreak", "Organizer"];

export const tournamentMarket = (id) => BigInt(id) << 8n;
export const matchMarket = (id, matchIndex) => (BigInt(id) << 8n) | BigInt(matchIndex + 1);

/** Total paid back if this selection wins after adding `amount`. PRD 10.3. */
export function estimatePayout({ total = 0n, selectionStake = 0n, myStake = 0n, amount = 0n }) {
  const pool = total + amount;
  const winningStake = selectionStake + amount;
  if (winningStake === 0n) return 0n;
  return (((pool * 70n) / 100n) * (myStake + amount)) / winningStake;
}

/** Round of a match and its place in the bracket, for N projects. */
export function matchRound(matchIndex, count) {
  let start = 0;
  let size = count / 2;
  let round = 1;
  while (matchIndex >= start + size) {
    start += size;
    size /= 2;
    round += 1;
  }
  return { round, start, size };
}

export function roundName(size) {
  if (size === 1) return "Final";
  if (size === 2) return "Semifinals";
  if (size === 4) return "Quarterfinals";
  return `Round of ${size * 2}`;
}

/** Earlier matches that feed a later match, or null in round one. */
export function feeders(matchIndex, count) {
  const half = count / 2;
  if (matchIndex < half) return null;
  const first = (matchIndex - half) * 2;
  return [first, first + 1];
}

/** Group match indexes by round: [{ round, name, matches: [index, ...] }]. */
export function bracketRounds(count) {
  const rounds = [];
  let start = 0;
  let size = count / 2;
  let round = 1;
  while (size >= 1) {
    rounds.push({ round, name: roundName(size), matches: Array.from({ length: size }, (_, i) => start + i) });
    start += size;
    size /= 2;
    round += 1;
  }
  return rounds;
}

/** "82.5" -> 8250 (hundredths). Returns null unless it's 0 to 100 with at most two decimals. */
export function parseScore(text) {
  const s = String(text ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return value <= 10000 ? value : null;
}

/** Whole-number percentage of a part, for display only. */
export function percent(part, whole) {
  if (!whole) return 0;
  return Number((part * 10000n) / whole) / 100;
}

/**
 * What a wallet's stakes in a finished two-sided pool come to, using the contract's rules and
 * chain numbers only. null if the wallet didn't bet. `mine` and `stakes` are in selection order.
 */
export function settledResult({ stakes, mine, winnerIndex }) {
  const myStake = mine[0] + mine[1];
  if (myStake === 0n) return null;
  if (stakes[0] === 0n || stakes[1] === 0n) return { kind: "refund", amount: myStake };
  if (mine[winnerIndex] === 0n) return { kind: "lost", amount: 0n };
  const bucket = ((stakes[0] + stakes[1]) * 70n) / 100n;
  return { kind: "won", amount: (bucket * mine[winnerIndex]) / stakes[winnerIndex] };
}
