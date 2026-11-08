/*
 * DEMO: the backend, in the browser. lib/api.js sends every /api request here; each answer
 * comes from src/data/*.json (built from scripts/story.mjs) plus a little session state:
 * a review you replay ticks through its steps, and a live fight stays sealed until betting closes.
 */
import event from "@data/event.json";
import ensData from "@data/ens.json";
import judgesData from "@data/judges.json";
import criteria from "@data/criteria.json";
import submissions from "@data/submissions.json";
import dossiers from "@data/dossiers.json";
import reviews from "@data/reviews.json";
import live from "@data/live.json";
import pipelines from "@data/pipelines.json";
import arkiv from "@data/arkiv.json";
import tournament from "@data/tournament.json";
import fights from "@data/fights.json";
import storage from "@data/storage.json";
import graph from "@data/graph.json";
import { cutoffOf } from "./sim.js";

const MEDIA = { "go-health-me": "go-health-me", "mozark-app-studio": "mozark" };
export const mediaDir = (id) => MEDIA[id] ?? id;

/* ---------- replaying a review: the pipeline ticks through its steps ---------- */
const REPLAY_MS = 60000; // the whole review (about 25 minutes) replays in a minute
const replays = new Map(); // projectId -> start ms
export const startReplay = (id) => replays.set(id, Date.now());
const replayAt = (id) => {
  const start = replays.get(id);
  if (start == null) return null;
  const e = Date.now() - start;
  if (e >= REPLAY_MS) {
    replays.delete(id);
    return null;
  }
  return { start, e };
};

function replayPipeline(id) {
  const base = pipelines[id];
  const r = replayAt(id);
  if (!base || !r) return base;
  const t0 = Date.parse(base.state.startedAt);
  const total = Date.parse(base.state.finishedAt) - t0;
  const scale = total / REPLAY_MS;
  const storyNow = t0 + r.e * scale;
  const real = (iso) => (iso ? new Date(r.start + (Date.parse(iso) - t0) / scale).toISOString() : null);
  const phase = (startedAt, finishedAt) => {
    const a = Date.parse(startedAt);
    const b = Date.parse(finishedAt ?? startedAt);
    return storyNow < a ? "queued" : storyNow < b ? "running" : null;
  };
  const steps = base.state.steps.map((s) => {
    const ph = phase(s.startedAt, s.finishedAt);
    if (!ph) return { ...s, startedAt: real(s.startedAt), finishedAt: real(s.finishedAt) };
    const parts = s.parts.map((p) => {
      const pp = phase(p.startedAt, p.finishedAt);
      return pp ? { ...p, status: pp, detail: pp === "running" ? "" : p.detail, startedAt: pp === "queued" ? null : real(p.startedAt), finishedAt: null } : { ...p, startedAt: real(p.startedAt), finishedAt: real(p.finishedAt) };
    });
    const doing = parts.find((p) => p.status === "running");
    return { ...s, status: ph, detail: ph === "running" ? (doing?.label ?? "Working…") : "", facts: [], parts, startedAt: ph === "queued" ? null : real(s.startedAt), finishedAt: null };
  });
  return { ...base, running: true, review: { status: "reviewing" }, state: { ...base.state, steps, startedAt: real(base.state.startedAt), finishedAt: null } };
}

const liveStepRunning = (id) => replayPipeline(id)?.state?.steps?.find((s) => s.id === "live")?.status === "running";

/* ---------- judges: edits last for the session; every save is a new version ---------- */
const judges = structuredClone(judgesData);
function saveJudge(id, body) {
  const now = new Date().toISOString();
  const i = judges.findIndex((j) => j.id === id);
  if (i < 0) {
    const j = { ...body, id: `judge_${Date.now().toString(16)}`, version: 1, promptVersion: "judge-v3", createdAt: now, updatedAt: now };
    judges.push(j);
    return j;
  }
  judges[i] = { ...judges[i], ...body, id, version: (judges[i].version ?? 1) + 1, updatedAt: now };
  return judges[i];
}

