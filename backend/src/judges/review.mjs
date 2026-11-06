/*
 * One judge reviews one project with an LLM: on 0G by default, or OpenAI / Claude directly.
 *
 *   JUDGE_PROVIDER=0g         (default) needs ZG_API_KEY,        JUDGE_MODEL default 0gm-1.0-35b-a3b
 *   JUDGE_PROVIDER=openai               needs OPENAI_API_KEY,    JUDGE_MODEL default gpt-5.4
 *   JUDGE_PROVIDER=anthropic            needs ANTHROPIC_API_KEY, JUDGE_MODEL default claude-opus-5-5
 *
 * 0G is the 0G Compute Router (OpenAI-compatible chat completions). Every 0G call
 * keeps its trace (request ID, provider address, cost) so the UI can show proof.
 * On 0G, use 0gm-1.0-35b-a3b or gpt-5.4: Claude models there reject json_schema.
 * If a 0G call fails and OPENAI_API_KEY is set, that call falls back to OpenAI (see callWithFallback).
 *
 * - Structured output (zod) so every review has the same shape, whichever provider.
 * - All 9 criteria must be scored exactly once, integers 0-100. Anything else
 *   gets one repair attempt; if that fails the review is marked invalid and no
 *   score is invented (PRD JDG-05).
 * - The overall score is computed here, in integers, from the judge's weights:
 *   sum(weight% x score) is already in hundredths of a point (PRD 9.2 style).
 * - Judges run independently and in parallel; none sees another's output (JDG-03).
 */
import fs from "node:fs";
import { z } from "zod";
import { CRITERIA, CRITERION_IDS } from "./criteria.mjs";
import { screenshotsOf } from "./evidence.mjs";
import { compilePrompt, PROMPT_VERSION } from "./persona.mjs";
import { transcripts } from "../store.mjs";

export const PROVIDERS = ["0g", "openai", "anthropic"];
const DEFAULT_MODEL = { "0g": "0gm-1.0-35b-a3b", openai: "gpt-5.4", anthropic: "claude-opus-5-5" };
const KEY_NAME = { "0g": "ZG_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
export const PROVIDER_LABEL = { "0g": "0G Compute Router", openai: "OpenAI", anthropic: "Anthropic" };

const requested = (process.env.JUDGE_PROVIDER || "0g").toLowerCase();
export const PROVIDER = PROVIDERS.includes(requested) ? requested : "0g";
export const MODEL = process.env.JUDGE_MODEL || DEFAULT_MODEL[PROVIDER];
export const EFFORT = process.env.JUDGE_EFFORT ?? "high";
const ZG_BASE_URL = (process.env.ZG_BASE_URL || "https://router-api.0g.ai/v1").replace(/\/$/, "");

const ReviewSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.enum(CRITERION_IDS),
      score: z.number().int(),
      comment: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
  headline: z.string(),
  comment: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  dealBreakerHit: z.boolean(),
  dealBreakerNote: z.string(),
  certainty: z.enum(["low", "medium", "high"]),
});

/** Is there a key for the configured provider? */
export const hasCredentials = (provider = PROVIDER) =>
  provider === "0g"
    ? Boolean(process.env.ZG_API_KEY)
    : provider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY)
      : Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** The error the API returns (503) when the configured provider has no key. */
export function missingCredentialsError(provider = PROVIDER) {
  const msg =
    provider === "0g"
      ? "No 0G API key on the server. Add ZG_API_KEY to backend/.env (create one at https://pc.0g.ai/dashboard/api-keys) and restart."
      : `No ${PROVIDER_LABEL[provider]} API key on the server. Add ${KEY_NAME[provider]} to backend/.env and restart.`;
  return Object.assign(new Error(msg), { status: 503, code: "missing_api_key" });
}

/*
 * A judge's user message is either plain text or { text, images: [{ caption, mime, data (base64) }] }:
 * the live-test screenshots go to the judge as real images, each preceded by its citable ID.
 */
