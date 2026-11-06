/*
 * Backend client. The web app talks to /api (proxied to the backend in dev and
 * preview: see vite.config.js). Every call fails soft: callers decide what to
 * show when the judge service is offline.
 */
import { dropPrivate, peek, put } from "./cache.js";

let organizerSession = null;
/** Set by lib/organizer.js. Every request then proves this wallet is an organizer. */
export const setOrganizerSession = (session) => {
  if (session?.signature !== organizerSession?.signature) dropPrivate();
  organizerSession = session;
};

/** Organizer-only reads: cached in memory for this tab, never written to localStorage. */
const PRIVATE = /^\/(judges|projects\/[^/]+\/(pipeline|dossier|arkiv|live|reviews))(\/|\?|$)/;
const inflight = new Map(); // GET path -> Promise, so parallel callers share one request

/** The last answer the backend gave for GET `path` (undefined if none yet). */
export const peekApi = (path) => peek(`api:${path}`);
const organizerHeaders = () => (organizerSession ? { "x-organizer": btoa(JSON.stringify(organizerSession)) } : {});

export function api(path, { method = "GET", body } = {}) {
  if (method !== "GET") return request(path, method, body);
  const pending = inflight.get(path);
  if (pending) return pending;
  const p = request(path, method, body)
    .then((data) => {
      put(`api:${path}`, data, { private: PRIVATE.test(path) });
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function request(path, method, body) {
  const headers = organizerHeaders();
  if (body) headers["content-type"] = "application/json";
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
  const headers = { "content-type": blob.type || "application/octet-stream", ...organizerHeaders() };
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

export const VIDEO_MAX_MB = 300;

export const IMAGE_MAX_MB = 10;
export const MAX_IMAGES = 8;

/**
 * Upload a demo file (video or screenshot) as the raw body. XHR (not fetch) so
 * we can show progress. onProgress(0..1). Returns { done: Promise<{ ref, url, bytes, seconds? }>, abort }.
 * No organizer key: teams upload, not organizers.
 */
function uploadFile(path, file, contentType, onProgress) {
  const xhr = new XMLHttpRequest();
  const done = new Promise((resolve, reject) => {
    xhr.open("POST", `/api${path}`);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.ref) resolve(data);
      else reject(new Error(data?.error ?? (xhr.status === 413 ? "That file is too large." : "The upload failed. Try again.")));
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the server. Check your connection and try again."));
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { aborted: true }));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}

export const uploadVideo = (file, onProgress) =>
  uploadFile("/uploads/video", file, /^video\/(mp4|webm|quicktime)$/.test(file.type) ? file.type : "application/octet-stream", onProgress);

export const uploadImage = (file, onProgress) =>
  uploadFile("/uploads/image", file, /^image\/(png|jpeg|webp)$/.test(file.type) ? file.type : "application/octet-stream", onProgress);
