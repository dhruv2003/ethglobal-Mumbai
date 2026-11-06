/*
 * Everything that talks to the contracts: clients, reads and the transaction flow.
 * Chain and addresses come from .env (see .env.example) through config/event.js.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, defineChain, formatUnits, http, parseUnits } from "viem";
import tokenAbi from "@contracts/abi/FilterCoin.json";
import managerAbi from "@contracts/abi/TournamentManager.json";
import poolsAbi from "@contracts/abi/BettingPools.json";
import { CONTRACTS, EVENT } from "../config/event.js";
import { getProvider } from "./wallet.js";
import { peek, put, sameData } from "./cache.js";

const n = EVENT.network;

export const chain = defineChain({
  id: n.chainId,
  name: n.name,
  nativeCurrency: { name: n.symbol, symbol: n.symbol, decimals: 18 },
  rpcUrls: { default: { http: [n.rpcUrl] } },
  blockExplorers: { default: { name: "Explorer", url: n.explorerUrl } },
});

export const publicClient = createPublicClient({ chain, transport: http(n.rpcUrl) });

export const token = { address: CONTRACTS.token, abi: tokenAbi };
export const manager = { address: CONTRACTS.manager, abi: managerAbi };
export const pools = { address: CONTRACTS.pools, abi: poolsAbi };

export const read = (contract, functionName, args = []) => publicClient.readContract({ ...contract, functionName, args });

export const txUrl = (hash) => `${n.explorerUrl}/tx/${hash}`;
export const addressUrl = (address) => `${n.explorerUrl}/address/${address}`;

/* ------------------------------------------------------------- token */

let tokenInfo = null;

/** Symbol, decimals and (on FilterCoin only) the fixed price. */
export function loadToken() {
  tokenInfo ??= (async () => {
    const [symbol, decimals, rate] = await Promise.all([
      read(token, "symbol"),
      read(token, "decimals"),
      // A token without RATE hides buying and selling.
      read(token, "RATE").catch(() => null),
    ]);
    return { symbol, decimals, rate };
  })().catch((e) => {
    tokenInfo = null;
    throw e;
  });
  return tokenInfo;
}

export function useToken() {
  const { data } = usePoll(loadToken, [], 0, { key: "token" });
  return data ?? null;
}

export const toUnits = (text, decimals) => {
  try {
    return parseUnits(String(text).trim() || "0", decimals);
  } catch {
    return null;
  }
};

/** A readable amount: at most `places` decimals, with thousands separators. */
export function formatAmount(value, decimals = 18, places = 2) {
  if (value == null) return "—";
  const [whole, frac = ""] = formatUnits(value, decimals).split(".");
  const cut = frac.slice(0, places).replace(/0+$/, "");
  const grouped = BigInt(whole).toLocaleString("en-US");
  if (value > 0n && whole === "0" && !cut) return `<0.${"0".repeat(places - 1)}1`;
  return cut ? `${grouped}.${cut}` : grouped;
}

/* -------------------------------------------------------------- data */

/**
 * Runs an async read now and every `ms` (0 = once). Keeps old data while refreshing.
 * With `key`, the last answer is cached (lib/cache.js) and shown straight away on the next
 * visit, before the network answers. `initial()` can supply a first guess when nothing is cached.
 * When `deps` change, the previous item's data is dropped (never shown under the new one).
 */