const imagesOf = (u) => (typeof u === "string" ? [] : u?.images ?? []);
export const textOf = (u) => (typeof u === "string" ? u : u?.text ?? "");
const toOpenAIInput = (u) =>
  imagesOf(u).length
    ? [{ role: "user", content: [{ type: "input_text", text: textOf(u) }, ...imagesOf(u).flatMap((i) => [{ type: "input_text", text: i.caption }, { type: "input_image", image_url: `data:${i.mime};base64,${i.data}`, detail: "high" }])] }]
    : textOf(u);
const toAnthropicContent = (u) =>
  imagesOf(u).length ? [{ type: "text", text: textOf(u) }, ...imagesOf(u).flatMap((i) => [{ type: "text", text: i.caption }, { type: "image", source: { type: "base64", media_type: i.mime, data: i.data } }])] : textOf(u);
const toChatContent = (u) =>
  imagesOf(u).length ? [{ type: "text", text: textOf(u) }, ...imagesOf(u).flatMap((i) => [{ type: "text", text: i.caption }, { type: "image_url", image_url: { url: `data:${i.mime};base64,${i.data}` } }])] : textOf(u);

/*
 * Provider adapters. Each takes (system, user) and returns
 * { parsed, refusal, usage: { input_tokens, output_tokens }, stop } and, on 0G, a trace.
 * SDKs are imported lazily so only the configured one loads.
 */
let openaiCall;
async function callOpenAI(system, user, model = MODEL) {
  openaiCall ??= await (async () => {
    const { default: OpenAI } = await import("openai");
    const { zodTextFormat } = await import("openai/helpers/zod");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const format = zodTextFormat(ReviewSchema, "judge_review");
    return (sys, usr, m) =>
      client.responses.parse({
        model: m,
        instructions: sys,
        input: toOpenAIInput(usr),
        reasoning: { effort: EFFORT },
        max_output_tokens: 16000,
        text: { format },
      });
  })();
  const res = await openaiCall(system, user, model);
  const refusal = (res.output ?? []).flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal")?.refusal ?? null;
  return {
    parsed: res.output_parsed ?? null,
    refusal,
    usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 },
    stop: res.incomplete_details?.reason ?? res.status,
  };
}

let anthropicCall;
async function callAnthropic(system, user) {
  anthropicCall ??= await (async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const client = new Anthropic();
    const format = zodOutputFormat(ReviewSchema);
    return (sys, usr) =>
      client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT, format },
        system: sys,
        messages: [{ role: "user", content: toAnthropicContent(usr) }],
      });
  })();
  const res = await anthropicCall(system, user);
  return {
    parsed: res.parsed_output ?? null,
    refusal: res.stop_reason === "refusal" ? res.stop_details?.explanation ?? "The model declined to review." : null,
    usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 },
    stop: res.stop_reason,
  };
}

/*
 * 0G Compute Router. The Responses API is not available there, so this uses chat
 * completions with the same zod schema as a json_schema response format. That is
 * exactly the request chat.completions.parse sends; we parse the body ourselves so a
 * truncated or malformed reply goes to the repair attempt (with its 0G trace kept)
 * instead of throwing.
 */
