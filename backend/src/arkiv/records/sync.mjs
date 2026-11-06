/*
 * Push the arena's local records to Arkiv. Each sync* gathers one kind of data
 * from the local store, builds the records (builders.mjs) and writes the ones
 * that changed (store.mjs skips unchanged ones by hash).
 *
 *   syncProject(id)        project, pipeline, dossier, transcript, livetest, vision,
 *                          the full judging review, then the files: demo screenshots,
 *                          live recordings and step screenshots (the demo video only
 *                          with ARKIV_DEMO_VIDEO=1)
 *   syncJudges()           every judge persona
 *   syncTournament(id)     the bracket
 *   syncFight(t, m)        one recorded 1v1 match
 *
 * The *InBackground versions never throw: Arkiv being down never breaks the app.
 * Scores of a judging run go through ../publish.mjs (panel + scorecards).
 */
import fs from "node:fs";
import path from "node:path";
import { loadProject } from "../../projects.mjs";
import { DATA_DIR, judges, liveDir, mediaDir, pipelines, reviews, submissions, transcripts, videos } from "../../store.mjs";
import { IMAGE_REF, UPLOAD_DIR } from "../../reviewer/media.mjs";
import { canWrite } from "../arkiv.mjs";
import * as build from "./builders.mjs";
import { writeBlob, writeRecord } from "./store.mjs";

const safe = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "");
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

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

/** Every file kept for a project, as { kind, name, path }. Names are what the file is read back by. */
export function projectFiles(projectId) {
  const out = [];
  const add = (kind, name, p) => fs.existsSync(p) && out.push({ kind, name, path: p });
  // The demo video stays off chain by default: it is most of a project's bytes (a 4-minute
  // demo is ~70 entities, ~10 min and ~1 testnet ETH), and it still plays from our copy and
  // the team's link. ARKIV_DEMO_VIDEO=1 puts it on chain too.
  const v = videos.get(projectId);
  if (v?.ext && process.env.ARKIV_DEMO_VIDEO === "1") add("demo-video", `demo.${v.ext}`, path.join(mediaDir(projectId), `demo.${v.ext}`));
  (submissions.get(projectId)?.demoImages ?? []).forEach((ref, i) => {
    const f = IMAGE_REF.exec(String(ref))?.[1];
    if (f) add("demo-screenshot", `demo-screenshot-${i + 1}${path.extname(f)}`, path.join(UPLOAD_DIR, f));
  });
  for (const device of ["laptop", "phone"]) {
    const dir = path.join(liveDir(projectId), device);
    if (!fs.existsSync(dir)) continue;
    add("live-recording", `live/${device}/video.mp4`, path.join(dir, "video.mp4"));
    for (const f of fs.readdirSync(dir).filter((x) => /^smoke-.+\.jpg$/.test(x)).sort()) add("live-screenshot", `live/${device}/${f}`, path.join(dir, f));
  }
  return out;
}

/** Write each file's bytes (unchanged files are skipped by hash). */
export async function syncFiles(projectId, opts = {}) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`No such project: ${projectId}`);
  const out = [];
  for (const f of projectFiles(projectId)) {
    try {
      const buffer = fs.readFileSync(f.path);
      const r = build.fileRecord(project, { ...f, size: buffer.length });
      const res = await writeBlob("file", r.attrs, buffer, opts);
      out.push({ type: `file ${f.name}`, ...res });
    } catch (e) {
      out.push({ type: `file ${f.name}`, error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300) });
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
      build.visionRecord(project, readJson(path.join(DATA_DIR, "evidence", `${safe(projectId)}.json`))),
      build.reviewRecord(project, reviews.get(projectId)),
    ],
    opts,
  );
  if (opts.files === false) return records;
  return [...records, ...(await syncFiles(projectId, opts))];
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
  const ids = submissions.list().map((s) => s.id);
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
