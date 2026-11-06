// Judges see the full context (dossier, live test, screenshots as images) and can only cite what they were shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Screenshots are files of the project (0G Storage; in memory under node --test): store the sample's.
const ID = "go-health-me-sample";
const { putFile } = await import("../src/zg/files.mjs");
const smoke = new URL("../fixtures/go-health-me/smoke/", import.meta.url).pathname;
for (const device of ["laptop", "phone"])
  for (const f of fs.readdirSync(path.join(smoke, device)).filter((x) => /^smoke-.+\.jpg$/.test(x))) putFile(ID, `live/${device}/${f}`, fs.readFileSync(path.join(smoke, device, f)), { mime: "image/jpeg", kind: "live-screenshot" });
const { loadScreenshots } = await import("../src/judges/evidence.mjs");

const { citableIds, judgeImages, reviewProject, textOf, userPrompt } = await import("../src/judges/review.mjs");
const { compilePrompt, PROMPT_VERSION, validateForm } = await import("../src/judges/persona.mjs");
const { EXAMPLE_FORMS } = await import("../src/judges/seed.mjs");
const { CRITERION_IDS } = await import("../src/judges/criteria.mjs");
const { thinDossier, writeDossier } = await import("../src/reviewer/dossier.mjs");

// The sample project, built straight from its fixture files (sample projects are not served as projects).
const fixture = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/go-health-me/${f}`, import.meta.url), "utf8"));
const form = fixture("submission.json").form;
const project = {
  id: ID,
  kind: "submitted",
  submission: { teamName: form.team.name, name: form.project.name, pitch: form.project.pitch, description: form.project.description, repoUrl: form.code.repoUrl, tracks: form.tracks.selected },
  dossier: fixture("dossier.json"),
  liveTest: fixture("smoke/smoke.json"),
};
await loadScreenshots(project);

test("the judge gets the live-test screenshots as images, laptop first, each with its citable ID", () => {
  const images = judgeImages(project, 5);
  assert.equal(images.length, 5);
  assert.ok(images.every((i) => i.id.startsWith("V-laptop-") && i.caption.startsWith(`[${i.id}]`) && i.mime === "image/jpeg" && i.data.length > 1000));
  assert.deepEqual(judgeImages({ submission: { name: "X" } }), []);
});

test("the judge's message carries the whole dossier, the live test details and the valid ID list", () => {
  const u = userPrompt(project, { images: [] });
  const t = textOf(u);
  assert.match(t, /"coreJourney"/);
  assert.match(t, /"intendedUsers"/);
  assert.match(t, /"failedRequests"/);
  assert.match(t, /"screenshotId": "V-laptop-d1"/);
  assert.match(t, /IDs you may cite[^\n]*\bE1\b[^\n]*\bV-phone-d1\b/);
});

test("citations to anything the judge was not shown are dropped", async () => {
  const judge = validateForm(EXAMPLE_FORMS[1]).persona;
  const review = {
    criteria: CRITERION_IDS.map((id) => ({ id, score: 50, comment: "ok", evidence: ["E1", "[d1]", "continuity", "reviewerDossier.risks[0]", "V-laptop-d1"] })),
    headline: "h", comment: "c", strengths: [], concerns: [], dealBreakerHit: false, dealBreakerNote: "", certainty: "medium",
  };
  let sent;
  const r = await reviewProject(judge, project, { call: async (sys, user) => ((sent = { sys, user }), { parsed: structuredClone(review), usage: { input_tokens: 1, output_tokens: 1 }, stop: "stop" }) });
  assert.equal(r.status, "scored");
  assert.deepEqual(r.review.criteria[0].evidence, ["E1", "d1", "V-laptop-d1"]);
  assert.equal(r.droppedCitations, 2 * CRITERION_IDS.length);
  assert.ok(sent.user.images.length > 0, "screenshots were attached");
  assert.ok(citableIds(project).has("E1"));
});

test("judges saved under an older prompt version are judged with the current prompt", async () => {
  const judge = { ...validateForm(EXAMPLE_FORMS[0]).persona, promptVersion: "judge-v2", systemPrompt: "old prompt" };
  let sys;
  await reviewProject(judge, { submission: { name: "X" } }, { call: async (s) => ((sys = s), { parsed: null, usage: { input_tokens: 0, output_tokens: 0 } }) });
  assert.equal(sys, compilePrompt(judge));
  assert.match(sys, /Scoring anchors/);
  assert.equal(PROMPT_VERSION, "judge-v3");
});

const good = {
  summary: "A fitness app that pays users for workouts.", verdict: "Pose tracking holds up; payouts do not.", problem: "People skip workouts.", intendedUsers: "Casual gym-goers",
  coreJourney: ["Sign in", "Start a workout", "Get paid"], architecture: [], dependencies: [],
  evidence: Array.from({ length: 8 }, (_, i) => ({ id: `E${i + 1}`, claim: "c", source: "code", status: "submitted_claim", impact: "neutral", refs: [], observation: "o", limitations: "" })),
  strengths: [], limitations: [], risks: ["Owner picks winners"], unresolvedQuestions: [], highlights: { headline: "h", holdsUp: [], watch: [] },
};

test("thinDossier catches a dossier about the platform instead of the project", () => {
  assert.deepEqual(thinDossier(good), []);
  const bad = { ...good, verdict: good.summary, intendedUsers: "hackathon judges", coreJourney: [], risks: [] };
  const issues = thinDossier(bad);
  assert.ok(issues.some((i) => /different from summary/.test(i)));
  assert.ok(issues.some((i) => /not Battle Arena/.test(i)));
  assert.ok(issues.some((i) => /coreJourney/.test(i)));
});

test("a thin dossier is retried once with the problems named, and the better answer is kept", async () => {
  const args = { submission: { name: "P" }, dir: "/nonexistent", pack: { text: "", included: [], notIncluded: 0 }, facts: { tests: {}, continuity: {} }, commit: "abcdef0" };
  const prompts = [];
  const replies = [{ ...good, risks: [] }, good];
  const d = await writeDossier({ ...args, call: async (_s, _n, _sys, user) => (prompts.push(user), { parsed: structuredClone(replies.shift()), usage: { input_tokens: 1, output_tokens: 1 }, stop: "stop" }) });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /risks is empty/);
  assert.deepEqual(d.risks, good.risks);
  // A retry that comes back empty never replaces a usable first answer.
  const replies2 = [{ ...good, risks: [] }, { ...good, summary: "", problem: "", evidence: [] }];
  const d2 = await writeDossier({ ...args, call: async () => ({ parsed: structuredClone(replies2.shift()), usage: {}, stop: "stop" }) });
  assert.equal(d2.summary, good.summary);
  assert.equal(d2.reviewer.attempts, 2);
});
