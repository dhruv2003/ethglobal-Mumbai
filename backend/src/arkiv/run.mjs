#!/usr/bin/env node
/*
 * Publish a judged result to Swarm + Arkiv, or read it back, from the command line.
 *
 *   cd backend
 *   npm run arkiv -- publish --project go-health-me   upload the bundle, write the entities
 *   npm run arkiv -- read --project go-health-me      query Arkiv, then fetch review.json from Swarm
 *   npm run arkiv -- sync --project go-health-me      project, pipeline, dossier, transcript, live test, screenshot notes
 *   npm run arkiv -- sync --all                       every project, judge, tournament and fight on this server
 *   npm run arkiv -- sync --judges | --tournament <id> | --fight <t> <m>
 *   npm run arkiv -- get <type> --project <id>        newest record of a type, read back from Arkiv
 *                    (or --judge <id>, --tournament <id> [--match <m>])
 *
 * publish uses the latest saved review (data/reviews/<id>.json).
 */
import "dotenv/config";
import { loadProject } from "../projects.mjs";
import { reviews } from "../store.mjs";
import { readLatest } from "./arkiv.mjs";
import { publishRun } from "./publish.mjs";
import { readFile } from "./swarm.mjs";
import { TYPES } from "./records/schemas.mjs";
import { readRecord } from "./records/store.mjs";
import { syncAll, syncFight, syncJudges, syncProject, syncTournament } from "./records/sync.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, n = 1) => {
  const i = rest.indexOf(name);
  return i < 0 ? null : n === 1 ? rest[i + 1] : rest.slice(i + 1, i + 1 + n);
};
const has = (name) => rest.includes(name);
const id = opt("--project");
const usage = () => {
  console.error(
    [
      "usage: npm run arkiv -- publish|read --project <id>",
      "       npm run arkiv -- sync --project <id> | --all | --judges | --tournament <id> | --fight <t> <m>",
      "       npm run arkiv -- get <type> --project <id> | --judge <id> | --tournament <id> [--match <m>]",
    ].join("\n"),
  );
  process.exit(2);
};
if (!["publish", "read", "sync", "get"].includes(cmd) || (["publish", "read"].includes(cmd) && !id)) usage();
/** Print one line per record written, skipped (unchanged) or failed. */
const report = (rows) => {
  for (const r of rows) console.log(r.error ? `  ✕ ${r.type}: ${r.error}` : `  ${r.skipped ? "=" : "+"} ${r.type}: ${r.entityKeys.join(", ")}${r.skipped ? " (unchanged)" : ""}`);
  return rows.some((r) => r.error);
};

try {
  if (cmd === "publish") {
    const project = loadProject(id);
    if (!project) throw new Error(`No such project: ${id}`);
    const result = reviews.get(id);
    if (!result) throw new Error(`No judged result for ${id}. Run the judges first: npm run judge -- --project ${id}`);
    const record = await publishRun(project, result, { log: (m) => console.log(m) });
    console.log(JSON.stringify(record, null, 2));
    if (record.arkivError) process.exit(1);
  } else if (cmd === "sync") {
    let failed = false;
    if (has("--all")) {
      const out = await syncAll();
      console.log("judges"); failed = report(out.judges) || failed;
      for (const [k, rows] of Object.entries({ ...out.projects, ...out.tournaments, ...out.fights })) { console.log(k); failed = report(rows) || failed; }
    } else if (id) failed = report(await syncProject(id));
    else if (has("--judges")) failed = report(await syncJudges());
    else if (opt("--tournament")) failed = report(await syncTournament(opt("--tournament")));
    else if (opt("--fight", 2)?.length === 2) failed = report(await syncFight(opt("--fight", 2)[0], Number(opt("--fight", 2)[1])));
    else usage();
    if (failed) process.exit(1);
  } else if (cmd === "get") {
    const type = rest[0];
    if (!TYPES.includes(type)) throw new Error(`Unknown type "${type}". One of: ${TYPES.join(", ")}`);
    const identity = type === "judge" ? { judgeId: opt("--judge") } : type === "tournament" ? { tournamentId: opt("--tournament") } : type === "fight" ? { tournamentId: opt("--tournament"), match: Number(opt("--match")) } : { projectId: id };
    if (Object.values(identity).some((v) => v == null || Number.isNaN(v))) usage();
    const r = await readRecord(type, identity);
    if (!r) {
      console.log(`Nothing published on Arkiv for that ${type} yet.`);
      process.exit(1);
    }
    const { payload, ...columns } = r;
    console.log(JSON.stringify(columns, null, 2));
    console.log(`payload: ${JSON.stringify(payload).length} bytes of JSON, keys: ${Object.keys(payload).slice(0, 12).join(", ")}`);
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
