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
 *   GET    /api/projects/:id/live/stream/:device   watch a cloud browser live (MJPEG) while the test runs
 *   DELETE /api/projects/:id           delete a submitted project and its data   (organizer)
 *   POST   /api/uploads/video          upload a demo video file (raw body; MP4, MOV or WebM, max 300 MB)
 *   POST   /api/uploads/image          upload a demo screenshot (raw body; PNG, JPEG or WebP, max 10 MB)
 *   GET    /api/uploads/:file          play an uploaded video
 *   GET    /api/projects/:id/video     our saved copy of the demo video (+ /video/file to play it)
 *   GET    /api/projects/:id/arkiv     the result as published on Arkiv (read from Arkiv) + Swarm links
 *   POST   /api/projects/:id/arkiv     publish the latest result to Swarm + Arkiv again   (organizer)
 *   GET    /api/graph/...              knowledge graph: judge bias, similar projects, project explain (graph/routes.mjs)
 *
 *   0G Storage (every record above is also archived on 0G when ZG_STORAGE=1):
 *   GET    /api/storage                       wallet, balance, head root hash, outbox counts
 *   GET    /api/storage/status/:kind/:id      off | pending | stored | failed for one record
 *   GET    /api/storage/records               the manifest: kind, id, root hash, tx hash, explorer links
 *   GET    /api/storage/blob/:rootHash        one stored item, downloaded from 0G and checked (our root hashes only;
 *                                             ?fresh=1 skips the local cache, ?download=1 saves it as a file)
 *   POST   /api/storage/verify/:kind/:id      re-download from 0G and compare with the local record
 *   POST   /api/storage/flush                 retry failed uploads now   (organizer)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { CRITERIA } from "./judges/criteria.mjs";
import { MAX_JUDGES, validateForm } from "./judges/persona.mjs";
import { callPrimary, fallbackTarget, hasCredentials, missingCredentialsError, MODEL, PROVIDER, PROVIDER_LABEL, runPanel } from "./judges/review.mjs";
import { collectScreenshotEvidence, EVIDENCE_ENABLED, forJudges, hasCachedEvidence } from "./judges/evidence.mjs";
import zg from "./zg/client.js";
import zgModels from "./zg/models.js";
import { EXAMPLE_FORMS } from "./judges/seed.mjs";
import { loadProject } from "./projects.mjs";
import { DATA_DIR, deleteProject, dossiers, judges, liveDir, localValue, mediaDir, pipelines, reviews, startArchive, submissions, videos, voiceNotes, zgStatus } from "./store.mjs";
import * as archive from "./zg/archive.mjs";
import { downloadBytes, explorerLinks, storageConfig, walletInfo } from "./zg/storage.mjs";
import { cleanUploads, IMAGE_MAX, IMAGE_REF, MAX_IMAGES, MIME, storeImageUpload, storeUpload, UPLOAD_DIR, UPLOAD_FILE, UPLOAD_REF, VIDEO_MAX } from "./reviewer/media.mjs";
import { dequeue, enqueue, isRunning, queueLength, queuePosition, resumeQueue } from "./reviewer/pipeline.mjs";
import { checkSubmissionSignature, isOrganizer, isOrganizerWallet, rateLimit, requireOrganizer } from "./security.mjs";
import { events, submissionProblem, validateEvent } from "./events.mjs";
import { canRead, canWrite, explorerEntity, publisher, readLatest } from "./arkiv/arkiv.mjs";
import { lastPublish, publishInBackground, publishing, publishRun } from "./arkiv/publish.mjs";
import { syncJudgesInBackground, syncProjectInBackground } from "./arkiv/records/sync.mjs";
import { listRecords, readBlob, readRecord } from "./arkiv/records/store.mjs";
import { TYPES } from "./arkiv/records/schemas.mjs";
import { swarmConfigured } from "./arkiv/swarm.mjs";
import { arenaRouter } from "./arena/routes.mjs";
import { worldRouter } from "./world/routes.mjs";
import { graphRouter } from "./graph/routes.mjs";
import { payoutStatus, startPayouts } from "./payouts/index.mjs";
import { startAutorun } from "./arena/autorunService.mjs";

