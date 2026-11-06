/*
 * ENSv2 on Sepolia: every fighter and every AI judge in the arena is a name.
 *
 *   hackarena.eth                      the arena (parent, owned by ENS_PRIVATE_KEY's wallet)
 *   <project-slug>.hackarena.eth       a fighter: owned by the team's wallet, scores written by the arena
 *   judge-<name>.hackarena.eth         an AI judge: ENSIP-26 agent-context / agent-endpoint records
 *
 * How it sits on ENSv2:
 *   - The parent points at its own UserRegistry (subnames live there) and its own
 *     PermissionedResolver (all records live there). Both are proxies from ENS's
 *     VerifiableFactory, made by `npm run ens -- setup`.
 *   - A fighter's subname token belongs to the team, with only ROLE_CAN_TRANSFER_ADMIN:
 *     they can move the name, but can't point it at another resolver, so they
 *     can't replace the score the judges gave them.
 *   - Records on the resolver are gated by Enhanced Access Control. With
 *     ENS_WRITER_PRIVATE_KEY set, setup grants that wallet setter roles for the
 *     arena.* score keys only (grantSetterRoles), and the server writes scores with
 *     it: it can't touch addresses, descriptions or agent records.
 *
 * Addresses are found on chain, not configured: ETHRegistry.getSubregistry / getResolver
 * on the parent label. data/ens/ keeps only the setup progress and the label each
 * project or judge was given (a name, once issued, never changes).
 *
 *   ENS_PRIVATE_KEY         owner of the parent; signs setup, subname issuance, profile records
 *   ENS_WRITER_PRIVATE_KEY  optional scoped writer for score records (else the owner writes them)
 *   ENS_PARENT              default "hackarena.eth"
 *   ENS_RPC_URL             Sepolia RPC (default: publicnode)
 *   ARENA_PUBLIC_URL        public site URL, for url / agent-endpoint[web] records (optional)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbi, parseEventLogs, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize, packetToBytes } from "viem/ens";
import { DATA_DIR, submissions } from "../store.mjs";
import { loadProject } from "../projects.mjs";

/** ENSv2 on Sepolia (docs.ens.domains/learn/deployments#sepolia-ensv2). */
export const ENSV2 = {
  chainId: 11155111,
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  ethRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  factory: "0xda70306c98e97ece36f997a21368e53298572991",
  resolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  userRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  mockUsdc: "0x240b0316df57887dbbe58b586508b19e633a14aa",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
};
export const APP_URL = "https://sepolia.app.ens.domains";

const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO32 = `0x${"0".repeat(64)}`;
/** Every role and every admin role (each EAC role is one bit per nibble). */
const ALL_ROLES = BigInt(`0x${"1".repeat(64)}`);
/** What a team gets on its fighter name: it can transfer it, nothing else. */
const ROLE_CAN_TRANSFER_ADMIN = (1n << 28n) << 128n;
const YEAR = 365n * 24n * 3600n;

/** Score records: written after every judged run, by the scoped writer when there is one. */
export const SCORE_KEYS = ["arena.score", "arena.judges", "arena.ranAt", "arena.arkiv"];
/** Fight records: tallied from finalized matches on the TournamentManager contract. */
export const RECORD_KEYS = ["arena.record", "arena.titles", "arena.lastFight"];
/** Everything the scoped writer may set (and nothing else). */
export const WRITER_KEYS = [...SCORE_KEYS, ...RECORD_KEYS];
/** What the web app reads for a fighter and for a judge. */
export const FIGHTER_KEYS = ["name", "description", "url", "com.github", ...WRITER_KEYS];
export const JUDGE_KEYS = ["name", "description", "agent-context", "agent-endpoint[web]", "arena.model"];

