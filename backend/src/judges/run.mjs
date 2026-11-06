#!/usr/bin/env node
/*
 * Run the judge panel on one project from the command line.
 *
 *   cd backend && npm run judge -- --project go-health-me [--evidence] [--fresh-evidence] [--out file.json]
 *
 *   --evidence        a vision model on 0G reads the live-test screenshots first
 *   --out <file>      also write the result here
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewNow } from "../api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const id = value("--project");
if (!id) {
  console.error("usage: node src/judges/run.mjs --project <id> [--evidence] [--fresh-evidence] [--out file.json]");
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
    for (const f of r.fallbacks ?? []) console.log(`  attempt ${f.attempt}: 0G failed (${f.reason}), answered by ${f.provider} ${f.model}`);
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
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
