#!/usr/bin/env node
/*
 * Publish a judged result to Swarm + Arkiv, or read it back, from the command line.
 *
 *   cd backend
 *   npm run arkiv -- publish --project go-health-me   upload the bundle, write the entities
 *   npm run arkiv -- read --project go-health-me      query Arkiv, then fetch review.json from Swarm
 *
 * publish uses the latest saved review (data/reviews/<id>.json, or the sample's fixture).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../projects.mjs";
import { reviews } from "../store.mjs";
import { readLatest } from "./arkiv.mjs";
import { publishRun } from "./publish.mjs";
import { readFile } from "./swarm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const i = rest.indexOf("--project");
const id = i >= 0 ? rest[i + 1] : null;
if (!["publish", "read"].includes(cmd) || !id) {
  console.error("usage: npm run arkiv -- publish|read --project <id>");
  process.exit(2);
}

try {
  if (cmd === "publish") {
    const project = loadProject(id);
    if (!project) throw new Error(`No such project: ${id}`);
    const fixture = path.resolve(here, "../../fixtures", id, "reviews.json");
    const result = reviews.get(id) ?? (fs.existsSync(fixture) ? JSON.parse(fs.readFileSync(fixture, "utf8")) : null);
    if (!result) throw new Error(`No judged result for ${id}. Run the judges first: npm run judge -- --project ${id}`);
    const record = await publishRun(project, result, { log: (m) => console.log(m) });
    console.log(JSON.stringify(record, null, 2));
    if (record.arkivError) process.exit(1);
  } else {
    const r = await readLatest(id);
    if (!r) {
      console.log(`Nothing published on Arkiv for ${id} by this publisher yet.`);
      process.exit(1);
    }
    console.log(`Panel ${r.panel.panelScore} · ${r.scorecards.length} scorecards · expires ${r.panel.expiresAt}`);
    console.log(`Entity ${r.panel.entityKey}\n  ${r.panel.explorer}`);
    for (const s of r.scorecards) console.log(`- ${s.judgeName}: ${s.overall ?? s.status}  ${s.entityKey}`);
    console.log(`Query: ${r.query}`);
    if (r.swarm) {
      const review = JSON.parse(await readFile(r.swarm.reference, "review.json"));
      console.log(`Swarm ${r.swarm.reference}\n  ${r.swarm.review}\n  review.json from Swarm: panel ${(review.panelHundredths / 100).toFixed(2)}, ${review.reviews.length} judges, ran ${review.ranAt}`);
    } else console.log("No Swarm reference on this panel.");
  }
} catch (e) {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
}
