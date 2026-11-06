/*
 * Stale-while-revalidate cache for API and chain reads. Pages render the last
 * answer straight away and swap in the fresh one when it lands.
 *
 * Memory only (this tab): nothing is written to the browser's storage, so a
 * reload always reads fresh from the server (Arkiv / 0G) and the chain. Private
 * answers (organizer-only reads) are dropped when the organizer session changes.
 */

const mem = new Map(); // key -> { data, at, private }

/** The last answer for `key` in this tab, or undefined. */
export function peek(key) {
  if (key == null) return undefined;
  return mem.get(key)?.data;
}

/** Remember `data` as the latest answer for `key`. */
export function put(key, data, { private: isPrivate = false } = {}) {
  if (key == null || data === undefined) return;
  mem.set(key, { data, at: Date.now(), private: isPrivate });
}

/** Forget one key (after a write that makes it wrong). */
export function drop(key) {
  mem.delete(key);
}

/** Forget every private (organizer-only) answer, e.g. when the organizer session changes. */
export function dropPrivate() {
  for (const [k, v] of mem) if (v.private) mem.delete(k);
}

/** Forget every key that starts with `prefix`. */
export function dropPrefix(prefix) {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
}

const replacer = (_k, v) => (typeof v === "bigint" ? { __big: v.toString() } : v);

/** True when two answers hold the same data (so a re-render, or a graph re-layout, can be skipped). */
export function sameData(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a, replacer) === JSON.stringify(b, replacer);
  } catch {
    return false;
  }
}
