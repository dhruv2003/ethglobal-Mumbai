// ENSv2 names and records: the pure parts (labels, record values, encodings). The chain isn't called.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-ens-test-"));
delete process.env.ENS_PRIVATE_KEY;
delete process.env.ENS_WRITER_PRIVATE_KEY;
delete process.env.ENS_PARENT;

const ens = await import("../src/ens/ens.mjs");
const result = JSON.parse(fs.readFileSync(new URL("../fixtures/go-health-me/reviews.json", import.meta.url), "utf8"));

test("project names become ENS-safe labels", () => {
  assert.equal(ens.slugLabel("Go Health Me!"), "go-health-me");
  assert.equal(ens.slugLabel("  Café   Ünïcode  "), "cafe-unicode");
  assert.equal(ens.slugLabel("---"), "");
  assert.ok(ens.slugLabel("x".repeat(80)).length <= 40);
  assert.ok(!ens.slugLabel(`${"a".repeat(39)} b`).endsWith("-"));
});

test("a label is never given out twice", () => {
  const taken = new Set(["stays"]);
  assert.equal(ens.chooseLabel({ id: "abc", text: "New One", taken }), "new-one");
  assert.equal(ens.chooseLabel({ id: "1234abcd-ef", text: "Stays", taken }), "stays-1234ab");
  taken.add("stays-1234ab");
  assert.equal(ens.chooseLabel({ id: "1234abcd-ef", text: "Stays", taken }), "stays-2");
  assert.equal(ens.chooseLabel({ id: "judge_8b8b", text: "Priya Raman", prefix: "judge-", taken }), "judge-priya-raman");
  assert.equal(ens.chooseLabel({ id: "9f2c1d00-aaaa", text: "!!!", taken }), "9f2c1d00");
});

test("score records come from the saved run, exactly", () => {
  const t = ens.scoreTexts(result, "0xkey");
  assert.deepEqual(Object.keys(t), ens.SCORE_KEYS);
  assert.equal(t["arena.score"], (result.panelHundredths / 100).toFixed(2));
  assert.equal(t["arena.judges"], `${result.reviews.filter((r) => r.status === "scored").length}/${result.reviews.length}`);
  assert.equal(t["arena.ranAt"], new Date(result.ranAt).toISOString());
  assert.equal(t["arena.arkiv"], "0xkey");
  assert.equal(ens.scoreTexts(result, null)["arena.arkiv"], "");
});

test("a judge's agent-context is their persona, as JSON", () => {
  const judge = { id: "j1", version: 2, name: "Priya Raman", title: "Product lead", background: "b", expectations: "e", dealBreakers: "d", browniePoints: "p", tone: "balanced", weights: { ui_ux: 15 }, systemPrompt: "secret-ish prompt" };
  const ctx = JSON.parse(ens.agentContext(judge));
  assert.equal(ctx.type, "fightclub.judge");
  assert.equal(ctx.name, "Priya Raman");
  assert.deepEqual(ctx.weights, { ui_ux: 15 });
  assert.equal(ctx.personaVersion, 2);
  assert.equal(ctx.systemPrompt, undefined);
});

test("names are DNS-encoded for ENSv2 resolver setters; config has no names until issued", () => {
  assert.equal(ens.dnsName("a.fightclub.eth"), "0x0161096669676874636c75620365746800");
  assert.equal(ens.parentName(), "fightclub.eth");
  assert.equal(ens.projectName("nope"), null);
  const cfg = ens.publicConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.parent, "fightclub.eth");
  assert.deepEqual(cfg.projects, {});
  assert.ok(cfg.fighterKeys.includes("arena.score"));
});

// A 4-project bracket: slots 0-3, matches 0 (0v1), 1 (2v3), 2 (final). Scores in hundredths, winner is a slot.
const projects = ["p0", "p1", "p2", "p3"].map((submissionId, i) => ({ submissionId, name: `Project ${i}` }));
const match = (projectA, projectB, winner, scoreA, scoreB, status = 3) => ({ status, projectA, projectB, winner, scoreA, scoreB });

test("fight records are tallied from finalized matches, mapping slots to submissions", () => {
  const t = ens.tallyFights([
    { id: "7", projects, tournament: { status: 3, champion: 2 }, matches: [match(0, 1, 0, 8210, 7400), match(2, 3, 2, 9000, 6000), match(0, 2, 2, 7000, 7100)] },
  ]);
  assert.deepEqual([t.p0.wins, t.p0.losses, t.p0.titles], [1, 1, 0]);
  assert.deepEqual([t.p1.wins, t.p1.losses], [0, 1]);
  assert.deepEqual([t.p2.wins, t.p2.losses, t.p2.titles], [2, 0, 1]);
  assert.deepEqual([t.p3.wins, t.p3.losses], [0, 1]);
  assert.deepEqual(t.p0.last, { won: false, tournamentId: "7", match: 2, opponentId: "p2", opponentName: "Project 2", mine: "70.00", theirs: "71.00" });
});

test("open, voided and canceled-tournament matches don't count; brackets add up across tournaments", () => {
  const t = ens.tallyFights([
    { id: "9", projects, tournament: { status: 2 }, matches: [match(0, 1, 1, 5000, 6000), match(2, 3, 0, 0, 0, 1), match(0, 0, 0, 0, 0, 0)] },
    { id: "8", projects, tournament: { status: 4 }, matches: [match(0, 1, 0, 9000, 1000)] },
    { id: "3", projects: [projects[1], projects[0]], tournament: { status: 3, champion: 0 }, matches: [match(0, 1, 0, 8000, 7000)] },
  ]);
  assert.deepEqual([t.p1.wins, t.p1.losses, t.p1.titles], [2, 0, 1]);
  assert.deepEqual([t.p0.wins, t.p0.losses], [0, 2]);
  assert.equal(t.p2, undefined);
  assert.equal(t.p1.last.tournamentId, "9"); // newest tournament last
});

test("record texts: W-L, titles, and the last fight against the opponent's ENS name", () => {
  const t = ens.tallyFights([{ id: "7", projects, tournament: { status: 2 }, matches: [match(0, 1, 0, 8210, 7400)] }]);
  const texts = ens.recordTexts(t.p0, (id) => (id === "p1" ? "p1.fightclub.eth" : null));
  assert.deepEqual(Object.keys(texts), ens.RECORD_KEYS);
  assert.equal(texts["arena.record"], "1-0");
  assert.equal(texts["arena.titles"], "0");
  assert.equal(texts["arena.lastFight"], "W vs p1.fightclub.eth, 82.10-74.00 (tournament #7, match 1)");
  assert.equal(ens.recordTexts(t.p1)["arena.lastFight"], "L vs Project 0, 74.00-82.10 (tournament #7, match 1)");
  assert.ok(ens.WRITER_KEYS.every((k) => ens.FIGHTER_KEYS.includes(k)));
});

test("pendingWork: only what ENS is missing, so a restart sends nothing twice", async () => {
  const { pendingWork } = await import("../src/ens/ens.mjs");
  const issued = { judges: { j1: { profileTx: "0x1" }, j2: { label: "half-done" } }, projects: { a: { profileTx: "0x2", scoreTx: "0x3" }, b: { profileTx: "0x4" } } };
  assert.deepEqual(pendingWork(issued, { judgeIds: ["j1", "j2"], projectIds: ["a", "b", "c"], judgedIds: ["a", "b"] }), { judges: ["j2"], projects: ["c"], scores: ["b"] });
  assert.deepEqual(pendingWork({ judges: {}, projects: {} }, { judgeIds: [], projectIds: [], judgedIds: [] }), { judges: [], projects: [], scores: [] });
});
