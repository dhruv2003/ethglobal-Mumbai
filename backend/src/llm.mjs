/*
 * One structured LLM call, whichever provider is configured.
 *
 *   JUDGE_PROVIDER=openai     (default) OPENAI_API_KEY,    JUDGE_MODEL default gpt-5.4
 *   JUDGE_PROVIDER=anthropic            ANTHROPIC_API_KEY, JUDGE_MODEL default claude-opus-5-5
 *
 * structuredCall(schema, name, system, user) -> { parsed, refusal, usage, stop }
 * SDKs load lazily so only the configured one is imported.
 */
export const PROVIDER = (process.env.JUDGE_PROVIDER ?? "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
export const MODEL = process.env.JUDGE_MODEL ?? (PROVIDER === "openai" ? "gpt-5.4" : "claude-opus-5-5");
export const EFFORT = process.env.JUDGE_EFFORT ?? "high";

export const hasCredentials = () =>
  PROVIDER === "openai" ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

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
  const refusal = (res.output ?? []).flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal")?.refusal ?? null;
  return {
    parsed: res.output_parsed ?? null,
    refusal,
    usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 },
    stop: res.incomplete_details?.reason ?? res.status,
  };
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
  return {
    parsed: res.parsed_output ?? null,
    refusal: res.stop_reason === "refusal" ? res.stop_details?.explanation ?? "The model declined." : null,
    usage: { input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0 },
    stop: res.stop_reason,
  };
}

export const structuredCall = (schema, name, system, user) =>
  PROVIDER === "openai" ? callOpenAI(schema, name, system, user) : callAnthropic(schema, name, system, user);
