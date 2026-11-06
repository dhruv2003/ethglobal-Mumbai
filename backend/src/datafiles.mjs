/*
 * Small helpers shared by the store and the Arkiv records. The arena keeps no data
 * on disk (records on Arkiv: arkiv/db.mjs; files on 0G Storage: zg/files.mjs). The only files
 * it writes are scratch work, under the OS temp folder, removed when the work ends:
 * a cloned repo being read, a video being transcoded, a live test being recorded.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/** Read a JSON file from a folder (fixtures, scratch output), or the fallback. */
export function readJSON(file, fallback, dir) {
  try {
    return JSON.parse(fs.readFileSync(dir ? path.join(dir, file) : file, "utf8"));
  } catch {
    return fallback;
  }
}

export const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");

/** Root of all scratch work (ARENA_SCRATCH_DIR, default <tmp>/arena-scratch). Never holds data that must survive. */
export const SCRATCH_ROOT = process.env.ARENA_SCRATCH_DIR ?? path.join(os.tmpdir(), "arena-scratch");

/** A scratch folder for one job, e.g. scratch("repos", id). Not created until something writes into it. */
export const scratch = (...parts) => path.join(SCRATCH_ROOT, ...parts.map(safeId));

/** Remove a scratch folder. */
export const clearScratch = (dir) => fs.rmSync(dir, { recursive: true, force: true });
