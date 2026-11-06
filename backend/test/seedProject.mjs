/* Test helper: puts the go-health-me fixture in the (temporary) store as a submitted project. */
import fs from "node:fs";
import { dossiers, liveDir, submissions } from "../src/store.mjs";

const dir = new URL("../fixtures/go-health-me/", import.meta.url);
const json = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));

export function seedProject(id = "go-health-me") {
  if (submissions.get(id)) return id;
  const f = json("submission.json").form;
  submissions.add({ id, team: f.team, project: f.project, repoUrl: f.code.repoUrl, demoVideoUrl: f.demo.videoUrl, tracks: f.tracks.selected });
  dossiers.save(id, json("dossier.json"));
  fs.cpSync(new URL("smoke/", dir), liveDir(id), { recursive: true });
  return id;
}
