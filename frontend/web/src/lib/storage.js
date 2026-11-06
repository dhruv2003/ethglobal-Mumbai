/*
 * Drafts are a per-browser convenience (localStorage). Submissions only ever live on the backend.
 */

const DRAFT_SLOT = "arena.submission.draft.v2";

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_SLOT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_SLOT, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_SLOT);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

export function toPayload(data, { ownerWallet, chainId }) {
  return {
    team: { name: data.team.name.trim() },
    project: {
      name: data.project.name.trim(),
      pitch: data.project.pitch.trim(),
      description: data.project.description.trim(),
    },
    repoUrl: data.code.repoUrl.trim().replace(/\/$/, ""),
    // An uploaded file is sent as its server ref ("upload:<sha256>.<ext>"), so the signature covers it.
    demoVideoUrl:
      data.demo.source === "images" ? "" : data.demo.source === "upload" && data.demo.upload?.ref ? data.demo.upload.ref : data.demo.videoUrl.trim(),
    // Screenshots instead of a video: server refs ("upload:<sha256>.png"), covered by the signature.
    demoImages: data.demo.source === "images" ? (data.demo.images ?? []).map((i) => i.ref).filter(Boolean) : [],
    liveUrl: (data.demo.liveUrl ?? "").trim() || null,
    tracks: [...data.tracks.selected],
    fighterSeed: data.fighter?.seed ?? null,
    // One wallet for now: it owns the submission and receives the project's 20%.
    ownerWallet,
    rewardWallet: ownerWallet,
    chainId,
  };
}

/**
 * SHA-256 of exactly the fields the backend checks (backend/src/security.mjs ->
 * canonicalSubmission). Goes into the signed message, so nothing the team
 * entered can be changed after signing. Key order matters: keep both in sync.
 */
export async function submissionDigest(p) {
  const canonical = JSON.stringify({
    team: { name: p.team?.name ?? "" },
    project: { name: p.project?.name ?? "", pitch: p.project?.pitch ?? "", description: p.project?.description ?? "" },
    repoUrl: p.repoUrl ?? "",
    demoVideoUrl: p.demoVideoUrl ?? "",
    demoImages: Array.isArray(p.demoImages) ? p.demoImages : [],
    liveUrl: p.liveUrl ?? null,
    tracks: p.tracks ?? [],
    ownerWallet: String(p.ownerWallet ?? "").toLowerCase(),
    fighterSeed: p.fighterSeed ?? null,
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Save to the backend (POST /api/submissions), which also starts the review. */
export async function saveSubmission(payload) {
  let res;
  try {
    res = await fetch("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    throw Object.assign(new Error("Couldn't reach the server, so nothing was submitted. Your draft is safe. Try again."), { fromServer: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The server refused the submission (HTTP ${res.status}).`), { fromServer: true });
  return data;
}
