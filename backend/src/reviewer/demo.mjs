/*
 * "Read the demo video": get a timed transcript of the team's demo so the
 * live test can replay what the demo claims to show.
 *
 *  - Loom share links: Loom's own captions first (free, timed).
 *  - Otherwise our saved copy of the video (media.mjs): mono audio with ffmpeg
 *    (local file, forced demuxer), transcribed with OpenAI (needs OPENAI_API_KEY).
 *  - No copy (YouTube, web pages): skipped with the reason.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { classifyVideo, lockedInput, loomPage, sniffVideo } from "./media.mjs";
import { readCapped, safeFetch } from "./net.mjs";

const run = promisify(execFile);
export const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

/** Kept for callers that only need the ffmpeg demuxer for a buffer. */
export const sniffContainer = (buf) => {
  const s = sniffVideo(buf);
  return s && s.ext !== "ts" ? s.demuxer : null;
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function loomCaptions(id) {
  const { captions } = await loomPage(id);
  if (!captions) throw new Error("This Loom video has no captions to read.");
  const vttRes = await safeFetch(captions, { headers: { referer: "https://www.loom.com/" } });
  if (!vttRes.ok) {
    vttRes.body.resume?.();
    throw new Error(`Loom's captions returned HTTP ${vttRes.status}.`);
  }
  const vtt = (await readCapped(vttRes, 2 * 1024 * 1024)).toString("utf8");
  const lines = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.\d+ --> [^\n]+\n([\s\S]+?)(?:\n\n|$)/g)].map(
    (m) => `[${fmt(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))}] ${m[4].replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim()}`,
  );
  if (!lines.length) throw new Error("This Loom video's captions are empty.");
  return { source: "loom-captions", text: lines.join("\n"), seconds: null };
}

/** Transcribe a local video file we saved (video = saveDemoVideo's result). */
async function transcribeLocal(video, workDir) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Transcribing needs an OpenAI key on the server.");
  fs.mkdirSync(workDir, { recursive: true });
  const audio = path.join(workDir, "demo-audio.mp3");
  try {
    // Mono 16 kHz speech-quality audio keeps a 10-minute demo well under the 25 MB upload limit.
    await run("ffmpeg", ["-v", "error", "-y", ...lockedInput(video.demuxer, video.file), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio], { timeout: 180000 });
    if (fs.statSync(audio).size > 24 * 1024 * 1024) throw new Error("The demo is too long to transcribe.");
    const { default: OpenAI, toFile } = await import("openai");
    // From memory, not a stream: a stream can't be re-read, so the SDK's retries would have nothing to resend.
    const file = await toFile(fs.readFileSync(audio), "demo-audio.mp3", { type: "audio/mpeg" });
    const t = await new OpenAI({ maxRetries: 5, timeout: 180000 }).audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, response_format: "text" });
    const text = typeof t === "string" ? t : t?.text ?? "";
    if (!text.trim()) throw new Error("The demo has no speech to transcribe.");
    return { source: `transcribed with ${TRANSCRIBE_MODEL}`, text: text.trim(), seconds: video.seconds ?? null };
  } finally {
    fs.rmSync(audio, { force: true });
  }
}

/**
 * Returns { source, text, seconds } or throws with a reason in words (e.skip: nothing to read).
 * video: our saved copy, if we have one.
 */
export async function demoTranscript(videoUrl, { video = null, workDir }) {
  const c = classifyVideo(videoUrl);
  if (c.kind === "invalid") throw new Error("The demo link isn't a valid URL.");
  if (c.kind === "loom") {
    try {
      return { ...(await loomCaptions(c.id)), seconds: video?.seconds ?? null };
    } catch (e) {
      if (!video) throw e;
    }
  }
  if (video) return transcribeLocal(video, workDir);
  const why = c.kind === "embed-only" ? `It plays from ${c.provider}, which we can't download, so there's no audio to transcribe.` : "We couldn't keep a copy of the video, so there's nothing to transcribe.";
  throw Object.assign(new Error(why), { skip: true });
}

export const describeDuration = (s) => (s ? `${fmt(s)} long` : "");
