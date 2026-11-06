/*
 * The 0G judge adapter, with no network: a fake OpenAI-compatible client stands in
 * for the 0G Compute Router. Env is set before the modules load (PROVIDER is read once).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ARENA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-0g-test-"));
process.env.JUDGE_PROVIDER = "0g";
delete process.env.JUDGE_MODEL;
delete process.env.ZG_API_KEY;
delete process.env.JUDGE_EVIDENCE;

const review = await import("../src/judges/review.mjs");
const { CRITERION_IDS } = await import("../src/judges/criteria.mjs");
const { validateForm } = await import("../src/judges/persona.mjs");
const { EXAMPLE_FORMS } = await import("../src/judges/seed.mjs");
const evidence = await import("../src/judges/evidence.mjs");

const goodReview = () => ({
  criteria: CRITERION_IDS.map((id) => ({ id, score: 70, comment: "ok", evidence: ["E1"] })),
  headline: "Solid.",
  comment: "Fine work.",
  strengths: [],
  concerns: [],
  dealBreakerHit: false,
  dealBreakerNote: "",
  certainty: "medium",
});

const completion = ({ content = JSON.stringify(goodReview()), refusal = null, finish = "stop", requestId = "req-1", cost = 3700 } = {}) => ({
  id: "chatcmpl-abc",
  model: "0gm-1.0-35b-a3b",
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content, refusal } }],
  usage: { prompt_tokens: 8000, completion_tokens: 1200, total_tokens: 9200 },
  x_0g_trace: { request_id: requestId, provider: "0xProviderAddr", billing: { total_cost_usd_micro: cost } },
});

/** A fake client whose create() plays back `script` entries: a completion, or an error to throw. */
function fakeSetup(script) {
  const calls = [];
  const client = {
    chat: {
      completions: {
        create(body) {
          calls.push(body);
          const next = script[Math.min(calls.length - 1, script.length - 1)];
          return {
            withResponse: async () => {
              if (next instanceof Error) throw next;
              return { data: next, response: { headers: new Headers({ "zg-res-key": "chat-key-1", "x-request-id": "gw-1, router-1" }) } };
            },
          };
        },
      },
    },
  };
  const format = { type: "json_schema", json_schema: { name: "judge_review" }, $parseRaw: (c) => JSON.parse(c) };
  return { setup: { client, format }, calls };
}
const httpError = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
const noSleep = [];
const sleep = async (ms) => void noSleep.push(ms);

test("0g is the default provider with 0gm-1.0-35b-a3b", () => {
  assert.equal(review.PROVIDER, "0g");
  assert.equal(review.MODEL, "0gm-1.0-35b-a3b");
});

test("a missing ZG_API_KEY gives a clear 503", () => {
  assert.equal(review.hasCredentials(), false);
  const e = review.missingCredentialsError();
  assert.equal(e.status, 503);
  assert.match(e.message, /No 0G API key/);
  assert.match(e.message, /ZG_API_KEY/);
});

test("reviewNow refuses with that 503 when ZG_API_KEY is missing", async () => {
  const { reviewNow } = await import("../src/api.mjs");
  await assert.rejects(reviewNow("go-health-me"), (e) => e.status === 503 && /ZG_API_KEY/.test(e.message));
});

test("mapZeroG maps parsed, usage names and the 0G trace", () => {
  const r = review.mapZeroG(completion(), new Headers({ "zg-res-key": "chat-key-1" }), JSON.parse);
  assert.deepEqual(r.parsed.criteria.length, CRITERION_IDS.length);
  assert.equal(r.refusal, null);
  assert.deepEqual(r.usage, { input_tokens: 8000, output_tokens: 1200 });
  assert.equal(r.stop, "stop");
  assert.deepEqual(r.trace, { requestId: "req-1", provider: "0xProviderAddr", costUsdMicro: 3700, chatId: "chat-key-1", model: "0gm-1.0-35b-a3b" });
});

test("mapZeroG: refusal, malformed JSON and a missing trace", () => {
  const refused = review.mapZeroG(completion({ content: null, refusal: "I can't judge this." }), null, JSON.parse);
  assert.equal(refused.refusal, "I can't judge this.");
  assert.equal(refused.parsed, null);

  const truncated = review.mapZeroG(completion({ content: '{"criteria": [', finish: "length" }), null, JSON.parse);
  assert.equal(truncated.parsed, null);
  assert.equal(truncated.stop, "length");

  const bare = { ...completion(), x_0g_trace: undefined };
  const t = review.mapZeroG(bare, new Headers({ "x-request-id": "gw-9, router-9" }), JSON.parse).trace;
  assert.equal(t.requestId, "router-9"); // router's ID is the last X-Request-Id
  assert.equal(t.costUsdMicro, null);
  assert.equal(t.chatId, "chatcmpl-abc");
});

