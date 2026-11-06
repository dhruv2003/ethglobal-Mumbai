/*
 * Runs one real fight on 0G between two submitted projects and returns the event
 * stream the web player animates, plus the scores the organizer publishes on chain.
 *
 *   fighters -> per criterion: judge question -> answers -> challenges -> rebuttals
 *   -> (defense: closings) -> 3 independent scorecards -> majority rulings -> sealed round
 *   -> final scores (backend/scoring) -> tie-break round only if the main scores tie.
 *
 * Nothing here is scripted: every line comes from the agent service (src/agents).
 */
import crypto from "node:crypto";
import agents from "../agents/index.js";
import dossierLib from "../agents/dossier.js";
import rubric from "../agents/rubric.js";
import { MATCH_STEP, TIEBREAK_RUBRIC, computeFinalScore, decideMatch } from "../../scoring/src/index.js";

const { matchContext } = dossierLib;
const { CRITERIA, DEFAULT_JUDGES } = rubric;
const lc = (side) => side.toLowerCase();
const evidenceChips = (ids = [], ctx) => ids.map((id) => ({ kind: "evidence", label: `${id}: ${String(ctx.evidenceText.get(id) ?? "").slice(0, 70)}` }));
const MOVES = { implemented_feature: "Feature Check", test_evidence: "Test Strike", user_value: "User Story Sweep", limitation_acknowledged: "Limits Probe", future_plan: "Roadmap Check", challenge: "Evidence Challenge", rebuttal: "Counter", clarification: "Clarify" };

/** The judge panel as the player shows it. */
export const judgeCast = (judges = DEFAULT_JUDGES) =>
  Object.fromEntries(judges.map((j) => [j.id, { name: j.name.replace(/^The /, "").replace(/ Judge$/, ""), focus: j.focus.split(",")[0] }]));

/**
 * corners: { A: { project: {name,pitch,tracks}, dossier }, B: ... }
 * onProgress(text, events): called as the fight advances (events = player events so far).
 */