// Seed the example panel the first time only.
if (!judges.list().length) judges.save(EXAMPLE_FORMS.map((f) => ({ ...validateForm(f).persona, example: true })));
// Archive anything 0G doesn't have yet and resume uploads left by an earlier run (ZG_STORAGE=1 only).
startArchive();

const running = new Map(); // projectId -> Promise, so one project is never reviewed twice at once
// projectId -> { startedAt, events, error? }: what the UI shows while a run is going (0G request IDs as they arrive)
const progress = new Map();

/**
 * Run the panel on one project and save the result.
 * opts.evidence: first let a vision model on 0G read the live-test screenshots (default JUDGE_EVIDENCE).
 * opts.save: false to skip saving to data/reviews (the CLI uses this for side-by-side model runs).
 * opts.fallback: false to never fall back to OpenAI when 0G fails (public runs).
 */
export async function reviewNow(projectId, { evidence = EVIDENCE_ENABLED, freshEvidence = false, save = true, fallback = true, log, onEvent: hook } = {}) {
  if (running.has(projectId)) return running.get(projectId);
  const project = loadProject(projectId);
  if (!project) throw Object.assign(new Error("No such project."), { status: 404 });
  const event = events.get(submissions.get(projectId)?.eventId);
  const panel = event ? judges.list().filter((j) => event.judgeIds.includes(j.id)) : judges.list().slice(0, 3);
  // Whoever is on the panel judges: one, two or three seats filled all work. Only an empty panel can't.
  if (!panel.length) throw Object.assign(new Error("There are no judges on the panel yet. Add one on /judge."), { status: 409 });
  if (!hasCredentials()) throw missingCredentialsError();
  if (evidence && !hasCredentials("0g")) throw missingCredentialsError("0g");
  const prog = { startedAt: new Date().toISOString(), events: [] };
  progress.set(projectId, prog);
  const onEvent = (e) => {
    prog.events.push({ at: new Date().toISOString(), ...e });
    try {
      hook?.(e); // the pipeline ticks judges off as they finish
    } catch {
      /* a progress hook never breaks the review */
    }
  };
  const job = (async () => {
    if (evidence) {
      const records = await collectScreenshotEvidence(project, { fresh: freshEvidence, log });
      project.screenshotEvidenceRecords = records;
      project.screenshotEvidence = forJudges(records);
    }
    const result = await runPanel(panel, project, { onEvent, call: fallback ? undefined : callPrimary });
    // A run where no judge scored never replaces the last good result: the page keeps showing it.
    if (!result.reviews.some((r) => r.status === "scored")) {
      const why = [...new Set(result.reviews.map((r) => r.detail).filter(Boolean))].join(" ");
      throw Object.assign(new Error(`No judge could score this time (${why || "unknown error"}). The last result is still shown.`), { status: 502, result });
    }
    if (!save) return result;
    const saved = reviews.save(projectId, result);
    publishInBackground(project, saved); // Swarm + Arkiv, when set up; never fails the review
    syncProjectInBackground(projectId); // judge context (dossier, live test, screenshot notes) on Arkiv
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
router.use("/arena", arenaRouter);
router.use("/world", worldRouter);
router.use("/graph", graphRouter);

router.get("/payouts", async (req, res) => res.json(await payoutStatus()));

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
    fallback: fallbackTarget(),
    voiceNotes: hasCredentials("0g") ? { model: zgModels.MODELS.transcribe } : null,
    arkiv: { read: canRead(), write: canWrite(), swarm: swarmConfigured(), publisher: publisher() },
    storage: storageSummary(),
  });
});

router.get("/criteria", (req, res) => res.json(CRITERIA));

