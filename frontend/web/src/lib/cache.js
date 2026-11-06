/*
 * Stale-while-revalidate cache for API and chain reads. Pages render the last
 * answer straight away and swap in the fresh one when it lands.
 *
 * Two layers: memory (this tab) and localStorage (survives reloads). Private
 * answers (organizer-only reads) stay in memory and never touch storage.
 * BigInts (chain reads) survive the round trip through JSON.
 */

const PREFIX = "arena.cache.v1:";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // older entries are ignored, not shown
const MAX_ENTRY_CHARS = 400_000; // bigger answers stay in memory only

const mem = new Map(); // key -> { data, at, private }

const replacer = (_k, v) => (typeof v === "bigint" ? { __big: v.toString() } : v);
const reviver = (_k, v) => (v && typeof v === "object" && typeof v.__big === "string" && Object.keys(v).length === 1 ? BigInt(v.__big) : v);

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Drop every persisted entry (quota trouble, or a sign-out). */
function clearPersisted() {
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) s.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

/** The last stored answer for `key`, or undefined. */
export function peek(key) {
  if (key == null) return undefined;
  const hit = mem.get(key);
  if (hit) return hit.data;
  const s = storage();
  if (!s) return undefined;
  try {
    const raw = s.getItem(PREFIX + key);
    if (!raw) return undefined;
    const { at, data } = JSON.parse(raw, reviver);
    if (!at || Date.now() - at > MAX_AGE_MS) {
      s.removeItem(PREFIX + key);
      return undefined;
    }
    mem.set(key, { data, at, private: false });
    return data;
  } catch {
    return undefined;
  }
}

/** Remember `data` as the latest answer for `key`. */
export function put(key, data, { private: isPrivate = false } = {}) {
  if (key == null || data === undefined) return;
  const at = Date.now();
  mem.set(key, { data, at, private: isPrivate });
  const s = storage();
  if (!s) return;
  if (isPrivate) {
    try {
      s.removeItem(PREFIX + key);
    } catch {
      /* storage unavailable */
    }
    return;
  }
  let raw;
  try {
    raw = JSON.stringify({ at, data }, replacer);
  } catch {
    return; // not serialisable: memory only
  }
  if (raw.length > MAX_ENTRY_CHARS) return;
  try {
    s.setItem(PREFIX + key, raw);
  } catch {
    // Quota: make room once, then give up quietly.
    clearPersisted();
    try {
      s.setItem(PREFIX + key, raw);
    } catch {
      /* memory only */
    }
  }
}

/** Forget one key (after a write that makes it wrong). */
export function drop(key) {
  mem.delete(key);
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

/** Forget every private (organizer-only) answer, e.g. when the organizer session changes. */
export function dropPrivate() {
  for (const [k, v] of mem) if (v.private) mem.delete(k);
}

/** Forget every key that starts with `prefix`. */
export function dropPrefix(prefix) {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX + prefix)) s.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

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
