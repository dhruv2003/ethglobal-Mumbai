/*
 * Projects shown on /projects: whatever teams submitted, from the backend's store.
 */
import { api } from "./api.js";
import { uploadUrl } from "./video.js";

function fromSubmission(r) {
  return {
    id: r.id,
    seed: r.fighterSeed ?? r.id,
    kind: "submitted",
    teamName: r.team?.name ?? "",
    name: r.project?.name ?? "Untitled",
    pitch: r.project?.pitch ?? "",
    description: r.project?.description ?? "",
    repoUrl: r.repoUrl ?? "",
    videoUrl: r.demoVideoUrl ?? "",
    // Our server's copy of the demo video: { saved, url, seconds, bytes, source } or { saved: false, reason }.
    savedVideo: r.video ?? null,
    // Screenshots instead of (or as well as) a video: playable URLs, in the team's order.
    demoImages: (r.demoImages ?? []).map(uploadUrl).filter(Boolean),
    liveUrl: r.liveUrl ?? null,
    tracks: r.tracks ?? [],
    pinnedCommit: null,
    event: null,
    showcaseUrl: null,
    ownerWallet: r.ownerWallet ?? null,
    submittedAt: r.submittedAt ?? null,
    review: r.review ?? null,
    dossier: null,
    liveTest: null,
    reviews: null,
  };
}

export async function listProjects() {
  const remote = await api("/submissions");
  return remote.map(fromSubmission).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

export async function getProject(id) {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

/** Embeddable player URL for Loom and YouTube links; null for anything else. */
export { embedUrl } from "./video.js";
