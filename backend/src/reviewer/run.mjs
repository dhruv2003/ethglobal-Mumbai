#!/usr/bin/env node
/* Run the full review for a submitted project: node src/reviewer/run.mjs --project <id> */
import "dotenv/config";
import { reviewNow } from "../api.mjs";
import { runPipeline } from "./pipeline.mjs";
import { flushFiles } from "../zg/files.mjs";

const i = process.argv.indexOf("--project");
const id = i > 0 ? process.argv[i + 1] : null;
if (!id) {
  console.error("usage: node src/reviewer/run.mjs --project <id>");
  process.exit(2);
}
try {
  const state = await runPipeline(id, { judge: reviewNow });
  for (const s of state.steps) console.log(`${s.status.padEnd(8)} ${s.title}${s.detail ? ` · ${s.detail}` : ""}`);
  console.log("Waiting for Arkiv to store everything…");
  await flushFiles();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
