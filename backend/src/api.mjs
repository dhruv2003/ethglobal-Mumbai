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
 *   POST   /api/projects/:id/reviews/public   anyone: re-judge a sample project on 0G (rate limited, capped per day)
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
import { hasCredentials, missingCredentialsError, MODEL, PROVIDER, PROVIDER_LABEL, runPanel } from "./judges/review.mjs";
import { collectScreenshotEvidence, EVIDENCE_ENABLED, forJudges, hasCachedEvidence } from "./judges/evidence.mjs";
import zg from "./zg/client.js";
import zgModels from "./zg/models.js";
import { EXAMPLE_FORMS } from "./judges/seed.mjs";
import { loadProject } from "./projects.mjs";
import { DATA_DIR, judges, localValue, reviews, startArchive, submissions, voiceNotes, zgStatus } from "./store.mjs";
import * as archive from "./zg/archive.mjs";
import { downloadBytes, explorerLinks, storageConfig, walletInfo } from "./zg/storage.mjs";
import { checkSubmissionSignature, rateLimit, requireOrganizer } from "./security.mjs";

// Seed the example panel the first time only.
if (!judges.list().length) judges.save(EXAMPLE_FORMS.map((f) => ({ ...validateForm(f).persona, example: true })));
// Archive anything 0G doesn't have yet and resume uploads left by an earlier run (ZG_STORAGE=1 only).
startArchive();

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
    return save ? reviews.save(projectId, result) : result;
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
    storage: storageSummary(),
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
  res.json(persona);
});

router.delete("/judges/:id", requireOrganizer, (req, res) => {
  const all = judges.list();
  if (!all.some((j) => j.id === req.params.id)) return res.status(404).json({ error: "No such judge." });
  judges.save(all.filter((j) => j.id !== req.params.id));
  res.status(204).end();
});

/** Submissions as the public sees them: no signature material. */
const publicSubmission = ({ auth, ...rest }) => ({ ...rest, signed: Boolean(auth?.signature) });

router.get("/submissions", (req, res) => res.json(submissions.list().map((s) => ({ ...publicSubmission(s), zgStorage: zgStatus("submission", s.id) }))));
router.get("/submissions/:id/storage", (req, res) => {
  if (!submissions.get(req.params.id)) return res.status(404).json({ error: "No such submission." });
  res.json(zgStatus("submission", req.params.id));
});

router.post("/submissions", rateLimit({ max: 5, windowMs: 60 * 60 * 1000 }), async (req, res) => {
  const body = req.body ?? {};
  if (!body.project?.name || !body.repoUrl || !body.ownerWallet) return res.status(400).json({ error: "Missing project name, repo or owner wallet." });
  const sigError = await checkSubmissionSignature(body, {
    seen: (sig) => submissions.list().some((s) => String(s.auth?.signature ?? "").toLowerCase() === sig),
  });
  if (sigError) return res.status(401).json({ error: sigError });
  const record = { ...body, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
  submissions.add(record);
  // The panel reviews every new submission in the background when it can.
  let review = "skipped";
  if (hasCredentials() && judges.list().length === MAX_JUDGES) {
    review = "started";
    reviewNow(record.id).catch((e) => console.error(`[judges] review of ${record.id} failed: ${e.message}`));
  }
  res.status(201).json({ ...publicSubmission(record), review, zgStorage: zgStatus("submission", record.id) });
});

router.get("/projects/:id/reviews", (req, res) => {
  const r = reviews.get(req.params.id);
  res.json({ running: running.has(req.params.id), progress: progress.get(req.params.id) ?? null, result: r, zgStorage: r ? zgStatus("review", req.params.id) : null });
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
