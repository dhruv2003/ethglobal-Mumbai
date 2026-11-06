/*
 * Builds src/data/*.json from scripts/story.mjs (and the real Go Health Me run in scripts/seed).
 * Every hash, id and timestamp is derived here, so the project page, the fight, the bets
 * and the proofs always agree. Run: npm run data
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BETS, CROWD, EVENT, FIGHTS, JUDGES, PROJECTS } from "./story.mjs";
import { CRITERIA as ROUNDS, healthThousandths, pointsKept, scoreHundredths } from "../src/fight/score.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../src/data");
const PUB = path.resolve(here, "../public/media");
const seed = (f) => JSON.parse(fs.readFileSync(path.join(here, "seed", f), "utf8"));

/* ---------- deterministic ids ---------- */
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const h32 = (s) => `0x${sha(s)}`;
const addr = (s) => `0x${sha(`addr:${s}`).slice(0, 40)}`;
const uuid = (s) => {
  const x = sha(`uuid:${s}`);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
};
const iso = (base, sec) => new Date(Date.parse(base) + Math.round(sec * 1000)).toISOString();
const two = (h) => (h / 100).toFixed(2);

const ZG_PROVIDER = "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250";
const MODEL = "0gm-1.0-35b-a3b";
const PUBLISHER = "0x429C0C8C8cDBf6b24D02075D808088983988B515";
const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
const arkivLink = (k) => `${ARKIV_EXPLORER}/entity-explorer?q=${encodeURIComponent(`$key = key(${k})`)}`;
const zgTx = (h) => `https://chainscan-galileo.0g.ai/tx/${h}`;
const zgFile = (seq) => `https://storagescan-galileo.0g.ai/submission/${seq}`;

const judgeSeed = seed("judges.json");
const criteria = seed("criteria.json");
const JKEYS = ["priya", "marcus", "ana"];
const judgeOf = (k) => judgeSeed.find((j) => j.id === JUDGES[k].id);

/* ---------- 0G storage ledger: every file and record gets a root hash and a tx ---------- */
const storage = [];
let txSeq = 171204;
function store(scope, name, kind, { size, mime, at }) {
  const key = `${scope}/${name}`;
  const rootHash = h32(`root:${key}`);
  const txHash = h32(`zgtx:${key}`);
  const seq = txSeq++;
  const rec = { key, kind, id: key, name, scope, size, mime, sha256: sha(`file:${key}`), rootHash, txHash, txSeq: seq, uploadedAt: at, history: [rootHash], links: { tx: zgTx(txHash), file: zgFile(seq) } };
  storage.push(rec);
  return rec;
}

/* ---------- SVG screens for projects without real screenshots ---------- */
const COLORS = { qagent: "#6f4cff", vaultline: "#0e7c66", splitsafe: "#ff5c93", "kirana-credit": "#f59f00", metromint: "#2f6bff" };
function screenSvg({ name, title, color, status, device, note }) {
  const w = device === "phone" ? 390 : 1440;
  const h = device === "phone" ? 844 : 900;
  const pad = device === "phone" ? 22 : 64;
  const big = device === "phone" ? 30 : 46;
  const bad = status === "failed" || status === "missing";
  const overflow = note === "overflow";
  const cardW = overflow ? w + 140 : w - pad * 2;
  const blocks = [0, 1, 2]
    .map((i) => `<rect x="${pad}" y="${h * 0.42 + i * (device === "phone" ? 92 : 110)}" width="${cardW}" height="${device === "phone" ? 76 : 90}" rx="16" fill="#ffffff" stroke="#e7e2da"/><rect x="${pad + 20}" y="${h * 0.42 + i * (device === "phone" ? 92 : 110) + 22}" width="${(cardW - 40) * (0.5 - i * 0.1)}" height="14" rx="7" fill="#d9d3ca"/><rect x="${pad + 20}" y="${h * 0.42 + i * (device === "phone" ? 92 : 110) + 46}" width="${(cardW - 40) * 0.3}" height="10" rx="5" fill="#ebe6df"/>`)
    .join("");
  const banner = bad
    ? `<rect x="0" y="${h * 0.2}" width="${w}" height="${h * 0.12}" fill="#ffe3e3"/><text x="${pad}" y="${h * 0.27}" font-family="Inter,system-ui,sans-serif" font-size="${big * 0.6}" font-weight="700" fill="#c92a2a">${note && note !== "overflow" ? note : "Something went wrong"}</text>`
    : `<text x="${pad}" y="${h * 0.3}" font-family="Inter,system-ui,sans-serif" font-size="${big}" font-weight="800" fill="#17141f">${title}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fbf8f3"/><rect width="${w}" height="${device === "phone" ? 72 : 76}" fill="${color}"/><text x="${pad}" y="${device === "phone" ? 46 : 48}" font-family="Inter,system-ui,sans-serif" font-size="${device === "phone" ? 22 : 24}" font-weight="800" fill="#fff">${name}</text>${banner}${blocks}<rect x="${pad}" y="${h - (device === "phone" ? 110 : 120)}" width="${overflow ? w + 60 : device === "phone" ? w - pad * 2 : 260}" height="${device === "phone" ? 56 : 56}" rx="28" fill="${bad ? "#adb5bd" : color}"/></svg>\n`;
}
function writeSvg(rel, svg) {
  const file = path.join(PUB, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg);
  return `/media/${rel}`;
}

/* ---------- per project ---------- */
const WEIGHT = Object.fromEntries(JKEYS.map((k) => [k, judgeOf(k).weights]));
const clamp = (n) => Math.max(5, Math.min(98, Math.round(n)));

/* The device cloud: one Windows laptop and two real phones. pace: how much slower a run is than the laptop's. */
const DEVICES = [
  { device: "laptop", label: "Windows", os: "windows", model: "Windows 11 laptop", browser: "Chrome 131", viewport: { width: 1440, height: 900 }, media: "laptop", pace: 1 },
  { device: "android", label: "Android", os: "android", model: "Pixel 8", browser: "Chrome 131", viewport: { width: 412, height: 915 }, media: "phone", pace: 1.22 },
  { device: "ios", label: "iPhone", os: "ios", model: "iPhone 15", browser: "Safari 18", viewport: { width: 393, height: 852 }, media: "phone", pace: 1.34 },
];
const deviceInfo = (d) => {
  const { device, label, os, model, browser, viewport } = d;
  return { device, label, os, model, browser, viewport };
};
const TEST_WALLET = { name: "MetaMask", account: "Test wallet 1", address: "0x7a3E…91c4", network: "Citrea Testnet", note: "" };

