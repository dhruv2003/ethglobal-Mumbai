import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALE,
  centerAndNormalize,
  cosineScaled,
  jaccardScaled,
  normalizeTags,
  similarityMatrix,
} from '../src/index.js';
import { makeProjects } from './fixtures.js';

test('centering spreads embeddings that all point roughly the same way', () => {
  // Raw cosine of these is ~0.99; after centering they point in opposite directions.
  const [a, b] = centerAndNormalize([
    [1, 0.9],
    [0.9, 1],
  ]);
  assert.equal(cosineScaled(a, b), -SCALE);
});

test('identical embeddings after centering give cosine 0, not a crash', () => {
  const unit = centerAndNormalize([
    [1, 2],
    [1, 2],
  ]);
  assert.deepEqual(unit[0], [0, 0]);
  assert.equal(cosineScaled(unit[0], unit[1]), 0);
});

test('rejects embeddings of different lengths or with non-numbers', () => {
  assert.throws(() => centerAndNormalize([[1, 2], [1]]), { code: 'INVALID_EMBEDDING' });
  assert.throws(() => centerAndNormalize([[1, NaN], [1, 2]]), { code: 'INVALID_EMBEDDING' });
});

test('Jaccard on tags', () => {
  assert.equal(jaccardScaled(['a', 'b'], ['a', 'b']), SCALE);
  assert.equal(jaccardScaled(['a', 'b'], ['b', 'c']), Math.floor(SCALE / 3));
  assert.equal(jaccardScaled([], []), 0);
  assert.deepEqual(normalizeTags([' DeFi', 'defi', 'EVM ']), ['defi', 'evm']);
});

test('same-category projects are more similar than cross-category ones', () => {
  const projects = makeProjects(['defi', 'gaming'], 2);
  const { total } = similarityMatrix(projects);
  // 0,1 = defi; 2,3 = gaming
  assert.ok(total[0][1] > total[0][2]);
  assert.ok(total[2][3] > total[1][3]);
  for (const row of total) for (const v of row) assert.ok(Number.isInteger(v));
});

test('weights must be integers summing to 100', () => {
  const projects = makeProjects(['defi'], 2);
  assert.throws(() => similarityMatrix(projects, { embedding: 50, tracks: 20, tech: 20 }), {
    code: 'INVALID_WEIGHTS',
  });
  assert.throws(() => similarityMatrix(projects, { embedding: 60.5, tracks: 19.5, tech: 20 }), {
    code: 'INVALID_WEIGHTS',
  });
});
