/*
 * Fight state is a pure fold over the authoritative event stream (BAT-12).
 *
 *   state = events.reduce(reduceFight, initialFightState())
 *
 * - Events apply in sequence order; a repeat or stale seq is ignored, so a
 *   replayed or reconnected stream can never double damage (BAT-13).
 * - Health changes ONLY on `round_sealed`, and is recomputed from all sealed
 *   scores, never accumulated from deltas (BAT-08).
 * - No winner exists while human review is pending (BAT-10, TIE-03).
 */
import { CRITERIA, healthThousandths, pointsKept, rulingLabel, scoreHundredths } from "./score.js";

export const SIDES = ["a", "b"];
const START = 100000;

export function initialFightState() {
  return {
    seq: 0,
    phase: "pre",
    round: null,
    sealed: { a: {}, b: {} },
    health: { a: START, b: START },
    damage: null, // { round, a, b } from the most recent seal, in thousandths
    challenges: {},
    rulings: [],
    penalties: [],
    log: [],
    tieBreak: null,
    review: null,
    result: null,
    last: null,
  };
}

const LOGGED = new Set(["pitch", "question", "answer", "challenge", "rebuttal", "ruling", "penalty", "closing"]);

export function reduceFight(state, event) {
  if (!event || typeof event.seq !== "number" || event.seq <= state.seq) return state;
  const s = { ...state, seq: event.seq, last: event };
  if (LOGGED.has(event.type)) s.log = [...state.log, event];

  switch (event.type) {
    case "intro":
      s.phase = "intro";
      break;
    case "pitch":
      s.phase = "pitches";
      break;
    case "round_start":
      s.phase = "round";
      s.round = event.round;
      break;
    case "question":
    case "answer":
      s.phase = "round";
      s.round = event.round ?? s.round;
      break;
    case "challenge":
      s.challenges = { ...state.challenges, [event.challengeId]: { ...event, ruling: null } };
      break;
    case "rebuttal":
      break;
    case "ruling": {
      const label = event.label ?? rulingLabel(Object.values(event.votes ?? {}));
      const ch = state.challenges[event.challengeId];
      const ruling = { ...event, label, attacker: ch?.actor, target: ch?.target, round: event.round ?? ch?.round };
      s.challenges = { ...state.challenges, [event.challengeId]: { ...ch, ruling: label } };
      s.rulings = [...state.rulings, ruling];
      break;
    }
    case "penalty":
      s.penalties = [...state.penalties, event];
      break;
    case "closing":
      s.phase = "closing";
      break;
    case "round_sealed": {
      if (!CRITERIA.includes(event.round)) break;
      const sealed = { a: { ...state.sealed.a }, b: { ...state.sealed.b } };
      // A sealed round can't be revised by later events (9.2).
      if (sealed.a[event.round] || sealed.b[event.round]) break;
      for (const side of SIDES) sealed[side][event.round] = event.scores[side];
      const health = { a: healthThousandths(sealed.a), b: healthThousandths(sealed.b) };
      s.sealed = sealed;
      s.damage = { round: event.round, a: state.health.a - health.a, b: state.health.b - health.b };
      s.health = health;
      break;
    }
    case "tie_break":
      s.phase = "tie_break";
      s.tieBreak = { ...(state.tieBreak ?? {}), ...event };
      break;
    case "human_review":
      s.phase = "review";
      s.review = { status: event.status, winner: event.winner ?? null, rationale: event.rationale ?? "", organizer: event.organizer ?? "" };
      break;
    case "result":
      if (state.review?.status === "pending") break; // never crown a winner during review
      s.phase = "result";
      s.result = { winner: event.winner, reason: event.reason };
      break;
    default:
      break;
  }
  return s;
}

/** Fold events in order (sorted by seq; duplicates dropped by the reducer). */
export function foldEvents(events, from = initialFightState()) {
  return [...events].sort((x, y) => x.seq - y.seq).reduce(reduceFight, from);
}

/** State after every event with seq <= upTo. */
export const stateAt = (events, upTo) => foldEvents(events.filter((e) => e.seq <= upTo));

/** Reconnect: a server snapshot plus the missed events (overlap is harmless). */
export const catchUp = (snapshot, events) => foldEvents(events, snapshot);

/** Score so far for one side, in hundredths (null before any seal). */
export function scoreSoFar(state, side) {
  const sealed = state.sealed[side];
  return Object.keys(sealed).length ? scoreHundredths(pointsKept(sealed)) : null;
}
