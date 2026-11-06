/*
 * The fight's spoken lines as audio: MiniMax speech on 0G, one voice per corner and
 * one for the judges, so the battle sounds like two agents arguing.
 *
 * Each line is synthesized once and cached in backend/data/arena-voice/<t>-<m>/<seq>.mp3,
 * so replays cost nothing. Only text a recorded, revealed fight already shows is spoken.
 *
 *   ZG_VOICE_A, ZG_VOICE_B, ZG_VOICE_JUDGE   MiniMax voice ids (defaults below)
 */
import fs from "node:fs";
import path from "node:path";
import zg from "../zg/client.js";
import zgModels from "../zg/models.js";
import { DATA_DIR } from "../store.mjs";

export const VOICES = {
  a: process.env.ZG_VOICE_A || "English_magnetic_voiced_man",
  b: process.env.ZG_VOICE_B || "English_radiant_girl",
  judge: process.env.ZG_VOICE_JUDGE || "English_expressive_narrator",
};
/** Which lines are spoken, and how. Challenges sound angry; the rest is left to the model. */
export const SPOKEN = { pitch: { emotion: "happy" }, question: {}, answer: {}, challenge: { emotion: "angry", speed: 1.1 }, rebuttal: {}, closing: {} };
const MAX_BYTES = 1900; // MiniMax takes up to 2000 bytes of text a request

const safe = (v) => String(v).replace(/[^a-zA-Z0-9_-]/g, "");
const fileOf = (t, m, seq) => path.join(DATA_DIR, "arena-voice", `${safe(t)}-${Number(m)}`, `${Number(seq)}.mp3`);

/** Cut text to the request limit on a character boundary. */
export function clipBytes(text, max = MAX_BYTES) {
  let out = "";
  for (const ch of String(text ?? "")) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** How one event is spoken, or null if it isn't a spoken line. */
export function voiceFor(event) {
  const how = event && SPOKEN[event.type];
  if (!how || !String(event.text ?? "").trim()) return null;
  const voice = event.actor === "a" || event.actor === "b" ? VOICES[event.actor] : VOICES.judge;
  return { voice, ...how, input: clipBytes(event.text) };
}

const inFlight = new Map();

/**
 * The mp3 for one line of a fight: from the cache, or synthesized now. Returns { file } or null
 * when the event isn't a spoken line. opts.client replaces the 0G client (tests).
 */
export async function lineAudio(t, m, event, { client = zg } = {}) {
  const how = voiceFor(event);
  if (!how) return null;
  const file = fileOf(t, m, event.seq);
  if (fs.existsSync(file)) return { file, cached: true };
  if (inFlight.has(file)) return inFlight.get(file);
  const job = (async () => {
    const { audio } = await client.speech({ model: zgModels.MODELS.speech, format: "mp3", ...how });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, audio);
    return { file, cached: false };
  })().finally(() => inFlight.delete(file));
  inFlight.set(file, job);
  return job;
}
