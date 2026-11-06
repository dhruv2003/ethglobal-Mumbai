/*
 * Tiny JSON-file store under backend/data/. A stand-in for the database:
 * swap these functions for real queries later; callers don't change.
 *
 * Local JSON is the fast read path. With ZG_STORAGE=1 every write is also
 * archived to 0G Storage in the background (src/zg/archive.mjs): the local file
 * is written first, then an outbox item is queued. A 0G failure never fails or
 * slows a write. `zgStatus(kind, id)` tells the API what 0G has.
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, readJSON, safeId, writeJSON } from "./datafiles.mjs";
import * as archive from "./zg/archive.mjs";

export { DATA_DIR };
fs.mkdirSync(path.join(DATA_DIR, "reviews"), { recursive: true });

const read = (file, fallback) => readJSON(file, fallback);
const write = (file, value) => writeJSON(file, value);

export const judges = {
  list: () => read("judges.json", []),
  save: (all) => {
    write("judges.json", all);
    archive.archive("judges", "panel", all);
    return all;
  },
};

export const submissions = {
  list: () => read("submissions.json", []),
  get: (id) => read("submissions.json", []).find((s) => s.id === id) ?? null,
  add: (record) => {
    const all = write("submissions.json", [...read("submissions.json", []), record]);
    archive.archive("submission", record.id, record);
    return all;
  },
};

export const reviews = {
  get: (projectId) => read(`reviews/${safeId(projectId)}.json`, null),
  save: (projectId, value) => {
    write(`reviews/${safeId(projectId)}.json`, value);
    archive.archive("review", safeId(projectId), value);
    return value;
  },
};

fs.mkdirSync(path.join(DATA_DIR, "pipeline"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "dossiers"), { recursive: true });
export const pipelines = {
  get: (projectId) => read(`pipeline/${safeId(projectId)}.json`, null),
  save: (projectId, value) => write(`pipeline/${safeId(projectId)}.json`, value),
};
export const dossiers = {
  get: (projectId) => read(`dossiers/${safeId(projectId)}.json`, null),
  save: (projectId, value) => {
    write(`dossiers/${safeId(projectId)}.json`, value);
    archive.archive("dossier", safeId(projectId), value);
    return value;
  },
};
export const repoDir = (projectId) => path.join(DATA_DIR, "repos", safeId(projectId));

fs.mkdirSync(path.join(DATA_DIR, "transcripts"), { recursive: true });
export const transcripts = {
  get: (projectId) => read(`transcripts/${safeId(projectId)}.json`, null),
  save: (projectId, value) => {
    write(`transcripts/${safeId(projectId)}.json`, value);
    archive.archive("transcript", safeId(projectId), value);
    return value;
  },
};
/** Live test output (smoke.json, recordings, screenshots) for a submitted project. */
export const liveDir = (projectId) => path.join(DATA_DIR, "live", safeId(projectId));
/** Our copy of the demo video (demo.<ext>) and its facts (video.json). */
export const mediaDir = (projectId) => path.join(DATA_DIR, "media", safeId(projectId));
export const videos = {
  get: (projectId) => read(`media/${safeId(projectId)}/video.json`, null),
  save: (projectId, value) => {
    fs.mkdirSync(mediaDir(projectId), { recursive: true });
    write(`media/${safeId(projectId)}/video.json`, value);
    archive.archive("video", safeId(projectId), value);
    return value;
  },
};
/** Scratch space for downloads; always deleted after use. */
export const workDir = (projectId) => path.join(DATA_DIR, "work", safeId(projectId));

/** Remove everything stored for a submitted project. */
export function deleteProject(projectId) {
  const id = safeId(projectId);
  write("submissions.json", read("submissions.json", []).filter((s) => s.id !== projectId));
  for (const f of [`reviews/${id}.json`, `pipeline/${id}.json`, `dossiers/${id}.json`, `transcripts/${id}.json`, `evidence/${id}.json`]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  for (const d of [repoDir(projectId), liveDir(projectId), workDir(projectId), mediaDir(projectId)]) fs.rmSync(d, { recursive: true, force: true });
  // 0G Storage is permanent: the old versions stay there. Record the deletion so a
  // restore from 0G doesn't bring the project back.
  for (const kind of ["submission", "review", "evidence", "dossier", "transcript", "video"]) archive.tombstone(kind, kind === "submission" ? projectId : id);
}

/** Screenshot observations from the vision model on 0G, cached per project. */
export const evidence = {
  get: (projectId) => read(`evidence/${safeId(projectId)}.json`, null),
  save: (projectId, value) => {
    write(`evidence/${safeId(projectId)}.json`, value);
    archive.archive("evidence", safeId(projectId), value);
    return value;
  },
};

/**
 * Judge voice notes: the transcript and its 0G trace. The audio itself is a
 * person's voice: it is only uploaded when ZG_STORAGE_AES_KEY is set, and then
 * AES-256 encrypted. Otherwise only its sha256 is kept.
 */
export const voiceNotes = {
  get: (id) => read(`voice-notes/${safeId(id)}.json`, null),
  list: () => listDir("voice-notes").map(([, v]) => v),
  save: (id, value, { audio, mime } = {}) => {
    const aes = archive.enabled() && /^(0x)?[0-9a-fA-F]{64}$/.test(process.env.ZG_STORAGE_AES_KEY ?? "");
    const record = audio ? { ...value, audio: { ...value.audio, encryptedOn0G: Boolean(aes) } } : value;
    write(`voice-notes/${safeId(id)}.json`, record);
    archive.archive("voice-note", safeId(id), record);
    if (audio && aes) archive.archiveFile("voice-audio", safeId(id), null, { bytes: audio, encrypt: true, contentType: mime });
    return record;
  },
};

function listDir(dir) {
  try {
    return fs
      .readdirSync(path.join(DATA_DIR, dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.slice(0, -5), read(`${dir}/${f}`, null)])
      .filter(([, v]) => v != null);
  } catch {
    return [];
  }
}

/** 0G Storage status for one record (computed from the manifest; the record is not changed). */
export const zgStatus = (kind, id) => archive.statusOf(kind, kind === "submission" ? id : safeId(id));

/** Every local record by archive kind (for the boot-time backfill and restore checks). */
export const localRecords = {
  judges: () => (fs.existsSync(path.join(DATA_DIR, "judges.json")) ? [["panel", judges.list()]] : []),
  submission: () => submissions.list().map((s) => [s.id, s]),
  review: () => listDir("reviews"),
  evidence: () => listDir("evidence"),
  "voice-note": () => listDir("voice-notes"),
  dossier: () => listDir("dossiers"),
  transcript: () => listDir("transcripts"),
  video: () => {
    try {
      return fs
        .readdirSync(path.join(DATA_DIR, "media"))
        .map((id) => [id, read(`media/${id}/video.json`, null)])
        .filter(([, v]) => v != null);
    } catch {
      return [];
    }
  },
};

/** The local value behind one archive record, or undefined. */
export function localValue(kind, id) {
  const hit = localRecords[kind]?.().find(([k]) => k === String(id));
  return hit ? hit[1] : undefined;
}

/** Start the background 0G uploader (no-op when ZG_STORAGE is off). */
export const startArchive = () => archive.start(localRecords);
