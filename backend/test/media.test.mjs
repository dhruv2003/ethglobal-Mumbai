import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-media-test-"));
const { classifyVideo, cleanUploads, IMAGE_REF, parsePlaylist, saveDemoVideo, sniffImage, sniffVideo, storeImageUpload, storeUpload, UPLOAD_DIR, UPLOAD_REF } = await import("../src/reviewer/media.mjs");
after(() => fs.rmSync(process.env.ARENA_DATA_DIR, { recursive: true, force: true }));

/** A real 2-second MP4 made by ffmpeg, so probing is tested for real. */
function tinyMp4() {
  const f = path.join(process.env.ARENA_DATA_DIR, "tiny.mp4");
  if (!fs.existsSync(f)) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2", "-pix_fmt", "yuv420p", f]);
  return fs.readFileSync(f);
}

test("video links: uploads, Loom, HLS and files are saved; YouTube, Vimeo and Drive only embed", () => {
  assert.equal(classifyVideo(`upload:${"a".repeat(64)}.mp4`).kind, "upload");
  assert.equal(classifyVideo("upload:../../etc/passwd").kind, "invalid");
  assert.equal(classifyVideo("https://www.loom.com/share/17b1dc5da755422ea3177d4842556813").kind, "loom");
  assert.equal(classifyVideo("https://cdn.example/v/master.m3u8").kind, "hls");
  assert.equal(classifyVideo("https://cdn.example/demo.webm").kind, "file");
  for (const u of ["https://youtu.be/x", "https://www.youtube.com/watch?v=x", "https://vimeo.com/123", "https://drive.google.com/file/d/abc/view"]) assert.equal(classifyVideo(u).kind, "embed-only", u);
  assert.equal(classifyVideo("http://cdn.example/demo.mp4").kind, "invalid");
});

test("HLS playlists: best ~720p variant's audio group, signed query carried to relative URIs", () => {
  const master = parsePlaylist(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="a",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,AUDIO="audio"\nv1500.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,AUDIO="audio"\nv3200.m3u8\n',
    "https://luna.example/id/x/playlist.m3u8?Policy=p&Signature=s",
  );
  assert.equal(master.variants.length, 2);
  assert.equal(master.variants[0].url.href, "https://luna.example/id/x/v1500.m3u8?Policy=p&Signature=s");
  assert.equal(master.audio.audio.href, "https://luna.example/id/x/audio.m3u8?Policy=p&Signature=s");
  const media = parsePlaylist("#EXTM3U\n#EXTINF:5,\nseg-0.ts\n#EXTINF:5,\nhttps://other.example/seg-1.ts\n", "https://luna.example/id/x/v.m3u8?k=1");
  assert.deepEqual(media.segments.map((u) => u.href), ["https://luna.example/id/x/seg-0.ts?k=1", "https://other.example/seg-1.ts"]);
  assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\nseg.ts\n', "https://a.example/v.m3u8").encrypted, true);
  assert.throws(() => parsePlaylist("<html>", "https://a.example/v.m3u8"), /HLS/);
});

test("sniffing: MP4, MOV, WebM and MPEG-TS are recognised; playlists and concat lists are not", () => {
  assert.equal(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(8)])).ext, "mp4");
  assert.equal(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(8)])).ext, "mov");
  assert.equal(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])).ext, "webm");
  const ts = Buffer.alloc(376);
  ts[0] = ts[188] = 0x47;
  assert.equal(sniffVideo(ts).ext, "ts");
  for (const bad of ["#EXTM3U\nhttp://169.254.169.254/x.ts\n", "ffconcat version 1.0\nfile '/etc/passwd'\n"]) assert.equal(sniffVideo(Buffer.from(bad)), null);
});

test("uploads: a real video is stored by its hash, can be saved as a demo, and junk is refused", async () => {
  const mp4 = tinyMp4();
  const up = await storeUpload(Readable.from([mp4]));
  assert.match(up.file, /^[0-9a-f]{64}\.mp4$/);
  assert.equal(up.seconds, 2);
  assert.ok(UPLOAD_REF.test(`upload:${up.file}`));
  const again = await storeUpload(Readable.from([mp4]));
  assert.equal(again.file, up.file);
  assert.equal(fs.readdirSync(UPLOAD_DIR).filter((f) => !f.startsWith(".")).length, 1);

  const saved = await saveDemoVideo(`upload:${up.file}`, path.join(process.env.ARENA_DATA_DIR, "media", "p1"));
  assert.equal(saved.ext, "mp4");
  assert.equal(saved.seconds, 2);
  assert.ok(fs.existsSync(saved.file));

  await assert.rejects(storeUpload(Readable.from([Buffer.from("#EXTM3U\n".repeat(400))])), (e) => e.status === 415);
  await assert.rejects(storeUpload(Readable.from([Buffer.concat([mp4.subarray(0, 64), Buffer.alloc(4000)])])), (e) => e.status === 415);
  assert.equal(fs.readdirSync(UPLOAD_DIR).filter((f) => f.startsWith(".part")).length, 0, "no partial files left behind");
});

test("unused uploads are cleaned up after a day; submitted ones are kept", () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  for (const f of [`${"1".repeat(64)}.mp4`, `${"2".repeat(64)}.mp4`]) {
    fs.writeFileSync(path.join(UPLOAD_DIR, f), "x");
    fs.utimesSync(path.join(UPLOAD_DIR, f), old, old);
  }
  cleanUploads(new Set([`${"2".repeat(64)}.mp4`]));
  assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, `${"1".repeat(64)}.mp4`)));
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, `${"2".repeat(64)}.mp4`)));
});

test("embed-only links are not downloaded", async () => {
  await assert.rejects(saveDemoVideo("https://youtu.be/abc", path.join(process.env.ARENA_DATA_DIR, "media", "p2")), (e) => e.skip === true);
});

test("screenshots: PNG, JPEG and WebP are stored by hash; SVG and junk are refused", async () => {
  const png = path.join(process.env.ARENA_DATA_DIR, "shot.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x48", "-frames:v", "1", png]);
  const up = await storeImageUpload(Readable.from([fs.readFileSync(png)]));
  assert.match(up.file, /^[0-9a-f]{64}\.png$/);
  assert.ok(IMAGE_REF.test(`upload:${up.file}`));
  assert.ok(!UPLOAD_REF.test(`upload:${up.file}`), "an image is never accepted as the demo video");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>${" ".repeat(200)}`);
  await assert.rejects(storeImageUpload(Readable.from([svg])), (e) => e.status === 415);
  await assert.rejects(storeImageUpload(Readable.from([Buffer.alloc(11 * 1024 * 1024, 1)])), (e) => e.status === 413);
});
