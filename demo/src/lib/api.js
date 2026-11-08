/*
 * DEMO BUILD: there is no backend. Every /api call is answered by lib/demo/server.js from
 * src/data/*.json; file URLs map to public/media. The rest of this file is unchanged.
 *
 * Backend client. The web app talks to /api on the backend: VITE_API_URL when the
 * backend runs on its own host (production: .env.production), otherwise the same
 * origin (proxied to the backend in dev and preview: see vite.config.js). Every
 * call fails soft: callers decide what to show when the judge service is offline.
 */
import { dropPrivate, peek, put } from "./cache.js";
import { demoFileUrl, serve } from "./demo/server.js";

/** The backend's origin, e.g. https://eth-mum.onrender.com; "" means this site's own origin. */
export const API_ORIGIN = "";
/**
 * Where a backend URL really points. Takes "/api/..." paths (ours, and the ones the
 * backend returns for videos, uploads and files) and leaves anything else alone.
 */
export const apiUrl = (url) => (typeof url === "string" && /^\/api(\/|$|\?)/.test(url) ? demoFileUrl(url) : url);

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
  try {
    return await serve(path, method, body);
  } catch (e) {
    throw Object.assign(new Error(e.message), { status: e.status ?? 500, data: null });
  }
}

/** null when the backend is offline. */
export const health = () => api("/health").catch(() => null);

/** POST a file or recording: the demo keeps nothing, so it just answers. */
export async function upload(path) {
  return serve(path, "POST");
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
  // Demo: no server to upload to. Show the progress, keep the file in this tab.
  let timer;
  const done = new Promise((resolve) => {
    let p = 0;
    timer = setInterval(() => {
      p = Math.min(1, p + 0.2);
      onProgress?.(p);
      if (p >= 1) {
        clearInterval(timer);
        const url = URL.createObjectURL(file);
        resolve({ ref: `upload:${file.name}`, url, bytes: file.size, seconds: null });
      }
    }, 180);
  });
  return { done, abort: () => clearInterval(timer) };
}

export const uploadVideo = (file, onProgress) =>
  uploadFile("/uploads/video", file, /^video\/(mp4|webm|quicktime)$/.test(file.type) ? file.type : "application/octet-stream", onProgress);

export const uploadImage = (file, onProgress) =>
  uploadFile("/uploads/image", file, /^image\/(png|jpeg|webp)$/.test(file.type) ? file.type : "application/octet-stream", onProgress);
