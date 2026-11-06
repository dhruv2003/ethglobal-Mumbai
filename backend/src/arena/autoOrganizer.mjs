/*
 * Runs tournaments with no organizer. Once a tournament's deadline has passed and its reviews
 * are done, each track and the overall finalist race get a bracket on chain. Matches then open
 * by themselves, including later rounds once their feeder matches finish.
 * The server's wallet needs ORGANIZER_ROLE and PUBLISHER_ROLE, granted once by the admin.
 */
const SIZES = [16, 8, 4, 2];
const ROUNDS = { 2: 1n, 4: 2n, 8: 3n, 16: 4n };
const DAY = 86400n;
const CONFIGURED = 1;
const FROZEN = 2;
const NONE = 0;

/** The earliest submissions with a dossier, cut to the largest bracket they fill. */
export function pickField(entries) {
  const ready = entries.filter((s) => s.ready).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const size = SIZES.find((n) => n <= ready.length);
  return size ? ready.slice(0, size).map((s) => s.id) : [];
}

/** Order-independent identity of a set of submission IDs. */
const fieldKey = (ids) => [...ids].sort().join();

/** Brackets a tournament still needs: [{ track, field }]. Waits until the deadline and every review are done. */
export function bracketsToCreate(event, entries, brackets, overall, now = Date.now()) {
  if (now < Date.parse(event.deadline) || entries.some((s) => s.reviewing)) return [];
  const made = new Set(brackets.filter((b) => b.eventId === event.id).map((b) => b.trackId));
  const out = [];
  for (const track of [...event.tracks, overall]) {
    if (made.has(track.id)) continue;
    const inTrack = track.id === overall.id ? entries : entries.filter((s) => s.tracks.includes(track.id));
    const field = pickField(inTrack);
    if (!field.length) continue;
    // The same projects in a bracket that already exists would just be the same fight again.
    const key = fieldKey(field);
    const repeat = track.id === overall.id && (out.some((x) => fieldKey(x.field) === key) || brackets.some((b) => b.eventId === event.id && fieldKey(b.projects?.map((p) => p.submissionId) ?? []) === key));
    if (!repeat) out.push({ track, field });
  }
  return out;
}

/** The times a new bracket needs, with the contract's minimum resolution window. */
export function schedule(now, minutes, capacity) {
  const bettingCutoff = now + BigInt(minutes) * 60n;
  const scheduledStart = bettingCutoff + 60n;
  return { bettingCutoff, scheduledStart, resolutionDeadline: scheduledStart + (ROUNDS[capacity] + 1n) * DAY + 3600n };
}

/**
 * One pass. deps: { events(), entries(eventId), brackets(), overall, createAndRegister(event, track, field) -> id,
 *   readTournament(id), readMatch(id, i), freeze(bracket), openMatch(bracket, i), canOpen(bracket, i), botAddress, log }
 */
export async function organizerPass(deps) {
  const { log = () => {} } = deps;
  for (const event of deps.events()) {
    for (const { track, field } of bracketsToCreate(event, deps.entries(event.id), deps.brackets(), deps.overall)) {
      try {
        const id = await deps.createAndRegister(event, track, field);
        log(`created tournament ${id}: ${event.name} / ${track.name} with ${field.length} projects`);
      } catch (e) {
        log(`${event.name} / ${track.name}: ${e.shortMessage ?? e.message}`);
      }
    }
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
        if (Number(m.status) === NONE && (await deps.canOpen(bracket, i))) {
          await deps.openMatch(bracket, i);
          log(`opened tournament ${bracket.id} match ${i}`);
        }
      }
    } catch (e) {
      log(`tournament ${bracket.id}: ${e.shortMessage ?? e.message}`);
    }
  }
}
