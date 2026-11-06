/*
 * Recent real bets on one match, read from the BettingPools contract's BetPlaced events
 * (Base Sepolia). Nothing is made up: no bets means an empty list.
 *
 * The public Base RPC only answers log queries spanning 200 blocks (about 7 minutes), so we
 * read the last two hours once, in 200-block pages, then follow new blocks from a cursor.
 */
import { formatUnits, parseAbiItem } from "viem";
import { pools, publicClient, usePoll, useToken } from "./chain.js";
import { matchMarket } from "./pools.js";

const BET_PLACED = parseAbiItem("event BetPlaced(uint256 indexed market, address indexed bettor, uint256 indexed project, uint256 amount)");
const SPAN = 200n; // the RPC's limit per query
const BACKFILL_PAGES = 18n; // ~3600 blocks, about 2 hours on Base
const PARALLEL = 2;
const MAX = 40;

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// One cache per market, shared by every component showing that fight.
const cache = new Map(); // market -> { logs, cursor, times }

async function logsBetween(market, from, to) {
  const pages = [];
  for (let start = from; start <= to; start += SPAN) pages.push([start, start + SPAN - 1n > to ? to : start + SPAN - 1n]);
  const out = [];
  for (let i = 0; i < pages.length; i += PARALLEL) {
    const batch = await Promise.all(
      pages.slice(i, i + PARALLEL).map(([fromBlock, toBlock]) =>
        // The public RPC rate-limits; a page that fails is skipped rather than losing every other page.
        publicClient.getLogs({ address: pools.address, event: BET_PLACED, args: { market }, fromBlock, toBlock }).catch(() => []),
      ),
    );
    out.push(...batch.flat());
  }
  return out;
}

/** Newest first: { bettor, side: "a"|"b", amount, time (ms), txHash, mine } */
export async function loadRecentBets(tournamentId, match, { decimals = 18, me = null, limit = 20 } = {}) {
  if (tournamentId == null || match?.a == null) return [];
  const market = matchMarket(tournamentId, match.index);
  const latest = await publicClient.getBlockNumber();
  let entry = cache.get(market);
  if (!entry) {
    const from = latest > SPAN * BACKFILL_PAGES ? latest - SPAN * BACKFILL_PAGES + 1n : 0n;
    entry = { logs: await logsBetween(market, from, latest), cursor: latest, times: new Map() };
    cache.set(market, entry);
  } else if (latest > entry.cursor) {
    entry.logs = [...entry.logs, ...(await logsBetween(market, entry.cursor + 1n, latest))].slice(-MAX);
    entry.cursor = latest;
  }
  const recent = entry.logs.slice(-limit).reverse();
  await Promise.all(
    [...new Set(recent.map((l) => l.blockNumber))]
      .filter((n) => !entry.times.has(n))
      .map(async (n) => {
        const block = await publicClient.getBlock({ blockNumber: n }).catch(() => null);
        if (block) entry.times.set(n, Number(block.timestamp) * 1000);
      }),
  );
  return recent.map((l) => {
    const bettor = l.args.bettor;
    return {
      bettor: short(bettor),
      side: Number(l.args.project) === Number(match.a) ? "a" : "b",
      amount: formatUnits(l.args.amount, decimals),
      time: entry.times.get(l.blockNumber) ?? Date.now(),
      txHash: l.transactionHash,
      mine: Boolean(me && bettor.toLowerCase() === me.toLowerCase()),
    };
  });
}

/** Live list for a match; refreshes every 10 s. [] while loading or if the chain can't be read. */
export function useRecentBets(tournament, match, me = null) {
  const info = useToken();
  const { data } = usePoll(
    () => (tournament?.preview ? Promise.resolve([]) : loadRecentBets(tournament?.id, match, { decimals: info?.decimals ?? 18, me }).catch(() => [])),
    [tournament?.id, match?.index, match?.a, info?.decimals, me],
    10000,
  );
  return data ?? [];
}