router.get("/judges", requireOrganizer, (req, res) => res.json(judges.list()));

router.post("/judges", requireOrganizer, (req, res) => {
  const all = judges.list();
  if (all.length >= MAX_JUDGES) return res.status(409).json({ error: `All ${MAX_JUDGES} seats are taken. Remove a judge first.` });
  const { persona, errors } = validateForm(req.body ?? {});
  if (errors) return res.status(400).json({ errors });
  judges.save([...all, persona]);
  syncJudgesInBackground();
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
    const out = {
      text: text.trim(),
      model: trace.model,
      requestId: trace.requestId,
      provider: trace.provider,
      costUsdMicro: trace.costUsdMicro,
      teeVerified: trace.teeVerified === true ? true : trace.teeVerified === false ? false : null,
    };
    // Keep the transcript and its 0G trace (archived on 0G Storage). The audio is only
    // uploaded AES-256 encrypted, and only when ZG_STORAGE_AES_KEY is set.
    const id = crypto.randomUUID();
    voiceNotes.save(
      id,
      { id, at: new Date().toISOString(), transcript: out.text, mime, audio: { sha256: crypto.createHash("sha256").update(req.body).digest("hex"), size: req.body.length }, trace: { model: out.model, requestId: out.requestId, provider: out.provider, costUsdMicro: out.costUsdMicro, teeVerified: out.teeVerified } },
      { audio: req.body, mime },
    );
    res.json({ ...out, id, zgStorage: zgStatus("voice-note", id) });
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
  syncJudgesInBackground();
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
  // Every step runs even when one fails: the review is done, with the failures shown.
  return { status: "reviewed", failed: p.steps.filter((x) => x.status === "failed").length };
}

/** Submissions as the public sees them: no signature material. */
const publicSubmission = ({ auth, ...rest }) => ({ ...rest, signed: Boolean(auth?.signature), review: reviewStatus(rest.id), hasDossier: Boolean(dossiers.get(rest.id)), video: publicVideo(rest.id) });

/** What the web app needs to play our copy of the demo video. */
function publicVideo(id) {
  const v = videos.get(id);
  if (!v) return null;
  if (v.error) return { saved: false, reason: v.error };
  return { saved: true, url: `/api/projects/${encodeURIComponent(id)}/video/file`, seconds: v.seconds, bytes: v.bytes, source: v.source };
}

/** A demo needs a video or at least one screenshot. Returns an error string or null. */
function checkDemo(body) {
  const imgs = body.demoImages ?? [];
  if (!Array.isArray(imgs) || imgs.length > MAX_IMAGES) return `Add up to ${MAX_IMAGES} screenshots.`;
  for (const ref of imgs) {
    const m = IMAGE_REF.exec(String(ref));
    if (!m || !fs.existsSync(path.join(UPLOAD_DIR, m[1]))) return "One of the screenshots isn't on the server any more. Upload it again.";
  }
  if (!body.demoVideoUrl) return imgs.length ? null : "Add a demo video or some screenshots.";
  return checkDemoVideo(body.demoVideoUrl);
}

/** Is this an acceptable demo video value? Returns an error string or null. */
function checkDemoVideo(v) {
  if (!v) return "Add a demo video.";
  if (String(v).startsWith("upload:")) {
    const m = UPLOAD_REF.exec(v);
    return m && fs.existsSync(path.join(UPLOAD_DIR, m[1])) ? null : "That uploaded video isn't on the server any more. Upload it again.";
  }
  try {
    return new URL(v).protocol === "https:" ? null : "The demo video link must start with https://.";
  } catch {
    return "The demo video link isn't a valid URL.";
  }
}

/** What everyone sees of a project. How the review went is for organizers. */
const participantView = ({ review, hasDossier, ...rest }) => rest;

router.get("/submissions", async (req, res) => {
  const organizer = await isOrganizer(req);
  const all = submissions.list().filter((s) => !req.query.eventId || s.eventId === req.query.eventId);
  res.json(all.map((s) => ({ ...publicSubmission(s), zgStorage: zgStatus("submission", s.id) })).map((s) => (organizer ? s : participantView(s))));
});

/** Which tabs a wallet sees. The real check happens on every organizer request. */
router.get("/organizer", async (req, res) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(req.query.wallet ?? ""))) return res.json({ isOrganizer: false });
  res.json({ isOrganizer: await isOrganizerWallet(req.query.wallet).catch(() => false) });
});

