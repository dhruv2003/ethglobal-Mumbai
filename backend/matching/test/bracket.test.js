import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBracket } from '../src/index.js';
import { categoryOf, embeddingFor, makeProjects } from './fixtures.js';

const SEED = 'event-42-published-seed';
const MODEL = 'test-provider/embed@2026-10-01';
const ALL = ['defi', 'gaming', 'identity', 'infra'];

test('16 projects: every round-one fight is within a category', () => {
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 4) });
  assert.equal(b.slots.length, 16);
  assert.equal(new Set(b.slots).size, 16);
  assert.equal(b.firstRound.length, 8);
  for (const m of b.firstRound) assert.equal(categoryOf(m.a), categoryOf(m.b), `${m.a} vs ${m.b}`);
});

test('16 projects: a category\'s two pairs land in opposite halves, so it can still reach the final', () => {
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 4) });
  const top = new Set(b.slots.slice(0, 8).map(categoryOf));
  const bottom = new Set(b.slots.slice(8).map(categoryOf));
  for (const c of ALL) {
    assert.ok(top.has(c) && bottom.has(c), `${c} should appear in both halves`);
  }
});

test('8 projects: round two pits different categories against each other', () => {
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 2) });
  for (const m of b.firstRound) assert.equal(categoryOf(m.a), categoryOf(m.b));
  // Round two: winners of slots 0–3 meet, and of slots 4–7.
  for (const q of [b.slots.slice(0, 4), b.slots.slice(4, 8)]) {
    assert.notEqual(categoryOf(q[0]), categoryOf(q[2]));
  }
});

test('4 projects works', () => {
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(['defi', 'gaming'], 2) });
  for (const m of b.firstRound) assert.equal(categoryOf(m.a), categoryOf(m.b));
});

test('same team never meets in round one', () => {
  const projects = makeProjects(ALL, 2);
  projects[1].teamId = projects[0].teamId; // defi-0 and defi-1 now share a team
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects });
  const pairOf = (id) => b.firstRound.find((m) => m.a === id || m.b === id);
  assert.notEqual(pairOf('defi-0'), pairOf('defi-1'));
});

test('forks and organizer-blocked pairs never meet in round one', () => {
  const projects = makeProjects(ALL, 2);
  projects[3].forkOf = projects[2].id; // gaming-1 is a fork of gaming-0
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects, blockedPairs: [{ a: 'infra-0', b: 'infra-1', reason: 'Same founders entered twice' }] });
  const together = (x, y) => b.firstRound.some((m) => (m.a === x && m.b === y) || (m.a === y && m.b === x));
  assert.equal(together('gaming-0', 'gaming-1'), false);
  assert.equal(together('infra-0', 'infra-1'), false);
});

test('result does not depend on the order projects are listed in', () => {
  const projects = makeProjects(ALL, 4);
  const a = buildBracket({ embeddingModel: MODEL, seed: SEED, projects });
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: [...projects].reverse() });
  assert.deepEqual(a.slots, b.slots);
  assert.equal(a.inputHash, b.inputHash);
  assert.equal(a.resultHash, b.resultHash);
});

test('when every project looks the same, the seed decides, reproducibly', () => {
  const same = Array.from({ length: 8 }, (_, k) => ({
    id: `p${k}`,
    teamId: `t${k}`,
    embedding: embeddingFor('defi', 0),
    tracks: ['defi'],
    tech: ['evm'],
  }));
  const one = buildBracket({ embeddingModel: MODEL, seed: 'seed-one', projects: same });
  assert.deepEqual(one.slots, buildBracket({ embeddingModel: MODEL, seed: 'seed-one', projects: same }).slots);
  const other = buildBracket({ embeddingModel: MODEL, seed: 'seed-two', projects: same });
  assert.notDeepEqual(one.slots, other.slots);
});

