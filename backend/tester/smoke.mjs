#!/usr/bin/env node
/*
 * Smoke-test a project's live app on Mozark cloud browsers and record it.
 *
 *   set -a; source ~/.mozark.env; set +a
 *   node smoke.mjs --project go-health-me --url https://www.gohealthme.app
 *
 * For each device (laptop, phone) it opens a remote Chrome, loads the app,
 * scrolls it, visits up to 3 same-site links, and records what it sees.
 * It never clicks buttons or fills forms: no wallets, no payments, no sign-ins.
 * That keeps it read-only, which is what "smoke check" means in PRD TST-02.
 *
 * Writes backend/fixtures/<project>/smoke/:
 *   smoke.json                     results for every device
 *   <device>/video.mp4             our own recording (Chrome screencast -> ffmpeg)
 *   <device>/smoke-<device>-*.png  screenshots
 * Mozark also keeps its own video/logs per session (portal: Automation -> Sessions).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB = "wss://cdp-hub.preprod.mozark.ai/playwright";
const PROJECT_ID = process.env.MOZARK_PROJECT_ID ?? "b0ceec50-63c5-4a57-902b-c21046ee7cf2";

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

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const project = args.project;
const target = args.url;
const devices = (args.devices ?? "laptop,phone").split(",").map((d) => d.trim());
if (!project || !target) {
  console.error("usage: node smoke.mjs --project <fixture-id> --url <https://app> [--devices laptop,phone]");
  process.exit(2);
}
if (!process.env.MOZARK_TOKEN) {
  console.error("MOZARK_TOKEN is not set. Run: set -a; source ~/.mozark.env; set +a");
  process.exit(2);
}
const outDir = path.resolve(here, "../fixtures", project, "smoke");
fs.mkdirSync(outDir, { recursive: true });

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const origin = new URL(target).origin;
const SKIP_LINK = /(logout|sign-?out|login|sign-?in|auth|api\/|wallet|connect|delete|\.pdf$|\.zip$|mailto:|tel:)/i;

async function connect(device) {
  const cfg = { projectId: PROJECT_ID, ...DEVICES[device].hub, video: true, consoleLogs: true, networkLogs: true };
  const url = `${HUB}?config=${encodeURIComponent(JSON.stringify(cfg))}`;
  try {
    return await chromium.connectOverCDP(url, { headers: { Authorization: `Bearer ${process.env.MOZARK_TOKEN}` }, timeout: 90000 });
  } catch (e) {
    const msg = String(e.message || e);
    if (/401/.test(msg)) throw new Error("Mozark said 401: the token expired. Copy a new one from the portal and save it again.");
    if (/503|no_capacity/.test(msg)) throw new Error("Mozark said no_capacity: no free machine right now. Try again shortly.");
    throw e;
  }
}

/** Record the tab with Chrome's screencast; frames carry real timestamps so playback speed is true. */
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
  return {
    async stop(outFile) {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await sleep(300);
      if (frames.length < 2) return { seconds: 0, frames: frames.length };
      // concat list with each frame's real on-screen duration
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

async function pageFacts(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const imgs = [...document.images];
    return {
      title: document.title,
      h1: document.querySelector("h1")?.innerText.trim().slice(0, 120) ?? null,
      loadMs: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.src).length,
      imagesMissingAlt: imgs.filter((i) => !i.hasAttribute("alt")).length,
      textLength: document.body?.innerText.length ?? 0,
    };
  });
}

async function scrollThrough(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const steps = Math.min(6, Math.max(1, Math.ceil(h / 600)));
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), (h * i) / steps);
    await sleep(700);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await sleep(600);
}

async function sameSiteLinks(page) {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  const seen = new Set([new URL(page.url()).pathname]);
  const out = [];
  for (const h of hrefs) {
    let u;
    try {
      u = new URL(h);
    } catch {
      continue;
    }
    if (u.origin !== origin || SKIP_LINK.test(u.pathname) || seen.has(u.pathname)) continue;
    seen.add(u.pathname);
    out.push(u.origin + u.pathname);
    if (out.length >= 3) break;
  }
  return out;
}

