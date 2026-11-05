/*
 * Persistence. Drafts are a per-browser convenience (localStorage).
 * saveSubmission() is the single seam for the database: swap its body for an
 * API call when the backend exists. Nothing else in the app needs to change.
 */

const DRAFT_SLOT = "arena.submission.draft.v2";
const SUBMISSIONS_SLOT = "arena.submissions.v1";

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
    demoVideoUrl: data.demo.videoUrl.trim(),
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
    tracks: p.tracks ?? [],
    ownerWallet: String(p.ownerWallet ?? "").toLowerCase(),
    fighterSeed: p.fighterSeed ?? null,
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function listSubmissions() {
  try {
    const all = JSON.parse(localStorage.getItem(SUBMISSIONS_SLOT) || "[]");
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/**
 * Save to the backend (POST /api/submissions), which also starts the judges'
 * review. If the backend is offline, keep it in this browser instead.
 */
export async function saveSubmission(payload) {
  let record;
  let res;
  try {
    res = await fetch("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    /* backend unreachable: fall through to local */
  }
  if (res?.ok) record = await res.json().catch(() => undefined);
  else if (res && res.status >= 400 && res.status < 500 && res.headers.get("content-type")?.includes("json")) {
    // The backend answered and said no (bad signature, rate limit...). Don't hide that behind a local save.
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error ?? `The server refused the submission (HTTP ${res.status}).`), { fromServer: true });
  }
  record ??= {
    id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    submittedAt: new Date().toISOString(),
    ...payload,
    savedLocallyOnly: true,
  };
  try {
    const all = JSON.parse(localStorage.getItem(SUBMISSIONS_SLOT) || "[]");
    all.push(record);
    localStorage.setItem(SUBMISSIONS_SLOT, JSON.stringify(all));
  } catch {
    /* storage unavailable: the caller still gets the record to download */
  }
  return record;
}
