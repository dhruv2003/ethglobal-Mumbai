/*
 * Who may do what on the API.
 *
 * - Organizer routes (judge personas, running the panel by hand) need
 *   ADMIN_TOKEN when it is set. When it is not set they only answer requests
 *   from this machine, so local dev works and a deployment is closed by default.
 * - Submissions must carry a wallet signature that recovers to the owner
 *   wallet and names this project and repo (PRD SUB-04), and are rate limited,
 *   because each one starts paid judge runs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { createPublicClient, http, verifyMessage } from "viem";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The message an organizer signs once per session (no gas). */
export const organizerMessage = (wallet, issuedAt) => ["Sign in as a Battle Arena organizer", `Wallet: ${wallet}`, `Issued at: ${issuedAt}`].join("\n");
const SESSION_MS = 12 * 60 * 60 * 1000;
const ROLE_CACHE_MS = 30 * 1000;
const roleCache = new Map(); // wallet -> { until, ok }
let client = null;

/** ADMIN_WALLET in backend/.env (comma-separated for several). Lowercase. */
const adminWallets = () => (process.env.ADMIN_WALLET ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);

/** When ADMIN_WALLET is set, it alone decides who runs the app. Otherwise the contract's organizer role does. */
export async function isOrganizerWallet(wallet) {
  const admins = adminWallets();
  if (admins.length) return admins.includes(String(wallet).toLowerCase());
  return hasOrganizerRole(wallet);
}

async function hasOrganizerRole(wallet) {
  const key = wallet.toLowerCase();
  const hit = roleCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  const address = process.env.TOURNAMENT_MANAGER_ADDRESS;
  if (!address || !process.env.RPC_URL) return false;
  client ??= createPublicClient({ transport: http(process.env.RPC_URL) });
  const abi = JSON.parse(fs.readFileSync(new URL("../contracts/abi/TournamentManager.json", import.meta.url), "utf8"));
  const contract = { address, abi: abi.abi ?? abi };
  const role = await client.readContract({ ...contract, functionName: "ORGANIZER_ROLE" });
  const ok = await client.readContract({ ...contract, functionName: "hasRole", args: [role, wallet] });
  roleCache.set(key, { until: Date.now() + ROLE_CACHE_MS, ok });
  return ok;
}

/** The organizer wallet behind this request's signed session, or null. */
export async function organizerWallet(req) {
  const raw = req.get?.("x-organizer");
  if (!raw) return null;
  try {
    const { wallet, issuedAt, signature } = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    const issued = Date.parse(issuedAt);
    if (!Number.isFinite(issued) || issued > Date.now() + 60000 || Date.now() - issued > SESSION_MS) return null;
    if (!(await verifyMessage({ address: wallet, message: organizerMessage(wallet, issuedAt), signature }))) return null;
    return (await isOrganizerWallet(wallet)) ? wallet : null;
  } catch {
    return null;
  }
}

/** Does the request's bearer token equal ADMIN_TOKEN? (constant time; false when it isn't set) */
const tokenMatches = (req) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const a = Buffer.from((req.get?.("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** For pages that show more to organizers. */
export const isOrganizer = async (req) => tokenMatches(req) || Boolean(await organizerWallet(req));

export function requireOrganizer(req, res, next) {
  if (req.get?.("x-organizer")) {
    return organizerWallet(req).then((wallet) => {
      if (!wallet) return res.status(403).json({ error: "Only a wallet with the organizer role can do this. Sign in again." });
      req.organizerWallet = wallet;
      next();
    });
  }
  if (!process.env.ADMIN_TOKEN) {
    // Fail closed. Local development must opt in explicitly, and a request that
    // came through a proxy (our own Vite proxy included) never counts as local.
    const proxied = Boolean(req.get("x-forwarded-for") || req.get("x-forwarded-host") || req.get("forwarded"));
    if (process.env.ALLOW_LOCAL_ORGANIZER === "1" && !proxied && LOOPBACK.has(req.socket.remoteAddress ?? "")) return next();
    return res.status(403).json({ error: "Organizer actions need ADMIN_TOKEN on the server (or ALLOW_LOCAL_ORGANIZER=1 for local development)." });
  }
  if (!tokenMatches(req)) return res.status(401).json({ error: "Organizer key required." });
  next();
}

/** Simple per-IP fixed window. In memory: fine for one server process. */
export function rateLimit({ max, windowMs, message = "Too many submissions from here. Try again later." }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "?";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) hits.set(key, { start: now, n: 1 });
    else if (++h.n > max) return res.status(429).json({ error: message });
    next();
  };
}

/**
 * The exact fields a submission's signature covers. The web app hashes the same
 * canonical JSON (frontend/web/src/lib/storage.js -> submissionDigest).
 */
export function canonicalSubmission(body) {
  return JSON.stringify({
    team: { name: body.team?.name ?? "" },
    project: { name: body.project?.name ?? "", pitch: body.project?.pitch ?? "", description: body.project?.description ?? "" },
    repoUrl: body.repoUrl ?? "",
    demoVideoUrl: body.demoVideoUrl ?? "",
    demoImages: Array.isArray(body.demoImages) ? body.demoImages : [],
    liveUrl: body.liveUrl ?? null,
    tracks: body.tracks ?? [],
    ownerWallet: String(body.ownerWallet ?? "").toLowerCase(),
    fighterSeed: body.fighterSeed ?? null,
    eventId: body.eventId ?? null,
  });
}
export const submissionDigest = (body) => crypto.createHash("sha256").update(canonicalSubmission(body)).digest("hex");

const usedSignatures = new Set(); // single use; in memory, and also checked against stored submissions by the caller

/** Check the submission's wallet signature. Returns an error string, or null when valid. */
export async function checkSubmissionSignature(body, { seen = () => false } = {}) {
  const { auth, ownerWallet, project, repoUrl } = body ?? {};
  if (!auth?.message || !auth?.signature) return "Missing wallet signature.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(ownerWallet ?? "")) return "Owner wallet is not an address.";
  const m = auth.message;
  if (!m.includes(`"${project?.name}"`) || !m.includes(`Repository: ${repoUrl}`) || !m.toLowerCase().includes(`owner: ${ownerWallet.toLowerCase()}`)) {
    return "The signed message doesn't match this submission.";
  }
  // Everything the team entered is bound by a hash inside the signed text.
  const digest = /^Submission: ([0-9a-f]{64})$/m.exec(m)?.[1];
  if (!digest || digest !== submissionDigest(body)) return "The signed message doesn't match this submission.";
  // The time comes from the signed text, never from an unsigned field.
  const issued = Date.parse(/^Issued at: (.+)$/m.exec(m)?.[1] ?? "");
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 15 * 60 * 1000) return "The signature is too old. Sign again.";
  const sigKey = String(auth.signature).toLowerCase();
  if (usedSignatures.has(sigKey) || seen(sigKey)) return "This signature was already used. Sign again.";
  try {
    const ok = await verifyMessage({ address: ownerWallet, message: m, signature: auth.signature });
    if (!ok) return "The signature wasn't made by the owner wallet.";
  } catch {
    return "The signature couldn't be checked.";
  }
  usedSignatures.add(sigKey);
  return null;
}