/* ---------- submissions made in the demo ---------- */
const added = [];
const deleted = new Set();
const allSubmissions = () =>
  [...added, ...submissions].filter((s) => !deleted.has(s.id)).map((s) => (replayAt(s.id) ? { ...s, review: { status: "reviewing" } } : s));

/* ---------- fights: sealed while betting is open ---------- */
function fightOf(t, m) {
  const f = fights[`${t}-${m}`];
  if (!f) return { status: "none", judges: tournament.matches.length ? fights["1-0"].cast : {} };
  if (!f.live) return f;
  const cutoff = cutoffOf(Number(m));
  if (Date.now() < cutoff) return { status: "sealed", revealAt: cutoff, judges: f.cast };
  // Recorded before the cutoff, revealed after it: rebase its clock to this session.
  const shift = cutoff - 120000 - Date.parse(f.events[0].ts);
  return { ...f, ranAt: new Date(cutoff - 30000).toISOString(), events: f.events.map((e) => ({ ...e, ts: new Date(Date.parse(e.ts) + shift).toISOString() })) };
}

/* ---------- routes ---------- */
const notFound = (what = "Not found") => Object.assign(new Error(what), { status: 404 });
const ROUTES = [
  ["GET", /^\/health$/, () => ({ ok: true, mode: "demo", model: "0gm-1.0-35b-a3b", provider: "0g", judgesReady: true, maxJudges: 5 })],
  ["GET", /^\/events$/, () => [event]],
  ["GET", /^\/events\/([^/]+)$/, ([id]) => (id === event.id ? event : Promise.reject(notFound()))],
  ["GET", /^\/criteria$/, () => criteria],
  ["GET", /^\/judges$/, () => judges],
  ["POST", /^\/judges$/, (_, body) => saveJudge(null, body)],
  ["PUT", /^\/judges\/([^/]+)$/, ([id], body) => saveJudge(id, body)],
  ["DELETE", /^\/judges\/([^/]+)$/, ([id]) => (judges.splice(judges.findIndex((j) => j.id === id) >>> 0, 1), null)],
  ["GET", /^\/organizer/, () => ({ isOrganizer: false })],
  ["GET", /^\/submissions$/, () => allSubmissions()],
  ["POST", /^\/submissions$/, (_, body) => {
    const id = `demo-${Date.now().toString(36)}`;
    added.unshift({ ...body, id, submittedAt: new Date().toISOString(), signed: true, review: { status: "reviewing" }, hasDossier: false, video: null });
    return { id, review: { status: "reviewing", position: 1, ahead: 0 } };
  }],
  ["DELETE", /^\/projects\/([^/]+)$/, ([id]) => (deleted.add(id), null)],
  ["GET", /^\/projects\/([^/]+)\/pipeline$/, ([id]) => replayPipeline(id) ?? { running: false, review: { status: "queued" }, queueLength: 1, state: null }],
  ["POST", /^\/projects\/([^/]+)\/pipeline$/, ([id]) => (startReplay(id), { review: { status: "reviewing", position: 0 } })],
  ["GET", /^\/projects\/([^/]+)\/dossier$/, ([id]) => ({ dossier: dossiers[id] ?? null })],
  ["GET", /^\/projects\/([^/]+)\/reviews$/, ([id]) => ({ running: false, progress: null, result: reviews[id] ?? null })],
  ["POST", /^\/projects\/([^/]+)\/reviews$/, ([id]) => ({ result: reviews[id] ?? null })],
  ["GET", /^\/projects\/([^/]+)\/live$/, ([id]) => ({ liveTest: live[id] ?? null })],
  ["GET", /^\/projects\/([^/]+)\/live\/now$/, ([id]) => ({ laptop: liveStepRunning(id), android: liveStepRunning(id), ios: liveStepRunning(id) })],
  ["GET", /^\/projects\/([^/]+)\/arkiv$/, ([id]) => arkiv[id] ?? { configured: { read: true }, onchain: null }],
  ["GET", /^\/projects\/([^/]+)\/video$/, ([id]) => ({ video: submissions.find((s) => s.id === id)?.video ?? null })],
  ["GET", /^\/arena\/tournaments$/, () => [tournament]],
  ["GET", /^\/arena\/tournaments\/([^/]+)$/, ([id]) => (String(id) === String(tournament.id) ? tournament : Promise.reject(notFound()))],
  ["GET", /^\/arena\/fights\/([^/]+)\/(\d+)$/, ([t, m]) => fightOf(t, m)],
  ["GET", /^\/arena\/auto$/, () => ({ organizer: false, publisher: false, address: null, ready: false })],
  ["GET", /^\/payouts$/, () => ({ enabled: true })],
  ["GET", /^\/ens$/, () => ensData.config], // the real names on Sepolia; records are read live in the browser
  ["GET", /^\/graph$/, () => graph.graph],
  ["GET", /^\/graph\/judges$/, () => graph.judges],
  ["GET", /^\/graph\/projects\/([^/]+)\/similar$/, ([key]) => graph.projects[key]?.similar ?? []],
  ["GET", /^\/graph\/projects\/([^/]+)$/, ([key]) => graph.projects[key]?.explain ?? Promise.reject(notFound())],
  ["GET", /^\/storage$/, () => ({ enabled: true, network: "testnet", chainId: 16602, files: storage.records.length, outbox: { pending: 0, failed: 0 }, failed: [], wallet: tournament.publisher })],
  ["GET", /^\/storage\/records$/, () => storage],
  ["POST", /^\/storage\/verify\/([^/]+)\/(.+)$/, ([, id]) => {
    const r = storage.records.find((x) => x.id === id);
    return new Promise((res) => setTimeout(() => res({ match: Boolean(r), rootHash: r?.rootHash }), 900));
  }],
];

