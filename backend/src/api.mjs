/*
 * /api routes for judges, submissions and reviews.
 *
 *   GET    /api/health                 judge service status (credentials, judge count)
 *   GET    /api/criteria               what judges score
 *   GET    /api/judges                 the panel (max 3)
 *   POST   /api/judges                 add a judge from the form   (organizer)
 *   POST   /api/judges/voice-note      audio -> transcript (whisper on 0G, TEE-checked)   (organizer)
 *   PUT    /api/judges/:id             edit a judge (new persona version)   (organizer)
 *   DELETE /api/judges/:id             remove a judge   (organizer)
 *   GET    /api/submissions            submitted projects
 *   POST   /api/submissions            save a signed submission; the panel reviews it in the background
 *   GET    /api/projects/:id/reviews   latest panel review
 *   POST   /api/projects/:id/reviews   run the panel now   (organizer)
 *   GET    /api/projects/:id/pipeline  live status: fetch, pin, tests, dossier, judges
 *   POST   /api/projects/:id/pipeline  run the whole review again   (organizer)
 *   GET    /api/projects/:id/dossier   the reviewer's dossier for a submitted project
 *   GET    /api/projects/:id/live      live test results (+ /live/files/<device>/<file> for media)
 *   DELETE /api/projects/:id           delete a submitted project and its data   (organizer)
 *   GET    /api/projects/:id/arkiv     the result as published on Arkiv (read from Arkiv) + Swarm links
 *   POST   /api/projects/:id/arkiv     publish the latest result to Swarm + Arkiv again   (organizer)
 *   POST   /api/projects/:id/reviews/public   anyone: re-judge a sample project on 0G (rate limited, capped per day)
 */
import crypto from "node:crypto";
import express from "express";
import { CRITERIA } from "./judges/criteria.mjs";
import { MAX_JUDGES, validateForm } from "./judges/persona.mjs";
import { hasCredentials, missingCredentialsError, MODEL, PROVIDER, PROVIDER_LABEL, runPanel } from "./judges/review.mjs";
import { collectScreenshotEvidence, EVIDENCE_ENABLED, forJudges, hasCachedEvidence } from "./judges/evidence.mjs";
import zg from "./zg/client.js";
import zgModels from "./zg/models.js";
import { EXAMPLE_FORMS } from "./judges/seed.mjs";
import { loadProject } from "./projects.mjs";
import fs from "node:fs";
import path from "node:path";
import { deleteProject, dossiers, judges, liveDir, pipelines, reviews, submissions } from "./store.mjs";
import { dequeue, enqueue, isRunning, queueLength, queuePosition, resumeQueue } from "./reviewer/pipeline.mjs";
import { checkSubmissionSignature, rateLimit, requireOrganizer } from "./security.mjs";
import { canRead, canWrite, publisher, readLatest } from "./arkiv/arkiv.mjs";
import { lastPublish, publishInBackground, publishing, publishRun } from "./arkiv/publish.mjs";
import { swarmConfigured } from "./arkiv/swarm.mjs";

// Seed the example panel the first time only.
if (!judges.list().length) judges.save(EXAMPLE_FORMS.map((f) => ({ ...validateForm(f).persona, example: true })));

const running = new Map(); // projectId -> Promise, so one project is never reviewed twice at once
// projectId -> { startedAt, events, error? }: what the UI shows while a run is going (0G request IDs as they arrive)
const progress = new Map();
const lastRun = new Map(); // projectId -> ms timestamp of the last public run

/**
 * Run the panel on one project and save the result.
 * opts.evidence: first let a vision model on 0G read the live-test screenshots (default JUDGE_EVIDENCE).
 * opts.save: false to skip saving to data/reviews (the CLI uses this for side-by-side model runs).
 */
