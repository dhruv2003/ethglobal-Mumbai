/*
 * Projects shown on /projects: whatever teams submitted, from the backend's store.
 */
import { api } from "./api.js";
import { peek, put } from "./cache.js";
import { listEvents } from "./events.js";
import { uploadUrl } from "./video.js";
import { cleanName } from "./names.js";

export { cleanName };

function fromSubmission(r) {
  return {
    id: r.id,
    seed: r.fighterSeed ?? r.id,
    kind: "submitted",
    teamName: r.team?.name ?? "",
    name: cleanName(r.project?.name),
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
    eventId: r.eventId ?? null,
    event: null,
    showcaseUrl: null,
    ownerWallet: r.ownerWallet ?? null,
    submittedAt: r.submittedAt ?? null,
    review: r.review ?? null,
    dossier: null,
    hasDossier: Boolean(r.hasDossier),
    liveTest: null,
    reviews: null,
  };
}

export async function listProjects() {
  const [remote, events] = await Promise.all([api("/submissions"), listEvents().catch(() => [])]);
  const nameOf = new Map(events.map((e) => [e.id, e.name]));
  const list = remote.map((r) => ({ ...fromSubmission(r), event: nameOf.get(r.eventId) ?? null })).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  put("projects", list); // any fresh read (one project's page too) refreshes the cached list
  return list;
}

/** Take a deleted project out of the cached list, so it doesn't flash back before the next read. */
export function forgetProject(id) {
  const list = peek("projects");
  if (list) put("projects", list.filter((p) => p.id !== id));
}

export async function getProject(id) {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

/** Embeddable player URL for Loom and YouTube links; null for anything else. */
export { embedUrl } from "./video.js";
