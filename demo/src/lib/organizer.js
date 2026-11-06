/*
 * Who counts as an organizer is the backend's call: ADMIN_WALLET in backend/.env, or the contract's
 * organizer role when that isn't set. Reading reviews or changing anything also needs a signed
 * session (no gas), which the backend checks the same way.
 */
import { useCallback, useEffect, useState } from "react";
import { api, setOrganizerSession } from "./api.js";
import { usePoll } from "./chain.js";

const SLOT = "arena.organizerSession";
const SESSION_MS = 12 * 60 * 60 * 1000 - 60000;

const message = (wallet, issuedAt) => ["Sign in as a Battle Arena organizer", `Wallet: ${wallet}`, `Issued at: ${issuedAt}`].join("\n");

function loadSession(address) {
  try {
    const s = JSON.parse(sessionStorage.getItem(SLOT) ?? "null");
    return s && address && s.wallet.toLowerCase() === address.toLowerCase() && Date.now() - Date.parse(s.issuedAt) < SESSION_MS ? s : null;
  } catch {
    return null;
  }
}

export function useOrganizer(wallet) {
  const address = wallet.address;
  const { data: isOrganizer, loading } = usePoll(
    async () => (address ? (await api(`/organizer?wallet=${address}`)).isOrganizer : false),
    [address],
    30000,
    { key: address ? `organizer:${address.toLowerCase()}` : null },
  );
  const [session, setSession] = useState(() => loadSession(address));
  useEffect(() => {
    const s = loadSession(address);
    setSession(s);
    setOrganizerSession(s);
  }, [address]);

  const signIn = useCallback(async () => {
    const issuedAt = new Date().toISOString();
    const signature = await wallet.sign(message(address, issuedAt));
    const s = { wallet: address, issuedAt, signature };
    try {
      sessionStorage.setItem(SLOT, JSON.stringify(s));
    } catch {
      /* it just won't survive a reload */
    }
    setOrganizerSession(s);
    setSession(s);
  }, [wallet, address]);

  return { isOrganizer: Boolean(isOrganizer), checking: loading && isOrganizer == null, signedIn: Boolean(isOrganizer && session), signIn };
}