// Tournaments: anyone can read them, only an organizer can create one.
const publicEvent = ({ judgeIds, createdBy, ...rest }) => rest;
router.get("/events", (req, res) => res.json(events.list().map(publicEvent)));
router.get("/events/:id", (req, res) => {
  const event = events.get(req.params.id);
  return event ? res.json(publicEvent(event)) : res.status(404).json({ error: "No such tournament." });
});
/** Close submissions now: brackets are drawn as soon as reviews finish. */
router.post("/events/:id/close", requireOrganizer, (req, res) => {
  const event = events.get(req.params.id);
  if (!event) return res.status(404).json({ error: "No such tournament." });
  const minutes = Math.floor(Number(req.body?.bettingMinutes));
  const now = new Date().toISOString();
  const deadline = Date.parse(event.deadline) > Date.now() ? now : event.deadline;
  events.update(event.id, { deadline, ...(minutes >= 1 && minutes <= 1440 ? { bettingMinutes: minutes } : {}) });
  res.json(publicEvent(events.get(event.id)));
});

router.post("/events", requireOrganizer, (req, res) => {
  const { event, errors } = validateEvent(req.body, { existing: events.list(), judgeIds: judges.list().map((j) => j.id), createdBy: req.organizerWallet ?? null });
  if (errors) return res.status(400).json({ error: Object.values(errors)[0], errors });
  events.add(event);
  res.status(201).json(event);
});
router.get("/submissions/:id/storage", (req, res) => {
  if (!submissions.get(req.params.id)) return res.status(404).json({ error: "No such submission." });
  res.json(zgStatus("submission", req.params.id));
});

