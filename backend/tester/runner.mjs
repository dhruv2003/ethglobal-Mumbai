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
 * SAFETY: never pays, stakes, signs in, connects a wallet or submits. Every
 * click is checked against a deny-list of money/auth words and refused if it
 * matches. Typing is allowed; pressing Enter is not. Steps marked `requires`
 * are reported as blocked, never faked.
 *
 * Writes <outDir>/: smoke.json, <device>/video.mp4, <device>/smoke-<device>-<step>.jpg
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
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
async function connect(device) {
  const cfg = { projectId: PROJECT_ID, ...DEVICES[device].hub, video: true, consoleLogs: true, networkLogs: true };
  const url = `${HUB}?config=${encodeURIComponent(JSON.stringify(cfg))}`;
  try {
    return await chromium.connectOverCDP(url, { headers: { Authorization: `Bearer ${token}` }, timeout: 90000 });
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
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, ts: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth, maxHeight: 2000, everyNthFrame: 1 });
  const startedAt = Date.now();
  return {
    /** Seconds since recording began: used to link each step to its moment in the video. */
    now: () => Math.round(((Date.now() - startedAt) / 1000) * 10) / 10,
    async stop(outFile) {
      await cdp.send("Page.stopScreencast").catch(() => {});
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

async function guardedClick(loc, label) {
  const text = ((await loc.innerText().catch(() => "")) || label || "").trim();
  if (UNSAFE_CLICK.test(text) || UNSAFE_CLICK.test(label ?? "")) {
    const e = new Error(`Refused to click "${text.slice(0, 60)}": looks like a money or sign-in action`);
    e.refused = true;
    throw e;
  }
  await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
  await loc.click({ timeout: STEP_TIMEOUT });
}

async function act(page, a) {
  if (a.goto) {
    const res = await page.goto(abs(a.goto), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(600);
    if (res && res.status() >= 400) throw new Error(`${a.goto} returned ${res.status()}`);
    return;
  }
  if (a.click) return guardedClick(clickable(page, new RegExp(`^\\s*${esc(a.click)}\\s*$`, "i")), a.click);
  if (a.clickMatch) return guardedClick(clickable(page, new RegExp(esc(a.clickMatch), "i")), a.clickMatch);
  if (a.clickSelector) return guardedClick(page.locator(a.clickSelector).filter({ visible: true }).first(), a.clickSelector);
  if (a.openLink) {
    // Follow a link the page really renders (even inside a collapsed section) by its own href.
    const href = await page.locator(a.openLink).first().getAttribute("href", { timeout: STEP_TIMEOUT });
    if (!href) throw new Error(`no link matches ${a.openLink}`);
    return act(page, { goto: href });
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
  : a.expectSelected ? `"${a.expectSelected}" selected` : a.expectCountAtLeast ? `at least ${a.expectCountAtLeast.n} × ${a.expectCountAtLeast.selector}` : JSON.stringify(a);

async function runStep(page, device, dir, rec, step) {
  const out = { id: step.id, title: step.title, demoAt: step.demoAt ?? null, why: step.why ?? null, at: rec.now() };
  if (step.requires) return { ...out, status: "blocked", detail: `Needs ${step.requires}; not run.` };
  const t = Date.now();
  let i = 0;
  try {
    for (; i < step.do.length; i++) await act(page, step.do[i]);
    out.status = "passed";
    out.detail = step.do.filter((a) => !a.goto).map(describe).join(" · ");
  } catch (e) {
    if (isInfra(e)) throw e; // the cloud browser went away: not the app's fault, handled by the caller
    // A demo screen the site explorer never saw, and the browser can't find either: missing, not broken.
    out.status = e.refused ? "blocked" : step.unseenTarget ? "missing" : "failed";
    out.detail = `${describe(step.do[i] ?? {})}: ${String(e.message).split("\n")[0].slice(0, 200)}`;
  }
  out.ms = Date.now() - t;
  const file = `smoke-${device}-${step.id}.jpg`;
  await page.screenshot({ path: path.join(dir, file), type: "jpeg", quality: 80 }).catch(() => {});
  out.screenshot = `${device}/${file}`;
  console.log(`[${device}] ${step.id} ${out.status.padEnd(7)} ${step.title}`);
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
  try {
    console.log(`[${device}] connecting to Mozark…`);
    browser = await connect(device);
    result.browserVersion = browser.version();
    const ctx = await browser.newContext(spec.context);
    const page = await ctx.newPage();
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

    // Health: first load of the home page
    console.log(`[${device}] loading ${target}`);
    const t0 = Date.now();
    const res = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(800);
    result.home = { url: page.url(), status: res?.status() ?? null, wallMs: Date.now() - t0, ...(await pageFacts(page)) };

    for (const phase of flows.phases ?? []) {
      const steps = [];
      for (const step of phase.steps) steps.push(await runStep(page, device, dir, rec, step));
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
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  result.cancelledRequests = cancelledRequests;
  result.outcome = outcomeOf(result);
  console.log(`[${device}] ${result.outcome.status}: ${result.outcome.reasons.join("; ") || "no issues found"}`);
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
  if (!t) throw new Error("No Mozark token.");
  project = id;
  flows = f ?? { phases: [] };
  target = url ?? flows.target;
  if (!target) throw new Error("No live URL to test.");
  origin = new URL(target).origin;
  outDir = dir;
  token = t;
  flowsLabel = flowsSource;
  fs.mkdirSync(outDir, { recursive: true });

  const runs = [];
  for (const d of devices) {
    if (!DEVICES[d]) continue;
    let run = await runDevice(d);
    if (run.infrastructure) {
      console.log(`[${d}] cloud browser problem; retrying once in a fresh session (PRD TST-08)`);
      const retry = await runDevice(d);
      retry.retriedAfter = run.error;
      run = retry;
    }
    runs.push(run);
  }
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
    runner: { hub: "Mozark preprod (cdp-hub.preprod.mozark.ai)", tool: "Playwright connectOverCDP", script: "backend/tester/runner.mjs", flows: flowsLabel },
    mode: "Demo replay + major flows + health. Never pays, stakes, signs in, connects a wallet or submits.",
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
  token = t;
  const base = new URL(url);
  const browser = await connect("laptop");
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
