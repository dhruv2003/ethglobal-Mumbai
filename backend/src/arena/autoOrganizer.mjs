/*
 * Runs tournaments with no organizer. Reviewed projects that aren't in a tournament yet get one
 * as soon as there are enough; matches open by themselves, including later rounds once their
 * feeder matches finish. Fights, publishing and payouts then follow on their own.
 * The server's wallet needs ORGANIZER_ROLE and PUBLISHER_ROLE, granted once by the admin.
 */
const SIZES = [16, 8, 4, 2];
const ROUNDS = { 2: 1n, 4: 2n, 8: 3n, 16: 4n };
const DAY = 86400n;
const CONFIGURED = 1;
const FROZEN = 2;
const NONE = 0;

/** The oldest ready projects that aren't in any bracket, cut to the largest size a bracket allows. */
export function pickField(submissions, brackets) {
  const used = new Set(brackets.flatMap((b) => b.projects.map((p) => p.submissionId)));
  const ready = submissions
    .filter((s) => s.ready && !used.has(s.id))
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const size = SIZES.find((n) => n <= ready.length);
  return size ? ready.slice(0, size).map((s) => s.id) : [];
}

/** The times a new tournament needs, with the contract's minimum resolution window. */
export function schedule(now, minutes, capacity) {
  const bettingCutoff = now + BigInt(minutes) * 60n;
  const scheduledStart = bettingCutoff + 60n;
  return { bettingCutoff, scheduledStart, resolutionDeadline: scheduledStart + (ROUNDS[capacity] + 1n) * DAY + 3600n };
}

/**
 * One pass. deps: {
 *   submissions() [{id, ready, submittedAt}], brackets(), createAndRegister(field) -> id,
 *   readTournament(id), readMatch(id, i), freeze(bracket), openMatch(id, i), canOpen(id, i) -> bool, botAddress, log }
 */
export async function organizerPass(deps) {
  const { log = () => {} } = deps;
  const field = pickField(deps.submissions(), deps.brackets());
  if (field.length) {
    const id = await deps.createAndRegister(field);
    log(`created tournament ${id} with ${field.length} projects`);
  }
  for (const bracket of deps.brackets()) {
    const id = BigInt(bracket.id);
    try {
      const t = await deps.readTournament(id);
      if (t.organizer.toLowerCase() !== deps.botAddress.toLowerCase()) continue;
      if (Number(t.status) === CONFIGURED) {
        await deps.freeze(bracket);
        log(`froze tournament ${bracket.id}`);
        continue;
      }
      if (Number(t.status) !== FROZEN) continue;
      for (let i = 0n; i < BigInt(bracket.projects.length - 1); i++) {
        const m = await deps.readMatch(id, i);
        if (Number(m.status) === NONE && (await deps.canOpen(id, i))) {
          await deps.openMatch(id, i);
          log(`opened tournament ${bracket.id} match ${i}`);
        }
      }
    } catch (e) {
      log(`tournament ${bracket.id}: ${e.shortMessage ?? e.message}`);
    }
  }
}
