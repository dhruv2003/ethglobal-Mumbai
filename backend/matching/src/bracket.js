// Builds a single-elimination bracket in three steps:
//   1. Round one: pair the most similar projects (best overall pairing, not greedy).
//   2. Later rounds: at every level, group the round-one pairs so that the *least*
//      similar groups sit next to each other. Similar projects therefore end up in
//      opposite halves and can only meet as late as possible, so a crowded category
//      is not knocked out in the early rounds.
//   3. Hash every input and the result so anyone can recompute and check it.
//
// Ties are broken by an order derived from the published seed (ORG-05).

import { MatchingError } from './errors.js';
import { canonicalJson, seededKey, sha256Hex } from './hash.js';
import { bestPerfectMatching } from './perfect-matching.js';
import { DEFAULT_WEIGHTS, assertValidWeights, normalizeTags, similarityMatrix } from './similarity.js';

export const ALGORITHM_VERSION = 'similarity-matching-v1';
export const SUPPORTED_SIZES = Object.freeze([4, 8, 16]);

/**
 * @param {object} input
 * @param {string} input.seed  published seed (ORG-05)
 * @param {string} input.embeddingModel  model name and version that produced the embeddings, e.g. "provider/model@2026-10-01"
 * @param {Array<{
 *   id: string,
 *   teamId: string,
 *   embedding: number[],    // frozen embedding of the platform-generated dossier, not team-written text
 *   tracks?: string[],
 *   tech?: string[],        // chains, languages, main frameworks detected from the frozen repo
 *   forkOf?: string | null, // canonical ID of the original project, if this is a disclosed fork (SUB-05)
 * }>} input.projects
 * @param {{ embedding: number, tracks: number, tech: number }} [input.weights]
 * @param {Array<{ a: string, b: string, reason: string }>} [input.blockedPairs]
 *   extra pairs the organizer keeps apart in round one, each with a reason that is published
 */
export function buildBracket({ seed, embeddingModel, projects, weights = DEFAULT_WEIGHTS, blockedPairs = [] }) {
  validateInput(seed, embeddingModel, projects, weights, blockedPairs);

  // Fixed order from the seed. All tie-breaks follow this order.
  const ordered = [...projects].sort((a, b) => cmp(seededKey(seed, a.id), seededKey(seed, b.id)));
  const n = ordered.length;
  const { total, parts } = similarityMatrix(ordered, weights);
  const blocked = blockedSet(blockedPairs);

  // Step 1: round-one pairs with the highest total similarity.
  const r1 = bestPerfectMatching(n, (i, j) => (mustNotMeet(ordered[i], ordered[j], blocked) ? null : total[i][j]));

  // Step 2: build upward. Each node is { members: number[], children: [node, node] } or a round-one pair.
  let level = r1.pairs.map(([i, j]) => ({ members: [i, j], children: null }));
  while (level.length > 1) {
    const groupSim = (x, y) => {
      let s = 0;
      for (const a of level[x].members) for (const b of level[y].members) s += total[a][b];
      return s;
    };
    // Lowest similarity wins, so negate it and reuse the same exact matcher.
    const grouping = bestPerfectMatching(level.length, (x, y) => -groupSim(x, y));
    level = grouping.pairs.map(([x, y]) => ({
      members: [...level[x].members, ...level[y].members],
      children: [level[x], level[y]],
    }));
  }

  const slotsIdx = flatten(level[0]);
  const slots = slotsIdx.map((i) => ordered[i].id);

  const firstRound = [];
  for (let m = 0; m < n / 2; m++) {
    const i = slotsIdx[2 * m];
    const j = slotsIdx[2 * m + 1];
    firstRound.push(
      Object.freeze({
        match: m,
        a: ordered[i].id,
        b: ordered[j].id,
        similarity: total[i][j],
        parts: parts[i][j],
      }),
    );
  }

  const inputHash = sha256Hex(canonicalJson(auditableInput(seed, embeddingModel, projects, weights, blockedPairs)));
  const resultHash = sha256Hex(canonicalJson({ algorithmVersion: ALGORITHM_VERSION, inputHash, slots }));

  return Object.freeze({
    algorithmVersion: ALGORITHM_VERSION,
    seed,
    embeddingModel,
    weights: Object.freeze({ embedding: weights.embedding, tracks: weights.tracks, tech: weights.tech }),
    blockedPairs: Object.freeze(normalizeBlocked(blockedPairs)), // published with their reasons
    inputHash,
    resultHash,
    slots: Object.freeze(slots), // bracket order: slots 0–1 meet in round one, winners of 0–3 meet in round two, ...
    firstRound: Object.freeze(firstRound),
    firstRoundTotal: r1.sum,
    firstRoundWorstPair: r1.min,
  });
}

