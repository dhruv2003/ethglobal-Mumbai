import { describe, expect, it, vi } from "vitest";
import { isOutage, liveOrDemo } from "./demo.js";
import { loadTournaments } from "./arena.js";

vi.mock("./chain.js", () => ({
  listTournaments: async () => {
    throw new Error("rpc down");
  },
  readTournament: async () => {
    throw new Error("rpc down");
  },
}));

describe("liveOrDemo", () => {
  it("returns live data and reports it", async () => {
    const used = vi.fn();
    expect(await liveOrDemo(async () => "live", () => "demo", used)).toBe("live");
    expect(used).toHaveBeenCalledWith("live");
  });

  it("falls back to demo on an outage and reports it", async () => {
    const used = vi.fn();
    expect(await liveOrDemo(async () => { throw new Error("rpc down"); }, () => "demo", used)).toBe("demo");
    expect(used).toHaveBeenCalledWith("demo");
    expect(await liveOrDemo(async () => { throw Object.assign(new Error("bad gateway"), { status: 502 }); }, () => "demo")).toBe("demo");
  });

  it("does not hide a real answer like 404 or 403", async () => {
    await expect(liveOrDemo(async () => { throw Object.assign(new Error("nope"), { status: 404 }); }, () => "demo")).rejects.toThrow("nope");
    expect(isOutage({ status: 403 })).toBe(false);
  });

  it("an unreachable chain gives flagged demo tournaments that never take bets", async () => {
    const list = await loadTournaments();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((t) => t.demo)).toBe(true);
  });
});
