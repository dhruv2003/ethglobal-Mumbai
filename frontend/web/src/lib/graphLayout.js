/*
 * Layout for the knowledge graph: d3-force does the physics; these helpers turn the
 * API's nodes/edges into simulation input and answer hit tests. No DOM needed.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";

export const NODE_TYPES = {
  project: { label: "Projects", r: 22 },
  judge: { label: "Judges", r: 18 },
  track: { label: "Tracks", r: 13 },
  tech: { label: "Tech", r: 9 },
};

const nameOf = (n) => n.name || n.id.split(":").slice(1).join(":");

/** API graph -> simulation state. Edges to unknown nodes are dropped. */
export function prepareGraph({ nodes = [], edges = [] }, { width = 800, height = 600 } = {}) {
  const byId = new Map();
  const list = nodes.map((n, i) => {
    // Seed on a spiral so the first frame is already spread out (and deterministic).
    const a = i * 2.399963;
    const d = 30 + 14 * Math.sqrt(i) * 3;
    const node = { ...n, label: nameOf(n), r: NODE_TYPES[n.type]?.r ?? 10, x: width / 2 + Math.cos(a) * d, y: height / 2 + Math.sin(a) * d, vx: 0, vy: 0, degree: 0 };
    byId.set(n.id, node);
    return node;
  });
  const links = edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const s = byId.get(e.from);
      const t = byId.get(e.to);
      s.degree++;
      t.degree++;
      return { ...e, source: s, target: t };
    });
  // Busy hubs (a track many projects share) grow a little.
  for (const n of list) n.r += Math.min(10, Math.sqrt(n.degree) * 1.5);
  return { nodes: list, links, byId, alpha: 1 };
}

const REST = { SCORED: 150, BEAT: 170, IN_TRACK: 110, USES: 80 };

/**
 * d3-force physics on top of prepareGraph(): charge pushes nodes apart, links pull
 * connected nodes to a rest length by kind, collision keeps labels from overlapping.
 * The simulation is driven by tick() from the render loop (not d3's own timer).
 */
export function createSimulation(sim, { width = 800, height = 600 } = {}) {
  sim.force = forceSimulation(sim.nodes)
    .force("charge", forceManyBody().strength((n) => -260 - n.r * 18))
    .force("link", forceLink(sim.links).distance((l) => (REST[l.rel] ?? 110) + l.source.r + l.target.r).strength((l) => (l.rel === "USES" ? 0.25 : 0.5)))
    .force("collide", forceCollide((n) => n.r + 26).iterations(3))
    .force("x", forceX(width / 2).strength(0.04))
    .force("y", forceY(height / 2).strength(0.04))
    .alphaDecay(0.02)
    .stop();
  sim.alpha = 1;
  return sim;
}

/** Advance one tick. A pinned node (being dragged) stays where the pointer put it. Returns alpha (0 = settled). */
export function tick(sim, { pinned = null } = {}) {
  const f = sim.force;
  if (!f) return 0;
  for (const n of sim.nodes) {
    n.fx = n === pinned ? n.x : null;
    n.fy = n === pinned ? n.y : null;
  }
  if (f.alpha() < f.alphaMin()) return (sim.alpha = 0);
  f.tick();
  return (sim.alpha = f.alpha());
}

/** Wake the simulation (after a drag or a filter change). */
export function reheat(sim, alpha = 0.3) {
  sim.force?.alpha(Math.max(sim.force.alpha(), alpha));
  sim.alpha = sim.force?.alpha() ?? 0;
}

/** Ids of a node and everything one edge away. */
export function neighbourhood(sim, id) {
  const out = new Set([id]);
  for (const l of sim.links) {
    if (l.source.id === id) out.add(l.target.id);
    if (l.target.id === id) out.add(l.source.id);
  }
  return out;
}

/** The node under a point (graph coordinates), topmost first. */
export function hitTest(sim, x, y) {
  for (let i = sim.nodes.length - 1; i >= 0; i--) {
    const n = sim.nodes[i];
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx * dx + dy * dy <= (n.r + 4) ** 2) return n;
  }
  return null;
}

/** Nodes of hidden types disappear, and so do edges touching them. */
export function visibleGraph(api, hidden) {
  const nodes = api.nodes.filter((n) => !hidden.has(n.type));
  const keep = new Set(nodes.map((n) => n.id));
  return { nodes, edges: api.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}