export async function runFight({ corners, onProgress = () => {}, judges = DEFAULT_JUDGES }) {
  const ctx = matchContext(corners);
  const out = []; // player events (lowercase sides)
  const model = []; // agent-format events the models read as the transcript
  const traces = [];
  let seq = 0;
  const emit = (e, trace) => {
    out.push({ seq: ++seq, ts: new Date().toISOString(), ...e, ...(trace?.requestId ? { proof: { requestId: trace.requestId, teeVerified: trace.teeVerified ?? null } } : {}) });
  };
  const say = (e) => model.push({ seq: model.length + 1, ...e });
  const keep = (ts) => ts?.forEach((t) => traces.push(t));
  const note = (text) => onProgress(text, out);

  emit({ type: "intro" });
  note("Building the fighters");
  const [fa, fb] = await Promise.all([agents.createFighter(corners.A), agents.createFighter(corners.B)]);
  const fighters = { A: fa, B: fb };
  for (const s of ["A", "B"]) {
    keep(fighters[s].traces);
    say({ actor: s, type: "pitch", text: fighters[s].openingPitch });
    emit({ type: "pitch", actor: lc(s), text: fighters[s].openingPitch }, fighters[s].trace);
  }

  const cards = judges.map((j) => ({ judgeId: j.id, scores: {}, A: {}, B: {} })); // per judge, per criterion
  const sealedByRound = {};

  for (const [i, c] of CRITERIA.entries()) {
    note(`Round ${i + 1} of ${CRITERIA.length}: ${c.name}`);
    emit({ type: "round_start", round: c.id });
    const judge = judges[i % judges.length];

    const q = await agents.judgeQuestion({ judge, criterionId: c.id, ctx, events: model });
    keep(q.traces);
    say({ actor: judge.id, round: c.id, type: "question", text: q.question });
    emit({ type: "question", round: c.id, actor: judge.id, text: q.question }, q.trace);

    const answers = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "answer", criterionId: c.id, fighter: fighters[side], ctx, events: model, question: q.question })));
    for (const t of answers) {
      keep(t.traces);
      say({ actor: t.side, round: c.id, type: "answer", text: t.text, evidenceIds: t.evidenceIds });
      emit({ type: "answer", round: c.id, actor: lc(t.side), text: t.text }, t.trace);
    }

    const challenges = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "challenge", criterionId: c.id, fighter: fighters[side], ctx, events: model })));
    const chList = challenges.map((t, k) => ({ challengeId: `${c.id}-${k + 1}`, by: t.side, text: t.text, targetClaim: t.targetClaim, evidenceIds: t.evidenceIds, claimType: t.claimType }));
    challenges.forEach((t, k) => {
      keep(t.traces);
      say({ actor: t.side, round: c.id, type: "challenge", challengeId: chList[k].challengeId, text: t.text, evidenceIds: t.evidenceIds });
      emit({ type: "challenge", round: c.id, actor: lc(t.side), target: t.side === "A" ? "b" : "a", challengeId: chList[k].challengeId, move: MOVES[t.claimType] ?? "Challenge", text: t.text, evidence: evidenceChips(t.evidenceIds, ctx) }, t.trace);
    });

    const rebuttals = await Promise.all(
      chList.map((ch) => {
        const side = ch.by === "A" ? "B" : "A";
        return agents.advocateTurn({ side, kind: "rebuttal", criterionId: c.id, fighter: fighters[side], ctx, events: model, target: ch });
      }),
    );
    rebuttals.forEach((t, k) => {
      keep(t.traces);
      chList[k].rebuttal = t.text;
      say({ actor: t.side, round: c.id, type: "rebuttal", challengeId: chList[k].challengeId, text: t.text, evidenceIds: t.evidenceIds });
      emit({ type: "rebuttal", round: c.id, actor: lc(t.side), challengeId: chList[k].challengeId, text: t.text, evidence: evidenceChips(t.evidenceIds, ctx) }, t.trace);
    });

    // Closing statements come before the last round seals (BAT-06).
    let closings = [];
    if (c.id === "defense") {
      closings = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "closing", criterionId: c.id, fighter: fighters[side], ctx, events: model })));
      for (const t of closings) {
        keep(t.traces);
        say({ actor: t.side, round: c.id, type: "closing", text: t.text });
        emit({ type: "closing", actor: lc(t.side), text: t.text }, t.trace);
      }
    }

    // Three judges score independently and in parallel, never seeing each other (JDG-03).
    const round = await Promise.all(judges.map((j) => agents.judgeScorecard({ judge: j, criterionId: c.id, ctx, events: model, challenges: chList })));
    round.forEach((r) => keep(r.traces));
    for (const ch of chList) {
      const votes = Object.fromEntries(round.map((r) => [r.judgeId, r.rulings.find((x) => x.challengeId === ch.challengeId)?.label ?? "inconclusive"]));
      const reason = round.map((r) => r.rulings.find((x) => x.challengeId === ch.challengeId)?.reason).find(Boolean) ?? "";
      emit({ type: "ruling", round: c.id, challengeId: ch.challengeId, votes, reason });
    }
    round.forEach((r, k) => {
      cards[k].A[c.id] = r.scores.A.score;
      cards[k].B[c.id] = r.scores.B.score;
    });
    sealedByRound[c.id] = { a: round.map((r) => r.scores.A.score), b: round.map((r) => r.scores.B.score), notes: round.map((r) => ({ judgeId: r.judgeId, A: r.scores.A, B: r.scores.B, trace: r.trace?.requestId ?? null })) };
    emit({ type: "round_sealed", round: c.id, scores: { a: sealedByRound[c.id].a, b: sealedByRound[c.id].b } });
  }

  // ---- Final score (PRD 9.2), exactly as the contract will see it ----
  const cardsFor = (side) => cards.map((k) => ({ judgeId: k.judgeId, scores: { ...k[side] } }));
  const mainInput = { a: { projectId: "A", scorecards: cardsFor("A") }, b: { projectId: "B", scorecards: cardsFor("B") } };
  let decision = decideMatch(mainInput);
  const scores = { a: decision.scores.a.finalHundredths, b: decision.scores.b.finalHundredths };
  let tie = { a: 0, b: 0 };

  if (decision.step === MATCH_STEP.RUN_TIEBREAK) {
    note("Scores tied: running the tie-break round");
    emit({ type: "tie_break", stage: "start" });
    const judge = judges[0];
    const q = await agents.judgeQuestion({ judge, criterionId: "product", ctx, events: model, tiebreak: true });
    keep(q.traces);
    say({ actor: judge.id, round: "tiebreak", type: "question", text: q.question });
    const ans = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "tiebreak_answer", criterionId: "product", fighter: fighters[side], ctx, events: model, question: q.question })));
    ans.forEach((t) => {
      keep(t.traces);
      say({ actor: t.side, round: "tiebreak", type: "answer", text: t.text, evidenceIds: t.evidenceIds });
    });
    const reb = await Promise.all(ans.map((a) => {
      const side = a.side === "A" ? "B" : "A";
      return agents.advocateTurn({ side, kind: "tiebreak_rebuttal", criterionId: "product", fighter: fighters[side], ctx, events: model, target: a });
    }));
    reb.forEach((t) => {
      keep(t.traces);
      say({ actor: t.side, round: "tiebreak", type: "rebuttal", text: t.text, evidenceIds: t.evidenceIds });
    });
    // Product reasoning is scored on the product lens, evidence/defense accuracy on the defense lens.
    const [reason, defense] = await Promise.all(
      ["product", "defense"].map((cid) => Promise.all(judges.map((j) => agents.judgeScorecard({ judge: j, criterionId: cid, ctx, events: model, challenges: [] })))),
    );
    [...reason, ...defense].forEach((r) => keep(r.traces));
    const tb = (side) => judges.map((j, k) => ({ judgeId: j.id, scores: { productReasoning: reason[k].scores[side].score, evidenceDefense: defense[k].scores[side].score } }));
    const tiebreak = { a: tb("A"), b: tb("B") };
    decision = decideMatch({ ...mainInput, tiebreak });
    tie = { a: computeFinalScore(tiebreak.a, TIEBREAK_RUBRIC).finalHundredths, b: computeFinalScore(tiebreak.b, TIEBREAK_RUBRIC).finalHundredths };
    emit({ type: "tie_break", stage: "sealed", scores: tie });
  }

  if (decision.step === MATCH_STEP.HUMAN_REVIEW) {
    emit({ type: "human_review", status: "pending" });
  } else {
    const winner = decision.winnerProjectId === "A" ? "a" : "b";
    emit({ type: "result", winner, reason: decision.decisionSource === "TIEBREAK" ? "tie_break" : "score" });
  }

  const usd = traces.reduce((s, t) => s + (t.costUsdMicro ?? 0), 0) / 1e6;
  const body = { events: out, scores, tie, needsReview: decision.step === MATCH_STEP.HUMAN_REVIEW, rounds: sealedByRound, fighters: { a: pick(fighters.A), b: pick(fighters.B) }, calls: traces.length, costUsd: usd };
  const resultHash = "0x" + crypto.createHash("sha256").update(JSON.stringify({ scores, tie, rounds: sealedByRound })).digest("hex");
  return { ...body, resultHash };
}

const pick = (f) => ({ fighterName: f.fighterName, archetype: f.archetype, catchphrase: f.catchphrase });
