/*
 * Projects shown on /projects: whatever teams submitted (the backend's store, plus anything
 * saved only in this browser when the backend was offline). No built-in projects.
 */
import { api } from "./api.js";
import { DEMO_ENABLED, isOutage } from "./demo.js";
import { listSubmissions } from "./storage.js";
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
    savedLocallyOnly: Boolean(r.savedLocallyOnly),
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

/** Labelled demo projects, shown only when the backend can't be reached. */
const DEMO_PROJECTS = [
  { id: "demo-stepquest", project: { name: "StepQuest", pitch: "A fitness game that rewards daily steps", description: "Demo project shown because the backend could not be reached." }, team: { name: "Demo team" }, tracks: ["base"] },
  { id: "demo-splitpay", project: { name: "SplitPay", pitch: "AI agents that split USDC payments", description: "Demo project shown because the backend could not be reached." }, team: { name: "Demo team" }, tracks: ["uniswap"] },
].map((r) => ({ ...fromSubmission(r), kind: "sample" }));

export async function listProjects() {
  let remote = [];
  let demo = [];
  try {
    remote = await api("/submissions");
  } catch (e) {
    // Backend unreachable: keep what was saved in this browser and add the labelled demo projects.
    if (DEMO_ENABLED && isOutage(e)) demo = DEMO_PROJECTS;
  }
  const byId = new Map([...listSubmissions(), ...remote].map((r) => [r.id, r]));
  const submitted = [...byId.values()]
    .map(fromSubmission)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return [...submitted, ...demo];
}

export async function getProject(id) {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

/** Embeddable player URL for Loom and YouTube links; null for anything else. */
export { embedUrl } from "./video.js";
