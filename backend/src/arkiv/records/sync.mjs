/*
 * The public, queryable view of the arena on Arkiv. The data itself is already on
 * Arkiv (the database, ../db.mjs; files are on 0G Storage, ../../zg/files.mjs); these typed records add
 * columns people can filter on (scores, statuses, tracks). Each sync* reads one kind
 * of data from the store, builds the records (builders.mjs) and writes the ones that
 * changed (store.mjs skips unchanged ones by hash).
 *
 *   syncProject(id)        project, pipeline, dossier, transcript, livetest, vision,
 *                          the full judging review
 *   syncJudges()           every judge persona
 *   syncTournament(id)     the bracket
 *   syncFight(t, m)        one recorded 1v1 match
 *
 * The *InBackground versions never throw: Arkiv being down never breaks the app.
 * Scores of a judging run go through ../publish.mjs (panel + scorecards).
 */
import { loadProject } from "../../projects.mjs";
import { db, evidence, judges, pipelines, reviews, submissions, transcripts } from "../../store.mjs";
import { canWrite } from "../arkiv.mjs";
import * as build from "./builders.mjs";
import { writeRecord } from "./store.mjs";

const errorText = (e) => String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);

async function writeAll(records, opts) {
  const out = [];
  for (const r of records.filter(Boolean)) {
    try {
      const res = await writeRecord(r.type, r.attrs, r.payload, opts);
      out.push({ type: r.type, ...res });
    } catch (e) {
      out.push({ type: r.type, error: errorText(e) });
    }
  }
  return out;
}

export async function syncProject(projectId, opts = {}) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`No such project: ${projectId}`);
  const raw = submissions.get(projectId);
  const records = await writeAll(
    [
      build.projectRecord(project, raw),
      build.pipelineRecord(project, pipelines.get(projectId)),
      build.dossierRecord(project),
      build.transcriptRecord(project, transcripts.get(project.id)),
      build.livetestRecord(project),
      build.visionRecord(project, evidence.get(projectId)),
      build.reviewRecord(project, reviews.get(projectId)),
    ],
    opts,
  );
  return records;
}

export const syncJudges = (opts = {}) => writeAll(judges.list().map(build.judgeRecord), opts);

const tournamentOf = (id) => db.get("tournaments", String(id));
export const syncTournament = (id, opts = {}) => writeAll([build.tournamentRecord(tournamentOf(id))], opts);

export function syncFight(t, m, opts = {}) {
  const fight = db.get("fights", `${t}-${Number(m)}`);
  return writeAll([build.fightRecord(fight, tournamentOf(t))], opts);
}

/** Every project, judge, tournament and fight on this server. */
export async function syncAll(opts = {}) {
  const ids = submissions.list().map((s) => s.id);
  const out = { judges: await syncJudges(opts), projects: {}, tournaments: {}, fights: {} };
  for (const id of ids) out.projects[id] = await syncProject(id, opts);
  for (const [id] of db.entries("tournaments")) out.tournaments[id] = await syncTournament(id, opts);
  for (const [id, f] of db.entries("fights")) out.fights[id] = await syncFight(f.tournamentId, f.match, opts);
  return out;
}

const quiet = (label, fn) => {
  if (!canWrite()) return Promise.resolve();
  return Promise.resolve()
    .then(fn)
    .then((res) => {
      const errs = (Array.isArray(res) ? res : []).filter((r) => r.error);
      if (errs.length) console.error(`[arkiv] ${label}: ${errs.map((e) => `${e.type}: ${e.error}`).join("; ")}`);
    })
    .catch((e) => console.error(`[arkiv] ${label} failed: ${e.message}`));
};
// One sync per project at a time; a request while one runs queues exactly one more
// (so files are never uploaded twice in parallel, and nothing new is missed).
const projectSync = new Map(); // id -> { again: boolean }
export const syncProjectInBackground = (id) => {
  const cur = projectSync.get(id);
  if (cur) {
    cur.again = true;
    return;
  }
  const state = { again: false };
  projectSync.set(id, state);
  const loop = async () => {
    do {
      state.again = false;
      await quiet(`project ${id}`, () => syncProject(id));
    } while (state.again);
    projectSync.delete(id);
  };
  loop();
};
export const syncJudgesInBackground = () => quiet("judges", () => syncJudges());
export const syncTournamentInBackground = (id) => quiet(`tournament ${id}`, () => syncTournament(id));
export const syncFightInBackground = (t, m) => quiet(`fight ${t}-${m}`, () => syncFight(t, m));
