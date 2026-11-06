/* Connects the auto-run logic to the chain and the fight store. Starts with the server. */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import crypto from "node:crypto";
import { keccak256, stringToHex, parseEventLogs } from "viem";
import { dossiers, submissions } from "../store.mjs";
import { autorunPass } from "./autorun.mjs";
import { organizerPass, schedule } from "./autoOrganizer.mjs";
import { proposeBracket } from "./matchmaking.mjs";
import { listBrackets, saveBracket, startFight, statusOf } from "./routes.mjs";

const abi = JSON.parse(fs.readFileSync(new URL("../../contracts/abi/TournamentManager.json", import.meta.url), "utf8"));
const MANAGER_ABI = abi.abi ?? abi;
const EVERY_MS = 10000;

let botSend = null;
let readManager = null;
let chainNow = null;
let runTournament = null;
let serverRoles = { organizer: false, publisher: false, address: null };

const hash = (value) => keccak256(stringToHex(JSON.stringify(value)));
const randomSeed = () => `0x${crypto.randomBytes(32).toString("hex")}`;
const WEI = 10n ** 18n;

/** What the organizer page shows. */
export const autoStatus = () => ({ ...serverRoles, ready: serverRoles.organizer && serverRoles.publisher });

/** Start a tournament now with chosen projects, even ones that already fought (organizer key). */
export async function startTournamentNow(submissionIds) {
  if (!runTournament) throw Object.assign(new Error("The server has no wallet with the organizer role yet."), { status: 503 });
  return String(await runTournament(submissionIds));
}

/** Match actions only a tournament's publisher may send, for tournaments this server publishes. */
export async function openMatchAsBot(id, index, minutes) {
  if (!botSend) throw Object.assign(new Error("The server has no publishing wallet."), { status: 503 });
  const [now, t] = await Promise.all([chainNow(), readManager("getTournament", [BigInt(id)])]);
  const cutoff = now + BigInt(Math.max(1, Math.floor(Number(minutes)) || 1)) * 60n;
  const start = cutoff > t.scheduledStart ? cutoff : t.scheduledStart;
  return botSend("openMatch", [BigInt(id), BigInt(index), cutoff, start]);
}

export async function voidMatchAsBot(id, index, reasonHash) {
  if (!botSend) throw Object.assign(new Error("The server has no publishing wallet."), { status: 503 });
  return botSend("voidMatch", [BigInt(id), BigInt(index), reasonHash]);
}