test("callZeroG sends chat completions with the json_schema format and reasoning effort", async () => {
  const { setup, calls } = fakeSetup([completion()]);
  const r = await review.callZeroG("SYS", "USER", { setup, sleep });
  assert.equal(calls.length, 1);
  const body = calls[0];
  assert.equal(body.model, "0gm-1.0-35b-a3b");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.reasoning_effort, "high");
  assert.deepEqual(body.messages, [
    { role: "system", content: "SYS" },
    { role: "user", content: "USER" },
  ]);
  assert.equal(r.trace.chatId, "chat-key-1");
  assert.equal(r.trace.requestId, "req-1");
});

test("402 is not retried and says the 0G balance is empty", async () => {
  const { setup, calls } = fakeSetup([httpError(402)]);
  await assert.rejects(review.callZeroG("s", "u", { setup, sleep }), (e) => e.status === 402 && e.code === "insufficient_balance" && /0G balance empty/.test(e.message));
  assert.equal(calls.length, 1);
});

test("429 waits for Retry-After, then retries", async () => {
  noSleep.length = 0;
  const { setup, calls } = fakeSetup([httpError(429, { "retry-after": "3" }), completion({ requestId: "req-after-429" })]);
  const r = await review.callZeroG("s", "u", { setup, sleep });
  assert.equal(calls.length, 2);
  assert.deepEqual(noSleep, [3000]);
  assert.equal(r.trace.requestId, "req-after-429");
});

test("429 gives up after 3 retries; 502 is retried once", async () => {
  const many429 = fakeSetup([httpError(429, { "retry-after": "1" })]);
  await assert.rejects(review.callZeroG("s", "u", { setup: many429.setup, sleep }), (e) => e.status === 429);
  assert.equal(many429.calls.length, 4);

  const twice502 = fakeSetup([httpError(502), httpError(502)]);
  await assert.rejects(review.callZeroG("s", "u", { setup: twice502.setup, sleep }), (e) => e.status === 502);
  assert.equal(twice502.calls.length, 2);
});

const judge = validateForm(EXAMPLE_FORMS[0]).persona;
const project = { id: "p", submission: { name: "P" }, dossier: null, liveTest: null };

test("a repaired review keeps both 0G traces; scoring is unchanged", async () => {
  const bad = goodReview();
  bad.criteria.pop();
  const replies = [
    review.mapZeroG(completion({ content: JSON.stringify(bad), requestId: "first", cost: 1000 }), null, JSON.parse),
    review.mapZeroG(completion({ requestId: "repair", cost: 2000 }), null, JSON.parse),
  ];
  let n = 0;
  const r = await review.reviewProject(judge, project, { call: async () => replies[n++] });
  assert.equal(r.status, "scored");
  assert.equal(r.attempts, 2);
  assert.equal(r.overallHundredths, 7000);
  assert.deepEqual(r.traces.map((t) => t.requestId), ["first", "repair"]);
  assert.deepEqual(r.usage, { input_tokens: 16000, output_tokens: 2400 });
});

test("an error mid-review keeps the traces of attempts that ran", async () => {
  const bad = goodReview();
  bad.criteria[0].score = 140;
  let n = 0;
  const call = async () => {
    if (n++ === 0) return review.mapZeroG(completion({ content: JSON.stringify(bad), requestId: "only" }), null, JSON.parse);
    throw Object.assign(new Error("0G balance empty"), { status: 402 });
  };
  const r = await review.reviewProject(judge, project, { call });
  assert.equal(r.status, "error");
  assert.match(r.detail, /balance empty/);
  assert.deepEqual(r.traces.map((t) => t.requestId), ["only"]);
});

test("panel totals list every 0G request ID and sum the cost", () => {
  const z = review.zeroGTotals(
    [{ traces: [{ requestId: "a", provider: "0x1", costUsdMicro: 1000 }, { requestId: "b", provider: "0x1", costUsdMicro: 500 }] }, { traces: [{ requestId: "c", provider: "0x2", costUsdMicro: null }] }, { status: "error" }],
    [{ trace: { requestId: "v1", provider: "0x1", costUsdMicro: 250 } }, { error: "x" }],
  );
  assert.deepEqual(z.requestIds, ["a", "b", "c", "v1"]);
  assert.equal(z.costUsdMicro, 1750);
  assert.equal(z.judgeCostUsdMicro, 1500);
  assert.equal(z.evidenceCostUsdMicro, 250);
  assert.equal(z.uncostedCalls, 1);
  assert.deepEqual(z.providers, ["0x1", "0x2"]);
  assert.equal(review.zeroGTotals([{ status: "scored" }]), null);
});