const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);
const resolverAbi = parseAbi([
  "struct Grant { address account; uint256 roleBitmap; }",
  "function initialize(Grant[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function multicall(bytes[] calls) returns (bytes[])",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function decodeSetter(bytes setter) pure returns (bytes arg, uint256 resource, uint256 roleBitmap)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);
const registryAbi = parseAbi([
  "struct Grant { address account; uint256 roleBitmap; }",
  "function initialize(Grant[] grants)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function setParent(address parent, string label)",
  "function getParent() view returns (address parent, string label)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function findOwner(string label) view returns (address)",
  "function findExpiry(string label) view returns (uint64)",
]);
const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

/* ------------------------------------------------------------- config */

export const parentName = () => normalize(process.env.ENS_PARENT || "hackarena.eth");
const parentLabel = () => parentName().replace(/\.eth$/, "");
const rpcUrl = () => process.env.ENS_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
export const publicUrl = () => (process.env.ARENA_PUBLIC_URL || "").replace(/\/+$/, "") || null;

function toKey(raw, envName) {
  const k = String(raw).trim().replace(/^["']|["']$/g, "");
  const hex = k.startsWith("0x") || k.startsWith("0X") ? k.slice(2) : k;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${envName} must be 64 hex characters (with or without 0x).`);
  return `0x${hex}`;
}
const ownerAccount = () => (process.env.ENS_PRIVATE_KEY ? privateKeyToAccount(toKey(process.env.ENS_PRIVATE_KEY, "ENS_PRIVATE_KEY")) : null);
const writerAccount = () => (process.env.ENS_WRITER_PRIVATE_KEY ? privateKeyToAccount(toKey(process.env.ENS_WRITER_PRIVATE_KEY, "ENS_WRITER_PRIVATE_KEY")) : null);

export const canWrite = () => Boolean(process.env.ENS_PRIVATE_KEY);
export const ownerAddress = () => ownerAccount()?.address ?? null;
/** Who signs score records: the scoped writer when there is one, else the owner. */
export const scoreWriterAddress = () => (writerAccount() ?? ownerAccount())?.address ?? null;

let pub;
export const publicClient = () => (pub ??= createPublicClient({ chain: sepolia, transport: http(rpcUrl()) }));
const wallets = new Map();
const walletFor = (account) => {
  if (!wallets.has(account.address)) wallets.set(account.address, createWalletClient({ chain: sepolia, transport: http(rpcUrl()), account }));
  return wallets.get(account.address);
};

// One queue for every ENS write: background jobs would otherwise race for the same nonce.
let tail = Promise.resolve();
const serial = (fn) => {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
};

async function send(account, request) {
  const hash = await walletFor(account).writeContract(request);
  const receipt = await publicClient().waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return receipt;
}

/* ------------------------------------------------------------- names */

export const dnsName = (name) => toHex(packetToBytes(normalize(name)));
export const labelhash = (label) => BigInt(keccak256(toHex(label)));
export const appLink = (name) => `${APP_URL}/${name}`;

/** "Go Health Me!" -> "go-health-me": a label ENS normalisation leaves alone. */
export function slugLabel(text, max = 40) {
  const s = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return s;
}

const namesFile = () => path.join(DATA_DIR, "ens", "names.json");
const setupFile = () => path.join(DATA_DIR, "ens", "setup.json");
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

/** Labels already given out: { projects: { id: {label, ...} }, judges: { id: {label, ...} } }. */
export const names = () => readJson(namesFile(), { projects: {}, judges: {} });

/**
 * The label for a project or judge: the one it already has, else a fresh slug of its
 * name that no one else holds. Pure given `taken`; tested.
 */
export function chooseLabel({ id, text, prefix = "", taken }) {
  const base = slugLabel(text) || slugLabel(String(id)).slice(0, 8) || "fighter";
  let label = `${prefix}${base}`;
  if (taken.has(label)) label = `${label}-${slugLabel(String(id)).replace(/-/g, "").slice(0, 6)}`;
  for (let n = 2; taken.has(label); n++) label = `${prefix}${base}-${n}`;
  return label;
}

function labelFor(kind, id, text, prefix) {
  const all = names();
  const existing = all[kind][id]?.label;
  if (existing) return existing;
  const taken = new Set([...Object.values(all.projects), ...Object.values(all.judges)].map((e) => e.label));
  return chooseLabel({ id, text, prefix, taken });
}

function remember(kind, id, patch) {
  const all = names();
  all[kind][id] = { ...all[kind][id], ...patch };
  writeJson(namesFile(), all);
  return all[kind][id];
}

export const projectName = (projectId) => {
  const l = names().projects[projectId]?.label;
  return l ? `${l}.${parentName()}` : null;
};
export const judgeName = (judgeId) => {
  const l = names().judges[judgeId]?.label;
  return l ? `${l}.${parentName()}` : null;
};

/* ------------------------------------------------------------- chain reads */

/** Where the parent lives on ENSv2, read from the .eth registry. Nulls until setup has run. */
export async function deployment() {
  const c = publicClient();
  const label = parentLabel();
  const read = (functionName) => c.readContract({ address: ENSV2.ethRegistry, abi: registryAbi, functionName, args: [label] });
  const [owner, registry, resolver, expiry] = await Promise.all([read("findOwner"), read("getSubregistry"), read("getResolver"), read("findExpiry")]);
  const live = (a) => (a && a !== ZERO ? a : null);
  return { parent: parentName(), owner: live(owner), registry: live(registry), resolver: live(resolver), expiry: Number(expiry) || null };
}

let cachedDeployment = null;
async function ready() {
  if (cachedDeployment?.registry && cachedDeployment?.resolver) return cachedDeployment;
  const d = await deployment();
  if (!d.registry || !d.resolver) throw new Error(`${d.parent} isn't set up on ENSv2 yet. Run: npm run ens -- setup`);
  cachedDeployment = d;
  return d;
}

/* ------------------------------------------------------------- setup */

async function deployProxy(account, implementation, saltText, data) {
  const salt = labelhash(saltText);
  const receipt = await send(account, { address: ENSV2.factory, abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt, data] });
  const [log] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!log) throw new Error("the factory didn't report the new proxy");
  return { address: log.args.proxyAddress, tx: receipt.transactionHash };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Register the parent and everything it needs. Safe to run again: each step is
 * skipped when it's already done (progress kept in data/ens/setup.json).
 */
export async function setup({ log = () => {} } = {}) {
  const owner = ownerAccount();
  if (!owner) throw new Error("Set ENS_PRIVATE_KEY (the wallet that will own the parent name).");
  const c = publicClient();
  const label = parentLabel();
  const state = readJson(setupFile(), {});
  const save = (patch) => writeJson(setupFile(), Object.assign(state, patch, { parent: parentName(), owner: owner.address }));

  if ((await c.getBalance({ address: owner.address })) === 0n) throw new Error(`${owner.address} has no Sepolia ETH. Fund it from a faucet first.`);

  let d = await deployment();
  if (d.owner && d.owner.toLowerCase() !== owner.address.toLowerCase()) throw new Error(`${d.parent} already belongs to ${d.owner}. Pick another ENS_PARENT.`);

  if (!d.owner) {
    if (!state.resolver) {
      const data = encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [[{ account: owner.address, roleBitmap: ALL_ROLES }], []] });
      const r = await deployProxy(owner, ENSV2.resolverImpl, `${parentName()}:resolver:v1`, data);
      save({ resolver: r.address, resolverTx: r.tx });
      log(`resolver deployed: ${r.address}`);
    }
    if (!state.registry) {
      const data = encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [[{ account: owner.address, roleBitmap: ALL_ROLES }]] });
      const r = await deployProxy(owner, ENSV2.userRegistryImpl, `${parentName()}:registry:v1`, data);
      save({ registry: r.address, registryTx: r.tx });
      log(`subname registry deployed: ${r.address}`);
    }

    if (!(await c.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "isAvailable", args: [label] }))) {
      throw new Error(`${d.parent} isn't available. Pick another ENS_PARENT.`);
    }
    const [base, premium] = await c.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "getRegisterPrice", args: [label, YEAR, ENSV2.mockUsdc] });
    const price = base + premium;
    const usdc = (functionName, args) => c.readContract({ address: ENSV2.mockUsdc, abi: erc20Abi, functionName, args });
    if ((await usdc("balanceOf", [owner.address])) < price) {
      await send(owner, { address: ENSV2.mockUsdc, abi: erc20Abi, functionName: "mint", args: [owner.address, price * 2n] });
      log("minted test USDC (Sepolia MockUSDC) for the registration fee");
    }
    if ((await usdc("allowance", [owner.address, ENSV2.ethRegistrar])) < price) {
      await send(owner, { address: ENSV2.mockUsdc, abi: erc20Abi, functionName: "approve", args: [ENSV2.ethRegistrar, price] });
      log("approved the registrar to take the fee");
    }

    // Commit, wait the minimum age, reveal. The secret only hides the name from front-runners until reveal.
    const args = { label, owner: owner.address, subregistry: state.registry, resolver: state.resolver, duration: YEAR };
    if (!state.secret || Date.now() - (state.committedAt ?? 0) > 23 * 3600_000) {
      const secret = toHex(crypto.randomBytes(32));
      const commitment = await c.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "makeCommitment", args: [args.label, args.owner, secret, args.subregistry, args.resolver, args.duration, ZERO32] });
      const r = await send(owner, { address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "commit", args: [commitment] });
      save({ secret, commitment, committedAt: Date.now(), commitTx: r.transactionHash });
      log(`committed to ${d.parent}`);
    }
    const minAge = Number(await c.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" }));
    const commitTime = Number(await c.readContract({ address: ENSV2.ethRegistrar, abi: registrarAbi, functionName: "commitmentAt", args: [state.commitment] }));
    const now = Number((await c.getBlock()).timestamp);
    if (now < commitTime + minAge + 5) {
      log(`waiting ${commitTime + minAge + 5 - now} s for the commitment to age`);
      await wait((commitTime + minAge + 5 - now) * 1000);
    }
    const r = await send(owner, {
      address: ENSV2.ethRegistrar,
      abi: registrarAbi,
      functionName: "register",
      args: [args.label, args.owner, state.secret, args.subregistry, args.resolver, args.duration, ENSV2.mockUsdc, ZERO32],
    });
    save({ registerTx: r.transactionHash, registeredAt: new Date().toISOString() });
    log(`registered ${d.parent}: ${r.transactionHash}`);
    d = await deployment();
  }

  // The subname registry names its canonical parent, so names under it can be traced back up.
  const [parentReg] = await c.readContract({ address: d.registry, abi: registryAbi, functionName: "getParent" });
  if (parentReg.toLowerCase() !== ENSV2.ethRegistry.toLowerCase()) {
    await send(owner, { address: d.registry, abi: registryAbi, functionName: "setParent", args: [ENSV2.ethRegistry, label] });
    log("linked the subname registry to its parent");
  }

  cachedDeployment = null;
  await writeRecords(d.parent, { texts: { description: "Hackathon projects fight as AI fighters; three AI judges score them. Every fighter and judge here is a name.", url: publicUrl() ?? "" } }, { as: "owner" });
  log("parent records written");

  const writer = writerAccount();
  if (writer && writer.address.toLowerCase() !== owner.address.toLowerCase()) {
    for (const key of WRITER_KEYS) {
      const setter = encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: ["0x", key, ""] });
      const [, resource, roleBitmap] = await c.readContract({ address: d.resolver, abi: resolverAbi, functionName: "decodeSetter", args: [setter] });
      if (await c.readContract({ address: d.resolver, abi: resolverAbi, functionName: "hasRoles", args: [resource, roleBitmap, writer.address] })) continue;
      await serial(() => send(owner, { address: d.resolver, abi: resolverAbi, functionName: "grantSetterRoles", args: [setter, writer.address] }));
      log(`writer ${writer.address} may now set "${key}" (and nothing else)`);
    }
    save({ writer: writer.address });
  }
  return { ...(await deployment()), writer: writer?.address ?? null };
}

