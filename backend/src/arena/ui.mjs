/*
 * Collect the images a fight's UI face-off looks at, for one project:
 *   - the team's own screenshots (uploaded with the submission)
 *   - frames from our saved copy of the demo video
 *   - screenshots from the live test (one per device)
 * Every image goes through ffmpeg (local file, forced demuxer, like media.mjs) and comes
 * out as a small JPEG, so one 0G vision call can hold both projects.
 *
 *   UI_IMAGES_PER_KIND   max images of each kind per project (default 2)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { liveDir, mediaDir, videos } from "../store.mjs";
import { head, IMAGE_REF, lockedInput, sniffImage, sniffVideo, UPLOAD_DIR } from "../reviewer/media.mjs";

const run = promisify(execFile);
const PER_KIND = Math.max(0, Number(process.env.UI_IMAGES_PER_KIND ?? 2) || 0);
const IMAGE_DEMUXER = { png: "png_pipe", jpg: "jpeg_pipe", webp: "webp_pipe" };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** One frame (or one still) scaled to fit 768×1024, as JPEG bytes. */
async function shrink(file, demuxer, out, at = null) {
  const seek = at == null ? [] : ["-ss", String(at)];
  await run(
    "ffmpeg",
    ["-v", "error", "-y", ...seek, ...lockedInput(demuxer, file), "-frames:v", "1", "-vf", "scale=w=768:h=1024:force_original_aspect_ratio=decrease", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", out],
    { timeout: 30000 },
  );
  return fs.readFileSync(out);
}

/** A file path inside dir, or null if `name` would escape it. */
function inside(dir, name) {
  const p = path.resolve(dir, String(name ?? ""));
  return p.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(p) ? p : null;
}

function teamShots(sub) {
  return (sub.demoImages ?? [])
    .map((ref) => IMAGE_REF.exec(String(ref))?.[1])
    .filter(Boolean)
    .map((f) => inside(UPLOAD_DIR, f))
    .filter(Boolean)
    .map((file, i) => ({ file, demuxer: IMAGE_DEMUXER[sniffImage(head(file, 16))], label: `team screenshot ${i + 1}` }))
    .filter((x) => x.demuxer);
}

function videoFrames(sub) {
  const v = videos.get(sub.id);
  if (!v?.ext || v.error) return [];
  const file = inside(mediaDir(sub.id), `demo.${v.ext}`);
  const demuxer = file && sniffVideo(head(file))?.demuxer;
  if (!demuxer) return [];
  const secs = Number(v.seconds) || 0;
  const times = secs > 2 ? [0.3, 0.7, 0.5, 0.15, 0.85].map((f) => Math.floor(secs * f)) : [0];
  return times.map((at) => ({ file, demuxer, at, label: `demo video frame at ${fmt(at)}` }));
}

function liveShots(sub) {
  const dir = liveDir(sub.id);
  let smoke = null;
  try {
    smoke = JSON.parse(fs.readFileSync(path.join(dir, "smoke.json"), "utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const r of smoke?.runs ?? []) {
    const shots = (phase) => (r.phases ?? []).filter((p) => (phase ? p.id === phase : p.id !== "demo")).flatMap((p) => p.steps ?? []).filter((s) => s.screenshot);
    // A passed demo-replay step shows a real app screen. Start mid-demo: step one is usually the landing page.
    const demo = shots("demo").filter((s) => s.status === "passed");
    const mid = Math.floor(demo.length / 2);
    const rest = [...shots("demo"), ...shots(null)];
    const ordered = [...new Set([...demo.slice(mid), ...demo.slice(0, mid), ...rest.filter((s) => s.status === "passed"), ...rest])];
    for (const s of ordered) {
      const file = inside(dir, s.screenshot);
      const demuxer = file && IMAGE_DEMUXER[sniffImage(head(file, 16))];
      if (demuxer) out.push({ file, demuxer, device: r.device, label: `live test on a ${r.device}: "${String(s.title ?? "").slice(0, 80)}" (${s.status})` });
    }
  }
  // One per device first (laptop, phone), then the rest.
  const firsts = out.filter((x, i) => out.findIndex((y) => y.device === x.device) === i);
  return [...firsts, ...out.filter((x) => !firsts.includes(x))];
}

/**
 * Images for one corner. side: "A" | "B". Returns { images: [{ id, kind, label, image, mime }], sources }.
 * Never throws: a source that fails is skipped and counted in `sources`.
 */
export async function collectUiImages(sub, side) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ui-"));
  const images = [];
  const sources = {};
  try {
    for (const [kind, list] of [["team", teamShots], ["video", videoFrames], ["live", liveShots]]) {
      let picked = [];
      try {
        picked = list(sub);
      } catch {
        picked = [];
      }
      let n = 0;
      for (const x of picked) {
        if (n >= PER_KIND) break;
        try {
          const image = await shrink(x.file, x.demuxer, path.join(work, `${images.length}.jpg`), x.at ?? null);
          images.push({ id: `${side}${images.length + 1}`, kind, label: x.label, image, mime: "image/jpeg" });
          n++;
        } catch {
          /* unreadable file or frame: skip it */
        }
      }
      sources[kind] = n;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { images, sources };
}
