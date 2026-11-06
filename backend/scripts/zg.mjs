#!/usr/bin/env node
/*
 * 0G Storage from the command line.
 *
 *   npm run zg:status                                   wallet, balance, head, outbox
 *   npm run zg:seed-fixtures -- --project go-health-me  upload a sample project's frozen evidence (idempotent)
 *   npm run zg:restore -- --head <rootHash> [--into <dir>] [--force]
 *                                                       rebuild data/ from 0G alone (default: a fresh temp dir)
 *   npm run zg:verify                                   re-download every record and check its hash
 *   npm run zg:check [-- --into <dir>] [--kind <kind>]  for every upload: indexer.download(root, file, true) to disk,
 *                                                       Merkle root + sha256 check, replica count, Storage Scan link;
 *                                                       keeps the downloaded files in <dir> so you can open them
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "../src/datafiles.mjs";
import * as archive from "../src/zg/archive.mjs";
import { contentSha256, explorerLinks, fileLocations, merkleRoot, sdkDownloadToFile, sha256, storageConfig, walletInfo } from "../src/zg/storage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../fixtures");
const [cmd, ...args] = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const flag = (name) => args.includes(name);
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "-");

function needEnabled() {
  if (!archive.enabled()) {
    console.error("0G Storage is off. Set ZG_STORAGE=1 and ZG_STORAGE_PRIVATE_KEY in backend/.env.");
    process.exit(2);
  }
}

async function status() {
  const cfg = storageConfig();
  console.log(`0G Storage: ${cfg.enabled ? "on" : "off"} · ${cfg.network} (chain ${cfg.chainId})`);
  console.log(`RPC ${cfg.rpc}\nIndexer ${cfg.indexer}`);
  console.log(`AES key for voice audio: ${cfg.hasAesKey ? "set" : "not set (audio is never uploaded)"}`);
  if (cfg.enabled) {
    const w = await walletInfo();
    console.log(`Wallet ${w.address ?? "-"} · balance ${w.balance ?? "?"}${w.error ? ` (${w.error})` : ""}`);
  }
  const head = archive.loadHead();
  console.log(`Head manifest: ${head?.rootHash ?? "none yet"}${head ? ` (${head.uploadedAt})` : ""}`);
  if (head?.txHash) console.log(`  ${explorerLinks(head, cfg.network).tx}`);
  const m = archive.loadManifest();
  const byKind = {};
  for (const r of Object.values(m.records)) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  console.log(`Records on 0G: ${Object.keys(m.records).length} ${JSON.stringify(byKind)}`);
  const c = archive.counts();
  console.log(`Outbox: ${c.pending} pending, ${c.uploading} uploading, ${c.failed} failed`);
  if (c.lastError) console.log(`Last error: ${c.lastError.key} · ${c.lastError.code} · ${c.lastError.message}`);
}

/** Every file of a sample project, except the cloned repo (its pinned commit is in source.json). */
function fixtureFiles(project) {
  const root = path.join(FIXTURES, project);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (rel === "repo") continue;
        walk(full);
      } else if (rel !== "reviews.json") out.push({ rel, full }); // reviews are archived as "review" records
    }
  };
  walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function seedFixtures() {
  needEnabled();
  const project = value("--project");
  if (!project || !/^[a-z0-9-]+$/.test(project) || !fs.existsSync(path.join(FIXTURES, project, "submission.json"))) {
    console.error("usage: npm run zg:seed-fixtures -- --project <sample project id>");
    process.exit(2);
  }
  const files = fixtureFiles(project);
  let queued = 0;
  for (const f of files) {
    if (archive.archiveFile("fixture-file", `${project}/${f.rel}`, f.full)) queued++;
  }
  console.log(`${files.length} files in fixtures/${project} (repo/ skipped), ${queued} to upload, ${files.length - queued} already on 0G.`);
  const started = Date.now();
  await archive.drain({ timeoutMs: 60 * 60_000, manifest: false });
  const m = archive.loadManifest();
  const missing = files.filter((f) => !m.records[`fixture-file:${project}/${f.rel}`]);
  if (missing.length) {
    console.error(`${missing.length} files are not on 0G yet: ${missing.map((f) => f.rel).join(", ")}. Run again to retry.`);
    process.exit(1);
  }
  let source = null;
  try {
    source = JSON.parse(fs.readFileSync(path.join(FIXTURES, project, "source.json"), "utf8"));
  } catch {
    /* no source.json */
  }
  const bundle = {
    project,
    repository: source?.repository ? { url: source.repository.clonedFrom ?? source.repository.submittedUrl, pinnedCommit: source.repository.pinnedCommit } : null,
    files: files.map((f) => {
      const r = m.records[`fixture-file:${project}/${f.rel}`];
      return { path: f.rel, sha256: r.sha256, size: r.size, rootHash: r.rootHash, txHash: r.txHash, txSeq: r.txSeq };
    }),
  };
  const queuedBundle = archive.archive("evidence-bundle", project, bundle);
  const left = await archive.drain({ timeoutMs: 10 * 60_000 });
  const b = archive.loadManifest().records[`evidence-bundle:${project}`];
  console.log(`Evidence bundle ${queuedBundle ? "uploaded" : "unchanged"}: ${b?.rootHash ?? "pending"} (${files.length} files)`);
  if (b?.txHash) console.log(`  ${explorerLinks(b).tx}`);
  console.log(`Head manifest: ${archive.loadHead()?.rootHash ?? "pending"} · took ${Math.round((Date.now() - started) / 1000)} s`);
  if (left.pending || left.failed) console.log(`Outbox: ${left.pending} pending, ${left.failed} failed`);
}