export function usePoll(fn, deps = [], ms = 10000, { key = null, initial = null, private: isPrivate = false } = {}) {
  const sig = deps.map(String).join("|");
  const seed = () => {
    const data = key != null ? (peek(key) ?? initial?.() ?? null) : (initial?.() ?? null);
    return { sig, data, error: null, loading: true };
  };
  const [stored, setState] = useState(seed);
  // Deps changed: show the new item's cache (or nothing), never the old item's data.
  const state = stored.sig === sig ? stored : seed();
  const latest = useRef(0);
  const retries = useRef(0);
  const retryTimer = useRef(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    try {
      const data = await fn();
      if (id !== latest.current) return;
      retries.current = 0;
      if (keyRef.current != null) put(keyRef.current, data, { private: isPrivate });
      // Same answer as before (often the cached one): keep the old object so nothing re-renders or re-animates.
      setState((s) => ({ sig, data: s.sig === sig && sameData(s.data, data) ? s.data : data, error: null, loading: false }));
    } catch (error) {
      if (id !== latest.current) return;
      setState((s) => ({ ...(s.sig === sig ? s : seed()), error, loading: false }));
      // A one-shot read (ms = 0) that failed would otherwise never be tried again: back off and retry.
      if (!ms && retries.current < 5) {
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(refresh, 3000 * 2 ** retries.current++);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms]);

  useEffect(() => {
    retries.current = 0;
    setState((s) => (s.sig === sig ? { ...s, loading: true } : seed()));
    refresh();
    const t = ms ? setInterval(refresh, ms) : null;
    return () => {
      if (t) clearInterval(t);
      clearTimeout(retryTimer.current);
      latest.current++; // an answer for the old deps must not land after they changed
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, ms]);

  return { ...state, refresh };
}

export async function readTournament(id) {
  const t = await read(manager, "getTournament", [BigInt(id)]);
  if (t.status === 0) return null;
  const count = t.projectCount || t.capacity;
  const matches = await Promise.all(Array.from({ length: count - 1 }, (_, i) => read(manager, "getMatch", [BigInt(id), BigInt(i)])));
  return { id: Number(id), ...t, count, matches };
}

export async function listTournaments() {
  const total = Number(await read(manager, "tournamentCount"));
  const list = await Promise.all(Array.from({ length: total }, (_, i) => readTournament(i + 1)));
  return list.filter(Boolean).reverse();
}

export async function chainNow() {
  const block = await publicClient.getBlock();
  return block.timestamp;
}

/* -------------------------------------------------------------- errors */

const REVERTS = {
  ZeroValue: "Enter an amount above zero.",
  PayoutTooSmall: "That amount is too small to sell.",
  EthTransferFailed: "The contract couldn't send the ETH to your wallet.",
  ERC20InsufficientBalance: "You don't have enough tokens for this.",
  ERC20InsufficientAllowance: "The token approval didn't reach the network yet. Try again in a moment.",
  ERC2612ExpiredSignature: "This approval signature has expired.",
  AccessControlUnauthorizedAccount: "This wallet doesn't have the role for that action.",
  MarketNotOpen: "This pool isn't open for betting.",
  BettingClosed: "Betting has closed for this pool. Your bet wasn't placed.",
  InvalidSelection: "That project isn't part of this pool.",
  WalletBlocked: "This wallet is taking part in the tournament, so it can't bet here.",
  StakeBelowMinimum: "That's below the minimum bet.",
  StakeAboveMaximum: "That would take you over this wallet's limit for the pool.",
  AlreadySettled: "This pool is already settled.",
  NotReady: "This pool can't settle yet. It's waiting for a result, or for its deadline.",
  WrongOutcome: "This pool's outcome doesn't allow that.",
  NothingToPay: "There's nothing to pay this wallet.",
  AlreadyPaid: "This has already been paid.",
  ClaimsOutstanding: "Some winners still haven't claimed.",
  EnforcedPause: "Betting is paused right now.",
  InvalidCapacity: "A tournament needs exactly 2, 4, 8 or 16 projects.",
  InvalidSchedule: "Those times don't work. Betting must close in the future and before the start.",
  DeadlineTooSoon: "The resolution deadline is too soon.",
  InvalidAddress: "One of the wallet addresses is empty.",
  InvalidBetLimits: "The minimum bet must be above zero and below the maximum.",
  PublisherNotApproved: "That publisher doesn't have the publisher role yet.",
  NotOrganizer: "Only this tournament's organizer can do that.",
  NotPublisher: "Only this tournament's publisher can do that.",
  NotReviewer: "Only this tournament's reviewer can decide a tied match.",
  WrongTournamentStatus: "The tournament isn't in the right stage for that.",
  InvalidProjectCount: "That's more projects than this tournament allows.",
  InvalidMatch: "That match doesn't exist in this bracket.",
  WrongMatchStatus: "The match isn't in the right stage for that.",
  PreviousRoundUnfinished: "Every match in the earlier round must finish first.",
  BettingStillOpen: "Betting is still open. Wait for the cutoff before publishing.",
  DeadlinePassed: "This match's deadline has passed.",
  DeadlineNotReached: "The deadline hasn't passed yet.",
  InvalidScore: "Scores must be between 0 and 100.",
  UnexpectedTiebreak: "Leave the tie-break scores at 0 unless the main scores are equal.",
  InvalidWinner: "The winner must be one of the two fighters.",
};

export function friendlyTxError(error) {
  const text = `${error?.shortMessage ?? ""} ${error?.details ?? ""} ${error?.message ?? ""}`;
  if (error?.code === 4001 || /user (rejected|denied)/i.test(text)) return "You closed the MetaMask request, so nothing was sent.";
  if (/insufficient funds/i.test(text)) return `You don't have enough ${n.symbol} for this and its gas.`;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = reverted?.data?.errorName;
    if (name && REVERTS[name]) return REVERTS[name];
    if (reverted?.reason) return reverted.reason;
    if (error.shortMessage) return error.shortMessage;
  }
  for (const [name, message] of Object.entries(REVERTS)) if (text.includes(name)) return message;
  return "The transaction failed. Nothing changed.";
}

/* -------------------------------------------------------- transactions */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs contract calls one after another through MetaMask.
 * tx.phase: idle | sign | pending | confirmed | failed. Each call may give a `label`.
 */
export function useTx(wallet, onDone) {
  const [tx, setTx] = useState({ phase: "idle" });
  const done = useRef(onDone);
  done.current = onDone;

  const run = useCallback(
    async (calls, successMessage = "Confirmed on chain.") => {
      const provider = getProvider();
      if (!provider || !wallet.address) {
        setTx({ phase: "failed", message: "Connect your wallet first." });
        return false;
      }
      const list = (Array.isArray(calls) ? calls : [calls]).filter(Boolean);
      const client = createWalletClient({ chain, transport: custom(provider) });
      let lastHash = null;
      try {
        for (const [i, { label, ...call }] of list.entries()) {
          const step = list.length > 1 ? `Step ${i + 1} of ${list.length}: ` : "";
          setTx({ phase: "sign", message: `${step}${label ?? "Confirm"} in MetaMask` });
          const simulate = () => publicClient.simulateContract({ ...call, account: wallet.address });
          // A public RPC can briefly lag behind the previous step's receipt.
          const { request } = await simulate().catch(async (e) => {
            if (i === 0) throw e;
            await wait(2500);
            return simulate();
          });
          lastHash = await client.writeContract(request);
          setTx({ phase: "pending", hash: lastHash, message: `${step}Waiting for the network…` });
          const receipt = await publicClient.waitForTransactionReceipt({ hash: lastHash, confirmations: 1 });
          if (receipt.status !== "success") throw new Error("reverted");
        }
        setTx({ phase: "confirmed", hash: lastHash, message: successMessage });
        await done.current?.();
        return true;
      } catch (e) {
        setTx({ phase: "failed", hash: lastHash, message: friendlyTxError(e) });
        return false;
      }
    },
    [wallet.address],
  );

  const reset = useCallback(() => setTx({ phase: "idle" }), []);
  return { tx, run, reset, busy: tx.phase === "sign" || tx.phase === "pending" };
}
