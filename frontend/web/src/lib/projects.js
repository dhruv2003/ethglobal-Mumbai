/*
 * Projects shown on /projects. Sample projects come from backend/fixtures;
 * submitted ones come from saveSubmission()'s store.
 * TODO(backend): replace listProjects() with GET /projects. Keep it async.
 */
import goHealthMe from "@fixtures/go-health-me/submission.json";
import goHealthMeSource from "@fixtures/go-health-me/source.json";
import { listSubmissions } from "./storage.js";

function fromFixture(id, { form }, source) {
  return {
    id,
    kind: "sample",
    teamName: form.team.name,
    name: form.project.name,
    pitch: form.project.pitch,
    description: form.project.description,
    repoUrl: form.code.repoUrl,
    videoUrl: form.demo.videoUrl,
    tracks: form.tracks.selected,
    pinnedCommit: source?.repository?.pinnedCommit ?? null,
    event: source?.showcase?.event ?? null,
    showcaseUrl: source?.showcase?.url ?? null,
    ownerWallet: null,
    submittedAt: null,
  };
}

function fromSubmission(r) {
  return {
    id: r.id,
    kind: "submitted",
    teamName: r.team?.name ?? "",
    name: r.project?.name ?? "Untitled",
    pitch: r.project?.pitch ?? "",
    description: r.project?.description ?? "",
    repoUrl: r.repoUrl ?? "",
    videoUrl: r.demoVideoUrl ?? "",
    tracks: r.tracks ?? [],
    pinnedCommit: null,
    event: null,
    showcaseUrl: null,
    ownerWallet: r.ownerWallet ?? null,
    submittedAt: r.submittedAt ?? null,
  };
}

const SAMPLES = [fromFixture("go-health-me", goHealthMe, goHealthMeSource)];

export async function listProjects() {
  const submitted = listSubmissions()
    .map(fromSubmission)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return [...submitted, ...SAMPLES];
}

export async function getProject(id) {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

/** Embeddable player URL for Loom and YouTube links; null for anything else. */
export function embedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "loom.com") {
      const id = u.pathname.match(/\/(?:share|embed)\/([a-f0-9]+)/)?.[1];
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v") ?? u.pathname.match(/\/(?:embed|shorts)\/([^/]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}
