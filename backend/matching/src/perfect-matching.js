// Exact best pairing of an even number of items (up to 16) with integer weights.
//
// "Best" means, in order:
//   1. highest total weight across all pairs,
//   2. then the highest weight for the worst pair (no badly matched leftover),
//   3. then the first option found in the input order (callers sort input by the seed).
//
// Bitmask dynamic programming: each state is the set of items already paired, and the
// lowest unpaired item is always paired next. For 16 items that is at most 2^16 states,
// which runs in milliseconds and always finds the true optimum, unlike greedy pairing.

import { MatchingError } from './errors.js';

export const MAX_ITEMS = 16;

/**
 * @param {number} n  number of items, even, at most 16
 * @param {(i: number, j: number) => number | null} weight  integer weight, or null if i and j may not be paired
 * @returns {{ pairs: Array<[number, number]>, sum: number, min: number }}
 */
export function bestPerfectMatching(n, weight) {
  if (!Number.isInteger(n) || n < 2 || n % 2 !== 0 || n > MAX_ITEMS) {
    throw new MatchingError('INVALID_SIZE', `Can pair an even number of items from 2 to ${MAX_ITEMS}, got ${n}`);
  }
  const W = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return null;
      const w = weight(i, j);
      if (w !== null && !Number.isInteger(w)) {
        throw new MatchingError('INVALID_WEIGHT', `Pair weight must be an integer or null, got ${String(w)}`);
      }
      return w;
    }),
  );

  const full = (1 << n) - 1;
  const memo = new Map();

  function solve(mask) {
    if (mask === full) return { sum: 0, min: Infinity, pairs: [] };
    if (memo.has(mask)) return memo.get(mask);

    let i = 0;
    while (mask & (1 << i)) i++;

    let best = null;
    for (let j = i + 1; j < n; j++) {
      if (mask & (1 << j)) continue;
      const w = W[i][j];
      if (w === null) continue;
      const rest = solve(mask | (1 << i) | (1 << j));
      if (rest === null) continue;
      const sum = w + rest.sum;
      const min = Math.min(w, rest.min);
      if (best === null || sum > best.sum || (sum === best.sum && min > best.min)) {
        best = { sum, min, pairs: [[i, j], ...rest.pairs] };
      }
    }
    memo.set(mask, best);
    return best;
  }

  const result = solve(0);
  if (result === null) {
    throw new MatchingError('NO_VALID_PAIRING', 'No pairing satisfies the blocked-pair rules');
  }
  return result;
}
