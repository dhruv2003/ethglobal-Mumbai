/*
 * /api/arena: what the chain can't hold. The chain keeps wallets, hashes, scores and money;
 * this keeps which submitted project sits in which bracket slot, and the recorded fights.
 *
 *   GET  /api/arena/tournaments            every tournament the organizer registered
 *   GET  /api/arena/tournaments/:id        one (its bracket: slot -> project)
 *   POST /api/arena/matchmaking            propose who fights whom (similarity matching)   (organizer)
 *   PUT  /api/arena/tournaments/:id        register the bracket after freezing   (organizer)
 *   GET  /api/arena/fights/:t/:m           status + recorded events + scores of a fight
 *   POST /api/arena/fights/:t/:m           run the fight on 0G now               (organizer)
 *   POST /api/arena/fights/:t/:m/result    the full record, even before it is revealed   (organizer)
 *
 * A fight can be run before betting closes, so spectators only get its events and scores
 * once the match's betting cutoff (revealAt) has passed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { DATA_DIR, dossiers, submissions } from "../store.mjs";
import { requireOrganizer } from "../security.mjs";
import { hasCredentials } from "../judges/review.mjs";
import { judgeCast, runFight } from "./fight.mjs";
import { proposeBracket, verifyProposal } from "./matchmaking.mjs";
import { syncFightInBackground, syncTournamentInBackground } from "../arkiv/records/sync.mjs";

const safe = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "");
const dir = (name) => {
  const d = path.join(DATA_DIR, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
};
const tournamentFile = (id) => path.join(dir("arena-tournaments"), `${safe(id)}.json`);
const fightFile = (t, m) => path.join(dir("arena-fights"), `${safe(t)}-${Number(m)}.json`);

/** What a bracket slot shows publicly: no signatures. */
const slot = (s, index) => ({
  index,
  submissionId: s.id,
  name: s.project?.name ?? "Unnamed project",
  pitch: s.project?.pitch ?? "",
  tracks: s.tracks ?? [],
  team: s.team?.name ?? "",
  ownerWallet: s.ownerWallet,
  rewardWallet: s.rewardWallet ?? s.ownerWallet,
  fighterSeed: s.fighterSeed ?? null,
});

const running = new Map(); // "t-m" -> { startedAt, note, events }

export const arenaRouter = express.Router();

arenaRouter.get("/tournaments", (req, res) => {
  const d = dir("arena-tournaments");
  res.json(fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(d, f))).filter(Boolean));
});

arenaRouter.get("/tournaments/:id", (req, res) => {
  const t = readJson(tournamentFile(req.params.id));
  if (!t) return res.status(404).json({ error: "No bracket is registered for this tournament." });
  res.json(t);
});

/** Body: { submissionIds: [the field], seed, blockedPairs? [{a,b,reason}] }. Returns the bracket order and why. */
arenaRouter.post("/matchmaking", requireOrganizer, async (req, res) => {
  const { submissionIds, seed, blockedPairs } = req.body ?? {};
  if (!Array.isArray(submissionIds) || ![2, 4, 8, 16].includes(submissionIds.length)) return res.status(400).json({ error: "Matchmaking needs 2, 4, 8 or 16 projects." });
  if (typeof seed !== "string" || !seed) return res.status(400).json({ error: "A seed is required." });
  if (submissionIds.length > 2 && !hasCredentials("0g")) return res.status(503).json({ error: "Matchmaking embeds the dossiers on 0G (set ZG_API_KEY in backend/.env)." });
  try {
    res.json(await proposeBracket({ submissionIds, seed, blockedPairs: blockedPairs ?? [] }));
  } catch (e) {
    res.status(e.status ?? (e.name === "MatchingError" ? 400 : 502)).json({ error: e.message });
  }
});

/** Saves a bracket: slot order, project details and how it was drawn. Throws with a status. */
export function saveBracket(id, { title, track, submissionIds, proposal }) {
  const refuse = (status, message) => Object.assign(new Error(message), { status });
  if (!Array.isArray(submissionIds) || ![2, 4, 8, 16].includes(submissionIds.length)) throw refuse(400, "A bracket holds 2, 4, 8 or 16 projects.");
  if (new Set(submissionIds).size !== submissionIds.length) throw refuse(400, "A project can only appear once.");
  const projects = [];
  for (const [i, sid] of submissionIds.entries()) {
    const s = submissions.get(sid);
    if (!s) throw refuse(400, `Slot ${i + 1}: no such submitted project.`);
    if (!dossiers.get(sid)) throw refuse(409, `Slot ${i + 1} (${s.project?.name}): the review hasn't produced a dossier yet, so it can't fight.`);
    projects.push(slot(s, i));
  }
  // Either the exact bracket matchmaking proposed, or an order the organizer chose by hand (recorded as such).
  let matching = { manual: true };
  if (proposal) {
    const b = verifyProposal(proposal, submissionIds);
    if (!b) throw refuse(400, "This bracket order doesn't match the matchmaking result. Run matchmaking again.");
    matching = { manual: false, algorithmVersion: b.algorithmVersion, seed: b.seed, embeddingModel: b.embeddingModel, weights: b.weights, inputHash: b.inputHash, resultHash: b.resultHash, firstRound: b.firstRound };
  }
  const prior = readJson(tournamentFile(id));
  const record = { id: String(id), title: String(title || `Tournament #${id}`).slice(0, 80), track: String(track || "Open").slice(0, 40), matching, createdAt: prior?.createdAt ?? new Date().toISOString(), projects };
  writeJson(tournamentFile(id), record);
  syncTournamentInBackground(id);
  return record;
}

