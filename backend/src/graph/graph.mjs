/*
 * Knowledge graph over everything the arena already stores: projects, the tech they use,
 * their tracks, judges' scores, dossier claims and fight results.
 *
 * Nodes: project:<id>, judge:<id>, tech:<name>, track:<name>, claim:<projectId>:<evidenceId>
 * Edges: USES (project -> tech), IN_TRACK (project -> track), SCORED (judge -> project, score),
 *        CLAIMS (project -> claim, status), BEAT (project -> project, tournament/match)
 *
 * buildGraph() is pure (records in, graph out) so it can be tested without the store;
 * loadGraph() feeds it from backend/data.
 */
import fs from "node:fs";
import path from "node:path";
import { readJSON } from "../datafiles.mjs";
import { DATA_DIR, dossiers, judges, reviews, submissions } from "../store.mjs";

const norm = (s) => String(s).trim().toLowerCase();
/** The id inside a node id: "project:abc" -> "abc", "tech:viem" -> "viem". */
const bare = (nodeId) => nodeId.slice(nodeId.indexOf(":") + 1);

export function buildGraph({ projects = [], judgeList = [], reviewList = [], dossierList = [], tournaments = [], fights = [] }) {
  const nodes = new Map();
  const edges = [];
  const node = (id, type, data = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, ...data });
    return id;
  };
  const edge = (from, rel, to, data = {}) => edges.push({ from, rel, to, ...data });

  for (const j of judgeList) node(`judge:${j.id}`, "judge", { name: j.name });

  for (const p of projects) {
    const pid = node(`project:${p.id}`, "project", { name: p.name, team: p.team });
    for (const t of p.tracks ?? []) edge(pid, "IN_TRACK", node(`track:${norm(t)}`, "track", { name: norm(t) }));
  }

  for (const d of dossierList) {
    const pid = node(`project:${d.projectId}`, "project", {});
    for (const dep of new Set((d.dependencies ?? []).map((x) => norm(x.name)).filter(Boolean))) {
      edge(pid, "USES", node(`tech:${dep}`, "tech", { name: dep }));
    }
    for (const e of d.evidence ?? []) {
      if (!e?.id) continue;
      const cid = node(`claim:${d.projectId}:${e.id}`, "claim", { text: e.claim, source: e.source });
      edge(pid, "CLAIMS", cid, { status: e.status });
    }
  }

  for (const r of reviewList) {
    const pid = node(`project:${r.projectId}`, "project", {});
    for (const rv of r.reviews ?? []) {
      if (rv.status !== "scored" || typeof rv.overallHundredths !== "number") continue;
      edge(node(`judge:${rv.judgeId}`, "judge", {}), "SCORED", pid, { score: rv.overallHundredths / 100, ranAt: r.ranAt });
    }
  }

  // Fights store bracket slot indexes; the tournament maps a slot to its submission.
  const slots = new Map(tournaments.map((t) => [String(t.id), new Map((t.projects ?? []).map((s) => [s.index, s.submissionId]))]));
  for (const f of fights) {
    const result = (f.events ?? []).find((e) => e.type === "result");
    const bracket = slots.get(String(f.tournamentId));
    if (!result || !bracket) continue;
    const a = bracket.get(f.a);
    const b = bracket.get(f.b);
    if (!a || !b) continue;
    const [w, l] = result.winner === "a" ? [a, b] : [b, a];
    edge(node(`project:${w}`, "project", {}), "BEAT", node(`project:${l}`, "project", {}), { tournament: String(f.tournamentId), match: f.match });
  }

  const out = (id, rel) => edges.filter((e) => e.from === id && (!rel || e.rel === rel));
  const into = (id, rel) => edges.filter((e) => e.to === id && (!rel || e.rel === rel));
  return { nodes, edges, out, into };
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/** How a judge scores projects linked to `target` (tech:x or track:y) vs everything else. */
export function judgeBias(g, judgeId, target) {
  const scored = g.out(`judge:${judgeId}`, "SCORED");
  const linked = (pid) => g.out(pid).some((e) => e.to === target);
  const withT = scored.filter((s) => linked(s.to)).map((s) => s.score);
  const without = scored.filter((s) => !linked(s.to)).map((s) => s.score);
  const a = avg(withT);
  const b = avg(without);
  return { judgeId, target, with: { avg: a, n: withT.length }, without: { avg: b, n: without.length }, delta: a != null && b != null ? Math.round((a - b) * 100) / 100 : null };
}