export async function reviewNow(projectId, { evidence = EVIDENCE_ENABLED, freshEvidence = false, save = true, log } = {}) {
  if (running.has(projectId)) return running.get(projectId);
  const project = loadProject(projectId);
  if (!project) throw Object.assign(new Error("No such project."), { status: 404 });
  const panel = judges.list();
  if (panel.length !== MAX_JUDGES) throw Object.assign(new Error(`The panel needs ${MAX_JUDGES} judges; it has ${panel.length}.`), { status: 409 });
  if (!hasCredentials()) throw missingCredentialsError();
  if (evidence && !hasCredentials("0g")) throw missingCredentialsError("0g");
  const prog = { startedAt: new Date().toISOString(), events: [] };
  progress.set(projectId, prog);
  const onEvent = (e) => prog.events.push({ at: new Date().toISOString(), ...e });
  const job = (async () => {
    if (evidence) {
      const records = await collectScreenshotEvidence(project, { fresh: freshEvidence, log });
      project.screenshotEvidenceRecords = records;
      project.screenshotEvidence = forJudges(records);
    }
    const result = await runPanel(panel, project, { onEvent });
    // A run where no judge scored never replaces the last good result: the page keeps showing it.
    if (!result.reviews.some((r) => r.status === "scored")) {
      const why = [...new Set(result.reviews.map((r) => r.detail).filter(Boolean))].join(" ");
      throw Object.assign(new Error(`No judge could score this time (${why || "unknown error"}). The last result is still shown.`), { status: 502, result });
    }
    if (!save) return result;
    const saved = reviews.save(projectId, result);
    publishInBackground(project, saved); // Swarm + Arkiv, when set up; never fails the review
    return saved;
  })()
    .catch((e) => {
      prog.error = e.message;
      throw e;
    })
    .finally(() => {
      running.delete(projectId);
      prog.finishedAt = new Date().toISOString();
    });
  running.set(projectId, job);
  return job;
}

export const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    judgesReady: hasCredentials(),
    judges: judges.list().length,
    maxJudges: MAX_JUDGES,
    provider: PROVIDER,
    providerLabel: PROVIDER_LABEL[PROVIDER],
    keyName: PROVIDER === "0g" ? "ZG_API_KEY" : PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
    model: MODEL,
    voiceNotes: hasCredentials("0g") ? { model: zgModels.MODELS.transcribe } : null,
    arkiv: { read: canRead(), write: canWrite(), swarm: swarmConfigured(), publisher: publisher() },
  });
});

router.get("/criteria", (req, res) => res.json(CRITERIA));

router.get("/judges", (req, res) => res.json(judges.list()));

router.post("/judges", requireOrganizer, (req, res) => {
  const all = judges.list();
  if (all.length >= MAX_JUDGES) return res.status(409).json({ error: `All ${MAX_JUDGES} seats are taken. Remove a judge first.` });
  const { persona, errors } = validateForm(req.body ?? {});
  if (errors) return res.status(400).json({ errors });
  judges.save([...all, persona]);
  res.status(201).json(persona);
});

/*
 * Voice note for the persona form: the browser sends the raw recording or upload,
 * whisper on 0G transcribes it, and the form puts the text into a free-text field.
 * We ask 0G to check the provider's TEE signature (?verify_tee=true) and pass on
 * exactly what it reports: teeVerified is true, false, or null (not reported).
 */
const AUDIO_EXT = { "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac" };
const audioBody = express.raw({ type: (req) => /^(audio|video)\//.test(req.headers["content-type"] ?? ""), limit: "20mb" });

router.post("/judges/voice-note", requireOrganizer, rateLimit({ max: 30, windowMs: 60 * 60 * 1000 }), audioBody, async (req, res) => {
  if (!hasCredentials("0g")) return res.status(503).json({ error: missingCredentialsError("0g").message });
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const ext = AUDIO_EXT[mime];
  if (!ext) return res.status(415).json({ error: "Send audio as webm, ogg, m4a, mp3, wav or flac." });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "That recording is empty or too short." });
  try {
    const { text, trace } = await zg.transcribe({ audio: req.body, filename: `voice-note.${ext}`, mime, model: zgModels.MODELS.transcribe, verifyTee: true });
    res.json({
      text: text.trim(),
      model: trace.model,
      requestId: trace.requestId,
      provider: trace.provider,
      costUsdMicro: trace.costUsdMicro,
      teeVerified: trace.teeVerified === true ? true : trace.teeVerified === false ? false : null,
    });
  } catch (e) {
    const status = e.status === 402 ? 402 : e.code === "missing_api_key" ? 503 : 502;
    const error = e.status === 402 ? "0G balance empty: top up the account behind ZG_API_KEY, then try again." : `Transcription on 0G failed: ${e.message}`;
    res.status(status).json({ error, requestId: e.requestId ?? null });
  }
});

