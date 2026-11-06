/*
 * One human, one free pack of FILTER. The trust moment for World ID: the server holds the
 * free tokens, so it can really refuse a second claim. Order matters: check the proof with
 * World, reserve the human's nullifier, and only then send tokens.
 *
 * It protects the free pack only. It doesn't limit bets, which the contract takes from any wallet.
 */
import { getAddress, isAddress } from "viem";

export const ACTION = "claim-starter-filter";
const PROOF_OF_HUMAN = 1; // issuer_schema_id of World's Proof of Human credential

export class ClaimError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Who already claimed, kept where a restart can't lose it (the server passes the Arkiv
 * database: { load() -> data|null, save(data) }), so a restart can't hand out a second pack.
 */
export function claimStore(persist) {
  const data = persist.load() ?? { byHuman: {}, byWallet: {} };
  const save = () => persist.save(data);
  return {
    humanClaimed: (nullifier) => !!data.byHuman[nullifier],
    walletClaim: (wallet) => data.byWallet[wallet] ?? null,
    /** Synchronous, so two claims at once can't both pass. */
    reserve(nullifier, wallet) {
      if (data.byHuman[nullifier] || data.byWallet[wallet]) return false;
      const record = { at: new Date().toISOString() };
      data.byHuman[nullifier] = { wallet, ...record };
      data.byWallet[wallet] = record;
      save();
      return true;
    },
    confirm(nullifier, wallet, hash) {
      data.byHuman[nullifier].hash = hash;
      data.byWallet[wallet].hash = hash;
      save();
    },
    release(nullifier, wallet) {
      delete data.byHuman[nullifier];
      delete data.byWallet[wallet];
      save();
    },
  };
}

/** Asks World whether the proof is real. The payload goes through unchanged. */
export function worldVerifier({ rpId, environment, fetchFn = fetch }) {
  return async (idkitResponse) => {
    const res = await fetchFn(`https://developer.world.org/api/v4/verify/${encodeURIComponent(rpId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...idkitResponse, environment }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.success === true && body?.environment === environment;
  };
}

const refuse = (message) => new ClaimError(400, "bad_proof", message);

export function createClaims({ environment, store, verifyProof, sendFilter, hashSignal }) {
  return async function claim({ wallet: rawWallet, idkitResponse: proof }) {
    if (typeof rawWallet !== "string" || !isAddress(rawWallet, { strict: false })) throw new ClaimError(400, "bad_wallet", "That isn't a wallet address.");
    const wallet = getAddress(rawWallet);

    // Allowing only World ID 4.0 proofs means one person has exactly one nullifier here.
    if (proof?.protocol_version !== "4.0") throw refuse("This needs a World ID 4.0 proof.");
    if (proof.environment !== environment) throw refuse("This proof is from the wrong World ID environment.");
    if (proof.action !== ACTION) throw refuse("This proof is for a different action.");
    const item = proof.responses?.length === 1 ? proof.responses[0] : null;
    if (!item || item.issuer_schema_id !== PROOF_OF_HUMAN) throw refuse("This needs a Proof of Human credential.");
    // The proof is bound to the wallet, so it can't be used to send the pack somewhere else.
    if (item.signal_hash !== hashSignal(wallet.toLowerCase())) throw refuse("This proof was made for a different wallet.");

    let nullifier;
    try {
      nullifier = BigInt(item.nullifier).toString();
    } catch {
      throw refuse("This proof is malformed.");
    }

    const already = new ClaimError(409, "already_claimed", "This World ID has already claimed its free FILTER.");
    if (store.humanClaimed(nullifier)) throw already;
    if (store.walletClaim(wallet)) throw new ClaimError(409, "wallet_claimed", "This wallet has already claimed its free FILTER.");

    let valid;
    try {
      valid = await verifyProof(proof);
    } catch {
      throw new ClaimError(502, "world_unreachable", "Couldn't reach World ID to check the proof. Try again.");
    }
    if (!valid) throw new ClaimError(400, "proof_rejected", "World ID didn't accept this proof, so nothing was sent.");

    if (!store.reserve(nullifier, wallet)) throw already;

    let hash;
    try {
      hash = await sendFilter(wallet);
    } catch {
      store.release(nullifier, wallet); // nothing went out, so they can try again
      throw new ClaimError(503, "send_failed", "Your proof is fine, but the free FILTER couldn't be sent. Try again.");
    }
    store.confirm(nullifier, wallet, hash);
    return { wallet, hash };
  };
}
