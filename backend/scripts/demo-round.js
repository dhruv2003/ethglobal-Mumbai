/*
 * Runs one real scored round on 0G with the fixture project, end to end:
 * fighters -> judge question -> answers -> challenges -> rebuttals -> 3 independent scorecards
 * -> majority rulings. Prints the event list the fight player would animate.
 *
 * Only one fixture exists, so by default this is a mirror match (same project in both
 * corners): it proves the plumbing, not the judging. Pass two fixture folders to compare:
 *   cd backend && node scripts/demo-round.js go-health-me other-project [criterionId]
 */
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const agents = require("../src/agents");
const { matchContext } = require("../src/agents/dossier");
const { DEFAULT_JUDGES } = require("../src/agents/rubric");

const FIX = path.join(__dirname, "../fixtures");
const load = (name) => {
  const sub = JSON.parse(fs.readFileSync(path.join(FIX, name, "submission.json"), "utf8")).form;
  const dossier = JSON.parse(fs.readFileSync(path.join(FIX, name, "dossier.json"), "utf8"));
  return { project: { name: sub.project.name, pitch: sub.project.pitch, tracks: sub.tracks?.selected ?? [] }, dossier };
};

(async () => {
  const [a = "go-health-me", b = a, criterionId = "product"] = process.argv.slice(2);
  const corners = { A: load(a), B: load(b) };
  if (a === b) corners.B.project = { ...corners.B.project, name: `${corners.B.project.name} (mirror)` };
  const ctx = matchContext(corners);
  const events = [];
  let seq = 0;
  const cost = [];
  const push = (e, traces) => {
    events.push({ seq: ++seq, round: criterionId, ...e });
    for (const t of traces ?? []) cost.push(t);
    const tr = traces?.[traces.length - 1];
    console.log(`#${seq} [${e.actor}] ${e.type}: ${e.text}${e.evidenceIds?.length ? `  {${e.evidenceIds.join(", ")}}` : ""}${tr ? `\n     0G req ${tr.requestId} tee=${tr.teeVerified}` : ""}`);
  };
  const t0 = Date.now();

  const [fa, fb] = await Promise.all([agents.createFighter(corners.A), agents.createFighter(corners.B)]);
  const fighters = { A: fa, B: fb };
  for (const s of ["A", "B"]) push({ actor: s, type: "pitch", text: `${fighters[s].fighterName}: ${fighters[s].openingPitch}` }, fighters[s].traces);

  const judge = DEFAULT_JUDGES[0];
  const q = await agents.judgeQuestion({ judge, criterionId, ctx, events });
  push({ actor: judge.id, type: "question", text: q.question }, q.traces);

  // Both answer the same question in parallel (equal resources, AGT-04).
  const answers = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "answer", criterionId, fighter: fighters[side], ctx, events, question: q.question })));
  for (const t of answers) push({ actor: t.side, type: "answer", text: t.text, evidenceIds: t.evidenceIds, claimType: t.claimType }, t.traces);

  const challenges = await Promise.all(["A", "B"].map((side) => agents.advocateTurn({ side, kind: "challenge", criterionId, fighter: fighters[side], ctx, events })));
  const chList = challenges.map((t, i) => ({ challengeId: `c${i + 1}`, by: t.side, text: t.text, targetClaim: t.targetClaim, evidenceIds: t.evidenceIds }));
  for (const [i, t] of challenges.entries()) push({ actor: t.side, type: "challenge", challengeId: chList[i].challengeId, text: t.text, evidenceIds: t.evidenceIds }, t.traces);

  // Each side rebuts the challenge aimed at it.
  const rebuttals = await Promise.all(
    chList.map((ch) => {
      const side = ch.by === "A" ? "B" : "A";
      return agents.advocateTurn({ side, kind: "rebuttal", criterionId, fighter: fighters[side], ctx, events, target: ch });
    }),
  );
  for (const [i, t] of rebuttals.entries()) {
    chList[i].rebuttal = t.text;
    push({ actor: t.side, type: "rebuttal", challengeId: chList[i].challengeId, text: t.text, evidenceIds: t.evidenceIds }, t.traces);
  }

  // Three judges score independently and in parallel (JDG-03).
  const cards = await Promise.all(DEFAULT_JUDGES.map((j) => agents.judgeScorecard({ judge: j, criterionId, ctx, events, challenges: chList })));
  console.log("\nScorecards:");
  for (const c of cards) {
    cost.push(...c.traces);
    console.log(`  ${c.judgeId}: A=${c.scores.A.score} (${c.scores.A.uncertainty}) B=${c.scores.B.score} (${c.scores.B.uncertainty})  0G req ${c.trace.requestId} tee=${c.trace.teeVerified}`);
    console.log(`     A: ${c.scores.A.justification}\n     B: ${c.scores.B.justification}`);
  }
  console.log("\nRulings (majority of 3):");
  for (const ch of chList) {
    const labels = cards.map((c) => c.rulings.find((r) => r.challengeId === ch.challengeId)?.label);
    console.log(`  ${ch.challengeId} by ${ch.by}: ${agents.tallyRulings(labels)}  (${labels.join(", ")})`);
  }
  const usd = cost.reduce((s, t) => s + (t.costUsdMicro ?? 0), 0) / 1e6;
  console.log(`\n${cost.length} 0G calls, $${usd.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})().catch((e) => {
  console.error("FAILED:", e.code ?? "", e.message, e.requestId ? `(0G req ${e.requestId})` : "");
  process.exit(1);
});