router.put("/judges/:id", requireOrganizer, (req, res) => {
  const all = judges.list();
  const existing = all.find((j) => j.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "No such judge." });
  const { persona, errors } = validateForm(req.body ?? {}, { existing });
  if (errors) return res.status(400).json({ errors });
  judges.save(all.map((j) => (j.id === existing.id ? persona : j)));
  res.json(persona);
});

router.delete("/judges/:id", requireOrganizer, (req, res) => {
  const all = judges.list();
  if (!all.some((j) => j.id === req.params.id)) return res.status(404).json({ error: "No such judge." });
  judges.save(all.filter((j) => j.id !== req.params.id));
  res.status(204).end();
});

/** Where a project's review stands: queued (with place in line), reviewing, reviewed, stopped. */
function reviewStatus(id) {
  const position = queuePosition(id);
  if (position) return { status: "queued", position, ahead: position - 1 };
  if (isRunning(id)) return { status: "reviewing" };
  const p = pipelines.get(id);
  if (!p) return { status: "not_started" };
  // Started but not finished and not in this server's line: running elsewhere (e.g. the CLI).
  if (!p.finishedAt) return p.startedAt ? { status: "reviewing" } : { status: "queued", position: null };
  return { status: p.steps.some((x) => x.status === "failed") ? "stopped" : "reviewed" };
}

/** Submissions as the public sees them: no signature material. */
const publicSubmission = ({ auth, ...rest }) => ({ ...rest, signed: Boolean(auth?.signature), review: reviewStatus(rest.id) });

router.get("/submissions", (req, res) => res.json(submissions.list().map(publicSubmission)));

