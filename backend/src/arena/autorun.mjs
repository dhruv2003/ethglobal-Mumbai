/*
 * Runs a match by itself: starts the fight on 0G once the match goes live, and publishes the
 * judges' scores when this server's wallet is the tournament's publisher. The contract still
 * decides the winner from the scores, and the payout bot takes it from there.
 */
const OPEN = 1; // MatchStatus.Open
const CANCELED = 4; // TournamentStatus.Canceled

/** What to do for one match right now: "start", "publish" or null. */
export function nextStep({ tournament, match, fight, nowSec, canPublish }) {
  if (Number(tournament.status) === CANCELED || Number(match.status) !== OPEN) return null;
  if (nowSec < Number(match.scheduledStart) || nowSec >= Number(match.deadline)) return null;
  if (fight.status === "none") return "start";
  if (fight.status === "done" && canPublish && /^0x[0-9a-f]{64}$/i.test(fight.resultHash ?? "")) return "publish";
  return null; // running, or failed: the organizer page can run a failed fight again
}

/** One pass over every registered tournament. Each match is handled on its own. */
export async function autorunPass({ brackets, readTournament, readMatch, nowSec, fightOf, startFight, publish, botAddress, log = () => {} }) {
  const now = await nowSec();
  for (const bracket of brackets()) {
    const id = BigInt(bracket.id);
    const tournament = await readTournament(id);
    const canPublish = Boolean(botAddress) && tournament.publisher.toLowerCase() === botAddress.toLowerCase();
    for (let i = 0n; i < BigInt(bracket.projects.length - 1); i++) {
      try {
        const match = await readMatch(id, i);
        const fight = fightOf(bracket.id, Number(i));
        const step = nextStep({ tournament, match, fight, nowSec: Number(now), canPublish });
        if (step === "start") {
          log(`starting the fight for tournament ${bracket.id} match ${i}`);
          startFight(bracket.id, Number(i), { a: Number(match.projectA), b: Number(match.projectB), revealAt: Number(match.cutoff > tournament.bettingCutoff ? match.cutoff : tournament.bettingCutoff) * 1000 });
        } else if (step === "publish") {
          const hash = await publish(id, i, fight);
          log(`published tournament ${bracket.id} match ${i}: ${hash}`);
        }
      } catch (e) {
        log(`tournament ${bracket.id} match ${i}: ${e.shortMessage ?? e.message}`);
      }
    }
  }
}
