/*
 * Backend client. The web app talks to /api (proxied to the backend in dev and
 * preview: see vite.config.js). Every call fails soft: callers decide what to
 * show when the judge service is offline.
 */
const KEY_SLOT = "arena.organizerKey";
/** Organizer key for judge/review actions. Kept for this browser tab only. */
export const organizerKey = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY_SLOT) ?? "";
    } catch {
      return "";
    }
  },
  set: (v) => {
    try {
      v ? sessionStorage.setItem(KEY_SLOT, v) : sessionStorage.removeItem(KEY_SLOT);
    } catch {
      /* storage blocked: the key just won't persist */
    }
  },
};

export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  const key = method !== "GET" ? organizerKey.get() : "";
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {
    /* not JSON: the backend isn't there (the static server answered) */
  }
  if (!res.ok || (data === null && res.status !== 204)) {
    throw Object.assign(new Error(data?.error ?? `The judge service didn't answer (HTTP ${res.status}).`), { status: res.status, data });
  }
  return data;
}

/** null when the backend is offline. */
export const health = () => api("/health").catch(() => null);

/** POST a file or recording as the raw request body (organizer key attached). */
export async function upload(path, blob) {
  const headers = { "content-type": blob.type || "application/octet-stream" };
  const key = organizerKey.get();
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`/api${path}`, { method: "POST", headers, body: blob });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON: the backend isn't there */
  }
  if (!res.ok || data === null) {
    throw Object.assign(new Error(data?.error ?? `The judge service didn't answer (HTTP ${res.status}).`), { status: res.status, data });
  }
  return data;
}