router.post("/submissions", rateLimit({ max: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const body = req.body ?? {};
  if (!body.project?.name || !body.repoUrl || !body.ownerWallet) return res.status(400).json({ error: "Missing project name, repo or owner wallet." });
  const entryError = submissionProblem(events.get(body.eventId), body.tracks);
  if (entryError) return res.status(400).json({ error: entryError });
  const videoError = checkDemo(body);
  if (videoError) return res.status(400).json({ error: videoError });
  const sigError = await checkSubmissionSignature(body, {
    seen: (sig) => submissions.list().some((s) => String(s.auth?.signature ?? "").toLowerCase() === sig),
  });
  if (sigError) return res.status(401).json({ error: sigError });
  const record = { ...body, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
  submissions.add(record);
  syncProjectInBackground(record.id);
  // Into the review queue: fetch, pin, count tests, build the dossier, then the judges score.
  enqueue(record.id, { judge: reviewNow });
  res.status(201).json({ ...publicSubmission(record), zgStorage: zgStatus("submission", record.id) });
});

router.get("/projects/:id/pipeline", requireOrganizer, (req, res) => {
  res.json({ running: isRunning(req.params.id), review: reviewStatus(req.params.id), queueLength: queueLength(), state: pipelines.get(req.params.id) });
});

router.get("/projects/:id/dossier", requireOrganizer, (req, res) => res.json({ dossier: dossiers.get(req.params.id) }));

/** Live test results for a submitted project; media under /live/files/... */
/*
 * The judged result as published on Arkiv, read back from Arkiv itself (not from
 * the local store), with links to the evidence bundle on Swarm.
 */
router.get("/projects/:id/arkiv", requireOrganizer, async (req, res) => {
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

/*
 * Any arena record, read from Arkiv (not the local store).
 *   GET /api/arkiv/:type?projectId=...        newest versions, columns only
 *   GET /api/arkiv/:type/latest?projectId=... the newest one with its full payload
 * Query parameters filter on the type's indexed columns (identity columns for /latest).
 */
const ARKIV_FILTERS = new Set(["projectId", "projectName", "judgeId", "tournamentId", "match", "projectA", "projectB", "status", "kind", "winner", "track"]);
const arkivFilters = (q) => Object.fromEntries(Object.entries(q).filter(([k, v]) => ARKIV_FILTERS.has(k) && typeof v === "string" && v).map(([k, v]) => [k, k === "match" ? Number(v) : v]));
router.get("/arkiv/:type", async (req, res) => {
  if (!TYPES.includes(req.params.type)) return res.status(404).json({ error: `Unknown record type. One of: ${TYPES.join(", ")}.` });
  if (!canRead()) return res.status(503).json({ error: "Arkiv is not set up on this server." });
  try {
    res.json(await listRecords(req.params.type, arkivFilters(req.query)));
  } catch (e) {
    res.status(502).json({ error: `Arkiv read failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}` });
  }
});
/**
 * A file's bytes read back from Arkiv (reassembled from its parts, checked against
 * its sha256): GET /api/arkiv-file?projectId=...&name=live/laptop/video.mp4
 * List a project's files with GET /api/arkiv/file?projectId=...
 */
router.get("/arkiv-file", async (req, res) => {
  const { projectId, name } = req.query;
  if (typeof projectId !== "string" || typeof name !== "string" || !/^[\w./-]{1,128}$/.test(name) || name.includes("..")) return res.status(400).json({ error: "Give projectId and a file name." });
  if (!canRead()) return res.status(503).json({ error: "Arkiv is not set up on this server." });
  try {
    const f = await readBlob("file", { projectId, name });
    if (!f) return res.status(404).json({ error: "That file isn't on Arkiv (yet)." });
    res.set({ "content-type": f.mime || "application/octet-stream", "content-length": String(f.buffer.length), "x-content-type-options": "nosniff", "content-disposition": "inline", "x-arkiv-sha256": f.hash, "cache-control": "public, max-age=3600" });
    res.end(f.buffer);
  } catch (e) {
    res.status(502).json({ error: `Arkiv read failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}` });
  }
});

router.get("/arkiv/:type/latest", async (req, res) => {
  if (!TYPES.includes(req.params.type)) return res.status(404).json({ error: `Unknown record type. One of: ${TYPES.join(", ")}.` });
  if (req.params.type === "file") return res.status(400).json({ error: "Files are binary: read one with /api/arkiv-file?projectId=...&name=..." });
  if (!canRead()) return res.status(503).json({ error: "Arkiv is not set up on this server." });
  try {
    const r = await readRecord(req.params.type, arkivFilters(req.query));
    if (!r) return res.status(404).json({ error: "Nothing published on Arkiv for that yet." });
    res.json({ ...r, explorer: explorerEntity(r.$key) });
  } catch (e) {
    res.status(502).json({ error: `Arkiv read failed: ${String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)}` });
  }
});

/** Publish the latest saved review again (organizer). */
router.post("/projects/:id/arkiv", requireOrganizer, async (req, res) => {
  const project = loadProject(req.params.id);
  const result = reviews.get(req.params.id);
  if (!project || !result) return res.status(404).json({ error: "No judged result to publish." });
  if (!canWrite()) return res.status(503).json({ error: "Arkiv is not set up: set ARKIV_PRIVATE_KEY or PUBLISHER_PRIVATE_KEY in backend/.env." });
  res.json(await publishRun(project, result));
});

router.get("/projects/:id/live", requireOrganizer, (req, res) => {
  try {
    res.json({ liveTest: JSON.parse(fs.readFileSync(path.join(liveDir(req.params.id), "smoke.json"), "utf8")) });
  } catch {
    res.json({ liveTest: null });
  }
});

/**
 * Watch a cloud browser while the live test runs: an MJPEG stream of its newest
 * screen frame (an <img> plays it). Ends when the run stops writing frames.
 */
router.get("/projects/:id/live/stream/:device", (req, res) => {
  const { device } = req.params;
  if (!/^(laptop|phone)$/.test(device)) return res.status(404).end();
  const file = path.join(liveDir(req.params.id), device, "live.jpg");
  const B = "arenaframe";
  res.writeHead(200, {
    "content-type": `multipart/x-mixed-replace; boundary=${B}`,
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    connection: "close",
    "x-content-type-options": "nosniff",
  });
  let last = 0;
  let idleSince = Date.now();
  const started = Date.now();
  const send = () => {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      st = null;
    }
    if (st && st.mtimeMs !== last) {
      last = st.mtimeMs;
      idleSince = Date.now();
      let jpg;
      try {
        jpg = fs.readFileSync(file);
      } catch {
        return;
      }
      res.write(`--${B}\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpg.length}\r\n\r\n`);
      res.write(jpg);
      res.write("\r\n");
    }
    // No new frame for 30 s (run finished or not started), or 20 min overall: stop.
    if (Date.now() - idleSince > 30000 || Date.now() - started > 20 * 60 * 1000) stop();
  };
  const timer = setInterval(send, 200);
  const stop = () => {
    clearInterval(timer);
    res.end();
  };
  req.on("close", () => clearInterval(timer));
  send();
});

/** Is a device being watched right now? (a fresh live frame exists) */
router.get("/projects/:id/live/now", (req, res) => {
  const out = {};
  for (const d of ["laptop", "phone"]) {
    try {
      out[d] = Date.now() - fs.statSync(path.join(liveDir(req.params.id), d, "live.jpg")).mtimeMs < 15000;
    } catch {
      out[d] = false;
    }
  }
  res.json(out);
});

router.get("/projects/:id/live/files/:device/:file", (req, res) => {
  const { device, file } = req.params;
  if (!/^(laptop|phone)$/.test(device) || !/^(video\.mp4|smoke-(laptop|phone)-[a-z0-9]+\.jpg)$/.test(file)) return res.status(404).end();
  const full = path.join(liveDir(req.params.id), device, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full, { headers: { "cache-control": "private, max-age=3600" } });
});

/* ---- Demo videos ---- */

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "application/octet-stream"]);

/** Upload a demo video before signing: the returned ref goes into the signed submission. */
router.post("/uploads/video", rateLimit({ max: 10, windowMs: 60 * 60 * 1000, message: "Too many uploads from here. Try again later." }), async (req, res) => {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!VIDEO_TYPES.has(type)) return res.status(415).json({ error: "Upload an MP4, MOV or WebM video." });
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > VIDEO_MAX) return res.status(413).json({ error: `That video is over ${Math.round(VIDEO_MAX / 1048576)} MB.` });
  try {
    const up = await storeUpload(req, { declaredBytes: declared });
    res.status(201).json({ ref: `upload:${up.file}`, url: `/api/uploads/${up.file}`, bytes: up.bytes, seconds: up.seconds });
  } catch (e) {
    if (!res.headersSent) res.status(e.status ?? 500).json({ error: e.status ? e.message : "The upload failed. Try again." });
    req.resume();
  }
});

