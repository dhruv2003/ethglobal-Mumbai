/*
 * Which sounds a fight event triggers, and when. Pure, like the choreography it
 * follows: the impact timing below matches the strike in choreo.js.
 */
import { eventDuration } from "./choreo.js";
import { RULING_OUTCOME, rulingLabel } from "./score.js";

const START = 20; // just after an event begins; a position of 0 ms counts as "not started"
const IMPACT = 0.17; // when a strike lands in a ruling (choreo.js)
const RULING_SOUND = { hit: "attack", graze: "attack", block: "block", clash: "block" };

/** Music rests during these: the fight is over or waiting on an organizer. */
const MUSIC_RESTS = new Set(["result", "human_review"]);
export const musicPlaysDuring = (event) => !!event && !MUSIC_RESTS.has(event.type);

/** Sounds for one event: [{ at: ms into the event, sound, newSong? }]. */
export function cuesFor(event) {
  const at = (share) => eventDuration(event) * share;
  switch (event.type) {
    case "intro":
      return [{ at: START, sound: "bell" }];
    case "round_start":
      return [{ at: START, sound: "bell", newSong: true }];
    case "challenge":
      return [{ at: START, sound: "attack" }];
    case "ruling": {
      const label = event.label ?? rulingLabel(Object.values(event.votes ?? {}));
      return [{ at: at(IMPACT), sound: RULING_SOUND[RULING_OUTCOME[label]] ?? "block" }];
    }
    case "penalty":
      return [{ at: at(0.1), sound: "attack" }];
    case "round_sealed":
      return [{ at: at(0.05), sound: "points" }];
    case "result":
      return event.winner ? [{ at: at(0.05), sound: "victory" }] : [];
    default:
      return [];
  }
}

/**
 * Cues passed while the playback clock moved from one position to the next.
 * A seek plays only what's at the landing spot, never everything it jumped over.
 */
export function cuesBetween(events, from, to) {
  const inEvent = (index, after, upTo) => cuesFor(events[index]).filter((c) => c.at > after && c.at <= upTo);
  if (to.index === from.index && to.ms >= from.ms) return inEvent(to.index, from.ms, to.ms);
  const advanced = to.index === from.index + 1 && to.ms > 0;
  if (advanced) return [...inEvent(from.index, from.ms, Infinity), ...inEvent(to.index, 0, to.ms)];
  return inEvent(to.index, 0, to.ms);
}

/** A random item, avoiding the previous one so nothing plays twice in a row. */
export function pickOther(items, previous, random = Math.random) {
  const pool = items.length > 1 ? items.filter((item) => item !== previous) : items;
  return pool[Math.floor(random() * pool.length)];
}