/** Answer one /api request. Resolves with the JSON body; rejects with { status } like a failed fetch. */
export async function serve(path, method = "GET", body) {
  const [p] = path.split("?");
  const clean = decodeURIComponent(p);
  for (const [m, re, fn] of ROUTES) {
    if (m !== method) continue;
    const hit = clean.match(re);
    if (!hit) continue;
    // A short, varied delay: the app's loading states still get a moment on screen.
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
    return structuredClone(await fn(hit.slice(1), body));
  }
  throw Object.assign(new Error(`The demo has no ${method} ${p}`), { status: 404 });
}

/* ---------- file URLs the backend would serve ---------- */
const liveShots = (id, device) => (live[id]?.runs.find((r) => r.device === device)?.phases ?? []).flatMap((ph) => ph.steps).map((s) => s.screenshot).filter(Boolean);

/** Map a backend file URL ("/api/...") to its local copy in public/media. */
export function demoFileUrl(url) {
  let m = url.match(/^\/api\/projects\/([^/]+)\/live\/files(\/.*)?$/);
  if (m) return `/media/${mediaDir(decodeURIComponent(m[1]))}${m[2] ?? ""}`;
  m = url.match(/^\/api\/projects\/([^/]+)\/live\/stream\/(laptop|android|ios)/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const shots = liveShots(id, m[2]);
    const n = Number(new URL(url, location.origin).searchParams.get("n") ?? 0);
    return shots.length ? `/media/${mediaDir(id)}/${shots[n % shots.length]}` : "";
  }
  m = url.match(/^\/api\/storage\/blob\/(0x[0-9a-f]+)/);
  if (m) {
    const r = storage.records.find((x) => x.rootHash === m[1]);
    if (r && /\.(jpg|svg)$/.test(r.name)) return `/media/${mediaDir(r.scope)}/${r.name.replace(/^live\//, "")}`;
    return r?.links.file ?? "#";
  }
  return url;
}
