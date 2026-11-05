/*
 * Everything a judge may see about a project: the team's submission, the
 * reviewer's dossier and the live test. Sample projects come from
 * backend/fixtures/<id>/; submitted ones from the store.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dossiers, submissions } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures");

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

function fromFixture(id) {
  const dir = path.join(FIXTURES, id);
  const sub = readJson(path.join(dir, "submission.json"));
  if (!sub) return null;
  const f = sub.form;
  return {
    id,
    kind: "sample",
    submission: {
      teamName: f.team.name,
      name: f.project.name,
      pitch: f.project.pitch,
      description: f.project.description,
      repoUrl: f.code.repoUrl,
      videoUrl: f.demo.videoUrl,
      tracks: f.tracks.selected,
    },
    dossier: readJson(path.join(dir, "dossier.json")),
    liveTest: readJson(path.join(dir, "smoke", "smoke.json")),
  };
}

function fromSubmission(r) {
  return {
    id: r.id,
    kind: "submitted",
    submission: {
      teamName: r.team?.name,
      name: r.project?.name,
      pitch: r.project?.pitch,
      description: r.project?.description,
      repoUrl: r.repoUrl,
      videoUrl: r.demoVideoUrl,
      tracks: r.tracks ?? [],
    },
    dossier: dossiers.get(r.id),
    liveTest: null,
  };
}

export function loadProject(id) {
  if (/^[a-z0-9-]+$/.test(id) && fs.existsSync(path.join(FIXTURES, id, "submission.json"))) return fromFixture(id);
  const s = submissions.get(id);
  return s ? fromSubmission(s) : null;
}

/** Live test squeezed to what a judge needs: outcomes and step results, no screenshots or URLs of frames. */
export function liveTestSummary(lt) {
  if (!lt) return null;
  return {
    target: lt.target,
    ranAt: lt.ranAt,
    runs: lt.runs.map((r) => ({
      device: r.device,
      outcome: r.outcome,
      home: r.home && { status: r.home.status, loadMs: r.home.loadMs, horizontalScroll: r.home.horizontalScroll },
      failedRequests: [...new Set((r.failedRequests ?? []).map((f) => `${new URL(f.url).pathname} ${f.status ?? f.error}`))],
      phases: (r.phases ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        steps: p.steps.map((s) => ({ id: s.id, title: s.title, status: s.status, demoAt: s.demoAt ?? undefined, detail: s.status === "failed" ? s.detail : undefined })),
      })),
    })),
  };
}
