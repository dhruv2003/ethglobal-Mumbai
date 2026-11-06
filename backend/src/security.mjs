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
    // Fail closed. Local development must opt in explicitly, and a request that
    // came through a proxy (our own Vite proxy included) never counts as local.
    const proxied = Boolean(req.get("x-forwarded-for") || req.get("x-forwarded-host") || req.get("forwarded"));
    if (process.env.ALLOW_LOCAL_ORGANIZER === "1" && !proxied && LOOPBACK.has(req.socket.remoteAddress ?? "")) return next();
    return res.status(403).json({ error: "Organizer actions need ADMIN_TOKEN on the server (or ALLOW_LOCAL_ORGANIZER=1 for local development)." });
  }
  const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Organizer key required." });
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
