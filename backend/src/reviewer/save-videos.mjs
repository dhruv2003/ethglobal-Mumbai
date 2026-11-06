/*
 * Save our copy of the demo video for submitted projects that don't have one yet
 * (projects submitted before copies existed). New submissions get theirs in the
 * review pipeline's demo step.
 *
 *   npm run videos                  every submission without a copy
 *   npm run videos -- --project <id>   one project (re-downloads)
 */
import "dotenv/config";
import { mediaDir, submissions, videos } from "../store.mjs";
import { reason, saveDemoVideo } from "./media.mjs";

const i = process.argv.indexOf("--project");
const only = i > 0 ? process.argv[i + 1] : null;
const todo = submissions.list().filter((s) => s.demoVideoUrl && (only ? s.id === only : !videos.get(s.id)?.ext));
if (!todo.length) console.log(only ? "No such submission, or it has no demo video." : "Every submission already has its copy.");
for (const s of todo) {
  const name = s.project?.name ?? s.id;
  try {
    const v = await saveDemoVideo(s.demoVideoUrl, mediaDir(s.id));
    videos.save(s.id, { ext: v.ext, bytes: v.bytes, seconds: v.seconds, source: v.source, savedAt: new Date().toISOString() });
    console.log(`✓ ${name}: ${v.source}, ${v.seconds}s, ${(v.bytes / 1048576).toFixed(1)} MB`);
  } catch (e) {
    videos.save(s.id, { error: reason(e).slice(0, 240), skipped: Boolean(e.skip), savedAt: new Date().toISOString() });
    console.log(`${e.skip ? "–" : "✕"} ${name}: ${reason(e)}`);
  }
}
process.exit(0);
