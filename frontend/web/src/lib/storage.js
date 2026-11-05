/*
 * Persistence. Drafts are a per-browser convenience (localStorage).
 * saveSubmission() is the single seam for the database: swap its body for an
 * API call when the backend exists. Nothing else in the app needs to change.
 */

const DRAFT_SLOT = "arena.submission.draft.v1";
const SUBMISSIONS_SLOT = "arena.submissions.v1";

/** Files can't go into localStorage, so drafts keep everything except them. */
function withoutFiles(data) {
  return {
    ...data,
    project: { ...data.project, logo: null, cover: null },
    demo: { ...data.demo, videoFile: null, artifacts: [] },
  };
}

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
    localStorage.setItem(DRAFT_SLOT, JSON.stringify(withoutFiles(data)));
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

/** Strip browser-only fields (object URLs) from file metadata. */
const cleanFile = (f) => (f ? { id: f.id, name: f.name, size: f.size, type: f.type, kind: f.kind, duration: f.duration } : null);

export function toPayload(data, { ownerWallet, chainId }) {
  return {
    team: {
      name: data.team.name.trim(),
      members: data.team.members.map(({ name, github, role }) => ({
        name: name.trim(),
        github: github.trim().replace(/^@/, ""),
        role: role.trim(),
      })),
      ownerWallet,
      rewardWallet: data.team.rewardDifferent ? data.team.rewardWallet.trim() : ownerWallet,
    },
    project: {
      ...data.project,
      logo: cleanFile(data.project.logo),
      cover: cleanFile(data.project.cover),
    },
    tracks: data.tracks.selected.map((id) => ({ id, howUsed: (data.tracks.justification[id] ?? "").trim() })),
    code: {
      repoUrl: data.code.repoUrl.trim().replace(/\/$/, ""),
      ref: data.code.ref.trim() || null,
      monorepoPath: data.code.monorepoPath.trim() || null,
      contracts: data.code.contracts.map(({ address, network }) => ({ address: address.trim(), network })),
    },
    demo: {
      videoUrl: data.demo.videoUrl.trim() || null,
      videoFile: cleanFile(data.demo.videoFile),
      liveUrl: data.demo.liveUrl.trim() || null,
      artifacts: data.demo.artifacts.map(cleanFile),
    },
    publicUseConsent: data.consent,
    chainId,
  };
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
