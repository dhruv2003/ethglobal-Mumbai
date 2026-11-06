/*
 * Runs the payout bot against the real chain. It needs RELAYER_PRIVATE_KEY in backend/.env:
 * a wallet made only for this, holding a little test ETH. Without the key the bot stays off and
 * the fight page offers the manual buttons instead.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DATA_DIR } from "../store.mjs";
import { createPayoutBot } from "./bot.mjs";

const abi = JSON.parse(fs.readFileSync(new URL("../../contracts/abi/BettingPools.json", import.meta.url), "utf8"));
const POOLS_ABI = abi.abi ?? abi;
const BET_PLACED = parseAbiItem("event BetPlaced(uint256 indexed market, address indexed bettor, uint256 indexed project, uint256 amount)");
const EVERY_MS = 6000;
const FILE = path.join(DATA_DIR, "payouts.json");

const fileStore = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      return null;
    }
  },
  save(state) {
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, FILE);
  },
};

let bot = null;
let account = null;
let publicClient = null;

const validKey = (k) => /^0x[0-9a-fA-F]{64}$/.test(k ?? "");

export function startPayouts() {
  const key = process.env.RELAYER_PRIVATE_KEY?.trim();
  const poolsAddress = process.env.BETTING_POOLS_ADDRESS;
  if (!validKey(key) || !poolsAddress) {
    console.log("[payouts] off: set RELAYER_PRIVATE_KEY and BETTING_POOLS_ADDRESS in backend/.env");
    return false;
  }
  const chain = defineChain({
    id: Number(process.env.CHAIN_ID),
    name: process.env.CHAIN_NAME ?? "chain",
    nativeCurrency: { name: "Ether", symbol: process.env.NATIVE_SYMBOL ?? "ETH", decimals: 18 },
    rpcUrls: { default: { http: [process.env.RPC_URL] } },
  });
  account = privateKeyToAccount(key);
  publicClient = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });
  const pools = { address: getAddress(poolsAddress), abi: POOLS_ABI };

  bot = createPayoutBot({
    store: fileStore,
    fromBlock: BigInt(process.env.PAYOUTS_FROM_BLOCK ?? 0),
    log: (line) => console.log(`[payouts] ${line}`),
    chain: {
      latestBlock: () => publicClient.getBlockNumber(),
      betLogs: async (fromBlock, toBlock) => {
        const logs = await publicClient.getLogs({ address: pools.address, event: BET_PLACED, fromBlock, toBlock });
        return logs.map((l) => ({ market: l.args.market, bettor: l.args.bettor }));
      },
      read: (functionName, args) => publicClient.readContract({ ...pools, functionName, args }),
      send: async (functionName, args) => {
        const { request } = await publicClient.simulateContract({ ...pools, account, functionName, args });
        const hash = await walletClient.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
        return hash;
      },
    },
  });
  const run = () => bot.tick().catch((e) => console.error(`[payouts] ${e.message}`));
  run();
  setInterval(run, EVERY_MS).unref();
  console.log(`[payouts] on, paying gas from ${account.address}`);
  return true;
}

/** What the web app and /api/health show. No secrets. */
export async function payoutStatus() {
  if (!bot) return { enabled: false };
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => null);
  return { enabled: true, address: account.address, balance: balance == null ? null : formatEther(balance), ...bot.status() };
}
