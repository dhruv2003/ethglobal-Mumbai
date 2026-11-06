import { test } from "node:test";
import assert from "node:assert/strict";
import { autorunPass, nextStep } from "../src/arena/autorun.mjs";

const HASH = `0x${"ab".repeat(32)}`;
const match = { status: 1, scheduledStart: 100, deadline: 1000, cutoff: 90n, projectA: 0, projectB: 1 };
const live = { tournament: { status: 2 }, match, nowSec: 100, canPublish: true };

test("a live match with no fight starts one", () => {
  assert.equal(nextStep({ ...live, fight: { status: "none" } }), "start");
});
test("nothing starts before the match goes live, or after its deadline", () => {
  assert.equal(nextStep({ ...live, nowSec: 99, fight: { status: "none" } }), null);
  assert.equal(nextStep({ ...live, nowSec: 1000, fight: { status: "none" } }), null);
});
test("a running or failed fight is left alone", () => {
  assert.equal(nextStep({ ...live, fight: { status: "running" } }), null);
  assert.equal(nextStep({ ...live, fight: { status: "failed" } }), null);
});
test("a finished fight publishes only when this wallet is the publisher", () => {
  assert.equal(nextStep({ ...live, fight: { status: "done", resultHash: HASH } }), "publish");
  assert.equal(nextStep({ ...live, canPublish: false, fight: { status: "done", resultHash: HASH } }), null);
  assert.equal(nextStep({ ...live, fight: { status: "done", resultHash: "nope" } }), null);
});
test("closed matches and canceled tournaments do nothing", () => {
  assert.equal(nextStep({ ...live, match: { ...match, status: 3 }, fight: { status: "none" } }), null);
  assert.equal(nextStep({ ...live, tournament: { status: 4 }, fight: { status: "none" } }), null);
});
test("a pass reads each match and starts the live one with its real fighters", async () => {
  const started = [];
  await autorunPass({
    brackets: () => [{ id: "2", projects: [{}, {}] }],
    readTournament: async () => ({ status: 2, publisher: "0xAA", bettingCutoff: 80n }),
    readMatch: async () => match,
    nowSec: async () => 150n,
    fightOf: () => ({ status: "none" }),
    startFight: (...args) => started.push(args),
    publish: async () => assert.fail("nothing to publish"),
    botAddress: "0xBB",
  });
  assert.deepEqual(started, [["2", 0, { a: 0, b: 1, revealAt: 90000 }]]);
});
test("a pass publishes a finished fight when the bot is the publisher", async () => {
  const published = [];
  await autorunPass({
    brackets: () => [{ id: "2", projects: [{}, {}] }],
    readTournament: async () => ({ status: 2, publisher: "0xbb", bettingCutoff: 80n }),
    readMatch: async () => match,
    nowSec: async () => 150n,
    fightOf: () => ({ status: "done", resultHash: HASH }),
    startFight: () => assert.fail("already fought"),
    publish: async (id, i) => published.push([id, i]),
    botAddress: "0xBB",
  });
  assert.deepEqual(published, [[2n, 0n]]);
});