test("screenshot evidence: IDs per device and step, failures recorded, judges see no traces", async () => {
  const { loadProject } = await import("../src/projects.mjs");
  const p = loadProject("go-health-me");
  const shots = evidence.screenshotsOf(p);
  assert.ok(shots.length > 0);
  assert.ok(shots.some((s) => s.id === "V-laptop-d1"));

  let n = 0;
  const client = {
    imagePart: (buf, mime) => ({ type: "image_url", image_url: { url: `data:${mime};base64,…${buf.length}` } }),
    chatJSON: async ({ messages, validate }) => {
      if (n++ === 1) throw Object.assign(new Error("provider down"), { requestId: "failed-req" });
      assert.equal(messages[1].content[1].type, "image_url");
      const data = { seen: "A landing page.", visibleText: ["Put money on yourself"], matchesStep: "yes", problems: [] };
      assert.deepEqual(validate(data), []);
      const trace = { requestId: `vis-${n}`, provider: "0xV", costUsdMicro: 100, model: "0gm-1.0-35b-a3b" };
      return { data, trace, traces: [trace] };
    },
  };
  const records = await evidence.collectScreenshotEvidence(p, { client, fresh: true, concurrency: 1 });
  assert.equal(records.length, shots.length);
  assert.equal(records[1].error, "provider down");
  assert.equal(records[1].trace.requestId, "failed-req");
  assert.equal(records[0].trace.requestId, "vis-1");
  const seen = evidence.forJudges(records);
  assert.equal(seen.length, shots.length - 1);
  assert.ok(seen.every((o) => !("trace" in o) && !("file" in o)));
  assert.match(seen[0].source, /untrusted/);
});

test("observation validation names bad fields", () => {
  assert.ok(evidence.validateObservation({ seen: "", visibleText: "x", matchesStep: "maybe", problems: [] }).length === 3);
});

test("submitted-project screenshots are read from the live pipeline output", async () => {
  const { liveDir } = await import("../src/store.mjs");
  const id = "submitted-evidence-test";
  const file = path.join(liveDir(id), "phone", "smoke-phone-d1.jpg");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test screenshot");
  const project = { id, kind: "submitted", liveTest: { runs: [{ device: "phone", phases: [{ steps: [
    { id: "d1", title: "Home", status: "passed", screenshot: "phone/smoke-phone-d1.jpg" },
  ] }] }] } };
  assert.equal(evidence.screenshotsOf(project)[0].file, file);
  let images = 0;
  const trace = { requestId: "submitted-vision", model: "vision-test", costUsdMicro: 1 };
  const client = {
    imagePart: (bytes) => { assert.equal(bytes.toString(), "test screenshot"); images++; return { type: "image_url" }; },
    chatJSON: async () => ({ data: { seen: "Home", visibleText: ["Home"], matchesStep: "yes", problems: [] }, trace, traces: [trace] }),
  };
  const records = await evidence.collectScreenshotEvidence(project, { client, fresh: true });
  assert.equal(images, 1);
  assert.equal(records[0].id, "V-phone-d1");
  assert.equal(records[0].trace.requestId, "submitted-vision");
});

test("runPanel reports each 0G request ID as it arrives, then each judge's result", async () => {
  const judges = EXAMPLE_FORMS.map((f) => validateForm(f).persona);
  let n = 0;
  const call = async () => review.mapZeroG(completion({ requestId: `live-${++n}` }), null, JSON.parse);
  const events = [];
  const result = await review.runPanel(judges, project, { call, onEvent: (e) => events.push(e) });
  const calls = events.filter((e) => e.type === "call");
  assert.deepEqual(calls.map((e) => e.requestId).sort(), ["live-1", "live-2", "live-3"]);
  assert.ok(calls.every((e) => e.attempt === 1 && judges.some((j) => j.id === e.judgeId)));
  assert.equal(events.filter((e) => e.type === "judge" && e.status === "scored").length, 3);
  assert.equal(result.zg.requestIds.length, 3);
});

test("public judging: samples only, and a clear 503 without ZG_API_KEY", async () => {
  const { default: express } = await import("express");
  const { router } = await import("../src/api.mjs");
  const app = express().use("/api", router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const notSample = await fetch(`${base}/projects/not-a-project/reviews/public`, { method: "POST" });
    assert.equal(notSample.status, 404);
    const noKey = await fetch(`${base}/projects/go-health-me/reviews/public`, { method: "POST" });
    assert.equal(noKey.status, 503);
    assert.match((await noKey.json()).error, /ZG_API_KEY/);
    const third = await fetch(`${base}/projects/go-health-me/reviews/public`, { method: "POST" });
    assert.equal(third.status, 429); // 2 per IP per hour
  } finally {
    server.close();
  }
});

test("a timeout is retried once, then thrown", async () => {
  const timeout = () => Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });
  const once = fakeSetup([timeout(), completion({ requestId: "after-timeout" })]);
  assert.equal((await review.callZeroG("s", "u", { setup: once.setup, sleep })).trace.requestId, "after-timeout");
  const twice = fakeSetup([timeout(), timeout()]);
  await assert.rejects(review.callZeroG("s", "u", { setup: twice.setup, sleep }), /timed out/);
  assert.equal(twice.calls.length, 2);
});

test("screenshot evidence reused from the cache isn't counted in a later run's cost", () => {
  const z = review.zeroGTotals([{ traces: [{ requestId: "j", costUsdMicro: 100 }] }], [{ cached: true, trace: { requestId: "old", costUsdMicro: 900 } }]);
  assert.deepEqual(z.requestIds, ["j"]);
  assert.equal(z.costUsdMicro, 100);
});
