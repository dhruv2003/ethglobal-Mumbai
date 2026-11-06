/*
 * "Read the demo video": get a timed transcript of the team's demo so the
 * live test can replay what the demo claims to show.
 *
 *  - Loom share links: Loom's own captions (no download).
 *  - Direct video files (mp4/mov/webm, Mux, ETHGlobal storage): download up
 *    to 300 MB through safeFetch, extract mono audio with ffmpeg, transcribe
 *    with OpenAI (needs OPENAI_API_KEY).
 *  - Anything else (YouTube, pages): skipped with the reason.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { readCapped, safeFetch } from "./net.mjs";

const run = promisify(execFile);
const MAX_VIDEO = 300 * 1024 * 1024;
export const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";

/**
 * What container is this, by its first bytes? Only real video files get near
 * ffmpeg: a playlist or concat list could make it fetch URLs or read local files.
 * Returns the ffmpeg demuxer to force, or null.
 */
export function sniffContainer(buf) {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") return "mov"; // MP4, MOV, M4V
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "matroska"; // WebM, MKV
  return null;
}

/** ffmpeg/ffprobe input flags: local file only, forced demuxer. */
const lockedInput = (demuxer, file) => ["-protocol_whitelist", "file", "-f", demuxer, "-i", file];

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Which kind of demo link is this? */
export function classifyDemo(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "invalid" };
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "loom.com") {
    const id = u.pathname.match(/\/(?:share|embed)\/([a-f0-9]+)/)?.[1];
    return id ? { kind: "loom", id, url: `https://www.loom.com/share/${id}` } : { kind: "unsupported", why: "Loom link without a video id." };
  }
  if (host === "stream.mux.com") {
    const id = u.pathname.split("/")[1]?.replace(/\.(m3u8|mp4)$/, "");
    return id ? { kind: "file", url: `https://stream.mux.com/${id}/high.mp4`, fallback: `https://stream.mux.com/${id}/low.mp4` } : { kind: "unsupported", why: "Mux link without a playback id." };
  }
  if (/youtube\.com|youtu\.be/.test(host)) return { kind: "unsupported", why: "YouTube videos can't be downloaded automatically. Use a direct video file or Loom link." };
  if (/\.(mp4|mov|webm|m4v)$/i.test(u.pathname)) return { kind: "file", url: u.href };
  return { kind: "maybe-file", url: u.href };
}

async function loomCaptions(url) {
  const res = await safeFetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const html = (await readCapped(res, 5 * 1024 * 1024)).toString("utf8");
  const cap = html.match(/https:\/\/cdn\.loom\.com\/mediametadata\/captions\/[^"\\\s]+(?:\\u0026[^"\\\s]+)*/)?.[0];
  if (!cap) throw new Error("This Loom video has no captions to read.");
  const vttRes = await safeFetch(cap.replace(/\\u0026/g, "&").replace(/&amp;/g, "&"), { headers: { referer: "https://www.loom.com/" } });
  const vtt = (await readCapped(vttRes, 2 * 1024 * 1024)).toString("utf8");
  const lines = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.\d+ --> [^\n]+\n([\s\S]+?)(?:\n\n|$)/g)].map(
    (m) => `[${fmt(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))}] ${m[4].replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim()}`,
  );
  return { source: "loom-captions", text: lines.join("\n"), seconds: null };
}

async function transcribeFile(c, workDir) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Transcribing needs an OpenAI key on the server.");
  fs.mkdirSync(workDir, { recursive: true });
  let res = await safeFetch(c.url);
  if (!res.ok && c.fallback) res = await safeFetch(c.fallback);
  if (!res.ok) throw new Error(`The video link returned HTTP ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  if (c.kind === "maybe-file" && !/^video\/|octet-stream/.test(type)) throw new Error("The demo link is a web page, not a video file. Use a direct video or Loom link.");
  const bytes = await readCapped(res, MAX_VIDEO);
  const demuxer = sniffContainer(bytes);
  if (!demuxer) throw new Error("The demo link didn't return an MP4, MOV or WebM video.");
  const video = path.join(workDir, "demo-video");
  fs.writeFileSync(video, bytes);
  const audio = path.join(workDir, "demo-audio.mp3");
  // Mono 16 kHz speech-quality audio keeps a 10-minute demo well under the 25 MB upload limit.
  await run("ffmpeg", ["-v", "error", "-y", ...lockedInput(demuxer, video), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", audio], { timeout: 180000 });
  const { stdout } = await run("ffprobe", ["-v", "error", ...lockedInput(demuxer, video), "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"], { timeout: 30000 });
  const seconds = Math.round(Number(stdout.trim()) || 0);
  fs.rmSync(video, { force: true });
  if (fs.statSync(audio).size > 24 * 1024 * 1024) throw new Error("The demo is too long to transcribe.");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const t = await client.audio.transcriptions.create({ file: fs.createReadStream(audio), model: TRANSCRIBE_MODEL, response_format: "text" });
  fs.rmSync(audio, { force: true });
  const text = typeof t === "string" ? t : t?.text ?? "";
  if (!text.trim()) throw new Error("The demo has no speech to transcribe.");
  return { source: `transcribed with ${TRANSCRIBE_MODEL}`, text: text.trim(), seconds };
}

/** Returns { source, text, seconds } or throws with a reason in words. */
export async function demoTranscript(videoUrl, workDir) {
  const c = classifyDemo(videoUrl);
  if (c.kind === "invalid") throw new Error("The demo link isn't a valid URL.");
  if (c.kind === "unsupported") throw Object.assign(new Error(c.why), { skip: true });
  if (c.kind === "loom") return loomCaptions(c.url);
  return transcribeFile(c, workDir);
}

export const describeDuration = (s) => (s ? `${fmt(s)} long` : "");
