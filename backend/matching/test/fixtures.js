// Synthetic projects only (no real submissions). Each category has a base direction;
// projects get small, fixed offsets so they are close to their own category and far from others.

const DIM = 8;
const CATEGORIES = {
  defi: { axis: 0, tracks: ['defi'], tech: ['solidity', 'evm'] },
  gaming: { axis: 2, tracks: ['gaming'], tech: ['unity', 'evm'] },
  identity: { axis: 4, tracks: ['identity', 'privacy'], tech: ['zk', 'circom'] },
  infra: { axis: 6, tracks: ['infra'], tech: ['rust', 'node'] },
};

export function embeddingFor(category, k) {
  const v = new Array(DIM).fill(0.1);
  v[CATEGORIES[category].axis] = 1;
  v[(CATEGORIES[category].axis + 1) % DIM] = 0.05 * (k + 1);
  return v;
}

/** `perCategory` projects in each of the listed categories, each from its own team. */
export function makeProjects(categories, perCategory) {
  const out = [];
  for (const c of categories) {
    for (let k = 0; k < perCategory; k++) {
      out.push({
        id: `${c}-${k}`,
        teamId: `team-${c}-${k}`,
        embedding: embeddingFor(c, k),
        tracks: CATEGORIES[c].tracks,
        tech: CATEGORIES[c].tech,
      });
    }
  }
  return out;
}

export const categoryOf = (id) => id.split('-')[0];
