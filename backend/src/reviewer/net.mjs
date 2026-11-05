/*
 * Fetching URLs that came from a submission, safely (no SSRF):
 * https only, every hop's host must resolve to a public address, at most
 * 3 redirects (each re-checked), and a byte cap on the body.
 */
import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

export async function assertPublicHttps(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (u.protocol !== "https:") throw new Error("Only https links can be fetched.");
  if (u.username || u.password) throw new Error("Links with credentials aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Can't resolve ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("That link points at a private network address.");
  return u;
}

/** GET with public-address checks on every hop. Returns the final Response (body unread). */
export async function safeFetch(raw, { headers = {}, timeoutMs = 60000 } = {}) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicHttps(url);
    const res = await fetch(u, { redirect: "manual", headers: { "user-agent": "BattleArenaReviewer/1.0", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location"), u).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

/** Read a body up to maxBytes; throws if larger. */
export async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new Error(`Too large (${Math.round(len / 1048576)} MB).`);
  const chunks = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > maxBytes) throw new Error(`Too large (over ${Math.round(maxBytes / 1048576)} MB).`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
