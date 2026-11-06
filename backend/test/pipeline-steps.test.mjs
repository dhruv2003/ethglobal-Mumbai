import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-pipeline-steps-"));
process.env.JUDGE_PROVIDER = "openai";
process.env.OPENAI_API_KEY = crypto.randomUUID(); // never called: the judge is a stub
process.env.MOZARK_TOKEN = "";
process.env.MOZARK_ENV_FILE = path.join(process.env.ARENA_DATA_DIR, "no-token.env"); // no live test from tests
delete process.env.ARENA_SERVER;
const { runPipeline, STEPS } = await import("../src/reviewer/pipeline.mjs");
const { submissions, pipelines, judges } = await import("../src/store.mjs");
after(() => fs.rmSync(process.env.ARENA_DATA_DIR, { recursive: true, force: true }));

test("five steps in order; a failed step is marked and every later step still runs", async () => {
  assert.deepEqual(STEPS.map((s) => s.id), ["code", "demo", "live", "dossier", "judges"]);
  judges.save([{ id: "j1", name: "Priya" }, { id: "j2", name: "Marcus" }, { id: "j3", name: "Ana" }]);
  submissions.add({ id: "p1", project: { name: "Broken" }, repoUrl: "https://gitlab.com/team/broken", demoVideoUrl: "", demoImages: [] });
  let judged = false;
  const judge = async (_id, { onEvent }) => {
    judged = true;
    onEvent({ type: "judge", judgeId: "j1", status: "scored", overallHundredths: 6100 });
    return {
      panelHundredths: 6000,
      reviews: [
        { judge: { id: "j1", name: "Priya" }, status: "scored", overallHundredths: 6100 },
        { judge: { id: "j2", name: "Marcus" }, status: "scored", overallHundredths: 5900 },
        { judge: { id: "j3", name: "Ana" }, status: "declined", detail: "declined" },
      ],
    };
  };
  const state = await runPipeline("p1", { judge });
  const by = Object.fromEntries(state.steps.map((s) => [s.id, s]));

  assert.equal(by.code.status, "failed");
  assert.deepEqual(by.code.parts.map((p) => p.id), ["check", "clone", "pin", "history", "files", "tests"]);
  assert.deepEqual(by.code.parts.map((p) => p.status), ["failed", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  assert.match(by.code.parts[0].detail, /github/i);
  assert.equal(by.demo.status, "skipped");
  assert.equal(by.live.status, "skipped");
  assert.equal(by.dossier.status, "skipped");
  assert.match(by.dossier.detail, /code review/);
  assert.ok(judged, "the judges still score after earlier failures");
  assert.equal(by.judges.status, "done", "two of three judges scored: the review counts");
  assert.deepEqual(by.judges.parts.map((p) => p.status), ["done", "done", "failed"]);
  assert.match(by.judges.parts[0].detail, /Scored 61\.00/);
  assert.ok(by.judges.facts.some((f) => f.label === "Panel average" && f.value === "60.00 / 100"));
  assert.ok(state.finishedAt);
  assert.ok(state.steps.every((s) => s.status !== "queued" && s.status !== "running"));
  assert.equal(pipelines.get("p1").finishedAt, state.finishedAt);
});

test("a panel with fewer than three judges still judges", async () => {
  judges.save([{ id: "j1", name: "Priya", weights: { ui_ux: 60, code_quality: 40 } }]);
  submissions.add({ id: "p2", project: { name: "Solo" }, repoUrl: "https://gitlab.com/team/solo", demoVideoUrl: "", demoImages: [] });
  const seen = [];
  const judge = async () => ({ panelHundredths: 7000, reviews: [{ judge: { id: "j1", name: "Priya" }, status: "scored", overallHundredths: 7000 }] });
  const state = await runPipeline("p2", {
    judge: async (id, o) => {
      seen.push(state0());
      return judge(id, o);
    },
  });
  function state0() {
    return pipelines.get("p2").steps.find((s) => s.id === "judges").parts.map((p) => p.detail);
  }
  const j = state.steps.find((s) => s.id === "judges");
  assert.equal(j.status, "done");
  assert.match(seen[0][0], /Reading the/);
  assert.equal(pipelines.get("p2").steps.find((s) => s.id === "judges").parts[0].focus, "UI/UX 60% · Code quality 40%", "each judge says what they weigh most");
});