test('changing any input changes the published input hash', () => {
  const projects = makeProjects(ALL, 2);
  const base = buildBracket({ embeddingModel: MODEL, seed: SEED, projects }).inputHash;
  const tweaked = structuredClone(projects);
  tweaked[0].embedding[3] += 0.001;
  assert.notEqual(buildBracket({ embeddingModel: MODEL, seed: SEED, projects: tweaked }).inputHash, base);
  assert.notEqual(buildBracket({ embeddingModel: MODEL, seed: 'other', projects }).inputHash, base);
  assert.notEqual(
    buildBracket({ embeddingModel: MODEL, seed: SEED, projects, weights: { embedding: 80, tracks: 10, tech: 10 } }).inputHash,
    base,
  );
});

test('embedding model and blocked-pair reasons are published and hashed', () => {
  const projects = makeProjects(ALL, 2);
  const blockedPairs = [{ a: 'infra-1', b: 'infra-0', reason: ' Same founders entered twice ' }];
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects, blockedPairs });
  assert.equal(b.embeddingModel, MODEL);
  assert.deepEqual(b.weights, { embedding: 60, tracks: 20, tech: 20 });
  assert.deepEqual(b.blockedPairs, [{ a: 'infra-0', b: 'infra-1', reason: 'Same founders entered twice' }]);

  const otherModel = buildBracket({ embeddingModel: 'test-provider/embed@2026-11-01', seed: SEED, projects, blockedPairs });
  assert.notEqual(otherModel.inputHash, b.inputHash);
  const otherReason = buildBracket({
    embeddingModel: MODEL,
    seed: SEED,
    projects,
    blockedPairs: [{ a: 'infra-0', b: 'infra-1', reason: 'Conflict of interest' }],
  });
  assert.notEqual(otherReason.inputHash, b.inputHash);
});

test('blocked pairs need a reason, and the embedding model is required', () => {
  const projects = makeProjects(ALL, 1);
  assert.throws(
    () => buildBracket({ embeddingModel: MODEL, seed: SEED, projects, blockedPairs: [{ a: 'defi-0', b: 'gaming-0', reason: ' ' }] }),
    { code: 'INVALID_BLOCKED_PAIR' },
  );
  assert.throws(
    () =>
      buildBracket({
        embeddingModel: MODEL,
        seed: SEED,
        projects,
        blockedPairs: [
          { a: 'defi-0', b: 'gaming-0', reason: 'x' },
          { a: 'gaming-0', b: 'defi-0', reason: 'y' },
        ],
      }),
    { code: 'INVALID_BLOCKED_PAIR' },
  );
  assert.throws(() => buildBracket({ seed: SEED, projects }), { code: 'INVALID_EMBEDDING_MODEL' });
});

test('explains each round-one pairing', () => {
  const b = buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 2) });
  for (const m of b.firstRound) {
    assert.ok(Number.isInteger(m.similarity));
    assert.deepEqual(Object.keys(m.parts).sort(), ['cosine', 'tech', 'tracks']);
  }
});

test('rejects unsupported sizes and bad input', () => {
  assert.throws(() => buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 1).slice(0, 3) }), { code: 'INVALID_SIZE' });
  assert.throws(() => buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(['defi', 'gaming', 'infra'], 2) }), {
    code: 'INVALID_SIZE',
  });
  assert.throws(() => buildBracket({ embeddingModel: MODEL, seed: '', projects: makeProjects(ALL, 1) }), { code: 'INVALID_SEED' });
  const dup = makeProjects(ALL, 1);
  dup[1].id = dup[0].id;
  assert.throws(() => buildBracket({ embeddingModel: MODEL, seed: SEED, projects: dup }), { code: 'INVALID_PROJECT' });
  assert.throws(
    () => buildBracket({ embeddingModel: MODEL, seed: SEED, projects: makeProjects(ALL, 1), blockedPairs: [{ a: 'defi-0', b: 'nope', reason: 'x' }] }),
    { code: 'INVALID_BLOCKED_PAIR' },
  );
});
