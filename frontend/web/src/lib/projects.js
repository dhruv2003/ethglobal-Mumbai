/*
 * Projects shown on /projects. Sample projects come from backend/fixtures;
 * submitted ones come from saveSubmission()'s store.
 * TODO(backend): replace listProjects() with GET /projects. Keep it async.
 */
import goHealthMe from "@fixtures/go-health-me/submission.json";
import goHealthMeSource from "@fixtures/go-health-me/source.json";
import { api } from "./api.js";
import { listSubmissions } from "./storage.js";

/*
 * Project record (what the DB will store per project):
 *   identity + submission fields (name, team, pitch, description, repo, video, tracks, wallet)
 *   dossier: the reviewer agent's FULL output (summary, verdict, every claim with
 *            file:line refs, tests, continuity, architecture, dependencies, journey,
 *            strengths, risks, questions) plus `highlights`, the short version the
 *            dashboard shows. Only highlights are rendered today; the rest is kept
 *            for fight generation and judge prompts later.
 *   liveTest: smoke-test results on real cloud browsers (laptop + phone) with
 *            recordings, from backend/tester/smoke.mjs.
 */
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
    seed: r.fighterSeed ?? r.id,
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
    review: r.review ?? null,
    dossier: null,
    liveTest: null,
    reviews: null,
  };
}

/* Reviewer dossiers, keyed by fixture folder name (= project id). Optional per project.
   TODO(backend): becomes part of GET /projects/:id once the reviewer agent runs server-side. */
const DOSSIERS = Object.fromEntries(
  Object.entries(import.meta.glob("@fixtures/*/dossier.json", { eager: true, import: "default" })).map(([path, d]) => [
    path.split("/").at(-2),
    d,
  ]),
);

/* Live smoke tests from backend/tester/smoke.mjs (Mozark cloud browsers).
   Videos and the home screenshot (poster) are bundled as asset URLs. */
const folderOf = (path) => path.split("/fixtures/")[1]?.split("/")[0];
const SMOKES = Object.fromEntries(
  Object.entries(import.meta.glob("@fixtures/*/smoke/smoke.json", { eager: true, import: "default" })).map(([path, s]) => [folderOf(path), s]),
);
const SMOKE_ASSETS = import.meta.glob(["@fixtures/*/smoke/*/video.mp4", "@fixtures/*/smoke/*/smoke-*-d1.jpg"], {
  eager: true,
  query: "?url",
  import: "default",
});
function liveTestFor(id) {
  const s = SMOKES[id];
  if (!s) return null;
  const asset = (rel) => Object.entries(SMOKE_ASSETS).find(([path]) => path.endsWith(`/${id}/smoke/${rel}`))?.[1] ?? null;
  return {
    ...s,
    runs: s.runs.map((r) => ({
      ...r,
      videoUrl: r.video ? asset(r.video.file) : null,
      posterUrl: r.phases?.[0]?.steps?.[0]?.screenshot ? asset(r.phases[0].steps[0].screenshot) : null,
    })),
  };
}

/* Judge panel reviews stored with sample projects (backend/src/judges/run.mjs writes them). */
const REVIEWS = Object.fromEntries(
  Object.entries(import.meta.glob("@fixtures/*/reviews.json", { eager: true, import: "default" })).map(([path, r]) => [folderOf(path), r]),
);

const SAMPLES = [fromFixture("go-health-me", goHealthMe, goHealthMeSource)].map((p) => ({
  ...p,
  dossier: DOSSIERS[p.id] ?? null,
  liveTest: liveTestFor(p.id),
  reviews: REVIEWS[p.id] ?? null,
}));

export async function listProjects() {
  // Server submissions (when the backend is up) plus anything saved only in this browser.
  const remote = await api("/submissions").catch(() => []);
  const byId = new Map([...listSubmissions(), ...remote].map((r) => [r.id, r]));
  const submitted = [...byId.values()]
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
