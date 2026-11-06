import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import poolsAbi from "@contracts/abi/BettingPools.json";
import tokenAbi from "@contracts/abi/FilterCoin.json";
import { buildHistory, callName, describeMarket, inFilter } from "./history.js";
import { matchMarket, tournamentMarket } from "./pools.js";

const ME = "0x1111111111111111111111111111111111111111";
const BOT = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const contracts = {
  token: "0xAAaaAAaaaaaAAAaaAaaaaaaaAAAaaaAAAAAAAaAa",
  manager: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  pools: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
};
const pool = (functionName, args) => encodeFunctionData({ abi: poolsAbi, functionName, args });
const transfer = (hash, from, to, value, timestamp = "2026-11-06T10:00:00Z") => ({
  transaction_hash: hash,
  log_index: 1,
  from: { hash: from },
  to: { hash: to },
  total: { value: String(value) },
  timestamp,
});
const tx = (hash, to, raw_input, status = "ok", value = "0", timestamp = "2026-11-06T10:00:00Z") => ({
  hash,
  from: { hash: ME },
  to: { hash: to },
  raw_input,
  status,
  value,
  timestamp,
});

describe("describeMarket", () => {
  it("reverses both market encodings", () => {
    expect(describeMarket(tournamentMarket(3))).toEqual({ label: "Tournament #3 · Winner", href: "/tournaments/3" });
    expect(describeMarket(matchMarket(3, 0))).toEqual({ label: "Tournament #3 · Match 1", href: "/fights/3/0" });
  });
});

describe("buildHistory", () => {
  it("classifies money moves by who sent what to whom", () => {
    const rows = buildHistory({
      address: ME,
      contracts,
      transfers: [
        transfer("0xa", ZERO, ME, 1000),
        transfer("0xb", ME, ZERO, 500),
        transfer("0xc", ME, contracts.pools.toLowerCase(), 20),
        transfer("0xd", STRANGER, ME, 7),
        transfer("0xe", ME, STRANGER, 8),
      ],
    });
    expect(Object.fromEntries(rows.map((r) => [r.hash, r.kind]))).toEqual({ "0xa": "buy", "0xb": "sell", "0xc": "bet", "0xd": "received", "0xe": "sent" });
  });

  it("marks a payout the bot sent as automatic, with its market", () => {
    const input = pool("claimFor", [matchMarket(2, 1), ME]);
    const [row] = buildHistory({
      address: ME,
      contracts,
      transfers: [transfer("0xf", contracts.pools, ME, 90)],
      lookups: new Map([["0xf", { input, from: BOT }]]),
    });
    expect(row).toMatchObject({ kind: "payout", amount: 90n, auto: true, market: { label: "Tournament #2 · Match 2" } });
  });

  it("doesn't call a payout automatic when it came through another contract", () => {
    const [row] = buildHistory({
      address: ME,
      contracts,
      transfers: [transfer("0xf", contracts.pools, ME, 90)],
      lookups: new Map([["0xf", { input: "0xcef6d209", from: BOT }]]),
    });
    expect(row).toMatchObject({ kind: "payout", auto: false, market: null });
  });

  it("tells a refund from a payout", () => {
    const [row] = buildHistory({
      address: ME,
      contracts,
      transfers: [transfer("0x1", contracts.pools, ME, 5)],
      txs: [tx("0x1", contracts.pools, pool("refund", [matchMarket(1, 0)]))],
    });
    expect(row).toMatchObject({ kind: "refund", auto: false });
  });

  it("does not list a transaction twice when it also moved tokens", () => {
    const rows = buildHistory({
      address: ME,
      contracts,
      transfers: [transfer("0x1", ME, contracts.pools, 5)],
      txs: [tx("0x1", contracts.pools, pool("bet", [matchMarket(1, 0), 0n, 5n]))],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].market.label).toBe("Tournament #1 · Match 1");
  });

  it("keeps failures and approvals, and drops pending or unrelated transactions", () => {
    const approve = encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [contracts.pools, 5n] });
    const rows = buildHistory({
      address: ME,
      contracts,
      txs: [
        tx("0x1", contracts.pools, pool("bet", [matchMarket(1, 0), 0n, 5n]), "error"),
        tx("0x2", contracts.token, approve),
        tx("0x3", contracts.pools, "0x", null),
        tx("0x4", STRANGER, "0x"),
      ],
    });
    expect(Object.fromEntries(rows.map((r) => [r.hash, r.kind]))).toEqual({ "0x1": "failed", "0x2": "approve" });
    expect(rows.find((r) => r.hash === "0x1")).toMatchObject({ failed: true, title: "Bet" });
  });

  it("puts the newest first", () => {
    const rows = buildHistory({
      address: ME,
      contracts,
      transfers: [transfer("0x1", ZERO, ME, 1, "2026-11-01T00:00:00Z"), transfer("0x2", ZERO, ME, 1, "2026-11-06T00:00:00Z")],
    });
    expect(rows.map((r) => r.hash)).toEqual(["0x2", "0x1"]);
  });

  it("survives input it can't decode", () => {
    const [row] = buildHistory({ address: ME, contracts, txs: [tx("0x1", contracts.manager, "0xdeadbeef")] });
    expect(row).toMatchObject({ kind: "call", title: "Contract call", market: null });
  });
});

describe("helpers", () => {
  it("names calls for people", () => {
    expect(callName("createTournament")).toBe("Create tournament");
    expect(callName(undefined)).toBe("Contract call");
  });
  it("filters rows", () => {
    expect(inFilter({ kind: "refund" }, "payouts")).toBe(true);
    expect(inFilter({ kind: "bet" }, "payouts")).toBe(false);
    expect(inFilter({ kind: "bet" }, "all")).toBe(true);
  });
});
