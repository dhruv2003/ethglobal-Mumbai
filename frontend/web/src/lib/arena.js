/*
 * Everything the chain can't hold, from the backend: which submitted project sits in which
 * bracket slot, and the recorded fights. The chain stays the source of truth for money,
 * scores and winners; this only supplies names and the fight replay.
 *
 * Every loader tries live data first and falls back to labelled demo data on an outage (lib/demo.js).
 */
import { api } from "./api.js";
import { listTournaments, readTournament } from "./chain.js";
import { MOCK_EVENTS, MOCK_MATCH } from "../fight/demoFight.js";
import { MOCK_TOURNAMENTS, findMockTournament } from "./demoArena.js";
import { liveOrDemo } from "./demo.js";
import { viewOfChain } from "./tournamentView.js";

/** Bracket of one tournament, or null if the organizer hasn't registered one (or the backend is down). */
export const getBracket = (id) => api(`/arena/tournaments/${id}`).catch(() => null);

const allBrackets = () => api("/arena/tournaments").catch(() => []);

/** Ask the backend who should fight whom. Returns the bracket order, its audit hashes and why each first-round fight exists. */
export const matchmake = (body) => api("/arena/matchmaking", { method: "POST", body });

export const registerBracket = (id, body) => api(`/arena/tournaments/${id}`, { method: "PUT", body });

export const runFight = (t, m, body) => api(`/arena/fights/${t}/${m}`, { method: "POST", body });

const demoFight = () => ({ status: "done", demo: true, events: MOCK_EVENTS, judges: MOCK_MATCH.judges, calls: null, fighters: null });

/** The recorded fight of a match. Demo tournaments (and outages) get the labelled demo fight. */
export const getFight = (t, m) => (findMockTournament(t) ? Promise.resolve(demoFight()) : liveOrDemo(() => api(`/arena/fights/${t}/${m}`), demoFight));

/** One tournament, read from chain and joined with its registered bracket. null if it doesn't exist. */
export function loadTournament(id) {
  const demo = () => {
    const t = findMockTournament(id) ?? MOCK_TOURNAMENTS[(Math.max(1, Number(id) || 1) - 1) % MOCK_TOURNAMENTS.length];
    return { ...t, id: String(id) };
  };
  if (findMockTournament(id)) return Promise.resolve(findMockTournament(id));
  return liveOrDemo(async () => {
    const [chainT, meta] = await Promise.all([readTournament(id), getBracket(id)]);
    return chainT ? viewOfChain(chainT, meta) : null;
  }, demo);
}

/** Every tournament on chain, newest first, joined with their brackets. On an outage: the demo tournaments. */
export function loadTournaments() {
  return liveOrDemo(async () => {
    const [list, metas] = await Promise.all([listTournaments(), allBrackets()]);
    const byId = new Map(metas.map((m) => [String(m.id), m]));
    return list.map((t) => viewOfChain(t, byId.get(String(t.id))));
  }, () => MOCK_TOURNAMENTS);
}
