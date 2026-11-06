/* One shape for tournaments, whether they're on chain or sample data, so pages don't care which. */
import { MATCH_STATUS, TOURNAMENT_STATUS, WIN_SOURCE, bracketRounds, feeders, matchRound, roundName } from "./pools.js";

export const chainProject = (id, index) => ({ id: `chain-${id}-${index}`, name: `Project ${index + 1}`, pitch: "", tracks: [] });

const WIN_WORD = { Score: "On score", Tiebreak: "On the tie-break", Organizer: "Organizer decision after two ties" };

export function viewOfChain(t) {
  const status = TOURNAMENT_STATUS[t.status];
  const cutoffMs = Number(t.bettingCutoff) * 1000;
  const canceled = status === "Canceled";
  const frozen = t.projectCount > 0;
  const phase = status === "Completed" ? "completed" : canceled ? "canceled" : frozen && Date.now() >= cutoffMs ? "live" : "upcoming";
  const projects = Array.from({ length: t.count }, (_, i) => chainProject(t.id, i));

  const matches = t.matches.map((m, i) => {
    const s = MATCH_STATUS[m.status];
    const feed = feeders(i, t.count);
    const opened = s !== "None";
    const a = opened ? m.projectA : feed ? (MATCH_STATUS[t.matches[feed[0]].status] === "Finalized" ? t.matches[feed[0]].winner : null) : i * 2;
    const b = opened ? m.projectB : feed ? (MATCH_STATUS[t.matches[feed[1]].status] === "Finalized" ? t.matches[feed[1]].winner : null) : i * 2 + 1;
    let word = "scheduled";
    if (s === "Open") word = canceled ? "void" : "live";
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
    };
  });

  return {
    mock: false,
    id: String(t.id),
    title: `On-chain tournament #${t.id}`,
    track: "Base Sepolia",
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
