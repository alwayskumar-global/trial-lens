// LLM client: response-format modes, 429 backoff, ONE validation retry, hard call cap (shared by the pipeline and eval spikes).
// Never logs prompts, outputs or keys. Records only counts, timings and status codes.
import OpenAI from "openai";
import { z } from "zod";
import { getNebiusEnv } from "@/lib/env";

/** Turns Nemotron reasoning off (observed: ~3x fewer tokens, ~4x faster; see docs/spike-results.md 08). */
export const THINKING_OFF = { chat_template_kwargs: { enable_thinking: false } } as const;

export type Mode = "json_schema" | "json_object" | "prompt_only";

export interface CallStats {
  attempts: number; // Zod attempts (1 or 2)
  firstValid: boolean;
  finalValid: boolean;
  fenced: boolean; // output needed code-fence stripping
  latencyMs: number; // first attempt only, incl. 429 waits excluded
  /** Sum of tokens the provider REPORTED (valid `usage` only). A response without usable usage adds nothing here and sets `usageComplete` false: it is never counted as 0. */
  promptTokens: number;
  completionTokens: number;
  /** Configured model id (non-secret configuration). */
  model: string;
  /** HTTP responses received (a call can make 1-2 attempts, plus 429 waits that return no response). */
  responses: number;
  /** True only if at least one response arrived and EVERY received response carried finite, non-negative integer prompt and completion token counts. */
  usageComplete: boolean;
  rateLimited: number; // 429 responses seen
  httpErrors: number; // non-429 API errors
  truncated: boolean; // finish_reason=length on any attempt
  errorKind: string | null; // fixed label, never provider text
  problems: string[]; // validation problem per attempt (indices/counts/fixed phrases only; no criterion text)
}

/**
 * Hard cap on HTTP request ATTEMPTS (every `chat` request: first try, 429 backoff retry and validation retry each take one).
 * `used` counts requests actually allowed, so it never exceeds `max`: a refused attempt is not counted and sends nothing.
 * This is the figure reported as `llm_calls`; it is not the number of logical `callJson` calls (see usage `calls`).
 */
export class CallCap {
  used = 0;
  constructor(readonly max: number) {}
  take(): void {
    if (this.used >= this.max) throw new Error("CALL_CAP_EXCEEDED");
    this.used++;
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

const validCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const missingUsage = new WeakSet<CallStats>();
/** One chat request with 429 exponential backoff (max 3 waits). Returns content or throws a labelled error. */
async function chat(
  client: OpenAI,
  cap: CallCap,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  stats: CallStats,
): Promise<{ content: string; finish: string | null }> {
  for (let i = 0; ; i++) {
    cap.take();
    let usageMissing = false;
    try {
      const res = await client.chat.completions.create(params);
      stats.responses++;
      const u = res.usage;
      if (validCount(u?.prompt_tokens) && validCount(u?.completion_tokens)) {
        stats.promptTokens += u!.prompt_tokens;
        stats.completionTokens += u!.completion_tokens;
      } else usageMissing = true; // unavailable, not zero
      if (usageMissing) missingUsage.add(stats);
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
  /** Extra request body fields (e.g. THINKING_OFF). VERIFY: Token Factory honours chat_template_kwargs for Nemotron. */
  extraBody?: Record<string, unknown>;
  /**
   * On the single validation retry, send the model's previous output back as an assistant turn plus Zod's messages (default, the
   * measured spike behaviour). Set false for any call whose output can carry visitor-supplied text (profile extraction): the retry
   * then re-sends only the original messages with a fixed note naming schema paths and issue codes, so model output that may repeat
   * or obey injected text is never fed back into the conversation.
   */
  echoOnRetry?: boolean;
}

/** Fixed-vocabulary description of validation problems: schema-key paths (or indices) and Zod issue codes, never values or messages. */
export function safeProblem(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>): string {
  const seg = (p: PropertyKey) => (typeof p === "number" ? String(p) : typeof p === "string" && /^[a-z_]{1,24}$/.test(p) ? p : "?");
  return issues.slice(0, 5).map((i) => `${i.path.map(seg).join(".") || "(root)"}: ${i.code}`).join("; ");
}

export async function callJson<T>(a: JsonCallArgs<T>): Promise<{ data: T | null; stats: CallStats }> {
  const stats: CallStats = {
    attempts: 0, firstValid: false, finalValid: false, fenced: false, latencyMs: 0,
    promptTokens: 0, completionTokens: 0, model: a.model, responses: 0, usageComplete: false, rateLimited: 0, httpErrors: 0, truncated: false, errorKind: null, problems: [],
  };
  const finish = (data: T | null) => {
    stats.usageComplete = stats.responses > 0 && !missingUsage.has(stats);
    return { data, stats };
  };
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: a.system },
    { role: "user", content: a.user },
  ];
  const rf = responseFormat(a.mode, a.schema, a.schemaName);
  for (let attempt = 1; attempt <= 2; attempt++) {
    stats.attempts = attempt;
    const t0 = performance.now();
    const usedBefore = a.cap.used;
    let content: string;
    try {
      ({ content } = await chat(
        a.client, a.cap,
        { model: a.model, messages, temperature: 0, max_tokens: a.maxTokens ?? 2048, ...(rf ? { response_format: rf } : {}), ...(a.extraBody ?? {}) } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        stats,
      ));
    } catch (e) {
      stats.errorKind = (e as Error).message;
      // Refused by the cap before any request of this attempt was sent: that attempt does not count (attempts === 0 means nothing was sent at all).
      if (stats.errorKind === "CALL_CAP_EXCEEDED" && a.cap.used === usedBefore) stats.attempts = attempt - 1;
      if (attempt === 1) stats.latencyMs = Math.round(performance.now() - t0);
      return finish(null);
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
        return finish(parsed.data);
      }
      problem = a.echoOnRetry === false ? safeProblem(parsed.error.issues) : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch {
      problem = "output was not valid JSON";
    }
    stats.problems.push(problem);
    if (attempt === 1) {
      if (a.echoOnRetry === false) {
        // No model output is fed back: same system and user messages, plus a fixed note.
        messages.splice(1, messages.length - 1, { role: "user", content: `${a.user}\n\n[Format check] Your previous reply did not match the required JSON schema (${problem}). Reply with ONLY the corrected JSON object, nothing else.` });
      } else {
        messages.push(
          { role: "assistant", content: content.slice(0, 4000) },
          { role: "user", content: `Your output failed validation: ${problem}. Return corrected JSON only.` },
        );
      }
    } else {
      stats.errorKind = "ZOD_INVALID_AFTER_RETRY";
    }
  }
  return finish(null);
}
