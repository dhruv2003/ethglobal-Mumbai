import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so the same data always gives the same text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Order key derived from the published seed. Sorting by this key gives a fixed,
 * reproducible order that the organizer cannot hand-pick once the seed is published.
 */
export function seededKey(seed, id) {
  return sha256Hex(`${seed}:${id}`);
}