/* ------------------------------------------------------------- writes */

/** Text (and optionally ETH address) records for one name in a single multicall. */
export async function writeRecords(name, { texts = {}, address = null }, { as = "owner" } = {}) {
  const account = as === "writer" ? (writerAccount() ?? ownerAccount()) : ownerAccount();
  if (!account) throw new Error("Set ENS_PRIVATE_KEY.");
  const { resolver } = await ready();
  const n = dnsName(name);
  const calls = Object.entries(texts)
    .filter(([, v]) => v != null)
    .map(([key, value]) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [n, key, String(value)] }));
  if (address) calls.push(encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [n, 60n, address] }));
  if (!calls.length) return null;
  const receipt = await serial(() => send(account, { address: resolver, abi: resolverAbi, functionName: "multicall", args: [calls] }));
  return receipt.transactionHash;
}

/** Create <label>.<parent> if it isn't there yet. The owner gets only the right to transfer it. */
async function issue(label, owner) {
  const { registry, resolver, expiry } = await ready();
  const c = publicClient();
  const existing = await c.readContract({ address: registry, abi: registryAbi, functionName: "findOwner", args: [label] });
  if (existing && existing !== ZERO) return { tx: null, owner: existing };
  const receipt = await serial(() =>
    send(ownerAccount(), { address: registry, abi: registryAbi, functionName: "register", args: [label, owner, ZERO, resolver, ROLE_CAN_TRANSFER_ADMIN, BigInt(expiry)] }),
  );
  return { tx: receipt.transactionHash, owner };
}

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ""));
const projectPage = (id) => (publicUrl() ? `${publicUrl()}/projects/${encodeURIComponent(id)}` : "");

