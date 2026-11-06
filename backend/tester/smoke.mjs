#!/usr/bin/env node
/*
 * Command line for the live test engine (runner.mjs), for sample projects
 * whose flows are written by hand in backend/fixtures/<id>/flows.json.
 *
 *   set -a; source ~/.mozark.env; set +a
 *   node smoke.mjs --project go-health-me [--url https://app] [--devices laptop,phone]
 *
 * Submitted projects are tested automatically by the review pipeline instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveTest } from "./runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.project) {
  console.error("usage: node smoke.mjs --project <fixture-id> [--url <https://app>] [--devices laptop,phone]");
  process.exit(2);
}
if (!process.env.MOZARK_TOKEN) {
  console.error("MOZARK_TOKEN is not set. Run: set -a; source ~/.mozark.env; set +a");
  process.exit(2);
}
const fixtureDir = path.resolve(here, "../fixtures", args.project);
const flowsFile = path.join(fixtureDir, "flows.json");
const flows = fs.existsSync(flowsFile) ? JSON.parse(fs.readFileSync(flowsFile, "utf8")) : { phases: [] };
const summary = await runLiveTest({
  project: args.project,
  target: args.url ?? flows.target,
  flows,
  outDir: path.join(fixtureDir, "smoke"),
  token: process.env.MOZARK_TOKEN,
  devices: (args.devices ?? "laptop,phone").split(",").map((d) => d.trim()),
  flowsSource: fs.existsSync(flowsFile) ? `fixtures/${args.project}/flows.json` : null,
});
console.log(`\nwrote ${path.relative(process.cwd(), path.join(fixtureDir, "smoke", "smoke.json"))}`);
process.exit(summary.runs.some((r) => r.outcome.status === "failed") ? 1 : 0);
