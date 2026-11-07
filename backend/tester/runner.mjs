#!/usr/bin/env node
/*
 * Live test engine: runs a project's flows on Mozark cloud browsers and records them.
 * Used by the review pipeline (backend/src/reviewer/pipeline.mjs) and by the
 * smoke.mjs command line.
 *
 *   runLiveTest({ project, target, flows, outDir, token, devices? }) -> summary
 *   discoverSite({ target, token }) -> what the site exposes (for writing flows)
 *
 * Per device (laptop, phone), one recorded session:
 *   1. Demo replay  - the screens the team's demo video shows (phase "demo")
 *   2. Major flows  - the app's main features (phase "features")
 *   3. Health       - status, load time, console errors, failed requests, layout
 *
 * SAFETY: never pays, stakes, signs in or submits. Every click is checked
 * against a deny-list of money/auth words and refused if it matches. Typing is
 * allowed; pressing Enter is not. Steps marked `requires` are reported as
 * blocked, never faked.
 *
 * Wallet (phase "wallet", only when flows has one): every page gets a MetaMask-compatible
 * test wallet (tester/wallet.mjs) with a throwaway key. It connects and signs; transactions
 * are simulated and rejected, never sent. In that phase only, money words (mint, stake,
 * approve...) may be clicked, since nothing they ask the wallet for can leave it; form
 * submits, deletes and sign-ups stay refused.
 *
 * Writes <outDir>/: smoke.json, <device>/video.mp4, <device>/smoke-<device>-<step>.jpg
 */
import { chromium } from "playwright";
import { createTestWallet } from "./wallet.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Progress lines go to the console and, during a pipeline run, to the review page.
let listener = null;
export function onRunnerLog(fn) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
function say(msg) {
  console.log(msg);
  try {
    listener?.(msg);
  } catch {
    /* a progress listener never breaks a run */
  }
}

const HUB = "wss://cdp-hub.preprod.mozark.ai/playwright";
const PROJECT_ID = process.env.MOZARK_PROJECT_ID ?? "b0ceec50-63c5-4a57-902b-c21046ee7cf2";
const STEP_TIMEOUT = 12000;

const DEVICES = {
  laptop: {
    label: "Laptop",
    hub: { browser: "chrome", resolution: "1920x1080" },
    context: { viewport: { width: 1440, height: 900 } },
    shotWidth: 1440,
  },
  phone: {
    label: "Phone",
    // A tall window, so the whole 844px phone viewport is on screen for the recording.
    hub: { browser: "chrome", resolution: "1920x1080" },
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    shotWidth: 780,
  },
};

/** Never click anything whose text looks like money or identity. */
export const UNSAFE_CLICK =
  /\b(pay|pays|stake|put \d|deposit|withdraw|claim|confirm|approve|sign ?in|sign ?up|log ?in|connect|wallet|submit|join|send|email me|verify|buy|mint|start a run|start$|delete|cancel)\b/i;

/**
 * The wallet phase's deny-list: on-chain actions are allowed (the test wallet never sends a
 * transaction), but anything with effects off the chain is still refused.
 */
export const WALLET_UNSAFE_CLICK = /\b(submit|delete|remove|email me|send email|sign ?up|log ?out|disconnect|cancel|unsubscribe|report|pay with card|checkout)\b/i;
const ruleFor = (phaseId) => (phaseId === "wallet" ? WALLET_UNSAFE_CLICK : UNSAFE_CLICK);

