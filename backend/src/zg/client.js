/*
 * 0G Compute Router client. Every model call in the backend goes through here.
 *
 * The Router is OpenAI-compatible (https://router-api.0g.ai/v1). This wrapper adds:
 *  - a trace on every result: 0G request ID, provider address, cost, TEE check
 *    (the request ID is what we show on each punch, and what the 0G prize asks for)
 *  - timeouts (PRD BAT-05: 30 s per turn) and retries only where 0G says they help
 *  - typed errors, so callers can tell "out of balance" from "provider down"
 *
 * Docs: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart
 */

const BASE_URL = (process.env.ZG_BASE_URL || "https://router-api.0g.ai/v1").replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 30_000;

class ZgError extends Error {
  constructor(message, { status, code, type, retryable, requestId } = {}) {
    super(message);
    this.name = "ZgError";
    this.status = status;
    this.code = code; // e.g. insufficient_balance, rate_limit_exceeded, no_available_provider
    this.type = type;
    this.retryable = Boolean(retryable);
    this.requestId = requestId;
  }
}

function apiKey() {
  const key = process.env.ZG_API_KEY;
  if (!key) throw new ZgError("ZG_API_KEY is not set (backend/.env)", { code: "missing_api_key" });
  return key;
}

/** The Router sends X-Request-Id twice (gateway + router); the router's UUID is the last one. */
const lastHeader = (headers, name) => headers?.get?.(name)?.split(",").pop().trim() || null;

/**
 * The parts of a 0G response we keep for audit and display.
 * teeVerified: true/false only when the Router checked a TEE signature (it does for
 * whisper; for 0gm chat it currently returns nothing, see README). Never treat null as true.
 */
function traceOf(body, headers, model) {
  const t = body?.x_0g_trace ?? {};
  return {
    model: body?.model ?? model,
    requestId: t.request_id ?? lastHeader(headers, "x-request-id"),
    // Chat ID for independent TEE signature checks (docs: Verifiable Execution).
    chatId: headers?.get?.("zg-res-key") ?? body?.id ?? null,
    provider: t.provider ?? headers?.get?.("x-provider") ?? null,
    costUsdMicro: t.billing?.total_cost_usd_micro != null ? Number(t.billing.total_cost_usd_micro) : null,
    teeVerified: t.tee_verified ?? null, // true | false | null (not requested / not reported)
    e2ee: headers?.get?.("x-0g-e2ee") ?? null, // "sealed" = end-to-end encrypted to the TEE provider
    usage: body?.usage ?? null,
  };
}

