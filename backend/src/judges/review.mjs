/*
 * One judge reviews one project with an LLM: OpenAI by default, or Claude.
 *
 *   JUDGE_PROVIDER=openai     (default) needs OPENAI_API_KEY,    JUDGE_MODEL default gpt-5.4
 *   JUDGE_PROVIDER=anthropic            needs ANTHROPIC_API_KEY, JUDGE_MODEL default claude-opus-5-5
 *
 * - Structured output (zod) so every review has the same shape, whichever provider.
 * - All 9 criteria must be scored exactly once, integers 0-100. Anything else
 *   gets one repair attempt; if that fails the review is marked invalid and no
 *   score is invented (PRD JDG-05).
 * - The overall score is computed here, in integers, from the judge's weights:
 *   sum(weight% x score) is already in hundredths of a point (PRD 9.2 style).
 * - Judges run independently and in parallel; none sees another's output (JDG-03).
 */
import { z } from "zod";
import { CRITERIA, CRITERION_IDS } from "./criteria.mjs";
import { liveTestSummary } from "../projects.mjs";

import { EFFORT, hasCredentials, MODEL, PROVIDER, structuredCall } from "../llm.mjs";

export { hasCredentials, MODEL, PROVIDER };

const ReviewSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.enum(CRITERION_IDS),
      score: z.number().int(),
      comment: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
  headline: z.string(),
  comment: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  dealBreakerHit: z.boolean(),
  dealBreakerNote: z.string(),
  certainty: z.enum(["low", "medium", "high"]),
});

const callModel = (system, user) => structuredCall(ReviewSchema, "judge_review", system, user);

function materials(project) {
  const d = project.dossier;
  const dossier = d && {
    summary: d.summary,
    verdict: d.verdict,
    evidence: d.evidence.map((e) => ({ id: e.id, claim: e.claim, status: e.status, observation: e.observation, limitations: e.limitations })),
    tests: d.tests,
    continuity: d.continuity,
    strengths: d.strengths,
    risks: d.risks,
    limitations: d.limitations,
    architecture: d.architecture?.map((a) => `${a.component}: ${a.detail}`),
    unresolvedQuestions: d.unresolvedQuestions,
  };
  return JSON.stringify({ submission: project.submission, reviewerDossier: dossier ?? "No dossier yet: judge from the submission only and say so.", liveTest: liveTestSummary(project.liveTest) ?? "Not tested live yet." }, null, 2);
}

const criteriaGuide = CRITERIA.map((c) => `- ${c.id} (${c.label}): ${c.about}`).join("\n");

function userPrompt(project) {
  return [
    `Judge the project "${project.submission.name}". Score each of these criteria (use these exact ids):`,
    criteriaGuide,
    "",
    "For each criterion give a score (integer 0-100), a one or two sentence comment in your voice, and the evidence or step IDs you relied on (empty list if none).",
    "Then give: a one-sentence headline verdict; a short overall comment (under 120 words) addressed to the team; up to 3 strengths and up to 3 concerns; whether any of your deal-breakers was hit and why; and how certain you are overall.",
    "",
    "<project_materials>",
    materials(project),
    "</project_materials>",
  ].join("\n");
}

/** Problems with a parsed review, in words. Empty list = valid. */
export function problems(review) {
  if (!review) return ["No parseable review was returned."];
  const out = [];
  const seen = new Map();
  for (const c of review.criteria) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  for (const id of CRITERION_IDS) {
    if (!seen.has(id)) out.push(`Missing criterion ${id}.`);
    else if (seen.get(id) > 1) out.push(`Criterion ${id} scored more than once.`);
  }
  for (const c of review.criteria) if (!Number.isInteger(c.score) || c.score < 0 || c.score > 100) out.push(`Score for ${c.id} must be an integer 0-100 (got ${c.score}).`);
  return out;
}

/** Overall in hundredths of a point: sum of weight% x score. Exact integers, no floats. */
export const overallHundredths = (weights, review) => review.criteria.reduce((n, c) => n + (weights[c.id] ?? 0) * c.score, 0);

export async function reviewProject(judge, project) {
  const started = Date.now();
  let prompt = userPrompt(project);
  const usage = { input_tokens: 0, output_tokens: 0 };
  let attempts = 0;
  let parsed = null;
  let issues = [];
  let stop = null;

  while (attempts < 2) {
    attempts++;
    const res = await callModel(judge.systemPrompt, prompt);
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    stop = res.stop;
    if (res.refusal) {
      return { judgeId: judge.id, status: "declined", detail: res.refusal, attempts, usage, ms: Date.now() - started };
    }
    parsed = res.parsed;
    issues = problems(parsed);
    if (!issues.length) break;
    // One repair attempt (PRD JDG-05): a fresh request that names the problems.
    prompt = `${userPrompt(project)}\n\nA previous attempt at this review had these problems; avoid them:\n${issues.map((i) => `- ${i}`).join("\n")}`;
  }

  if (issues.length) {
    return { judgeId: judge.id, status: "invalid", detail: issues.join(" "), stopReason: stop, attempts, usage, ms: Date.now() - started };
  }
  const order = new Map(CRITERION_IDS.map((id, i) => [id, i]));
  parsed.criteria.sort((a, b) => order.get(a.id) - order.get(b.id));
  return {
    judgeId: judge.id,
    status: "scored",
    overallHundredths: overallHundredths(judge.weights, parsed),
    review: parsed,
    attempts,
    usage,
    ms: Date.now() - started,
  };
}

/** Run the whole panel in parallel. Each judge is isolated; one failing doesn't stop the others. */
export async function runPanel(judgesList, project) {
  const results = await Promise.all(
    judgesList.map((j) =>
      reviewProject(j, project).catch((e) => ({ judgeId: j.id, status: "error", detail: String(e?.message ?? e).slice(0, 300) })),
    ),
  );
  const scored = results.filter((r) => r.status === "scored");
  const panel = scored.length ? Math.floor((scored.reduce((n, r) => n + r.overallHundredths, 0) * 2 + scored.length) / (2 * scored.length)) : null;
  return {
    projectId: project.id,
    ranAt: new Date().toISOString(),
    provider: PROVIDER,
    model: MODEL,
    effort: EFFORT,
    complete: scored.length === judgesList.length,
    panelHundredths: panel,
    reviews: results.map((r) => {
      const j = judgesList.find((x) => x.id === r.judgeId);
      return { ...r, judge: { id: j.id, name: j.name, title: j.title, version: j.version, promptVersion: j.promptVersion, weights: j.weights, tone: j.tone } };
    }),
  };
}
