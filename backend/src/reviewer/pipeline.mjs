/*
 * What happens after a submission. Five steps, each one running even if
 * another failed (a step that truly needs an earlier result says so and is
 * skipped). Steps run in parallel wherever nothing depends on it:
 *
 *   code ─┬─> contracts ─────────────────────────────────────────────────────┐
 *   demo ─┼─> fact-check ──────────────────────────────────────────────────────┼─> judges
 *         └─> live (explores from the start; writes steps once the demo is read) ┘
 *
 * The web app polls GET /api/projects/:id/pipeline.
 *
 *   code     Code review: fetch the public repo (never run), pin the commit,
 *            count the tests by reading files (not run: no sandbox yet)
 *   demo     Process the demo: keep our copy of the video, transcribe it,
 *            check the screenshots
 *   contracts Run the smart contract tests: Foundry projects compiled and tested with
 *            forge in a sandbox (reviewer/contracts.mjs); Hardhat tests counted only
 *   live     Test the live app on cloud browsers: explore, write the steps
 *            (demo replay + major flows, and a MetaMask wallet phase for dapps), run on
 *            a laptop and a phone, recorded
 *   dossier  Fact-check the claims: the reviewer agent checks the team's claims
 *            against the code; every reference is verified against the clone
 *   judges   The panel scores it with everything above
 *
 * Each step carries parts (sub-steps with their own status), a one-line detail
 * and facts (label/value pairs) for the summary panel.
 *
 * Everything a run produces is stored: records on Arkiv (store.mjs), files on 0G Storage
 * (zg/files.mjs). The clone,
 * the downloaded video and the live test's raw output are scratch work, removed when the
 * run ends.
 *
 * Queue: submissions are reviewed in order, REVIEW_CONCURRENCY at a time
 * (default 1). Each waiting project knows its place in line. On restart,
 * anything submitted but not finished is put back in the queue.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { countSteps, discoverSite, onRunnerLog, runLiveTest } from "../../tester/runner.mjs";
import { hasCredentials, MODEL } from "../llm.mjs";
import { fileInfo, filesOf, putFile, removeFile } from "../zg/files.mjs";
import { clearScratch, scratch } from "../datafiles.mjs";
import { contractTests, dossiers, judges as judgesStore, liveDir, liveFile, liveTests, pipelines, repoDir, submissions, transcripts, videos, workDir } from "../store.mjs";
import { demoTranscript, describeDuration } from "./demo.mjs";
import { IMAGE_REF, imageInfo, keepDemoVideo, probeInfo, reason, saveDemoVideo, shrinkVideo, uploadExists } from "./media.mjs";
import { canReadScreens, describeScreenshots, VISION_MODEL } from "./screens.mjs";
import { writeDossier } from "./dossier.mjs";
import { writeFlows } from "./flows.mjs";
import { findContractProjects, runContractTests } from "./contracts.mjs";
import { readCapped, safeFetch } from "./net.mjs";
import { syncProjectInBackground } from "../arkiv/records/sync.mjs";
import { GITHUB_REPO, cloneRepo, contextPack, countTests, historyFacts, inventory } from "./repo.mjs";

export const STEPS = [
  { id: "code", title: "Code review", about: "Fetch the repo, pin the commit, count the tests" },
  { id: "contracts", title: "Run the smart contract tests", about: "Compile and test the contracts with Foundry, sandboxed" },
  { id: "demo", title: "Process the demo", about: "Save the video, transcribe it, check the screenshots" },
  { id: "live", title: "Test the live app on cloud browsers", about: "Replay the demo, the main flows and (for dapps) a MetaMask wallet, on a laptop and a phone" },
  { id: "dossier", title: "Fact-check the claims", about: "Check what the team says against the code" },
  { id: "judges", title: "Judges score it", about: "Every judge on the panel scores it with all of the above" },
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

/**
 * The GitHub API's record of a repo link: { status, meta } (meta is null unless the
 * request succeeded), or null when the link isn't a GitHub repo.
 */
