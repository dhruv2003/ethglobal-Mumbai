import { describe, expect, it } from "vitest";
import { bracketRounds, estimatePayout, feeders, matchMarket, matchRound, parseScore, roundName, tournamentMarket } from "./pools.js";

const T = 10n ** 18n;

describe("estimatePayout", () => {
  it("matches the PRD example: 100 of 400 winning in a 1,000 pool claims 175", () => {
    const paid = estimatePayout({ total: 900n * T, selectionStake: 300n * T, myStake: 0n, amount: 100n * T });
    expect(paid).toBe(175n * T);
  });

  it("shows a correct pick can return less than the stake", () => {
    const paid = estimatePayout({ total: 900n * T, selectionStake: 800n * T, amount: 100n * T });
    expect(paid).toBe((700n * T * 100n * T) / (900n * T));
    expect(paid < 100n * T).toBe(true);
  });

  it("includes an existing stake", () => {
    const paid = estimatePayout({ total: 100n * T, selectionStake: 50n * T, myStake: 50n * T, amount: 50n * T });
    expect(paid).toBe(105n * T);
  });
});

describe("markets", () => {
  it("matches the TournamentManager encoding", () => {
    expect(tournamentMarket(1)).toBe(256n);
    expect(matchMarket(1, 0)).toBe(257n);
    expect(matchMarket(2, 14)).toBe(527n);
  });
});

describe("bracket", () => {
  it("lays out 16 projects in four rounds", () => {
    const rounds = bracketRounds(16);
    expect(rounds.map((r) => r.matches.length)).toEqual([8, 4, 2, 1]);
    expect(rounds[3].matches).toEqual([14]);
    expect(rounds.map((r) => r.name)).toEqual(["Round of 16", "Quarterfinals", "Semifinals", "Final"]);
  });

  it("finds a match's round", () => {
    expect(matchRound(7, 16).round).toBe(1);
    expect(matchRound(8, 16).round).toBe(2);
    expect(matchRound(2, 4).round).toBe(2);
    expect(roundName(matchRound(2, 4).size)).toBe("Final");
  });

  it("matches the contract's feeder matches", () => {
    expect(feeders(3, 8)).toBeNull();
    expect(feeders(4, 8)).toEqual([0, 1]);
    expect(feeders(6, 8)).toEqual([4, 5]);
    expect(feeders(14, 16)).toEqual([12, 13]);
  });
});

describe("parseScore", () => {
  it("converts to hundredths", () => {
    expect(parseScore("82.5")).toBe(8250);
    expect(parseScore("100")).toBe(10000);
    expect(parseScore("0")).toBe(0);
    expect(parseScore("7.05")).toBe(705);
  });

  it("rejects anything else", () => {
    expect(parseScore("100.01")).toBeNull();
    expect(parseScore("abc")).toBeNull();
    expect(parseScore("")).toBeNull();
    expect(parseScore("1.234")).toBeNull();
  });
});
