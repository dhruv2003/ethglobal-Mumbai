/*
 * Laya on 0G decides who wins each point of a 1v1 round.
 *
 * After both fighters have answered the round's question, challenged and rebutted,
 * Laya (a decision model: calibrated probabilities, not text) reads both sides'
 * best point for that round and picks a side.
 *
 * Output (one "point" event per round, see pointEvent):
 *   { type: "point", round, winner: "a" | "b" | "even",
 *     confidence: 0.62,                          // probability of the chosen side
 *     probabilities: { a: 0.62, b: 0.27, even: 0.11 },
 *     margin: "even" | "slight" | "clear" | "decisive",
 *     proof: { requestId } }
 * On failure: { type: "point", round, winner: null, error }.
 *
 * Points are commentary: the judges' sealed scores still decide health and the
 * winner (PRD BAT-08). The tally is shown beside the scores, never mixed into them.
 */
import zg from "../zg/client.js";
import zgModels from "../zg/models.js";

const SIDE_CHARS = 700; // Laya reads 512 tokens of English: both sides must fit
const EVEN_BELOW = 0.45; // a side needs this much probability, or the point is called even

const clip = (t, n) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** The state Laya reads: the round, then each side's best point (answer + rebuttal). */
export function pointState({ criterion, question, a, b }) {
  const side = (label, s) => `${label} (${clip(s.name, 40)}): ${clip([s.answer, s.rebuttal && `Rebuttal: ${s.rebuttal}`].filter(Boolean).join(" "), SIDE_CHARS)}`;
  return [
    `Hackathon 1v1, ${criterion} round.${question ? ` Question: ${clip(question, 200)}` : ""}`,
    side("Side A", a),
    side("Side B", b),
  ].join("\n");
}

/** The questions Laya answers. The criteria text is what each label means to the model. */
export function pointQuestions(criterion) {
  return {
    // Short labels: longer descriptions made Laya lean on wording instead of the answers
    // (checked by swapping the sides: this framing picks the same answer either way).
    point: {
      type: "choice",
      instructions: `Which side gave the stronger, evidence-backed answer for ${criterion}?`,
      criteria: { a: "Side A", b: "Side B", even: "equally strong" },
    },
    margin: {
      type: "score",
      instructions: "How clearly did the stronger side win this point?",
      criteria: ["even", "slight", "clear", "decisive"],
    },
  };
}

/** Laya's answers -> the point (pure; tested). */
export function readPoint(answers) {
  const p = answers?.point;
  if (!p?.probabilities) throw new Error("Laya returned no point decision.");
  const probabilities = { a: round(p.probabilities.a), b: round(p.probabilities.b), even: round(p.probabilities.even) };
  const m = answers.margin;
  const margin = m?.legend && m.probabilities ? m.legend[Object.entries(m.probabilities).sort((x, y) => y[1] - x[1])[0][0]] : null;
  const top = p.choice === "a" || p.choice === "b" ? p.choice : null;
  const winner = top && probabilities[top] >= EVEN_BELOW ? top : "even";
  return { winner, confidence: winner === "even" ? probabilities.even : probabilities[winner], probabilities, margin };
}
const round = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x) * 1000) / 1000 : 0);

/**
 * One point. sides: { a: { name, answer, rebuttal }, b: ... }. Never throws: a failed call
 * becomes a point event with winner null, so the fight carries on.
 */
export async function decidePoint({ round: roundId, criterion, question, a, b }, { client = zg, model = zgModels.MODELS.decisions } = {}) {
  try {
    const { answers, trace } = await client.decisions({ model, state: pointState({ criterion, question, a, b }), questions: pointQuestions(criterion) });
    return { event: { type: "point", round: roundId, ...readPoint(answers) }, trace };
  } catch (e) {
    return { event: { type: "point", round: roundId, winner: null, error: String(e?.message ?? e).slice(0, 200) }, trace: null };
  }
}

/** Running tally of points from a list of point events. */
export const tallyPoints = (events) => events.filter((e) => e.type === "point").reduce((t, e) => (e.winner ? { ...t, [e.winner]: t[e.winner] + 1 } : t), { a: 0, b: 0, even: 0 });
