// Laya point decisions and MiniMax fight voices, with 0G replaced by fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-voice-test-"));
const laya = await import("../src/arena/laya.mjs");
const voice = await import("../src/arena/voice.mjs");

// The real shape Laya returned on 0G (trimmed).
const answers = (a, b, even) => ({
  point: { type: "choice", choice: a >= b && a >= even ? "a" : b >= even ? "b" : "even", probabilities: { a, b, even } },
  margin: { type: "score", legend: { 0: "even", 1: "slight", 2: "clear", 3: "decisive" }, probabilities: { 0: 0.1, 1: 0.2, 2: 0.6, 3: 0.1 } },
});

test("readPoint: the chosen side wins; a weak lead is called even", () => {
  assert.deepEqual(laya.readPoint(answers(0.59, 0.16, 0.25)), { winner: "a", confidence: 0.59, probabilities: { a: 0.59, b: 0.16, even: 0.25 }, margin: "clear" });
  assert.equal(laya.readPoint(answers(0.4, 0.35, 0.25)).winner, "even");
  assert.equal(laya.readPoint(answers(0.1, 0.2, 0.7)).winner, "even");
  assert.throws(() => laya.readPoint({}), /no point/);
});

test("the state fits Laya's 512 tokens and names both sides; questions use short labels", () => {
  const long = "word ".repeat(2000);
  const s = laya.pointState({ criterion: "Engineering", question: "Why?", a: { name: "A app", answer: long, rebuttal: long }, b: { name: "B app", answer: "short", rebuttal: "" } });
  assert.ok(s.length < 2000, `state is ${s.length} chars`);
  assert.match(s, /Side A \(A app\)/);
  assert.match(s, /Side B \(B app\): short/);
  assert.deepEqual(laya.pointQuestions("Engineering").point.criteria, { a: "Side A", b: "Side B", even: "equally strong" });
});

test("decidePoint calls /decisions with laya, and a failure never breaks the fight", async () => {
  let sent;
  const client = { decisions: async (req) => ((sent = req), { answers: answers(0.7, 0.1, 0.2), trace: { requestId: "r1" } }) };
  const r = await laya.decidePoint({ round: "product", criterion: "Product", a: { name: "A" }, b: { name: "B" } }, { client });
  assert.equal(sent.model, "laya");
  assert.deepEqual(Object.keys(sent.questions), ["point", "margin"]);
  assert.equal(r.event.type, "point");
  assert.equal(r.event.winner, "a");
  assert.equal(r.trace.requestId, "r1");
  const bad = await laya.decidePoint({ round: "product", criterion: "Product", a: {}, b: {} }, { client: { decisions: async () => { throw new Error("down"); } } });
  assert.deepEqual(bad.event, { type: "point", round: "product", winner: null, error: "down" });
});

test("tallyPoints counts each side and even points", () => {
  assert.deepEqual(laya.tallyPoints([{ type: "point", winner: "a" }, { type: "point", winner: "a" }, { type: "point", winner: "even" }, { type: "point", winner: null }, { type: "ruling" }]), { a: 2, b: 0, even: 1 });
});

test("voices: each corner has its own voice, judges a third; only spoken lines get audio", () => {
  assert.equal(voice.voiceFor({ type: "answer", actor: "a", text: "x" }).voice, voice.VOICES.a);
  assert.equal(voice.voiceFor({ type: "answer", actor: "b", text: "x" }).voice, voice.VOICES.b);
  assert.equal(voice.voiceFor({ type: "question", actor: "judge-product", text: "x" }).voice, voice.VOICES.judge);
  assert.equal(voice.voiceFor({ type: "challenge", actor: "a", text: "x" }).emotion, "angry");
  assert.equal(voice.voiceFor({ type: "ruling", text: "x" }), null);
  assert.equal(voice.voiceFor({ type: "answer", actor: "a", text: "  " }), null);
  assert.ok(Buffer.byteLength(voice.clipBytes("é".repeat(2000))) <= 1900);
});

test("lineAudio synthesizes a line once with MiniMax, then serves the cached mp3", async () => {
  let calls = 0;
  let sent;
  const client = { speech: async (req) => (calls++, (sent = req), { audio: Buffer.from("mp3-bytes") }) };
  const e = { seq: 7, type: "rebuttal", actor: "b", text: "E9 covers refunds." };
  const first = await voice.lineAudio("t1", 2, e, { client });
  const again = await voice.lineAudio("t1", 2, e, { client });
  assert.equal(calls, 1);
  assert.equal(sent.model, "minimax-speech-2.8-turbo");
  assert.equal(sent.voice, voice.VOICES.b);
  assert.equal(sent.format, "mp3");
  assert.equal(first.cached, false);
  assert.equal(again.cached, true);
  assert.equal(fs.readFileSync(again.file, "utf8"), "mp3-bytes");
  assert.equal(await voice.lineAudio("t1", 2, { seq: 8, type: "ruling" }, { client }), null);
});
