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
};

/** The local value behind one archive record, or undefined. */
export function localValue(kind, id) {
  const hit = localRecords[kind]?.().find(([k]) => k === String(id));
  return hit ? hit[1] : undefined;
}

/** Start the background 0G uploader (no-op when ZG_STORAGE is off). */
export const startArchive = () => archive.start(localRecords);
