/*
 * Push the arena's local records to Arkiv. Each sync* gathers one kind of data
 * from the local store, builds the records (builders.mjs) and writes the ones
 * that changed (store.mjs skips unchanged ones by hash).
 *
 *   syncProject(id)        project, pipeline, dossier, transcript, livetest, vision
 *   syncJudges()           every judge persona
 *   syncTournament(id)     the bracket
 *   syncFight(t, m)        one recorded 1v1 match
 *
 * The *InBackground versions never throw: Arkiv being down never breaks the app.
 * Scores of a judging run go through ../publish.mjs (panel + scorecards).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../../projects.mjs";
import { DATA_DIR, judges, pipelines, submissions, transcripts } from "../../store.mjs";
import { canWrite } from "../arkiv.mjs";
import * as build from "./builders.mjs";
import { writeRecord } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../../fixtures");
const safe = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "");
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Transcript for a submitted project (data/transcripts) or a sample (fixture files). */
function transcriptOf(project) {
  if (project.kind !== "sample") return transcripts.get(project.id);
  const dir = path.join(FIXTURES, project.id, "media");
  const md = path.join(dir, "demo-transcript.md");
  if (!fs.existsSync(md)) return null;
  return { source: "fixture", text: fs.readFileSync(md, "utf8"), words: readJson(path.join(dir, "loom-transcript.json")) };
}

async function writeAll(records, opts) {
  const out = [];
  for (const r of records.filter(Boolean)) {
    try {
      const res = await writeRecord(r.type, r.attrs, r.payload, opts);
      out.push({ type: r.type, ...res });
    } catch (e) {
      out.push({ type: r.type, error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300) });
    }
  }
  return out;
}

export async function syncProject(projectId, opts = {}) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`No such project: ${projectId}`);
  const raw = project.kind === "sample" ? null : submissions.get(projectId);
  return writeAll(
    [
      build.projectRecord(project, raw),
      build.pipelineRecord(project, pipelines.get(projectId)),
      build.dossierRecord(project),
      build.transcriptRecord(project, transcriptOf(project)),
      build.livetestRecord(project),
      build.visionRecord(project, readJson(path.join(DATA_DIR, "evidence", `${safe(projectId)}.json`))),
    ],
    opts,
  );
}

export const syncJudges = (opts = {}) => writeAll(judges.list().map(build.judgeRecord), opts);

const tournamentOf = (id) => readJson(path.join(DATA_DIR, "arena-tournaments", `${safe(id)}.json`));
export const syncTournament = (id, opts = {}) => writeAll([build.tournamentRecord(tournamentOf(id))], opts);

export function syncFight(t, m, opts = {}) {
  const fight = readJson(path.join(DATA_DIR, "arena-fights", `${safe(t)}-${Number(m)}.json`));
  return writeAll([build.fightRecord(fight, tournamentOf(t))], opts);
}

/** Every project, judge, tournament and fight on this server. */
export async function syncAll(opts = {}) {
  const ids = [...new Set([...fs.readdirSync(FIXTURES).filter((d) => fs.existsSync(path.join(FIXTURES, d, "submission.json"))), ...submissions.list().map((s) => s.id)])];
  const out = { judges: await syncJudges(opts), projects: {}, tournaments: {}, fights: {} };
  for (const id of ids) out.projects[id] = await syncProject(id, opts);
  const list = (name) => (fs.existsSync(path.join(DATA_DIR, name)) ? fs.readdirSync(path.join(DATA_DIR, name)).filter((f) => f.endsWith(".json")) : []);
  for (const f of list("arena-tournaments")) out.tournaments[f] = await syncTournament(f.replace(/\.json$/, ""), opts);
  for (const f of list("arena-fights")) {
    const m = f.match(/^(.+)-(\d+)\.json$/);
    if (m) out.fights[f] = await syncFight(m[1], Number(m[2]), opts);
  }
  return out;
}

const quiet = (label, fn) => {
  if (!canWrite()) return;
  Promise.resolve()
    .then(fn)
    .then((res) => {
      const errs = (Array.isArray(res) ? res : []).filter((r) => r.error);
      if (errs.length) console.error(`[arkiv] ${label}: ${errs.map((e) => `${e.type}: ${e.error}`).join("; ")}`);
    })
    .catch((e) => console.error(`[arkiv] ${label} failed: ${e.message}`));
};
export const syncProjectInBackground = (id) => quiet(`project ${id}`, () => syncProject(id));
export const syncJudgesInBackground = () => quiet("judges", () => syncJudges());
export const syncTournamentInBackground = (id) => quiet(`tournament ${id}`, () => syncTournament(id));
export const syncFightInBackground = (t, m) => quiet(`fight ${t}-${m}`, () => syncFight(t, m));
