import { describe, expect, it } from "vitest";
import { createSimulation, hitTest, neighbourhood, prepareGraph, tick, visibleGraph } from "./graphLayout.js";

const api = {
  nodes: [
    { id: "project:p1", type: "project", name: "Alpha" },
    { id: "project:p2", type: "project", name: "Beta" },
    { id: "judge:j1", type: "judge", name: "Priya" },
    { id: "tech:react", type: "tech", name: "react" },
    { id: "track:arkiv", type: "track" },
  ],
  edges: [
    { from: "judge:j1", rel: "SCORED", to: "project:p1", score: 70 },
    { from: "project:p1", rel: "USES", to: "tech:react" },
    { from: "project:p2", rel: "USES", to: "tech:react" },
    { from: "project:p1", rel: "BEAT", to: "project:p2" },
    { from: "project:p1", rel: "IN_TRACK", to: "track:missing" },
  ],
};

describe("graph layout", () => {
  it("links nodes, drops dangling edges and labels nodes", () => {
    const s = prepareGraph(api);
    expect(s.links).toHaveLength(4);
    expect(s.byId.get("track:arkiv").label).toBe("arkiv");
    expect(s.byId.get("project:p1").degree).toBe(3);
  });

  it("settles into a spread-out layout with no overlapping nodes", () => {
    const s = createSimulation(prepareGraph(api, { width: 800, height: 600 }), { width: 800, height: 600 });
    for (let i = 0; i < 600 && tick(s) > 0; i++);
    expect(s.alpha).toBe(0);
    for (const a of s.nodes)
      for (const b of s.nodes) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    for (const n of s.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("keeps a dragged node where it is", () => {
    const s = createSimulation(prepareGraph(api));
    const n = s.byId.get("judge:j1");
    n.x = 10;
    n.y = 20;
    tick(s, { pinned: n });
    expect([n.x, n.y]).toEqual([10, 20]);
  });

  it("finds neighbours and hit-tests nodes", () => {
    const s = prepareGraph(api);
    expect([...neighbourhood(s, "tech:react")].sort()).toEqual(["project:p1", "project:p2", "tech:react"]);
    const p = s.byId.get("project:p2");
    expect(hitTest(s, p.x, p.y)?.id).toBe("project:p2");
    expect(hitTest(s, -9999, -9999)).toBeNull();
  });

  it("hides node types and their edges", () => {
    const v = visibleGraph(api, new Set(["tech"]));
    expect(v.nodes.some((n) => n.type === "tech")).toBe(false);
    expect(v.edges.some((e) => e.rel === "USES")).toBe(false);
  });
});