router.post("/submissions", rateLimit({ max: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const body = req.body ?? {};
  if (!body.project?.name || !body.repoUrl || !body.ownerWallet) return res.status(400).json({ error: "Missing project name, repo or owner wallet." });
  const sigError = await checkSubmissionSignature(body, {
    seen: (sig) => submissions.list().some((s) => String(s.auth?.signature ?? "").toLowerCase() === sig),
  });
  if (sigError) return res.status(401).json({ error: sigError });
  const record = { ...body, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
  submissions.add(record);
  // Into the review queue: fetch, pin, count tests, build the dossier, then the judges score.
  enqueue(record.id, { judge: reviewNow });
  res.status(201).json(publicSubmission(record));
});

router.get("/projects/:id/pipeline", (req, res) => {
  res.json({ running: isRunning(req.params.id), review: reviewStatus(req.params.id), queueLength: queueLength(), state: pipelines.get(req.params.id) });
});

router.get("/projects/:id/dossier", (req, res) => res.json({ dossier: dossiers.get(req.params.id) }));

/** Live test results for a submitted project; media under /live/files/... */
/*
 * The judged result as published on Arkiv, read back from Arkiv itself (not from
 * the local store), with links to the evidence bundle on Swarm.
 */
router.get("/projects/:id/arkiv", async (req, res) => {
  const id = req.params.id;
  const last = lastPublish(id);
  const out = { configured: { read: canRead(), write: canWrite(), swarm: swarmConfigured() }, publishing: publishing.has(id), last, onchain: null };
  if (!canRead()) return res.json(out);
  try {
    out.onchain = await readLatest(id);
    // Only link the files this bundle really holds (a project may have no dossier or videos).
    const s = out.onchain?.swarm;
    const files = s && last?.swarm?.reference === s.reference ? last.swarm.files : null;
    if (s && files) {
      const has = { dossier: "dossier.json", liveTest: "live/smoke.json", laptopVideo: "live/laptop/video.mp4", phoneVideo: "live/phone/video.mp4" };
      for (const [k, f] of Object.entries(has)) if (!files.includes(f)) delete s[k];
    }
  } catch (e) {
    out.error = `Arkiv read failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}`;
  }
  res.json(out);
});

/** Publish the latest saved review again (organizer). */
router.post("/projects/:id/arkiv", requireOrganizer, async (req, res) => {
  const project = loadProject(req.params.id);
  const result = reviews.get(req.params.id);
  if (!project || !result) return res.status(404).json({ error: "No judged result to publish." });
  if (!canWrite()) return res.status(503).json({ error: "Arkiv is not set up: set ARKIV_PRIVATE_KEY or PUBLISHER_PRIVATE_KEY in backend/.env." });
  res.json(await publishRun(project, result));
});

router.get("/projects/:id/live", (req, res) => {
  try {
    res.json({ liveTest: JSON.parse(fs.readFileSync(path.join(liveDir(req.params.id), "smoke.json"), "utf8")) });
  } catch {
    res.json({ liveTest: null });
  }
});

router.get("/projects/:id/live/files/:device/:file", (req, res) => {
  const { device, file } = req.params;
  if (!/^(laptop|phone)$/.test(device) || !/^(video\.mp4|smoke-(laptop|phone)-[a-z0-9]+\.jpg)$/.test(file)) return res.status(404).end();
  const full = path.join(liveDir(req.params.id), device, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full, { headers: { "cache-control": "private, max-age=3600" } });
});

/** Delete a submitted project and everything stored for it. */
router.delete("/projects/:id", requireOrganizer, (req, res) => {
  const id = req.params.id;
  if (!submissions.get(id)) return res.status(404).json({ error: "No such submitted project." });
  if (isRunning(id)) return res.status(409).json({ error: "Its review is running right now. Try again when it finishes." });
  dequeue(id);
  deleteProject(id);
  res.status(204).end();
});

router.post("/projects/:id/pipeline", requireOrganizer, (req, res) => {
  if (!submissions.get(req.params.id)) return res.status(404).json({ error: "No such submitted project." });
  enqueue(req.params.id, { judge: reviewNow });
  res.status(202).json({ review: reviewStatus(req.params.id), state: pipelines.get(req.params.id) });
});

router.get("/projects/:id/reviews", (req, res) => {
  const id = req.params.id;
  const r = reviews.get(id);
  // Keep the panel polling while the pipeline prepares evidence or waits in line.
  res.json({ running: running.has(id) || isRunning(id) || queuePosition(id) != null, progress: progress.get(id) ?? null, result: r });
});

/*
 * Public "watch the judges score this" for sample projects, so anyone trying the app
 * can start real 0G inference and see the request IDs arrive. Guarded three ways,
 * because each run is paid: 0G provider only, 2 runs per IP per hour, a 10-minute
 * cooldown per project, and PUBLIC_RUNS_PER_DAY in total (default 40, ~$0.30 on 0gm).
 */
const PUBLIC_COOLDOWN_MS = 10 * 60 * 1000;
const publicDay = { day: "", n: 0 };
router.post(
  "/projects/:id/reviews/public",
  rateLimit({ max: 2, windowMs: 60 * 60 * 1000, message: "You've asked the judges twice this hour. Try again later." }),
  (req, res) => {
    const id = req.params.id;
    const project = loadProject(id);
    if (!project || project.kind !== "sample") return res.status(404).json({ error: "Only sample projects can be re-judged from here." });
    if (PROVIDER !== "0g") return res.status(409).json({ error: "Public judging runs on 0G only." });
    if (!hasCredentials()) return res.status(503).json({ error: missingCredentialsError().message });
    if (running.has(id)) return res.status(202).json({ running: true, progress: progress.get(id) ?? null });
    const since = Date.now() - (lastRun.get(id) ?? 0);
    if (since < PUBLIC_COOLDOWN_MS) {
      return res.status(429).json({ error: `The judges scored this ${Math.max(1, Math.round(since / 60000))} min ago. Try again in ${Math.ceil((PUBLIC_COOLDOWN_MS - since) / 60000)} min.` });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (publicDay.day !== today) Object.assign(publicDay, { day: today, n: 0 });
    if (publicDay.n >= Number(process.env.PUBLIC_RUNS_PER_DAY || 40)) return res.status(429).json({ error: "Today's free judge runs are used up. Come back tomorrow." });
    publicDay.n++;
    lastRun.set(id, Date.now());
    // Reuse screenshot observations already read on 0G (free); never pay for new ones from a public click.
    reviewNow(id, { evidence: EVIDENCE_ENABLED || hasCachedEvidence(project) }).catch((e) => console.error(`[judges] public review of ${id} failed: ${e.message}`));
    res.status(202).json({ running: true, progress: progress.get(id) ?? null });
  },
);

router.post("/projects/:id/reviews", requireOrganizer, async (req, res) => {
  try {
    res.json({ running: false, result: await reviewNow(req.params.id) });
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// Server start: anything submitted but not finished goes back in line.
if (process.env.ARENA_SERVER === "1") {
  const n = resumeQueue({ judge: reviewNow });
  if (n) console.log(`[pipeline] resumed ${n} unfinished review(s)`);
}
