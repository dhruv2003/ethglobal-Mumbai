/*
 * Which 0G model does which job. Override any of these in backend/.env.
 *
 * PRD JDG-08: freeze model IDs, prompt version and rubric per event. Call
 * frozenConfig() when an event opens for betting and store the result with the event.
 *
 * Defaults chosen from GET /v1/models (checked 2026-11-06):
 *  - 0gm-1.0-35b-a3b: 0G's own model, runs in a TEE (TDX), text + image input,
 *    JSON mode and tools. Cheap. Good default for judges, so verdicts are verifiable.
 *  - whisper-large-v3: TEE-attested speech-to-text (judge voice notes, demo videos).
 *  - qwen3-embedding-8b: TEE-attested embeddings for evidence retrieval.
 * If judging quality is too weak, set ZG_MODEL_JUDGE to a stronger router model
 * (e.g. glm-5.2 or claude-sonnet-5.5): still served through 0G, but not TEE-attested.
 */

const MODELS = {
  judge: process.env.ZG_MODEL_JUDGE || "0gm-1.0-35b-a3b",
  advocate: process.env.ZG_MODEL_ADVOCATE || "0gm-1.0-35b-a3b",
  vision: process.env.ZG_MODEL_VISION || "0gm-1.0-35b-a3b",
  persona: process.env.ZG_MODEL_PERSONA || "0gm-1.0-35b-a3b",
  transcribe: process.env.ZG_MODEL_TRANSCRIBE || "whisper-large-v3",
  embed: process.env.ZG_MODEL_EMBED || "qwen3-embedding-8b",
  speech: process.env.ZG_MODEL_SPEECH || "minimax-speech-2.8-turbo",
  image: process.env.ZG_MODEL_IMAGE || "z-image-turbo",
};

/** Ask for TEE verification on every chat call (adds latency; worth it for judges). */
const VERIFY_TEE = process.env.ZG_VERIFY_TEE !== "false";

/** Snapshot to store with an event when it opens (JDG-08). */
function frozenConfig(promptVersion) {
  return { models: { ...MODELS }, verifyTee: VERIFY_TEE, promptVersion, frozenAt: new Date().toISOString() };
}

module.exports = { MODELS, VERIFY_TEE, frozenConfig };