function buildLive(p, startAt) {
  if (p.seedLive) {
    const lt = structuredClone(seed(p.seedLive).liveTest);
    lt.project = p.id;
    lt.ranAt = startAt;
    const byKind = Object.fromEntries(lt.runs.map((r) => [r.device, r]));
    lt.runs = DEVICES.map((d, i) => {
      const src = structuredClone(byKind[d.device === "laptop" ? "laptop" : "phone"]);
      for (const st of src.phases.flatMap((ph) => ph.steps)) st.ms = Math.round(st.ms * d.pace);
      return {
        ...src,
        ...deviceInfo(d),
        startedAt: iso(startAt, -95 + i * 4),
        durationMs: Math.round(src.durationMs * d.pace),
        browserVersion: d.browser,
        consoleErrors: [],
        failedRequests: [],
        cancelledRequests: [],
        outcome: { status: "passed", reasons: [] },
      };
    });
    lt.runner = "Mozark device cloud: Windows 11, Pixel 8, iPhone 15";
    return lt;
  }
  if (!p.live) return null;
  const rec = p.live.recorded;
  const runs = DEVICES.map((d) => {
    const device = d.device;
    const phone = device !== "laptop";
    let at = 4;
    const phases = ["demo", "features"].map((ph) => ({
      id: ph,
      title: ph === "demo" ? "Demo replay" : "Major flows",
      about: ph === "demo" ? "Screens shown in the demo video, checked on the live app." : p.live.wallet ? "The app's main features, with a MetaMask test wallet on testnet." : "The app's main features, used without an account.",
      steps: p.live.steps
        .filter((s) => s[0] === ph)
        .map(([, id, title, status0, demoAt, detail0, recAt, wallet]) => {
          const issue = phone ? p.live.phoneIssues?.[id] : null;
          const status = Array.isArray(issue) ? issue[0] : issue ?? status0;
          const overflowNote = issue && p.id === "metromint" ? "overflow" : null;
          const phoneCut = issue && p.id === "kirana-credit";
          at = recAt ?? at + 6 + (id.charCodeAt(1) % 4);
          let screenshot = null;
          if (rec) screenshot = rec.shot(d.media, id);
          else if (p.live.shots) screenshot = p.live.shots[d.media]?.[id] ? `${d.media}/${p.live.shots[d.media][id]}` : null;
          else {
            const note = status === "failed" ? (/^\d{3}/.test(detail0) ? detail0.split(" ")[0] + " · " + detail0.split(" ").slice(1).join(" ") : overflowNote ?? (phoneCut ? "Draw button cut off" : detail0)) : status === "missing" ? "404 · page not found" : overflowNote;
            screenshot = writeSvg(`${p.id}/${d.media}/${id}.svg`, screenSvg({ name: p.name, title, color: COLORS[p.id] ?? "#17141f", status, device: phone ? "phone" : "laptop", note })).replace(`/media/${p.id}/`, "");
          }
          const detail = Array.isArray(issue) ? issue[1] : issue && !/^\d{3}/.test(detail0) ? (p.id === "metromint" ? "ticket card overflows at 390px" : "button cut off below the fold") : detail0;
          const step = { id, title, demoAt, why: `Checks "${title}" works on the live app.`, at, status, detail, ms: Math.round((2400 + (id.charCodeAt(1) % 5) * 300) * d.pace), screenshot };
          if (wallet) step.wallet = { ...TEST_WALLET, ...wallet, site: wallet.site ?? p.live.target.replace(/^https?:\/\//, "") };
          return step;
        }),
    }));
    const steps = phases.flatMap((ph) => ph.steps);
    const failed = steps.filter((s) => s.status === "failed" && /^\d{3}/.test(s.detail)).map((s) => ({ url: `${p.live.target}${s.detail.split(" ")[1] ?? "/"}`, status: Number(s.detail.slice(0, 3)) }));
    const bad = steps.filter((s) => s.status === "failed" || s.status === "missing").length;
    const sideways = phone && (p.id === "metromint" || Boolean(rec));
    return {
      ...deviceInfo(d),
      startedAt: iso(startAt, -60),
      browserVersion: d.browser,
      home: { url: `${p.live.target}/`, status: 200, wallMs: Math.round(4200 * d.pace), title: p.name, h1: p.name, loadMs: Math.round(610 * d.pace), horizontalScroll: sideways, viewportMeta: true, brokenImages: 0 },
      video: rec ? { file: rec[d.media], seconds: rec.seconds } : null,
      chrome: Boolean(rec), // the recording includes the browser chrome; the page draws the address bar
      durationMs: Math.round((rec ? rec.seconds : at + 6) * 1000 * d.pace),
      consoleErrors: [],
      failedRequests: failed,
      cancelledRequests: [],
      outcome: bad ? { status: "failed", reasons: [`${bad} step(s) broken`] } : { status: "passed", reasons: [] },
      phases,
    };
  });
  return {
    project: p.id,
    target: p.live.target,
    ranAt: startAt,
    runner: "Mozark device cloud: Windows 11, Pixel 8, iPhone 15",
    mode: p.live.wallet ? "Demo replay + major flows + health, with a throwaway MetaMask wallet on testnet. Never uses real funds or signs in." : "Demo replay + major flows + health. Never pays, stakes, signs in, connects a wallet or submits.",
    wallet: p.live.wallet ? TEST_WALLET : null,
    runs,
  };
}

const stepCount = (lt, device) => lt?.runs.find((r) => r.device === device)?.phases.flatMap((ph) => ph.steps) ?? [];
function deviceWord(lt, device) {
  const s = stepCount(lt, device);
  const ok = s.filter((x) => x.status === "passed").length;
  const broken = s.filter((x) => x.status === "failed" || x.status === "missing").length;
  return broken ? `${ok} work · ${broken} broken` : `${ok} of ${s.length} pass`;
}

function buildDossier(p, at) {
  const commit = p.commit ?? sha(`commit:${p.id}`).slice(0, 40);
  const continuity = p.commits && {
    assessment: `${p.commits.during} of ${p.commits.before + p.commits.during} commits are from after the event start.`,
    authors: p.commits.authors,
    boundaryCommit: null,
    boundaryLabel: "the event start (2026-11-06)",
    commitsBefore: p.commits.before,
    commitsDuringEvent: p.commits.during,
    commitsSeen: p.commits.before + p.commits.during,
    eventStart: "2026-11-06T00:00:00+05:30",
    firstCommitDate: p.commits.first,
    historyTruncated: false,
    lastCommitDate: p.commits.last,
  };
  const t = p.tests ?? {};
  const tests = {
    claimed: "",
    found: { vitestFiles: t.vitestFiles ?? 0, vitestCases: t.vitestCases ?? 0, forgeFiles: t.forgeFiles ?? 0, forgeTests: t.forgeTests ?? 0, pyFiles: t.pyFiles ?? 0, pyTests: t.pyTests ?? 0 },
    method: "Counted it()/test() in *.test/*.spec files, function test* in *.t.sol, def test_ in Python tests. Read only.",
    note: "Counted, not run.",
    status: "not_run",
  };
  if (p.seedDossier) {
    const d = structuredClone(seed(p.seedDossier).dossier);
    d.generatedAt = at;
    d.highlights = p.highlights;
    d.verdict = p.highlights.headline;
    return d;
  }
  const base = p.id === "mozark-app-studio" ? seed("mozark-dossier.json").dossier : {};
  const evidence = p.claims.map((c, i) => ({ id: `E${i + 1}`, claim: c.claim, source: "code", status: c.status, impact: c.status === "supported_by_code" ? "strength" : "concern", refs: c.refs, observation: `${c.status === "supported_by_code" ? "Supported" : c.status === "contradicted" ? "Contradicted" : "Unverified"}: ${c.observation}`, limitations: "" }));
  return {
    architecture: base.architecture ?? [],
    commit,
    continuity: p.id === "mozark-app-studio" ? { ...base.continuity } : continuity,
    coreJourney: (p.live?.steps ?? []).filter((s) => s[0] === "demo").map((s, i) => `${i + 1}. ${s[2]}.`),
    dependencies: base.dependencies ?? [],
    evidence,
    generatedAt: at,
    highlights: p.highlights,
    intendedUsers: "",
    limitations: [],
    problem: p.pitch,
    reviewer: { attempts: 1, method: `Static read of ${Math.min(p.files, 60)} files at commit ${commit.slice(0, 7)} plus the submission; no code executed. 0g ${MODEL}.`, mode: "automatic", ms: 88000, name: "Reviewer agent", refsChecked: p.claims.reduce((n, c) => n + c.refs.length, 0), refsDropped: 0 },
    risks: [],
    strengths: [],
    summary: p.description.split("\n")[0],
    tests: p.id === "mozark-app-studio" ? base.tests : tests,
    unresolvedQuestions: [],
    verdict: p.highlights.headline,
  };
}

function buildReviews(p, ranAt, lt) {
  const reviews = JKEYS.map((k, i) => {
    const j = judgeOf(k);
    const crit = criteria.map((c) => {
      const base = p.criteria[c.id];
      const score = clamp(base + p.judgeDelta[k] + ((sha(`${p.id}${k}${c.id}`).charCodeAt(0) % 5) - 2));
      const [comment, ev] = p.notes[c.id];
      return { comment, evidence: ev, id: c.id, score };
    });
    const overall = crit.reduce((s, c) => s + WEIGHT[k][c.id] * c.score, 0);
    const req = uuid(`review:${p.id}:${k}`);
    const dealBreaker = k === "priya" && p.id === "fittercoin";
    return {
      attempts: 1,
      judge: { id: j.id, name: j.name, promptVersion: "judge-v3", title: j.title, tone: j.tone, version: 1, weights: j.weights },
      judgeId: j.id,
      ms: 41000 + i * 9000,
      overallHundredths: overall,
      promptVersion: "judge-v3",
      review: {
        certainty: "high",
        comment: p.headline[k],
        concerns: p.concerns,
        criteria: crit,
        dealBreakerHit: dealBreaker,
        dealBreakerNote: dealBreaker ? "A demo that promises money the product never moves: the stake tx escrows 0 ETH and a winning bet paid nothing (E3, E4)." : "",
        headline: p.headline[k],
        strengths: p.strengths,
      },
      screenshotsShown: lt ? Math.min(12, stepCount(lt, "laptop").length) : 0,
      status: "scored",
      traces: [{ chatId: uuid(`chat:${p.id}:${k}`), costUsdMicro: 3100 + i * 640, model: MODEL, provider: ZG_PROVIDER, requestId: req }],
      usage: { input_tokens: 24000 + i * 900, output_tokens: 2600 + i * 700 },
    };
  });
  const panel = Math.round(reviews.reduce((s, r) => s + r.overallHundredths, 0) / reviews.length);
  const evidence = lt
    ? lt.runs.flatMap((r) =>
        r.phases.flatMap((ph) => ph.steps).filter((s) => s.screenshot).slice(0, 6).map((s) => ({
          id: `V-${r.device}-${s.id}`,
          stepTitle: s.title,
          observation: { matchesStep: s.status === "passed" ? "yes" : "no", seen: s.status === "passed" ? `${s.title} on ${r.label.toLowerCase()}: ${s.detail}.` : `${s.title}: ${s.detail}.`, problems: s.status === "passed" ? [] : [s.detail] },
          trace: { requestId: uuid(`vision:${p.id}:${r.device}:${s.id}`) },
        })),
      )
    : [];
  const cost = reviews.reduce((s, r) => s + r.traces[0].costUsdMicro, 0);
  return {
    complete: true,
    effort: "high",
    model: MODEL,
    panelHundredths: panel,
    projectId: p.id,
    provider: "0g",
    ranAt,
    reviews,
    evidence,
    zg: { calls: 3 + evidence.length, costUsdMicro: cost + evidence.length * 410, evidenceCostUsdMicro: evidence.length * 410, judgeCostUsdMicro: cost, providers: [ZG_PROVIDER], requestIds: [...reviews.map((r) => r.traces[0].requestId), ...evidence.map((e) => e.trace.requestId)], uncostedCalls: 0 },
  };
}

/*
 * Timings, in seconds from the start. Code, demo and fact-check run side by side; the live test is the
 * long pole (booking real devices, an agent exploring the site and writing steps, then three runs on
 * real hardware); the judges start when both the fact-check and the live test are done.
 */
function plan(p, lt, dossier) {
  const vary = (k, lo, hi) => lo + (parseInt(sha(`${p.id}:${k}`).slice(0, 6), 16) % 1000) / 1000 * (hi - lo);
  const r = (x) => Math.round(x);
  const clone = r(18 + p.files * 0.04 + vary("clone", 0, 8));
  const code = { clone, pin: clone + 1, history: clone + r(4 + vary("hist", 0, 3)), tests: clone + r(9 + vary("tests", 0, 5)) };
  const vid = p.video;
  const demo = vid
    ? { download: r(8 + vid.bytes / 1.6e6), transcribe: r(8 + vid.bytes / 1.6e6 + vid.seconds * 0.32) }
    : { images: r(14 + vary("img", 0, 6)) };
  const fStart = code.tests;
  const ask = r(170 + Math.min(p.files, 60) * 2.2 + vary("ask", 0, 60));
  const fact = { start: fStart, pack: fStart + 6, ask: fStart + 6 + ask, verify: fStart + 6 + ask + 14, save: fStart + 6 + ask + 18 };
  let live = null;
  if (lt) {
    const n = stepCount(lt, "laptop").length;
    const book = r(38 + vary("book", 0, 20));
    const explore = book + r(120 + vary("explore", 0, 70));
    const write = explore + r(110 + n * 9 + vary("write", 0, 40));
    const run = (d) => r((150 + n * 34 + (lt.wallet ? 140 : 0)) * DEVICES.find((x) => x.device === d).pace + vary(`run:${d}`, 0, 35));
    const runs = Object.fromEntries(DEVICES.map((d) => [d.device, write + run(d.device)]));
    const last = Math.max(...Object.values(runs));
    live = { book, explore, write, runs, save: last + r(26 + vary("save", 0, 10)) };
  }
  const judgesStart = Math.max(fact.save, live?.save ?? 0) + 3;
  const judge = [0, 1, 2].map((i) => judgesStart + r(78 + i * 14 + vary(`judge:${i}`, 0, 30)));
  return { code, demo, fact, live, judgesStart, judge, end: Math.max(...judge) };
}
const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`);

function buildPipeline(p, start, lt, dossier, result) {
  const T = (s) => iso(start, s);
  const part = (id, label, a, b, detail, status = "done") => ({ detail, finishedAt: status === "done" ? T(b) : null, id, label, startedAt: T(a), status });
  const ev = dossier.evidence;
  const n = (st) => ev.filter((e) => e.status === st).length;
  const tf = dossier.tests.found;
  const tests = tf.vitestCases + tf.forgeTests + tf.pyTests;
  const c = dossier.continuity;
  const commit7 = String(dossier.commit).slice(0, 7);
  const repo = p.repoUrl.replace("https://github.com/", "");
  const vid = p.video;
  const P = plan(p, lt, dossier);
  const host = lt?.target.replace(/^https?:\/\//, "");
  const L = P.live;
  const live = lt
    ? {
        about: "Replay the demo, then the main flows, on Windows, Android and iPhone",
        detail: `${host} · ${DEVICES.map((d) => `${d.label}: ${deviceWord(lt, d.device)}`).join(" · ")}`,
        facts: [
          { label: "Live app", value: host },
          { label: "Steps written", value: `${stepCount(lt, "laptop").length} per device` },
          ...DEVICES.map((d) => ({ label: d.label, value: deviceWord(lt, d.device) })),
          ...(lt.wallet ? [{ label: "Wallet", value: "MetaMask test wallet · Citrea testnet" }] : []),
          { label: "Took", value: dur(L.save) },
        ],
        finishedAt: T(L.save),
        id: "live",
        parts: [
          part("connect", "Book devices on the Mozark cloud", 0, L.book, "Windows 11 laptop, Pixel 8, iPhone 15"),
          part("explore", "Agent explores the site", L.book, L.explore, `${host} · pages mapped against the demo`),
          part("write", "Agent writes the test steps", L.explore, L.write, `${stepCount(lt, "laptop").length} steps per device${lt.wallet ? ", MetaMask approvals included" : ""}`),
          ...DEVICES.map((d) => ({ ...part(d.device, `${d.model} · ${d.browser}`, L.write, L.runs[d.device], `${deviceWord(lt, d.device)} · ${dur(L.runs[d.device] - L.write)}`), os: d.os })),
          part("save", "Save recordings and screenshots", Math.max(...Object.values(L.runs)), L.save, "Video and a screenshot for every step, on every device"),
        ],
        startedAt: T(0),
        status: "done",
        title: "Test the live app on real devices",
      }
    : { about: "Replay the demo, then the main flows, on Windows, Android and iPhone", detail: p.liveSkip, facts: [{ label: "Live app", value: "none submitted" }], finishedAt: T(1), id: "live", parts: [part("find", "Find the live app", 0, 1, p.liveSkip, "skipped")], startedAt: T(0), status: "skipped", title: "Test the live app on real devices" };
  const judgeParts = result.reviews.map((r, i) => {
    const k = JKEYS[i];
    const w = Object.entries(r.judge.weights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, x]) => `${criteria.find((c) => c.id === id).label} ${x}%`).join(" · ");
    return { detail: `Scored ${two(r.overallHundredths)} / 100 · "${r.review.headline}"`, finishedAt: T(P.judge[i]), focus: w, id: r.judgeId, label: r.judge.name, role: JUDGES[k].role, startedAt: T(P.judgesStart), status: "done" };
  });
  const D = P.demo;
  const F = P.fact;
  return {
    running: false,
    review: { status: "reviewed", failed: 0 },
    queueLength: 0,
    state: {
      projectId: p.id,
      startedAt: T(0),
      finishedAt: T(P.end),
      steps: [
        {
          about: "Fetch the repo, pin the commit, count the tests",
          detail: `${commit7} · ${tests} tests found · ${p.files} files`,
          facts: [
            { label: "Repository", value: repo },
            { label: "Commit", value: commit7 },
            ...(c ? [{ label: "Commits since the event began", value: `${c.commitsDuringEvent} of ${c.commitsBefore + c.commitsDuringEvent}` }] : []),
            { label: "Tests found", value: String(tests) },
            { label: "Files", value: p.files },
          ],
          finishedAt: T(P.code.tests),
          id: "code",
          parts: [part("clone", "Clone the code (never run)", 0, P.code.clone, `github.com/${repo}`), part("pin", "Pin the exact commit", P.code.clone, P.code.pin, commit7), part("history", "Read the commit history", P.code.pin, P.code.history, c ? `${c.commitsDuringEvent} of ${c.commitsBefore + c.commitsDuringEvent} commits made at the event` : ""), part("tests", "Count the tests", P.code.history, P.code.tests, `${tests} tests · counted, not run`)],
          startedAt: T(0),
          status: "done",
          title: "Code review",
        },
        {
          about: "Save the video, transcribe it, check the screenshots",
          detail: vid ? `${Math.floor(vid.seconds / 60)}:${String(vid.seconds % 60).padStart(2, "0")} video saved · ${p.transcriptWords}-word transcript` : `${p.images ?? 2} screenshots read`,
          facts: vid ? [{ label: "Video", value: `${Math.floor(vid.seconds / 60)}:${String(vid.seconds % 60).padStart(2, "0")} long` }, { label: "Picture", value: p.picture }, { label: "Transcript", value: `${p.transcriptWords} words` }] : [{ label: "Screenshots", value: p.images ?? 2 }],
          finishedAt: T(vid ? D.transcribe : D.images),
          id: "demo",
          parts: vid ? [part("download", "Save our copy of the video", 0, D.download, `${(vid.bytes / 1e6).toFixed(1)} MB · ${vid.source}`), part("transcribe", "Transcribe the speech", D.download, D.transcribe, `${p.transcriptWords} words`)] : [part("images", "Read the screenshots", 0, D.images, `${p.images ?? 2} screenshots`)],
          startedAt: T(0),
          status: "done",
          title: "Process the demo",
        },
        live,
        {
          about: "Check what the team says against the code",
          detail: `${ev.length} claims checked · ${n("supported_by_code")} supported · ${n("contradicted")} contradicted`,
          facts: [
            { label: "Claims checked", value: ev.length },
            { label: "Supported by code", value: n("supported_by_code") },
            { label: "Unverified", value: n("unverified") },
            { label: "Contradicted", value: n("contradicted") },
          ],
          finishedAt: T(F.save),
          id: "dossier",
          parts: [part("pack", "Gather the code for the reviewer", F.start, F.pack, `${Math.min(p.files, 60)} files`), part("ask", "Reviewer agent reads the code and the claims", F.pack, F.ask, "Claims listed with the lines that back them"), part("verify", "Verify every cited line exists", F.ask, F.verify, `${dossier.reviewer.refsChecked} references checked`), part("save", "Save the fact-check", F.verify, F.save, `${ev.length} claims: ${n("supported_by_code")} supported, ${n("unverified")} unverified, ${n("contradicted")} contradicted`)],
          startedAt: T(F.start),
          status: "done",
          title: "Fact-check the claims",
        },
        {
          about: "Every judge on the panel scores it with all of the above",
          detail: `3 of 3 judges scored · panel ${two(result.panelHundredths)}`,
          facts: [{ label: "Panel average", value: `${two(result.panelHundredths)} / 100` }, ...result.reviews.map((r) => ({ label: r.judge.name, value: two(r.overallHundredths) }))],
          finishedAt: T(P.end),
          id: "judges",
          parts: judgeParts,
          startedAt: T(P.judgesStart),
          status: "done",
          title: "Judges score it",
        },
      ],
    },
  };
}

const projects = [];
const out = { submissions: [], dossiers: {}, reviews: {}, live: {}, pipelines: {}, arkiv: {} };
PROJECTS.forEach((p, slot) => {
  const reviewStart = iso(p.submittedAt, 3 * 3600 + slot * 1800);
  const lt0 = buildLive(p, reviewStart);
  const dossier0 = buildDossier(p, reviewStart);
  const P = plan(p, lt0, dossier0);
  const lt = lt0 && { ...lt0, ranAt: iso(reviewStart, P.live.save) };
  const dossier = { ...dossier0, generatedAt: iso(reviewStart, P.fact.save) };
  const result = buildReviews(p, iso(reviewStart, P.end), lt);
  const pipeline = buildPipeline(p, reviewStart, lt, dossier, result);
  const owner = addr(`owner:${p.id}`);
  let demoImages = [];
  if (!p.video) {
    demoImages = [1, 2].map((i) => writeSvg(`${p.id}/screen-${i}.svg`, screenSvg({ name: p.name, title: i === 1 ? p.pitch.split(".")[0].slice(0, 34) : "Dashboard", color: COLORS[p.id] ?? "#17141f", status: "passed", device: "laptop" })));
  }
  const sub = {
    chainId: 84532,
    demoVideoUrl: p.video?.url ?? "",
    demoImages,
    eventId: EVENT.id,
    fighterSeed: sha(`fighter:${p.id}`).slice(0, 12),
    id: p.id,
    liveUrl: p.liveUrl,
    ownerWallet: owner,
    rewardWallet: owner,
    project: { name: p.name, pitch: p.pitch, description: p.description },
    repoUrl: p.repoUrl,
    showcaseUrl: p.showcaseUrl ?? null,
    submittedAt: p.submittedAt,
    team: { name: p.team },
    tracks: p.tracks,
    signed: true,
    review: { status: "reviewed" },
    hasDossier: true,
    twist: p.twist,
    video: p.video && !/loom\.com/.test(p.video.url) ? { saved: true, url: p.video.url, seconds: p.video.seconds, bytes: p.video.bytes, source: p.video.source } : null,
  };

  // 0G Storage: the evidence bundle (dossier, review, live-test report) plus media.
  const files = {
    dossier: store(p.id, "dossier.json", "evidence-bundle", { size: JSON.stringify(dossier).length, mime: "application/json", at: dossier.generatedAt }),
    review: store(p.id, "review.json", "evidence-bundle", { size: JSON.stringify(result).length, mime: "application/json", at: result.ranAt }),
  };
  if (lt) {
    files.liveTest = store(p.id, "live/smoke.json", "evidence-bundle", { size: JSON.stringify(lt).length, mime: "application/json", at: lt.ranAt });
    const seen = new Set();
    for (const r of lt.runs) for (const s of r.phases.flatMap((ph) => ph.steps)) if (s.screenshot && !seen.has(s.screenshot) && seen.add(s.screenshot)) store(p.id, `live/${s.screenshot}`, "live-screenshot", { size: 30000 + (s.at | 0) * 977, mime: s.screenshot.endsWith(".svg") ? "image/svg+xml" : "image/jpeg", at: lt.ranAt });
    const vids = new Set();
    for (const r of lt.runs) if (r.video && !vids.has(r.video.file) && vids.add(r.video.file)) store(p.id, `live/${r.video.file}`, "live-recording", { size: r.device === "laptop" ? 3402118 : 2730471, mime: "video/mp4", at: lt.ranAt });
  }
  if (p.video) store(p.id, "demo.mp4", "demo-video", { size: p.video.bytes, mime: "video/mp4", at: iso(p.submittedAt, 600) });
  for (const [i, src] of demoImages.entries()) store(p.id, `screen-${i + 1}.svg`, "upload-image", { size: 2400, mime: "image/svg+xml", at: p.submittedAt });

  // Arkiv: the judged result, one panel entity and one scorecard per judge.
  const panelKey = h32(`arkiv:panel:${p.id}`);
  const arkiv = {
    configured: { read: true, write: true, swarm: false },
    publishing: false,
    last: { at: iso(result.ranAt, 49), panelKey, txHash: h32(`arkiv:tx:${p.id}`) },
    onchain: {
      panel: { entityKey: panelKey, owner: PUBLISHER, projectId: p.id, runAt: result.ranAt, panelScore: two(result.panelHundredths), complete: true, judges: 3, provider: "0g", model: MODEL, expiresAtBlock: "5488285", expiresAt: "2027-05-07T00:00:00.000Z", explorer: arkivLink(panelKey), txHash: h32(`arkiv:tx:${p.id}`) },
      scorecards: result.reviews.map((r) => {
        const k = h32(`arkiv:card:${p.id}:${r.judgeId}`);
        return { entityKey: k, judgeId: r.judgeId, judgeName: r.judge.name, status: "scored", overall: two(r.overallHundredths), headline: r.review.headline, explorer: arkivLink(k), txHash: h32(`arkiv:cardtx:${p.id}:${r.judgeId}`) };
      }),
      swarm: null,
      zg: { dossier: files.dossier.rootHash, review: files.review.rootHash, liveTest: files.liveTest?.rootHash ?? null },
    },
  };
  // Every judge score links its 0G inference and evidence roots.
  result.proofs = { arkivPanel: arkiv.onchain.panel.explorer, panelKey, evidenceRoots: { dossier: files.dossier.rootHash, review: files.review.rootHash, liveTest: files.liveTest?.rootHash ?? null }, storageScan: { dossier: files.dossier.links.file, review: files.review.links.file, liveTest: files.liveTest?.links.file ?? null } };

  out.submissions.push(sub);
  out.dossiers[p.id] = dossier;
  out.reviews[p.id] = result;
  out.live[p.id] = lt;
  out.pipelines[p.id] = pipeline;
  out.arkiv[p.id] = arkiv;
  projects.push({ p, slot, result, dossier, lt, files, panelKey });
});

/* ---------- tournament, fights, bets ---------- */
const TOURNAMENT_ID = 1;
const CAST = Object.fromEntries(JKEYS.map((k) => [JUDGES[k].id, { name: JUDGES[k].name, focus: JUDGES[k].role }]));
const jid = (k) => JUDGES[k].id;
const fights = {};
const matches = [];
const TOUR_START = "2026-11-06T13:30:00.000Z";

for (const f of FIGHTS) {
  const A = projects[f.match * 2];
  const B = projects[f.match * 2 + 1];
  const fightStart = f.finished ? iso(f.finished, -9 * 60) : "2026-11-06T17:40:00.000Z";
  const events = [];
  let t = 0;
  const reqs = [];
  const emit = (e, proof = true) => {
    const requestId = proof ? uuid(`fight:${f.match}:${events.length}`) : null;
    if (requestId) reqs.push(requestId);
    events.push({ seq: events.length + 1, ts: iso(fightStart, (t += 11)), ...e, ...(requestId ? { proof: { requestId, teeVerified: null } } : {}) });
  };
  const ev = (side, labels) => labels.map((label) => ({ kind: /:E\d|·\s*[a-z].*\.(sol|ts|tsx|py|js|md|css)/.test(label) ? "file" : "evidence", label }));
  emit({ type: "intro" }, false);
  emit({ type: "pitch", actor: "a", text: f.pitch[0] });
  emit({ type: "pitch", actor: "b", text: f.pitch[1] });
  const rounds = {};
  for (const [round, asker, q, ansA, ansB, challenges, scores, penalties] of f.rounds) {
    emit({ type: "round_start", round }, false);
    emit({ type: "question", round, actor: jid(asker), text: q });
    emit({ type: "answer", round, actor: "a", text: ansA });
    emit({ type: "answer", round, actor: "b", text: ansB });
    challenges.forEach(([by, move, text, evidence, rebuttal, votes, reason], k) => {
      const challengeId = `${round}-${k + 1}`;
      emit({ type: "challenge", round, actor: by, target: by === "a" ? "b" : "a", challengeId, move, text, evidence: ev(by, evidence) });
      emit({ type: "rebuttal", round, actor: by === "a" ? "b" : "a", challengeId, text: rebuttal });
      emit({ type: "ruling", round, challengeId, votes: { [jid("priya")]: votes.priya, [jid("marcus")]: votes.marcus, [jid("ana")]: votes.ana }, reason });
    });
    for (const [judge, target, reason, evidence] of penalties ?? []) emit({ type: "penalty", round, target, judge: jid(judge), reason, evidence: ev(target, evidence) });
    if (round === "defense") {
      emit({ type: "closing", actor: "a", text: f.closing[0] });
      emit({ type: "closing", actor: "b", text: f.closing[1] });
    }
    rounds[round] = { a: scores.a, b: scores.b, notes: JKEYS.map((k, i) => ({ judgeId: jid(k), A: { score: scores.a[i] }, B: { score: scores.b[i] }, trace: uuid(`card:${f.match}:${round}:${k}`) })) };
    emit({ type: "round_sealed", round, scores: { a: scores.a, b: scores.b } }, false);
  }
  const sealed = (side) => Object.fromEntries(ROUNDS.map((r) => [r, rounds[r][side]]));
  const scoreA = scoreHundredths(pointsKept(sealed("a")));
  const scoreB = scoreHundredths(pointsKept(sealed("b")));
  const winner = scoreA > scoreB ? "a" : "b";
  emit({ type: "result", winner, reason: "score" }, false);
  const resultHash = h32(JSON.stringify({ scores: { a: scoreA, b: scoreB }, tie: { a: 0, b: 0 }, rounds }));
  const transcript = store(`fights/${TOURNAMENT_ID}-${f.match}`, "fight.json", "fight-transcript", { size: JSON.stringify(events).length, mime: "application/json", at: iso(fightStart, t + 20) });
  const arkivKey = h32(`arkiv:fight:${TOURNAMENT_ID}-${f.match}`);
  fights[`${TOURNAMENT_ID}-${f.match}`] = {
    status: "done",
    live: Boolean(f.live),
    tournamentId: String(TOURNAMENT_ID),
    match: f.match,
    a: A.slot,
    b: B.slot,
    tagline: f.tagline,
    cast: CAST,
    judges: CAST,
    revealAt: 0,
    ranAt: iso(fightStart, t + 15),
    id: uuid(`fight:${f.match}`),
    events,
    scores: { a: scoreA, b: scoreB },
    health: { a: healthThousandths(sealed("a")), b: healthThousandths(sealed("b")) },
    tie: { a: 0, b: 0 },
    needsReview: false,
    rounds,
    fighters: { a: { fighterName: A.p.name, archetype: A.p.team }, b: { fighterName: B.p.name, archetype: B.p.team } },
    calls: reqs.length + JKEYS.length * ROUNDS.length,
    costUsd: Number(((reqs.length + 18) * 0.0021).toFixed(4)),
    resultHash,
    proofs: {
      resultHash,
      transcript: { rootHash: transcript.rootHash, txSeq: transcript.txSeq, file: transcript.links.file, tx: transcript.links.tx },
      arkiv: { entityKey: arkivKey, txHash: h32(`arkiv:fighttx:${f.match}`), explorer: arkivLink(arkivKey) },
      inference: { model: MODEL, provider: ZG_PROVIDER, requestIds: reqs, scorecards: Object.values(rounds).flatMap((r) => r.notes.map((n) => n.trace)) },
      evidence: {
        a: { project: A.p.id, dossier: A.files.dossier.rootHash, review: A.files.review.rootHash, liveTest: A.files.liveTest?.rootHash ?? null, arkivPanel: A.panelKey },
        b: { project: B.p.id, dossier: B.files.dossier.rootHash, review: B.files.review.rootHash, liveTest: B.files.liveTest?.rootHash ?? null, arkivPanel: B.panelKey },
      },
    },
  };
  matches[f.match] = {
    index: f.match,
    live: Boolean(f.live),
    projectA: A.slot,
    projectB: B.slot,
    winner: winner === "a" ? A.slot : B.slot,
    scoreA,
    scoreB,
    finishedAt: f.finished ?? null,
    resultHash,
  };
}

// Bets: bettor wallets, amounts, which side, and the 0G-independent chain tx for each.
const bets = {};
for (const [m, sides] of Object.entries(BETS)) {
  const list = [];
  let n = Number(m) * 5;
  for (const side of ["a", "b"]) {
    for (const [at, amount] of sides[side]) {
      const who = CROWD[n++ % CROWD.length];
      list.push({ bettor: who, address: addr(`bettor:${who}`), side, selection: side === "a" ? Number(m) * 2 : Number(m) * 2 + 1, amount: String(amount), at, txHash: h32(`bet:${m}:${who}:${at}`) });
    }
  }
  list.sort((x, y) => x.at - y.at);
  bets[m] = list;
}

const tournament = {
  id: TOURNAMENT_ID,
  title: "ETHGlobal Mumbai · Main bracket",
  track: "Open",
  eventId: EVENT.id,
  createdAt: "2026-11-06T13:00:00.000Z",
  scheduledStart: TOUR_START,
  bettingCutoff: TOUR_START,
  resolutionDeadline: "2026-11-09T18:00:00.000Z",
  configHash: h32("config:1"),
  seed: h32("seed:1"),
  bracketHash: h32(`bracket:${PROJECTS.map((p) => p.id).join(",")}`),
  organizer: addr("organizer"),
  publisher: PUBLISHER,
  reviewer: addr("reviewer"),
  platformRecipient: addr("platform"),
  minBet: "1",
  maxBet: "1000",
  capacity: 8,
  matching: { manual: false, algorithmVersion: "similarity-v2", seed: "ethglobal-mumbai", embeddingModel: "0g-embed-small", firstRound: FIGHTS.map((f) => [f.match * 2, f.match * 2 + 1]) },
  projects: PROJECTS.map((p, i) => ({ index: i, submissionId: p.id, name: p.name, pitch: p.pitch, tracks: p.tracks, team: p.team, ownerWallet: addr(`owner:${p.id}`), rewardWallet: addr(`owner:${p.id}`), fighterSeed: out.submissions[i].fighterSeed })),
  taglines: FIGHTS.sort((x, y) => x.match - y.match).map((f) => f.tagline),
  matches,
};

/* ---------- knowledge graph ---------- */
const nodes = [];
const edges = [];
for (const k of JKEYS) nodes.push({ id: `judge:${jid(k)}`, type: "judge", name: JUDGES[k].name });
for (const t of EVENT.tracks) nodes.push({ id: `track:${t.id}`, type: "track", name: t.name, sponsor: Boolean(t.sponsor) });
const TECH = { "go-health-me": ["next.js", "viem", "@circle-fin/developer-controlled-wallets", "@worldcoin/idkit", "foundry"], fittercoin: ["react", "mediapipe", "opencv-python", "@google/genai", "@selfxyz/qrcode"], "mozark-app-studio": ["appium", "playwright", "python"], qagent: ["next.js", "octokit"], vaultline: ["foundry", "viem"], splitsafe: ["next.js", "viem", "foundry"], "kirana-credit": ["next.js", "foundry"], metromint: ["react", "viem"] };
const techSeen = new Set();
for (const { p, result } of projects) {
  nodes.push({ id: `project:${p.id}`, type: "project", name: p.name, team: p.team });
  for (const t of p.tracks) edges.push({ from: `project:${p.id}`, rel: "IN_TRACK", to: `track:${t}` });
  for (const r of result.reviews) edges.push({ from: `judge:${r.judgeId}`, rel: "SCORED", to: `project:${p.id}`, score: r.overallHundredths / 100 });
  for (const t of TECH[p.id] ?? []) {
    if (!techSeen.has(t)) nodes.push({ id: `tech:${t}`, type: "tech", name: t });
    techSeen.add(t);
    edges.push({ from: `project:${p.id}`, rel: "USES", to: `tech:${t}` });
  }
}
for (const m of matches) if (!m.live) edges.push({ from: `project:${PROJECTS[m.winner].id}`, rel: "BEAT", to: `project:${PROJECTS[m.winner === m.projectA ? m.projectB : m.projectA].id}` });
const graphProjects = {};
for (const { p, result, dossier } of projects) {
  const m = matches.find((x) => !x.live && (x.projectA === PROJECTS.indexOf(p) || x.projectB === PROJECTS.indexOf(p)));
  const me = PROJECTS.indexOf(p);
  graphProjects[p.id] = {
    explain: {
      panelAvg: result.panelHundredths / 100,
      scores: result.reviews.map((r) => ({ judgeId: r.judgeId, name: r.judge.name, score: r.overallHundredths / 100 })),
      claims: { supported: dossier.evidence.filter((e) => e.status === "supported_by_code").length, contradicted: dossier.evidence.filter((e) => e.status === "contradicted").length },
      contradicted: dossier.evidence.filter((e) => e.status === "contradicted").map((e) => e.claim),
      beat: m && m.winner === me ? [PROJECTS[m.projectA === me ? m.projectB : m.projectA].id] : [],
      lostTo: m && m.winner !== me ? [PROJECTS[m.winner].id] : [],
      tech: TECH[p.id] ?? [],
    },
    similar: projects.filter((x) => x.p.id !== p.id && x.p.tracks.some((t) => p.tracks.includes(t))).slice(0, 3).map((x) => ({ projectId: x.p.id, name: x.p.name, similarity: x.slot === (me ^ 1) ? 0.91 : 0.55 + (sha(p.id + x.p.id).charCodeAt(0) % 20) / 100 })),
  };
}
const panelMean = (k) => projects.reduce((s, x) => s + x.result.reviews[JKEYS.indexOf(k)].overallHundredths, 0) / projects.length / 100;
const allMean = JKEYS.reduce((s, k) => s + panelMean(k), 0) / 3;
const graphJudges = JKEYS.map((k) => ({ judgeId: jid(k), name: JUDGES[k].name, avg: Number(panelMean(k).toFixed(2)), n: projects.length, vsPanel: Number((panelMean(k) - allMean).toFixed(2)) }));

/* ---------- write ---------- */
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);
write("event", { ...EVENT, judgeIds: JKEYS.map(jid) });
write("judges", judgeSeed);
write("criteria", criteria);
write("submissions", out.submissions);
write("dossiers", out.dossiers);
write("reviews", out.reviews);
write("live", out.live);
write("pipelines", out.pipelines);
write("arkiv", out.arkiv);
write("tournament", tournament);
write("fights", fights);
write("bets", bets);
write("storage", { network: "testnet", records: storage.sort((a, b) => b.txSeq - a.txSeq) });
write("graph", { graph: { nodes, edges }, judges: graphJudges, projects: graphProjects });
write("chain", {
  network: { name: "Base Sepolia", chainId: 84532, symbol: "ETH", explorerUrl: "https://sepolia.basescan.org" },
  token: { name: "FilterCoin", symbol: "FILTER", decimals: 18, rate: "10000" },
  demoWallet: { address: addr("demo-judge"), eth: "0.05", filter: "250" },
});

// A one-screen summary, so the story can be checked at a glance.
for (const { p, result, dossier, lt } of projects) {
  const ev = dossier.evidence;
  console.log(`${p.name.padEnd(18)} panel ${two(result.panelHundredths).padStart(6)} · claims ${ev.filter((e) => e.status === "supported_by_code").length}/${ev.length} supported, ${ev.filter((e) => e.status === "contradicted").length} contradicted · ${lt ? DEVICES.map((d) => `${d.label} ${deviceWord(lt, d.device)}`).join(" · ") : "no live test"} · review ${dur(plan(p, lt, dossier).end)}`);
}
for (const m of matches) console.log(`Match ${m.index + 1}: ${PROJECTS[m.projectA].name} ${two(m.scoreA)} vs ${PROJECTS[m.projectB].name} ${two(m.scoreB)} → ${PROJECTS[m.winner].name}${m.live ? " (live)" : ""}`);
for (const [m, list] of Object.entries(bets)) {
  const sum = (s) => list.filter((b) => b.side === s).reduce((x, b) => x + Number(b.amount), 0);
  console.log(`Bets match ${Number(m) + 1}: ${sum("a")} on ${PROJECTS[m * 2].name}, ${sum("b")} on ${PROJECTS[m * 2 + 1].name}`);
}
console.log(`${storage.length} files on 0G Storage`);
