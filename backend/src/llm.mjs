/*
 * One structured LLM call, whichever provider is configured.
 *
 *   JUDGE_PROVIDER=0g         (default) ZG_API_KEY,        JUDGE_MODEL default 0gm-1.0-35b-a3b
 *   JUDGE_PROVIDER=openai               OPENAI_API_KEY,    JUDGE_MODEL default gpt-5.4
 *   JUDGE_PROVIDER=anthropic            ANTHROPIC_API_KEY, JUDGE_MODEL default claude-opus-5-5
 *
 * structuredCall(schema, name, system, user) -> { parsed, refusal, usage, stop }
 * SDKs load lazily so only the configured one is imported.
 */
import { callZeroG, EFFORT, fromAnthropicMessage, fromOpenAIResponse, hasCredentials, MODEL, PROVIDER } from "./judges/review.mjs";

// Keep the review pipeline and judge panel on the same provider and credentials.
export { EFFORT, hasCredentials, MODEL, PROVIDER };

let openai;
let anthropic;

async function callOpenAI(schema, name, system, user) {
  openai ??= await (async () => {
    const { default: OpenAI } = await import("openai");
    const { zodTextFormat } = await import("openai/helpers/zod");
    return { client: new OpenAI(), zodTextFormat };
  })();
  const res = await openai.client.responses.parse({
    model: MODEL,
    instructions: system,
    input: user,
    reasoning: { effort: EFFORT },
    max_output_tokens: 32000,
    text: { format: openai.zodTextFormat(schema, name) },
  });
  return fromOpenAIResponse(res);
}

async function callAnthropic(schema, name, system, user) {
  anthropic ??= await (async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    return { client: new Anthropic(), zodOutputFormat };
  })();
  const res = await anthropic.client.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, format: anthropic.zodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content: user }],
  });
  return fromAnthropicMessage(res, "The model declined.");
}

export const structuredCall = (schema, name, system, user) =>
  PROVIDER === "0g"
    ? callZeroG(system, user, { schema, name, maxTokens: 32000 })
    : PROVIDER === "openai"
      ? callOpenAI(schema, name, system, user)
      : callAnthropic(schema, name, system, user);