/** Every judge's average next to the panel's: who is harsher or more lenient. */
export function judgeLeniency(g) {
  const all = g.edges.filter((e) => e.rel === "SCORED");
  const panel = avg(all.map((e) => e.score));
  return [...g.nodes.values()]
    .filter((n) => n.type === "judge")
    .map((n) => {
      const mine = g.out(n.id, "SCORED").map((e) => e.score);
      const a = avg(mine);
      return { judgeId: bare(n.id), name: n.name ?? null, avg: a, n: mine.length, vsPanel: a != null && panel != null ? Math.round((a - panel) * 100) / 100 : null };
    });
}

/** Projects sharing tech and tracks with this one, ranked by Jaccard similarity. */
export function similarProjects(g, projectId, limit = 5) {
  const features = (pid) => new Set(g.out(pid).filter((e) => e.rel === "USES" || e.rel === "IN_TRACK").map((e) => e.to));
  const mine = features(`project:${projectId}`);
  return [...g.nodes.values()]
    .filter((n) => n.type === "project" && n.id !== `project:${projectId}`)
    .map((n) => {
      const theirs = features(n.id);
      const shared = [...mine].filter((x) => theirs.has(x));
      const union = new Set([...mine, ...theirs]).size;
      return { projectId: bare(n.id), name: n.name ?? null, shared: shared.map(bare), similarity: union ? Math.round((shared.length / union) * 1000) / 1000 : 0 };
    })
    .filter((x) => x.shared.length)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Everything the graph knows about one project, for "why did it score / win like that". */
export function explainProject(g, projectId) {
  const pid = `project:${projectId}`;
  const n = g.nodes.get(pid);
  if (!n) return null;
  const claims = g.out(pid, "CLAIMS");
  const count = (s) => claims.filter((c) => c.status === s).length;
  const scores = g.into(pid, "SCORED").map((e) => ({ judgeId: bare(e.from), name: g.nodes.get(e.from)?.name ?? null, score: e.score }));
  return {
    projectId,
    name: n.name ?? null,
    tracks: g.out(pid, "IN_TRACK").map((e) => bare(e.to)),
    tech: g.out(pid, "USES").map((e) => bare(e.to)),
    scores,
    panelAvg: avg(scores.map((s) => s.score)),
    claims: { supported: count("supported_by_code"), contradicted: count("contradicted"), unverified: count("unverified") },
    contradicted: claims.filter((c) => c.status === "contradicted").map((c) => g.nodes.get(c.to)?.text ?? null),
    beat: g.out(pid, "BEAT").map((e) => bare(e.to)),
    lostTo: g.into(pid, "BEAT").map((e) => bare(e.from)),
  };
}

/** Nodes and edges as plain JSON (claims left out: they're per-project detail, not graph structure). */
export function toJson(g) {
  const keep = (id) => !id.startsWith("claim:");
  return { nodes: [...g.nodes.values()].filter((n) => keep(n.id)), edges: g.edges.filter((e) => keep(e.to)) };
}

/** Every JSON record in a data folder. A missing folder is empty; an unreadable file is skipped, not the whole folder. */
const readDir = (name) => {
  const d = path.join(DATA_DIR, name);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJSON(f, null, d))
    .filter(Boolean);
};

/** Builds the graph from backend/data. Cheap enough to rebuild per request at hackathon scale. */
export function loadGraph() {
  const subs = submissions.list();
  return buildGraph({
    projects: subs.map((s) => ({ id: s.id, name: s.project?.name, team: s.team?.name, tracks: s.tracks })),
    judgeList: judges.list(),
    reviewList: subs.map((s) => reviews.get(s.id)).filter(Boolean),
    dossierList: subs.map((s) => ({ projectId: s.id, ...dossiers.get(s.id) })).filter((d) => d.dependencies || d.evidence),
    tournaments: readDir("arena-tournaments"),
    fights: readDir("arena-fights"),
  });
}
