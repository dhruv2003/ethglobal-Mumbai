/*
 * The payout bot's logic. Once a pool can be settled it sends everything the contract allows
 * anyone to trigger: settle, then each winner's claim (or each refund), the project's 20%, the
 * platform's 10% and any rounding dust. The contract decides who gets paid and how much, so
 * this wallet only pays gas and never controls funds. Every step checks chain state first, so
 * a restart or a bettor claiming by hand just skips what is already done.
 */
const OUTCOME = { Unsettled: 0, Empty: 1, Void: 2, Resolved: 3 };
const SCAN_RANGE = 200n; // the public Base Sepolia RPC refuses a wider eth_getLogs

const blankState = (fromBlock) => ({ cursor: String(fromBlock), markets: {} });

/**
 * chain: { latestBlock(), betLogs(from, to) -> [{ market, bettor }], read(fn, args), send(fn, args) -> hash }
 * store: { load() -> state|null, save(state) }
 */
export function createPayoutBot({ chain, store, fromBlock = 0n, log = () => {} }) {
  const state = store.load() ?? blankState(fromBlock);
  let lastError = null;
  let scanning = false;

  const entry = (market) => (state.markets[market] ??= { bettors: [], txs: [], done: false, lastError: null });
  const save = () => store.save(state);

  async function pay(market, fn, args, bettor) {
    const hash = await chain.send(fn, args);
    entry(market).txs.push({ fn, bettor: bettor ?? null, hash, at: new Date().toISOString() });
    save();
    log(`${fn} market ${market}${bettor ? ` for ${bettor}` : ""}: ${hash}`);
  }

  /** New bets since the last look. The cursor only moves past blocks that were read. */
  async function scan() {
    const latest = await chain.latestBlock();
    let from = BigInt(state.cursor);
    while (from <= latest) {
      const to = from + SCAN_RANGE - 1n < latest ? from + SCAN_RANGE - 1n : latest;
      for (const { market, bettor } of await chain.betLogs(from, to)) {
        const m = entry(String(market));
        if (!m.bettors.includes(bettor)) m.bettors.push(bettor);
      }
      from = to + 1n;
      state.cursor = String(from);
      save();
    }
  }

  /** Does everything currently possible for one pool. Returns once it can't go further. */
  async function processMarket(key) {
    const m = entry(key);
    const market = BigInt(key);
    let pool = await chain.read("getPool", [market]);

    if (Number(pool.outcome) === OUTCOME.Unsettled) {
      try {
        await pay(key, "settle", [market]);
      } catch (e) {
        if (isNotReady(e)) return; // no winner yet, and betting may still be open
        throw e;
      }
      pool = await chain.read("getPool", [market]);
    }

    const outcome = Number(pool.outcome);
    if (outcome === OUTCOME.Void) {
      for (const bettor of m.bettors) {
        if ((await chain.read("refundable", [market, bettor])) > 0n) await pay(key, "refundFor", [market, bettor], bettor);
      }
    } else if (outcome === OUTCOME.Resolved) {
      for (const bettor of m.bettors) {
        if ((await chain.read("claimable", [market, bettor])) > 0n) await pay(key, "claimFor", [market, bettor], bettor);
      }
      if (!pool.projectPaid) await pay(key, "claimProject", [market]);
      if (!pool.platformPaid) await pay(key, "claimPlatform", [market]);
      pool = await chain.read("getPool", [market]);
      if (pool.claimedStake === pool.winningStake && !pool.dustSwept && pool.bettorBucket > pool.paidToBettors) await pay(key, "sweepDust", [market]);
    }
    m.done = true;
    m.lastError = null;
    save();
  }

  /** One pass: read new bets, then move every unfinished pool forward. Never overlaps itself. */
  async function tick() {
    if (scanning) return;
    scanning = true;
    try {
      await scan();
      lastError = null;
      for (const [key, m] of Object.entries(state.markets)) {
        if (m.done) continue;
        try {
          await processMarket(key);
        } catch (e) {
          // One stuck pool must not stop the others. It is retried on the next pass.
          m.lastError = String(e.shortMessage ?? e.message ?? e).slice(0, 300);
          save();
          log(`market ${key} failed: ${m.lastError}`);
        }
      }
    } catch (e) {
      lastError = String(e.shortMessage ?? e.message ?? e).slice(0, 300);
      log(`scan failed: ${lastError}`);
    } finally {
      scanning = false;
    }
  }

  const status = () => ({ cursor: state.cursor, lastError, markets: state.markets });
  return { tick, status };
}

const isNotReady = (e) => /NotReady/.test(`${e?.cause?.data?.errorName ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`);
