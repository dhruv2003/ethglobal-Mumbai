/*
 * A MetaMask-compatible test wallet for the live test.
 *
 * Real MetaMask is a browser extension, and the live test runs on remote (Mozark) cloud
 * browsers, which can't load extensions. So each page gets an injected EIP-1193 provider
 * that presents itself the way MetaMask does (window.ethereum with isMetaMask, and an
 * EIP-6963 announcement), so a dapp's "Connect wallet → MetaMask" path works unchanged.
 *
 * The key is a fresh throwaway one per run, and it lives here in Node: the page only
 * gets a function that forwards requests (Playwright exposeBinding), never the key.
 *
 *   connect      eth_requestAccounts etc. answer with the throwaway address
 *   networks     wallet_switchEthereumChain / wallet_addEthereumChain are accepted for the
 *                chains in chains.mjs (reads go to their public RPCs)
 *   signatures   personal_sign and eth_signTypedData_v3/v4 are really signed (so wallet
 *                logins like Sign-In with Ethereum work); the key holds nothing
 *   transactions eth_sendTransaction is SIMULATED (eth_call + eth_estimateGas on the public
 *                RPC), recorded, then rejected the way a user pressing "Reject" would be (4001).
 *                Nothing is ever broadcast. eth_sign, eth_signTransaction and
 *                eth_sendRawTransaction are refused.
 *
 * Every request the dapp makes is recorded as an event, for the report.
 */
import { Wallet, getBytes, isHexString, toUtf8String } from "ethers";
import { CHAINS, chainName, rpcOf } from "./chains.mjs";

const DEFAULT_CHAIN = Number(process.env.TEST_WALLET_CHAIN_ID ?? 1);
const MAX_RPC_CALLS = 400; // per device run: a dapp polling in a loop can't run up a bill
const MAX_EVENTS = 60;

/** JSON-RPC reads passed through to the chain's public RPC. Anything else is answered here or refused. */
const READS = new Set([
  "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice", "eth_getBalance", "eth_getBlockByHash",
  "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_getStorageAt", "eth_getTransactionByHash", "eth_getTransactionCount",
  "eth_getTransactionReceipt", "eth_maxPriorityFeePerGas", "eth_syncing",
]);

const hex = (n) => `0x${Number(n).toString(16)}`;
const rpcError = (code, message, data) => ({ error: { code, message, ...(data !== undefined ? { data } : {}) } });
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Error(string) and Panic(uint256) revert data, in words. */
export function revertReason(data) {
  const d = typeof data === "string" ? data : typeof data?.data === "string" ? data.data : null;
  if (!d || !d.startsWith("0x")) return null;
  try {
    if (d.startsWith("0x08c379a0")) {
      const len = Number(BigInt(`0x${d.slice(74, 138)}`));
      return toUtf8String(`0x${d.slice(138, 138 + len * 2)}`);
    }
    if (d.startsWith("0x4e487b71")) return `panic 0x${BigInt(`0x${d.slice(10)}`).toString(16)}`;
    if (d.length >= 10) return `custom error ${d.slice(0, 10)}`;
  } catch {
    /* undecodable: fall through */
  }
  return null;
}

/** The provider injected into every page and frame. `__fcWalletRpc` is the exposed binding. */
function pageScript(startChainHex) {
  return `(() => {
  if (window.__fcTestWallet) return;
  window.__fcTestWallet = true;
  const handlers = {};
  let accounts = [];
  let chainId = ${JSON.stringify(startChainHex)};
  let announcedConnect = false;
  const emit = (ev, data) => (handlers[ev] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error(e); } });
  const provider = {
    isMetaMask: true,
    _metamask: { isUnlocked: async () => true },
    get chainId() { return chainId; },
    get networkVersion() { return String(parseInt(chainId, 16)); },
    get selectedAddress() { return accounts[0] || null; },
    isConnected: () => true,
    async request(args) {
      const method = args && args.method;
      const params = (args && args.params) || [];
      const r = await window.__fcWalletRpc({ method, params: JSON.parse(JSON.stringify(params)) });
      if (r.chainId && r.chainId !== chainId) { chainId = r.chainId; emit("chainChanged", chainId); }
      if (r.accounts && r.accounts.join() !== accounts.join()) {
        accounts = r.accounts;
        if (accounts.length && !announcedConnect) { announcedConnect = true; emit("connect", { chainId }); }
        emit("accountsChanged", accounts);
      }
      if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code, data: r.error.data });
      return r.result;
    },
    enable() { return provider.request({ method: "eth_requestAccounts" }); },
    sendAsync(payload, cb) {
      provider.request(payload).then((result) => cb(null, { id: payload.id, jsonrpc: "2.0", result }), (e) => cb(e, { id: payload.id, jsonrpc: "2.0", error: { code: e.code, message: e.message } }));
    },
    send(a, b) {
      if (typeof a === "string") return provider.request({ method: a, params: b });
      if (typeof b === "function") return provider.sendAsync(a, b);
      return provider.request(a);
    },
    on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); return provider; },
    once(ev, f) { const g = (d) => { provider.removeListener(ev, g); f(d); }; return provider.on(ev, g); },
    removeListener(ev, f) { handlers[ev] = (handlers[ev] || []).filter((x) => x !== f); return provider; },
    removeAllListeners(ev) { if (ev) delete handlers[ev]; else Object.keys(handlers).forEach((k) => delete handlers[k]); return provider; },
  };
  provider.addListener = provider.on;
  provider.off = provider.removeListener;
  try { Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: false }); } catch { window.ethereum = provider; }
  window.dispatchEvent(new Event("ethereum#initialized"));
  // EIP-6963: wallet pickers (RainbowKit, ConnectKit, Reown/AppKit, wagmi) list injected wallets from this.
  const info = Object.freeze({
    uuid: (crypto.randomUUID && crypto.randomUUID()) || "0b1c6f2e-6a51-4b0e-9a5f-fc1a7e57a11e",
    name: "MetaMask",
    rdns: "io.metamask",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNmNjg1MWIiLz48L3N2Zz4=",
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();`;
}