router.post("/uploads/image", rateLimit({ max: 60, windowMs: 60 * 60 * 1000, message: "Too many uploads from here. Try again later." }), async (req, res) => {
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp", "application/octet-stream"].includes(type)) return res.status(415).json({ error: "Upload a PNG, JPEG or WebP image." });
  if (Number(req.headers["content-length"] ?? 0) > IMAGE_MAX) return res.status(413).json({ error: "That image is over 10 MB." });
  try {
    const up = await storeImageUpload(req);
    res.status(201).json({ ref: `upload:${up.file}`, url: `/api/uploads/${up.file}`, bytes: up.bytes });
  } catch (e) {
    if (!res.headersSent) res.status(e.status ?? 500).json({ error: e.status ? e.message : "The upload failed. Try again." });
    req.resume();
  }
});

const sendVideo = (res, full, ext) =>
  res.sendFile(full, { headers: { "content-type": MIME[ext], "x-content-type-options": "nosniff", "content-disposition": "inline", "cache-control": "private, max-age=3600" } });

router.get("/uploads/:file", (req, res) => {
  const { file } = req.params;
  if (!UPLOAD_FILE.test(file)) return res.status(404).end();
  const full = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  sendVideo(res, full, path.extname(file).slice(1));
});

router.get("/projects/:id/video", (req, res) => res.json({ video: publicVideo(req.params.id) }));

