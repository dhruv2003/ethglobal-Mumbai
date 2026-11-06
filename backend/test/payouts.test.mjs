import { test } from "node:test";
import assert from "node:assert/strict";
import { createPayoutBot } from "../src/payouts/bot.mjs";

const OUTCOME = { Unsettled: 0, Empty: 1, Void: 2, Resolved: 3 };
const MARKET = 257n;

/** A stand-in pool following the contract's rules: stakes by wallet, 70/20/10, one payment per wallet. */
function fakeChain({ bets, winner = null, ready = true }) {
  const paid = new Set();
  const sent = [];
  const total = bets.reduce((s, b) => s + b.amount, 0n);
  const sideStake = (side) => bets.filter((b) => b.side === side).reduce((s, b) => s + b.amount, 0n);
  const sides = new Set(bets.map((b) => b.side));
  const pool = { outcome: OUTCOME.Unsettled, total, winningStake: 0n, claimedStake: 0n, bettorBucket: 0n, paidToBettors: 0n, projectPaid: false, platformPaid: false, dustSwept: false };
  const mine = (a) => bets.filter((b) => b.bettor === a);
  const share = (a) => {
    const stake = mine(a).filter((b) => b.side === winner).reduce((s, b) => s + b.amount, 0n);
    return stake ? (pool.bettorBucket * stake) / pool.winningStake : 0n;
  };
  const chain = {
    ready,
    failNext: 0,
    latestBlock: async () => 500n,
    betLogs: async (from, to) => {
      assert.ok(to - from < 200n, "stays inside the RPC's log range");
      return from === 100n ? bets.map((b) => ({ market: MARKET, bettor: b.bettor })) : [];
    },
    read: async (fn, [, a]) => {
      if (fn === "getPool") return { ...pool };
      if (fn === "claimable") return pool.outcome === OUTCOME.Resolved && !paid.has(a) ? share(a) : 0n;
      if (fn === "refundable") return pool.outcome === OUTCOME.Void && !paid.has(a) ? mine(a).reduce((s, b) => s + b.amount, 0n) : 0n;
      throw new Error(`unexpected read ${fn}`);
    },
    send: async (fn, [, a]) => {
      if (chain.failNext > 0) {
        chain.failNext--;
        throw new Error("rpc hiccup");
      }
      sent.push(a ? `${fn}:${a}` : fn);
      if (fn === "settle") {
        if (!chain.ready) throw new Error('The contract function "settle" reverted: NotReady');
        if (sides.size === 1 || winner == null) pool.outcome = OUTCOME.Void;
        else {
          pool.outcome = OUTCOME.Resolved;
          pool.winningStake = sideStake(winner);
          pool.bettorBucket = (total * 70n) / 100n;
        }
      }
      if (fn === "claimFor") {
        pool.paidToBettors += share(a);
        pool.claimedStake += mine(a).filter((b) => b.side === winner).reduce((s, b) => s + b.amount, 0n);
        paid.add(a);
      }
      if (fn === "refundFor") paid.add(a);
      if (fn === "claimProject") pool.projectPaid = true;
      if (fn === "claimPlatform") pool.platformPaid = true;
      if (fn === "sweepDust") pool.dustSwept = true;
      return `0x${sent.length}`;
    },
  };
  return { chain, sent, paid };
}

const memoryStore = (initial = null) => {
  let state = initial;
  return { load: () => (state ? JSON.parse(JSON.stringify(state)) : null), save: (s) => (state = JSON.parse(JSON.stringify(s))) };
};
const newBot = (chain, store = memoryStore()) => createPayoutBot({ chain, store, fromBlock: 100n });

test("a resolved pool pays the winner, the project and the platform with no clicks", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  const bot = newBot(chain);
  await bot.tick();
  assert.deepEqual(sent, ["settle", "claimFor:0xA", "claimProject", "claimPlatform"]);
  assert.equal(bot.status().markets[MARKET].done, true);
});

test("nothing is sent twice on the next pass", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  const bot = newBot(chain);
  await bot.tick();
  const before = sent.length;
  await bot.tick();
  assert.equal(sent.length, before);
});

test("rounding leftovers go out after every winner is paid", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 1n }, { bettor: "0xC", side: 0, amount: 2n }, { bettor: "0xB", side: 1, amount: 8n }] });
  await newBot(chain).tick();
  assert.equal(sent.at(-1), "sweepDust");
  assert.ok(sent.includes("claimFor:0xA") && sent.includes("claimFor:0xC"));
  assert.ok(!sent.includes("claimFor:0xB"), "the losing wallet gets nothing");
});

test("a one-sided pool refunds everyone", async () => {
  const { chain, sent } = fakeChain({ bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xD", side: 0, amount: 50n }] });
  await newBot(chain).tick();
  assert.deepEqual(sent, ["settle", "refundFor:0xA", "refundFor:0xD"]);
});

test("no winner yet: it waits, then pays when the result arrives", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  chain.ready = false;
  const bot = newBot(chain);
  await bot.tick();
  assert.equal(bot.status().markets[MARKET].done, false);
  assert.equal(bot.status().markets[MARKET].lastError, null);
  chain.ready = true;
  await bot.tick();
  assert.ok(sent.includes("claimFor:0xA"));
  assert.equal(bot.status().markets[MARKET].done, true);
});

test("a failed send is recorded and retried, and doesn't double pay", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  chain.failNext = 1;
  const bot = newBot(chain);
  await bot.tick();
  assert.match(bot.status().markets[MARKET].lastError, /rpc hiccup/);
  await bot.tick();
  assert.deepEqual(sent, ["settle", "claimFor:0xA", "claimProject", "claimPlatform"]);
});

test("a restart keeps the bettors and doesn't rescan from the start", async () => {
  const { chain, sent } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  chain.ready = false;
  const store = memoryStore();
  await newBot(chain, store).tick();
  assert.equal(store.load().cursor, "501");
  chain.ready = true;
  await newBot(chain, store).tick();
  assert.ok(sent.includes("claimFor:0xA"), "a bettor seen before the restart is still paid");
});

test("a bettor who already claimed by hand is skipped", async () => {
  const { chain, sent, paid } = fakeChain({ winner: 0, bets: [{ bettor: "0xA", side: 0, amount: 100n }, { bettor: "0xB", side: 1, amount: 100n }] });
  paid.add("0xA");
  await newBot(chain).tick();
  assert.ok(!sent.includes("claimFor:0xA"));
});
