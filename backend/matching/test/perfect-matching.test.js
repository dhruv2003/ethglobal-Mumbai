import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPerfectMatching } from '../src/index.js';

function table(n, entries) {
  const W = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const [i, j, w] of entries) W[i][j] = W[j][i] = w;
  return (i, j) => W[i][j];
}

test('beats greedy pairing', () => {
  // Greedy takes 0–1 (10) and is left with 2–3 (0): total 10. Best is 0–2 + 1–3: total 18.
  const w = table(4, [
    [0, 1, 10],
    [2, 3, 0],
    [0, 2, 9],
    [1, 3, 9],
    [0, 3, 0],
    [1, 2, 0],
  ]);
  const r = bestPerfectMatching(4, w);
  assert.equal(r.sum, 18);
  assert.deepEqual(r.pairs, [
    [0, 2],
    [1, 3],
  ]);
});

test('on equal totals, prefers the pairing whose worst pair is better', () => {
  // 0–1 + 2–3 = 10 + 0; 0–2 + 1–3 = 5 + 5. Same total, the second has no bad pair.
  const w = table(4, [
    [0, 1, 10],
    [2, 3, 0],
    [0, 2, 5],
    [1, 3, 5],
    [0, 3, -50],
    [1, 2, -50],
  ]);
  const r = bestPerfectMatching(4, w);
  assert.equal(r.sum, 10);
  assert.equal(r.min, 5);
});

test('matches brute force on random 8-item tables', () => {
  let state = 12345;
  const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31), state % 2001) - 1000;
  for (let trial = 0; trial < 50; trial++) {
    const entries = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) entries.push([i, j, rand()]);
    const w = table(8, entries);
    assert.equal(bestPerfectMatching(8, w).sum, bruteForceBest(8, w));
  }
});

test('never uses a blocked pair, and reports when no pairing is possible', () => {
  const w = (i, j) => ((i === 0 && j === 1) || (i === 1 && j === 0) ? null : 1);
  const r = bestPerfectMatching(4, w);
  assert.ok(!r.pairs.some(([i, j]) => i === 0 && j === 1));
  assert.throws(() => bestPerfectMatching(4, (i, j) => (i === 0 || j === 0 ? null : 1)), { code: 'NO_VALID_PAIRING' });
});

test('handles 16 items quickly', () => {
  const started = Date.now();
  const r = bestPerfectMatching(16, (i, j) => (i * 7 + j * 13) % 97);
  assert.equal(r.pairs.length, 8);
  assert.ok(Date.now() - started < 2000);
});

test('rejects odd or oversized inputs', () => {
  assert.throws(() => bestPerfectMatching(5, () => 0), { code: 'INVALID_SIZE' });
  assert.throws(() => bestPerfectMatching(18, () => 0), { code: 'INVALID_SIZE' });
  assert.throws(() => bestPerfectMatching(4, () => 0.5), { code: 'INVALID_WEIGHT' });
});

function bruteForceBest(n, w) {
  const go = (left) => {
    if (left.length === 0) return 0;
    const [i, ...rest] = left;
    let best = -Infinity;
    for (let k = 0; k < rest.length; k++) {
      const j = rest[k];
      best = Math.max(best, w(i, j) + go(rest.filter((_, x) => x !== k)));
    }
    return best;
  };
  return go([...Array(n).keys()]);
}