router.get("/projects/:id/video/file", (req, res) => {
  const v = videos.get(req.params.id);
  if (!v || v.error || !MIME[v.ext]) return res.status(404).end();
  const full = path.join(mediaDir(req.params.id), `demo.${v.ext}`);
  if (!fs.existsSync(full)) return res.status(404).end();
  sendVideo(res, full, v.ext);
});

// Uploads nobody submitted are removed after a day.
const referencedUploads = () =>
  new Set(
    submissions
      .list()
      .flatMap((s) => [UPLOAD_REF.exec(s.demoVideoUrl ?? "")?.[1], ...(s.demoImages ?? []).map((r) => IMAGE_REF.exec(String(r))?.[1])])
      .filter(Boolean),
  );
if (process.env.ARENA_SERVER === "1") {
  const sweep = () => {
    try {
      cleanUploads(referencedUploads());
    } catch (e) {
      console.warn("[uploads] clean-up failed:", e.message);
    }
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}

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

router.get("/projects/:id/reviews", requireOrganizer, (req, res) => {
  const id = req.params.id;
  const r = reviews.get(id);
  // Keep the panel polling while the pipeline prepares evidence or waits in line.
  res.json({ running: running.has(id) || isRunning(id) || queuePosition(id) != null, progress: progress.get(id) ?? null, result: r, zgStorage: r ? zgStatus("review", id) : null });
});

router.post("/projects/:id/reviews", requireOrganizer, async (req, res) => {
  try {
    res.json({ running: false, result: await reviewNow(req.params.id), zgStorage: zgStatus("review", req.params.id) });
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// ---------- 0G Storage ----------

function storageSummary() {
  const cfg = storageConfig();
  const head = archive.loadHead();
  return {
    enabled: cfg.enabled,
    network: cfg.network,
    chainId: cfg.chainId,
    head: head ? { rootHash: head.rootHash, txHash: head.txHash, uploadedAt: head.uploadedAt, links: explorerLinks(head, cfg.network) } : null,
    records: Object.keys(archive.loadManifest().records).length,
    outbox: archive.counts(),
    encryption: cfg.hasAesKey,
  };
}

router.get("/storage", async (req, res) => {
  const summary = storageSummary();
  const wallet = summary.enabled ? await walletInfo() : null;
  res.json({ ...summary, wallet });
});

router.get("/storage/status/:kind/:id", (req, res) => {
  if (!/^[a-z-]{2,20}$/.test(req.params.kind) || req.params.id.length > 200) return res.status(400).json({ error: "Bad record name." });
  res.json(zgStatus(req.params.kind, req.params.id));
});

router.get("/storage/records", (req, res) => {
  const m = archive.loadManifest();
  const net = storageConfig().network;
  res.json({
    network: m.network ?? net,
    updatedAt: m.updatedAt,
    head: archive.loadHead(),
    records: Object.entries(m.records).map(([key, r]) => ({ key, ...r, links: explorerLinks(r, net) })),
  });
});

const ROOT_RE = /^0x[0-9a-fA-F]{64}$/;
const CACHE_DIR = path.join(DATA_DIR, "zg-cache");
const EXT_TYPES = { json: "application/json", md: "text/markdown; charset=utf-8", html: "text/plain; charset=utf-8", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", vtt: "text/vtt", txt: "text/plain; charset=utf-8" };
function contentTypeOf(rec) {
  if (!rec?.file) return "application/json";
  if (rec.encrypted) return "application/octet-stream";
  if (rec.contentType) return rec.contentType;
  return EXT_TYPES[String(rec.id).split(".").pop().toLowerCase()] ?? "application/octet-stream";
}

/* Serve one stored item. Only root hashes in our manifest, so this is not an open proxy to 0G. */
router.get("/storage/blob/:rootHash", rateLimit({ max: 60, windowMs: 60 * 1000, message: "Too many downloads. Try again in a minute." }), async (req, res) => {
  const root = req.params.rootHash.toLowerCase();
  if (!ROOT_RE.test(root)) return res.status(404).json({ error: "Not a 0G root hash." });
  const rec = archive.isKnownRoot(root);
  if (!rec) return res.status(404).json({ error: "That root hash isn't one of this arena's records." });
  const cached = path.join(CACHE_DIR, root);
  try {
    let bytes;
    // ?fresh=1 skips our cache so the bytes really come from 0G storage nodes this time.
    if (fs.existsSync(cached) && req.query.fresh !== "1") bytes = fs.readFileSync(cached);
    else {
      // The Merkle root of what we downloaded must equal the requested one (checked inside downloadBytes).
      bytes = Buffer.from(await downloadBytes(root));
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(`${cached}.tmp`, bytes);
      fs.renameSync(`${cached}.tmp`, cached);
    }
    res.set("content-type", contentTypeOf(rec));
    res.set("x-0g-root-hash", root);
    if (req.query.download === "1") {
      const base = rec.kind === "manifest" ? "manifest-head" : `${rec.kind}-${String(rec.id).split("/").pop()}`;
      const name = `${base.replace(/[^a-zA-Z0-9._-]/g, "_")}${rec.file ? (rec.encrypted ? ".enc" : "") : ".json"}`;
      res.set("content-disposition", `attachment; filename="${name}"`);
    }
    res.set("cache-control", "public, max-age=31536000, immutable");
    res.send(bytes);
  } catch (e) {
    res.status(e.code === "not_found" ? 404 : 502).json({ error: `0G Storage: ${e.message}`, code: e.code ?? null });
  }
});

const FIXTURES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../fixtures");
/** The local copy of an archived fixture file, for verify (never outside fixtures/). */
function fixtureBytes(kind, id) {
  if (kind !== "fixture-file") return undefined;
  const full = path.resolve(FIXTURES_DIR, id);
  if (!full.startsWith(FIXTURES_DIR + path.sep) || !fs.existsSync(full)) return undefined;
  return fs.readFileSync(full);
}

/* Anyone can check a record against its 0G copy. */
router.post("/storage/verify/:kind/:id", rateLimit({ max: 20, windowMs: 60 * 1000, message: "Too many checks. Try again in a minute." }), async (req, res) => {
  const { kind, id } = req.params;
  if (!/^[a-z-]{2,20}$/.test(kind) || String(id).length > 200) return res.status(400).json({ error: "Bad record name." });
  try {
    res.json(await archive.verifyRecord(kind, id, localValue(kind, id), { localBytes: fixtureBytes(kind, id) }));
  } catch (e) {
    res.status(e.code === "not_found" ? 404 : 502).json({ error: e.message, code: e.code ?? null });
  }
});

router.post("/storage/flush", requireOrganizer, (req, res) => res.json(archive.flush()));
// Server start: anything submitted but not finished goes back in line.
if (process.env.ARENA_SERVER === "1") {
  const n = resumeQueue({ judge: reviewNow });
  if (n) console.log(`[pipeline] resumed ${n} unfinished review(s)`);
  startPayouts();
  startAutorun();
}
