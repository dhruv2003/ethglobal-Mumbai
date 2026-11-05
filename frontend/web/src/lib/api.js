/*
 * Backend client. The web app talks to /api (proxied to the backend in dev and
 * preview: see vite.config.js). Every call fails soft: callers decide what to
 * show when the judge service is offline.
 */
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
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