/** Body: { title, track?, submissionIds: [...] in bracket order (slot 0, 1, 2...) }. */
arenaRouter.put("/tournaments/:id", requireOrganizer, (req, res) => {
  try {
    res.json(saveBracket(req.params.id, req.body ?? {}));
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

/** Registered brackets, for the auto-run loop. */
export const listBrackets = () => {
  const d = dir("arena-tournaments");
  return fs.readdirSync(d).filter((x) => x.endsWith(".json")).map((x) => readJson(path.join(d, x))).filter(Boolean);
};

export function statusOf(t, m) {
  const live = running.get(`${t}-${m}`);
  if (live) return { status: "running", note: live.note, startedAt: live.startedAt, eventCount: live.events.length, events: live.events };
  const saved = readJson(fightFile(t, m));
  if (saved?.error) return { status: "failed", error: saved.error, ranAt: saved.ranAt };
  if (saved) return { status: "done", ...saved };
  return { status: "none" };
}

arenaRouter.get("/fights/:t/:m", (req, res) => {
  const s = statusOf(req.params.t, req.params.m);
  if (s.status === "done" && s.revealAt && Date.now() < s.revealAt) {
    return res.json({ status: "sealed", revealAt: s.revealAt, judges: judgeCast() });
  }
  res.json({ ...s, judges: judgeCast() });
});

arenaRouter.post("/fights/:t/:m/result", requireOrganizer, (req, res) => res.json({ ...statusOf(req.params.t, req.params.m), judges: judgeCast() }));

/** Starts a fight in the background. Throws with a status if it can't start. */
export function startFight(t, m, { a: slotA, b: slotB, revealAt, rerun } = {}) {
  const key = `${t}-${m}`;
  const refuse = (status, message) => Object.assign(new Error(message), { status });
  if (running.has(key)) throw refuse(409, "This fight is already running.");
  const meta = readJson(tournamentFile(t));
  if (!meta) throw refuse(409, "Register the bracket for this tournament first (organizer page, step 3).");
  const a = meta.projects[Number(slotA)];
  const b = meta.projects[Number(slotB)];
  if (!a || !b || a === b) throw refuse(400, "Both fighters must be projects in this bracket.");
  if (!hasCredentials("0g")) throw refuse(503, "The fight service has no 0G key (set ZG_API_KEY in backend/.env).");
  const prior = readJson(fightFile(t, m));
  if (prior && !prior.error && !rerun) throw refuse(409, "This fight was already run and its result is recorded. It can't be run twice.");

  const corners = {};
  for (const [side, p] of [["A", a], ["B", b]]) {
    const sub = submissions.get(p.submissionId);
    corners[side] = { project: { name: p.name, pitch: p.pitch, tracks: p.tracks }, dossier: dossiers.get(p.submissionId), submission: sub };
  }
  const live = { startedAt: new Date().toISOString(), note: "Starting", events: [] };
  running.set(key, live);

  runFight({ corners, onProgress: (note, events) => Object.assign(live, { note, events }) })
    .then((result) => {
      writeJson(fightFile(t, m), { tournamentId: String(t), match: Number(m), a: a.index, b: b.index, revealAt: Number(revealAt) || 0, ranAt: new Date().toISOString(), id: crypto.randomUUID(), ...result });
    })
    .catch((e) => {
      console.error(`[fight ${key}] failed: ${e.message}`);
      writeJson(fightFile(t, m), { tournamentId: String(t), match: Number(m), error: String(e.message ?? e).slice(0, 300), ranAt: new Date().toISOString() });
    })
    .finally(() => {
      running.delete(key);
      syncFightInBackground(t, m);
    });
  return live;
}

arenaRouter.post("/fights/:t/:m", requireOrganizer, async (req, res) => {
  try {
    const live = startFight(req.params.t, req.params.m, req.body ?? {});
    res.status(202).json({ status: "running", startedAt: live.startedAt });
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

/** For tournaments this server publishes: the organizer opens or voids a match through it. */
const asBot = (action) => async (req, res) => {
  try {
    const service = await import("./autorunService.mjs");
    res.json({ hash: await action(service, req) });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.shortMessage ?? e.message });
  }
};
arenaRouter.post("/tournaments/:id/matches/:m/open", requireOrganizer, asBot((s, req) => s.openMatchAsBot(req.params.id, req.params.m, req.body?.minutes)));
arenaRouter.post("/tournaments/:id/matches/:m/void", requireOrganizer, asBot((s, req) => s.voidMatchAsBot(req.params.id, req.params.m, `0x${crypto.createHash("sha256").update("organizer").digest("hex")}`)));

/** Whether the server can run tournaments by itself, and starting one by hand with chosen projects. */
arenaRouter.get("/auto", async (req, res) => res.json((await import("./autorunService.mjs")).autoStatus()));
arenaRouter.post("/auto/start", requireOrganizer, async (req, res) => {
  try {
    const service = await import("./autorunService.mjs");
    res.status(201).json({ tournamentId: await service.startTournamentNow(req.body?.submissionIds) });
  } catch (e) {
    res.status(e.status ?? 502).json({ error: e.shortMessage ?? e.message });
  }
});