export function startAutorun() {
  const address = process.env.TOURNAMENT_MANAGER_ADDRESS;
  if (!address || !process.env.RPC_URL) return console.log("[autorun] off: set TOURNAMENT_MANAGER_ADDRESS and RPC_URL");
  const chain = defineChain({
    id: Number(process.env.CHAIN_ID),
    name: process.env.CHAIN_NAME ?? "chain",
    nativeCurrency: { name: "Ether", symbol: process.env.NATIVE_SYMBOL ?? "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.RPC_URL] } },
  });
  const client = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
  const manager = { address: getAddress(address), abi: MANAGER_ABI };
  const key = process.env.RELAYER_PRIVATE_KEY?.trim();
  const account = /^0x[0-9a-fA-F]{64}$/.test(key ?? "") ? privateKeyToAccount(key) : null;
  const wallet = account ? createWalletClient({ account, chain, transport: http(process.env.RPC_URL) }) : null;

  readManager = (functionName, args) => client.readContract({ ...manager, functionName, args });
  chainNow = async () => (await client.getBlock()).timestamp;
  if (account) {
    botSend = async (functionName, args) => {
      const { request } = await client.simulateContract({ ...manager, account, functionName, args });
      const hash = await wallet.writeContract(request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
      return hash;
    };
  }
  const publish = (id, index, fight) => botSend("publishResult", [id, index, fight.scores.a, fight.scores.b, fight.tie?.a ?? 0, fight.tie?.b ?? 0, fight.resultHash]);

  const minutes = Number(process.env.AUTO_BETTING_MINUTES || 10);
  const adminWallet = process.env.PLATFORM_WALLET;

  // Creates the tournament on chain and saves its bracket. The next pass freezes it and opens matches.
  const createAndRegister = async (field) => {
    const seed = randomSeed();
    const plan = await proposeBracket({ submissionIds: field, seed });
    const now = await chainNow();
    const times = schedule(now, minutes, field.length);
    const txHash = await botSend("createTournament", [
      {
        configHash: hash({ capacity: field.length, created: String(now), rubric: "40/20/20/10/10", split: "70/20/10" }),
        capacity: field.length,
        scheduledStart: times.scheduledStart,
        bettingCutoff: times.bettingCutoff,
        resolutionDeadline: times.resolutionDeadline,
        reviewer: adminWallet,
        publisher: account.address,
        platformRecipient: adminWallet,
        minBet: WEI,
        maxBet: 1000n * WEI,
      },
    ]);
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const [created] = parseEventLogs({ abi: MANAGER_ABI, logs: receipt.logs, eventName: "TournamentCreated" });
    const id = created.args.id;
    saveBracket(id, { title: `Tournament #${id}`, submissionIds: plan.slots, proposal: plan.resultHash });
    return id;
  };

  const freeze = (bracket) => {
    const projects = bracket.projects.map((p) => {
      const s = submissions.get(p.submissionId);
      return { owner: s.ownerWallet, rewardWallet: s.rewardWallet ?? s.ownerWallet, snapshotHash: hash({ submissionId: s.id, repoUrl: s.repoUrl, name: s.project?.name, pitch: s.project?.pitch }) };
    });
    return botSend("freeze", [BigInt(bracket.id), projects, bracket.matching.seed, `0x${bracket.matching.resultHash}`]);
  };

  const openArgs = async (id, i) => {
    const [now, t] = await Promise.all([chainNow(), readManager("getTournament", [id])]);
    const cutoff = now + BigInt(minutes) * 60n;
    return [id, i, cutoff, cutoff > t.scheduledStart ? cutoff : t.scheduledStart];
  };
  const canOpen = async (id, i) => {
    try {
      await client.simulateContract({ ...manager, account, functionName: "openMatch", args: await openArgs(id, i) });
      return true;
    } catch {
      return false; // its fighters aren't decided yet
    }
  };

  const refreshRoles = async () => {
    if (!account) return;
    const [org, pub] = await Promise.all([readManager("ORGANIZER_ROLE", []), readManager("PUBLISHER_ROLE", [])]);
    const [organizer, publisher] = await Promise.all([readManager("hasRole", [org, account.address]), readManager("hasRole", [pub, account.address])]);
    serverRoles = { organizer, publisher, address: account.address };
    runTournament = organizer && publisher && adminWallet ? createAndRegister : null;
  };

  const organizerDeps = () => ({
    submissions: () =>
      process.env.AUTO_TOURNAMENTS === "0"
        ? []
        : submissions.list().map((s) => ({ id: s.id, submittedAt: s.submittedAt, ready: Boolean(dossiers.get(s.id)) })),
    brackets: listBrackets,
    createAndRegister,
    readTournament: (id) => readManager("getTournament", [id]),
    readMatch: (id, i) => readManager("getMatch", [id, i]),
    freeze,
    openMatch: async (id, i) => botSend("openMatch", await openArgs(id, i)),
    canOpen,
    botAddress: account.address,
    log: (line) => console.log(`[organizer] ${line}`),
  });

  let busy = false;
  const pass = async () => {
    if (busy) return;
    busy = true;
    try {
      await refreshRoles();
      if (runTournament) await organizerPass(organizerDeps());
      await autorunPass({
        brackets: listBrackets,
        readTournament: (id) => client.readContract({ ...manager, functionName: "getTournament", args: [id] }),
        readMatch: (id, i) => client.readContract({ ...manager, functionName: "getMatch", args: [id, i] }),
        nowSec: async () => (await client.getBlock()).timestamp,
        fightOf: statusOf,
        startFight,
        publish,
        botAddress: account?.address ?? null,
        log: (line) => console.log(`[autorun] ${line}`),
      });
    } catch (e) {
      console.error(`[autorun] ${e.shortMessage ?? e.message}`);
    } finally {
      busy = false;
    }
  };
  setInterval(pass, EVERY_MS).unref();
  pass();
  console.log("[autorun] on");
}
