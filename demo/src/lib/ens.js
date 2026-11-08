/*
 * ENSv2 names of fighters and judges. The backend only says which name belongs to
 * which project or judge (/api/ens); every record is read here, in the browser,
 * from ENS on Sepolia through the Universal Resolver, as any ENS client would.
 *
 * DEMO: if Sepolia doesn't answer, the records fall back to src/data/ens.json, a
 * snapshot read from the same names by `npm run ens-snapshot`. The UI says which one it shows.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import ensSnapshot from "@data/ens.json";
import { api } from "./api.js";

let config = null;
/** Parent name, RPC, resolver, and the id -> name maps. null when the backend is offline. */
export const ensConfig = () => (config ??= api("/ens").catch(() => (config = null)));

let client = null;
const clientFor = (cfg) => (client ??= createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) }));

const cache = new Map(); // name -> { at, value }
const FRESH_MS = 30_000;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("Sepolia took too long")), ms))]);

/**
 * One name, read from ENS: its text records, the address it resolves to and its resolver contract.
 * { source: "live", at } when Sepolia answered; { source: "snapshot", at } when it fell back.
 */
const pending = new Map(); // name -> promise, so cards reading the same name share one read
export function resolveName(name, keys, cfg, { force = false } = {}) {
  const hit = cache.get(name);
  if (!force && hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.value);
  if (!force && pending.has(name)) return pending.get(name);
  const p = readName(name, keys, cfg).finally(() => pending.delete(name));
  pending.set(name, p);
  return p;
}

async function readName(name, keys, cfg) {
  const c = clientFor(cfg);
  const n = normalize(name);
  const opts = { name: n, universalResolverAddress: cfg.universalResolver };
  let value;
  try {
    const [address, resolver, ...texts] = await withTimeout(
      Promise.all([
        c.getEnsAddress(opts).catch(() => null),
        c.getEnsResolver(opts),
        ...keys.map((key) => c.getEnsText({ ...opts, key }).catch(() => null)),
      ]),
      12_000,
    );
    value = { source: "live", at: Date.now(), address, resolver, records: Object.fromEntries(keys.map((k, i) => [k, texts[i] || null])) };
  } catch (e) {
    const snap = ensSnapshot.names?.[name];
    if (!snap) throw e;
    value = { source: "snapshot", at: Date.parse(ensSnapshot.readAt), address: snap.address, resolver: snap.resolver, records: snap.records, error: e.shortMessage ?? e.message };
  }
  cache.set(name, { at: Date.now(), value });
  return value;
}

/**
 * The ENS name of a fighter ("project") or judge ("judge") and what ENS says about it.
 * { name: null } when it has no name yet; records stay null until ENS answers.
 * recheck() reads it again from Sepolia, skipping the cache.
 */
export function useEnsName(kind, id) {
  const [state, setState] = useState({ loading: true, name: null, records: null, cfg: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const cfg = await ensConfig();
      const name = cfg?.[kind === "judge" ? "judges" : "projects"]?.[id] ?? null;
      if (!live) return;
      if (!name) return setState({ loading: false, name: null, records: null, cfg, error: null });
      setState((s) => ({ ...s, loading: true, name, cfg }));
      try {
        const v = await resolveName(name, kind === "judge" ? cfg.judgeKeys : cfg.fighterKeys, cfg, { force: nonce > 0 });
        if (live) setState({ loading: false, name, cfg, error: null, ...v });
      } catch (e) {
        if (live) setState({ loading: false, name, records: null, cfg, error: e.shortMessage ?? e.message });
      }
    })();
    return () => {
      live = false;
    };
  }, [kind, id, nonce]);
  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, recheck };
}

/** Every name the arena has issued, for the ENS overview. */
export function useEnsDirectory() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    ensConfig().then(setCfg);
  }, []);
  return cfg;
}

export const ensAppUrl = (cfg, name) => `${cfg?.appUrl ?? "https://sepolia.app.ens.domains"}/${name}`;
export const SEPOLIA_SCAN = "https://sepolia.etherscan.io";
export const scanAddress = (a) => `${SEPOLIA_SCAN}/address/${a}`;