/** Same team, a disclosed fork of the other, forks of the same original, or blocked by the organizer. */
function mustNotMeet(a, b, blocked) {
  if (a.teamId === b.teamId) return true;
  if (a.forkOf && (a.forkOf === b.id || a.forkOf === b.forkOf)) return true;
  if (b.forkOf && b.forkOf === a.id) return true;
  return blocked.has(pairKey(a.id, b.id));
}

function flatten(node) {
  if (!node.children) return node.members;
  return [...flatten(node.children[0]), ...flatten(node.children[1])];
}

function validateInput(seed, embeddingModel, projects, weights, blockedPairs) {
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new MatchingError('INVALID_SEED', 'A published seed string is required');
  }
  if (typeof embeddingModel !== 'string' || embeddingModel.trim() === '') {
    throw new MatchingError('INVALID_EMBEDDING_MODEL', 'The embedding model name and version are required for the audit');
  }
  if (!Array.isArray(projects) || !SUPPORTED_SIZES.includes(projects.length)) {
    throw new MatchingError(
      'INVALID_SIZE',
      `Bracket needs exactly ${SUPPORTED_SIZES.join(', ')} projects, got ${projects?.length ?? 0} (no byes, ORG-04)`,
    );
  }
  const ids = new Set();
  for (const p of projects) {
    if (typeof p?.id !== 'string' || p.id === '' || ids.has(p.id)) {
      throw new MatchingError('INVALID_PROJECT', `Project id "${p?.id}" is missing or duplicated`);
    }
    if (typeof p.teamId !== 'string' || p.teamId === '') {
      throw new MatchingError('INVALID_PROJECT', `Project ${p.id} needs a teamId`);
    }
    ids.add(p.id);
  }
  assertValidWeights(weights);
  if (!Array.isArray(blockedPairs)) {
    throw new MatchingError('INVALID_BLOCKED_PAIR', 'blockedPairs must be an array');
  }
  const seen = new Set();
  for (const pair of blockedPairs) {
    if (!pair || !ids.has(pair.a) || !ids.has(pair.b) || pair.a === pair.b) {
      throw new MatchingError('INVALID_BLOCKED_PAIR', `Blocked pair ${JSON.stringify(pair)} must name two different projects`);
    }
    if (typeof pair.reason !== 'string' || pair.reason.trim() === '') {
      throw new MatchingError('INVALID_BLOCKED_PAIR', `Blocked pair ${pair.a} / ${pair.b} needs a published reason`);
    }
    const key = pairKey(pair.a, pair.b);
    if (seen.has(key)) {
      throw new MatchingError('INVALID_BLOCKED_PAIR', `Blocked pair ${pair.a} / ${pair.b} is listed twice`);
    }
    seen.add(key);
  }
}

/** Everything that affects the result, in a fixed shape, for the published input hash. */
function auditableInput(seed, embeddingModel, projects, weights, blockedPairs) {
  return {
    algorithmVersion: ALGORITHM_VERSION,
    seed,
    embeddingModel,
    weights: { embedding: weights.embedding, tracks: weights.tracks, tech: weights.tech },
    projects: [...projects]
      .sort((a, b) => cmp(a.id, b.id))
      .map((p) => ({
        id: p.id,
        teamId: p.teamId,
        forkOf: p.forkOf ?? null,
        embedding: p.embedding,
        tracks: normalizeTags(p.tracks),
        tech: normalizeTags(p.tech),
      })),
    blockedPairs: normalizeBlocked(blockedPairs),
  };
}

/** Blocked pairs in a fixed shape and order: a < b, sorted, reason trimmed. */
function normalizeBlocked(pairs) {
  return pairs
    .map(({ a, b, reason }) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      return Object.freeze({ a: x, b: y, reason: reason.trim() });
    })
    .sort((p, q) => cmp(pairKey(p.a, p.b), pairKey(q.a, q.b)));
}

function blockedSet(pairs) {
  return new Set(pairs.map(({ a, b }) => pairKey(a, b)));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
