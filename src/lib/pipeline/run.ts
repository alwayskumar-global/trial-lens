// Live pipeline (SPEC §3): extraction → discovery → parse (cached) → typed eval (code) → free-text eval → abstention
// guard → tier (code) → verify → rule-D FAIL checks → adaptive questions (code). Ported from the measured spike
// (eval/spike/07-e2e.ts) with the frozen config unchanged: prompts spike-4 / cov-1, Rule D, 80-call cap, slot plan.
//
// Privacy: patient text is held only in this function's memory. Nothing here logs, caches or persists it; the emitted
// events carry counts, trial ids, public criterion text and the visitor's own extracted facts (back to that visitor).
import pLimit from "p-limit";
import { z } from "zod";
import { cacheKeyFor, isCacheable, type CriteriaCache } from "@/lib/cache/criteria-cache";
import { prefilterTrials, nctUrl, type Trial } from "@/lib/ctgov/client";
import { splitTrialCriteria } from "@/lib/ctgov/split";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { assessCriterion, reconcileBatch, type CriterionAssessment, type ParseOutcome, type SourceCriterion } from "@/lib/engine/reconcile";
import { resolveFailCheck, withFailCheck } from "@/lib/engine/fail-check";
import { computeQuestions } from "@/lib/engine/questions";
import { RunBudget, type Stage } from "@/lib/engine/run-plan";
import { tierTrial } from "@/lib/engine/tier";
import type { CallStats } from "@/lib/llm/client";
import { EVAL_SYSTEM, makeEvalSchema } from "@/prompts/evaluate";
import { EXTRACT_SYSTEM, ExtractSchema } from "@/prompts/extract";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt } from "@/prompts/clause-parse";
import { buildFailVerifyUserPrompt, FAIL_VERIFY_SYSTEM } from "@/prompts/fail-verify";
import { VERIFY_SYSTEM, VerifySchema } from "@/prompts/verify";
import type { Tier, TrialResult } from "@/schema/assessment";
import { makeClauseBatchSchema } from "@/schema/clause";
import { makeFailCheckBatchSchema, type FailCheckItem } from "@/schema/fail-check";
import { FactSchema, type Fact, type PatientProfile } from "@/schema/profile";
import type { SseEvent } from "@/schema/sse";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";

const CHUNK = 15;
const TIER_ORDER: Tier[] = ["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"];

export type PipelineFailure = "model_unavailable" | "ctgov_unavailable" | "aborted";
export class PipelineError extends Error {
  constructor(readonly kind: PipelineFailure) {
    super(kind);
  }
}

export interface LlmCallArgs<T> {
  tier: "FAST" | "MID";
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
}
export interface LlmPort {
  call<T>(a: LlmCallArgs<T>): Promise<{ data: T | null; stats: CallStats }>;
  /** HTTP-level calls made so far (hard-capped by the port itself). */
  used(): number;
}

export interface PipelineDeps {
  llm: LlmPort;
  /** Candidate source: live CT.gov discovery (or a fixed list in tests). */
  discover(): Promise<Trial[]>;
  cache: CriteriaCache;
  maxCalls: number; // MAX_LLM_CALLS_PER_RUN (80)
  maxCandidates: number; // MAX_CANDIDATE_TRIALS
  concurrency: number; // LLM_CONCURRENCY
  unknownThreshold: number; // TIER_UNKNOWN_THRESHOLD
  signal?: AbortSignal;
}

interface TrialState {
  trial: Trial;
  sources: SourceCriterion[];
  outcomes: ParseOutcome[];
  assess: CriterionAssessment[];
  tier: Tier;
  flags: string[];
  verifiedPass: boolean;
}

