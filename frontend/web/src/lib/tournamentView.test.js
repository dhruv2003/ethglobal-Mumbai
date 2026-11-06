import { afterEach, describe, expect, it, vi } from "vitest";
import { isMatchOpen, openPools, viewOfChain } from "./tournamentView.js";

const NOW = 1000;
const project = (i) => ({ id: i, name: `Project ${i + 1}` });
const match = (index, extra) => ({ index, a: index * 2, b: index * 2 + 1, opened: true, status: "live", cutoffMs: NOW + 100, ...extra });
const view = (extra) => ({
  id: "1",
  title: "On-chain tournament #1",
  count: 4,
  frozen: true,
  phase: "upcoming",
  cutoffMs: NOW + 500,
  projects: [0, 1, 2, 3].map(project),
  matches: [match(0), match(1, { opened: false, status: "scheduled", cutoffMs: 0 })],
  ...extra,
});

describe("openPools", () => {
  it("lists the winner pool and each open match", () => {
    expect(openPools(view(), NOW).map((p) => p.to)).toEqual(["/tournaments/1", "/fights/1/0"]);
  });

  it("drops a match once its cutoff passes, keeping the winner pool", () => {
    expect(openPools(view(), NOW + 100).map((p) => p.to)).toEqual(["/tournaments/1"]);
  });

  it("is empty once every cutoff passes", () => {
    expect(openPools(view(), NOW + 500)).toEqual([]);
  });

  it("the winner pool needs a frozen tournament", () => {
    expect(openPools(view({ frozen: false, matches: [] }), NOW)).toEqual([]);
  });

  it("a canceled tournament takes no bets", () => {
    expect(openPools(view({ phase: "canceled", matches: [match(0, { status: "void" })] }), NOW)).toEqual([]);
  });
});

describe("isMatchOpen", () => {
  it("needs an opened match", () => {
    expect(isMatchOpen(view(), match(0, { opened: false }), NOW)).toBe(false);
  });

  it("a voided match is closed before its cutoff", () => {
    expect(isMatchOpen(view(), match(0, { status: "void" }), NOW)).toBe(false);
  });
});

describe("viewOfChain match status", () => {
  const raw = (start) => ({
    id: 1,
    status: 2,
    bettingCutoff: 100n,
    scheduledStart: 160n,
    resolutionDeadline: 9000n,
    projectCount: 4,
    count: 4,
    matches: [
      { status: 1, source: 0, projectA: 0, projectB: 1, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff: 50n, scheduledStart: start },
      { status: 0, source: 0, projectA: 0, projectB: 0, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff: 0n, scheduledStart: 0n },
      { status: 0, source: 0, projectA: 0, projectB: 0, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff: 0n, scheduledStart: 0n },
    ],
  });
  afterEach(() => vi.useRealTimers());
  const statusAt = (seconds) => {
    vi.useFakeTimers({ now: seconds * 1000 });
    return viewOfChain(raw(160n)).matches[0].status;
  };

  it("isn't live while betting is open", () => {
    expect(statusAt(10)).toBe("scheduled");
  });

  it("isn't live between the cutoff and the start", () => {
    expect(statusAt(120)).toBe("scheduled");
  });

  it("goes live at its start time", () => {
    expect(statusAt(160)).toBe("live");
  });
});

describe("viewOfChain with a registered bracket", () => {
  const meta = { title: "Mumbai Cup", track: "Base", projects: [{ submissionId: "s1", name: "Alpha", pitch: "p", tracks: ["base"], fighterSeed: "seed-a" }, { submissionId: "s2", name: "Beta", pitch: "q", tracks: [] }] };
  const raw = { id: 3, status: 2, bettingCutoff: 100n, scheduledStart: 160n, resolutionDeadline: 9000n, projectCount: 2, count: 2, matches: [{ status: 0, source: 0, projectA: 0, projectB: 0, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff: 0n, scheduledStart: 0n }] };

  it("names slots after the registered projects", () => {
    const v = viewOfChain(raw, meta);
    expect(v.title).toBe("Mumbai Cup");
    expect(v.projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    expect(v.projects[0].seed).toBe("seed-a");
    expect(v.projects[1].seed).toBe("s2");
    expect(v.matches).toHaveLength(1);
  });

  it("falls back to numbered slots without a bracket", () => {
    const v = viewOfChain(raw, null);
    expect(v.projects.map((p) => p.name)).toEqual(["Slot 1", "Slot 2"]);
    expect(v.registered).toBe(false);
  });
});

describe("a two-project tournament", () => {
  it("is one match, and it opens for bets", () => {
    const m = (status, a, b, cutoff, start) => ({ status, source: 0, projectA: a, projectB: b, winner: 0, scoreA: 0, scoreB: 0, tieA: 0, tieB: 0, cutoff, scheduledStart: start });
    const view = viewOfChain({ id: 3, status: 2, bettingCutoff: 9000000000n, scheduledStart: 9000000060n, resolutionDeadline: 9000900000n, projectCount: 2, capacity: 2, count: 2, matches: [m(1, 0, 1, 9000000000n, 9000000060n)] });
    expect(view.matches).toHaveLength(1);
    expect(view.rounds.flatMap((r) => r.matches)).toEqual([0]);
    expect(openPools(view).map((p) => p.to)).toEqual(["/tournaments/3", "/fights/3/0"]);
  });
});
