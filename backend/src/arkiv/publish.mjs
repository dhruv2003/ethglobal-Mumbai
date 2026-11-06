/*
 * After the judges score a run: upload the evidence bundle to Swarm, then write
 * the panel and scorecards to Arkiv with the Swarm reference. The outcome (keys,
 * tx hashes, reference, any error) is kept in the database (store.mjs `publishes`).
 *
 * Publishing never blocks or fails a review: it runs after the result is saved.
 */
import { getFile } from "../zg/files.mjs";
import { liveFile, liveTests, publishes } from "../store.mjs";
import { canWrite, publishPanel, publisher } from "./arkiv.mjs";
import { swarmConfigured, uploadBundle } from "./swarm.mjs";

export const publishing = new Map(); // projectId -> Promise

/** The last publish attempt for a project, or null. */
export const lastPublish = (projectId) => publishes.get(projectId);

/** The live test for the bundle: smoke.json and its media files ([path in the bundle, bytes]), from Arkiv and 0G. */
export async function liveOf(project) {
  const smoke = liveTests.get(project.id);
  if (!smoke) return { liveTest: null, files: [] };
  const rels = (smoke.runs ?? []).flatMap((r) => [r.video?.file, ...(r.phases ?? []).flatMap((ph) => (ph.steps ?? []).map((st) => st.screenshot))]).filter(Boolean);
  const files = [];
  for (const rel of [...new Set(rels)].sort()) {
    const name = liveFile(rel);
    const bytes = name ? await getFile(project.id, name).catch(() => null) : null;
    if (bytes) files.push([rel, bytes]);
  }
  return { liveTest: smoke, files };
}

/**
 * Publish one saved run. opts.upload / opts.publish replace Swarm and Arkiv (tests).
 * Returns the record (also saved as the project's last publish).
 */
export async function publishRun(project, result, { upload = uploadBundle, publish = publishPanel, log = () => {} } = {}) {
  if (publishing.has(project.id)) return publishing.get(project.id);
  const job = (async () => {
    const record = { projectId: project.id, ranAt: result.ranAt, startedAt: new Date().toISOString(), publisher: publisher() };
    if (swarmConfigured() || upload !== uploadBundle) {
      try {
        const s = await upload({ result, dossier: project.dossier, ...(await liveOf(project)) });
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
    publishes.save(project.id, record);
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
