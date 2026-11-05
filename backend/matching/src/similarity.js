// How alike two projects are, as an integer from -10000 to 10000.
// Floating-point math is used only to compute cosine, which is then rounded once to an
// integer and stored. Every later step (matching, bracket placement) uses integers only.

import { MatchingError } from './errors.js';

export const SCALE = 10000;

/** Default blend: what the project does matters most; shared tracks and tech add to it. */
export const DEFAULT_WEIGHTS = Object.freeze({ embedding: 60, tracks: 20, tech: 20 });

/**
 * Subtracts the mean vector and scales each vector to length 1.
 * Embedding models put most texts at cosine 0.7–0.9 from each other; centering removes
 * that shared component so real differences between projects show up.
 * A vector equal to the mean becomes all zeros (cosine 0 with everything).
 */
export function centerAndNormalize(vectors) {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  if (!Number.isInteger(dim) || dim === 0) {
    throw new MatchingError('INVALID_EMBEDDING', 'Embeddings must be non-empty arrays');
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== dim || !v.every(Number.isFinite)) {
      throw new MatchingError('INVALID_EMBEDDING', `Every embedding must have ${dim} finite numbers`);
    }
  }
  const mean = new Array(dim).fill(0);
  for (const v of vectors) for (let k = 0; k < dim; k++) mean[k] += v[k];
  for (let k = 0; k < dim; k++) mean[k] /= vectors.length;

  return vectors.map((v) => {
    const c = v.map((x, k) => x - mean[k]);
    let norm = 0;
    for (const x of c) norm += x * x;
    norm = Math.sqrt(norm);
    return norm === 0 ? c.map(() => 0) : c.map((x) => x / norm);
  });
}

/** Cosine of two unit vectors, rounded to an integer in [-SCALE, SCALE]. */
export function cosineScaled(a, b) {
  let dot = 0;
  for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.round(clamped * SCALE);
}

/** Lower-cases, trims and removes duplicate tags. */
export function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new MatchingError('INVALID_TAGS', 'Tags must be an array of strings');
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].sort();
}

/** Shared tags divided by all tags, as an integer in [0, SCALE]. Two empty sets give 0: no evidence of overlap. */
export function jaccardScaled(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : Math.floor((shared * SCALE) / union);
}

export function assertValidWeights(weights) {
  const { embedding, tracks, tech } = weights;
  for (const [k, v] of Object.entries({ embedding, tracks, tech })) {
    if (!Number.isInteger(v) || v < 0) {
      throw new MatchingError('INVALID_WEIGHTS', `Similarity weight "${k}" must be a non-negative integer`);
    }
  }
  if (embedding + tracks + tech !== 100) {
    throw new MatchingError('INVALID_WEIGHTS', 'Similarity weights must sum to 100');
  }
}

/**
 * Builds the full pairwise similarity table.
 * Each entry keeps its parts so the UI can explain why two projects were paired.
 *
 * @param {Array<{ embedding: number[], tracks: string[], tech: string[] }>} projects
 * @returns {{ total: number[][], parts: Array<Array<{cosine:number, tracks:number, tech:number}>> }}
 */
export function similarityMatrix(projects, weights = DEFAULT_WEIGHTS) {
  assertValidWeights(weights);
  const unit = centerAndNormalize(projects.map((p) => p.embedding));
  const tracks = projects.map((p) => normalizeTags(p.tracks));
  const tech = projects.map((p) => normalizeTags(p.tech));
  const n = projects.length;
  const total = Array.from({ length: n }, () => new Array(n).fill(0));
  const parts = Array.from({ length: n }, () => new Array(n).fill(null));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = {
        cosine: cosineScaled(unit[i], unit[j]),
        tracks: jaccardScaled(tracks[i], tracks[j]),
        tech: jaccardScaled(tech[i], tech[j]),
      };
      const blended = Math.floor(
        (weights.embedding * p.cosine + weights.tracks * p.tracks + weights.tech * p.tech) / 100,
      );
      total[i][j] = total[j][i] = blended;
      parts[i][j] = parts[j][i] = Object.freeze(p);
    }
  }
  return { total, parts };
}