let zgSetup;
async function zeroGSetup(schema, name) {
  zgSetup ??= await (async () => {
    const { default: OpenAI } = await import("openai");
    const { zodResponseFormat } = await import("openai/helpers/zod");
    // Retries are ours (withZgRetry), following the 0G errors page.
    const client = new OpenAI({ apiKey: process.env.ZG_API_KEY, baseURL: ZG_BASE_URL, maxRetries: 0, timeout: 180_000 });
    return { client, zodResponseFormat };
  })();
  const { client, zodResponseFormat } = await zgSetup;
  return { client, format: zodResponseFormat(schema, name) };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const headerOf = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? null;

/**
 * Retry policy from the 0G errors page:
 * 402 insufficient_balance -> never retry, say the balance is empty;
 * 429 -> wait Retry-After (capped) and retry, up to 3 times;
 * 502 / 503 -> retry once after a short pause;
 * a timeout or dropped connection (no HTTP status) -> retry once: the only 0gm provider
 * occasionally stalls, and a fresh request usually goes straight through;
 * anything else -> throw.
 */
export async function withZgRetry(fn, { sleep = sleepMs, max429 = 3 } = {}) {
  let n429 = 0;
  let retried5xx = false;
  let retriedNet = false;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status;
      if (status === 402) {
        throw Object.assign(new Error("0G balance empty: top up the account behind ZG_API_KEY at https://pc.0g.ai, then ask again."), {
          status: 402,
          code: "insufficient_balance",
        });
      }
      if (status === 429 && n429 < max429) {
        n429++;
        const wait = Number(headerOf(e.headers, "retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1000 : 2000);
        continue;
      }
      const network = status == null && /timed? ?out|connection/i.test(`${e?.name} ${e?.message}`);
      if (network && !retriedNet) {
        retriedNet = true;
        continue;
      }
      if ((status === 502 || status === 503) && !retried5xx) {
        retried5xx = true;
        await sleep(2000);
        continue;
      }
      throw e;
    }
  }
}

/** 0G chat completion + headers -> the adapter shape, plus the 0G trace. */
export function mapZeroG(res, headers, parse) {
  const choice = res?.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  let parsed = msg.parsed ?? null;
  if (!parsed && parse && msg.content && !msg.refusal) {
    try {
      parsed = parse(msg.content);
    } catch {
      parsed = null; // malformed or schema-breaking: problems() reports it and the repair attempt runs
    }
  }
  const t = res?.x_0g_trace ?? {};
  const micro = t.billing?.total_cost_usd_micro;
  return {
    parsed,
    refusal: msg.refusal || null,
    usage: { input_tokens: res?.usage?.prompt_tokens ?? 0, output_tokens: res?.usage?.completion_tokens ?? 0 },
    stop: choice.finish_reason ?? null,
    trace: {
      requestId: t.request_id ?? headerOf(headers, "x-request-id")?.split(",").pop().trim() ?? null,
      provider: t.provider ?? null,
      costUsdMicro: micro != null && Number.isFinite(Number(micro)) ? Number(micro) : null,
      // Chat ID for the independent TEE signature check (docs: Verifiable Execution). Not checked here.
      chatId: headerOf(headers, "zg-res-key") ?? res?.id ?? null,
      model: res?.model ?? MODEL,
    },
  };
}

// The reviewer shares this adapter, with its own dossier/flow schema and token budget.
export async function callZeroG(system, user, { setup, sleep, schema = ReviewSchema, name = "judge_review", maxTokens = 16000 } = {}) {
  const { client, format } = setup ?? (await zeroGSetup(schema, name));
  const { data, response } = await withZgRetry(
    () =>
      client.chat.completions
        .create({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: toChatContent(user) },
          ],
          response_format: format,
          reasoning_effort: EFFORT,
          max_tokens: maxTokens,
        })
        .withResponse(),
    { sleep },
  );
  return mapZeroG(data, response?.headers, format.$parseRaw);
}

const ADAPTERS = { "0g": callZeroG, openai: callOpenAI, anthropic: callAnthropic };
/** The configured provider only, never a fallback (public runs use this: they must be 0G). */
export const callPrimary = (system, user) => ADAPTERS[PROVIDER](system, user);

/*
 * OpenAI fallback, used only when 0G is the provider and a 0G call fails after its own
 * retries (balance empty, provider down, timeout...). It never replaces 0G up front, and
 * a refusal or a malformed reply from 0G is not a failure (the repair attempt handles those).
 * On when OPENAI_API_KEY is set; JUDGE_FALLBACK=off disables it. JUDGE_FALLBACK_MODEL picks the model.
 */
export function fallbackTarget() {
  if (PROVIDER !== "0g" || !process.env.OPENAI_API_KEY) return null;
  if ((process.env.JUDGE_FALLBACK ?? "openai").toLowerCase() === "off") return null;
  return { provider: "openai", model: process.env.JUDGE_FALLBACK_MODEL || DEFAULT_MODEL.openai };
}

/** opts.primary / opts.fallback / opts.target replace the real adapters and config (tests). */
export async function callWithFallback(system, user, { primary = callPrimary, fallback = callOpenAI, target = fallbackTarget() } = {}) {
  try {
    return await primary(system, user);
  } catch (e) {
    if (!target) throw e;
    const reason = String(e?.message ?? e).slice(0, 200);
    let res;
    try {
      res = await fallback(system, user, target.model);
    } catch (f) {
      throw Object.assign(new Error(`0G failed (${reason}); OpenAI fallback failed too (${String(f?.message ?? f).slice(0, 200)})`), { status: e?.status, requestId: e?.requestId });
    }
    return { ...res, fallback: { provider: target.provider, model: target.model, reason, zgRequestId: e?.requestId ?? null } };
  }
}

