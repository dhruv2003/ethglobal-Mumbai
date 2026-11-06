// Arena records on Arkiv: schemas, builders, payload encoding, write/read with fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-records-test-"));
delete process.env.ARKIV_PRIVATE_KEY;
delete process.env.PUBLISHER_PRIVATE_KEY;
process.env.ARKIV_PUBLISHER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const { createWalletClient, ExpirationTime } = await import("@arkiv-network/sdk");
const { rabdi } = await import("@arkiv-network/sdk/chains");
const { custom } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");
const { RECORDS, TYPES } = await import("../src/arkiv/records/schemas.mjs");
const build = await import("../src/arkiv/records/builders.mjs");
const store = await import("../src/arkiv/records/store.mjs");
const { loadProject } = await import("../src/projects.mjs");
const { validateForm } = await import("../src/judges/persona.mjs");
const { EXAMPLE_FORMS } = await import("../src/judges/seed.mjs");

const { seedProject } = await import("./seedProject.mjs");
const sample = loadProject(seedProject());
const tournament = {
  id: "7",
  title: "Finalists",
  track: "Open",
  matching: { resultHash: "ab".repeat(32) },
  projects: [
    { index: 0, submissionId: "p-one", name: "Project One" },
    { index: 1, submissionId: "p-two", name: "Project Two" },
  ],
};
const fight = { tournamentId: "7", match: 1, a: 0, b: 1, scores: { a: 8200, b: 7800 }, resultHash: "cd".repeat(32), events: [{ type: "result", winner: "a" }] };

const all = () =>
  [
    build.projectRecord(sample),
    build.projectRecord({ id: "p-one", kind: "submitted", submission: { name: "Project One", teamName: "Team", tracks: ["a"] } }, { ownerWallet: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", auth: { signature: "0xsecret" } }),
    build.pipelineRecord(sample, { finishedAt: "x", steps: [{ status: "done" }, { status: "failed" }] }),
    build.dossierRecord(sample),
    build.transcriptRecord(sample, { source: "fixture", text: "hello" }),
    build.livetestRecord(sample),
    build.visionRecord(sample, { model: "m", records: [{ id: "V-1" }] }),
    build.judgeRecord(validateForm(EXAMPLE_FORMS[0]).persona),
    build.tournamentRecord(tournament),
    build.fightRecord(fight, tournament),
  ].filter(Boolean);

test("every record type has a builder, and every built record has project identity where it should", () => {
  const types = new Set(all().map((r) => r.type));
  assert.deepEqual([...types].sort(), [...TYPES].sort());
  for (const r of all()) {
    if (["project", "pipeline", "dossier", "transcript", "livetest", "vision"].includes(r.type)) {
      assert.ok(r.attrs.projectId, r.type);
      assert.ok(r.attrs.projectName, r.type);
    }
  }
  const f = build.fightRecord(fight, tournament);
  assert.deepEqual([f.attrs.projectA, f.attrs.projectB, f.attrs.projectAName, f.attrs.winner], ["p-one", "p-two", "Project One", "a"]);
  assert.equal(Number(f.attrs.scoreA.value), 82);
});

test("signature material is never published", () => {
  const r = build.projectRecord({ id: "p", kind: "submitted", submission: { name: "P" } }, { ownerWallet: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", auth: { signature: "0xsecret" } });
  assert.doesNotMatch(JSON.stringify(r), /0xsecret|signature/);
});

test("nothing to record yet gives null", () => {
  assert.equal(build.pipelineRecord(sample, { finishedAt: null, steps: [] }), null);
  assert.equal(build.dossierRecord({ ...sample, dossier: null }), null);
  assert.equal(build.fightRecord(fight, null), null);
});

test("every built record passes the SDK's own schema check (nothing is sent)", async () => {
  // The SDK validates values before it sends; this transport refuses any request.
  const transport = custom({ request: async () => { throw new Error("offline"); } });
  const w = createWalletClient({ chain: rabdi({ accessKey: "x" }), transport, account: privateKeyToAccount(`0x${"11".repeat(32)}`) });
  for (const r of all()) {
    const [chunk] = store.encode(r.payload);
    const values = { ...r.attrs, writtenAt: (await import("@arkiv-network/sdk/schema")).u64(1n), hash: store.hashOf(r.payload), part: 0, parts: 1, enc: "gzip-json", payload: chunk };
    await assert.rejects(w.createEntity(RECORDS[r.type].schema, values, { expiration: ExpirationTime.fromDays(1), flags: { readonly: true } }), (e) => {
      assert.doesNotMatch(e.constructor.name, /Schema|InvalidValue|TooLarge|Missing/, `${r.type}: ${e.message}`);
      return true;
    });
  }
});

test("payloads round-trip through gzip, and big ones split into parts", () => {
  const big = { words: Array.from({ length: 60000 }, (_, i) => `w${i}-${Math.sin(i)}`) };
  const parts = store.encode(big);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= store.PART_BYTES));
  assert.deepEqual(store.decode(parts), big);
  assert.deepEqual(store.decode(store.encode(sample.dossier)), sample.dossier);
});

/** Fake chain: keeps created entities, answers queries by matching eq() conditions. */
function fakeChain() {
  const rows = [];
  const conds = (w) => (w.kind === "and" ? w.expressions.flatMap(conds) : [w]);
  const client = {
    createEntity: async (schema, values) => {
      const key = `0x${String(rows.length + 1).padStart(64, "0")}`;
      rows.push({ schema: schema.name, key, values });
      return { entityKey: key };
    },
  };
  const reader = {
    select: () => {
      const q = { where: [] };
      const b = {
        from: (s) => ((q.schema = s.name), b),
        ownedBy: () => b,
        where: (w) => (q.where.push(w), b),
        orderBy: () => b,
        limit: (n) => ((q.limit = n), b),
        fetch: async () => {
          const filters = q.where.flatMap(conds);
          const val = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);
          const hit = rows.filter((r) => r.schema === q.schema && filters.every((f) => String(val(r.values[f.name])) === String(val(f.value))));
          const out = hit.reverse().slice(0, q.limit ?? 100).map((r) => ({ $key: r.key, $owner: "0x", $expiresAt: 1n, ...Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, { value: k === "payload" ? `0x${Buffer.from(v).toString("hex")}` : val(v) }])) }));
          return { entities: out };
        },
      };
      return b;
    },
  };
  return { rows, client, reader };
}

test("writeRecord skips an unchanged record and readRecord reassembles the newest one", async () => {
  const chain = fakeChain();
  const r = build.dossierRecord(sample);
  const first = await store.writeRecord("dossier", r.attrs, r.payload, chain);
  assert.equal(first.skipped, false);
  const again = await store.writeRecord("dossier", r.attrs, r.payload, chain);
  assert.equal(again.skipped, true);
  assert.equal(chain.rows.length, 1);
  const back = await store.readRecord("dossier", { projectId: "go-health-me" }, chain);
  assert.deepEqual(back.payload, sample.dossier);
  assert.equal(back.projectName, sample.submission.name);
});