async function restore() {
  const head = value("--head") ?? archive.loadHead()?.rootHash;
  if (!head) {
    console.error("usage: npm run zg:restore -- --head <rootHash> [--into <dir>] [--force]");
    process.exit(2);
  }
  let into = value("--into") ? path.resolve(value("--into")) : archive.freshRestoreDir();
  if (path.resolve(into) === path.resolve(DATA_DIR) && !flag("--force")) {
    console.error(`Refusing to overwrite ${DATA_DIR} without --force.`);
    process.exit(2);
  }
  if (fs.existsSync(into) && fs.readdirSync(into).length && !flag("--force")) {
    console.error(`${into} is not empty. Pick an empty folder or pass --force.`);
    process.exit(2);
  }
  console.log(`Restoring from head ${head} into ${into}`);
  const { written, records } = await archive.restoreFromHead(head, into, { log: console.log });
  console.log(`Done: ${written.length} files from ${records} manifest records.`);
  console.log(into);
}

async function verify() {
  const m = archive.loadManifest();
  const { localValue } = await import("../src/store.mjs");
  const rows = [];
  let bad = 0;
  for (const r of Object.values(m.records)) {
    let row;
    try {
      const local = r.kind === "fixture-file" ? undefined : localValue(r.kind, r.id);
      const localBytes = r.kind === "fixture-file" && fs.existsSync(path.join(FIXTURES, r.id)) ? fs.readFileSync(path.join(FIXTURES, r.id)) : undefined;
      const v = await archive.verifyRecord(r.kind, r.id, local, { localBytes });
      row = { record: `${r.kind}:${r.id}`, root: short(r.rootHash), versions: r.history.length, result: v.match ? "match" : "MISMATCH", note: v.remoteSha256 == null ? "encrypted, no key" : v.localSha256 == null ? "no local copy" : "" };
    } catch (e) {
      row = { record: `${r.kind}:${r.id}`, root: short(r.rootHash), versions: r.history.length, result: "ERROR", note: `${e.code ?? ""} ${e.message}`.slice(0, 80) };
    }
    if (row.result !== "match") bad++;
    rows.push(row);
    console.log(`${row.result.padEnd(8)} ${row.record.padEnd(60)} ${row.root} v${row.versions} ${row.note}`);
  }
  const head = archive.loadHead();
  if (head) {
    try {
      const { downloadJSON } = await import("../src/zg/storage.mjs");
      const env = await downloadJSON(head.rootHash);
      const ok = env.kind === "manifest";
      console.log(`${ok ? "match" : "MISMATCH"}    manifest head ${short(head.rootHash)} (${Object.keys(env.data.records).length} records)`);
      if (!ok) bad++;
    } catch (e) {
      bad++;
      console.log(`ERROR    manifest head ${short(head.rootHash)} ${e.message}`);
    }
  }
  console.log(`${rows.length - bad + (head ? 1 : 0)} ok, ${bad} not ok`);
  if (bad) process.exitCode = 1;
}

async function check() {
  const into = path.resolve(value("--into") ?? path.join(DATA_DIR, "..", "zg-downloads"));
  const only = value("--kind");
  fs.mkdirSync(into, { recursive: true });
  const m = archive.loadManifest();
  const head = archive.loadHead();
  const rows = Object.values(m.records).filter((r) => !only || r.kind === only);
  if (head && !only) rows.push({ kind: "manifest", id: "head", rootHash: head.rootHash, txHash: head.txHash, txSeq: head.txSeq, history: [head.rootHash] });
  console.log(`Checking ${rows.length} uploads on 0G ${storageConfig().network}; files go to ${into}\n`);
  let bad = 0;
  for (const r of rows) {
    const name = `${r.kind}/${r.file ? r.id : `${r.id}.json`}${r.encrypted ? ".enc" : ""}`;
    const out = path.join(into, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true }); // the SDK refuses to overwrite
    let line;
    try {
      const nodes = await fileLocations(r.rootHash);
      const t0 = Date.now();
      await sdkDownloadToFile(r.rootHash, out); // exactly the docs' step: indexer.download(rootHash, path, true)
      const bytes = fs.readFileSync(out);
      const rootOk = (await merkleRoot(bytes)).toLowerCase() === r.rootHash.toLowerCase();
      let contentOk = true;
      if (r.kind === "manifest") contentOk = JSON.parse(bytes).kind === "manifest";
      else if (!r.file) contentOk = contentSha256(JSON.parse(bytes).data) === r.sha256;
      else if (!r.encrypted) contentOk = sha256(bytes) === r.sha256;
      const ok = rootOk && contentOk && nodes.length > 0;
      if (!ok) bad++;
      line = `${ok ? "OK  " : "BAD "} ${name.padEnd(58)} ${String(bytes.length).padStart(9)} B  nodes ${nodes.length}  merkle ${rootOk ? "✓" : "✕"}  sha ${r.encrypted ? "(encrypted)" : contentOk ? "✓" : "✕"}  ${Date.now() - t0} ms  ${explorerLinks(r).file ?? ""}`;
    } catch (e) {
      bad++;
      line = `ERR  ${name.padEnd(58)} ${e.code ?? ""} ${String(e.message).slice(0, 90)}`;
    }
    console.log(line);
  }
  console.log(`\n${rows.length - bad} ok, ${bad} not ok. Downloaded files: ${into}`);
  if (bad) process.exitCode = 1;
}

const commands = { check, status, "seed-fixtures": seedFixtures, restore, verify };
if (!commands[cmd]) {
  console.error(`usage: node scripts/zg.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
try {
  await commands[cmd]();
} catch (e) {
  console.error(`${e.code ? `[${e.code}] ` : ""}${e.message}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