/** A fighter's name and profile: issued once, profile refreshed every time. */
export async function issueProject(project) {
  const s = project.submission ?? {};
  const label = labelFor("projects", project.id, s.name, "");
  const name = `${label}.${parentName()}`;
  const teamWallet = project.ownerWallet ?? submissions.get(project.id)?.ownerWallet;
  const wallet = isAddr(teamWallet) ? teamWallet : ownerAddress();
  const issued = await issue(label, wallet);
  remember("projects", project.id, { label, name, owner: issued.owner, ...(issued.tx && { issuedTx: issued.tx, issuedAt: new Date().toISOString() }) });
  const tx = await writeRecords(name, {
    texts: { name: s.name ?? "", description: String(s.pitch ?? "").slice(0, 280), url: projectPage(project.id), "com.github": s.repoUrl ?? "" },
    address: isAddr(teamWallet) ? teamWallet : null,
  });
  remember("projects", project.id, { profileTx: tx, profileAt: new Date().toISOString() });
  return { name, ...issued, profileTx: tx };
}

/** The score records of one judged run, from the saved result. Pure; tested. */
export function scoreTexts(result, arkivPanelKey) {
  const scored = (result.reviews ?? []).filter((r) => r.status === "scored").length;
  return {
    "arena.score": (result.panelHundredths / 100).toFixed(2),
    "arena.judges": `${scored}/${(result.reviews ?? []).length}`,
    "arena.ranAt": new Date(result.ranAt).toISOString(),
    "arena.arkiv": arkivPanelKey ?? "",
  };
}

