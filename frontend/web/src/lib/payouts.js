/* Whether the backend's payout bot is running. When it is, nobody has to settle or claim by hand. */
import { api } from "./api.js";
import { usePoll } from "./chain.js";

export function usePayouts() {
  const { data } = usePoll(() => api("/payouts").catch(() => ({ enabled: false })), [], 30000);
  return data ?? { enabled: false };
}
