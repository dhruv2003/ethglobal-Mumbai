/*
 * Files under backend/data/ (or ARENA_DATA_DIR). Shared by the store and the
 * 0G archive. JSON is written with sorted keys (the same canonical form we
 * upload to 0G), so a folder restored from 0G is byte-identical to the original.
 * Writes go through a temp file + rename so a crash never leaves half a file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ARENA_DATA_DIR ?? path.resolve(here, "../data");

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function readJSON(file, fallback, dir = DATA_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, value, dir = DATA_DIR) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sortKeys(value), null, 2));
  fs.renameSync(tmp, full);
  return value;
}

export const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
