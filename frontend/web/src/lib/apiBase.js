/**
 * Where the backend lives. Unset (default): same origin, so /api goes through the Vite
 * proxy in dev or is served by the backend itself in production. Set VITE_API_URL
 * (e.g. https://eth-mum.onrender.com) to talk to a separately hosted backend; that
 * backend's CORS_ORIGIN must then list this app's origin.
 */
export const API = `${(import.meta.env?.VITE_API_URL ?? "").replace(/\/+$/, "")}/api`;