const callModel = (system, user) => callWithFallback(system, user);

/*
 * Everything a judge sees, in one place: the submission, the full reviewer dossier, the demo
 * transcript, the live test (every step with its result and detail, page health, failed requests)
 * and the live-test screenshots themselves as images. Every item carries an ID the judge can cite;
 * the list of valid IDs is given explicitly, and citations to anything else are dropped afterwards.
 */
const clipText = (v, n) => {
  const t = String(v ?? "");
  return t.length > n ? `${t.slice(0, n)}… (cut at ${n} characters)` : t;
};
const uniq = (xs) => [...new Set(xs)];
const pathOf = (u) => {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u);
  }
};

/** The live test, with what a judge needs to reason about it (no file paths or frame URLs). */
export function liveTestForJudges(lt) {
  if (!lt?.runs?.length) return null;
  return {
    target: lt.target,
    ranAt: lt.ranAt,
    howToRead:
      "passed = the browser saw the expected text or page; failed = it did not (detail says what was missing); blocked/requires = the step needs a sign-in, wallet, device or payment, so it was not attempted (that is a limit of the test, not proof the feature is broken). d* steps replay the team's demo video; f* steps are the app's main flows.",
    runs: lt.runs.map((r) => ({
      device: r.device,
      viewport: r.viewport ? `${r.viewport.width}x${r.viewport.height}` : undefined,
      outcome: r.outcome,
      home: r.home && { httpStatus: r.home.status, loadMs: r.home.loadMs, title: r.home.title, h1: r.home.h1, horizontalScroll: r.home.horizontalScroll, viewportMeta: r.home.viewportMeta, brokenImages: r.home.brokenImages },
      consoleErrors: r.consoleErrors?.length ? { count: r.consoleErrors.length, distinct: uniq(r.consoleErrors.map((e) => clipText(e, 160))).slice(0, 5) } : undefined,
      failedRequests: uniq((r.failedRequests ?? []).map((f) => `${pathOf(f.url)} -> ${f.status ?? f.error}`)).slice(0, 12),
      phases: (r.phases ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        steps: (p.steps ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          ...(s.demoAt ? { demoAt: s.demoAt } : {}),
          ...(s.requires ? { requires: s.requires } : {}),
          ...(s.detail ? { detail: clipText(s.detail, 240) } : {}),
          ...(s.screenshot ? { screenshotId: `V-${r.device}-${s.id}` } : {}),
        })),
      })),
    })),
  };
}

/** The whole dossier, minus bookkeeping (token counts, timings). */
export function dossierForJudges(d) {
  if (!d) return null;
  return {
    reviewerMethod: d.reviewer?.method,
    summary: d.summary,
    verdict: d.verdict,
    problem: d.problem,
    intendedUsers: d.intendedUsers,
    coreJourney: d.coreJourney,
    highlights: d.highlights,
    evidence: (d.evidence ?? []).map((e) => ({
      id: e.id,
      claim: e.claim,
      source: e.source,
      status: e.status,
      ...(e.impact ? { impact: e.impact } : {}),
      observation: e.observation,
      limitations: e.limitations || undefined,
      refs: (e.refs ?? []).slice(0, 4),
    })),
    architecture: d.architecture?.map((a) => `${a.component}: ${a.detail}`),
    dependencies: d.dependencies?.slice(0, 20).map((x) => `${x.name} ${x.version}`),
    tests: d.tests,
    continuity: d.continuity,
    strengths: d.strengths,
    limitations: d.limitations,
    risks: d.risks,
    unresolvedQuestions: d.unresolvedQuestions,
  };
}

/** What the team says in its demo: a saved transcript (submitted) or the fixture's. */
function demoTranscriptOf(project) {
  if (!project.id) return null;
  try {
    if (project.kind === "submitted") return transcripts.get(project.id)?.text ?? null;
    const f = new URL(`../../fixtures/${project.id}/media/demo-transcript.md`, import.meta.url);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  } catch {
    return null;
  }
}

