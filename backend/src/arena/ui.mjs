/*
 * Collect the images a fight's UI face-off looks at, for one project:
 *   - the team's own screenshots (uploaded with the submission)
 *   - frames from our saved copy of the demo video
 *   - screenshots from the live test (one per device)
 * All of them are files on 0G Storage (zg/files.mjs). Every image goes through ffmpeg (a scratch
 * copy, forced demuxer, like media.mjs) and comes out as a small JPEG, so one 0G vision call
 * can hold both projects.
 *
 *   UI_IMAGES_PER_KIND   max images of each kind per project (default 2)
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getFile } from "../zg/files.mjs";
import { liveFile, liveTests, videos } from "../store.mjs";
import { IMAGE_REF, lockedInput, sniffImage, sniffVideo, UPLOADS } from "../reviewer/media.mjs";

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

// Each source is { load() -> Buffer|null, label, at? }: bytes come from 0G only when used.
const image = (scope, name, label) => ({ load: () => getFile(scope, name), label });

function teamShots(sub) {
  return (sub.demoImages ?? [])
    .map((ref) => IMAGE_REF.exec(String(ref))?.[1])
    .filter(Boolean)
    .map((f, i) => image(UPLOADS, f, `team screenshot ${i + 1}`));
}

function videoFrames(sub) {
  const v = videos.get(sub.id);
  if (!v?.ext || v.error) return [];
  let bytes = null; // one download for every frame
  const load = async () => (bytes ??= await getFile(sub.id, `demo.${v.ext}`));
  const secs = Number(v.seconds) || 0;
  const times = secs > 2 ? [0.3, 0.7, 0.5, 0.15, 0.85].map((f) => Math.floor(secs * f)) : [0];
  return times.map((at) => ({ load, at, label: `demo video frame at ${fmt(at)}` }));
}

function liveShots(sub) {
  const smoke = liveTests.get(sub.id);
  const out = [];
  for (const r of smoke?.runs ?? []) {
    const shots = (phase) => (r.phases ?? []).filter((p) => (phase ? p.id === phase : p.id !== "demo")).flatMap((p) => p.steps ?? []).filter((s) => s.screenshot);
    // A passed demo-replay step shows a real app screen. Start mid-demo: step one is usually the landing page.
    const demo = shots("demo").filter((s) => s.status === "passed");
    const mid = Math.floor(demo.length / 2);
    const rest = [...shots("demo"), ...shots(null)];
    const ordered = [...new Set([...demo.slice(mid), ...demo.slice(0, mid), ...rest.filter((s) => s.status === "passed"), ...rest])];
    for (const s of ordered) {
      const name = liveFile(s.screenshot);
      if (name) out.push({ ...image(sub.id, name, `live test on a ${r.device}: "${String(s.title ?? "").slice(0, 80)}" (${s.status})`), device: r.device });
    }
  }
  // One per device first (laptop, phone), then the rest.
  const firsts = out.filter((x, i) => out.findIndex((y) => y.device === x.device) === i);
  return [...firsts, ...out.filter((x) => !firsts.includes(x))];
}

/** The bytes in a scratch file with the demuxer ffmpeg must use, or null if it isn't an image or video we read. */
function toScratch(bytes, work, n) {
  if (!bytes) return null;
  const img = sniffImage(bytes.subarray(0, 16));
  const demuxer = img ? IMAGE_DEMUXER[img] : sniffVideo(bytes.subarray(0, 400))?.demuxer;
  if (!demuxer || demuxer === "mpegts") return null;
  const file = path.join(work, `src-${n}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return { file, demuxer };
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
          const bytes = await x.load();
          // Video frames share one scratch copy of the video.
          const src = toScratch(bytes, work, x.at == null ? `${kind}-${images.length}` : `${kind}-video`);
          if (!src) continue;
          const image = await shrink(src.file, src.demuxer, path.join(work, `${images.length}.jpg`), x.at ?? null);
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
