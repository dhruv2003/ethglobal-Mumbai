/*
 * Test helper: puts the go-health-me fixture in the (in-memory) store as a submitted project:
 * the submission and dossier as records, the live test's report as a record and its
 * recordings and screenshots as files (what the pipeline stores on Arkiv / 0G).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dossiers, liveTests, submissions } from "../src/store.mjs";
import { putFile } from "../src/zg/files.mjs";

const dir = new URL("../fixtures/go-health-me/", import.meta.url);
const json = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
const smokeDir = fileURLToPath(new URL("smoke/", dir));

export function seedProject(id = "go-health-me") {
  if (submissions.get(id)) return id;
  const f = json("submission.json").form;
  submissions.add({ id, team: f.team, project: f.project, repoUrl: f.code.repoUrl, demoVideoUrl: f.demo.videoUrl, tracks: f.tracks.selected });
  dossiers.save(id, json("dossier.json"));
  liveTests.save(id, json("smoke/smoke.json"));
  for (const device of ["laptop", "phone"]) {
    const d = path.join(smokeDir, device);
    if (!fs.existsSync(d)) continue;
    for (const file of fs.readdirSync(d)) {
      if (file === "video.mp4") putFile(id, `live/${device}/${file}`, fs.readFileSync(path.join(d, file)), { mime: "video/mp4", kind: "live-recording" });
      else if (/^smoke-.+\.jpg$/.test(file)) putFile(id, `live/${device}/${file}`, fs.readFileSync(path.join(d, file)), { mime: "image/jpeg", kind: "live-screenshot" });
    }
  }
  return id;
}
