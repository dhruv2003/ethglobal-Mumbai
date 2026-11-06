/*
 * Independent TEE check for a 0G chat response (docs: Router > Verifiable Execution).
 *
 * The Router doesn't report tee_verified for sealed (end-to-end encrypted) providers like
 * 0gm-1.0-35b-a3b, so we check it ourselves:
 *   1. read the provider's service record from the InferenceServing contract on 0G mainnet
 *      (url, verifiability, teeSignerAddress, teeSignerAcknowledged, additionalInfo)
 *   2. GET {url}/v1/proxy/signature/{chatId}?model=...  -> { text, signature }
 *   3. recover the EIP-191 signer of `text` and compare it with the TEE signer on chain
 *
 * Scope: for a sealed provider the signed text is "zg-sig-v1/e2ee-ct:<hash>:<hash>", a hash
 * of the encrypted exchange. A pass proves this chat ID was answered inside the attested TEE.
 * It does not let us match the plaintext we were given against what was signed.
 *
 *   ZG_CHAIN_RPC            default https://evmrpc.0g.ai (0G mainnet, chain 16661)
 *   ZG_INFERENCE_CONTRACT   default 0x47340d900bdFec2BD393c626E12ea0656F938d84 (from @0gfoundation/0g-compute-ts-sdk 0.9.0)
 */

const { createPublicClient, http, recoverMessageAddress } = require("viem");

const RPC = process.env.ZG_CHAIN_RPC || "https://evmrpc.0g.ai";
const CONTRACT = process.env.ZG_INFERENCE_CONTRACT || "0x47340d900bdFec2BD393c626E12ea0656F938d84";
const SERVICE_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const GET_SERVICE_ABI = [
  {
    type: "function",
    name: "getService",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [
      {
        name: "service",
        type: "tuple",
        components: [
          { name: "provider", type: "address" },
          { name: "serviceType", type: "string" },
          { name: "url", type: "string" },
          { name: "inputPrice", type: "uint256" },
          { name: "outputPrice", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "model", type: "string" },
          { name: "verifiability", type: "string" },
          { name: "additionalInfo", type: "string" },
          { name: "teeSignerAddress", type: "address" },
          { name: "teeSignerAcknowledged", type: "bool" },
        ],
      },
    ],
  },
];

let client = null;
const services = new Map(); // provider -> { at, svc }

async function readService(provider) {
  const hit = services.get(provider.toLowerCase());
  if (hit && Date.now() - hit.at < SERVICE_TTL_MS) return hit.svc;
  client ??= createPublicClient({ transport: http(RPC, { timeout: TIMEOUT_MS }) });
  const svc = await client.readContract({ address: CONTRACT, abi: GET_SERVICE_ABI, functionName: "getService", args: [provider] });
  services.set(provider.toLowerCase(), { at: Date.now(), svc });
  return svc;
}

/** Who must have signed: the broker's TEE, or the model's own TEE when the provider runs them apart. */
function signerOf(svc) {
  const info = JSON.parse(svc.additionalInfo || "{}");
  const centralized = info.ProviderType === "centralized";
  return info.TargetSeparated === true && !centralized && info.TargetTeeAddress ? info.TargetTeeAddress : svc.teeSignerAddress;
}

async function fetchSignature(url, chatId, model, fetchImpl) {
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("provider URL is not https");
  const target = new URL(`/v1/proxy/signature/${encodeURIComponent(chatId)}`, base);
  target.searchParams.set("model", model);
  // The signature can lag the response by a moment: one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(target, { signal: ctrl.signal, redirect: "error" });
      if (res.ok) return await res.json();
      if (attempt === 1 || res.status !== 404) throw new Error(`signature endpoint returned HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("no signature");
}

/**
 * Check one response. trace: { provider, chatId }.
 * Returns { teeVerified: true|false|null, teeCheck, teeSigner?, teeSignedText?, teeReason? }.
 * null means "couldn't check" (never treat it as true); false means a signature exists and doesn't match.
 */
async function verifyChat(trace, { read = readService, fetchImpl = fetch } = {}) {
  if (!trace?.provider || !trace?.chatId) return { teeVerified: null, teeCheck: "unavailable", teeReason: "no provider or chat ID in the response" };
  try {
    const svc = await read(trace.provider);
    if (!svc.verifiability) return { teeVerified: null, teeCheck: "unavailable", teeReason: "provider is not a verifiable service" };
    if (!svc.teeSignerAcknowledged) return { teeVerified: false, teeCheck: "signature", teeReason: "provider's TEE signer is not acknowledged on chain" };
    const expected = signerOf(svc);
    const sig = await fetchSignature(svc.url, trace.chatId, svc.model, fetchImpl);
    if (typeof sig?.text !== "string" || typeof sig?.signature !== "string") throw new Error("malformed signature response");
    const signer = await recoverMessageAddress({ message: sig.text, signature: sig.signature });
    const ok = signer.toLowerCase() === String(expected).toLowerCase();
    return { teeVerified: ok, teeCheck: "signature", teeSigner: expected, teeSignedText: sig.text.slice(0, 200), ...(ok ? {} : { teeReason: `signed by ${signer}, expected ${expected}` }) };
  } catch (e) {
    return { teeVerified: null, teeCheck: "unavailable", teeReason: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200) };
  }
}

module.exports = { verifyChat, signerOf, GET_SERVICE_ABI };
