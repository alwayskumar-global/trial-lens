// Live pipeline (SPEC §3): extraction → discovery → parse (cached) → typed eval (code) → free-text eval → abstention
// guard → tier (code) → verify → rule-D FAIL checks → adaptive questions (code). Ported from the measured spike
// (eval/spike/07-e2e.ts) with the frozen config unchanged: prompts spike-4 / cov-1, Rule D, 80-call cap, slot plan.
//
// Privacy: patient text is held only in this function's memory. Nothing here logs, caches or persists it; the emitted
// events carry counts, trial ids, public criterion text and the visitor's own extracted facts (back to that visitor).
import pLimit from "p-limit";
import { z } from "zod";
import { cacheKeyFor, isCacheable, type CriteriaCache } from "@/lib/cache/criteria-cache";
import { nctUrl, type Trial } from "@/lib/ctgov/client";
import { selectFromDiscovered } from "@/lib/ctgov/selection";
import { splitTrialCriteria } from "@/lib/ctgov/split";
import { failClosedFinding } from "@/lib/engine/fail-closed";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { assessCriterion, reconcileBatch, type CriterionAssessment, type ParseOutcome, type SourceCriterion } from "@/lib/engine/reconcile";
import { resolveFailCheck, withFailCheck } from "@/lib/engine/fail-check";
import { buildStudyQuestionsEvent } from "@/lib/engine/study-questions";
import { RunBudget, type Stage } from "@/lib/engine/run-plan";
import { ceilingTier, tierTrialCeiled } from "@/lib/engine/tier";
import { extractProfile } from "@/lib/pipeline/extract";
import type { CallStats } from "@/lib/llm/client";
import { UsageMeter, type UsageStage } from "@/lib/llm/usage";
import { EVAL_SYSTEM, makeEvalSchema } from "@/prompts/evaluate";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt } from "@/prompts/clause-parse";
import { buildFailVerifyUserPrompt, FAIL_VERIFY_SYSTEM } from "@/prompts/fail-verify";
import { VERIFY_SYSTEM, VerifySchema } from "@/prompts/verify";
import type { Tier, TrialResult } from "@/schema/assessment";
import { makeClauseBatchSchema } from "@/schema/clause";
import { makeFailCheckBatchSchema, type FailCheckItem } from "@/schema/fail-check";
import type { PatientProfile } from "@/schema/profile";
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
  /** Which pipeline stage makes the call (token usage is accounted per stage and model; labels only). */
  stage: UsageStage;
  tier: "FAST" | "MID";
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  /** See JsonCallArgs.echoOnRetry (false = never feed model output back on the validation retry). */
  echoOnRetry?: boolean;
}
export interface LlmPort {
  call<T>(a: LlmCallArgs<T>): Promise<{ data: T | null; stats: CallStats }>;
  /** HTTP-level calls made so far (hard-capped by the port itself). */
  used(): number;
}

