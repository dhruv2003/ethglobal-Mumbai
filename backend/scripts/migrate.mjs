#!/usr/bin/env node
/*
 * One-time move of an old backend/data folder (from before the arena kept nothing on disk)
 * to where everything lives now: records into the Arkiv database, files onto 0G Storage.
 *
 *   cd backend && npm run migrate -- [path/to/data]      default: ./data
 *   add --dry-run to only list what would move
 *
 * Needs ARKIV_PRIVATE_KEY (records) and ZG_STORAGE=1 + ZG_STORAGE_PRIVATE_KEY (files) in .env.
 * Safe to run twice: records already identical on Arkiv and files with the same bytes are
 * skipped. Not moved: arena-embeddings (recomputed on the next matchmaking), arena-proposals
 * (only valid until a bracket is registered), repos and work (scratch), zg-* (the old 0G archive).
 * Delete the folder yourself once the summary shows no failures.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const DIR = path.resolve(args.find((a) => !a.startsWith("--")) ?? "data");
if (!fs.existsSync(DIR)) {
  console.error(`No data folder at ${DIR}`);
  process.exit(2);
}

const { db } = await import("../src/store.mjs");
const { flushFiles, putFile } = await import("../src/zg/files.mjs");
const { MIME } = await import("../src/reviewer/media.mjs");

const read = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, rel), "utf8"));
  } catch {
    return undefined;
  }
};
const jsonFiles = (rel) => (fs.existsSync(path.join(DIR, rel)) ? fs.readdirSync(path.join(DIR, rel)).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp")) : []);
const counts = {};
const record = (collection, id, value) => {
  if (value === undefined || value === null) return;
  counts[collection] = (counts[collection] ?? 0) + 1;
  if (!dry) db.put(collection, String(id), value);
};
const file = (scope, name, full, kind) => {
  if (!fs.existsSync(full)) return;
  const ext = path.extname(full).slice(1).toLowerCase();
  counts[`0G files: ${kind}`] = (counts[`0G files: ${kind}`] ?? 0) + 1;
  if (!dry) putFile(scope, name, fs.readFileSync(full), { mime: MIME[ext] ?? (ext === "jpeg" ? "image/jpeg" : "application/octet-stream"), kind });
};

// Records -> Arkiv
const judges = read("judges.json");
if (judges) record("judges", "panel", judges);
for (const s of read("submissions.json") ?? []) record("submissions", s.id, s);
for (const e of read("events.json") ?? []) record("events", e.id, e);
for (const [dir, collection] of [["reviews", "reviews"], ["pipeline", "pipelines"], ["dossiers", "dossiers"], ["transcripts", "transcripts"], ["evidence", "evidence"], ["voice-notes", "voice-notes"], ["arkiv", "arkiv-publishes"]]) {
  for (const f of jsonFiles(dir)) record(collection, f.slice(0, -5), read(`${dir}/${f}`));
}
for (const f of jsonFiles("arena-tournaments")) {
  const t = read(`arena-tournaments/${f}`);
  if (t) record("tournaments", t.id ?? f.slice(0, -5), t);
}
for (const f of jsonFiles("arena-fights")) {
  const x = read(`arena-fights/${f}`);
  if (x) record("fights", `${x.tournamentId}-${Number(x.match)}`, x);
}
const payouts = read("payouts.json");
if (payouts) record("payouts", "bot", payouts);
const claims = read("world-claims.json");
if (claims) record("world-claims", "all", claims);

// Demo videos: facts -> Arkiv, the video -> 0G
for (const id of fs.existsSync(path.join(DIR, "media")) ? fs.readdirSync(path.join(DIR, "media")) : []) {
  const v = read(`media/${id}/video.json`);
  if (!v) continue;
  record("videos", id, v);
  if (v.ext) file(id, `demo.${v.ext}`, path.join(DIR, "media", id, `demo.${v.ext}`), "demo-video");
}

// Live tests: the report -> Arkiv, recordings and screenshots -> 0G
for (const id of fs.existsSync(path.join(DIR, "live")) ? fs.readdirSync(path.join(DIR, "live")) : []) {
  const smoke = read(`live/${id}/smoke.json`);
  if (!smoke) continue;
  record("livetests", id, smoke);
  for (const device of ["laptop", "phone"]) {
    const d = path.join(DIR, "live", id, device);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f === "video.mp4") file(id, `live/${device}/${f}`, path.join(d, f), "live-recording");
      else if (/^smoke-(laptop|phone)-[a-z0-9]+\.jpg$/.test(f)) file(id, `live/${device}/${f}`, path.join(d, f), "live-screenshot");
    }
  }
}

// Uploads the teams made -> 0G
const up = path.join(DIR, "uploads");
for (const f of fs.existsSync(up) ? fs.readdirSync(up) : []) {
  if (/^[0-9a-f]{64}\.(mp4|mov|webm)$/.test(f)) file("uploads", f, path.join(up, f), "upload-video");
  else if (/^[0-9a-f]{64}\.(png|jpg|webp)$/.test(f)) file("uploads", f, path.join(up, f), "upload-image");
}

for (const [k, n] of Object.entries(counts).sort()) console.log(`${String(n).padStart(5)}  ${k}`);
if (dry) {
  console.log("Dry run: nothing was written.");
  process.exit(0);
}
console.log("Writing to Arkiv and uploading to 0G Storage (Arkiv takes ~7 s per write)…");
await flushFiles();
const st = db.status();
const failedFiles = db.list("files").filter((f) => f.error && !f.stored);
for (const f of st.failed) console.log(`✕ record ${f.collection}/${f.id}: ${f.error}`);
for (const f of failedFiles) console.log(`✕ file ${f.scope}/${f.name}: ${f.error}`);
console.log(st.failed.length || failedFiles.length ? "Some items failed: run again to retry them." : `Done: ${st.written} Arkiv writes. ${DIR} can be deleted.`);
process.exit(st.failed.length || failedFiles.length ? 1 : 0);