/**
 * One wallet per device run.
 *   install(ctx)  inject into every page of a Playwright context
 *   since(t)      events recorded at or after time t (ms)
 *   summary()     what the report stores
 */
export function createTestWallet({ chainId = DEFAULT_CHAIN, log = () => {} } = {}) {
  const key = Wallet.createRandom();
  const address = key.address;
  const startChain = rpcOf(chainId) ? chainId : 1;
  const state = { chainId: startChain, connected: false, rpcCalls: 0 };
  const events = [];
  const record = (type, detail = {}) => {
    if (events.length < MAX_EVENTS) events.push({ type, t: Date.now(), chainId: state.chainId, ...detail });
  };
  const accountsNow = () => (state.connected ? [address] : []);

  async function rpc(method, params) {
    const url = rpcOf(state.chainId);
    if (!url) throw Object.assign(new Error(`The test wallet has no RPC for chain ${state.chainId}.`), { code: 4901 });
    if (++state.rpcCalls > MAX_RPC_CALLS) throw Object.assign(new Error("The test wallet's RPC budget for this run is used up."), { code: -32005 });
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    if (!body) throw Object.assign(new Error(`RPC answered HTTP ${res.status}`), { code: -32603 });
    if (body.error) throw Object.assign(new Error(body.error.message ?? "RPC error"), { code: body.error.code ?? -32603, data: body.error.data });
    return body.result;
  }

  /** eth_call + eth_estimateGas for a transaction the dapp asked to send. Never broadcast. */
  async function simulate(tx) {
    const call = { from: address, to: tx.to, data: tx.data ?? tx.input, value: tx.value };
    for (const k of Object.keys(call)) if (call[k] == null) delete call[k];
    try {
      await rpc("eth_call", [call, "latest"]);
    } catch (e) {
      const why = revertReason(e.data) ?? String(e.message).slice(0, 160);
      // Native-coin shortfall only: a token's "transfer amount exceeds balance" is the dapp's own revert, kept as is.
      const gasMoney = /insufficient funds for (gas|transfer)|insufficient balance for transfer/i.test(why);
      return { ok: false, reason: gasMoney ? "the test wallet holds no ETH" : why };
    }
    try {
      const gas = await rpc("eth_estimateGas", [call]);
      return { ok: true, gas: Number(BigInt(gas)) };
    } catch (e) {
      return { ok: true, gas: null, note: `gas estimate failed: ${String(e.message).slice(0, 100)}` };
    }
  }

  const fromOk = (from) => !from || String(from).toLowerCase() === address.toLowerCase();

  async function handle({ method, params = [] }) {
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "wallet_requestPermissions": {
          if (!state.connected) {
            state.connected = true;
            record("connect", { address });
            log(`connected ${short(address)} on ${chainName(state.chainId)}`);
          }
          const result = method === "eth_requestAccounts" ? [address] : [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [address] }] }];
          return { result, accounts: [address], chainId: hex(state.chainId) };
        }
        case "eth_accounts":
          return { result: accountsNow(), accounts: accountsNow() };
        case "wallet_getPermissions":
          return { result: state.connected ? [{ parentCapability: "eth_accounts" }] : [] };
        case "wallet_revokePermissions":
          state.connected = false;
          record("disconnect");
          return { result: null, accounts: [] };
        case "eth_chainId":
          return { result: hex(state.chainId) };
        case "net_version":
          return { result: String(state.chainId) };
        case "web3_clientVersion":
          return { result: "FightClub-TestWallet/1.0 (MetaMask-compatible)" };
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": {
          const id = Number(BigInt(params[0]?.chainId ?? "0x0"));
          if (!rpcOf(id)) {
            record("chain-refused", { to: id, name: params[0]?.chainName ?? null });
            log(`asked for unsupported chain ${id}`);
            return rpcError(4902, `Unrecognized chain ID ${hex(id)}. The test wallet supports: ${Object.values(CHAINS).map((c) => c.name).join(", ")}.`);
          }
          if (id !== state.chainId) {
            record("switch-chain", { from: state.chainId, to: id, toName: chainName(id) });
            log(`switched to ${chainName(id)}`);
          }
          state.chainId = id;
          return { result: null, chainId: hex(id) };
        }
        case "wallet_watchAsset":
          record("watch-asset", { asset: String(params?.options?.symbol ?? params?.[0]?.options?.symbol ?? "token").slice(0, 20) });
          return { result: true };
        case "wallet_getCapabilities":
          return { result: {} };
        case "personal_sign": {
          // [message, address]; a few old dapps send [address, message].
          let [msg, from] = params;
          if (/^0x[0-9a-fA-F]{40}$/.test(String(msg)) && !/^0x[0-9a-fA-F]{40}$/.test(String(from))) [msg, from] = [from, msg];
          if (!fromOk(from)) return rpcError(4100, "That address isn't this wallet's.");
          const bytes = isHexString(msg) ? getBytes(msg) : new TextEncoder().encode(String(msg));
          let text;
          try {
            text = toUtf8String(bytes);
          } catch {
            text = `${bytes.length} bytes of binary data`;
          }
          const signature = await key.signMessage(bytes);
          const siwe = /wants you to sign in with your Ethereum account/i.test(text);
          record("signature", { what: siwe ? "Sign-In with Ethereum message" : "message", preview: text.slice(0, 280) });
          log(`signed a ${siwe ? "Sign-In with Ethereum " : ""}message`);
          return { result: signature };
        }
        case "eth_signTypedData_v4":
        case "eth_signTypedData_v3":
        case "eth_signTypedData": {
          const [from, raw] = params;
          if (!fromOk(from)) return rpcError(4100, "That address isn't this wallet's.");
          const data = typeof raw === "string" ? JSON.parse(raw) : raw;
          const types = { ...(data?.types ?? {}) };
          delete types.EIP712Domain;
          const signature = await key.signTypedData(data.domain ?? {}, types, data.message ?? {});
          record("signature", { what: `typed data (${data.primaryType ?? "unknown type"})`, preview: `${data.domain?.name ?? "unnamed app"}${data.domain?.verifyingContract ? ` · contract ${short(data.domain.verifyingContract)}` : ""}` });
          log(`signed typed data ${data.primaryType ?? ""}`);
          return { result: signature };
        }
        case "eth_sendTransaction": {
          const tx = params[0] ?? {};
          if (!fromOk(tx.from)) return rpcError(4100, "That address isn't this wallet's.");
          const sim = await simulate(tx);
          const valueWei = tx.value ? BigInt(tx.value) : 0n;
          record("transaction", {
            to: tx.to ?? null,
            deploy: !tx.to,
            value: valueWei ? `${Number(valueWei) / 1e18} ETH` : "0",
            selector: String(tx.data ?? tx.input ?? "").slice(0, 10) || null,
            simulation: sim,
          });
          log(`was asked to send a transaction to ${tx.to ? short(tx.to) : "a new contract"}: ${sim.ok ? "simulation ok" : `would revert (${sim.reason})`}; rejected, never sent`);
          return rpcError(4001, "User rejected the request. (FightClub test wallet: transactions are simulated, never sent.)");
        }
        case "wallet_sendCalls":
          record("transaction", { batch: true, calls: Array.isArray(params?.[0]?.calls) ? params[0].calls.length : null, simulation: { ok: null, reason: "batched calls aren't simulated" } });
          return rpcError(4001, "User rejected the request. (FightClub test wallet: transactions are never sent.)");
        case "eth_sign":
        case "eth_signTransaction":
        case "eth_sendRawTransaction":
          record("refused", { method });
          return rpcError(4200, `The test wallet doesn't do ${method}.`);
        default:
          if (READS.has(method)) return { result: await rpc(method, params) };
          record("unsupported", { method: String(method).slice(0, 60) });
          return rpcError(4200, `The test wallet doesn't support ${method}.`);
      }
    } catch (e) {
      return rpcError(typeof e.code === "number" ? e.code : -32603, String(e.message ?? e).slice(0, 300), e.data);
    }
  }

  return {
    address,
    get connected() {
      return state.connected;
    },
    async install(ctx) {
      await ctx.exposeBinding("__fcWalletRpc", (_source, req) => handle(req ?? {}));
      await ctx.addInitScript(pageScript(hex(startChain)));
    },
    since: (t) => events.filter((e) => e.t >= t),
    handle, // for tests
    summary(startedAt) {
      return {
        kind: "MetaMask-compatible test wallet (injected EIP-1193 + EIP-6963 provider; throwaway key)",
        address,
        startChain: { id: startChain, name: chainName(startChain) },
        endChain: { id: state.chainId, name: chainName(state.chainId) },
        connected: state.connected,
        rpcCalls: state.rpcCalls,
        policy: "Connects and signs with a throwaway key that holds nothing. Transactions are simulated on a public RPC, then rejected: never broadcast.",
        events: events.map(({ t, ...e }) => ({ ...e, at: startedAt ? Math.round((t - startedAt) / 100) / 10 : null })),
      };
    },
  };
}
