// Spike LLM helper: response-format modes, 429 backoff, ONE validation retry, hard call cap.
// Never logs prompts, outputs or keys. Records only counts, timings and status codes.
import OpenAI from "openai";
import { z } from "zod";
import { getNebiusEnv } from "../../src/lib/env";

export type Mode = "json_schema" | "json_object" | "prompt_only";

export interface CallStats {
  attempts: number; // Zod attempts (1 or 2)
  firstValid: boolean;
  finalValid: boolean;
  fenced: boolean; // output needed code-fence stripping
  latencyMs: number; // first attempt only, incl. 429 waits excluded
  promptTokens: number;
  completionTokens: number;
  rateLimited: number; // 429 responses seen
  httpErrors: number; // non-429 API errors
  truncated: boolean; // finish_reason=length on any attempt
  errorKind: string | null; // fixed label, never provider text
}

export class CallCap {
  used = 0;
  constructor(readonly max: number) {}
  take(): void {
    if (++this.used > this.max) throw new Error("CALL_CAP_EXCEEDED");
  }
}

export function makeClient(): OpenAI {
  const env = getNebiusEnv();
  return new OpenAI({ apiKey: env.NEBIUS_API_KEY, baseURL: env.NEBIUS_BASE_URL, timeout: 120_000, maxRetries: 0 });
}

function stripFences(s: string): { text: string; fenced: boolean } {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? { text: m[1]!, fenced: true } : { text: s.trim(), fenced: false };
}

function responseFormat(mode: Mode, schema: z.ZodType, name: string): OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] {
  if (mode === "json_object") return { type: "json_object" };
  if (mode === "json_schema") {
    return {
      type: "json_schema",
      json_schema: { name, strict: true, schema: z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown> },
    };
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One chat request with 429 exponential backoff (max 3 waits). Returns content or throws a labelled error. */
async function chat(
  client: OpenAI,
  cap: CallCap,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  stats: CallStats,
): Promise<{ content: string; finish: string | null }> {
  for (let i = 0; ; i++) {
    cap.take();
    try {
      const res = await client.chat.completions.create(params);
      stats.promptTokens += res.usage?.prompt_tokens ?? 0;
      stats.completionTokens += res.usage?.completion_tokens ?? 0;
      const ch = res.choices[0];
      if (ch?.finish_reason === "length") stats.truncated = true;
      return { content: ch?.message?.content ?? "", finish: ch?.finish_reason ?? null };
    } catch (e) {
      if (e instanceof OpenAI.RateLimitError) {
        stats.rateLimited++;
        if (i >= 3) throw new Error("RATE_LIMITED");
        await sleep(1000 * 2 ** i);
        continue;
      }
      stats.httpErrors++;
      if (e instanceof OpenAI.APIError) throw new Error(`HTTP_${e.status ?? "?"}`);
      throw new Error(e instanceof OpenAI.APIConnectionTimeoutError ? "TIMEOUT" : "NETWORK");
    }
  }
}

export interface JsonCallArgs<T> {
  client: OpenAI;
  cap: CallCap;
  model: string;
  mode: Mode;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
}

export async function callJson<T>(a: JsonCallArgs<T>): Promise<{ data: T | null; stats: CallStats }> {
  const stats: CallStats = {
    attempts: 0, firstValid: false, finalValid: false, fenced: false, latencyMs: 0,
    promptTokens: 0, completionTokens: 0, rateLimited: 0, httpErrors: 0, truncated: false, errorKind: null,
  };
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: a.system },
    { role: "user", content: a.user },
  ];
  const rf = responseFormat(a.mode, a.schema, a.schemaName);
  for (let attempt = 1; attempt <= 2; attempt++) {
    stats.attempts = attempt;
    const t0 = performance.now();
    let content: string;
    try {
      ({ content } = await chat(
        a.client, a.cap,
        { model: a.model, messages, temperature: 0, max_tokens: a.maxTokens ?? 2048, ...(rf ? { response_format: rf } : {}) },
        stats,
      ));
    } catch (e) {
      stats.errorKind = (e as Error).message;
      if (attempt === 1) stats.latencyMs = Math.round(performance.now() - t0);
      return { data: null, stats };
    }
    if (attempt === 1) stats.latencyMs = Math.round(performance.now() - t0);
    const { text, fenced } = stripFences(content);
    if (fenced) stats.fenced = true;
    let problem: string;
    try {
      const parsed = a.schema.safeParse(JSON.parse(text));
      if (parsed.success) {
        if (attempt === 1) stats.firstValid = true;
        stats.finalValid = true;
        return { data: parsed.data, stats };
      }
      problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch {
      problem = "output was not valid JSON";
    }
    if (attempt === 1) {
      messages.push(
        { role: "assistant", content: content.slice(0, 4000) },
        { role: "user", content: `Your output failed validation: ${problem}. Return corrected JSON only.` },
      );
    } else {
      stats.errorKind = "ZOD_INVALID_AFTER_RETRY";
    }
  }
  return { data: null, stats };
}
