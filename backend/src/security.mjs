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
import { verifyMessage } from "viem";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function requireOrganizer(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    if (LOOPBACK.has(req.socket.remoteAddress ?? "")) return next();
    return res.status(403).json({ error: "Organizer actions are only allowed from this machine until ADMIN_TOKEN is set." });
  }
  const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Organizer key required." });
  next();
}

/** Simple per-IP fixed window. In memory: fine for one server process. */
export function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? "?";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) hits.set(key, { start: now, n: 1 });
    else if (++h.n > max) return res.status(429).json({ error: "Too many submissions from here. Try again later." });
    next();
  };
}

/** Check the submission's wallet signature. Returns an error string, or null when valid. */
export async function checkSubmissionSignature(body) {
  const { auth, ownerWallet, project, repoUrl } = body ?? {};
  if (!auth?.message || !auth?.signature) return "Missing wallet signature.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(ownerWallet ?? "")) return "Owner wallet is not an address.";
  const m = auth.message;
  if (!m.includes(`"${project?.name}"`) || !m.includes(`Repository: ${repoUrl}`) || !m.toLowerCase().includes(`owner: ${ownerWallet.toLowerCase()}`)) {
    return "The signed message doesn't match this submission.";
  }
  const issued = Date.parse(auth.issuedAt ?? "");
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 15 * 60 * 1000) return "The signature is too old. Sign again.";
  try {
    const ok = await verifyMessage({ address: ownerWallet, message: m, signature: auth.signature });
    return ok ? null : "The signature wasn't made by the owner wallet.";
  } catch {
    return "The signature couldn't be checked.";
  }
}