// ---------- run context (one live test at a time; see runLiveTest) ----------
let project;
let target;
let origin;
let outDir;
let flows;
let token;
let flowsLabel;
const abs = (p) => (p.startsWith("http") ? p : origin + p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- Mozark ----------
/** TESTER_LOCAL_BROWSER=1: a local headless Chromium instead of Mozark (development; `npx playwright install chromium`, or TESTER_LOCAL_CHANNEL=chrome to use an installed Chrome). */
const LOCAL = process.env.TESTER_LOCAL_BROWSER === "1";

async function connect(device, bearer = token) {
  if (LOCAL) return chromium.launch({ headless: true, ...(process.env.TESTER_LOCAL_CHANNEL ? { channel: process.env.TESTER_LOCAL_CHANNEL } : {}) });
  const cfg = { projectId: PROJECT_ID, ...DEVICES[device].hub, video: true, consoleLogs: true, networkLogs: true };
  const url = `${HUB}?config=${encodeURIComponent(JSON.stringify(cfg))}`;
  try {
    return await chromium.connectOverCDP(url, { headers: { Authorization: `Bearer ${bearer}` }, timeout: 90000 });
  } catch (e) {
    const msg = String(e.message || e);
    if (/401/.test(msg)) throw new Error("Mozark said 401: the token expired. Copy a new one from the portal and save it again.");
    if (/503|no_capacity/.test(msg)) throw new Error("Mozark said no_capacity: no free machine right now. Try again shortly.");
    throw e;
  }
}

// ---------- recording: Chrome screencast -> ffmpeg at real timing ----------
async function startRecording(ctx, page, dir, maxWidth) {
  const framesDir = path.join(dir, "frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  // The newest frame, for watching the run live (GET /api/projects/:id/live/stream/:device).
  // Written to a temp name and renamed, so a reader never gets half a JPEG.
  const liveFile = path.join(dir, "live.jpg");
  let lastLive = 0;
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    const jpg = Buffer.from(f.data, "base64");
    // A throw here is uncaught (event handler) and would take the whole server down with it.
    try {
      fs.writeFileSync(file, jpg);
      frames.push({ file, ts: f.metadata.timestamp });
    } catch {
      /* the run's folder was cleared under us (another run of the same project); drop the frame */
    }
    if (Date.now() - lastLive > 250) {
      lastLive = Date.now();
      try {
        fs.writeFileSync(`${liveFile}.tmp`, jpg);
        fs.renameSync(`${liveFile}.tmp`, liveFile);
      } catch {
        /* watching is best effort */
      }
    }
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth, maxHeight: 2000, everyNthFrame: 1 });
  const startedAt = Date.now();
  return {
    startedAt,
    /** Seconds since recording began: used to link each step to its moment in the video. */
    now: () => Math.round(((Date.now() - startedAt) / 1000) * 10) / 10,
    async stop(outFile) {
      await cdp.send("Page.stopScreencast").catch(() => {});
      fs.rmSync(liveFile, { force: true }); // the run is over: viewers switch to the recording
      await sleep(300);
      if (frames.length < 2) return { seconds: 0, frames: frames.length };
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const dur = i < frames.length - 1 ? Math.max(0.04, frames[i + 1].ts - frames[i].ts) : 1.0;
        lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(3)}`);
      }
      lines.push(`file '${frames.at(-1).file}'`);
      const list = path.join(framesDir, "list.txt");
      fs.writeFileSync(list, lines.join("\n"));
      execFileSync("ffmpeg", [
        "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=25", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "veryfast", "-crf", "28", "-movflags", "+faststart", outFile,
      ]);
      const seconds = frames.at(-1).ts - frames[0].ts + 1;
      fs.rmSync(framesDir, { recursive: true, force: true });
      return { seconds: Math.round(seconds * 10) / 10, frames: frames.length };
    },
  };
}

/** The remote browser or its connection died. PRD TST-08: never count this against the project. */
const isInfra = (e) => /has been closed|Target closed|Browser closed|disconnected|Connection closed|WebSocket/i.test(String(e?.message ?? e));

// ---------- page facts (health) ----------
async function pageFacts(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const imgs = [...document.images];
    return {
      title: document.title,
      h1: document.querySelector("h1")?.innerText.trim().slice(0, 120) ?? null,
      loadMs: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : null,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.src).length,
    };
  });
}

// ---------- flow actions ----------
/** First visible clickable element whose text matches. */
function clickable(page, re) {
  return page.locator("button, a, [role=tab], [role=radio], [role=button], [role=link], summary").filter({ hasText: re }).filter({ visible: true }).first();
}

async function guardedClick(loc, label, rule = UNSAFE_CLICK) {
  const text = ((await loc.innerText().catch(() => "")) || label || "").trim();
  if (rule.test(text) || rule.test(label ?? "")) {
    const e = new Error(`Refused to click "${text.slice(0, 60)}": looks like a money or sign-in action`);
    e.refused = true;
    throw e;
  }
  await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
  await loc.click({ timeout: STEP_TIMEOUT });
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Poll until fn() is true or ms pass. */
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(250);
  }
  return fn();
}

// What a dapp's "connect" button says, most specific first; then how wallet pickers name an injected wallet.
const CONNECT_OPENERS = [/connect\s+(a\s+|your\s+)?wallet/i, /^\s*connect\s*$/i, /sign\s*in\s+with\s+(ethereum|wallet|metamask)/i, /^\s*(log\s*in|sign\s*in)\s*$/i, /^\s*(launch|open)\s+app\s*$/i];
const PICK_INJECTED = /^\s*(metamask|browser wallet|injected(\s+wallet)?)\s*$/i;

/** Press the site's connect button, pick MetaMask if a wallet picker opens, wait for the dapp to ask for an account. */
async function connectWallet(page) {
  const w = page.__wallet;
  if (!w) throw new Error("this run has no test wallet");
  const did = [];
  if (!w.connected) {
    let opened = false;
    for (const re of CONNECT_OPENERS) {
      const loc = clickable(page, re);
      if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue;
      const t = (await loc.innerText().catch(() => "")).trim().replace(/\s+/g, " ").slice(0, 40);
      await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
      await loc.click({ timeout: STEP_TIMEOUT });
      did.push(`click "${t}"`);
      opened = true;
      break;
    }
    if (!opened) throw new Error("no Connect wallet button on the page");
    // Either the dapp asks the wallet at once, or it opens a wallet picker first.
    if (!(await waitFor(() => w.connected, 3500))) {
      const pick = page.getByText(PICK_INJECTED).filter({ visible: true }).first();
      if (await pick.count()) {
        const t = (await pick.innerText().catch(() => "MetaMask")).trim().slice(0, 30);
        await pick.click({ timeout: STEP_TIMEOUT });
        did.push(`pick "${t}"`);
      }
      if (!(await waitFor(() => w.connected, 12000))) throw new Error(`${did.join(", then ")}: the site never asked the wallet for an account`);
    }
    did.push(`wallet ${short(w.address)} connected`);
  } else did.push(`wallet ${short(w.address)} already connected`);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await sleep(1500);
  const body = (await page.evaluate(() => document.body.innerText).catch(() => "")).toLowerCase();
  const a = w.address.toLowerCase();
  did.push(body.includes(a.slice(0, 6)) && body.includes(a.slice(-4)) ? "address shown on the page" : "address not shown on the page");
  return did.join(" · ");
}

/** The dapp asked the wallet for something since the step began: connected, signature or transaction. */
async function expectWallet(page, kind) {
  const w = page.__wallet;
  if (!w) throw new Error("this run has no test wallet");
  const t0 = page.__stepStart ?? 0;
  const hit = () => (kind === "connected" ? w.connected : w.since(t0).some((e) => e.type === kind));
  if (!(await waitFor(hit, STEP_TIMEOUT))) throw new Error(kind === "connected" ? "the wallet isn't connected" : `the site never asked the wallet for a ${kind}`);
  if (kind === "connected") return "wallet connected";
  const e = w.since(t0).filter((x) => x.type === kind).at(-1);
  if (kind === "signature") return `wallet signed a ${e.what}`;
  const sim = e.simulation ?? {};
  const outcome = sim.ok === true ? `simulation: would succeed${sim.gas ? ` (${sim.gas.toLocaleString("en")} gas)` : ""}` : sim.ok === false ? `simulation: would revert (${sim.reason})` : "not simulated";
  return `wallet asked to send a transaction${e.to ? ` to ${short(e.to)}` : e.deploy ? " deploying a contract" : ""}${e.value && e.value !== "0" ? ` (${e.value})` : ""} · ${outcome} · rejected, never sent`;
}

async function act(page, a, phaseId) {
  const rule = ruleFor(phaseId);
  if (a.goto) {
    const res = await page.goto(abs(a.goto), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(600);
    if (res && res.status() >= 400) throw new Error(`${a.goto} returned ${res.status()}`);
    return;
  }
  if (a.click) return guardedClick(clickable(page, new RegExp(`^\\s*${esc(a.click)}\\s*$`, "i")), a.click, rule);
  if (a.clickMatch) return guardedClick(clickable(page, new RegExp(esc(a.clickMatch), "i")), a.clickMatch, rule);
  if (a.clickSelector) return guardedClick(page.locator(a.clickSelector).filter({ visible: true }).first(), a.clickSelector, rule);
  if (a.connectWallet) return connectWallet(page);
  if (a.expectWallet) return expectWallet(page, a.expectWallet);
  if (a.openLink) {
    // Follow a link the page really renders (even inside a collapsed section) by its own href.
    const href = await page.locator(a.openLink).first().getAttribute("href", { timeout: STEP_TIMEOUT });
    if (!href) throw new Error(`no link matches ${a.openLink}`);
    return act(page, { goto: href }, phaseId);
  }
  if (a.fill) {
    const loc = page.locator(a.fill.selector).filter({ visible: true }).first();
    await loc.fill(String(a.fill.value), { timeout: STEP_TIMEOUT });
    return;
  }
  if (a.expectText) {
    await page.getByText(a.expectText, { exact: false }).filter({ visible: true }).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    return;
  }
  if (a.expectUrl) {
    await page.waitForURL((u) => new URL(u).pathname.startsWith(a.expectUrl), { timeout: STEP_TIMEOUT });
    return;
  }
  if (a.expectSelected) {
    const loc = clickable(page, new RegExp(esc(a.expectSelected), "i"));
    const on = await loc.evaluate((el) => ["aria-pressed", "aria-selected", "aria-checked"].some((k) => el.getAttribute(k) === "true"), { timeout: STEP_TIMEOUT });
    if (!on) throw new Error(`"${a.expectSelected}" did not become selected`);
    return;
  }
  if (a.expectCountAtLeast) {
    const { selector, n } = a.expectCountAtLeast;
    await page.locator(selector).nth(n - 1).waitFor({ state: "attached", timeout: STEP_TIMEOUT });
    return;
  }
  if (a.wait) return sleep(a.wait);
  throw new Error(`Unknown action ${JSON.stringify(a)}`);
}

const describe = (a) =>
  a.goto ? `open ${a.goto}` : a.click ? `click "${a.click}"` : a.clickMatch ? `click "${a.clickMatch}…"` : a.clickSelector ? `click ${a.clickSelector}` : a.openLink ? `follow ${a.openLink}`
  : a.fill ? `type into ${a.fill.selector}` : a.expectText ? `see "${a.expectText}"` : a.expectUrl ? `land on ${a.expectUrl}`
  : a.expectSelected ? `"${a.expectSelected}" selected` : a.expectCountAtLeast ? `at least ${a.expectCountAtLeast.n} × ${a.expectCountAtLeast.selector}`
  : a.connectWallet ? "connect the wallet" : a.expectWallet ? `wallet asked for a ${a.expectWallet}` : JSON.stringify(a);

async function runStep(page, device, dir, rec, step, phaseId) {
  const out = { id: step.id, title: step.title, demoAt: step.demoAt ?? null, why: step.why ?? null, at: rec.now() };
  if (step.requires) return { ...out, status: "blocked", detail: `Needs ${step.requires}; not run.` };
  const t = Date.now();
  page.__stepStart = t;
  const notes = [];
  let i = 0;
  try {
    for (; i < step.do.length; i++) notes[i] = await act(page, step.do[i], phaseId);
    out.status = "passed";
    out.detail = step.do.map((a, k) => (typeof notes[k] === "string" ? notes[k] : a.goto ? null : describe(a))).filter(Boolean).join(" · ");
  } catch (e) {
    if (isInfra(e)) throw e; // the cloud browser went away: not the app's fault, handled by the caller
    // A demo screen the site explorer never saw, and the browser can't find either: missing, not broken.
    out.status = e.refused ? "blocked" : step.unseenTarget ? "missing" : "failed";
    out.detail = `${describe(step.do[i] ?? {})}: ${String(e.message).split("\n")[0].slice(0, 200)}`;
  }
  out.ms = Date.now() - t;
  const asked = page.__wallet?.since(t) ?? [];
  if (asked.length) out.walletEvents = asked.map(({ t: at, ...e }) => ({ ...e, at: Math.round((at - rec.startedAt) / 100) / 10 }));
  const file = `smoke-${device}-${step.id}.jpg`;
  await page.screenshot({ path: path.join(dir, file), type: "jpeg", quality: 80 }).catch(() => {});
  out.screenshot = `${device}/${file}`;
  say(`[${device}] ${step.id} ${out.status.padEnd(7)} ${step.title}`);
  return out;
}

// ---------- one device ----------
async function runDevice(device) {
  const spec = DEVICES[device];
  const dir = path.join(outDir, device);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.(png|jpg|mp4)$/.test(f)) fs.rmSync(path.join(dir, f));

  const started = Date.now();
  const result = { device, label: spec.label, viewport: spec.context.viewport, startedAt: new Date().toISOString(), phases: [] };
  const consoleErrors = [];
  const failedRequests = [];
  const cancelledRequests = []; // net::ERR_ABORTED: cancelled by our own navigation or prefetch; not a site fault
  let browser;
  let rec;
  let wallet = null;
  let recStartedAt = null;
  try {
    say(`[${device}] ${LOCAL ? "starting a local browser…" : "connecting to Mozark…"}`);
    browser = await connect(device);
    result.browserVersion = browser.version();
    say(`[${device}] ${LOCAL ? "local" : "cloud"} browser ready (Chrome ${String(result.browserVersion).split(".")[0]}, ${spec.context.viewport.width}×${spec.context.viewport.height}); recording`);
    const ctx = await browser.newContext(spec.context);
    // A wallet phase: every page of this session gets the test wallet, from the first load.
    if ((flows.phases ?? []).some((p) => p.id === "wallet")) {
      wallet = createTestWallet({ log: (m) => say(`[${device}] wallet ${m}`) });
      await wallet.install(ctx);
    }
    const page = await ctx.newPage();
    page.__wallet = wallet;
    page.on("console", (m) => m.type() === "error" && consoleErrors.length < 20 && consoleErrors.push(m.text().slice(0, 240)));
    page.on("pageerror", (e) => consoleErrors.length < 20 && consoleErrors.push(`Uncaught: ${String(e.message).slice(0, 220)}`));
    page.on("requestfailed", (r) => {
      const error = r.failure()?.errorText ?? "failed";
      const bucket = /ERR_ABORTED|NS_BINDING_ABORTED/.test(error) ? cancelledRequests : failedRequests;
      if (bucket.length < 20) bucket.push({ url: r.url().slice(0, 200), error });
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && failedRequests.length < 20) failedRequests.push({ url: r.url().slice(0, 200), status: r.status() });
    });
    rec = await startRecording(ctx, page, dir, spec.shotWidth);
    recStartedAt = rec.startedAt;

    // Health: first load of the home page
    say(`[${device}] loading ${target}`);
    const t0 = Date.now();
    const res = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(800);
    result.home = { url: page.url(), status: res?.status() ?? null, wallMs: Date.now() - t0, ...(await pageFacts(page)) };

    for (const phase of flows.phases ?? []) {
      const steps = [];
      for (const step of phase.steps) steps.push(await runStep(page, device, dir, rec, step, phase.id));
      result.phases.push({ id: phase.id, title: phase.title, about: phase.about, steps });
    }

    const v = await rec.stop(path.join(dir, "video.mp4"));
    rec = null;
    result.video = v.frames > 1 ? { file: `${device}/video.mp4`, seconds: v.seconds, frames: v.frames } : null;
  } catch (e) {
    result.error = String(e.message || e).slice(0, 300);
    result.infrastructure = isInfra(e) || /Mozark said/.test(result.error);
    console.error(`[${device}] ${result.error}`);
    if (rec) {
      const v = await rec.stop(path.join(dir, "video.mp4")).catch(() => null);
      result.video = v?.frames > 1 ? { file: `${device}/video.mp4`, seconds: v.seconds, frames: v.frames } : null;
    }
  } finally {
    await browser?.close().catch(() => {});
  }
  result.durationMs = Date.now() - started;
  if (wallet) result.wallet = wallet.summary(recStartedAt);
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  result.cancelledRequests = cancelledRequests;
  result.outcome = outcomeOf(result);
  say(`[${device}] ${result.outcome.status}: ${result.outcome.reasons.join("; ") || "no issues found"}`);
  return result;
}

export function countSteps(steps) {
  const c = { passed: 0, failed: 0, blocked: 0, missing: 0 };
  for (const s of steps) c[s.status] = (c[s.status] ?? 0) + 1;
  return c;
}

/** passed | issues | failed, with reasons in words. A demo screen that is missing is the loudest reason. */
function outcomeOf(r) {
  const reasons = [];
  if (r.infrastructure) return { status: "error", reasons: [`Cloud browser problem, not the app: ${r.error}`] };
  if (r.error && !r.home) return { status: "failed", reasons: [r.error] };
  if (!r.home?.status || r.home.status >= 400) return { status: "failed", reasons: [`Home page returned ${r.home?.status ?? "no response"}`] };
  for (const ph of r.phases) {
    const c = countSteps(ph.steps);
    if (c.failed) reasons.push(`${ph.title}: ${c.failed} step(s) failed`);
    if (c.missing) reasons.push(`${ph.title}: ${c.missing} demo screen(s) not found on the live site`);
  }
  if (r.home.horizontalScroll) reasons.push("Page scrolls sideways");
  if (r.home.brokenImages) reasons.push(`${r.home.brokenImages} broken image(s)`);
  if (r.consoleErrors.length) reasons.push(`${r.consoleErrors.length} console error(s)`);
  if (r.failedRequests.length) reasons.push(`${r.failedRequests.length} failed request(s)`);
  if (r.error) reasons.push(r.error);
  return { status: reasons.length ? "issues" : "passed", reasons };
}

// ---------- public API ----------
let lock = Promise.resolve();

/** Run the flows on laptop and phone. One run at a time (the engine keeps per-run state). */
export function runLiveTest(opts) {
  const job = lock.then(() => runLiveTestNow(opts));
  lock = job.catch(() => {});
  return job;
}

async function runLiveTestNow({ project: id, target: url, flows: f, outDir: dir, token: t, devices = ["laptop", "phone"], flowsSource = null }) {
  if (!t && !LOCAL) throw new Error("No Mozark token.");
  project = id;
  flows = f ?? { phases: [] };
  target = url ?? flows.target;
  if (!target) throw new Error("No live URL to test.");
  origin = new URL(target).origin;
  outDir = dir;
  token = t;
  flowsLabel = flowsSource;
  fs.mkdirSync(outDir, { recursive: true });

  // Laptop and phone run at the same time, each in its own cloud browser (about half the wall time).
  const one = async (d) => {
    let run = await runDevice(d);
    if (run.infrastructure) {
      say(`[${d}] cloud browser problem; retrying once in a fresh session (PRD TST-08)`);
      const retry = await runDevice(d);
      retry.retriedAfter = run.error;
      run = retry;
    }
    return run;
  };
  const runs = await Promise.all(devices.filter((d) => DEVICES[d]).map(one));
  // Keep other devices' results when only some devices were run.
  const previous = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(outDir, "smoke.json"), "utf8"));
    } catch {
      return null;
    }
  })();
  const kept = previous?.target === target ? (previous.runs ?? []).filter((r) => !runs.some((x) => x.device === r.device)) : [];
  runs.unshift(...kept);
  runs.sort((a, b) => Object.keys(DEVICES).indexOf(a.device) - Object.keys(DEVICES).indexOf(b.device));
  const summary = {
    project,
    target,
    ranAt: new Date().toISOString(),
    runner: { hub: LOCAL ? "local headless Chromium" : "Mozark preprod (cdp-hub.preprod.mozark.ai)", tool: LOCAL ? "Playwright" : "Playwright connectOverCDP", script: "backend/tester/runner.mjs", flows: flowsLabel },
    mode: (flows.phases ?? []).some((p) => p.id === "wallet")
      ? "Demo replay + major flows + wallet + health. Wallet steps use a MetaMask-compatible test wallet with a throwaway key: it connects and signs; transactions are simulated and rejected, never sent. Never pays, signs up or submits forms."
      : "Demo replay + major flows + health. Never pays, stakes, signs in, connects a wallet or submits.",
    runs,
  };
  fs.writeFileSync(path.join(outDir, "smoke.json"), JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * Explore a live site on a cloud browser so flows can be written against what
 * really exists: home plus up to `maxPages` same-site pages. Read-only: it
 * only loads pages and reads them; it clicks nothing.
 */
export async function discoverSite({ target: url, token: t, maxPages = 6 }) {
  // Not under runLiveTest's lock, so it must not touch the run context: pass the token directly.
  const base = new URL(url);
  say("[explore] connecting to Mozark…");
  const browser = await connect("laptop", t);
  say("[explore] connected; reading the home page");
  try {
    const ctx = await browser.newContext(DEVICES.laptop.context);
    const page = await ctx.newPage();
    const read = () =>
      page.evaluate(() => {
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const txt = (sel, n) => [...document.querySelectorAll(sel)].filter(vis).map((x) => x.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, n);
        return {
          path: location.pathname + location.search,
          title: document.title,
          headings: txt("h1,h2,h3", 25),
          buttons: txt("button,[role=tab],[role=button]", 40),
          links: [...document.querySelectorAll("a[href]")].filter(vis).map((a) => ({ text: a.innerText.trim().replace(/\s+/g, " ").slice(0, 60), href: a.href, attr: a.getAttribute("href") })).slice(0, 60),
          inputs: [...document.querySelectorAll("input,textarea,select")].filter(vis).map((i) => i.getAttribute("aria-label") || i.placeholder || i.name || i.id || i.type).slice(0, 20),
          text: document.body.innerText.replace(/\s+\n/g, "\n").slice(0, 2500),
        };
      });
    const pages = [];
    await page.goto(base.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(1200);
    const home = await read();
    pages.push(home);
    const seen = new Set([new URL(page.url()).pathname]);
    const next = home.links
      .map((l) => {
        try {
          return new URL(l.href);
        } catch {
          return null;
        }
      })
      .filter((u) => u && u.origin === base.origin && !seen.has(u.pathname) && !/(logout|sign-?out|api\/|\.(pdf|zip|apk)$)/i.test(u.pathname))
      .filter((u) => !seen.has(u.pathname) && seen.add(u.pathname));
    for (const u of next.slice(0, maxPages - 1)) {
      say(`[explore] reading ${u.pathname}`);
      try {
        const r = await page.goto(u.origin + u.pathname, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await sleep(800);
        pages.push({ ...(await read()), status: r?.status() ?? null });
      } catch (e) {
        pages.push({ path: u.pathname, error: String(e.message).slice(0, 120) });
      }
    }
    return { target: base.href, exploredAt: new Date().toISOString(), pages };
  } finally {
    await browser.close().catch(() => {});
  }
}
