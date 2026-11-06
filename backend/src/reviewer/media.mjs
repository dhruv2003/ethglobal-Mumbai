/*
 * Keep our own copy of each project's demo video, and the files teams upload.
 * Both live on 0G Storage (zg/files.mjs): uploads under the scope "uploads", a
 * project's demo video as its file demo.<ext>. Videos over SHRINK_OVER_BYTES are
 * re-encoded smaller first, so they upload and play back faster.
 * Downloads and ffmpeg work happen in scratch folders that are always removed.
 *
 *   upload:<sha256>.<ext>   a file the team uploaded from their computer
 *   Loom share links        Loom's HLS stream, joined and remuxed to MP4
 *   *.m3u8                  any public HLS stream, same way
 *   direct files / Mux      streamed to disk (MP4, MOV, WebM)
 *   YouTube, Vimeo, Drive   not downloaded: they play in their own embed
 *
 * Every request goes through safeFetch (public https only, checked at connect),
 * byte caps apply while streaming, and ffmpeg only ever reads local files with a
 * forced demuxer (never a playlist, never a URL).
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline as pump } from "node:stream/promises";
import { Transform } from "node:stream";
import { promisify } from "node:util";
import os from "node:os";
import { fileInfo, filesOf, getFile, MAX_FILE_BYTES, putFile, removeFile } from "../zg/files.mjs";
import { scratch } from "../datafiles.mjs";
import { readCapped, safeFetch } from "./net.mjs";

const run = promisify(execFile);
export const VIDEO_MAX = 300 * 1024 * 1024;
const MAX_SEGMENTS = 3000;

/** Uploads are Arkiv files of this scope, named <sha256>.<ext>. */
export const UPLOADS = "uploads";
export const UPLOAD_FILE = /^[0-9a-f]{64}\.(mp4|mov|webm|png|jpg|webp)$/;
export const UPLOAD_REF = /^upload:([0-9a-f]{64}\.(?:mp4|mov|webm))$/;
export const IMAGE_REF = /^upload:([0-9a-f]{64}\.(?:png|jpg|webp))$/;
export const IMAGE_MAX = 10 * 1024 * 1024;
export const MAX_IMAGES = 8;
export const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** PNG, JPEG or WebP by magic bytes. Never SVG (it can carry script). */
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** What is this, by its first bytes? Only these ever reach ffmpeg. */
export function sniffVideo(buf) {
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const qt = buf.subarray(8, 12).toString("latin1") === "qt  ";
    return { demuxer: "mov", ext: qt ? "mov" : "mp4" };
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { demuxer: "matroska", ext: "webm" };
  if (buf.length >= 189 && buf[0] === 0x47 && buf[188] === 0x47) return { demuxer: "mpegts", ext: "ts" };
  return null;
}

export const head = (file, n = 400) => {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(n);
    return b.subarray(0, fs.readSync(fd, b, 0, n, 0));
  } finally {
    fs.closeSync(fd);
  }
};

/** ffmpeg/ffprobe input flags: one local file, forced demuxer. */
export const lockedInput = (demuxer, file) => ["-protocol_whitelist", "file", "-f", demuxer, "-i", file];

