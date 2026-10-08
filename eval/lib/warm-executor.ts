// Warm-up executor, wired to the reservation dispatcher and the insert-only store through injected ports. PURE: no provider client, no Supabase client,
// no CLI entry. Nothing calls this outside tests; `eval/warm-cache.ts --execute` stays refused until a separate approval, and the real provider/store
// bindings do not exist yet.
//
// Order of operations (every step before dispatch can refuse, and a refusal makes no model call and no write):
//   1. approval sanity (budget > 0, ceiling = 2 x chunks, 1 <= max writes <= planned trials; the plan quotes max writes = planned trials)
//   2. provider price must equal the priced constants
//   3. the plan is recomputed from live CT.gov and its fingerprint must equal the approved one (any difference -> refuse, with a diff)
//   4. exact-key existence re-check per trial (already cached -> skipped)
//   5. dispatch every chunk through SpendGuard reservations (calibration gate, concurrency)
//   6. a trial is written only if EVERY chunk parsed fully (isCacheable), its key is in the approved plan, and the write count is below the approved maximum
import { z } from "zod";
import { cacheKeyFor, isCacheable, type CacheKey } from "../../src/lib/cache/criteria-cache";
import { reconcileBatch, type ParseOutcome, type SourceCriterion } from "../../src/lib/engine/reconcile";
import { buildClauseBatchUserPrompt } from "../../src/prompts/clause-parse";
import { makeClauseBatchSchema } from "../../src/schema/clause";
import type { CacheStore } from "./warm-store";
import { runJobs, type ChatPort, type ChatRequest, type Job, type Price } from "./warm-dispatch";
import { diffPlans, SpendGuard, type PlanDiff, type PlannedTrial } from "./warm-guard";

export const CHUNK = 15;

export interface WarmTrial { nct_id: string; last_update: string | null; sources: SourceCriterion[] }
export interface Approval { fingerprint: string; trials: PlannedTrial[]; budgetUsd: number; attemptCeiling: number; maxWrites: number }
export interface CurrentPlan { fingerprint: string; trials: PlannedTrial[]; warm: WarmTrial[] }
export interface ExecuteDeps {
  port: ChatPort; store: CacheStore; price: Price; sleep: (ms: number) => Promise<void>;
  checkPrice: () => Promise<boolean>;
  planNow: () => Promise<CurrentPlan>;
  model: string; system: string; maxTokens: number; calibration: number; concurrency: number;
}
export type Refusal = "bad_approval" | "price_changed" | "plan_changed";
export interface ExecuteSummary {
  trials_planned: number; written: number; skipped: Record<string, number>; chunks_parsed: number; chunks_unparsed: Record<string, number>;
  attempts: number; spent_usd: number; upper_bound_usd: number; halted: string | null; written_keys: string[];
}
export type ExecuteResult = { status: "refused"; reason: Refusal; diff?: PlanDiff } | { status: "done"; summary: ExecuteSummary };

const keyStr = (k: CacheKey) => `${k.nct_id}|${k.source_version}|${k.parser_version}`;

/** The parse request exactly as the production parse call builds it (json_schema mode, reasoning_effort low). */
export function buildParseRequest(model: string, system: string, maxTokens: number, chunk: readonly SourceCriterion[]): ChatRequest {
  const user = buildClauseBatchUserPrompt(chunk.map((c, i) => ({ index: i, type: c.type, text: c.text })));
  const schema = makeClauseBatchSchema(chunk.map((c) => c.text));
  return { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, max_tokens: maxTokens, response_format: { type: "json_schema", json_schema: { name: "clause_batch", strict: true, schema: z.toJSONSchema(schema, { io: "input" }) } }, reasoning_effort: "low" };
}

export async function executeWarm(deps: ExecuteDeps, approval: Approval): Promise<ExecuteResult> {
  const expectedCeiling = 2 * approval.trials.reduce((a, t) => a + t.chunks, 0);
  if (!(approval.budgetUsd > 0) || approval.attemptCeiling !== expectedCeiling || !(approval.maxWrites >= 1 && approval.maxWrites <= approval.trials.length) || !approval.fingerprint) return { status: "refused", reason: "bad_approval" };
  if (!(await deps.checkPrice())) return { status: "refused", reason: "price_changed" };
  const now = await deps.planNow();
  if (now.fingerprint !== approval.fingerprint) return { status: "refused", reason: "plan_changed", diff: diffPlans(approval.trials, now.trials) };

  const allowed = new Set(approval.trials.map((t) => t.nct_id));
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const todo: Array<{ trial: WarmTrial; key: CacheKey; chunks: SourceCriterion[][] }> = [];
  for (const t of now.warm) {
    if (!allowed.has(t.nct_id)) { skip("not_in_approved_plan"); continue; }
    const key = cacheKeyFor(t.nct_id, t.last_update);
    if (await deps.store.exists(key)) { skip("already_cached"); continue; }
    const chunks: SourceCriterion[][] = [];
    for (let i = 0; i < t.sources.length; i += CHUNK) chunks.push(t.sources.slice(i, i + CHUNK));
    todo.push({ trial: t, key, chunks });
  }

  type Batch = z.infer<ReturnType<typeof makeClauseBatchSchema>>;
  const jobs: Array<Job<Batch>> = [];
  for (const t of todo) t.chunks.forEach((chunk, ci) => {
    const schema = makeClauseBatchSchema(chunk.map((c) => c.text));
    jobs.push({
      id: `${t.trial.nct_id}#${ci}`, request: buildParseRequest(deps.model, deps.system, deps.maxTokens, chunk),
      validate: (content) => { try { const r = schema.safeParse(JSON.parse(content)); return r.success ? { ok: true, data: r.data } : { ok: false, problem: "schema" }; } catch { return { ok: false, problem: "not json" }; } },
    });
  });

  const guard = new SpendGuard(approval.budgetUsd, approval.attemptCeiling);
  const run = await runJobs({ port: deps.port, guard, price: deps.price, sleep: deps.sleep }, jobs, { calibration: deps.calibration, concurrency: deps.concurrency });
  const byId = new Map(run.results.map((r) => [r.id, r]));

  let written = 0;
  const writtenKeys: string[] = [];
  for (const t of todo) {
    const parts: ParseOutcome[][] = [];
    let complete = true;
    t.chunks.forEach((chunk, ci) => {
      const r = byId.get(`${t.trial.nct_id}#${ci}`);
      if (r && r.status === "parsed") parts.push(reconcileBatch(chunk, r.data, "batch_rejected")); else complete = false;
    });
    if (!complete) { skip(run.halted ? "halted_or_unparsed_chunk" : "unparsed_chunk"); continue; }
    const outcomes = parts.flat();
    if (!isCacheable(outcomes)) { skip("not_fully_parsed"); continue; }
    if (!allowed.has(t.key.nct_id)) { skip("not_in_approved_plan"); continue; } // defense in depth: never write outside the approved plan
    if (written >= approval.maxWrites) { skip("max_writes_reached"); continue; }
    const res = await deps.store.insertIfAbsent(t.key, outcomes);
    if (res === "exists") { skip("already_cached"); continue; }
    written++;
    writtenKeys.push(keyStr(t.key));
  }
  return { status: "done", summary: { trials_planned: approval.trials.length, written, skipped, chunks_parsed: run.parsed, chunks_unparsed: run.unparsed, attempts: run.attempts, spent_usd: run.spentUsd, upper_bound_usd: run.upperBoundUsd, halted: run.halted, written_keys: writtenKeys } };
}
