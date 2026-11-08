/*
 * Snapshots the arena's real ENSv2 names into src/data/ens.json.
 *
 * Which name belongs to which project or judge comes from the live backend (/api/ens);
 * every record is read from ENS on Sepolia through the Universal Resolver. The demo app
 * reads the same records live in the browser and only falls back to this file when
 * Sepolia doesn't answer. Run: npm run ens-snapshot
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../src/data/ens.json");
const BACKEND = process.env.ARENA_BACKEND ?? "https://eth-mum.onrender.com";
const submissions = JSON.parse(fs.readFileSync(path.resolve(here, "../src/data/submissions.json"), "utf8"));
const demoIds = new Set((submissions.submissions ?? submissions).map((s) => s.id));

const cfg = await (await fetch(`${BACKEND}/api/ens`)).json();
if (!cfg.enabled) throw new Error(`ENS is off on ${BACKEND}`);
const client = createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) });
const ur = cfg.universalResolver;

async function read(name, keys) {
  const n = normalize(name);
  const [address, resolver, ...values] = await Promise.all([
    client.getEnsAddress({ name: n, universalResolverAddress: ur }).catch(() => null),
    client.getEnsResolver({ name: n, universalResolverAddress: ur }).catch(() => null),
    ...keys.map((key) => client.getEnsText({ name: n, key, universalResolverAddress: ur }).catch(() => null)),
  ]);
  return { address, resolver, records: Object.fromEntries(keys.map((k, i) => [k, values[i] || null])) };
}

// The demo's projects carry their own ids; a name's label is the demo id it belongs to.
const projects = {};
for (const name of Object.values(cfg.projects)) {
  const label = name.split(".")[0];
  if (demoIds.has(label)) projects[label] = name;
}

const names = {};
for (const name of Object.values(projects)) names[name] = await read(name, cfg.fighterKeys);
for (const name of Object.values(cfg.judges)) names[name] = await read(name, cfg.judgeKeys);
names[cfg.parent] = await read(cfg.parent, ["description", "url"]);

const out = {
  readAt: new Date().toISOString(),
  config: { ...cfg, projects, enabled: true },
  names,
};
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
console.log(`ens.json: ${Object.keys(projects).length} projects, ${Object.keys(cfg.judges).length} judges, read ${out.readAt}`);
