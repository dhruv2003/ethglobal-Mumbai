/*
 * Demo fallback. Live data (chain, backend) is always tried first. Only when that call throws
 * does a loader fall back to labelled demo data, so a flaky RPC or a stopped backend shows a
 * working but clearly marked screen instead of a blank one.
 *
 * Rules: demo data is always flagged (`demo: true`), is never mixed into real results, and never
 * enables money actions (betting, claiming, organizer transactions). Turn it off with
 * VITE_DEMO_FALLBACK=0 in frontend/web/.env.
 */
export const DEMO_ENABLED = (import.meta.env?.VITE_DEMO_FALLBACK ?? "1") !== "0";

/** The backend or chain being unreachable, as opposed to an answer like "not found". */
export const isOutage = (e) => !e?.status || e.status >= 500;

/**
 * try live(); catch an outage and return demo(); finally report which one was used.
 * `used` is called with "live" or "demo" so a page can show its banner.
 */
export async function liveOrDemo(live, demo, used = () => {}) {
  let source = "live";
  try {
    return await live();
  } catch (e) {
    if (!DEMO_ENABLED || !isOutage(e)) throw e;
    source = "demo";
    return demo(e);
  } finally {
    used(source);
  }
}