/** How a trial's parse ended. pending = no parse slot (not a failure); failed = parse rejected/failed; assessed = criteria parsed. */
export function parseStatus(outcomes: readonly ParseOutcome[]): "assessed" | "pending" | "failed" {
  if (outcomes.length === 0 || outcomes.some((o) => o.state === "parsed")) return "assessed";
  return outcomes.every((o) => o.state === "unresolved" && o.reason === "not_attempted") ? "pending" : "failed";
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

/**
 * What a run starts from: the visitor's text (extraction is stage 1; legacy path, eval scripts, prepared fictional samples) or an
 * already-extracted profile the visitor reviewed. Either way every fact is the visitor's own statement (Policy R2).
 */
export type PipelineInput = string | { profile: PatientProfile };

export async function runPipeline(input: PipelineInput, deps: PipelineDeps, emit: (e: SseEvent) => void): Promise<void> {
  const wall0 = performance.now();
  // Token usage per stage and model (counts only), fed by every LLM call; reported once in the final `done` event.
  const meter = new UsageMeter();
  const llm: LlmPort = {
    used: () => deps.llm.used(),
    async call<T>(a: LlmCallArgs<T>) {
      const r = await deps.llm.call(a);
      meter.record(a.stage, a.tier, r.stats);
      return r;
    },
  };
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

  // 1. extraction (FAST), unless the caller already supplies a profile (then there is no extraction stage and no extraction call).
  const profile: PatientProfile =
    typeof input === "string"
      ? await stage("extraction", async (): Promise<PatientProfile> => {
          if (!take("extraction")) throw new PipelineError("model_unavailable");
          const p = await extractProfile(input, llm);
          if (!p) throw new PipelineError("model_unavailable"); // no usable profile ⇒ nothing to compare; caller falls back to replay
          return p;
        })
      : input.profile;
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
    const { discovered, filtered, candidates } = selectFromDiscovered(all, { ...(age !== undefined ? { age } : {}), ...(sex ? { sex } : {}) }, deps.maxCandidates);
    emit({ type: "counts", discovered, filtered, selected: candidates.length });
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
        const { data } = await llm.call({
          stage: "parse", tier: "MID", system: buildClauseParseSystemPrompt(), user: buildClauseBatchUserPrompt(chunk.map((c, i) => ({ index: i, type: c.type, text: c.text }))),
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
  // Policy R2: EVERY re-tier (typed evaluation, free-text evaluation, each Rule D FAIL check) goes through the ceiling, so a trial is
  // never STRONG or LIKELY_MISMATCH at any point. `finalizeTier` repeats it once more before results are built.
  const retier = (s: TrialState) => {
    const r = tierTrialCeiled(s.assess.map((a) => ({ scoring: a.scoring, category: a.category, status: a.finding.status, completeness: a.completeness, failCheck: a.finding.fail_check })), { unknownThreshold: deps.unknownThreshold, expectedCriteria: s.sources.length });
    s.tier = r.tier;
    if (r.flag && !s.flags.includes(r.flag)) s.flags.push(r.flag);
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
      const { data } = await llm.call({ stage: "evaluate", tier: "MID", system: EVAL_SYSTEM, user, schema: makeEvalSchema(items.length), schemaName: "findings", maxTokens: 8192 });
      data?.findings.forEach((f) => {
        const target = items[f.index]!;
        const guarded = applyAbstentionGuard({ criterion_id: target.a.criterion_id, status: f.status, evidence: f.evidence, rationale: f.rationale, source: "llm_mid" }, profile).finding;
        // Fail-closed (approved 2026-10-07): a free-text PASS/FAIL stands only if the code evaluation of the whole clause reaches the same status.
        const o = s.outcomes[target.i]!;
        // An unparsed outcome has no clause to derive support from: a model PASS/FAIL on it can never stand (null clause = no proof).
        target.a.finding = failClosedFinding(guarded, o.state === "parsed" ? o.clause : null, s.sources[target.i]!.type, profile);
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
      const { data } = await llm.call({ stage: "verify", tier: "MID", system: VERIFY_SYSTEM, user, schema: VerifySchema, schemaName: "verify", maxTokens: 4096 });
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
      const { data } = await llm.call({ stage: "mismatch", tier: "MID", system: FAIL_VERIFY_SYSTEM, user, schema: makeFailCheckBatchSchema(fails.length), schemaName: "fail_check", maxTokens: 8192 });
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

  // 8. study-team questions (pure code; Option B, docs/study-team-panel.md). No answer step and no prediction of any tier change. The panel is
  // auxiliary: if its computation fails nothing is emitted (the client then shows nothing and claims nothing); the run itself continues.
  const studyQuestions = await stage("questions", async () => {
    try {
      return buildStudyQuestionsEvent(states.map((s) => ({ sources: s.sources, outcomes: s.outcomes, assess: s.assess, tier: s.tier })), profile);
    } catch {
      return null;
    }
  });
  if (studyQuestions) emit(studyQuestions);

  // Final pass, idempotent: whatever any stage did, no trial leaves the pipeline above the R2 ceiling.
  for (const s of states) s.tier = ceilingTier(s.tier).tier;

  // results, in tier order
  const toResult = (s: TrialState): TrialResult => {
    // Out of parse budget ⇒ pending (queued for cache warm-up, docs/run-plan.md); a rejected/failed parse ⇒ analysis_failed.
    const status = parseStatus(s.outcomes);
    // `reported_only` records that STRONG was lowered to POSSIBLE; it is dropped if verification later lowered the trial further.
    const base = s.flags.filter((f) => f !== "reported_only" || s.tier === "POSSIBLE");
    const flags = status === "pending" ? [...base, "analysis_pending"] : base;
    const open = s.assess.find((a) => a.scoring && (a.finding.status === "UNKNOWN" || a.finding.status === "AMBIGUOUS"));
    return {
      nct_id: s.trial.nct_id,
      title: s.trial.title,
      tier: s.tier,
      findings: s.assess.map((a) => a.finding),
      // "A second automated pass found no conflict"; never true for a conflict and never a statement about the facts themselves.
      verified: flags.includes("reported_conflict") ? false : s.verifiedPass,
      verifier_flags: flags,
      fact_basis: "visitor_reported",
      sites: [],
      coordinator_questions: [],
      ...(status === "failed" ? { analysis_failed: true } : {}),
      url: nctUrl(s.trial.nct_id),
      criteria: s.sources.map((src, i) => ({ id: src.id, type: src.type, text: src.text, category: s.assess[i]!.category, completeness: s.assess[i]!.completeness })),
      top_unknown: open?.criterion_id ?? null,
    };
  };
  const ordered = [...states].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  for (const s of ordered) emit({ type: "trial_result", assessment: toResult(s) });
  const by = { assessed: 0, pending: 0, failed: 0 };
  for (const s of states) by[parseStatus(s.outcomes)]++;
  emit({ type: "counts", ...by });
  const b = budget.stats();
  emit({ type: "done", replay: false, stats: { llm_calls: deps.llm.used(), worst_case_calls: b.worstCaseCalls, wall_ms: Math.round(performance.now() - wall0), usage: meter.snapshot() } });
}
