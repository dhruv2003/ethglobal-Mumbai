/*
 * What happens after a submission, step by step, with live status the web
 * app polls (GET /api/projects/:id/pipeline):
 *
 *   fetch    clone the public repo (never run)
 *   pin      record the exact commit reviewed, and history facts
 *   tests    count tests by reading files; NOT run (no sandbox yet, PRD TST-05)
 *   demo     transcribe the demo video (Loom captions or OpenAI transcription)
 *   dossier  reviewer agent writes the evidence dossier; refs checked against the clone
 *   live     explore the live app on cloud browsers, write flows (demo replay +
 *            major flows), run them on laptop and phone, recorded
 *   judges   the panel scores with the dossier and the live test
 *
 * A failed step marks what follows as skipped, except the judges, who still
 * score from the submission alone (and say so).
 *
 * Queue: submissions are reviewed in order, REVIEW_CONCURRENCY at a time
 * (default 1). Each waiting project knows its place in line. On restart,
 * anything submitted but not finished is put back in the queue.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverSite, runLiveTest } from "../../tester/runner.mjs";
import { hasCredentials } from "../llm.mjs";
import { dossiers, liveDir, pipelines, repoDir, submissions, transcripts, workDir } from "../store.mjs";
import { demoTranscript, describeDuration } from "./demo.mjs";
import { writeDossier } from "./dossier.mjs";
import { writeFlows } from "./flows.mjs";
import { readCapped, safeFetch } from "./net.mjs";
import { GITHUB_REPO, cloneRepo, contextPack, countTests, historyFacts, inventory } from "./repo.mjs";

export const STEPS = [
  { id: "fetch", title: "Fetch the repository" },
  { id: "pin", title: "Pin the commit" },
  { id: "tests", title: "Count the tests" },
  { id: "demo", title: "Read the demo video" },
  { id: "dossier", title: "Build the evidence dossier" },
  { id: "live", title: "Test the live app on cloud browsers" },
  { id: "judges", title: "Judges score it" },
];

/** Mozark token: MOZARK_TOKEN, else the KEY=VALUE file at MOZARK_ENV_FILE (default ~/.mozark.env). */
export function mozarkToken() {
  if (process.env.MOZARK_TOKEN) return process.env.MOZARK_TOKEN;
  try {
    const file = process.env.MOZARK_ENV_FILE ?? path.join(os.homedir(), ".mozark.env");
    return fs.readFileSync(file, "utf8").match(/^MOZARK_TOKEN=(.+)$/m)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/** Live URL: the team's optional field, else the GitHub repo's homepage. */
async function liveUrlFor(sub) {
  if (sub.liveUrl) return { url: sub.liveUrl, from: "the submission" };
  const m = GITHUB_REPO.exec(sub.repoUrl ?? "");
  if (!m) return null;
  try {
    const res = await safeFetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) return null;
    const home = JSON.parse((await readCapped(res, 512 * 1024)).toString("utf8")).homepage;
    return home && /^https:\/\//.test(home) ? { url: home, from: "the repo's GitHub homepage" } : null;
  } catch {
    return null;
  }
}
const EVENT_START = process.env.EVENT_START ?? "2026-11-06T00:00:00+05:30";
const CONCURRENCY = Math.max(1, Number(process.env.REVIEW_CONCURRENCY ?? 1));
const running = new Map();
const queue = []; // project ids waiting, oldest first
let judgeFn = null;

export const isRunning = (id) => running.has(id);
/** 1-based place in line, or null when not waiting. */
export const queuePosition = (id) => (queue.includes(id) ? queue.indexOf(id) + 1 : null);
export const queueLength = () => queue.length;

/** Take a waiting project out of the line (e.g. it was deleted). */
export function dequeue(projectId) {
  const i = queue.indexOf(projectId);
  if (i >= 0) queue.splice(i, 1);
}

/** Run now, skipping the queue (CLI and tests). */
export function runPipeline(projectId, { judge }) {
  if (running.has(projectId)) return running.get(projectId);
  const job = execute(projectId, judge).finally(() => running.delete(projectId));
  running.set(projectId, job);
  return job;
}

/** Put a project in line for review. Returns its position (0 = already running). */
export function enqueue(projectId, { judge }) {
  judgeFn = judge;
  if (running.has(projectId)) return 0;
  if (!queue.includes(projectId)) {
    queue.push(projectId);
    const prev = pipelines.get(projectId);
    pipelines.save(projectId, { projectId, queuedAt: new Date().toISOString(), startedAt: null, finishedAt: null, steps: STEPS.map((x) => ({ ...x, status: "queued" })), previous: prev?.finishedAt ? { finishedAt: prev.finishedAt } : undefined });
  }
  pump();
  return queuePosition(projectId) ?? 0;
}

function pump() {
  while (running.size < CONCURRENCY && queue.length) {
    const id = queue.shift();
    const job = execute(id, judgeFn)
      .catch((e) => console.error(`[pipeline] ${id} failed: ${e.message}`))
      .finally(() => {
        running.delete(id);
        pump();
      });
    running.set(id, job);
  }
}

/** After a restart: queue every submission whose review never finished, oldest first. */
export function resumeQueue({ judge }) {
  const unfinished = submissions
    .list()
    .filter((s) => !pipelines.get(s.id)?.finishedAt)
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  for (const s of unfinished) enqueue(s.id, { judge });
  return unfinished.length;
}

async function execute(projectId, judge) {
  const sub = submissions.get(projectId);
  if (!sub) throw Object.assign(new Error("No such submitted project."), { status: 404 });
  const state = { projectId, startedAt: new Date().toISOString(), finishedAt: null, steps: STEPS.map((s) => ({ ...s, status: "queued" })) };
  const save = () => pipelines.save(projectId, state);
  const step = (id) => state.steps.find((s) => s.id === id);
  async function doStep(id, fn) {
    const s = step(id);
    s.status = "running";
    s.startedAt = new Date().toISOString();
    save();
    try {
      const detail = await fn();
      s.status = "done";
      s.detail = detail;
      return true;
    } catch (e) {
      s.status = "failed";
      s.detail = String(e?.message ?? e).slice(0, 300);
      return false;
    } finally {
      s.finishedAt = new Date().toISOString();
      save();
    }
  }
  const skip = (id, why) => Object.assign(step(id), { status: "skipped", detail: why });
  save();

  const dir = repoDir(projectId);
  let commit;
  let files;
  let facts = {};
  const ok =
    (await doStep("fetch", async () => {
      commit = await cloneRepo(sub.repoUrl, dir);
      return commit.url.replace("https://", "");
    })) &&
    (await doStep("pin", async () => {
      facts.continuity = await historyFacts(dir, EVENT_START);
      return `${commit.sha.slice(0, 7)} · committed ${commit.committedAt.slice(0, 10)} · ${facts.continuity.commitsSeen}${facts.continuity.historyTruncated ? "+" : ""} commits`;
    })) &&
    (await doStep("tests", async () => {
      files = await inventory(dir);
      const t = countTests(dir, files);
      const parts = [t.jsCases && `${t.jsCases} JS/TS cases in ${t.jsFiles} files`, t.solTests && `${t.solTests} Solidity tests in ${t.solFiles} files`, t.pyTests && `${t.pyTests} Python tests in ${t.pyFiles} files`].filter(Boolean);
      facts.tests = {
        status: "not_run",
        claimed: "",
        found: { vitestFiles: t.jsFiles, vitestCases: t.jsCases, forgeFiles: t.solFiles, forgeTests: t.solTests, pyFiles: t.pyFiles, pyTests: t.pyTests },
        method: "Counted it()/test() in *.test/*.spec files, function test* in *.t.sol, def test_ in Python tests. Read only.",
        note: "Counted, not run: running a submission's code needs the isolated sandbox, which isn't built yet.",
      };
      return `${parts.join(" · ") || "No tests found"}. Not run: no sandbox yet.`;
    }));

  // Demo video: independent of the repo, so it runs even if the clone failed.
  let transcript = null;
  if (!sub.demoVideoUrl) skip("demo", "Skipped: no demo video link.");
  else {
    const s = step("demo");
    s.status = "running";
    s.startedAt = new Date().toISOString();
    save();
    try {
      transcript = await demoTranscript(sub.demoVideoUrl, workDir(projectId));
      transcripts.save(projectId, { ...transcript, videoUrl: sub.demoVideoUrl, at: new Date().toISOString() });
      Object.assign(s, { status: "done", detail: `${transcript.source}${transcript.seconds ? ` · ${describeDuration(transcript.seconds)}` : ""} · ${transcript.text.split(/\s+/).length} words` });
    } catch (e) {
      Object.assign(s, { status: e.skip ? "skipped" : "failed", detail: String(e.message).slice(0, 240) });
    } finally {
      s.finishedAt = new Date().toISOString();
      fs.rmSync(workDir(projectId), { recursive: true, force: true });
      save();
    }
  }

  if (!ok) {
    for (const s of state.steps) if (s.status === "queued" && s.id === "dossier") skip(s.id, "Skipped: an earlier step failed.");
  } else if (!hasCredentials()) {
    skip("dossier", "Skipped: no LLM key on the server.");
  } else {
    await doStep("dossier", async () => {
      const pack = contextPack(dir, files);
      const c = facts.continuity;
      facts.continuity = {
        ...c,
        boundaryCommit: null,
        boundaryLabel: `the event start (${EVENT_START.slice(0, 10)})`,
        assessment: c.historyTruncated
          ? `Only the latest ${c.commitsSeen} commits were fetched; ${c.commitsDuringEvent} of them are from after the event start.`
          : `${c.commitsDuringEvent} of ${c.commitsSeen} commits are from after the event start; the first commit is from ${c.firstCommitDate?.slice(0, 10)}.`,
      };
      const d = await writeDossier({
        submission: { name: sub.project?.name, team: sub.team?.name, pitch: sub.project?.pitch, description: sub.project?.description, repoUrl: sub.repoUrl, liveUrl: sub.liveUrl ?? null, tracks: sub.tracks, demoTranscript: transcript?.text ?? null },
        dir,
        pack,
        facts,
        commit: commit.sha,
      });
      dossiers.save(projectId, d);
      const n = (s) => d.evidence.filter((e) => e.status === s).length;
      return `${d.evidence.length} claims checked: ${n("supported_by_code")} supported, ${n("unverified")} unverified, ${n("contradicted")} contradicted · read ${pack.included.length} files · ${d.reviewer.refsDropped} bad refs dropped`;
    });
  }

  // Live test: explore, write flows, run on laptop + phone. Independent of the clone.
  {
    const s = step("live");
    const token = mozarkToken();
    const live = await liveUrlFor(sub);
    if (!live) skip("live", "Skipped: no live app URL (none submitted, and the repo has no homepage).");
    else if (!token) skip("live", "Skipped: no cloud browser token on the server (MOZARK_TOKEN).");
    else if (!hasCredentials()) skip("live", "Skipped: writing the test steps needs an LLM key.");
    else {
      s.status = "running";
      s.startedAt = new Date().toISOString();
      s.detail = `Exploring ${live.url} (from ${live.from})…`;
      save();
      try {
        const discovery = await discoverSite({ target: live.url, token });
        s.detail = `Explored ${discovery.pages.length} pages. Writing the steps…`;
        save();
        const flows = await writeFlows({ target: live.url, transcript, dossier: dossiers.get(projectId), discovery });
        const out = liveDir(projectId);
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, "discovery.json"), JSON.stringify(discovery, null, 2));
        fs.writeFileSync(path.join(out, "flows.json"), JSON.stringify(flows, null, 2));
        const n = flows.phases.reduce((k, ph) => k + ph.steps.length, 0);
        s.detail = `Running ${n} steps on laptop and phone…`;
        save();
        const summary = await runLiveTest({ project: projectId, target: live.url, flows, outDir: out, token, flowsSource: "written automatically by the reviewer agent" });
        const words = summary.runs.map((r) => {
          const c = { passed: 0, failed: 0, missing: 0, blocked: 0 };
          for (const ph of r.phases ?? []) for (const x of ph.steps) c[x.status] = (c[x.status] ?? 0) + 1;
          return `${r.label}: ${r.outcome.status}${r.phases?.length ? ` (${c.passed} work${c.failed ? `, ${c.failed} broken` : ""}${c.missing ? `, ${c.missing} demo screens missing` : ""}${c.blocked ? `, ${c.blocked} need sign-in` : ""})` : ""}`;
        });
        Object.assign(s, { status: summary.runs.some((r) => r.outcome.status === "error") ? "failed" : "done", detail: `${live.url.replace("https://", "")} · ${words.join(" · ")}` });
      } catch (e) {
        Object.assign(s, { status: "failed", detail: String(e.message).slice(0, 240) });
      } finally {
        s.finishedAt = new Date().toISOString();
        save();
      }
    }
  }

  if (!hasCredentials()) skip("judges", "Skipped: no LLM key on the server.");
  else {
    await doStep("judges", async () => {
      // A rerun may replace screenshots while keeping the same number of steps.
      const r = await judge(projectId, { freshEvidence: true });
      const scored = r.reviews.filter((x) => x.status === "scored").length;
      return `${scored} of ${r.reviews.length} judges scored${r.panelHundredths != null ? ` · panel ${(r.panelHundredths / 100).toFixed(2)}` : ""}${dossiers.get(projectId) ? "" : " (without a dossier)"}`;
    });
  }
  state.finishedAt = new Date().toISOString();
  save();
  return state;
}