/** After a judged run: make sure the fighter has its name, then write the score. */
export async function writeScore(project, result, { arkivPanelKey = null } = {}) {
  if (!names().projects[project.id]) await issueProject(project);
  const name = projectName(project.id);
  const tx = await writeRecords(name, { texts: scoreTexts(result, arkivPanelKey) }, { as: "writer" });
  remember("projects", project.id, { scoreTx: tx, scoreAt: new Date().toISOString(), score: scoreTexts(result, arkivPanelKey)["arena.score"] });
  return { name, tx };
}

/** ENSIP-26 agent-context for a judge: who they are and how they score, as JSON. Pure; tested. */
export function agentContext(judge) {
  return JSON.stringify({
    type: "battle-arena.judge",
    name: judge.name,
    title: judge.title,
    background: judge.background,
    expectations: judge.expectations,
    dealBreakers: judge.dealBreakers,
    browniePoints: judge.browniePoints,
    tone: judge.tone,
    weights: judge.weights,
    personaVersion: judge.version,
  });
}

/** A judge's name and ENSIP-26 agent records. */
export async function issueJudge(judge, { model = null } = {}) {
  const label = labelFor("judges", judge.id, judge.name, "judge-");
  const name = `${label}.${parentName()}`;
  const issued = await issue(label, ownerAddress());
  remember("judges", judge.id, { label, name, ...(issued.tx && { issuedTx: issued.tx, issuedAt: new Date().toISOString() }) });
  const tx = await writeRecords(name, {
    texts: {
      name: judge.name,
      description: judge.title ?? "",
      "agent-context": agentContext(judge),
      "agent-endpoint[web]": publicUrl() ? `${publicUrl()}/judge` : "",
      "arena.model": model ?? "",
    },
  });
  remember("judges", judge.id, { profileTx: tx, profileAt: new Date().toISOString(), version: judge.version });
  return { name, ...issued, profileTx: tx };
}