/** Duration in seconds, or throws if ffprobe can't read it as that container. */
export async function probeSeconds(file, demuxer) {
  const { stdout } = await run("ffprobe", ["-v", "error", ...lockedInput(demuxer, file), "-show_entries", "format=duration", "-of", "default=nw=1:nk=1"], { timeout: 30000 });
  const s = Number(stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error("That file has no playable video.");
  return Math.round(s);
}

/** Duration, picture size and whether there's sound. */
export async function probeInfo(file, demuxer) {
  const { stdout } = await run("ffprobe", ["-v", "error", ...lockedInput(demuxer, file), "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json"], { timeout: 30000 });
  const j = JSON.parse(stdout);
  const v = j.streams?.find((x) => x.codec_type === "video");
  return { seconds: Math.round(Number(j.format?.duration) || 0), width: v?.width ?? null, height: v?.height ?? null, audio: Boolean(j.streams?.some((x) => x.codec_type === "audio")) };
}

const IMAGE_DEMUXER = { png: "png_pipe", jpg: "jpeg_pipe", webp: "webp_pipe" };
/** Is this upload (<sha>.<ext>) stored? */
export const uploadExists = (file) => Boolean(fileInfo(UPLOADS, file));

/** An upload's bytes, from 0G Storage. Throws if it is gone. */
export async function uploadBytes(file) {
  const buf = await getFile(UPLOADS, file);
  if (!buf) throw new Error(`The upload ${file} is no longer stored.`);
  return buf;
}

/** Run fn(path) with the bytes in a scratch file, then remove it. */
export async function withTempFile(bytes, ext, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-file-"));
  const file = path.join(dir, `file.${ext}`);
  try {
    fs.writeFileSync(file, bytes);
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Picture size of an uploaded screenshot (file name like <sha>.png). */
export async function imageInfo(file) {
  const ext = path.extname(file).slice(1);
  const bytes = await uploadBytes(file);
  return withTempFile(bytes, ext, async (tmp) => {
    const { stdout } = await run("ffprobe", ["-v", "error", ...lockedInput(IMAGE_DEMUXER[ext], tmp), "-show_entries", "stream=width,height", "-of", "json"], { timeout: 15000 });
    const st = JSON.parse(stdout).streams?.[0] ?? {};
    return { width: st.width ?? null, height: st.height ?? null, bytes: bytes.length };
  });
}

/* ---------------- Smaller videos for 0G Storage ---------------- */

const SHRINK_OVER_BYTES = Number(process.env.ZG_VIDEO_SHRINK_MB || 40) * 1024 * 1024;

/**
 * Re-encode a video smaller when it's over SHRINK_OVER_BYTES: H.264/AAC MP4 at most 720p
 * (then 480p if that's still over the file limit). Returns { file, ext, demuxer, bytes };
 * the input is replaced. ffmpeg reads only this local file with its demuxer forced.
 */
export async function shrinkVideo(file, demuxer) {
  const bytes = fs.statSync(file).size;
  if (bytes <= SHRINK_OVER_BYTES) return { file, ext: path.extname(file).slice(1), demuxer, bytes };
  const out = path.join(path.dirname(file), `.small-${crypto.randomUUID()}.mp4`);
  try {
    for (const [height, crf, audio] of [[720, 30, "64k"], [480, 34, "48k"]]) {
      await run("ffmpeg", ["-y", "-v", "error", ...lockedInput(demuxer, file), "-map", "0:v:0", "-map", "0:a:0?", "-vf", `scale=-2:'min(${height},ih)'`, "-r", "24", "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audio, "-ac", "1", "-movflags", "+faststart", out], { timeout: 15 * 60_000 });
      if (fs.statSync(out).size <= MAX_FILE_BYTES) break;
    }
    const small = fs.statSync(out).size;
    if (small > MAX_FILE_BYTES) throw Object.assign(new Error(`The video is still ${Math.round(small / 1048576)} MB after compressing; files can be at most ${Math.round(MAX_FILE_BYTES / 1048576)} MB. Upload a shorter video.`), { status: 413 });
    const dest = file.replace(/\.[^.\/]+$/, ".mp4");
    fs.rmSync(file, { force: true });
    fs.renameSync(out, dest);
    return { file: dest, ext: "mp4", demuxer: "mov", bytes: small };
  } finally {
    fs.rmSync(out, { force: true });
  }
}

/** Put our copy of a project's demo video on 0G Storage as demo.<ext> (compressed first if big). Returns the (possibly new) video. */
export async function keepDemoVideo(projectId, video) {
  const small = await shrinkVideo(video.file, video.demuxer);
  putFile(projectId, `demo.${small.ext}`, fs.readFileSync(small.file), { mime: MIME[small.ext], kind: "demo-video" });
  return { ...video, ...small };
}

/** A Transform that counts bytes (and hashes them) and fails past max. */
export function capped(max, hash) {
  let n = 0;
  const t = new Transform({
    transform(chunk, _enc, cb) {
      n += chunk.length;
      if (n > max) return cb(Object.assign(new Error(`Too large (over ${Math.round(max / 1048576)} MB).`), { status: 413 }));
      hash?.update(chunk);
      cb(null, chunk);
    },
  });
  t.bytes = () => n;
  return t;
}

async function streamToFile(res, file, max, onProgress) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) {
    res.body.destroy?.();
    throw new Error(`The video is too large (${Math.round(len / 1048576)} MB, limit ${Math.round(max / 1048576)} MB).`);
  }
  const c = capped(max);
  let last = 0;
  const tick = setInterval(() => {
    const mb = c.bytes() / 1048576;
    if (mb - last >= 1) {
      last = mb;
      onProgress?.(`Downloaded ${mb.toFixed(0)} MB${len ? ` of ${Math.round(len / 1048576)} MB` : ""}`);
    }
  }, 1000);
  try {
    await pump(res.body, c, fs.createWriteStream(file));
  } finally {
    clearInterval(tick);
  }
  return c.bytes();
}

/* ---------------- HLS ---------------- */

/** Resolve a playlist URI; signed CDNs (Loom) need the playlist's query on relative URIs too. */
function resolveUri(uri, base) {
  const u = new URL(uri, base);
  if (!/^[a-z]+:/i.test(uri) && !u.search && base.search) u.search = base.search;
  return u;
}

/** Parse a master or media playlist. Exported for tests. */
export function parsePlaylist(text, baseUrl) {
  const base = new URL(baseUrl);
  if (!text.startsWith("#EXTM3U")) throw new Error("That stream isn't an HLS playlist.");
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out = { variants: [], audio: {}, segments: [], init: null, encrypted: false };
  const attrs = (l) => Object.fromEntries([...l.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#EXT-X-STREAM-INF:")) {
      const a = attrs(l);
      const next = lines.slice(i + 1).find((x) => x && !x.startsWith("#"));
      if (next) out.variants.push({ bandwidth: Number(a.BANDWIDTH) || 0, audio: a.AUDIO ?? null, url: resolveUri(next, base) });
    } else if (l.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/.test(l)) {
      const a = attrs(l);
      if (a.URI && (!out.audio[a["GROUP-ID"]] || a.DEFAULT === "YES")) out.audio[a["GROUP-ID"]] = resolveUri(a.URI, base);
    } else if (l.startsWith("#EXT-X-KEY:")) {
      if (attrs(l).METHOD !== "NONE") out.encrypted = true;
    } else if (l.startsWith("#EXT-X-MAP:")) {
      out.init = resolveUri(attrs(l).URI, base);
    } else if (l && !l.startsWith("#") && !out.variants.length) {
      out.segments.push(resolveUri(l, base));
    }
  }
  return out;
}

async function getText(url) {
  const res = await safeFetch(url.href ?? url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`The video stream returned HTTP ${res.status}.`);
  return (await readCapped(res, 2 * 1024 * 1024)).toString("utf8");
}

/** Download every segment of a media playlist, in order, into one file. Returns bytes written. */
async function downloadMedia(playlistUrl, file, budget, onProgress, what = "video") {
  const p = parsePlaylist(await getText(playlistUrl), playlistUrl);
  if (p.encrypted) throw new Error("That video stream is encrypted, so we can't keep a copy.");
  const parts = [...(p.init ? [p.init] : []), ...p.segments];
  if (!p.segments.length) throw new Error("That video stream has no segments.");
  if (parts.length > MAX_SEGMENTS) throw new Error("That video stream is too long.");
  const out = fs.openSync(file, "w");
  let total = 0;
  try {
    // Fetch 12 at a time, write strictly in order.
    for (let i = 0; i < parts.length; i += 12) {
      const bufs = await Promise.all(
        parts.slice(i, i + 12).map(async (u) => {
          const res = await safeFetch(u.href, { headers: { "user-agent": "Mozilla/5.0" } });
          if (!res.ok) throw new Error(`A piece of the video stream returned HTTP ${res.status}.`);
          return readCapped(res, 64 * 1024 * 1024);
        }),
      );
      onProgress?.(`Fetching the ${what} stream: piece ${Math.min(i + 12, parts.length)} of ${parts.length}`);
      for (const b of bufs) {
        total += b.length;
        if (total > budget) throw new Error(`The video is too large (over ${Math.round(VIDEO_MAX / 1048576)} MB).`);
        fs.writeSync(out, b);
      }
    }
  } finally {
    fs.closeSync(out);
  }
  return { bytes: total, fmp4: Boolean(p.init) };
}

/** HLS (master or media playlist) -> one MP4 at outFile. */
export async function downloadHls(masterUrl, outFile, work, onProgress) {
  const master = parsePlaylist(await getText(masterUrl), masterUrl);
  let videoUrl = new URL(masterUrl);
  let audioUrl = null;
  if (master.variants.length) {
    // About 720p is plenty for judging and keeps the copy small.
    const sorted = [...master.variants].sort((a, b) => a.bandwidth - b.bandwidth);
    const v = [...sorted].reverse().find((x) => x.bandwidth <= 2_000_000) ?? sorted[0];
    videoUrl = v.url;
    audioUrl = v.audio ? master.audio[v.audio] ?? null : null;
  }
  fs.mkdirSync(work, { recursive: true });
  const vFile = path.join(work, "video.part");
  const aFile = path.join(work, "audio.part");
  const v = await downloadMedia(videoUrl, vFile, VIDEO_MAX, onProgress, "video");
  const a = audioUrl ? await downloadMedia(audioUrl, aFile, VIDEO_MAX - v.bytes, onProgress, "audio") : null;
  onProgress?.("Joining the video and audio into one MP4");
  const kind = (f) => sniffVideo(head(f))?.demuxer;
  const vd = kind(vFile);
  if (vd !== "mpegts" && vd !== "mov") throw new Error("The video stream isn't in a format we can save.");
  const inputs = [...lockedInput(vd, vFile)];
  if (a) {
    const ad = kind(aFile);
    if (ad !== "mpegts" && ad !== "mov") throw new Error("The audio stream isn't in a format we can save.");
    inputs.push(...lockedInput(ad, aFile), "-map", "0:v:0", "-map", "1:a:0");
  }
  await run("ffmpeg", ["-v", "error", "-y", ...inputs, "-c", "copy", "-movflags", "+faststart", "-f", "mp4", outFile], { timeout: 300000 });
  fs.rmSync(vFile, { force: true });
  fs.rmSync(aFile, { force: true });
}

/* ---------------- Loom ---------------- */

/** Read a Loom share page: its HLS stream URL and captions URL. */
export async function loomPage(id) {
  const res = await safeFetch(`https://www.loom.com/share/${id}`, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Loom returned HTTP ${res.status} for that video.`);
  const html = (await readCapped(res, 5 * 1024 * 1024)).toString("utf8").replace(/\\u002F/g, "/").replace(/\\u0026/g, "&");
  const clean = (s) => s?.replace(/&amp;/g, "&") ?? null;
  return {
    hls: clean(html.match(/https:\/\/luna\.loom\.com\/[^"\s\\]+?\.m3u8[^"\s\\]*/)?.[0]),
    captions: clean(html.match(/https:\/\/cdn\.loom\.com\/mediametadata\/captions\/[^"\s\\]+/)?.[0]),
    // The owner can switch downloads off; then we only embed it.
    downloadable: !/"download_enabled":\s*false/.test(html),
  };
}

/* ---------------- What to do with a link ---------------- */

/** Which kind of demo link is this? */
export function classifyVideo(raw) {
  const up = UPLOAD_REF.exec(String(raw ?? ""));
  if (up) return { kind: "upload", file: up[1] };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { kind: "invalid" };
  }
  if (u.protocol !== "https:") return { kind: "invalid" };
  const host = u.hostname.replace(/^www\./, "");
  if (host === "loom.com") {
    const id = u.pathname.match(/\/(?:share|embed)\/([a-f0-9]+)/)?.[1];
    return id ? { kind: "loom", id, url: `https://www.loom.com/share/${id}` } : { kind: "unsupported", why: "Loom link without a video id." };
  }
  if (host === "stream.mux.com") {
    const id = u.pathname.split("/")[1]?.replace(/\.(m3u8|mp4)$/, "");
    return id ? { kind: "file", url: `https://stream.mux.com/${id}/high.mp4`, fallback: `https://stream.mux.com/${id}/low.mp4` } : { kind: "unsupported", why: "Mux link without a playback id." };
  }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { kind: "embed-only", provider: "YouTube" };
  if (/(^|\.)vimeo\.com$/.test(host)) return { kind: "embed-only", provider: "Vimeo" };
  if (host === "drive.google.com") return { kind: "embed-only", provider: "Google Drive" };
  if (/\.m3u8$/i.test(u.pathname)) return { kind: "hls", url: u.href };
  if (/\.(mp4|mov|webm|m4v)$/i.test(u.pathname)) return { kind: "file", url: u.href };
  return { kind: "maybe-file", url: u.href };
}

const NETWORK = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_SOCKET"]);
const isNetwork = (e) => NETWORK.has(e?.code) || e?.name === "AggregateError" || /socket hang up|took too long/i.test(e?.message ?? "");

/** A readable reason, even for network errors that come with no message. */
export const reason = (e) => e?.message || (e?.errors?.[0]?.code ?? e?.code ? `Network error (${e?.errors?.[0]?.code ?? e?.code}).` : "Network error.");

/**
 * Save the demo video into dir as demo.<ext>.
 * Returns { file, ext, demuxer, bytes, seconds, source } or throws (e.skip = not an error, just not possible).
 * Network hiccups are retried once.
 */
export async function saveDemoVideo(videoUrl, dir, { onProgress } = {}) {
  try {
    return await saveOnce(videoUrl, dir, onProgress);
  } catch (e) {
    if (!isNetwork(e)) throw e;
    onProgress?.("Network hiccup; trying the download once more");
    try {
      return await saveOnce(videoUrl, dir, onProgress);
    } catch (e2) {
      throw new Error(`Couldn't download the video: ${reason(e2)}`);
    }
  }
}

async function saveOnce(videoUrl, dir, onProgress) {
  const c = classifyVideo(videoUrl);
  if (c.kind === "invalid") throw new Error("The demo link isn't a valid https URL.");
  if (c.kind === "unsupported") throw Object.assign(new Error(c.why), { skip: true });
  if (c.kind === "embed-only") throw Object.assign(new Error(`It plays from ${c.provider}; we don't download from ${c.provider}.`), { skip: true });
  fs.mkdirSync(dir, { recursive: true });
  const work = path.join(dir, "work");
  let file;
  let source;
  try {
    if (c.kind === "upload") {
      if (!uploadExists(c.file)) throw new Error("The uploaded video is no longer stored.");
      onProgress?.("Reading the file the team uploaded from 0G Storage");
      file = path.join(dir, `demo.${path.extname(c.file).slice(1)}`);
      fs.writeFileSync(file, await uploadBytes(c.file));
      source = "uploaded by the team";
    } else if (c.kind === "loom" || c.kind === "hls") {
      let hls = c.url;
      if (c.kind === "loom") {
        onProgress?.("Reading the Loom page");
        const page = await loomPage(c.id);
        if (!page.downloadable) throw Object.assign(new Error("The Loom owner turned downloads off, so it plays from Loom only."), { skip: true });
        if (!page.hls) throw new Error("Couldn't find the video stream on that Loom page.");
        hls = page.hls;
      }
      file = path.join(dir, "demo.mp4");
      await downloadHls(hls, file, work, onProgress);
      source = c.kind === "loom" ? "copied from Loom" : "copied from the stream";
    } else {
      onProgress?.(`Connecting to ${new URL(c.url).hostname}`);
      let res = await safeFetch(c.url);
      if (!res.ok && c.fallback) {
        res.body.resume?.();
        res = await safeFetch(c.fallback);
      }
      if (!res.ok) throw new Error(`The video link returned HTTP ${res.status}.`);
      const type = res.headers.get("content-type") ?? "";
      if (c.kind === "maybe-file" && !/^video\/|octet-stream/.test(type)) {
        res.body.destroy?.();
        throw Object.assign(new Error("The demo link is a web page, not a video file, so we link to it instead."), { skip: true });
      }
      fs.mkdirSync(work, { recursive: true });
      const tmp = path.join(work, "download.part");
      await streamToFile(res, tmp, VIDEO_MAX, onProgress);
      const s = sniffVideo(head(tmp));
      if (!s || s.ext === "ts") throw new Error("The demo link didn't return an MP4, MOV or WebM video.");
      file = path.join(dir, `demo.${s.ext}`);
      fs.renameSync(tmp, file);
      source = "copied from the link";
    }
    const s = sniffVideo(head(file));
    if (!s || s.ext === "ts") throw new Error("The saved file isn't an MP4, MOV or WebM video.");
    const seconds = await probeSeconds(file, s.demuxer);
    return { file, ext: path.extname(file).slice(1), demuxer: s.demuxer, bytes: fs.statSync(file).size, seconds, source };
  } catch (e) {
    if (file) fs.rmSync(file, { force: true });
    throw e;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/* ---------------- Uploads ---------------- */

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Stream an upload into a scratch file, check it, then store it on 0G Storage,
 * content-addressed (sha256 of what was uploaded), so the same file uploaded twice
 * is stored once. check(tmpFile, bytes) validates the bytes and returns
 * { ext, mime, kind, ...extra } (or throws); it may replace the file (a video is
 * compressed) and return its new path as `file`. The result is { file, bytes, ...extra }.
 */
async function storeContentAddressed(stream, max, check) {
  const dir = scratch("uploads", crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "upload.part");
  const hash = crypto.createHash("sha256");
  const c = capped(max, hash);
  try {
    await pump(stream, c, fs.createWriteStream(tmp));
    const { ext, mime, kind, file: checked = tmp, ...extra } = await check(tmp, c.bytes());
    const name = `${hash.digest("hex")}.${ext}`;
    if (!uploadExists(name)) putFile(UPLOADS, name, fs.readFileSync(checked), { mime, kind });
    return { file: name, bytes: c.bytes(), ...extra };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Store an uploaded video from a request stream. Returns { file, bytes, seconds }. */
export async function storeUpload(stream, { declaredBytes = 0 } = {}) {
  if (declaredBytes > VIDEO_MAX) throw httpError(413, `That video is over ${Math.round(VIDEO_MAX / 1048576)} MB.`);
  return storeContentAddressed(stream, VIDEO_MAX, async (tmp, bytes) => {
    if (bytes < 1000) throw httpError(400, "That file is empty.");
    const s = sniffVideo(head(tmp));
    if (!s || s.ext === "ts") throw httpError(415, "Upload an MP4, MOV or WebM video.");
    const seconds = await probeSeconds(tmp, s.demuxer).catch(() => {
      throw httpError(415, "That file doesn't play as a video.");
    });
    const small = await shrinkVideo(tmp, s.demuxer);
    const ext = small.file === tmp ? s.ext : small.ext; // not re-encoded: keep its own container
    return { ext, mime: MIME[ext], kind: "upload-video", file: small.file, seconds };
  });
}

/** Store an uploaded screenshot (PNG, JPEG or WebP, max 10 MB). Returns { file, bytes }. */
export async function storeImageUpload(stream) {
  return storeContentAddressed(stream, IMAGE_MAX, async (tmp, bytes) => {
    if (bytes < 100) throw httpError(400, "That image is empty.");
    const ext = sniffImage(head(tmp, 16));
    if (!ext) throw httpError(415, "Upload a PNG, JPEG or WebP image.");
    return { ext, mime: MIME[ext], kind: "upload-image" };
  });
}

/** Forget uploads older than maxAgeMs that no submission points at. */
export function cleanUploads(referenced, maxAgeMs = 24 * 60 * 60 * 1000) {
  let n = 0;
  for (const [name, info] of filesOf(UPLOADS)) {
    if (Date.now() - Date.parse(info.savedAt) > maxAgeMs && !referenced.has(name)) {
      removeFile(UPLOADS, name);
      n++;
    }
  }
  return n;
}
