/* One shape for tournaments, whether they're on chain or sample data, so pages don't care which. */
import { MATCH_STATUS, TOURNAMENT_STATUS, WIN_SOURCE, bracketRounds, feeders, matchRound, roundName } from "./pools.js";

/** A bracket slot: the registered project when the organizer saved the bracket, else a plain numbered slot. */
export const chainProject = (id, index, meta) => {
  const p = meta?.projects?.[index];
  return p ? { id: p.submissionId, slot: index, name: p.name, pitch: p.pitch, tracks: p.tracks, team: p.team, fighterSeed: p.fighterSeed, seed: p.fighterSeed ?? p.submissionId, registered: true } : { id: `chain-${id}-${index}`, slot: index, name: `Slot ${index + 1}`, pitch: "", tracks: [], registered: false };
};

const WIN_WORD = { Score: "On score", Tiebreak: "On the tie-break", Organizer: "Organizer decision after two ties" };

export function viewOfChain(t, meta = null) {
  const status = TOURNAMENT_STATUS[t.status];
  const cutoffMs = Number(t.bettingCutoff) * 1000;
  const canceled = status === "Canceled";
  const frozen = t.projectCount > 0;
  const phase = status === "Completed" ? "completed" : canceled ? "canceled" : frozen && Date.now() >= cutoffMs ? "live" : "upcoming";
  const projects = Array.from({ length: t.count }, (_, i) => chainProject(t.id, i, meta));

  const matches = t.matches.map((m, i) => {
    const s = MATCH_STATUS[m.status];
    const feed = feeders(i, t.count);
    const opened = s !== "None";
    const a = opened ? m.projectA : feed ? (MATCH_STATUS[t.matches[feed[0]].status] === "Finalized" ? t.matches[feed[0]].winner : null) : i * 2;
    const b = opened ? m.projectB : feed ? (MATCH_STATUS[t.matches[feed[1]].status] === "Finalized" ? t.matches[feed[1]].winner : null) : i * 2 + 1;
    const startMs = Number(m.scheduledStart) * 1000;
    let word = "scheduled";
    // A fight is only live from its start time, which the contract keeps after every betting cutoff.
    if (s === "Open") word = canceled ? "void" : Date.now() >= startMs ? "live" : "scheduled";
    if (s === "HumanReview") word = canceled ? "void" : "review";
    if (s === "Finalized") word = "finalized";
    if (s === "Void" || (canceled && s === "None")) word = "void";
    return {
      index: i,
      roundName: roundName(matchRound(i, t.count).size),
      a,
      b,
      status: word,
      opened,
      winner: s === "Finalized" ? m.winner : null,
      winWord: WIN_WORD[WIN_SOURCE[m.source]] ?? null,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      tieA: m.tieA,
      tieB: m.tieB,
      cutoffMs: Number(m.cutoff) * 1000,
      startMs,
    };
  });

  return {
    id: String(t.id),
    title: meta?.title ?? `Tournament #${t.id}`,
    track: meta?.track ?? "Open",
    registered: Boolean(meta),
    matching: meta?.matching ?? null,
    count: t.count,
    frozen,
    phase,
    startsAt: new Date(Number(t.scheduledStart) * 1000).toISOString(),
    cutoffMs,
    deadlineMs: Number(t.resolutionDeadline) * 1000,
    rounds: bracketRounds(t.count),
    projects,
    matches,
    champion: status === "Completed" ? t.champion : null,
    raw: t,
  };
}

/** Same rule as the contract's poolState: the pool exists, isn't void, and its cutoff hasn't passed. */
export const isMatchOpen = (view, match, now = Date.now()) => !view.demo && match.opened && match.status !== "void" && now < match.cutoffMs;

/** Every pool of a tournament taking bets right now. */
export function openPools(view, now = Date.now()) {
  if (view.demo) return []; // demo data never takes bets
  const pools = [];
  if (view.frozen && view.phase !== "canceled" && now < view.cutoffMs) {
    pools.push({ key: `${view.id}-winner`, title: "Who wins it all?", detail: `${view.title} · ${view.count} projects`, to: `/tournaments/${view.id}`, cutoffMs: view.cutoffMs, fighters: [] });
  }
  for (const match of view.matches) {
    if (!isMatchOpen(view, match, now)) continue;
    const a = view.projects[match.a];
    const b = view.projects[match.b];
    pools.push({ key: `${view.id}-${match.index}`, title: `${a.name} vs ${b.name}`, detail: `${view.title} · Match ${match.index + 1}`, to: `/fights/${view.id}/${match.index}`, cutoffMs: match.cutoffMs, fighters: [a, b] });
  }
  return pools;
}
