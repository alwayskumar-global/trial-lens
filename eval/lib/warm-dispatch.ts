// Reservation-aware dispatcher for the (not yet approved) cache warm-up. PURE: the chat provider is an injected port, so everything here is tested
// offline with fakes. It imports no model client and cannot make a network call by itself. eval/warm-cache.ts does not call it (dry-run only).
//
// Every HTTP attempt (first try, 429 backoff retry, validation retry) first RESERVES its worst case in the SpendGuard:
//     worst = (UTF-8 bytes of the exact request body + 64) x input price + max_tokens x output price
// and is sent only if actual_spent + in-flight worst cases + this worst case <= budget and the attempt ceiling is not reached. After a reply the
// reservation is replaced by the REPORTED usage; an attempt that returns no reply (429, timeout, network/HTTP error) is charged its worst case. Any failed assumption (usage missing, prompt tokens above the byte bound, completion tokens above
// max_tokens) halts all further dispatch.
import { SpendGuard, promptTokensUpperBoundFromBytes, worstAttemptUsd } from "./warm-guard";

export type FailKind = "rate_limited" | "timeout" | "http" | "network";
export class PortError extends Error { constructor(readonly kind: FailKind) { super(kind); } }
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest { messages: ChatMessage[]; max_tokens: number; [k: string]: unknown }
export interface ChatReply { content: string; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null }
export interface ChatPort { create(req: ChatRequest): Promise<ChatReply> }

export interface Price { p: number; c: number }
export interface Job<T> { id: string; request: ChatRequest; validate: (content: string) => { ok: true; data: T } | { ok: false; problem: string } }
export type Unparsed = "invalid_after_retry" | "refused_budget" | "refused_attempts" | "halted" | "http_error" | "rate_limited" | "timeout" | "network";
export type JobResult<T> = { id: string; status: "parsed"; data: T; attempts: number } | { id: string; status: "unparsed"; reason: Unparsed; attempts: number };

export interface DispatchDeps { port: ChatPort; guard: SpendGuard; price: Price; sleep: (ms: number) => Promise<void> }

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const bodyBytes = (req: ChatRequest): number => Buffer.byteLength(JSON.stringify(req));

/** Reserve one attempt, waiting for in-flight reservations to settle if they alone are what blocks it. */
async function reserve(deps: DispatchDeps, worst: number) {
  for (;;) {
    const t = deps.guard.tryReserve(worst);
    if (t.ok) return t.reservation;
    if (t.reason === "budget" && deps.guard.inflightCount > 0) { await deps.guard.nextSettle(); continue; }
    return t.reason;
  }
}

/** One logical job: up to 2 validation attempts, each with up to 3 backoff retries after a 429. Every HTTP attempt is separately reserved. */
export async function dispatchJob<T>(deps: DispatchDeps, job: Job<T>): Promise<JobResult<T>> {
  const { guard, port, price } = deps;
  let messages = job.request.messages, attempts = 0;
  for (let validation = 1; validation <= 2; validation++) {
    let reply: ChatReply | null = null, req: ChatRequest = { ...job.request, messages };
    for (let backoff = 0; reply === null; backoff++) {
      req = { ...job.request, messages };
      const bytes = bodyBytes(req);
      const worst = worstAttemptUsd(promptTokensUpperBoundFromBytes(bytes), req.max_tokens, price);
      const r = await reserve(deps, worst);
      if (typeof r === "string") return { id: job.id, status: "unparsed", reason: r === "attempts" ? "refused_attempts" : r === "budget" ? "refused_budget" : "halted", attempts };
      attempts++;
      try {
        reply = await port.create(req);
      } catch (e) {
        const kind: FailKind = e instanceof PortError ? e.kind : "network";
        if (kind === "rate_limited") {
          // Nebius documents neither that a 429 is free nor that it is billed (rate-limits and billing pages, checked 2026-10-08), so without
          // billing evidence a 429 is charged its WORST case like any other failed attempt.
          guard.settle(r, null);
          if (backoff >= 3) return { id: job.id, status: "unparsed", reason: "rate_limited", attempts };
          await deps.sleep(1000 * 2 ** backoff);
          continue;
        }
        guard.settle(r, null); // timeout / network / HTTP error: whether tokens were generated is unknown, so charge the worst case
        return { id: job.id, status: "unparsed", reason: kind === "timeout" ? "timeout" : kind === "http" ? "http_error" : "network", attempts };
      }
      // Reported-usage reconciliation and assumption checks.
      const u = reply.usage;
      if (!u || !isCount(u.prompt_tokens) || !isCount(u.completion_tokens)) {
        guard.settle(r, null);
        guard.violate("usage_unavailable");
      } else {
        guard.settle(r, u.prompt_tokens * price.p + u.completion_tokens * price.c);
        if (u.prompt_tokens > promptTokensUpperBoundFromBytes(bytes)) guard.violate("prompt_tokens_exceed_bound");
        if (u.completion_tokens > req.max_tokens) guard.violate("completion_exceeds_max_tokens");
      }
    }
    const text = reply.content.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
    const v = job.validate(text);
    if (v.ok) return { id: job.id, status: "parsed", data: v.data, attempts };
    if (validation === 2) break;
    messages = [...job.request.messages, { role: "assistant", content: reply.content.slice(0, 4000) }, { role: "user", content: `Your output failed validation: ${v.problem}. Return corrected JSON only.` }];
  }
  return { id: job.id, status: "unparsed", reason: "invalid_after_retry", attempts };
}

export interface RunSummary<T> { results: Array<JobResult<T>>; parsed: number; unparsed: Record<string, number>; attempts: number; spentUsd: number; upperBoundUsd: number; halted: string | null }

/** First `calibration` jobs strictly one at a time (a wrong assumption is found before concurrency opens), then up to `concurrency` jobs at once. */
export async function runJobs<T>(deps: DispatchDeps, jobs: readonly Job<T>[], o: { calibration: number; concurrency: number }): Promise<RunSummary<T>> {
  const results: Array<JobResult<T>> = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      results[i] = deps.guard.halted ? { id: jobs[i]!.id, status: "unparsed", reason: "halted", attempts: 0 } : await dispatchJob(deps, jobs[i]!);
    }
  };
  const k = Math.min(o.calibration, jobs.length);
  for (let i = 0; i < k; i++) { next = i; results[i] = deps.guard.halted ? { id: jobs[i]!.id, status: "unparsed", reason: "halted", attempts: 0 } : await dispatchJob(deps, jobs[i]!); }
  next = k;
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  const unparsed: Record<string, number> = {};
  for (const r of results) if (r.status === "unparsed") unparsed[r.reason] = (unparsed[r.reason] ?? 0) + 1;
  return { results, parsed: results.filter((r) => r.status === "parsed").length, unparsed, attempts: deps.guard.attempts, spentUsd: deps.guard.spentUsd, upperBoundUsd: deps.guard.upperBoundUsd, halted: deps.guard.halted };
}
