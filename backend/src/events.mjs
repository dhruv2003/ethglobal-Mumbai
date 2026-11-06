/*
 * A tournament as people know it ("ETH Global"): its tracks and prizes, its submission deadline,
 * how long betting stays open and its judges. Each track becomes its own bracket on chain once
 * the deadline passes, and every project also enters the overall finalist bracket.
 */
import fs from "node:fs";
import path from "node:path";
import { readJSON } from "./datafiles.mjs";
import { DATA_DIR } from "./store.mjs";

const FILE = path.join(DATA_DIR, "events.json");
export const OVERALL = { id: "overall", name: "Overall finalist", prize: "" };
export const MAX_TRACKS_PER_PROJECT = 3;
export const JUDGES_PER_EVENT = 3;

const readAll = () => readJSON("events.json", []);
function writeAll(all) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, FILE);
}

const clean = (v, max) => String(v ?? "").trim().slice(0, max);
export const slug = (v) => clean(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Checks the organizer's form. Returns { errors } or { event }. */
export function validateEvent(form, { existing = [], judgeIds = [], now = Date.now(), createdBy = null } = {}) {
  const errors = {};
  const name = clean(form?.name, 60);
  const id = slug(name);
  if (!id || /^\d+$/.test(id)) errors.name = "Give the tournament a name with letters in it.";
  else if (existing.some((e) => e.id === id)) errors.name = "A tournament with this name already exists.";

  const tracks = [];
  for (const t of Array.isArray(form?.tracks) ? form.tracks : []) {
    const trackName = clean(t?.name, 40);
    if (!trackName) continue;
    const trackId = slug(trackName);
    if (!trackId || trackId === OVERALL.id || tracks.some((x) => x.id === trackId)) {
      errors.tracks = `"${trackName}" can't be used twice or as a track name.`;
      continue;
    }
    tracks.push({ id: trackId, name: trackName, prize: clean(t?.prize, 40) });
  }
  if (!tracks.length && !errors.tracks) errors.tracks = "Add at least one track.";

  const deadline = Date.parse(form?.deadline);
  if (!Number.isFinite(deadline) || deadline <= now) errors.deadline = "The submission deadline must be in the future.";

  const bettingMinutes = Math.floor(Number(form?.bettingMinutes));
  if (!(bettingMinutes >= 1 && bettingMinutes <= 1440)) errors.bettingMinutes = "Betting stays open for 1 to 1440 minutes.";

  const judges = [...new Set(Array.isArray(form?.judgeIds) ? form.judgeIds : [])];
  if (judges.length !== JUDGES_PER_EVENT || judges.some((j) => !judgeIds.includes(j))) errors.judgeIds = `Pick exactly ${JUDGES_PER_EVENT} judges.`;

  if (Object.keys(errors).length) return { errors };
  return { event: { id, name, tracks, deadline: new Date(deadline).toISOString(), bettingMinutes, judgeIds: judges, createdBy, createdAt: new Date(now).toISOString() } };
}

export const events = {
  list: () => readAll(),
  get: (id) => readAll().find((e) => e.id === id) ?? null,
  add: (event) => writeAll([...readAll(), event]),
  update: (id, patch) => writeAll(readAll().map((e) => (e.id === id ? { ...e, ...patch } : e))),
};

/** Why a submission can't enter this tournament, or null. */
export function submissionProblem(event, tracks, now = Date.now()) {
  if (!event) return "Pick a tournament to enter.";
  if (now >= Date.parse(event.deadline)) return `Submissions for ${event.name} are closed.`;
  if (!Array.isArray(tracks) || tracks.length > MAX_TRACKS_PER_PROJECT) return `Pick at most ${MAX_TRACKS_PER_PROJECT} tracks.`;
  const known = new Set(event.tracks.map((t) => t.id));
  if (tracks.some((t) => !known.has(t))) return `One of those tracks isn't part of ${event.name}.`;
  return null;
}