export const MAX_IMAGES = Math.max(0, Number(process.env.JUDGE_MAX_IMAGES ?? 12) || 0);

/**
 * Live-test screenshots to show the judge as images, at most MAX_IMAGES: every laptop step first
 * (the full journey), then phone steps that did not pass, then the other phone steps.
 */
export function judgeImages(project, max = MAX_IMAGES) {
  if (!max || !project.id || !project.liveTest?.runs?.length) return [];
  let shots;
  try {
    shots = screenshotsOf(project).filter((s) => fs.existsSync(s.file));
  } catch {
    return [];
  }
  const rank = (s) => (s.device === "laptop" ? 0 : s.stepStatus !== "passed" ? 1 : 2);
  return shots
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .slice(0, max)
    .map(({ s }) => {
      const ext = s.file.split(".").pop().toLowerCase();
      return {
        id: s.id,
        caption: `[${s.id}] ${s.device} screenshot, step ${s.stepId} "${s.stepTitle}", test result: ${s.stepStatus}. Shows only the visible part of the page.`,
        mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        data: fs.readFileSync(s.file).toString("base64"),
      };
    });
}

/** Every ID a judge may cite for this project. */
export function citableIds(project) {
  const ids = new Set((project.dossier?.evidence ?? []).map((e) => e.id));
  for (const r of project.liveTest?.runs ?? [])
    for (const p of r.phases ?? [])
      for (const s of p.steps ?? []) {
        ids.add(s.id);
        ids.add(`V-${r.device}-${s.id}`);
      }
  for (const o of project.screenshotEvidence ?? []) ids.add(o.id);
  return ids;
}

function materials(project, images) {
  const transcript = demoTranscriptOf(project);
  const out = {
    submission: project.submission,
    reviewerDossier: dossierForJudges(project.dossier) ?? "No dossier: the code was not fact-checked. Judge from the other materials, treat every technical claim as unverified, and lower your certainty.",
    demoTranscript: transcript ? clipText(transcript, 9000) : "No demo transcript available.",
    liveTest: liveTestForJudges(project.liveTest) ?? "The live app was not tested. Judge UI/UX and the product journey from the demo and the code only, and say so.",
  };
  if (project.screenshotEvidence?.length) out.screenshotObservations = project.screenshotEvidence;
  if (images.length) out.attachedScreenshots = images.map((i) => i.id);
  return JSON.stringify(out, null, 2);
}

const criteriaGuide = CRITERIA.map((c) => `- ${c.id} (${c.label}): ${c.about}`).join("\n");

/** The judge's user message: { text, images }. */
export function userPrompt(project, { images = judgeImages(project) } = {}) {
  const ids = [...citableIds(project)];
  const text = [
    `Judge the project "${project.submission?.name ?? "unnamed"}". Score each of these criteria (use these exact ids):`,
    criteriaGuide,
    "",
    "Work in this order:",
    "1. Read everything below and the attached screenshots. Note what is verified (code evidence marked supported_by_code or contradicted, live-test steps that passed or failed, what you can see in a screenshot) and what is only claimed (submission text, demo narration, submitted_claim, unverified).",
    "2. For each criterion, decide the score from the verified evidence first, then adjust modestly for credible claims. Use the scoring anchors in your instructions.",
    "3. Write the review.",
    "",
    "For each criterion: a score (integer 0-100); a comment of one or two sentences in your voice that names the specific evidence behind the score (what was seen or found, not generic praise); and the IDs you relied on.",
    `IDs you may cite, exactly as written (anything else is discarded): ${ids.length ? ids.join(", ") : "(none: this project has no dossier evidence or live test, so evidence lists stay empty)"}.`,
    "Then: a one-sentence headline verdict; an overall comment under 120 words addressed to the team, with the single most useful thing to fix; up to 3 strengths and up to 3 concerns, each specific and evidence-based; whether one of your deal-breakers was hit (only if the evidence shows it, not merely because something is unverified) and why; and how certain you are overall (low if key materials are missing).",
    ...(images.length
      ? ["", `${images.length} live-test screenshots are attached after this message, each preceded by its ID. Look at them yourself: they are the most direct evidence of what the product looks like and whether a screen works. Cite them by ID.`]
      : []),
    ...(project.screenshotEvidence?.length
      ? ["", "screenshotObservations were written by a vision model looking at the live-test screenshots. They can be wrong; where you can see the screenshot yourself, trust your own reading."]
      : []),
    "",
    "<project_materials>",
    materials(project, images),
    "</project_materials>",
  ].join("\n");
  return { text, images };
}

