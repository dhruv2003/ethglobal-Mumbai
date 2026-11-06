/*
 * Everything the chain can't hold, from the backend: which submitted project sits in which
 * bracket slot, and the recorded fights. The chain stays the source of truth for money,
 * scores and winners; this only supplies names and the fight replay.
 */
import { api, peekApi } from "./api.js";
import { peek } from "./cache.js";
import { listTournaments, readTournament } from "./chain.js";
import { viewOfChain } from "./tournamentView.js";

/** Bracket of one tournament, or null if the organizer hasn't registered one (or the backend is down). */
// A blip must not strip names and tournaments off every bracket: fall back to the last answer we had.
export const getBracket = (id) =>
  api(`/arena/tournaments/${id}`).catch((e) => (e.status === 404 ? null : (peekApi(`/arena/tournaments/${id}`) ?? null)));

const allBrackets = () => api("/arena/tournaments").catch(() => peekApi("/arena/tournaments") ?? []);

export const runFight = (t, m, body) => api(`/arena/fights/${t}/${m}`, { method: "POST", body });

/** The recorded fight of a match. */
export const getFight = (t, m) => api(`/arena/fights/${t}/${m}`);

/** The cached view of one tournament (its own answer, or its row in the list). */
export const cachedTournament = (id) => peek("tournaments")?.find((t) => t.id === String(id));

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