async function errorFrom(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const e = body?.error ?? {};
  const retryable = res.status === 429 || res.status === 502;
  return new ZgError(e.message || `0G Router HTTP ${res.status}`, {
    status: res.status,
    code: e.code,
    type: e.type,
    retryable,
    requestId: body?.x_0g_trace?.request_id,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP call with timeout and the retry policy from the 0G errors page:
 * 429 -> wait Retry-After and retry; 502 -> retry once; everything else -> throw.
 */
async function request(path, { method = "POST", json, form, query, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, raw = false } = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Bearer ${apiKey()}` };
    if (json) headers["Content-Type"] = "application/json";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : form, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = err.name === "AbortError";
      const e = new ZgError(timedOut ? `0G call timed out after ${timeoutMs} ms` : `0G network error: ${err.message}`, {
        code: timedOut ? "timeout" : "network_error",
        retryable: true,
      });
      if (attempt < retries) continue;
      throw e;
    }
    clearTimeout(timer);
    if (res.ok) return raw ? res : { body: await res.json(), headers: res.headers };

    const err = await errorFrom(res);
    if (err.retryable && attempt < retries) {
      const wait = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 20) * 1000 : 1500);
      continue;
    }
    throw err;
  }
}

// ---------- public API ----------

/** GET /models: no auth needed. Used to check capabilities before freezing an event config. */
async function listModels() {
  const res = await fetch(`${BASE_URL}/models`);
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()).data;
}

/** GET /providers?model=: on-chain provider addresses, latency, TEE attestation. */
async function listProviders(model) {
  const res = await fetch(`${BASE_URL}/providers?model=${encodeURIComponent(model)}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

/**
 * Chat completion.
 * opts: model, messages, temperature, maxTokens, json (JSON mode), tools, toolChoice,
 *       thinking (false turns off GLM/Qwen thinking), verifyTee, timeoutMs.
 * Returns { text, toolCalls, reasoning, finishReason, trace }.
 */
async function chat({ model, messages, temperature, maxTokens, json = false, tools, toolChoice, thinking, verifyTee = false, timeoutMs, extra } = {}) {
  if (!model) throw new ZgError("chat() needs a model", { code: "invalid_request" });
  const payload = { model, messages };
  if (temperature != null) payload.temperature = temperature;
  if (maxTokens != null) payload.max_tokens = maxTokens;
  if (json) payload.response_format = { type: "json_object" };
  if (tools) payload.tools = tools;
  if (toolChoice) payload.tool_choice = toolChoice;
  if (thinking === false) payload.chat_template_kwargs = { enable_thinking: false };
  if (verifyTee) payload.verify_tee = true;
  Object.assign(payload, extra);

  const { body, headers } = await request("/chat/completions", { json: payload, timeoutMs });
  const choice = body.choices?.[0] ?? {};
  return {
    text: choice.message?.content ?? "",
    toolCalls: choice.message?.tool_calls ?? null,
    reasoning: choice.message?.reasoning_content ?? null,
    finishReason: choice.finish_reason ?? null,
    trace: traceOf(body, headers, model),
  };
}

/** Pull the first JSON object out of model text (handles ```json fences and stray prose). */
function parseJsonLoose(text) {
  const s = String(text ?? "").trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error("no JSON object in model output");
}

/**
 * Chat that must return valid JSON passing `validate(obj) -> string[] errors`.
 * PRD JDG-05: one repair attempt, then fail (the caller pauses the match; we never invent output).
 * Returns { data, trace, traces } where traces includes the repair call if one happened.
 */
async function chatJSON({ validate = () => [], ...opts }) {
  const traces = [];
  let messages = opts.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chat({ ...opts, messages, json: opts.json ?? true });
    traces.push(out.trace);
    let data;
    let problems;
    try {
      data = parseJsonLoose(out.text);
      problems = validate(data);
    } catch (e) {
      problems = [e.message];
    }
    if (!problems.length) return { data, trace: out.trace, traces };
    if (attempt === 1) {
      throw new ZgError(`model output failed validation after repair: ${problems.join("; ")}`, {
        code: "invalid_model_output",
        requestId: out.trace.requestId,
      });
    }
    messages = [
      ...opts.messages,
      { role: "assistant", content: out.text },
      { role: "user", content: `Your output was invalid: ${problems.join("; ")}. Reply again with only the corrected JSON object.` },
    ];
  }
  throw new Error("unreachable");
}

/** Message content part for an image. Accepts a Buffer (+ mime) or an https URL. Base64 is more reliable. */
function imagePart(source, mime = "image/png") {
  const url = Buffer.isBuffer(source) ? `data:${mime};base64,${source.toString("base64")}` : source;
  return { type: "image_url", image_url: { url } };
}

/** POST /audio/transcriptions (whisper). audio: Buffer. TEE-verified by default. */
async function transcribe({ audio, filename = "audio.mp3", mime = "audio/mpeg", model, language, verifyTee = true, timeoutMs = 120_000 }) {
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([audio], { type: mime }), filename);
  if (language) form.set("language", language);
  const { body, headers } = await request("/audio/transcriptions", {
    form,
    query: verifyTee ? { verify_tee: "true" } : undefined,
    timeoutMs,
  });
  return { text: body.text ?? "", trace: traceOf(body, headers, model) };
}

/** POST /embeddings. input: string | string[]. Returns { vectors, trace }. */
async function embed({ input, model }) {
  const { body, headers } = await request("/embeddings", { json: { model, input } });
  return { vectors: body.data.map((d) => d.embedding), trace: traceOf(body, headers, model) };
}

/** POST /audio/speech. Returns { audio: Buffer (mp3), trace }. For judge/announcer narration. */
async function speech({ input, model, voice = "alloy", timeoutMs = 60_000 }) {
  const res = await request("/audio/speech", { json: { model, input, voice }, timeoutMs, raw: true });
  const audio = Buffer.from(await res.arrayBuffer());
  return {
    audio,
    mime: res.headers.get("content-type") || "audio/mpeg",
    trace: { ...traceOf(null, res.headers, model), chatId: null },
  };
}

/** POST /images/generations. For fighter portraits or arena art. Returns the raw body. */
async function generateImage({ prompt, model, size = "1024x1024" }) {
  const { body, headers } = await request("/images/generations", { json: { model, prompt, size }, timeoutMs: 120_000 });
  return { images: body.data ?? [], trace: traceOf(body, headers, model) };
}

module.exports = {
  ZgError,
  listModels,
  listProviders,
  chat,
  chatJSON,
  parseJsonLoose,
  imagePart,
  transcribe,
  embed,
  speech,
  generateImage,
};