async function githubRepoMeta(repoUrl) {
  const m = GITHUB_REPO.exec(repoUrl ?? "");
  if (!m) return null;
  const res = await safeFetch(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, "")}`, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok) {
    res.body.resume?.();
    return { status: res.status, meta: null };
  }
  return { status: res.status, meta: JSON.parse((await readCapped(res, 512 * 1024)).toString("utf8")) };
}

/** Live URL: the team's optional field, else the GitHub repo's homepage. */
async function liveUrlFor(sub) {
  if (sub.liveUrl) return { url: sub.liveUrl, from: "the submission" };
  try {
    const home = (await githubRepoMeta(sub.repoUrl))?.meta?.homepage;
    return home && /^https:\/\//.test(home) ? { url: home, from: "the repo's GitHub homepage" } : null;
  } catch {
    return null;
  }
}

const wordCount = (text) => text.split(/\s+/).length;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
  try {
    return await executeSteps(projectId, judge);
  } finally {
    // Scratch only: everything worth keeping is on Arkiv / 0G by now.
    for (const d of [repoDir(projectId), liveDir(projectId), workDir(projectId), scratch("media", projectId), scratch("contracts", projectId)]) clearScratch(d);
  }
}

/**
 * The live test's output folder -> stored: smoke.json as the project's live test (Arkiv), and its
 * recordings (compressed if big) and step screenshots as 0G files live/<device>/<file>.
 * Files from an earlier run that this one didn't make are forgotten.
 */
async function keepLiveTest(projectId, out) {
  const smoke = JSON.parse(fs.readFileSync(path.join(out, "smoke.json"), "utf8"));
  const keep = new Set();
  const rels = (smoke.runs ?? []).flatMap((r) => [r.video?.file, ...(r.phases ?? []).flatMap((ph) => (ph.steps ?? []).map((st) => st.screenshot))]).filter(Boolean);
  for (const rel of [...new Set(rels)]) {
    const name = liveFile(rel);
    const full = path.join(out, rel);
    if (!name || !fs.existsSync(full)) continue;
    if (name.endsWith(".mp4")) {
      const small = await shrinkVideo(full, "mov");
      putFile(projectId, name, fs.readFileSync(small.file), { mime: "video/mp4", kind: "live-recording" });
    } else putFile(projectId, name, fs.readFileSync(full), { mime: "image/jpeg", kind: "live-screenshot" });
    keep.add(name);
  }
  for (const [name] of filesOf(projectId)) if (name.startsWith("live/") && !keep.has(name)) removeFile(projectId, name);
  liveTests.save(projectId, smoke);
  return smoke;
}

async function executeSteps(projectId, judge) {
  const sub = submissions.get(projectId);
  if (!sub) throw Object.assign(new Error("No such submitted project."), { status: 404 });
  const state = { projectId, startedAt: new Date().toISOString(), finishedAt: null, steps: STEPS.map((s) => ({ ...s, status: "queued", parts: [], facts: [] })) };
  let lastSave = 0;
  const save = (force = true) => {
    // Progress lines can arrive many times a second: write at most twice a second unless it matters.
    if (!force && Date.now() - lastSave < 500) return;
    lastSave = Date.now();
    pipelines.save(projectId, state);
  };
  const step = (id) => state.steps.find((s) => s.id === id);
  save();

  /** Start a step with its parts listed (all waiting). */
  const begin = (id, parts) => {
    const s = step(id);
    Object.assign(s, { status: "running", detail: "Starting…", startedAt: new Date().toISOString(), parts: parts.map(([pid, label]) => ({ id: pid, label, status: "queued" })) });
    save();
    return s;
  };
  /**
   * Update one part. While a part runs, its detail is the live "what's happening now",
   * and the step's own line follows it.
   */
  const part = (s, pid, status, detail, { quiet = false } = {}) => {
    const p = s.parts.find((x) => x.id === pid);
    if (!p) return;
    if (status === "running" && p.status !== "running") p.startedAt = new Date().toISOString();
    Object.assign(p, { status, ...(detail !== undefined ? { detail: String(detail).slice(0, 240) } : {}) });
    if (status !== "running") p.finishedAt = new Date().toISOString();
    // The step's own line: the live action, or, when parts run side by side, how many.
    const live = s.parts.filter((x) => x.status === "running");
    if (live.length > 1) s.detail = s.id === "judges" ? `${live.length} judges scoring at once` : `${live.map((x) => x.label.split(" ")[0]).join(" and ")} running at once`;
    else if (status === "running") s.detail = detail ? `${p.label}: ${String(detail).slice(0, 160)}` : `${p.label}…`;
    save(!quiet);
  };
  /** Finish a step. */
  const end = (s, status, detail, facts = []) => {
    for (const p of s.parts) if (p.status === "queued" || p.status === "running") Object.assign(p, { status: "skipped", detail: p.detail ?? "Not reached." });
    Object.assign(s, { status, detail: String(detail ?? "").slice(0, 300), facts: facts.filter((f) => f && f.value !== undefined && f.value !== null && f.value !== ""), finishedAt: new Date().toISOString() });
    save();
  };
  const skipStep = (id, why) => {
    const s = step(id);
    Object.assign(s, { status: "skipped", detail: why, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
    save();
  };
  const mb = (n) => `${Math.max(1, Math.round(n / 1048576))} MB`;

  const dir = repoDir(projectId);
  let commit = null;
  let files = null;
  const facts = {};
  let transcript = null; // what the demo shows, as text: the video's speech, or the screenshots described

  /** 1. Code review */
  const codeStep = async () => {
    const s = begin("code", [
      ["check", "Check the repo on GitHub"],
      ["clone", "Clone the code (never run)"],
      ["pin", "Pin the exact commit"],
      ["history", "Read the commit history"],
      ["files", "List the files"],
      ["tests", "Count the tests"],
    ]);
    let cur = "check";
    let meta = null;
    try {
      const m = GITHUB_REPO.exec(sub.repoUrl ?? "");
      if (!m) throw new Error("Only public https://github.com/<owner>/<repo> links can be reviewed.");
      part(s, "check", "running", `Looking up ${m[1]}/${m[2]}`);
      try {
        const gh = await githubRepoMeta(sub.repoUrl);
        if (gh.status === 404) throw Object.assign(new Error("The repository isn't public or doesn't exist."), { fatal: true });
        meta = gh.meta;
      } catch (e) {
        if (e.fatal) throw e;
      }
      part(s, "check", "done", meta ? `Public · ${meta.language ?? "mixed languages"} · ${meta.size ? `${Math.round(meta.size / 1024)} MB` : "size unknown"} · default branch ${meta.default_branch}` : "GitHub's details weren't available; cloning anyway");
      cur = "clone";
      part(s, "clone", "running", "Shallow clone, hooks and submodules off, big files skipped");
      commit = await cloneRepo(sub.repoUrl, dir);
      part(s, "clone", "done", commit.url.replace("https://", ""));
      cur = "pin";
      part(s, "pin", "running");
      part(s, "pin", "done", `${commit.sha.slice(0, 7)} · committed ${commit.committedAt.slice(0, 10)}`);
      cur = "history";
      part(s, "history", "running", `Counting commits since ${EVENT_START.slice(0, 10)}`);
      facts.continuity = await historyFacts(dir, EVENT_START);
      const c = facts.continuity;
      part(s, "history", "done", `${c.commitsDuringEvent} of ${c.commitsSeen}${c.historyTruncated ? "+" : ""} commits made since the event began`);
      cur = "files";
      part(s, "files", "running");
      files = await inventory(dir);
      part(s, "files", "done", `${files.length} files`);
      cur = "tests";
      part(s, "tests", "running", "Reading test files (it(), test(), function test*, def test_)");
      const t = countTests(dir, files);
      const kinds = [t.jsCases && `${t.jsCases} JS/TS`, t.solTests && `${t.solTests} Solidity`, t.pyTests && `${t.pyTests} Python`].filter(Boolean);
      facts.tests = {
        status: "not_run",
        claimed: "",
        found: { vitestFiles: t.jsFiles, vitestCases: t.jsCases, forgeFiles: t.solFiles, forgeTests: t.solTests, pyFiles: t.pyFiles, pyTests: t.pyTests },
        method: "Counted it()/test() in *.test/*.spec files, function test* in *.t.sol, def test_ in Python tests. Read only.",
        note: "Counted here. Foundry (Solidity) tests are run in the sandboxed contract-test step; JavaScript and Python tests are not run.",
      };
      const total = t.jsCases + t.solTests + t.pyTests;
      part(s, "tests", "done", `${kinds.join(" · ") || "No tests found"} · counted, not run`);
      end(s, "done", `${commit.sha.slice(0, 7)} · ${total} tests found · ${files.length} files`, [
        { label: "Repository", value: commit.url.replace("https://github.com/", "") },
        { label: "Main language", value: meta?.language },
        { label: "Commit", value: commit.sha.slice(0, 7) },
        { label: "Last commit", value: commit.committedAt.slice(0, 10) },
        { label: "Commits since the event began", value: `${c.commitsDuringEvent} of ${c.commitsSeen}${c.historyTruncated ? "+" : ""}` },
        { label: "Tests found", value: `${total}${kinds.length ? ` (${kinds.join(", ")})` : ""}` },
        { label: "Files", value: files.length },
      ]);
    } catch (e) {
      part(s, cur, "failed", reason(e));
      for (const p of s.parts) if (p.status === "queued") Object.assign(p, { status: "skipped", detail: "Needs the repository." });
      commit = null;
      end(s, "failed", reason(e));
    }
  };

  /** 2. Process the demo: video and screenshots */
  const demoStep = async () => {
    const shots = sub.demoImages ?? [];
    if (!sub.demoVideoUrl && !shots.length) skipStep("demo", "No demo video or screenshots were submitted.");
    else {
      const plan = [];
      if (sub.demoVideoUrl) plan.push(["download", "Download our copy of the video"], ["analyse", "Analyse the video"], ["transcribe", "Transcribe the speech"]);
      if (shots.length) plan.push(["images", "Check the screenshots"], ["vision", "Read the screenshots (vision model)"]);
      const s = begin("demo", plan);
      let video = null;
      let info = null;
      let screens = null;
      // A replay with the same demo link reuses our saved copy and its transcript: the video
      // isn't downloaded, analysed or transcribed again. A new link starts from scratch.
      const priorVideo = videos.get(projectId);
      const priorText = transcripts.get(projectId);
      const reusable =
        sub.demoVideoUrl &&
        priorVideo?.ext &&
        !priorVideo.error &&
        (priorVideo.videoUrl ?? sub.demoVideoUrl) === sub.demoVideoUrl &&
        priorText?.text &&
        priorText.videoUrl === sub.demoVideoUrl &&
        fileInfo(projectId, `demo.${priorVideo.ext}`);
      if (reusable) {
        video = { ...priorVideo };
        info = priorVideo.width ? { seconds: priorVideo.seconds, width: priorVideo.width, height: priorVideo.height, audio: priorVideo.audio } : null;
        transcript = priorText;
        part(s, "download", "done", `Reused our saved copy · ${mb(priorVideo.bytes)} (same link, not downloaded again)`);
        part(s, "analyse", "done", info ? `${describeDuration(info.seconds)} · ${info.width}×${info.height} · ${info.audio ? "has sound" : "no sound"} (from the first run)` : `${describeDuration(priorVideo.seconds)} (from the first run)`);
        part(s, "transcribe", "done", `Reused the transcript · ${wordCount(priorText.text)} words`);
      } else if (sub.demoVideoUrl) {
        part(s, "download", "running");
        try {
          video = await saveDemoVideo(sub.demoVideoUrl, scratch("media", projectId), { onProgress: (m) => part(s, "download", "running", m, { quiet: true }) });
          part(s, "download", "running", "Storing our copy on 0G Storage", { quiet: true });
          video = await keepDemoVideo(projectId, video);
          videos.save(projectId, { ext: video.ext, bytes: video.bytes, seconds: video.seconds, source: video.source, videoUrl: sub.demoVideoUrl, savedAt: new Date().toISOString() });
          part(s, "download", "done", `${mb(video.bytes)} · ${video.source}`);
        } catch (e) {
          videos.save(projectId, { error: reason(e).slice(0, 240), skipped: Boolean(e.skip), savedAt: new Date().toISOString() });
          part(s, "download", e.skip ? "skipped" : "failed", reason(e));
        }
        if (video) {
          part(s, "analyse", "running", "Reading length, picture size and sound");
          try {
            info = await probeInfo(video.file, video.demuxer);
            // Kept with the copy, so a replay can show it without the file.
            videos.save(projectId, { ...videos.get(projectId), width: info.width ?? null, height: info.height ?? null, audio: Boolean(info.audio) });
            part(s, "analyse", "done", `${describeDuration(info.seconds)} · ${info.width && info.height ? `${info.width}×${info.height}` : "unknown size"} · ${info.audio ? "has sound" : "no sound"}`);
          } catch (e) {
            part(s, "analyse", "failed", reason(e));
          }
        } else part(s, "analyse", "skipped", "No copy of the video to analyse.");
        part(s, "transcribe", "running", video ? "Sending the audio to the transcription model" : "Looking for captions");
        try {
          transcript = await demoTranscript(sub.demoVideoUrl, { video, workDir: workDir(projectId) });
          transcripts.save(projectId, { ...transcript, videoUrl: sub.demoVideoUrl, at: new Date().toISOString() });
          part(s, "transcribe", "done", `${wordCount(transcript.text)} words · ${transcript.source}`);
        } catch (e) {
          part(s, "transcribe", e.skip ? "skipped" : "failed", reason(e));
        } finally {
          fs.rmSync(workDir(projectId), { recursive: true, force: true });
        }
      }
      if (shots.length) {
        part(s, "images", "running", `Opening ${plural(shots.length, "screenshot")}`);
        const filesIn = shots.map((r) => IMAGE_REF.exec(String(r))?.[1]).filter((f) => f && uploadExists(f));
        const sizes = [];
        for (const f of filesIn) sizes.push(await imageInfo(f).catch(() => null));
        const ok = sizes.filter(Boolean);
        const missing = shots.length - filesIn.length;
        part(s, "images", missing ? "failed" : "done", `${ok.length} readable${ok[0]?.width ? ` · ${[...new Set(ok.map((x) => `${x.width}×${x.height}`))].slice(0, 3).join(", ")}` : ""}${missing ? ` · ${missing} missing on the server` : ""}`);
        if (!filesIn.length) part(s, "vision", "skipped", "No screenshots to read.");
        else if (!canReadScreens()) part(s, "vision", "skipped", "Reading screenshots needs an OpenAI key on the server.");
        else {
          part(s, "vision", "running", `${VISION_MODEL} is looking at ${plural(filesIn.length, "screen")}`);
          try {
            screens = await describeScreenshots(filesIn);
            part(s, "vision", "done", `${screens.lines.length} screens described`);
            if (!transcript) {
              // No video speech: the screenshots stand in as "what the demo shows".
              transcript = { source: `screenshots read by ${VISION_MODEL}`, text: screens.text, seconds: null };
              transcripts.save(projectId, { ...transcript, at: new Date().toISOString() });
            }
          } catch (e) {
            part(s, "vision", e.skip ? "skipped" : "failed", reason(e));
          }
        }
      }
      const failed = s.parts.some((x) => x.status === "failed");
      const out = [video && `${describeDuration(video.seconds)} video saved`, transcript && !screens && `${wordCount(transcript.text)}-word transcript`, shots.length && `${plural(shots.length, "screenshot")}${screens ? " read" : ""}`].filter(Boolean);
      end(s, failed ? "failed" : "done", out.join(" · ") || s.parts.find((x) => x.status === "failed")?.detail || "Nothing could be read.", [
        { label: "Video", value: video ? `${describeDuration(video.seconds)}, ${mb(video.bytes)}` : sub.demoVideoUrl ? "No copy" : null },
        { label: "Picture", value: info?.width ? `${info.width}×${info.height}${info.audio ? ", with sound" : ", no sound"}` : null },
        { label: "Source", value: video?.source },
        { label: "Transcript", value: sub.demoVideoUrl ? (transcript && !screens ? `${wordCount(transcript.text)} words` : "None") : null },
        { label: "Screenshots", value: shots.length ? `${shots.length}${screens ? `, ${screens.lines.length} described` : ""}` : null },
      ]);
    }
  };

  /** 3. Live app on cloud browsers (explores right away; writes steps once the demo is read) */
  const liveStep = async () => {
    const token = mozarkToken();
    const live = await liveUrlFor(sub);
    if (!live) skipStep("live", "No live app: none was submitted and the repo has no homepage.");
    else if (!token) skipStep("live", "The cloud browser token isn't set on the server (MOZARK_TOKEN).");
    else if (!hasCredentials()) skipStep("live", "Writing the test steps needs an LLM key on the server.");
    else {
      const s = begin("live", [
        ["connect", "Sign in to the Mozark cloud"],
        ["explore", "Explore the site"],
        ["write", "Write the test steps"],
        ["laptop", "Laptop browser"],
        ["phone", "Phone browser"],
        ["save", "Save the recordings"],
      ]);
      const host = live.url.replace("https://", "");
      let cur = "connect";
      const stop = onRunnerLog((line) => {
        const m = /^\[(\w+)\] (.*)$/.exec(line);
        if (!m) return;
        const [, who, what] = m;
        if (who === "explore") {
          if (/connected/.test(what)) {
            part(s, "connect", "done", "Signed in; a cloud browser is up");
            cur = "explore";
            part(s, "explore", "running", `Reading the home page of ${host}`);
          } else if (/^reading /.test(what)) part(s, "explore", "running", `Reading ${what.slice(8)}`, { quiet: true });
          return;
        }
        if (who !== "laptop" && who !== "phone") return;
        const nice = what
          .replace(/^connecting to Mozark…$/, "Starting a cloud browser…")
          .replace(/^loading (.*)$/, (_, u) => `Loading ${u.replace("https://", "")}`)
          .replace(/^(d|f|w)(\d+) (\w+)\s+(.*)$/, (_, k, n, st, t) => `${k === "d" ? "Demo replay" : k === "w" ? "Wallet" : "Main flow"} ${n} · ${t}: ${st === "passed" ? "works" : st === "blocked" ? "needs a device or sign-in" : st}`)
          .replace(/^wallet (.*)$/, (_, m) => `MetaMask test wallet ${m}`)
          .replace(/^cloud browser problem.*$/, "Cloud browser problem; retrying once in a fresh session");
        cur = who;
        part(s, who, "running", nice, { quiet: true });
      });
      try {
        part(s, "connect", "running", "Using the Mozark CDP hub");
        const discovery = await discoverSite({ target: live.url, token });
        part(s, "explore", "done", `${plural(discovery.pages.length, "page")} at ${host} (from ${live.from})`);
        cur = "write";
        if (!demoReady.settled) part(s, "write", "running", "Waiting for the demo to be read (it's being processed in parallel)…");
        await demoReady;
        part(s, "write", "running", transcript ? `Reading ${transcript.source.startsWith("screenshots") ? "the screenshots" : "the transcript"} and what the explorer found` : "No demo to replay: writing the main flows from what the explorer found");
        const flows = await writeFlows({ target: live.url, transcript, dossier: null, discovery });
        const out = liveDir(projectId);
        fs.mkdirSync(out, { recursive: true });
        fs.writeFileSync(path.join(out, "discovery.json"), JSON.stringify(discovery, null, 2));
        fs.writeFileSync(path.join(out, "flows.json"), JSON.stringify(flows, null, 2));
        const count = (id) => flows.phases.find((ph) => ph.id === id)?.steps.length ?? 0;
        part(s, "write", "done", `${count("demo")} demo replay steps · ${count("features")} main flows${count("wallet") ? ` · ${count("wallet")} wallet steps (MetaMask test wallet)` : ""}`);
        cur = "laptop";
        // Laptop and phone run at the same time.
        part(s, "laptop", "running", "Starting a cloud browser…");
        part(s, "phone", "running", "Starting a cloud browser…");
        const summary = await runLiveTest({ project: projectId, target: live.url, flows, outDir: out, token, flowsSource: "written automatically by the reviewer agent" });
        const words = {};
        for (const dev of ["laptop", "phone"]) {
          const r = summary.runs.find((x) => x.device === dev);
          if (!r) {
            part(s, dev, "skipped", "Not run.");
            continue;
          }
          const c = countSteps((r.phases ?? []).flatMap((ph) => ph.steps));
          words[dev] = `${c.passed} work${c.failed ? ` · ${c.failed} broken` : ""}${c.missing ? ` · ${c.missing} demo screens missing` : ""}${c.blocked ? ` · ${c.blocked} can't run in a browser` : ""}`;
          part(s, dev, r.outcome.status === "error" ? "failed" : "done", r.outcome.status === "error" ? (r.error ?? "The cloud browser failed.") : words[dev]);
        }
        part(s, "save", "running", "Storing the report on Arkiv, recordings and screenshots on 0G Storage");
        await keepLiveTest(projectId, out);
        const vids = summary.runs.filter((r) => r.video).map((r) => `${r.label.toLowerCase()} ${Math.round(r.video.seconds)} s`);
        part(s, "save", "done", vids.length ? `Recordings: ${vids.join(", ")} · screenshot for every step · on 0G Storage` : "No recordings");
        const failed = s.parts.some((x) => x.status === "failed");
        end(s, failed ? "failed" : "done", `${host} · laptop: ${words.laptop ?? "—"} · phone: ${words.phone ?? "—"}`, [
          { label: "Live app", value: host },
          { label: "Found from", value: live.from },
          { label: "Pages explored", value: discovery.pages.length },
          { label: "Steps written", value: `${count("demo")} demo + ${count("features")} flows${count("wallet") ? ` + ${count("wallet")} wallet` : ""}` },
          { label: "Wallet", value: summary.runs.some((r) => r.wallet) ? (summary.runs.some((r) => r.wallet?.connected) ? "MetaMask test wallet connected" : "MetaMask test wallet: didn't connect") : null },
          { label: "Laptop", value: words.laptop },
          { label: "Phone", value: words.phone },
        ]);
      } catch (e) {
        part(s, cur, "failed", reason(e));
        end(s, "failed", reason(e));
        // Whatever the run wrote before it failed is still evidence for the judges.
        if (cur !== "save" && fs.existsSync(path.join(liveDir(projectId), "smoke.json"))) await keepLiveTest(projectId, liveDir(projectId)).catch(() => {});
      } finally {
        stop();
      }
    }
  };

  /** 2b. Run the smart contract tests (needs the code; works on its own copy) */
  const contractStep = async () => {
    if (!commit) return skipStep("contracts", "Needs the code: the code review couldn't fetch the repository.");
    const found = findContractProjects(files ?? []);
    if (!found.foundry.length && !found.hardhat.length) {
      contractTests.save(projectId, { ranAt: new Date().toISOString(), commit: commit.sha, status: "none", projects: [], hardhat: [] });
      return skipStep("contracts", "No smart contract project in the repo (no foundry.toml or hardhat.config).");
    }
    const s = begin("contracts", [
      ["find", "Find the contract projects"],
      ["deps", "Fetch the dependencies"],
      ["build", "Compile (forge build)"],
      ["test", "Run the tests (forge test)"],
      ["save", "Save the results"],
    ]);
    const where = [...found.foundry.map((r) => `Foundry at ${r === "." ? "the root" : r}`), ...found.hardhat.map((h) => `Hardhat at ${h.root === "." ? "the root" : h.root}`)];
    part(s, "find", "done", where.join(" · "));
    try {
      let cur = null;
      const report = await runContractTests({
        projectId,
        repoDir: dir,
        files,
        commit: commit.sha,
        onPart: (id, st, d) => {
          if (cur && cur !== id && s.parts.find((p) => p.id === cur)?.status === "running") part(s, cur, "done");
          cur = id;
          part(s, id, st, d, { quiet: true });
        },
      });
      const projects = report.projects ?? [];
      const deps = projects.flatMap((p) => p.dependencies ?? []);
      const badDeps = deps.filter((d) => !d.ok);
      if (!found.foundry.length) {
        for (const id of ["deps", "build", "test"]) part(s, id, "skipped", "Hardhat tests are JavaScript with full Node access: they need a container sandbox, not built yet.");
      } else if (report.status === "error" && !projects.length) {
        part(s, "deps", "skipped", report.error);
      } else {
        part(s, "deps", badDeps.length ? "failed" : "done", deps.length ? `${deps.length - badDeps.length} of ${deps.length} fetched${badDeps.length ? ` · missing: ${badDeps.map((d) => d.name).slice(0, 3).join(", ")}` : ""}` : "None needed");
        const built = projects.filter((p) => p.build?.ok);
        part(s, "build", built.length === projects.length ? "done" : "failed", built.length === projects.length ? `Compiled${built[0]?.build?.seconds != null ? ` in ${built.map((p) => p.build.seconds).reduce((a, b) => a + b, 0).toFixed(1)} s` : ""}` : (projects.find((p) => !p.build?.ok)?.build?.error ?? "Didn't compile").split("\n").filter(Boolean).slice(-1)[0]);
        const t = report.totals ?? { passed: 0, failed: 0, skipped: 0 };
        const ran = t.passed + t.failed;
        const err = projects.find((p) => p.error)?.error;
        part(s, "test", err && !ran ? "failed" : built.length ? "done" : "skipped", ran ? `${t.passed} passed · ${t.failed} failed${t.skipped ? ` · ${t.skipped} skipped` : ""}${t.fuzz ? ` · ${t.fuzz} fuzz` : ""}` : err ?? (built.length ? "No tests found" : "Needs a successful compile."));
      }
      part(s, "save", "running");
      contractTests.save(projectId, report);
      part(s, "save", "done", "Stored with the project");
      const t = report.totals ?? { passed: 0, failed: 0 };
      const ran = t.passed + t.failed;
      const summary = !found.foundry.length
        ? `Hardhat project: ${found.hardhat.reduce((n, h) => n + h.testFiles, 0)} JS test files found, not run`
        : report.status === "error" && !projects.length
          ? report.error
          : ran
            ? `${t.passed} of ${ran} contract tests pass${t.failed ? ` · ${t.failed} fail` : ""}`
            : projects.some((p) => p.build && !p.build.ok)
              ? "The contracts don't compile"
              : "No Foundry tests found";
      const failed = s.parts.some((p) => p.status === "failed");
      end(s, !found.foundry.length || (report.status === "error" && !projects.length) ? "skipped" : failed ? "failed" : "done", summary, [
        { label: "Tool", value: report.tool },
        { label: "Projects", value: where.join(", ") },
        { label: "Passed", value: ran ? t.passed : null },
        { label: "Failed", value: ran ? t.failed : null },
        { label: "Fuzz / invariant tests", value: t.fuzz || t.invariant ? `${t.fuzz ?? 0} / ${t.invariant ?? 0}` : null },
        { label: "Sandbox", value: report.sandbox ? (report.sandbox.user.startsWith("nobody") ? "Locked down, as nobody" : "Locked down") : null },
      ]);
    } catch (e) {
      for (const p of s.parts) if (p.status === "running") Object.assign(p, { status: "failed", detail: reason(e) });
      end(s, "failed", reason(e));
    }
  };

  /** 4. Fact-check the claims (needs code + demo) */
  const factStep = async () => {
    if (!commit) skipStep("dossier", "Needs the code: the code review couldn't fetch the repository.");
    else if (!hasCredentials()) skipStep("dossier", "Needs an LLM key on the server.");
    else {
      const s = begin("dossier", [
        ["pack", "Gather the code for the reviewer"],
        ["ask", "Reviewer agent reads the code and the claims"],
        ["verify", "Verify every cited line exists"],
        ["save", "Save the fact-check"],
      ]);
      let cur = "pack";
      try {
        part(s, "pack", "running", "Picking the files that matter, with line numbers");
        const pack = contextPack(dir, files);
        part(s, "pack", "done", `${pack.included.length} files${pack.notIncluded ? ` (${pack.notIncluded} more left out: size limit)` : ""}`);
        cur = "ask";
        part(s, "ask", "running", `${MODEL} is checking the description${transcript ? `, the ${transcript.source.startsWith("screenshots") ? "screenshots" : "demo transcript"}` : ""} and the history against the code`);
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
          onStage: (st) => {
            if (st !== "verify") return;
            part(s, "ask", "done", "Claims listed with the lines that back them");
            cur = "verify";
            part(s, "verify", "running", "Opening every cited file and line in the clone");
          },
        });
        part(s, "verify", "done", `${d.reviewer.refsChecked ?? "All"} references checked · ${d.reviewer.refsDropped} pointed nowhere and were dropped`);
        cur = "save";
        part(s, "save", "running");
        dossiers.save(projectId, d);
        const n = (st) => d.evidence.filter((e) => e.status === st).length;
        part(s, "save", "done", `${d.evidence.length} claims: ${n("supported_by_code")} supported, ${n("unverified")} unverified, ${n("contradicted")} contradicted`);
        end(s, "done", `${d.evidence.length} claims checked · ${n("supported_by_code")} supported · ${n("contradicted")} contradicted`, [
          { label: "Claims checked", value: d.evidence.length },
          { label: "Supported by code", value: n("supported_by_code") },
          { label: "Unverified", value: n("unverified") },
          { label: "Contradicted", value: n("contradicted") },
          { label: "Files read", value: pack.included.length },
          { label: "Bad references dropped", value: d.reviewer.refsDropped },
        ]);
      } catch (e) {
        part(s, cur, "failed", reason(e));
        end(s, "failed", reason(e));
      }
    }
  };

  /** 5. Judges (need everything above) */
  const judgeStep = async () => {
    const panel = judgesStore.list();
    if (!hasCredentials()) skipStep("judges", "Needs an LLM key on the server.");
    else if (!panel.length) skipStep("judges", "There are no judges on the panel yet. Add one on /judge.");
    else {
      const s = begin("judges", panel.map((j) => [j.id, j.name]));
      // Each judge's lane shows who they are and what they weigh most.
      for (const j of panel) Object.assign(s.parts.find((p) => p.id === j.id), { role: j.title ?? "", focus: focusOf(j) });
      const ct = contractTests.get(projectId);
      const had = [dossiers.get(projectId) && "fact-check", liveTests.get(projectId) && "live test", ct?.totals && ct.totals.passed + ct.totals.failed > 0 && "contract tests", transcript && "demo", commit && "code review"].filter(Boolean);
      for (const j of panel) part(s, j.id, "running", `Reading the ${had.join(", ") || "submission"}`);
      try {
        const r = await judge(projectId, {
          freshEvidence: true,
          log: (m) => (s.detail = `Gathering evidence: ${String(m).slice(0, 140)}`),
          onEvent: (e) => {
            if (e.type !== "judge") return;
            part(s, e.judgeId, e.status === "scored" ? "done" : "failed", e.status === "scored" ? `Scored ${(e.overallHundredths / 100).toFixed(2)} / 100` : `Couldn't score (${e.status})`);
          },
        });
        for (const x of r.reviews) {
          const id = x.judge?.id ?? x.judgeId;
          part(s, id, x.status === "scored" ? "done" : "failed", x.status === "scored" ? `Scored ${(x.overallHundredths / 100).toFixed(2)} / 100${x.review?.headline ? ` · "${x.review.headline}"` : ""}` : `Couldn't score: ${x.detail ?? x.status}`);
        }
        const scored = r.reviews.filter((x) => x.status === "scored").length;
        const panelScore = r.panelHundredths != null ? (r.panelHundredths / 100).toFixed(2) : null;
        // Whoever scored counts: the step is done if any judge scored; a judge who couldn't gets their own cross.
        end(s, scored ? "done" : "failed", `${scored} of ${plural(r.reviews.length, "judge")} scored${panelScore ? ` · panel ${panelScore}` : ""}${dossiers.get(projectId) ? "" : " · without a fact-check"}`, [
          { label: "Panel average", value: panelScore ? `${panelScore} / 100` : null },
          ...r.reviews.map((x) => ({ label: x.judge?.name ?? x.judgeId, value: x.status === "scored" ? (x.overallHundredths / 100).toFixed(2) : "didn't score" })),
          { label: "Evidence they had", value: had.join(", ") || "the submission only" },
        ]);
      } catch (e) {
        for (const p of s.parts) if (p.status === "running") Object.assign(p, { status: "failed", detail: "Didn't score." });
        end(s, "failed", reason(e));
      }
    }
  };

  /*
   * Parallel where nothing depends on it, so results come sooner:
   *   code review, demo and the live site's exploring start together;
   *   writing the live test waits only for the demo; the fact-check waits for code + demo;
   *   live test and fact-check then run side by side; the judges go when both are in.
   */
  const demoReady = demoStep();
  // Handle both outcomes: a bare .then() would leave an unhandled rejection if the demo step threw.
  const markSettled = () => (demoReady.settled = true);
  demoReady.then(markSettled, markSettled);
  const codeReady = codeStep();
  const liveDone = liveStep();
  const factDone = Promise.all([codeReady, demoReady]).then(factStep);
  // Contract tests work on their own copy of the clone, so they run beside the fact-check.
  const contractsDone = codeReady.then(contractStep);
  await Promise.all([liveDone, factDone, contractsDone]);
  await judgeStep();

  state.finishedAt = new Date().toISOString();
  save();
  syncProjectInBackground(projectId); // pipeline, dossier, transcript, live test on Arkiv
  return state;
}

/** A judge's three heaviest criteria, like "Code quality 23% · SDLC 18% · Feasibility 18%". */
function focusOf(j) {
  return Object.entries(j.weights ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, w]) => `${CRITERIA_LABEL[k] ?? k} ${w}%`)
    .join(" · ");
}

const CRITERIA_LABEL = {
  product_journey: "Product journey",
  real_world_value: "Real-world value",
  ui_ux: "UI/UX",
  code_quality: "Code quality",
  sdlc: "SDLC",
  feasibility: "Feasibility",
  scalability: "Scalability",
  business_model: "Business model",
  brownie_points: "Brownie points",
};