/* ------------------------------------------------------------- fight records */

const MATCH_FINALIZED = 3; // TournamentManager.MatchStatus.Finalized
const TOURNAMENT_COMPLETED = 3; // TournamentStatus.Completed
const TOURNAMENT_CANCELED = 4; // TournamentStatus.Canceled: its matches don't count
const pts = (h) => (Number(h) / 100).toFixed(2);

/**
 * Wins, losses and titles per submission, from what the contract finalized.
 * brackets: [{ id, projects: [{ submissionId, name }], tournament: { status, champion }, matches: [Match] }]
 * The contract stores the winner as a bracket slot; the bracket file maps slots to submissions.
 * Pure; tested.
 */
export function tallyFights(brackets) {
  const out = {};
  const entry = (sid) => (out[sid] ??= { wins: 0, losses: 0, titles: 0, last: null });
  for (const b of [...brackets].sort((x, y) => Number(x.id) - Number(y.id))) {
    if (Number(b.tournament?.status) === TOURNAMENT_CANCELED) continue;
    (b.matches ?? []).forEach((m, index) => {
      if (!m || Number(m.status) !== MATCH_FINALIZED) return;
      const slotA = Number(m.projectA);
      const slotB = Number(m.projectB);
      const a = b.projects[slotA];
      const bb = b.projects[slotB];
      if (!a || !bb) return;
      const winnerSlot = Number(m.winner);
      for (const [me, them, mine, theirs, slot] of [
        [a, bb, m.scoreA, m.scoreB, slotA],
        [bb, a, m.scoreB, m.scoreA, slotB],
      ]) {
        const e = entry(me.submissionId);
        const won = winnerSlot === slot;
        if (won) e.wins++;
        else e.losses++;
        e.last = { won, tournamentId: String(b.id), match: index, opponentId: them.submissionId, opponentName: them.name, mine: pts(mine), theirs: pts(theirs) };
      }
    });
    if (Number(b.tournament?.status) === TOURNAMENT_COMPLETED) {
      const champ = b.projects[Number(b.tournament.champion)];
      if (champ) entry(champ.submissionId).titles++;
    }
  }
  return out;
}

/** The ENS text records for one fighter's tally. nameOf(submissionId) gives the opponent's ENS name when it has one. Pure; tested. */
export function recordTexts(t, nameOf = () => null) {
  const l = t.last;
  const opponent = l ? nameOf(l.opponentId) ?? l.opponentName : null;
  return {
    "arena.record": `${t.wins}-${t.losses}`,
    "arena.titles": String(t.titles),
    "arena.lastFight": l ? `${l.won ? "W" : "L"} vs ${opponent}, ${l.mine}-${l.theirs} (tournament #${l.tournamentId}, match ${l.match + 1})` : "",
  };
}

/**
 * Read every registered bracket's matches from the contract, tally, and write the records
 * that changed. Names that don't exist yet are issued first.
 * chain: { readTournament(id: bigint), readMatch(id: bigint, i: bigint) }
 */
export async function syncFightRecords({ brackets, readTournament, readMatch, log = () => {} }) {
  const withChain = [];
  for (const b of brackets()) {
    const id = BigInt(b.id);
    const tournament = await readTournament(id);
    const matches = [];
    for (let i = 0n; i < BigInt(b.projects.length - 1); i++) matches.push(await readMatch(id, i));
    withChain.push({ ...b, tournament, matches });
  }
  const tally = tallyFights(withChain);
  const written = [];
  for (const [sid, t] of Object.entries(tally)) {
    if (!names().projects[sid]) {
      const project = loadProject(sid);
      if (!project) continue;
      await issueProject(project);
    }
    const texts = recordTexts(t, projectName);
    if (JSON.stringify(names().projects[sid]?.fights) === JSON.stringify(texts)) continue;
    const name = projectName(sid);
    const tx = await writeRecords(name, { texts }, { as: "writer" });
    remember("projects", sid, { fights: texts, fightsTx: tx, fightsAt: new Date().toISOString() });
    written.push({ name, ...texts, tx });
    log(`${name}: ${texts["arena.record"]}${t.titles ? `, ${t.titles} title(s)` : ""} (${tx})`);
  }
  return written;
}

