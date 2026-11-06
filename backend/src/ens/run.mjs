#!/usr/bin/env node
/*
 * ENSv2 from the command line (Sepolia).
 *
 *   cd backend
 *   npm run ens -- status                    parent, registry, resolver, names given out
 *   npm run ens -- setup                     register the parent and deploy its registry + resolver (once)
 *   npm run ens -- issue --project <id>      give one fighter its name and profile
 *   npm run ens -- issue --all               every submitted project, and its latest score if judged
 *   npm run ens -- judges                    every judge: name + ENSIP-26 agent records
 *   npm run ens -- fights                    win/loss records from finalized matches on the TournamentManager
 *   npm run ens -- read <name>               the records any ENS client sees for a name
 */
import "dotenv/config";
import fs from "node:fs";
import { createPublicClient, defineChain, getAddress, http } from "viem";
import { listBrackets } from "../arena/routes.mjs";
import { loadProject } from "../projects.mjs";
import { judges, reviews, submissions } from "../store.mjs";
import { lastPublish } from "../arkiv/publish.mjs";
import { FIGHTER_KEYS, JUDGE_KEYS, appLink, deployment, issueJudge, issueProject, names, ownerAddress, scoreWriterAddress, setup, readTexts, syncFightRecords, writeScore } from "./ens.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(name);
  return i < 0 ? null : rest[i + 1];
};
const usage = () => {
  console.error("usage: npm run ens -- status | setup | issue --project <id> | issue --all | judges | fights | read <name>");
  process.exit(2);
};

async function issueOne(id) {
  const project = loadProject(id);
  if (!project) throw new Error(`No such project: ${id}`);
  const r = await issueProject(project);
  console.log(`  ${r.name}  owner ${r.owner}${r.tx ? `  issued ${r.tx}` : ""}  profile ${r.profileTx}`);
  const result = reviews.get(id);
  if (result) {
    const s = await writeScore(project, result, { arkivPanelKey: lastPublish(id)?.arkiv?.panelKey ?? null });
    console.log(`    score written: ${s.tx}`);
  }
}

try {
  if (cmd === "status") {
    const d = await deployment();
    console.log(JSON.stringify({ ...d, signer: ownerAddress(), scoreWriter: scoreWriterAddress(), app: appLink(d.parent), names: names() }, null, 2));
  } else if (cmd === "setup") {
    const d = await setup({ log: (m) => console.log(m) });
    console.log(JSON.stringify(d, null, 2));
    console.log(`\n${appLink(d.parent)}`);
  } else if (cmd === "issue") {
    if (rest.includes("--all")) {
      for (const s of submissions.list()) await issueOne(s.id).catch((e) => console.error(`  ✕ ${s.id}: ${e.shortMessage ?? e.message}`));
    } else if (opt("--project")) await issueOne(opt("--project"));
    else usage();
  } else if (cmd === "judges") {
    for (const j of judges.list()) {
      const r = await issueJudge(j, { model: process.env.JUDGE_MODEL ?? null });
      console.log(`  ${r.name}${r.tx ? `  issued ${r.tx}` : ""}  agent records ${r.profileTx}`);
    }
  } else if (cmd === "fights") {
    // Same contract and chain the autorun loop uses (backend/.env).
    if (!process.env.TOURNAMENT_MANAGER_ADDRESS || !process.env.RPC_URL) throw new Error("Set TOURNAMENT_MANAGER_ADDRESS and RPC_URL.");
    const chain = defineChain({ id: Number(process.env.CHAIN_ID || 84532), name: process.env.CHAIN_NAME ?? "chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL] } } });
    const client = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
    const raw = JSON.parse(fs.readFileSync(new URL("../../contracts/abi/TournamentManager.json", import.meta.url), "utf8"));
    const manager = { address: getAddress(process.env.TOURNAMENT_MANAGER_ADDRESS), abi: raw.abi ?? raw };
    const written = await syncFightRecords({
      brackets: listBrackets,
      readTournament: (id) => client.readContract({ ...manager, functionName: "getTournament", args: [id] }),
      readMatch: (id, i) => client.readContract({ ...manager, functionName: "getMatch", args: [id, i] }),
      log: (m) => console.log(`  ${m}`),
    });
    if (!written.length) console.log("  every fighter's record is already up to date");
  } else if (cmd === "read") {
    const name = rest[0];
    if (!name) usage();
    const keys = name.split(".")[0].startsWith("judge-") ? JUDGE_KEYS : FIGHTER_KEYS;
    console.log(JSON.stringify(await readTexts(name, keys), null, 2));
  } else usage();
} catch (e) {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
}
