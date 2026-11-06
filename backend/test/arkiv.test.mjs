// Arkiv + Swarm publishing, with the chain and the Bee node replaced by fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-arkiv-test-"));
delete process.env.ARKIV_PRIVATE_KEY;
delete process.env.BEE_URL;
delete process.env.SWARM_BATCH_ID;
process.env.ARKIV_PUBLISHER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const arkiv = await import("../src/arkiv/arkiv.mjs");
const swarm = await import("../src/arkiv/swarm.mjs");
const { publishRun, lastPublish, liveOf } = await import("../src/arkiv/publish.mjs");
const { loadProject } = await import("../src/projects.mjs");

const { seedProject } = await import("./seedProject.mjs");
const sample = loadProject(seedProject());
const result = JSON.parse(fs.readFileSync(new URL("../fixtures/go-health-me/reviews.json", import.meta.url), "utf8"));
const KEY = (n) => `0x${String(n).repeat(64).slice(0, 64)}`;

test("scores become exact decimals; strings fit the 128-byte limit", () => {
  assert.equal(arkiv.hundredthsToDec(7233), "72.33");
  assert.equal(arkiv.hundredthsToDec(5), "0.05");
  assert.equal(arkiv.hundredthsToDec(10000), "100.00");
  assert.equal(Buffer.byteLength(arkiv.clip128("é".repeat(100))), 128);
  assert.equal(arkiv.clip128("short"), "short");
});

test("panel and scorecard values follow the schemas", () => {
  const p = arkiv.panelValues("go-health-me", result, "ab".repeat(32));
  assert.equal(p.projectId, "go-health-me");
  assert.equal(p.panelScore.value, arkiv.hundredthsToDec(result.panelHundredths));
  assert.equal(p.runAt.value, BigInt(Math.floor(Date.parse(result.ranAt) / 1000)));
  assert.equal(p.swarmRef, "ab".repeat(32));
  assert.equal(arkiv.panelValues("x", result, null).swarmRef, undefined);
  const s = arkiv.scorecardValues("go-health-me", KEY(1), result.reviews[0]);
  assert.equal(s.panel.value, KEY(1));
  assert.equal(s.judgeId, result.reviews[0].judge.id);
  const failed = arkiv.scorecardValues("x", KEY(1), { ...result.reviews[0], status: "invalid", review: null });
  assert.equal(failed.overall, undefined);
  assert.equal(failed.headline, undefined);
});

test("publishPanel writes one readonly panel, then one scorecard per judge linked to it", async () => {
  const writes = [];
  const client = {
    createEntity: async (schema, values, options) => {
      writes.push({ schema, values, options });
      return { entityKey: KEY(writes.length), txHash: `0xtx${writes.length}`, expiresAt: 999n };
    },
  };
  const out = await arkiv.publishPanel("go-health-me", result, { swarmRef: "cd".repeat(32), client });
  assert.equal(writes.length, 1 + result.reviews.length);
  assert.equal(writes[0].schema, arkiv.Panels);
  assert.ok(writes.every((w) => w.options.flags.readonly === true));
  assert.ok(writes.slice(1).every((w) => w.schema === arkiv.Scorecards && w.values.panel.value === KEY(1)));
  assert.equal(out.panelKey, KEY(1));
  assert.equal(out.scorecards.length, result.reviews.length);
  await assert.rejects(arkiv.publishPanel("x", { ...result, panelHundredths: null }, { client }), /no judge scored/);
});