let lastFightSync = 0;
/** Called from the autorun loop. At most once a minute, never throws, skips if ENS isn't set up. */
export function syncFightsInBackground(chain, { everyMs = 60_000 } = {}) {
  if (!canWrite() || Date.now() - lastFightSync < everyMs) return;
  lastFightSync = Date.now();
  once("fights", () => syncFightRecords({ ...chain, log: (m) => console.log(`[ens] ${m}`) })).catch((e) => console.error(`[ens] fight records failed: ${e.shortMessage ?? e.message}`));
}

/* ------------------------------------------------------------- reads */

/** Text records of a name through the ENSv2 Universal Resolver (what any ENS client sees). */
export async function readTexts(name, keys) {
  const c = publicClient();
  const values = await Promise.all(keys.map((key) => c.getEnsText({ name: normalize(name), key, universalResolverAddress: ENSV2.universalResolver }).catch(() => null)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null]));
}

/** For /api/health. Never throws: a bad ENS_PARENT or key must not take the health check (and the app) down. */
export function healthInfo() {
  try {
    return { write: canWrite(), parent: parentName(), owner: ownerAddress(), scoreWriter: scoreWriterAddress() };
  } catch (e) {
    return { write: false, error: e.message };
  }
}

/** What the web app needs to resolve names itself. Never throws; { enabled: false } when ENS is misconfigured. */
export function publicConfig() {
  try {
    return configOrThrow();
  } catch (e) {
    return { enabled: false, error: e.message, projects: {}, judges: {} };
  }
}

function configOrThrow() {
  const all = names();
  const map = (o) => Object.fromEntries(Object.entries(o).map(([id, e]) => [id, e.name]));
  return {
    enabled: Object.keys(all.projects).length + Object.keys(all.judges).length > 0 || canWrite(),
    parent: parentName(),
    chainId: ENSV2.chainId,
    rpcUrl: rpcUrl(),
    universalResolver: ENSV2.universalResolver,
    appUrl: APP_URL,
    fighterKeys: FIGHTER_KEYS,
    judgeKeys: JUDGE_KEYS,
    projects: map(all.projects),
    judges: map(all.judges),
  };
}

/* ------------------------------------------------------------- background hooks */

const running = new Map();
const once = (key, fn) => {
  if (running.has(key)) return running.get(key);
  const job = fn().finally(() => running.delete(key));
  running.set(key, job);
  return job;
};

/** After a saved review: wait for the Arkiv publish (for its panel key), then write the score. Never throws. */
export function scoreInBackground(project, result, arkivJob = null) {
  if (!canWrite()) return;
  once(`score:${project.id}`, async () => {
    const arkiv = await Promise.resolve(arkivJob).catch(() => null);
    return writeScore(project, result, { arkivPanelKey: arkiv?.arkiv?.panelKey ?? null });
  }).catch((e) => console.error(`[ens] score for ${project.id} failed: ${e.shortMessage ?? e.message}`));
}

/** After a submission: give the fighter its name. Never throws. */
export function issueProjectInBackground(project) {
  if (!canWrite() || !project) return;
  once(`project:${project.id}`, () => issueProject(project)).catch((e) => console.error(`[ens] name for ${project.id} failed: ${e.shortMessage ?? e.message}`));
}

/** After a judge is created or edited: refresh their agent records. Never throws. */
export function issueJudgeInBackground(judge, opts) {
  if (!canWrite() || !judge) return;
  once(`judge:${judge.id}`, () => issueJudge(judge, opts)).catch((e) => console.error(`[ens] judge ${judge.id} failed: ${e.shortMessage ?? e.message}`));
}
