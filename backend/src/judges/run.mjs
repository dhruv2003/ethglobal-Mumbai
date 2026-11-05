#!/usr/bin/env node
/*
 * Run the judge panel on one project from the command line.
 *
 *   cd backend && node src/judges/run.mjs --project go-health-me
 *
 * Saves to backend/data/reviews/<id>.json. For sample projects it also writes
 * backend/fixtures/<id>/reviews.json so the static web app can show it.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewNow } from "../api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf("--project");
const id = i > 0 ? process.argv[i + 1] : null;
if (!id) {
  console.error("usage: node src/judges/run.mjs --project <id>");
  process.exit(2);
}
try {
  console.log(`Judging ${id}…`);
  const result = await reviewNow(id);
  for (const r of result.reviews) {
    const score = r.status === "scored" ? (r.overallHundredths / 100).toFixed(2) : r.status;
    console.log(`- ${r.judge.name}: ${score}${r.review ? ` · ${r.review.headline}` : r.detail ? ` · ${r.detail}` : ""}`);
  }
  console.log(`Panel: ${result.panelHundredths == null ? "no score" : (result.panelHundredths / 100).toFixed(2)}${result.complete ? "" : " (incomplete)"}`);
  const fixture = path.resolve(here, "../../fixtures", id);
  if (fs.existsSync(path.join(fixture, "submission.json"))) {
    fs.writeFileSync(path.join(fixture, "reviews.json"), JSON.stringify(result, null, 2));
    console.log(`wrote fixtures/${id}/reviews.json`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