// ---------- one device ----------
async function runDevice(device) {
  const spec = DEVICES[device];
  const dir = path.join(outDir, device);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".png") || f.endsWith(".mp4")) fs.rmSync(path.join(dir, f));

  const started = Date.now();
  const result = { device, label: spec.label, viewport: spec.context.viewport, startedAt: new Date().toISOString() };
  const consoleErrors = [];
  const failedRequests = [];
  const cancelledRequests = []; // net::ERR_ABORTED: cancelled by our own navigation or prefetch; not a site fault
  const screenshots = [];
  let browser;
  let recorder;
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
    recorder = await startRecording(ctx, page, dir, spec.shotWidth);

    const shot = async (name) => {
      const file = `smoke-${device}-${name}.png`;
      await page.screenshot({ path: path.join(dir, file) });
      screenshots.push({ name, file: `${device}/${file}` });
    };

    console.log(`[${device}] loading ${target}`);
    const t0 = Date.now();
    const res = await page.goto(target, { waitUntil: "load", timeout: 60000 });
    result.home = { url: page.url(), status: res?.status() ?? null, wallMs: Date.now() - t0 };
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    Object.assign(result.home, await pageFacts(page));
    await shot("home");

    await scrollThrough(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(500);
    await shot("bottom");

    result.pages = [];
    for (const link of await sameSiteLinks(page)) {
      const t = Date.now();
      try {
        const r = await page.goto(link, { waitUntil: "load", timeout: 45000 });
        await sleep(1200);
        const facts = await pageFacts(page);
        result.pages.push({ path: new URL(link).pathname, status: r?.status() ?? null, ms: Date.now() - t, title: facts.title, horizontalScroll: facts.horizontalScroll });
        await shot(`page${result.pages.length}`);
      } catch (e) {
        result.pages.push({ path: new URL(link).pathname, status: null, ms: Date.now() - t, error: String(e.message).slice(0, 160) });
      }
    }
    await page.goto(target, { waitUntil: "load", timeout: 45000 }).catch(() => {});
    await sleep(1000);

    const rec = await recorder.stop(path.join(dir, "video.mp4"));
    recorder = null;
    result.video = rec.frames > 1 ? { file: `${device}/video.mp4`, seconds: rec.seconds, frames: rec.frames } : null;
  } catch (e) {
    result.error = String(e.message || e).slice(0, 300);
    console.error(`[${device}] ${result.error}`);
    if (recorder) {
      const rec = await recorder.stop(path.join(dir, "video.mp4")).catch(() => null);
      result.video = rec?.frames > 1 ? { file: `${device}/video.mp4`, seconds: rec.seconds, frames: rec.frames } : null;
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  result.durationMs = Date.now() - started;
  result.screenshots = screenshots;
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  result.cancelledRequests = cancelledRequests;
  result.outcome = outcomeOf(result);
  console.log(`[${device}] ${result.outcome.status}: ${result.outcome.reasons.join("; ") || "no issues found"}`);
  return result;
}

/** passed | issues | failed, with reasons in words. */
function outcomeOf(r) {
  const reasons = [];
  if (r.error && !r.home) return { status: "failed", reasons: [r.error] };
  if (!r.home?.status || r.home.status >= 400) return { status: "failed", reasons: [`Home page returned ${r.home?.status ?? "no response"}`] };
  if (r.home.horizontalScroll) reasons.push("Page scrolls sideways");
  if (r.home.brokenImages) reasons.push(`${r.home.brokenImages} broken image(s)`);
  if (r.consoleErrors.length) reasons.push(`${r.consoleErrors.length} console error(s)`);
  if (r.failedRequests.length) reasons.push(`${r.failedRequests.length} failed request(s)`);
  const badPages = (r.pages ?? []).filter((p) => !p.status || p.status >= 400);
  if (badPages.length) reasons.push(`${badPages.length} linked page(s) failed`);
  if (r.error) reasons.push(r.error);
  return { status: reasons.length ? "issues" : "passed", reasons };
}

// ---------- main ----------
const runs = [];
for (const d of devices) {
  if (!DEVICES[d]) {
    console.error(`unknown device ${d}`);
    continue;
  }
  runs.push(await runDevice(d));
}
const summary = {
  project,
  target,
  ranAt: new Date().toISOString(),
  runner: { hub: "Mozark preprod (cdp-hub.preprod.mozark.ai)", tool: "Playwright connectOverCDP", script: "backend/tester/smoke.mjs" },
  mode: "read-only smoke check: load, scroll, visit up to 3 same-site links; no clicks on buttons or forms",
  runs,
};
fs.writeFileSync(path.join(outDir, "smoke.json"), JSON.stringify(summary, null, 2));
console.log(`\nwrote ${path.relative(process.cwd(), path.join(outDir, "smoke.json"))}`);
process.exit(runs.some((r) => r.outcome.status === "failed") ? 1 : 0);
