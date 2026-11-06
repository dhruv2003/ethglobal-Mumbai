/*
 * Everything the chain can't hold, from the backend: which submitted project sits in which
 * bracket slot, and the recorded fights. The chain stays the source of truth for money,
 * scores and winners; this only supplies names and the fight replay.
 */
import { api } from "./api.js";
import { listTournaments, readTournament } from "./chain.js";
import { viewOfChain } from "./tournamentView.js";

/** Bracket of one tournament, or null if the organizer hasn't registered one (or the backend is down). */
export const getBracket = (id) => api(`/arena/tournaments/${id}`).catch(() => null);

const allBrackets = () => api("/arena/tournaments").catch(() => []);

/** Ask the backend who should fight whom. Returns the bracket order, its audit hashes and why each first-round fight exists. */
export const matchmake = (body) => api("/arena/matchmaking", { method: "POST", body });

export const registerBracket = (id, body) => api(`/arena/tournaments/${id}`, { method: "PUT", body });

export const runFight = (t, m, body) => api(`/arena/fights/${t}/${m}`, { method: "POST", body });

/** The recorded fight of a match. */
export const getFight = (t, m) => api(`/arena/fights/${t}/${m}`);

/** One tournament, read from chain and joined with its registered bracket. null if it doesn't exist. */
export async function loadTournament(id) {
  const [chainT, meta] = await Promise.all([readTournament(id), getBracket(id)]);
  return chainT ? viewOfChain(chainT, meta) : null;
}

/** Every tournament on chain, newest first, joined with their brackets. */
export async function loadTournaments() {
  const [list, metas] = await Promise.all([listTournaments(), allBrackets()]);
  const byId = new Map(metas.map((m) => [String(m.id), m]));
  return list.map((t) => viewOfChain(t, byId.get(String(t.id))));
}
