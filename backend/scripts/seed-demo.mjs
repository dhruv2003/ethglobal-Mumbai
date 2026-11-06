#!/usr/bin/env node
/*
 * Seeds the demo field into the store the API reads (the Arkiv database):
 * three real hackathon projects entered in ETHGlobal Mumbai.
 *
 *   node scripts/seed-demo.mjs            upsert the submissions
 *   node scripts/seed-demo.mjs --review   also run the full review pipeline on each (code, demo, live tests, claims, judges)
 *
 * Re-running is safe: records are matched by id and updated in place.
 * A server that is already running sees the seeded records after a restart (it reads Arkiv at boot).
 */
import "dotenv/config";
import { db, submissions } from "../src/store.mjs";
import { flushFiles } from "../src/zg/files.mjs";

const EVENT = "ethglobal-mumbai";
const OWNER = "0x15284a4aaa859926f37dd03cc36abc7ef42efc1c";

/** Real projects. Text is the teams' own, from their showcase pages and submissions. */
const PROJECTS = [
  {
    id: "go-health-me",
    team: { name: "Meowteam6" },
    project: {
      name: "Go Health Me",
      pitch: "Put money on your own sleep or workouts. Your wearable proves it, SPOTTER pays the players who hit.",
      description:
        "GoHealthMe is a commitment game for your own health. You stake test USDC on a challenge, say seven hours of sleep on Saturday night or one workout on Sunday, your wearable proves whether you did it, and SPOTTER, the settlement agent, pays the players who hit when the challenge ends. Miss it, shown by your wearable, and your stake goes to the people who hit. Nobody hits, everyone gets their stake back. Raw health data never touches the chain, only the verdict.",
    },
    repoUrl: "https://github.com/aspiringsecurity/gohealthme-tokyo",
    demoVideoUrl: "https://www.loom.com/share/17b1dc5da755422ea3177d4842556813",
    liveUrl: "https://www.gohealthme.app",
    tracks: ["defi"],
    fighterSeed: "go-health-me",
    submittedAt: "2026-11-07T01:12:00.000Z",
  },
  {
    id: "7898d2f3-9d2e-4389-aeff-f1f95b661776",
    team: { name: "FitterCoin" },
    project: { name: "FitterCoin", pitch: "Bet on yourself. Get paid in crypto for real workouts." },
    tracks: ["defi"],
  },
  {
    id: "f1b4efde-a2b1-4836-a833-bb3ce9b6358d",
    project: { name: "Mozark App Studio", pitch: "No-code mobile testing on real devices. Describe what the user does, agents turn it into a test." },
    tracks: ["ai-agents", "infra"],
  },
];

for (const p of PROJECTS) {
  const existing = submissions.get(p.id);
  const prior = existing ?? { ownerWallet: OWNER, rewardWallet: OWNER, chainId: 84532 };
  const record = { ...prior, ...p, team: { ...prior.team, ...p.team }, project: { ...prior.project, ...p.project }, eventId: EVENT };
  submissions.add(record); // put by id: replaces the earlier version
  console.log(`${existing ? "updated" : "added  "} ${record.project.name} (${record.id})`);
}

if (process.argv.includes("--review")) {
  const { reviewNow } = await import("../src/api.mjs");
  const { runPipeline } = await import("../src/reviewer/pipeline.mjs");
  await Promise.all(
    PROJECTS.map(async (p) => {
      try {
        const state = await runPipeline(p.id, { judge: reviewNow });
        for (const s of state.steps) console.log(`[${p.id}] ${s.status.padEnd(8)} ${s.title}${s.detail ? ` · ${s.detail}` : ""}`);
      } catch (e) {
        console.error(`[${p.id}] ${e.message}`);
      }
    }),
  );
}
console.log("Saving to Arkiv…");
await flushFiles();
const failed = db.status().failed;
if (failed.length) console.error(`${failed.length} write(s) failed: ${failed.map((f) => `${f.collection}/${f.id}: ${f.error}`).join("; ")}`);
process.exit(failed.length ? 1 : 0);
