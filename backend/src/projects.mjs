/*
 * Everything a judge may see about a project: the team's submission, the
 * reviewer's dossier and the live test, all from the store.
 */
import { readJSON } from "./datafiles.mjs";
import { dossiers, liveDir, submissions } from "./store.mjs";

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
    liveTest: readJSON("smoke.json", null, liveDir(r.id)),
  };
}

export function loadProject(id) {
  const s = submissions.get(id);
  return s ? fromSubmission(s) : null;
}

