/*
 * Tiny JSON-file store under backend/data/. A stand-in for the database:
 * swap these functions for real queries later; callers don't change.
 * Writes go through a temp file + rename so a crash never leaves half a file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ARENA_DATA_DIR ?? path.resolve(here, "../data");
fs.mkdirSync(path.join(DATA_DIR, "reviews"), { recursive: true });

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}
function write(file, value) {
  const full = path.join(DATA_DIR, file);
  const tmp = `${full}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, full);
  return value;
}

export const judges = {
  list: () => read("judges.json", []),
  save: (all) => write("judges.json", all),
};

export const submissions = {
  list: () => read("submissions.json", []),
  get: (id) => read("submissions.json", []).find((s) => s.id === id) ?? null,
  add: (record) => write("submissions.json", [...read("submissions.json", []), record]),
};

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
export const reviews = {
  get: (projectId) => read(`reviews/${safeId(projectId)}.json`, null),
  save: (projectId, value) => write(`reviews/${safeId(projectId)}.json`, value),
};

fs.mkdirSync(path.join(DATA_DIR, "pipeline"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "dossiers"), { recursive: true });
export const pipelines = {
  get: (projectId) => read(`pipeline/${safeId(projectId)}.json`, null),
  save: (projectId, value) => write(`pipeline/${safeId(projectId)}.json`, value),
};
export const dossiers = {
  get: (projectId) => read(`dossiers/${safeId(projectId)}.json`, null),
  save: (projectId, value) => write(`dossiers/${safeId(projectId)}.json`, value),
};
export const repoDir = (projectId) => path.join(DATA_DIR, "repos", safeId(projectId));

fs.mkdirSync(path.join(DATA_DIR, "transcripts"), { recursive: true });
export const transcripts = {
  get: (projectId) => read(`transcripts/${safeId(projectId)}.json`, null),
  save: (projectId, value) => write(`transcripts/${safeId(projectId)}.json`, value),
};
/** Live test output (smoke.json, recordings, screenshots) for a submitted project. */
export const liveDir = (projectId) => path.join(DATA_DIR, "live", safeId(projectId));
/** Scratch space for downloads; always deleted after use. */
export const workDir = (projectId) => path.join(DATA_DIR, "work", safeId(projectId));

/** Remove everything stored for a submitted project. */
export function deleteProject(projectId) {
  const id = safeId(projectId);
  write("submissions.json", read("submissions.json", []).filter((s) => s.id !== projectId));
  for (const f of [`reviews/${id}.json`, `pipeline/${id}.json`, `dossiers/${id}.json`, `transcripts/${id}.json`]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  for (const d of [repoDir(projectId), liveDir(projectId), workDir(projectId)]) fs.rmSync(d, { recursive: true, force: true });
}
