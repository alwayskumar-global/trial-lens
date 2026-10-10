// REAL bindings for the warm-up executor: the OpenAI-compatible provider client (as an executor ChatPort), the Supabase insert-only store, and the
// provider price check. They are CONSTRUCTORS only: importing this file makes no network call, no model call and no database call. Tests drive them with
// fakes. Nothing reaches them until eval/warm-execute.ts is enabled, which requires a separate approval (EXECUTE_ENABLED is false).
import OpenAI from "openai";
import { makeClient } from "../src/lib/llm/client";
import { getSupabase } from "../src/lib/supabase";
import { PortError, type ChatPort, type ChatReply, type ChatRequest } from "./lib/warm-dispatch";
import { makeInsertOnlyStore, type CacheStore, type SupabaseLike } from "./lib/warm-store";

/** The slice of the OpenAI SDK the port uses (a real `OpenAI` instance satisfies it; tests pass a fake). */
export interface ChatClientLike {
  chat: { completions: { create(params: Record<string, unknown>): Promise<{ choices: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null }> } };
}

/** Map every SDK failure to the executor's fixed failure kinds (the executor charges all but a clean reply at the worst case). */
export function classifyError(e: unknown): PortError {
  if (e instanceof OpenAI.RateLimitError) return new PortError("rate_limited");
  if (e instanceof OpenAI.APIConnectionTimeoutError) return new PortError("timeout");
  if (e instanceof OpenAI.APIConnectionError) return new PortError("network");
  if (e instanceof OpenAI.APIError) return new PortError("http");
  return new PortError("network");
}

export function openAiPort(client: ChatClientLike): ChatPort {
  return {
    async create(req: ChatRequest): Promise<ChatReply> {
      try {
        const res = await client.chat.completions.create({ ...req });
        return { content: res.choices[0]?.message?.content ?? "", usage: res.usage ?? null };
      } catch (e) {
        throw classifyError(e);
      }
    },
  };
}

/** The production client: `maxRetries: 0` (no hidden SDK retries) and a 120 s timeout (assumption A4). */
export const makeProviderPort = (): ChatPort => openAiPort(makeClient() as unknown as ChatClientLike);

/** The real Supabase client bound to the insert-only store: it can only exact-key select and upsert with ignoreDuplicates. */
export const makeCacheStore = (): CacheStore => makeInsertOnlyStore(getSupabase() as unknown as SupabaseLike);

/**
 * True only if the provider's model metadata lists `modelId` with exactly the priced prompt/completion per-token prices. FAIL CLOSED: any HTTP error,
 * network error, missing model or malformed price returns false. A metadata GET, not an inference call.
 */
export async function priceMatches(o: { fetchImpl?: typeof fetch; baseUrl: string; apiKey: string; modelId: string; price: { p: number; c: number } }): Promise<boolean> {
  try {
    const r = await (o.fetchImpl ?? fetch)(`${o.baseUrl.replace(/\/$/, "")}/models?verbose=true`, { headers: { authorization: `Bearer ${o.apiKey}` } });
    if (!r.ok) return false;
    const j = (await r.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }> };
    const m = (j.data ?? []).find((x) => x.id === o.modelId);
    const p = Number(m?.pricing?.prompt), c = Number(m?.pricing?.completion);
    return Number.isFinite(p) && Number.isFinite(c) && Math.abs(p - o.price.p) < 1e-15 && Math.abs(c - o.price.c) < 1e-15;
  } catch {
    return false;
  }
}
