/*
 * ENSv2 names of fighters and judges. The backend only says which name belongs to
 * which project or judge (/api/ens); every record is read here, in the browser,
 * from ENS on Sepolia through the Universal Resolver, as any ENS client would.
 */
import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import { api } from "./api.js";

let config = null;
/** Parent name, RPC, resolver, and the id -> name maps. null when the backend is offline. */
export const ensConfig = () => (config ??= api("/ens").catch(() => (config = null)));

let client = null;
const clientFor = (cfg) => (client ??= createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) }));

const cache = new Map(); // name -> { at, records }
const FRESH_MS = 30_000;

/** Text records of one name, read from ENS. Values are null when unset. */
export async function resolveTexts(name, keys, cfg) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.records;
  const c = clientFor(cfg);
  const values = await Promise.all(keys.map((key) => c.getEnsText({ name: normalize(name), key, universalResolverAddress: cfg.universalResolver }).catch(() => null)));
  const records = Object.fromEntries(keys.map((k, i) => [k, values[i] || null]));
  cache.set(name, { at: Date.now(), records });
  return records;
}

/**
 * The ENS name of a fighter ("project") or judge ("judge") and its records.
 * { name: null } when it has no name yet; records stay null until ENS answers.
 */
export function useEnsName(kind, id) {
  const [state, setState] = useState({ loading: true, name: null, records: null, cfg: null, error: null });
  useEffect(() => {
    let live = true;
    (async () => {
      const cfg = await ensConfig();
      const name = cfg?.[kind === "judge" ? "judges" : "projects"]?.[id] ?? null;
      if (!live) return;
      if (!name) return setState({ loading: false, name: null, records: null, cfg, error: null });
      setState((s) => ({ ...s, name, cfg }));
      try {
        const records = await resolveTexts(name, kind === "judge" ? cfg.judgeKeys : cfg.fighterKeys, cfg);
        if (live) setState({ loading: false, name, records, cfg, error: null });
      } catch (e) {
        if (live) setState({ loading: false, name, records: null, cfg, error: e.shortMessage ?? e.message });
      }
    })();
    return () => {
      live = false;
    };
  }, [kind, id]);
  return state;
}

export const ensAppUrl = (cfg, name) => `${cfg?.appUrl ?? "https://sepolia.app.ens.domains"}/${name}`;