/** Problems with a parsed review, in words. Empty list = valid. */
export function problems(review) {
  if (!review) return ["No parseable review was returned."];
  const out = [];
  const seen = new Map();
  for (const c of review.criteria) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  for (const id of CRITERION_IDS) {
    if (!seen.has(id)) out.push(`Missing criterion ${id}.`);
    else if (seen.get(id) > 1) out.push(`Criterion ${id} scored more than once.`);
  }
  for (const c of review.criteria) if (!Number.isInteger(c.score) || c.score < 0 || c.score > 100) out.push(`Score for ${c.id} must be an integer 0-100 (got ${c.score}).`);
  return out;
}

/** Overall in hundredths of a point: sum of weight% x score. Exact integers, no floats. */
export const overallHundredths = (weights, review) => review.criteria.reduce((n, c) => n + (weights[c.id] ?? 0) * c.score, 0);

/**
 * opts.call replaces the provider adapter (tests).
 * opts.onTrace(trace, attempt) is called as soon as each 0G call answers, so the UI can show its request ID live.
 */
export async function reviewProject(judge, project, { call = callModel, onTrace, onFallback } = {}) {
  const started = Date.now();
  // Judges saved under an older prompt version are recompiled, so prompt improvements reach every judge.
  const system = judge.promptVersion === PROMPT_VERSION && judge.systemPrompt ? judge.systemPrompt : compilePrompt(judge);
  const base = userPrompt(project);
  let prompt = base;
  const usage = { input_tokens: 0, output_tokens: 0 };
  let attempts = 0;
  let parsed = null;
  let issues = [];
  let stop = null;
  const traces = []; // one per attempt on 0G: request ID, provider, cost
  const fallbacks = []; // attempts that 0G failed and OpenAI answered instead
  const withTraces = (r) => ({ ...r, ...(traces.length ? { traces } : {}), ...(fallbacks.length ? { fallbacks } : {}) });

  while (attempts < 2) {
    attempts++;
    let res;
    try {
      res = await call(system, prompt);
    } catch (e) {
      // Keep the IDs of attempts that did run, so a failed review is still auditable.
      return withTraces({ judgeId: judge.id, status: "error", detail: String(e?.message ?? e).slice(0, 300), attempts, usage, ms: Date.now() - started });
    }
    if (res.trace) {
      traces.push(res.trace);
      onTrace?.(res.trace, attempts);
    }
    if (res.fallback) {
      fallbacks.push({ attempt: attempts, ...res.fallback });
      onFallback?.(res.fallback, attempts);
    }
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    stop = res.stop;
    if (res.refusal) {
      return withTraces({ judgeId: judge.id, status: "declined", detail: res.refusal, attempts, usage, ms: Date.now() - started });
    }
    parsed = res.parsed;
    issues = problems(parsed);
    if (!issues.length) break;
    // One repair attempt (PRD JDG-05): a fresh request that names the problems.
    prompt = { ...base, text: `${base.text}\n\nA previous attempt at this review had these problems; avoid them:\n${issues.map((i) => `- ${i}`).join("\n")}` };
  }

  if (issues.length) {
    return withTraces({ judgeId: judge.id, status: "invalid", detail: issues.join(" "), stopReason: stop, attempts, usage, ms: Date.now() - started });
  }
  const order = new Map(CRITERION_IDS.map((id, i) => [id, i]));
  parsed.criteria.sort((a, b) => order.get(a.id) - order.get(b.id));
  // A citation must point at something the judge was shown; anything else is dropped, never shown as proof.
  const valid = citableIds(project);
  let droppedCitations = 0;
  for (const c of parsed.criteria) {
    const kept = [...new Set(c.evidence.map((e) => String(e).trim().replace(/^\[|\]$/g, "")))].filter((e) => valid.has(e));
    droppedCitations += c.evidence.length - kept.length;
    c.evidence = kept;
  }
  return withTraces({
    judgeId: judge.id,
    status: "scored",
    overallHundredths: overallHundredths(judge.weights, parsed),
    review: parsed,
    promptVersion: PROMPT_VERSION,
    screenshotsShown: base.images.length,
    ...(droppedCitations ? { droppedCitations } : {}),
    attempts,
    usage,
    ms: Date.now() - started,
  });
}

