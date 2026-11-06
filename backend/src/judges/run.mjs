#!/usr/bin/env node
/*
 * Run the judge panel on one project from the command line.
 *
 *   cd backend && npm run judge -- --project go-health-me [--evidence] [--fresh-evidence] [--no-fixture] [--out file.json]
 *
 * Saves to backend/data/reviews/<id>.json (and, with ZG_STORAGE=1, archives it on
 * 0G Storage before exiting; prints "pending" if 0G is slow). For sample projects it also writes
 * backend/fixtures/<id>/reviews.json so the static web app can show it, unless
 * --no-fixture is given (use that to compare models before picking one).
 *   --evidence        a vision model on 0G reads the live-test screenshots first
 *   --out <file>      also write the result here
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewNow } from "../api.mjs";
import { zgStatus } from "../store.mjs";
import * as archive from "../zg/archive.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const id = value("--project");
if (!id) {
  console.error("usage: node src/judges/run.mjs --project <id> [--evidence] [--fresh-evidence] [--no-fixture] [--out file.json]");
  process.exit(2);
}
const usd = (micro) => `$${(micro / 1e6).toFixed(4)}`;
try {
  const started = Date.now();
  console.log(`Judging ${id}…`);
  const evidence = flag("--evidence") || flag("--fresh-evidence") || undefined;
  const result = await reviewNow(id, { evidence, freshEvidence: flag("--fresh-evidence"), log: console.log });
  console.log(`${result.provider} · ${result.model} · effort ${result.effort}`);
  for (const r of result.reviews) {
    const score = r.status === "scored" ? (r.overallHundredths / 100).toFixed(2) : r.status;
    console.log(`- ${r.judge.name}: ${score}${r.review ? ` · ${r.review.headline}` : r.detail ? ` · ${r.detail}` : ""}`);
    if (r.status !== "scored" || r.attempts > 1) console.log(`  attempts: ${r.attempts}`);
    for (const t of r.traces ?? []) console.log(`  0G request ${t.requestId} · provider ${t.provider ?? "?"} · ${t.costUsdMicro == null ? "cost not reported" : usd(t.costUsdMicro)}`);
  }
  console.log(`Panel: ${result.panelHundredths == null ? "no score" : (result.panelHundredths / 100).toFixed(2)}${result.complete ? "" : " (incomplete)"}`);
  if (result.zg) {
    const z = result.zg;
    console.log(`0G: ${z.calls} calls, ${usd(z.costUsdMicro)} (judges ${usd(z.judgeCostUsdMicro)}, evidence ${usd(z.evidenceCostUsdMicro)})${z.uncostedCalls ? `, ${z.uncostedCalls} without a reported cost` : ""}`);
  }
  console.log(`Took ${Math.round((Date.now() - started) / 1000)} s`);
  const out = value("--out");
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), JSON.stringify(result, null, 2));
    console.log(`wrote ${out}`);
  }
  const fixture = path.resolve(here, "../../fixtures", id);
  if (!flag("--no-fixture") && fs.existsSync(path.join(fixture, "submission.json"))) {
    fs.writeFileSync(path.join(fixture, "reviews.json"), JSON.stringify(result, null, 2));
    console.log(`wrote fixtures/${id}/reviews.json`);
  }
  if (archive.enabled()) {
    console.log("Archiving on 0G Storage…");
    const left = await archive.drain({ timeoutMs: Number(process.env.ZG_STORAGE_DRAIN_MS) || 5 * 60_000 });
    const st = zgStatus("review", id);
    if (st.status === "stored") console.log(`0G Storage: review stored · root ${st.rootHash} · tx ${st.txHash ?? "(already on network)"}${st.links?.tx ? ` · ${st.links.tx}` : ""}`);
    else console.log(`0G Storage: review ${st.status}${st.error ? ` (${st.error})` : ""}; the server will keep retrying.`);
    const head = archive.loadHead();
    if (head) console.log(`0G Storage head manifest: ${head.rootHash}`);
    if (left.pending || left.failed) console.log(`0G outbox: ${left.pending} pending, ${left.failed} failed`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
process.exit(0);
