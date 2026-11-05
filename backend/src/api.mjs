/*
 * /api routes for judges, submissions and reviews.
 *
 *   GET    /api/health                 judge service status (credentials, judge count)
 *   GET    /api/criteria               what judges score
 *   GET    /api/judges                 the panel (max 3)
 *   POST   /api/judges                 add a judge from the form
 *   PUT    /api/judges/:id             edit a judge (new persona version)
 *   DELETE /api/judges/:id             remove a judge
 *   GET    /api/submissions            submitted projects
 *   POST   /api/submissions            save a submission; the panel reviews it in the background
 *   GET    /api/projects/:id/reviews   latest panel review
 *   POST   /api/projects/:id/reviews   run the panel now
 */
import crypto from "node:crypto";
import express from "express";
import { CRITERIA } from "./judges/criteria.mjs";
import { MAX_JUDGES, validateForm } from "./judges/persona.mjs";
import { hasCredentials, MODEL, runPanel } from "./judges/review.mjs";
import { EXAMPLE_FORMS } from "./judges/seed.mjs";
import { loadProject } from "./projects.mjs";
import { judges, reviews, submissions } from "./store.mjs";

// Seed the example panel the first time only.
if (!judges.list().length) judges.save(EXAMPLE_FORMS.map((f) => ({ ...validateForm(f).persona, example: true })));

const running = new Map(); // projectId -> Promise, so one project is never reviewed twice at once

export async function reviewNow(projectId) {
  if (running.has(projectId)) return running.get(projectId);
  const project = loadProject(projectId);
  if (!project) throw Object.assign(new Error("No such project."), { status: 404 });
  const panel = judges.list();
  if (panel.length !== MAX_JUDGES) throw Object.assign(new Error(`The panel needs ${MAX_JUDGES} judges; it has ${panel.length}.`), { status: 409 });
  if (!hasCredentials()) throw Object.assign(new Error("No Anthropic API key on the server. Add ANTHROPIC_API_KEY to backend/.env and restart."), { status: 503 });
  const job = runPanel(panel, project)
    .then((result) => reviews.save(projectId, result))
    .finally(() => running.delete(projectId));
  running.set(projectId, job);
  return job;
}

export const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, judgesReady: hasCredentials(), judges: judges.list().length, maxJudges: MAX_JUDGES, model: MODEL });
});

router.get("/criteria", (req, res) => res.json(CRITERIA));

router.get("/judges", (req, res) => res.json(judges.list()));

router.post("/judges", (req, res) => {
  const all = judges.list();
  if (all.length >= MAX_JUDGES) return res.status(409).json({ error: `All ${MAX_JUDGES} seats are taken. Remove a judge first.` });
  const { persona, errors } = validateForm(req.body ?? {});
  if (errors) return res.status(400).json({ errors });
  judges.save([...all, persona]);
  res.status(201).json(persona);
});

router.put("/judges/:id", (req, res) => {
  const all = judges.list();
  const existing = all.find((j) => j.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "No such judge." });
  const { persona, errors } = validateForm(req.body ?? {}, { existing });
  if (errors) return res.status(400).json({ errors });
  judges.save(all.map((j) => (j.id === existing.id ? persona : j)));
  res.json(persona);
});

router.delete("/judges/:id", (req, res) => {
  const all = judges.list();
  if (!all.some((j) => j.id === req.params.id)) return res.status(404).json({ error: "No such judge." });
  judges.save(all.filter((j) => j.id !== req.params.id));
  res.status(204).end();
});

router.get("/submissions", (req, res) => res.json(submissions.list()));

router.post("/submissions", (req, res) => {
  const body = req.body ?? {};
  if (!body.project?.name || !body.repoUrl || !body.ownerWallet) return res.status(400).json({ error: "Missing project name, repo or owner wallet." });
  const record = { ...body, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
  submissions.add(record);
  // The panel reviews every new submission in the background when it can.
  let review = "skipped";
  if (hasCredentials() && judges.list().length === MAX_JUDGES) {
    review = "started";
    reviewNow(record.id).catch((e) => console.error(`[judges] review of ${record.id} failed: ${e.message}`));
  }
  res.status(201).json({ ...record, review });
});

router.get("/projects/:id/reviews", (req, res) => {
  const r = reviews.get(req.params.id);
  res.json({ running: running.has(req.params.id), result: r });
});

router.post("/projects/:id/reviews", async (req, res) => {
  try {
    res.json({ running: false, result: await reviewNow(req.params.id) });
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message });
  }
});
