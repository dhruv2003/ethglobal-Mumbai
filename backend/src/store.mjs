/*
 * Everything the arena stores, by kind. Records live on Arkiv (arkiv/db.mjs), files on
 * 0G Storage (zg/files.mjs, indexed on Arkiv); this server's disk holds nothing but scratch
 * work that is deleted when the work ends (datafiles.mjs).
 *
 * Importing this module waits until the database has been read from Arkiv, so every
 * caller can read synchronously.
 */
import * as db from "./arkiv/db.mjs";
import { removeScope } from "./zg/files.mjs";
import { safeId, scratch } from "./datafiles.mjs";

await db.load();

/** One document per project in a collection. */
function perProject(collection) {
  return {
    get: (projectId) => db.get(collection, safeId(projectId)),
    save: (projectId, value) => db.put(collection, safeId(projectId), value),
    remove: (projectId) => db.remove(collection, safeId(projectId)),
  };
}

const byTime = (field) => (a, b) => String(a?.[field] ?? "").localeCompare(String(b?.[field] ?? ""));

/** The judge panel: one document holding the list (order matters: the first three judge). */
export const judges = {
  list: () => db.get("judges", "panel") ?? [],
  save: (all) => db.put("judges", "panel", all),
};

export const submissions = {
  list: () => db.list("submissions").sort(byTime("submittedAt")),
  get: (id) => db.get("submissions", String(id)),
  add: (record) => db.put("submissions", String(record.id), record),
};

export const reviews = perProject("reviews");
export const pipelines = perProject("pipelines");
export const dossiers = perProject("dossiers");
export const transcripts = perProject("transcripts");
/** Screenshot observations from the vision model on 0G, per project. */
export const evidence = perProject("evidence");
/** The live-test report (what tester/runner.mjs writes as smoke.json). Its media are files of the project on 0G. */
export const liveTests = perProject("livetests");
/** The smart contract test report (reviewer/contracts.mjs): forge's results per test, or why nothing ran. */
export const contractTests = perProject("contracttests");
/** Facts about our copy of the demo video ({ ext, bytes, seconds, source } or { error }). The video is a file of the project on 0G. */
export const videos = perProject("videos");
/** The last Swarm + Arkiv publish of a judged run (arkiv/publish.mjs). */
export const publishes = perProject("arkiv-publishes");

/** Judge voice notes: the transcript and its 0G trace. The audio itself (a person's voice) is never kept, only its sha256. */
export const voiceNotes = {
  get: (id) => db.get("voice-notes", safeId(id)),
  list: () => db.list("voice-notes"),
  save: (id, value) => db.put("voice-notes", safeId(id), value),
};

/**
 * A live-test file's name (a file on 0G Storage (a file of the project): "laptop/smoke-laptop-f3.jpg"
 * (as smoke.json refers to it) -> "live/laptop/smoke-laptop-f3.jpg". Null for anything else.
 */
export const liveFile = (rel) => (/^(laptop|phone)\/(video\.mp4|smoke-(laptop|phone)-[a-z0-9]+\.jpg)$/.test(String(rel ?? "")) ? `live/${rel}` : null);

/** Scratch folders (deleted after use; never data). */
export const repoDir = (projectId) => scratch("repos", projectId);
/** Where a running live test writes its recordings and screenshots before they go to Arkiv. */
export const liveDir = (projectId) => scratch("live", projectId);
export const workDir = (projectId) => scratch("work", projectId);

/** Remove everything stored for a submitted project. */
export function deleteProject(projectId) {
  db.remove("submissions", String(projectId));
  for (const s of [reviews, pipelines, dossiers, transcripts, evidence, liveTests, contractTests, videos, publishes]) s.remove(projectId);
  removeScope(safeId(projectId));
}

export { db };
