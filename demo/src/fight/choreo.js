/*
 * Choreography: (event, elapsed ms, state) -> what the ring shows right now.
 * Pure and deterministic, so playback can pause, seek and replay exactly.
 * Purely cosmetic: it reads rulings to pick a move, never decides damage.
 *
 * Positions are in scene pixels (the scene is 108×60). Each fighter is a
 * 24×20 cell; `x` is the cell's left edge, `y` an upward lift.
 */
import { RULING_OUTCOME } from "./score.js";

export const SCENE = { w: 108, h: 60, ground: 48 };
export const HOME = { a: 28, b: 56 };
const CONTACT = { a: 34, b: 50 };
const FOE = { a: "b", b: "a" };

const clamp = (v) => Math.max(0, Math.min(1, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
/** forward = toward the opponent */
const fwd = (side, d) => (side === "a" ? d : -d);

/** How long each event holds the stage at 1× (ms). Text reads at ~230 wpm. */
export function eventDuration(e) {
  const words = e.text ? e.text.trim().split(/\s+/).length : 0;
  switch (e.type) {
    case "intro": return 3200;
    case "round_start": return 1800;
    case "ruling": return 3000;
    case "penalty": return 2800;
    case "round_sealed": return 2800;
    case "result": return 4500;
    case "human_review": return 4000;
    default: return Math.min(9000, 1100 + words * 260);
  }
}

function idle(side, ms, phase = 0) {
  return { pose: Math.floor((ms + phase) / 520) % 2 ? "bob" : "idle", x: HOME[side], y: 0 };
}

/**
 * @returns {{ a, b, fx: { kind?, at?, t?, side? }, shake: number, t: number }}
 */
export function choreograph(event, ms, state, { reduced = false } = {}) {
  const dur = event ? eventDuration(event) : 1;
  const t = reduced ? 0.32 : clamp(ms / dur);
  const tick = reduced ? 0 : ms;
  const out = { a: idle("a", tick), b: idle("b", tick, 260), fx: {}, shake: 0, t };
  if (!event) return out;

  const talk = (side) => {
    out[side] = { pose: Math.floor(tick / 170) % 2 ? "talk" : "idle", x: HOME[side] + fwd(side, 1), y: 0 };
  };

  switch (event.type) {
    case "intro": {
      const k = easeOut(seg(t, 0, 0.6));
      const walk = Math.floor(tick / 140) % 2 ? "bob" : "idle";
      out.a = { pose: k < 1 ? walk : "idle", x: lerp(HOME.a - 20, HOME.a, reduced ? 1 : k), y: 0 };
      out.b = { pose: k < 1 ? walk : "idle", x: lerp(HOME.b + 20, HOME.b, reduced ? 1 : k), y: 0 };
      break;
    }
    case "pitch":
    case "answer":
    case "closing":
    case "rebuttal":
      if (event.actor === "a" || event.actor === "b") talk(event.actor);
      if (event.type === "rebuttal" && event.actor) out[FOE[event.actor]].pose = "idle";
      break;
    case "challenge": {
      // Attack preparation while the challenge is presented (BAT-09).
      const s = event.actor;
      const k = easeOut(seg(t, 0, 0.25));
      out[s] = { pose: "wind", x: HOME[s] + fwd(s, 2 * k), y: 0 };
      out.fx = { kind: "callout", t: seg(t, 0.05, 0.2) };
      break;
    }
    case "ruling": {
      const ch = state?.challenges?.[event.challengeId] ?? {};
      const s = ch.actor ?? "a";
      const o = FOE[s];
      const label = state?.rulings?.find((r) => r.challengeId === event.challengeId)?.label ?? event.label ?? "inconclusive";
      const outcome = RULING_OUTCOME[label] ?? "clash";
      const inK = easeInOut(seg(t, 0, 0.16));
      const backK = easeInOut(seg(t, 0.6, 0.9));
      const striking = t >= 0.16 && t < 0.6;
      const ax = lerp(lerp(HOME[s], CONTACT[s], inK), HOME[s], backK);
      out[s] = { pose: striking ? "punch" : t < 0.16 ? "wind" : "idle", x: ax, y: 0 };
      const impact = seg(t, 0.17, 0.42);
      if (outcome === "hit" || outcome === "graze") {
        const push = outcome === "hit" ? 4 : 1.5;
        const kb = t < 0.17 ? 0 : easeOut(seg(t, 0.17, 0.32)) * (1 - easeInOut(seg(t, 0.5, 0.85)));
        // knocked back, away from the attacker, then settles home
        out[o] = { pose: t >= 0.17 && t < 0.55 ? "hit" : "idle", x: HOME[o] + fwd(o, -push * kb), y: 0 };
        out.shake = outcome === "hit" ? (1 - seg(t, 0.17, 0.3)) * (t >= 0.17 ? 1 : 0) : 0;
      } else if (outcome === "block") {
        const kb = t < 0.17 ? 0 : easeOut(seg(t, 0.17, 0.3)) * (1 - easeInOut(seg(t, 0.45, 0.8)));
        out[o] = { pose: t < 0.75 ? "block" : "idle", x: HOME[o] + fwd(o, -1 * kb), y: 0 };
      } else {
        // clash: both commit, nobody lands (inconclusive / mixed)
        const oin = easeInOut(seg(t, 0.02, 0.16));
        out[o] = { pose: striking ? "punch" : t < 0.16 ? "wind" : "idle", x: lerp(lerp(HOME[o], CONTACT[o], oin), HOME[o], backK), y: 0 };
      }
      out.fx = { kind: outcome, t: impact, stamp: seg(t, 0.3, 0.42), label };
      break;
    }
    case "penalty": {
      const s = event.target;
      const k = seg(t, 0.1, 0.45);
      out[s] = { pose: k > 0 && k < 1 ? "hit" : "idle", x: HOME[s] + fwd(s, -1.5 * Math.sin(Math.PI * k)), y: 0 };
      out.fx = { kind: "penalty", t: seg(t, 0.05, 0.2), side: s };
      break;
    }
    case "round_sealed":
      out.fx = { kind: "seal", t: seg(t, 0.05, 0.25), float: seg(t, 0.15, 0.85) };
      break;
    case "result": {
      const w = state?.result?.winner;
      if (w) {
        const hop = reduced ? 0 : Math.abs(Math.sin((tick / 420) * Math.PI)) * 3;
        out[w] = { pose: "victory", x: HOME[w], y: hop };
        out[FOE[w]] = { pose: "defeat", x: HOME[FOE[w]], y: 0 };
      }
      out.fx = { kind: "result", t: seg(t, 0.05, 0.25) };
      break;
    }
    default:
      break;
  }
  return out;
}

/** "2–1", "3–0", or "split" for a ruling's vote count. */
export function voteCount(votes, label) {
  const v = Object.values(votes ?? {});
  const yes = v.filter((x) => x === label).length;
  return label === "mixed" ? "split" : `${yes}–${v.length - yes}`;
}
