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
    // One wallet for now: it owns the submission and receives the project's 20%.
    ownerWallet,
    rewardWallet: ownerWallet,
    chainId,
  };
}

export function listSubmissions() {
  try {
    const all = JSON.parse(localStorage.getItem(SUBMISSIONS_SLOT) || "[]");
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/** TODO(backend): replace with POST /submissions. Must stay async. */
export async function saveSubmission(payload) {
  const record = {
    id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    submittedAt: new Date().toISOString(),
    ...payload,
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
