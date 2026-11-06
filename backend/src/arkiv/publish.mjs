/*
 * After the judges score a run: upload the evidence bundle to Swarm, then write
 * the panel and scorecards to Arkiv with the Swarm reference. The outcome (keys,
 * tx hashes, reference, any error) is kept in backend/data/arkiv/<id>.json.
 *
 * Publishing never blocks or fails a review: it runs after the result is saved.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, liveDir } from "../store.mjs";
import { canWrite, publishPanel, publisher } from "./arkiv.mjs";
import { swarmConfigured, uploadBundle } from "./swarm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
const recordFile = (id) => path.join(DATA_DIR, "arkiv", `${safeId(id)}.json`);

export const publishing = new Map(); // projectId -> Promise

/** The last publish attempt for a project, or null. */
export function lastPublish(projectId) {
  try {
    return JSON.parse(fs.readFileSync(recordFile(projectId), "utf8"));
  } catch {
    return null;
  }
}

/** Where this project's live test lives. */
export const liveDirOf = (project) => liveDir(project.id);

/**
 * Publish one saved run. opts.upload / opts.publish replace Swarm and Arkiv (tests).
 * Returns the record written to data/arkiv/<id>.json.
 */
export async function publishRun(project, result, { upload = uploadBundle, publish = publishPanel, log = () => {} } = {}) {
  if (publishing.has(project.id)) return publishing.get(project.id);
  const job = (async () => {
    const record = { projectId: project.id, ranAt: result.ranAt, startedAt: new Date().toISOString(), publisher: publisher() };
    if (swarmConfigured() || upload !== uploadBundle) {
      try {
        const s = await upload({ result, dossier: project.dossier, liveDir: liveDirOf(project) });
        record.swarm = { reference: s.reference, files: s.files, batchId: process.env.SWARM_BATCH_ID ?? null, beeUrl: process.env.BEE_URL ?? null };
        log(`swarm: ${s.reference} (${s.files.length} files)`);
      } catch (e) {
        record.swarmError = String(e?.message ?? e).slice(0, 300);
        log(`swarm failed: ${record.swarmError}`);
      }
    }
    try {
      record.arkiv = await publish(project.id, result, { swarmRef: record.swarm?.reference ?? null, projectName: project.submission?.name ?? null });
      log(`arkiv: panel ${record.arkiv.panelKey}`);
    } catch (e) {
      record.arkivError = String(e?.shortMessage ?? e?.message ?? e).slice(0, 300);
      log(`arkiv failed: ${record.arkivError}`);
    }
    record.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(recordFile(project.id)), { recursive: true });
    fs.writeFileSync(recordFile(project.id), JSON.stringify(record, null, 2));
    return record;
  })().finally(() => publishing.delete(project.id));
  publishing.set(project.id, job);
  return job;
}

/** Called after every saved review: publish in the background when Arkiv is set up. Returns the job (or null), never a rejection. */
export function publishInBackground(project, result) {
  if (!canWrite()) return null;
  return publishRun(project, result).catch((e) => {
    console.error(`[arkiv] publish of ${project.id} failed: ${e.message}`);
    return null;
  });
}