export async function runPipeline(profileText: string, deps: PipelineDeps, emit: (e: SseEvent) => void): Promise<void> {
  const wall0 = performance.now();
  const limit = pLimit(deps.concurrency);
  const budget = new RunBudget(deps.maxCalls);
  const checkAbort = () => {
    if (deps.signal?.aborted) throw new PipelineError("aborted");
  };
  const stage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    checkAbort();
    emit({ type: "stage", stage: name, status: "start" });
    const r = await fn();
    emit({ type: "stage", stage: name, status: "done" });
    return r;
  };
  const take = (s: Stage) => budget.take(s);

  // 1. extraction (FAST). Output is re-validated with FactSchema: an invalid known fact becomes unknown.
  const profile = await stage("extraction", async (): Promise<PatientProfile> => {
    if (!take("extraction")) throw new PipelineError("model_unavailable");
    const { data } = await deps.llm.call({ tier: "FAST", system: EXTRACT_SYSTEM, user: profileText, schema: ExtractSchema, schemaName: "facts", maxTokens: 4096 });
    if (!data) throw new PipelineError("model_unavailable"); // no usable profile ⇒ nothing to compare; caller falls back to replay
    const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, Fact] => [k, { key: k, state: "unknown" }])) as Record<FactKey, Fact>;
    for (const f of data.facts) {
      const cand = FactSchema.safeParse({ key: f.key, state: f.state, ...(f.value !== null ? { value: f.value } : {}), ...(f.note ? { note: f.note } : {}) });
      if (cand.success && cand.data.state !== "unknown") facts[f.key] = cand.data;
    }
    return { facts };
  });
  budget.release("extraction");
  emit({
    type: "profile",
    facts: Object.values(profile.facts).flatMap((f) => (f.state === "known" || f.state === "uncertain" ? [{ key: f.key, state: f.state, ...("value" in f && f.value !== undefined ? { value: f.value as string | number | boolean } : {}) }] : [])),
  });
  const knownFacts = Object.fromEntries(Object.values(profile.facts).filter((f) => f.state === "known").map((f) => [f.key, "value" in f ? f.value : null]));

  // 2. discovery (CT.gov) + deterministic prefilter (code)
  const states = await stage("discovery", async (): Promise<TrialState[]> => {
    let all: Trial[];
    try {
      all = await deps.discover();
    } catch {
      throw new PipelineError("ctgov_unavailable");
    }
    const age = profile.facts.age.state === "known" ? Number(profile.facts.age.value) : undefined;
    const sex = profile.facts.sex.state === "known" ? String(profile.facts.sex.value) : undefined;
    const candidates = prefilterTrials(all, { ...(age !== undefined ? { age } : {}), ...(sex ? { sex } : {}) }).slice(0, deps.maxCandidates);
    emit({ type: "counts", discovered: all.length, filtered: candidates.length });
    const st = candidates.map((t): TrialState => ({
      trial: t,
      sources: splitTrialCriteria(t.nct_id, t.eligibility_text).map((c) => ({ id: c.id, nct_id: c.nct_id, type: c.type, text: c.text })),
      outcomes: [],
      assess: [],
      tier: "UNCERTAIN",
      flags: [],
      verifiedPass: false,
    }));
    st.sort((a, b) => a.sources.length - b.sources.length); // cheapest-to-complete first
    return st;
  });

  // 3. parse: cache → budgeted chunk calls. Overflow ⇒ not_attempted ⇒ unresolved ⇒ UNKNOWN ⇒ trial UNCERTAIN.
  await stage("parse", async () => {
    // Trial-level tasks are NOT limited (limiting both levels deadlocks p-limit); only LLM calls are.
    await Promise.all(states.map(async (s) => {
      const key = cacheKeyFor(s.trial.nct_id, s.trial.last_update);
      const hit = await deps.cache.get(key);
      if (hit && hit.length === s.sources.length) {
        s.outcomes = hit;
        return;
      }
      const parts: SourceCriterion[][] = [];
      for (let i = 0; i < s.sources.length; i += CHUNK) parts.push(s.sources.slice(i, i + CHUNK));
      const results = await Promise.all(parts.map((chunk) => limit(async () => {
        checkAbort();
        if (!take("parse")) return reconcileBatch(chunk, null, "not_attempted");
        const { data } = await deps.llm.call({
          tier: "MID", system: buildClauseParseSystemPrompt(), user: buildClauseBatchUserPrompt(chunk.map((c, i) => ({ index: i, type: c.type, text: c.text }))),
          schema: makeClauseBatchSchema(chunk.map((c) => c.text)), schemaName: "clause_batch", maxTokens: 8192,
        });
        return reconcileBatch(chunk, data, "batch_rejected");
      })));
      s.outcomes = results.flat();
      if (isCacheable(s.outcomes)) await deps.cache.set(key, s.outcomes);
    }));
  });
  budget.release("parse");

  // 4. typed evaluation in code + abstention guard, first tier
  const retier = (s: TrialState) => {
    s.tier = tierTrial(s.assess.map((a) => ({ scoring: a.scoring, category: a.category, status: a.finding.status, completeness: a.completeness, failCheck: a.finding.fail_check })), { unknownThreshold: deps.unknownThreshold, expectedCriteria: s.sources.length });
  };
  await stage("typed_evaluation", async () => {
    for (const s of states) {
      s.assess = s.sources.map((src, i) => {
        const a = assessCriterion(src, s.outcomes[i]!, profile);
        return { ...a, finding: applyAbstentionGuard(a.finding, profile).finding };
      });
      retier(s);
    }
  });

  // 5. free-text evaluation: ONE call per trial; only criteria still UNKNOWN that were parsed (text/partial)
  await stage("free_text_evaluation", async () => {
    // A trial that already carries a FAIL candidate from the code stage is not free-text evaluated (its tier is
    // UNCERTAIN-or-mismatch whatever evaluation finds).
    const hasFail = (s: TrialState) => s.assess.some((a) => a.scoring && a.finding.status === "FAIL");
    const todo = states.filter((s) => !hasFail(s) && s.assess.some((a) => a.completeness === "partial" && a.finding.status === "UNKNOWN"));
    await Promise.all(todo.map((s) => limit(async () => {
      checkAbort();
      if (!take("evaluate")) return; // overflow: its free-text criteria stay UNKNOWN; trial stays partial (never STRONG)
      const items = s.assess.map((a, i) => ({ a, i })).filter(({ a }) => a.completeness === "partial" && a.finding.status === "UNKNOWN").slice(0, 40);
      const user = `Patient confirmed facts: ${JSON.stringify(knownFacts)}\nCriteria (one JSON object per line):\n${items.map(({ i }, k) => JSON.stringify({ index: k, type: s.sources[i]!.type, text: s.sources[i]!.text })).join("\n")}`;
      const { data } = await deps.llm.call({ tier: "MID", system: EVAL_SYSTEM, user, schema: makeEvalSchema(items.length), schemaName: "findings", maxTokens: 8192 });
      data?.findings.forEach((f) => {
        const target = items[f.index]!;
        target.a.finding = applyAbstentionGuard({ criterion_id: target.a.criterion_id, status: f.status, evidence: f.evidence, rationale: f.rationale, source: "llm_mid" }, profile).finding;
      });
      retier(s);
    })));
  });
  budget.release("evaluate");

  // 6. verification: independent pass on STRONG/POSSIBLE only; no slot or failed call ⇒ never shown as STRONG/POSSIBLE
  await stage("verification", async () => {
    const todo = states.filter((s) => s.tier === "STRONG" || s.tier === "POSSIBLE").sort((a, b) => a.assess.filter((x) => x.finding.status !== "PASS").length - b.assess.filter((x) => x.finding.status !== "PASS").length);
    await Promise.all(todo.map((s) => limit(async () => {
      checkAbort();
      if (!take("verify")) {
        s.tier = "UNCERTAIN";
        s.flags.push("unverified_budget");
        return;
      }
      const items = s.sources.slice(0, 60);
      const user = `Patient confirmed facts: ${JSON.stringify(knownFacts)}\nCriteria:\n${items.map((c, i) => JSON.stringify({ index: i, type: c.type, text: c.text })).join("\n")}`;
      const { data } = await deps.llm.call({ tier: "MID", system: VERIFY_SYSTEM, user, schema: VerifySchema, schemaName: "verify", maxTokens: 4096 });
      if (!data) {
        s.tier = "UNCERTAIN";
        s.flags.push("verification_failed");
        return;
      }
      // the verifier can only DOWNGRADE, and only with evidence that exists as known facts (guard rule)
      const real = data.blocking.filter((b) => b.evidence.length > 0 && b.evidence.every((k) => (FACT_KEYS as readonly string[]).includes(k) && profile.facts[k as FactKey].state === "known"));
      if (real.length > 0) {
        s.tier = "UNCERTAIN";
        s.flags.push("verifier_disagreement");
      } else s.verifiedPass = true;
    })));
  });
  budget.release("verify"); // unused verify reserve flows to FAIL checks

  // 7. RULE D: every FAIL must be independently checked before a trial can be LIKELY_MISMATCH.
  await stage("fail_checks", async () => {
    const failTrials = states.filter((s) => s.assess.some((a) => a.scoring && a.finding.status === "FAIL"));
    // single-FAIL trials first: they are the most fragile to one wrong parse
    const order = [...failTrials].sort((a, b) => a.assess.filter((x) => x.finding.status === "FAIL").length - b.assess.filter((x) => x.finding.status === "FAIL").length);
    await Promise.all(order.map((s) => limit(async () => {
      checkAbort();
      const fails = s.assess.map((a, i) => ({ a, i })).filter(({ a }) => a.finding.status === "FAIL");
      const apply = (map: (k: number) => FailCheckItem | "no_capacity" | "not_run") =>
        fails.forEach(({ a, i }, k) => {
          a.finding = withFailCheck(a.finding, resolveFailCheck(s.sources[i]!.text, map(k), profile));
        });
      if (!take("mismatch")) {
        apply(() => "no_capacity"); // capacity overflow stays UNCERTAIN (never LIKELY_MISMATCH)
        retier(s);
        return;
      }
      const user = buildFailVerifyUserPrompt(knownFacts, fails.map(({ i }, k) => ({ index: k, type: s.sources[i]!.type, text: s.sources[i]!.text })));
      const { data } = await deps.llm.call({ tier: "MID", system: FAIL_VERIFY_SYSTEM, user, schema: makeFailCheckBatchSchema(fails.length), schemaName: "fail_check", maxTokens: 8192 });
      if (!data) {
        apply(() => "not_run");
        retier(s);
        return;
      }
      const byIdx = new Map(data.verdicts.map((v) => [v.index, v]));
      apply((k) => byIdx.get(k) ?? "not_run");
      retier(s);
    })));
  });

  // 8. adaptive questions (pure code; SPEC §5)
  const questions = await stage("questions", async () => computeQuestions(states.map((s) => ({ sources: s.sources, outcomes: s.outcomes, assess: s.assess, tier: s.tier })), profile, deps.unknownThreshold));
  emit({ type: "question", questions });

  // results, in tier order
  const toResult = (s: TrialState): TrialResult => {
    const unresolvedAll = s.outcomes.length > 0 && s.outcomes.every((o) => o.state === "unresolved");
    // Out of parse budget ⇒ pending (queued for cache warm-up, docs/run-plan.md); a rejected/failed parse ⇒ analysis_failed.
    const pending = unresolvedAll && s.outcomes.every((o) => o.state === "unresolved" && o.reason === "not_attempted");
    const flags = pending ? [...s.flags, "analysis_pending"] : s.flags;
    const open = s.assess.find((a) => a.scoring && (a.finding.status === "UNKNOWN" || a.finding.status === "AMBIGUOUS"));
    return {
      nct_id: s.trial.nct_id,
      title: s.trial.title,
      tier: s.tier,
      findings: s.assess.map((a) => a.finding),
      verified: s.tier === "LIKELY_MISMATCH" ? true : s.verifiedPass,
      verifier_flags: flags,
      sites: [],
      coordinator_questions: [],
      ...(unresolvedAll && !pending ? { analysis_failed: true } : {}),
      url: nctUrl(s.trial.nct_id),
      criteria: s.sources.map((src, i) => ({ id: src.id, type: src.type, text: src.text, category: s.assess[i]!.category, completeness: s.assess[i]!.completeness })),
      top_unknown: open?.criterion_id ?? null,
    };
  };
  const ordered = [...states].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  for (const s of ordered) emit({ type: "trial_result", assessment: toResult(s) });
  emit({ type: "counts", analyzed: states.length });
  const b = budget.stats();
  emit({ type: "done", replay: false, stats: { llm_calls: deps.llm.used(), worst_case_calls: b.worstCaseCalls, wall_ms: Math.round(performance.now() - wall0) } });
}
