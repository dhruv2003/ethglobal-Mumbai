/* Connects the auto-run logic to the chain and the fight store. Starts with the server. */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import crypto from "node:crypto";
import { keccak256, stringToHex, parseEventLogs } from "viem";
import { dossiers, pipelines, submissions } from "../store.mjs";
import { events, OVERALL } from "../events.mjs";
import { autorunPass } from "./autorun.mjs";
import { organizerPass, schedule } from "./autoOrganizer.mjs";
import { proposeBracket } from "./matchmaking.mjs";
import { listBrackets, runningFights, saveBracket, startFight, statusOf } from "./routes.mjs";
import { syncFightsInBackground } from "../ens/ens.mjs";

const abi = JSON.parse(fs.readFileSync(new URL("../../contracts/abi/TournamentManager.json", import.meta.url), "utf8"));
const MANAGER_ABI = abi.abi ?? abi;
const EVERY_MS = 10000;

let botSend = null;
let readManager = null;
let chainNow = null;
let canOrganize = false;
let serverRoles = { organizer: false, publisher: false, address: null };

const hash = (value) => keccak256(stringToHex(JSON.stringify(value)));
const randomSeed = () => `0x${crypto.randomBytes(32).toString("hex")}`;
const WEI = 10n ** 18n;

const needBot = () => {
  if (!botSend) throw Object.assign(new Error("The server has no publishing wallet."), { status: 503 });
};

/** Actions only a bracket's publisher or organizer may send, for brackets this server runs. */
export async function openMatchAsBot(id, index, minutes) {
  needBot();
  const [now, t] = await Promise.all([chainNow(), readManager("getTournament", [BigInt(id)])]);
  const cutoff = now + BigInt(Math.max(1, Math.floor(Number(minutes)) || 1)) * 60n;
  return botSend("openMatch", [BigInt(id), BigInt(index), cutoff, cutoff > t.scheduledStart ? cutoff : t.scheduledStart]);
}
export async function voidMatchAsBot(id, index, reasonHash) {
  needBot();
  return botSend("voidMatch", [BigInt(id), BigInt(index), reasonHash]);
}
export async function cancelTournamentAsBot(id, reasonHash) {
  needBot();
  return botSend("cancelTournament", [BigInt(id), reasonHash]);
}

/** What the organizer page shows. */
export const autoStatus = () => ({ ...serverRoles, ready: serverRoles.organizer && serverRoles.publisher });

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

  const minutesFor = (eventId) => events.get(eventId)?.bettingMinutes ?? Number(process.env.AUTO_BETTING_MINUTES || 10);

  // Creates the tournament on chain and saves its bracket. The next pass freezes it and opens matches.
  const createAndRegister = async (event, track, field) => {
    const adminWallet = event.createdBy ?? process.env.ADMIN_WALLET?.split(",")[0]?.trim();
    if (!adminWallet) throw new Error("Set ADMIN_WALLET in backend/.env: nobody is set to receive the platform's 10%.");
    const seed = randomSeed();
    const plan = await proposeBracket({ submissionIds: field, seed });
    const now = await chainNow();
    const times = schedule(now, event.bettingMinutes, field.length);
    const txHash = await botSend("createTournament", [
      {
        configHash: hash({ event: event.id, name: event.name, track: track.id, prize: track.prize, deadline: event.deadline, capacity: field.length, created: String(now), rubric: "40/20/20/10/10", split: "70/20/10" }),
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
    saveBracket(id, { title: `${event.name} · ${track.name}`, track: track.name, eventId: event.id, trackId: track.id, submissionIds: plan.slots, proposal: plan.resultHash });
    return id;
  };

  const freeze = (bracket) => {
    const projects = bracket.projects.map((p) => {
      const s = submissions.get(p.submissionId);
      return { owner: s.ownerWallet, rewardWallet: s.rewardWallet ?? s.ownerWallet, snapshotHash: hash({ submissionId: s.id, repoUrl: s.repoUrl, name: s.project?.name, pitch: s.project?.pitch }) };
    });
    return botSend("freeze", [BigInt(bracket.id), projects, bracket.matching.seed, `0x${bracket.matching.resultHash}`]);
  };

  const openArgs = async (bracket, i) => {
    const id = BigInt(bracket.id);
    const [now, t] = await Promise.all([chainNow(), readManager("getTournament", [id])]);
    const cutoff = now + BigInt(minutesFor(bracket.eventId)) * 60n;
    return [id, i, cutoff, cutoff > t.scheduledStart ? cutoff : t.scheduledStart];
  };
  const canOpen = async (bracket, i) => {
    try {
      await client.simulateContract({ ...manager, account, functionName: "openMatch", args: await openArgs(bracket, i) });
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
    canOrganize = organizer && publisher;
  };

  const REVIEW_GRACE_MS = 30 * 60 * 1000; // a stuck review can't hold a tournament back forever
  const organizerDeps = () => ({
    events: () => (process.env.AUTO_TOURNAMENTS === "0" ? [] : events.list()),
    overall: OVERALL,
    entries: (eventId) => {
      const event = events.get(eventId);
      return submissions.list().filter((s) => s.eventId === eventId).map((s) => ({
        id: s.id,
        tracks: s.tracks ?? [],
        submittedAt: s.submittedAt,
        ready: Boolean(dossiers.get(s.id)),
        reviewing: !pipelines.get(s.id)?.finishedAt && Date.now() < Date.parse(event.deadline) + REVIEW_GRACE_MS,
      }));
    },
    brackets: listBrackets,
    createAndRegister,
    readTournament: (id) => readManager("getTournament", [id]),
    readMatch: (id, i) => readManager("getMatch", [id, i]),
    freeze,
    openMatch: async (bracket, i) => botSend("openMatch", await openArgs(bracket, i)),
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
      if (canOrganize) await organizerPass(organizerDeps());
      await autorunPass({
        brackets: listBrackets,
        readTournament: (id) => client.readContract({ ...manager, functionName: "getTournament", args: [id] }),
        readMatch: (id, i) => client.readContract({ ...manager, functionName: "getMatch", args: [id, i] }),
        nowSec: async () => (await client.getBlock()).timestamp,
        fightOf: statusOf,
        startFight,
        runningFights,
        publish,
        botAddress: account?.address ?? null,
        log: (line) => console.log(`[autorun] ${line}`),
      });
      // Win/loss records on each fighter's ENS name, from what the contract finalized (at most once a minute).
      syncFightsInBackground({
        brackets: listBrackets,
        readTournament: (id) => client.readContract({ ...manager, functionName: "getTournament", args: [id] }),
        readMatch: (id, i) => client.readContract({ ...manager, functionName: "getMatch", args: [id, i] }),
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
