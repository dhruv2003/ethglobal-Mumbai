/*
 * Calls every 0G endpoint the agents use, once, and prints the trace.
 * Run: npm run zg:smoke   (needs ZG_API_KEY in backend/.env)
 */
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const zg = require("../src/zg/client");
const { MODELS } = require("../src/zg/models");

const FIXTURE = path.join(__dirname, "../fixtures/go-health-me/media/keyframes/t005.jpg");

const show = (name, t, extra = "") =>
  console.log(`✓ ${name.padEnd(14)} ${String(t.model).padEnd(26)} req=${t.requestId} cost=${t.costUsdMicro ?? "?"}µ$ tee=${t.teeVerified} e2ee=${t.e2ee}${extra ? `  ${extra}` : ""}`);

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`✗ ${name.padEnd(14)} ${e.code ?? ""} ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log("Models in use:", MODELS, "\n");

  await step("models", async () => {
    const models = await zg.listModels();
    const missing = Object.values(MODELS).filter((m) => !models.some((x) => x.id === m));
    console.log(`✓ models         ${models.length} available${missing.length ? `; MISSING: ${missing.join(", ")}` : "; all configured models present"}`);
  });

  await step("chat+json", async () => {
    const r = await zg.chatJSON({
      model: MODELS.judge,
      thinking: false,
      verifyTee: true,
      maxTokens: 100,
      messages: [{ role: "user", content: 'Reply with only {"ok": true}' }],
      validate: (o) => (o.ok === true ? [] : ["ok must be true"]),
    });
    show("chat+json", r.trace);
  });

  let mp3;
  await step("speech", async () => {
    const r = await zg.speech({ input: "Round one. Fight!", model: MODELS.speech });
    mp3 = r.audio;
    show("speech", r.trace, `${r.audio.length} bytes ${r.mime}`);
  });

  await step("transcribe", async () => {
    if (!mp3) throw new Error("skipped: no audio from speech step");
    const r = await zg.transcribe({ audio: mp3, model: MODELS.transcribe });
    show("transcribe", r.trace, JSON.stringify(r.text.trim()));
  });

  await step("embed", async () => {
    const r = await zg.embed({ input: ["upheld challenge", "rejected challenge"], model: MODELS.embed });
    show("embed", r.trace, `${r.vectors.length} x ${r.vectors[0].length}d`);
  });

  await step("vision", async () => {
    const r = await zg.chat({
      model: MODELS.vision,
      thinking: false,
      maxTokens: 120,
      messages: [{ role: "user", content: [{ type: "text", text: "In one sentence, what screen is this?" }, zg.imagePart(fs.readFileSync(FIXTURE), "image/jpeg")] }],
    });
    show("vision", r.trace, JSON.stringify(r.text.trim().slice(0, 100)));
  });
})();
