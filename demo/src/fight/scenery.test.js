import { describe, expect, it } from "vitest";
import { MUMBAI_SCENES, sceneryForMatch } from "./scenery.js";

const match = { id: "reused-demo", event: "Mumbai", fighters: { a: { id: "a" }, b: { id: "b" } } };
describe("Mumbai scenery", () => {
  it("stays stable when a replay is revisited", () => {
    expect(sceneryForMatch(match)).toEqual(sceneryForMatch(structuredClone(match)));
  });
  it("varies across matches even when their replay id is reused", () => {
    const scenes = Array.from({ length: 40 }, (_, i) => sceneryForMatch({ ...match, fighters: { a: { id: `p-${i}` }, b: { id: `p-${i + 1}` } } }).id);
    expect(new Set(scenes).size).toBe(MUMBAI_SCENES.length);
  });
  it("honours an explicit scene and safely falls back for unknown values", () => {
    expect(sceneryForMatch({ ...match, scenery: "local" }).id).toBe("local");
    expect(sceneryForMatch({ ...match, scenery: "missing" })).toEqual(sceneryForMatch(match));
  });
});
