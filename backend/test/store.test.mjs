import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, deleteProject, dossiers, liveDir, pipelines, repoDir, reviews, submissions } from "../src/store.mjs";

test("deleting a project removes it and everything stored for it, and nothing else", () => {
  submissions.add({ id: "del-1", project: { name: "Gone" } });
  submissions.add({ id: "keep-1", project: { name: "Stays" } });
  for (const store of [reviews, pipelines, dossiers]) store.save("del-1", { x: 1 });
  fs.mkdirSync(path.join(repoDir("del-1"), "src"), { recursive: true });
  fs.mkdirSync(path.join(liveDir("del-1"), "laptop"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "evidence", "del-1.json"), "{}");
  fs.writeFileSync(path.join(DATA_DIR, "evidence", "keep-1.json"), "{}");
  deleteProject("del-1");
  assert.equal(submissions.get("del-1"), null);
  assert.ok(submissions.get("keep-1"));
  for (const store of [reviews, pipelines, dossiers]) assert.equal(store.get("del-1"), null);
  assert.ok(!fs.existsSync(repoDir("del-1")) && !fs.existsSync(liveDir("del-1")));
  assert.ok(!fs.existsSync(path.join(DATA_DIR, "evidence", "del-1.json")));
  assert.ok(fs.existsSync(path.join(DATA_DIR, "evidence", "keep-1.json")));
  assert.ok(DATA_DIR.length > 0);
});
