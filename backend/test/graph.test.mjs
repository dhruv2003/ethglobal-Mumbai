import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Never touch the real backend/data.
process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-graph-test-"));
const { buildGraph, explainProject, judgeBias, judgeLeniency, loadGraph, similarProjects, toJson } = await import("../src/graph/graph.mjs");
const { dossiers, judges, reviews, submissions } = await import("../src/store.mjs");

const records = {
  projects: [
    { id: "p1", name: "Alpha", tracks: ["Arkiv", "0G"] },
    { id: "p2", name: "Beta", tracks: ["arkiv"] },
    { id: "p3", name: "Gamma", tracks: ["polygon"] },
  ],
  judgeList: [{ id: "j1", name: "Priya" }, { id: "j2", name: "Marcus" }],
  dossierList: [
    { projectId: "p1", dependencies: [{ name: "React" }, { name: "viem" }], evidence: [{ id: "E1", claim: "Stores on Arkiv", status: "supported_by_code" }, { id: "E2", claim: "Uses 0G inference", status: "contradicted" }] },
    { projectId: "p2", dependencies: [{ name: "react" }, { name: "flask" }], evidence: [] },
    { projectId: "p3", dependencies: [{ name: "flask" }], evidence: [{ id: "E1", claim: "x", status: "unverified" }] },
  ],
  reviewList: [
    { projectId: "p1", reviews: [{ judgeId: "j1", status: "scored", overallHundredths: 8000 }, { judgeId: "j2", status: "scored", overallHundredths: 6000 }] },
    { projectId: "p2", reviews: [{ judgeId: "j1", status: "scored", overallHundredths: 7000 }, { judgeId: "j2", status: "error" }] },
    { projectId: "p3", reviews: [{ judgeId: "j1", status: "scored", overallHundredths: 4000 }, { judgeId: "j2", status: "scored", overallHundredths: 5000 }] },
  ],
  tournaments: [{ id: "1", projects: [{ index: 0, submissionId: "p1" }, { index: 1, submissionId: "p3" }] }],
  fights: [
    { tournamentId: "1", match: 0, a: 0, b: 1, events: [{ type: "result", winner: "b" }] },
    { tournamentId: "1", match: 1, a: 0, b: 1, error: "failed" }, // no result: ignored
  ],
};

test("builds nodes and edges from the stored records, normalising names", () => {
  const g = buildGraph(records);
  assert.ok(g.nodes.has("tech:react") && !g.nodes.has("tech:React"));
  assert.ok(g.nodes.has("track:arkiv"));
  assert.equal(g.out("project:p1", "USES").length, 2);
  assert.equal(g.edges.filter((e) => e.rel === "SCORED").length, 5, "unscored reviews are skipped");
  assert.deepEqual(g.out("project:p3", "BEAT").map((e) => e.to), ["project:p1"]);
  assert.equal(g.edges.filter((e) => e.rel === "BEAT").length, 1, "a fight without a result adds no edge");
});

test("judge bias compares projects linked to a tech or track with the rest", () => {
  const g = buildGraph(records);
  assert.deepEqual(judgeBias(g, "j1", "tech:react"), { judgeId: "j1", target: "tech:react", with: { avg: 75, n: 2 }, without: { avg: 40, n: 1 }, delta: 35 });
  assert.equal(judgeBias(g, "j2", "track:arkiv").with.n, 1);
  assert.equal(judgeBias(g, "nobody", "tech:react").delta, null);
});

test("leniency puts each judge next to the panel average", () => {
  const byId = Object.fromEntries(judgeLeniency(buildGraph(records)).map((j) => [j.judgeId, j]));
  // panel avg of all 5 scores = 60
  assert.equal(byId.j1.avg, 63.33);
  assert.equal(byId.j1.vsPanel, 3.33);
  assert.equal(byId.j2.vsPanel, -5);
});

test("similar projects rank by shared tech and tracks", () => {
  const sim = similarProjects(buildGraph(records), "p2");
  assert.equal(sim[0].projectId, "p1");
  assert.deepEqual(sim[0].shared.sort(), ["arkiv", "react"]);
  assert.equal(sim[1].projectId, "p3");
  assert.deepEqual(similarProjects(buildGraph(records), "missing"), []);
});

test("explain gathers scores, claims and fights for one project", () => {
  const e = explainProject(buildGraph(records), "p1");
  assert.equal(e.panelAvg, 70);
  assert.deepEqual(e.claims, { supported: 1, contradicted: 1, unverified: 0 });
  assert.deepEqual(e.contradicted, ["Uses 0G inference"]);
  assert.deepEqual(e.lostTo, ["p3"]);
  assert.equal(explainProject(buildGraph(records), "nope"), null);
});

test("JSON export leaves claims out", () => {
  const j = toJson(buildGraph(records));
  assert.ok(j.nodes.every((n) => n.type !== "claim"));
  assert.ok(j.edges.every((e) => e.rel !== "CLAIMS"));
});

test("loadGraph reads from the store", () => {
  judges.save([{ id: "j1", name: "Priya" }]);
  submissions.add({ id: "s1", project: { name: "Stored" }, tracks: ["arkiv"] });
  dossiers.save("s1", { dependencies: [{ name: "viem" }], evidence: [] });
  reviews.save("s1", { projectId: "s1", reviews: [{ judgeId: "j1", status: "scored", overallHundredths: 5500 }] });
  const e = explainProject(loadGraph(), "s1");
  assert.equal(e.name, "Stored");
  assert.deepEqual(e.tech, ["viem"]);
  assert.deepEqual(e.scores, [{ judgeId: "j1", name: "Priya", score: 55 }]);
});
