import { describe, expect, it } from "vitest";
import { getProject } from "./projects.js";

describe("project record", () => {
  it("stores the full reviewer dossier on the project and a short highlights block", async () => {
    const p = await getProject("go-health-me");
    expect(p.dossier.evidence.length).toBeGreaterThan(10);
    expect(p.dossier.architecture.length).toBeGreaterThan(0);
    expect(p.dossier.unresolvedQuestions.length).toBeGreaterThan(0);
    const h = p.dossier.highlights;
    expect(h.headline.length).toBeLessThan(160);
    expect(h.holdsUp).toHaveLength(3);
    expect(h.watch).toHaveLength(3);
  });

  it("highlights only cite evidence that exists", async () => {
    const { dossier } = await getProject("go-health-me");
    const ids = new Set(dossier.evidence.map((e) => e.id));
    for (const x of [...dossier.highlights.holdsUp, ...dossier.highlights.watch]) {
      for (const id of x.evidence) expect(ids.has(id), id).toBe(true);
    }
  });
});
