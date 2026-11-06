import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { z } from "zod";

process.env.JUDGE_PROVIDER = "0g";
process.env.ZG_API_KEY = crypto.randomUUID();
delete process.env.JUDGE_MODEL;
delete process.env.OPENAI_API_KEY;
const llm = await import("../src/llm.mjs");
const judges = await import("../src/judges/review.mjs");

test("the reviewer uses the same 0G provider, model and credentials as the judges", () => {
  assert.equal(llm.PROVIDER, judges.PROVIDER);
  assert.equal(llm.MODEL, judges.MODEL);
  assert.equal(llm.hasCredentials(), true);
});

test("reviewer schemas use 0G chat completions without reusing the judge schema", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).pathname, "/v1/chat/completions");
    const body = JSON.parse(options.body);
    calls.push(body);
    const parsed = body.response_format.json_schema.name === "evidence_dossier" ? { summary: "Evidence checked" } : { flows: ["Home"] };
    return new Response(JSON.stringify({
      id: "chat-test", model: llm.MODEL,
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(parsed) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      x_0g_trace: { request_id: "request-test", billing: { total_cost_usd_micro: 7 } },
    }), { headers: { "content-type": "application/json" } });
  });
  const dossier = await llm.structuredCall(z.object({ summary: z.string() }), "evidence_dossier", "system", "user");
  const flows = await llm.structuredCall(z.object({ flows: z.array(z.string()) }), "live_flows", "system", "user");
  assert.deepEqual(dossier.parsed, { summary: "Evidence checked" });
  assert.deepEqual(flows.parsed, { flows: ["Home"] });
  assert.deepEqual(calls.map((c) => c.response_format.json_schema.name), ["evidence_dossier", "live_flows"]);
  assert.deepEqual(calls[0].response_format.json_schema.schema.required, ["summary"]);
  assert.deepEqual(calls[1].response_format.json_schema.schema.required, ["flows"]);
  assert.ok(calls.every((c) => c.model === judges.MODEL && c.max_tokens === 32000));
  assert.equal(dossier.trace.requestId, "request-test");
  assert.equal(dossier.trace.costUsdMicro, 7);
});