/** Panel totals for the 0G proof: every request ID and the summed cost in micro-dollars. */
export function zeroGTotals(reviews, all = []) {
  const evidence = all.filter((e) => !e.cached); // reused from an earlier run: already paid for there
  const traces = [...reviews.flatMap((r) => r.traces ?? []), ...evidence.flatMap((e) => (e.trace ? [e.trace] : []))];
  if (!traces.length) return null;
  const costs = traces.map((t) => t.costUsdMicro).filter((c) => Number.isFinite(c));
  return {
    requestIds: traces.map((t) => t.requestId).filter(Boolean),
    costUsdMicro: costs.reduce((a, b) => a + b, 0),
    judgeCostUsdMicro: reviews.flatMap((r) => r.traces ?? []).reduce((n, t) => n + (Number.isFinite(t.costUsdMicro) ? t.costUsdMicro : 0), 0),
    evidenceCostUsdMicro: evidence.reduce((n, e) => n + (Number.isFinite(e.trace?.costUsdMicro) ? e.trace.costUsdMicro : 0), 0),
    calls: traces.length,
    uncostedCalls: traces.length - costs.length,
    providers: [...new Set(traces.map((t) => t.provider).filter(Boolean))],
  };
}

/**
 * Run the whole panel in parallel. Each judge is isolated; one failing doesn't stop the others.
 * opts.onEvent gets { type: "call", judgeId, attempt, requestId, provider, costUsdMicro, model }
 * for every 0G call and { type: "judge", judgeId, status, overallHundredths } when a judge finishes.
 */
export async function runPanel(judgesList, project, { onEvent, call } = {}) {
  const emit = (e) => {
    try {
      onEvent?.(e);
    } catch {
      /* progress reporting never breaks a review */
    }
  };
  const results = await Promise.all(
    judgesList.map((j) =>
      reviewProject(j, project, {
        call,
        onTrace: (t, attempt) => emit({ type: "call", judgeId: j.id, judgeName: j.name, attempt, ...t }),
        onFallback: (f, attempt) => emit({ type: "fallback", judgeId: j.id, judgeName: j.name, attempt, ...f }),
      })
        .catch((e) => ({ judgeId: j.id, status: "error", detail: String(e?.message ?? e).slice(0, 300) }))
        .then((r) => {
          emit({ type: "judge", judgeId: j.id, judgeName: j.name, status: r.status, overallHundredths: r.overallHundredths ?? null });
          return r;
        }),
    ),
  );
  const scored = results.filter((r) => r.status === "scored");
  const panel = scored.length ? Math.floor((scored.reduce((n, r) => n + r.overallHundredths, 0) * 2 + scored.length) / (2 * scored.length)) : null;
  const evidence = project.screenshotEvidenceRecords ?? null;
  const zg = zeroGTotals(results, evidence ?? []);
  const fellBack = results.filter((r) => r.fallbacks?.length);
  const fallback = fellBack.length ? { provider: fellBack[0].fallbacks[0].provider, model: fellBack[0].fallbacks[0].model, judges: fellBack.map((r) => r.judgeId) } : null;
  return {
    projectId: project.id,
    ranAt: new Date().toISOString(),
    provider: PROVIDER,
    model: MODEL,
    effort: EFFORT,
    complete: scored.length === judgesList.length,
    panelHundredths: panel,
    ...(zg ? { zg } : {}),
    ...(fallback ? { fallback } : {}),
    ...(evidence ? { evidence } : {}),
    reviews: results.map((r) => {
      const j = judgesList.find((x) => x.id === r.judgeId);
      return { ...r, judge: { id: j.id, name: j.name, title: j.title, version: j.version, promptVersion: PROMPT_VERSION, weights: j.weights, tone: j.tone } };
    }),
  };
}
