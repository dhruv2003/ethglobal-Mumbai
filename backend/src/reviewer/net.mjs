/*
 * Fetching URLs that came from a submission, safely (no SSRF):
 *  - https only, no credentials in the URL
 *  - addresses classified with net.BlockList (real CIDR ranges); every
 *    IPv4-mapped/translated IPv6 form is blocked outright
 *  - the check runs inside the socket's own DNS lookup, so the address we
 *    checked is the address we connect to (no DNS-rebinding window)
 *  - at most 3 redirects, each going through the same checks; byte caps
 */
import dns from "node:dns";
import https from "node:https";
import net from "node:net";

const blocked4 = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked4.addSubnet(a, p, "ipv4");
// IPv6 only. IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) are handled by unwrapping the
// embedded IPv4 below: a BlockList rule for ::ffff:0:0/96 would also match every plain IPv4 address.
const blocked6 = new net.BlockList();
for (const [a, p] of [
  ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blocked6.addSubnet(a, p, "ipv6");

/** IPv6 text -> 8 numbers, handling "::" and a dotted IPv4 tail. */
function hextets(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    s = s.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.includes("::") ? s.split("::") : [s, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === null ? [] : Array(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((x) => parseInt(x || "0", 16));
}

export function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return true; // not an address: refuse
  if (family === 4) return blocked4.check(ip, "ipv4");
  const h = hextets(ip);
  const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (NAT64): judge the IPv4 inside.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return blocked4.check(v4(h[6], h[7]), "ipv4");
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return blocked4.check(v4(h[6], h[7]), "ipv4");
  return blocked6.check(ip, "ipv6");
}

/** DNS lookup for sockets that refuses private answers, at connect time. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return callback(err);
    const bad = addrs.find((a) => isPrivateAddress(a.address));
    if (bad || !addrs.length) return callback(Object.assign(new Error("That link points at a private network address."), { code: "EPRIVATE" }));
    // IPv4 first: many hosts publish AAAA records that the network can't reach, and
    // connecting to those just hangs. Every address was checked above either way.
    addrs.sort((a, b) => a.family - b.family);
    if (options?.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

export function checkUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (u.protocol !== "https:") throw new Error("Only https links can be fetched.");
  if (u.username || u.password) throw new Error("Links with credentials aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error("That link points at a private network address.");
  return u;
}

// Reused connections: an HLS download is hundreds of small requests to one host.
// The guarded lookup still runs for every new socket.
// Node tries each address for only 250 ms by default (happy eyeballs); far-away
// hosts take longer than that to connect, so every attempt "times out".
const CONNECT = { autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 2000 };
const agent = new https.Agent({ keepAlive: true, maxSockets: 16, lookup: guardedLookup, ...CONNECT });

function get(u, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(u, { method: "GET", headers: { "user-agent": "BattleArenaReviewer/1.0", ...headers }, agent, lookup: guardedLookup, ...CONNECT, timeout: timeoutMs }, (res) => resolve(res));
    req.on("timeout", () => req.destroy(new Error("The link took too long to answer.")));
    req.on("error", reject);
    req.end();
  });
}

/** GET with public-address checks on every hop. Returns a small fetch-like response. */
export async function safeFetch(raw, { headers = {}, timeoutMs = 60000 } = {}) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = checkUrl(url);
    const res = await get(u, headers, timeoutMs);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, u).href;
      continue;
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => res.headers[k.toLowerCase()] ?? null },
      body: res,
    };
  }
  throw new Error("Too many redirects.");
}

/** Read a body up to maxBytes; throws if larger. */
export async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) {
    res.body.destroy?.();
    throw new Error(`Too large (${Math.round(len / 1048576)} MB).`);
  }
  const chunks = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > maxBytes) {
      res.body.destroy?.();
      throw new Error(`Too large (over ${Math.round(maxBytes / 1048576)} MB).`);
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
