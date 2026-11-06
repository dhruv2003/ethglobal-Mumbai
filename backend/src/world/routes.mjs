/*
 * /api/world: claim free FILTER with World ID.
 *
 *   GET  /api/world/status?wallet=0x...   is it set up, and has this wallet claimed
 *   POST /api/world/rp-signature          sign a verification request (the key stays here)
 *   POST /api/world/claim                 { wallet, idkitResponse } -> check the proof, send FILTER
 */
import path from "node:path";
import express from "express";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DATA_DIR } from "../store.mjs";
import { rateLimit } from "../security.mjs";
import { ACTION, ClaimError, claimStore, createClaims, worldVerifier } from "./claim.mjs";

const AMOUNT = process.env.STARTER_AMOUNT || "100";
const ENVIRONMENT = process.env.WORLD_ENVIRONMENT || "staging"; // staging = the World ID simulator
const APP_ID = process.env.WORLD_APP_ID;
const RP_ID = process.env.WORLD_RP_ID;
const SIGNING_KEY = process.env.WORLD_RP_SIGNING_KEY;
const SENDER_KEY = process.env.STARTER_PRIVATE_KEY;

const TOKEN = process.env.TOKEN_ADDRESS || "0x564B51f96406328Ad3dBD6E89b63219938F4fbb7";
const chain = defineChain({
  id: Number(process.env.CHAIN_ID || 84532),
  name: process.env.CHAIN_NAME || "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: process.env.NATIVE_SYMBOL || "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL || "https://sepolia.base.org"] } },
});
const ERC20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

function filterSender() {
  const account = privateKeyToAccount(SENDER_KEY);
  const pub = createPublicClient({ chain, transport: http() });
  const client = createWalletClient({ account, chain, transport: http() });
  let line = Promise.resolve();
  const send = async (wallet) => {
    const hash = await client.writeContract({ address: TOKEN, abi: ERC20, functionName: "transfer", args: [wallet, parseUnits(AMOUNT, 18)] });
    // Once it's broadcast it may still land, so a slow network must not free the claim for a second pack.
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
    if (receipt && receipt.status !== "success") throw new Error("transfer reverted");
    return hash;
  };
  // One at a time, so two claims can't pick the same transaction nonce.
  return (wallet) => {
    const result = line.then(() => send(wallet));
    line = result.catch(() => {});
    return result;
  };
}

// A bad key or damaged record switches this feature off. It must not take the judges down with it.
let store = null;
let claim = null;
if (APP_ID && RP_ID && SIGNING_KEY && SENDER_KEY) {
  try {
    store = claimStore(path.join(DATA_DIR, "world-claims.json"));
    claim = createClaims({ environment: ENVIRONMENT, store, hashSignal, verifyProof: worldVerifier({ rpId: RP_ID, environment: ENVIRONMENT }), sendFilter: filterSender() });
  } catch (e) {
    console.error("World ID claims are off:", e.message);
  }
}
const enabled = !!claim;

export const worldRouter = express.Router();

worldRouter.get("/status", (req, res) => {
  if (!enabled) return res.json({ enabled: false });
  const raw = String(req.query.wallet ?? "");
  const claimed = isAddress(raw, { strict: false }) ? store.walletClaim(getAddress(raw)) : null;
  res.json({ enabled: true, appId: APP_ID, rpId: RP_ID, action: ACTION, environment: ENVIRONMENT, amount: AMOUNT, claimed: !!claimed, hash: claimed?.hash ?? null });
});

worldRouter.post("/rp-signature", rateLimit({ max: 30, windowMs: 60 * 60 * 1000, message: "Too many tries from here. Try again later." }), (req, res) => {
  if (!enabled) return res.status(503).json({ error: "Free FILTER isn't set up on this server." });
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: SIGNING_KEY, action: ACTION });
  res.json({ sig, nonce, created_at: createdAt, expires_at: expiresAt });
});

worldRouter.post("/claim", rateLimit({ max: 20, windowMs: 60 * 60 * 1000, message: "Too many tries from here. Try again later." }), async (req, res) => {
  if (!enabled) return res.status(503).json({ error: "Free FILTER isn't set up on this server." });
  try {
    res.json(await claim(req.body ?? {}));
  } catch (e) {
    if (e instanceof ClaimError) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error("world claim failed:", e.message);
    res.status(500).json({ error: "Something went wrong, so nothing was sent." });
  }
});
