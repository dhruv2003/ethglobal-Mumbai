/*
 * Everything a judge may see about a project: the team's submission, the
 * reviewer's dossier and the live test, all from the store.
 */
import fs from "node:fs";
import path from "node:path";
import { dossiers, liveDir, submissions } from "./store.mjs";

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

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
    liveTest: readJson(path.join(liveDir(r.id), "smoke.json")),
  };
}

export function loadProject(id) {
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