test("the evidence bundle holds the review, dossier and live-test media at stable paths", async () => {
  const { dir, files } = swarm.stageBundle({ result, dossier: sample.dossier, ...(await liveOf(sample)) });
  try {
    assert.ok(files.includes("review.json") && files.includes("dossier.json") && files.includes("live/smoke.json"));
    assert.ok(files.includes("live/laptop/video.mp4"));
    assert.ok(files.every((f) => fs.existsSync(path.join(dir, f))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(swarm.gatewayUrl("ab", "review.json"), "https://api.gateway.ethswarm.org/bzz/ab/review.json");
});

test("publishRun: Swarm first, its reference goes into Arkiv; the outcome is saved", async () => {
  let seenRef;
  const record = await publishRun(sample, result, {
    upload: async () => ({ reference: "ef".repeat(32), files: ["review.json"] }),
    publish: async (id, r, { swarmRef }) => ((seenRef = swarmRef), { panelKey: KEY(7), txHash: "0xtx", scorecards: [] }),
  });
  assert.equal(seenRef, "ef".repeat(32));
  assert.equal(record.arkiv.panelKey, KEY(7));
  assert.deepEqual(lastPublish("go-health-me").arkiv, record.arkiv);
});

test("publishRun: a Swarm failure still publishes to Arkiv, without a reference", async () => {
  let seenRef = "unset";
  const record = await publishRun(sample, result, {
    upload: async () => {
      throw new Error("no stamp");
    },
    publish: async (id, r, { swarmRef }) => ((seenRef = swarmRef), { panelKey: KEY(8), scorecards: [] }),
  });
  assert.equal(seenRef, null);
  assert.match(record.swarmError, /no stamp/);
  assert.equal(record.arkiv.panelKey, KEY(8));
});

/** A fake public client: records each query and answers from `pages`. */
function fakeReader(pages) {
  const queries = [];
  const builder = (sel) => {
    const q = { sel, parts: [] };
    const b = {
      from: (s) => ((q.schema = s.name ?? s), b),
      ownedBy: (o) => ((q.owner = o), b),
      where: (w) => (q.parts.push(w), b),
      orderBy: () => b,
      limit: () => b,
      fetch: async () => (queries.push(q), { entities: pages[queries.length - 1] ?? [] }),
    };
    return b;
  };
  return { queries, client: { select: builder, getBlockTiming: async () => ({ currentBlock: 100n, currentBlockTime: 1_800_000_000, blockDuration: 2 }) } };
}
const val = (value) => ({ value });

test("readLatest reads the newest panel by the publisher, then its scorecards", async () => {
  const { client, queries } = fakeReader([
    [{ $key: KEY(1), $owner: process.env.ARKIV_PUBLISHER, $expiresAt: 150n, projectId: val("go-health-me"), runAt: val(1_790_000_000n), panelScore: val("52.53"), complete: val(true), judges: val(3), provider: val("0g"), model: val("m"), swarmRef: val("ab".repeat(32)) }],
    [{ $key: KEY(2), judgeId: val("j1"), judgeName: val("Priya"), status: val("scored"), overall: val("53.4"), headline: val("Solid") }],
  ]);
  const r = await arkiv.readLatest("go-health-me", { client });
  assert.equal(queries.length, 2);
  assert.ok(queries.every((q) => q.owner === process.env.ARKIV_PUBLISHER));
  assert.equal(r.panel.panelScore, "52.53");
  assert.equal(r.panel.expiresAt, new Date((1_800_000_000 + 50 * 2) * 1000).toISOString());
  assert.equal(r.scorecards[0].overall, "53.4");
  assert.equal(r.swarm.review, swarm.gatewayUrl("ab".repeat(32), "review.json"));
  assert.match(r.panel.explorer, /^https:\/\/rabdi\.explorer\.arkiv\.network\/entity-explorer\?q=/);
  assert.equal(await arkiv.readLatest("none", { client: fakeReader([[]]).client }), null);
});

test("readLatest skips a half-written panel (a write that failed after some scorecards) for the newest complete one", async () => {
  const panel = (k, score) => ({ $key: KEY(k), $owner: process.env.ARKIV_PUBLISHER, $expiresAt: 150n, projectId: val("tripwire"), runAt: val(1_790_000_000n), panelScore: val(score), complete: val(true), judges: val(3), provider: val("0g"), model: val("m") });
  const card = (k, name) => ({ $key: KEY(k), judgeId: val(name), judgeName: val(name), status: val("scored"), overall: val("60"), headline: val("h") });
  const { client } = fakeReader([
    [panel(1, "62.26"), panel(2, "62.26")], // same run, written twice; the first write broke halfway
    [card(10, "Priya")], // panel 1: only 1 of 3 scorecards
    [card(20, "Priya"), card(21, "Marcus"), card(22, "Ana")], // panel 2: complete
  ]);
  const r = await arkiv.readLatest("tripwire", { client });
  assert.equal(r.panel.entityKey, KEY(2));
  assert.equal(r.scorecards.length, 3);
});

test("private keys work with or without 0x; bad ones get a clear error", () => {
  const hex = "ab".repeat(32);
  assert.equal(arkiv.normalizeKey(hex), `0x${hex}`);
  assert.equal(arkiv.normalizeKey(` "0x${hex}" `), `0x${hex}`);
  assert.throws(() => arkiv.normalizeKey("abc"), /64 hex characters/);
});
