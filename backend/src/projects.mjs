/*
 * Everything a judge may see about a project: the team's submission, the
 * reviewer's dossier and the live test, all from the store (Arkiv). The live
 * test's screenshots are read separately (judges/evidence.mjs loadScreenshots).
 */
import { dossiers, liveTests, submissions } from "./store.mjs";

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
    liveTest: liveTests.get(r.id),
  };
}

export function loadProject(id) {
  const s = submissions.get(id);
  return s ? fromSubmission(s) : null;
}

