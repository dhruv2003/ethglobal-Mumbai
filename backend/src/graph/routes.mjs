/*
 * /api/graph: the knowledge graph over projects, judges, tech, tracks, claims and fights.
 *
 *   GET /api/graph                              nodes + edges (for a force-graph view)
 *   GET /api/graph/judges                       each judge's average vs the panel's
 *   GET /api/graph/judge-bias?judge=&target=    a judge on projects linked to tech:x / track:y vs the rest
 *   GET /api/graph/projects/:id                 what the graph knows about one project
 *   GET /api/graph/projects/:id/similar         projects sharing its tech and tracks
 */
import express from "express";
import { explainProject, judgeBias, judgeLeniency, loadGraph, similarProjects, toJson } from "./graph.mjs";

export const graphRouter = express.Router();

graphRouter.get("/", (req, res) => res.json(toJson(loadGraph())));

graphRouter.get("/judges", (req, res) => res.json(judgeLeniency(loadGraph())));

graphRouter.get("/judge-bias", (req, res) => {
  const { judge, target } = req.query;
  if (typeof judge !== "string" || typeof target !== "string" || !/^(tech|track):.+/.test(target)) {
    return res.status(400).json({ error: "Pass judge=<judgeId> and target=tech:<name> or track:<name>." });
  }
  res.json(judgeBias(loadGraph(), judge, target.toLowerCase()));
});

graphRouter.get("/projects/:id", (req, res) => {
  const out = explainProject(loadGraph(), req.params.id);
  if (!out) return res.status(404).json({ error: "No such project in the graph." });
  res.json(out);
});

graphRouter.get("/projects/:id/similar", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);
  res.json(similarProjects(loadGraph(), req.params.id, limit));
});
