// Phase 1 repair: measured end-to-end run on the fixed cohort, COLD vs WARM parse cache, under a hard
// MAX_LLM_CALLS_PER_RUN=80 cap and the RunBudget slot plan. FICTIONAL profile only (no real patient data).
// Stages: extraction(FAST) → deterministic prefilter(code) → parse(MID, cached, budgeted) → typed eval(code)
//   → free-text eval(MID, 1 call/trial) → abstention guard(code) → tier(code) → verify(MID) → [escalate: not built]
// Run: pnpm spike:e2e   Logs counts/timings only; no prompts, outputs or profile text.
import pLimit from "p-limit";
import { z } from "zod";
import { getNebiusEnv, getPipelineEnv } from "../../src/lib/env";
import { checkIndices } from "../../src/lib/engine/checks";
import { applyAbstentionGuard } from "../../src/lib/engine/guard";
import { assessCriterion, reconcileBatch, type CriterionAssessment, type ParseOutcome, type SourceCriterion } from "../../src/lib/engine/reconcile";
import { RunBudget } from "../../src/lib/engine/run-plan";
import { tierTrial } from "../../src/lib/engine/tier";
import { buildClauseBatchUserPrompt, buildClauseParseSystemPrompt, CLAUSE_PARSE_PROMPT_VERSION } from "../../src/prompts/clause-parse";
import type { Tier } from "../../src/schema/assessment";
import { makeClauseBatchSchema } from "../../src/schema/clause";
import { FactSchema, type Fact, type PatientProfile } from "../../src/schema/profile";
import { FACT_KEYS, FactKeySchema, type FactKey } from "../../src/schema/vocabulary";
import { appendResults, FIXTURE_PATH, loadFixture, saveJson, splitCriteria, type Trial } from "./lib";
import { callJson, CallCap, makeClient, type CallStats } from "./llm";

const MAX_CALLS = getPipelineEnv().MAX_LLM_CALLS_PER_RUN; // 80
const CHUNK = 15;
const LOW = { reasoning_effort: "low" } as const; // VERIFY: Token Factory honours reasoning_effort (see 08)
const N = getPipelineEnv().TIER_UNKNOWN_THRESHOLD;

const FICTIONAL_PROFILE = `Fictional demo profile (not a real person). 52-year-old woman. Stage IV hormone-receptor-positive, HER2-negative breast cancer, metastatic to bone and liver. ECOG performance status 1. Postmenopausal. Previously received a CDK4/6 inhibitor with endocrine therapy and one line of chemotherapy for metastatic disease. No known brain metastases. Not pregnant. Recent blood counts and heart ultrasound results are not available.`;

// ---- LLM schemas (spike-grade prompts; versioned prompts move to src/prompts in Phase 2) -----------
const ExtractSchema = z.object({
  facts: z.array(z.object({ key: FactKeySchema, state: z.enum(["known", "unknown", "uncertain"]), value: z.union([z.string(), z.number(), z.boolean()]).nullable(), note: z.string().nullable() })),
});
const EXTRACT_SYSTEM = `You extract structured facts from a patient description. Use ONLY facts stated in the text; never infer or invent. For each vocabulary key you can address, return {key, state, value, note}: state "known" with a value if stated; "uncertain" with a value if approximate or hedged; "unknown" with value null if not stated. Booleans true/false; enums exactly as listed; numbers as numbers.
Vocabulary:
${FACT_KEYS.join(", ")}
Enum values: stage 0|I|II|III|IV; disease_setting early|locally_advanced|metastatic; ecog 0-4 as strings; her2_status positive|negative|low; er_status/pr_status positive|negative; menopausal_status pre|peri|post; sex female|male|other; cns_mets none|treated_stable|active; cardiac_disease none|history|active.
Output ONLY JSON {"facts":[...]}.`;

const FINDING_STATUS = z.enum(["PASS", "FAIL", "UNKNOWN", "AMBIGUOUS"]);
function makeEvalSchema(n: number) {
  return z
    .object({ findings: z.array(z.object({ index: z.number().int(), status: FINDING_STATUS, evidence: z.array(z.string()), rationale: z.string() })) })
    .superRefine((b, ctx) => {
      const c = checkIndices(n, b.findings.map((f) => f.index));
      if (!c.ok) ctx.addIssue({ code: "custom", message: `indices must be exactly 0..${n - 1} once each (missing [${c.missing}], duplicate [${c.duplicate}], unexpected [${c.unexpected}])` });
    });
}
const EVAL_SYSTEM = `You compare ONE patient's confirmed facts with trial eligibility criteria. Use ONLY the facts provided. Status per criterion:
PASS = patient is not blocked (inclusion met, or exclusion does not apply); FAIL = patient appears blocked; UNKNOWN = needed information is not in the facts; AMBIGUOUS = needs clinical judgment.
PASS and FAIL require "evidence": the fact keys you relied on. If unsure, answer UNKNOWN. Never guess; never assume missing facts. rationale ≤ 15 words.
Output ONLY JSON {"findings":[{"index","status","evidence":[keys],"rationale"}]}, one per input index.`;
const VerifySchema = z.object({ blocking: z.array(z.object({ index: z.number().int(), evidence: z.array(z.string()) })) });
const VERIFY_SYSTEM = `You are an independent reviewer. Given a patient's confirmed facts and a trial's criteria, find any criterion the patient CLEARLY does not satisfy (inclusion not met, or exclusion applies) using ONLY the facts. Do not assume unknown facts. If none, return an empty list. Output ONLY JSON {"blocking":[{"index","evidence":[fact keys]}]}.`;

// ---- helpers ----------------------------------------------------------------------------------------
const key = (t: Trial) => `${t.nct_id}|${t.last_update ?? ""}|${CLAUSE_PARSE_PROMPT_VERSION}`;
type Cache = Map<string, ParseOutcome[]>;
const ageOf = (s: string | null) => (s ? Number(s.match(/\d+/)?.[0] ?? NaN) : NaN);

interface StageStat { calls: number; slots: number; ms: number; retries: number; rateLimited: number; failed: number }
const stat = (): StageStat => ({ calls: 0, slots: 0, ms: 0, retries: 0, rateLimited: 0, failed: 0 });
const addCall = (s: StageStat, st: CallStats, ok: boolean) => { s.retries += st.attempts - 1; s.rateLimited += st.rateLimited; if (!ok) s.failed++; };

interface TrialState { trial: Trial; sources: SourceCriterion[]; outcomes: ParseOutcome[]; assess: CriterionAssessment[]; tier: Tier; flags: string[] }

async function run(label: string, cache: Cache, budgeted: boolean, cap: CallCap) {
  const env = getNebiusEnv();
  const client = makeClient();
  const limit = pLimit(getPipelineEnv().LLM_CONCURRENCY);
  const budget = new RunBudget(budgeted ? MAX_CALLS : 10_000, budgeted ? undefined : { extraction: 0, verify: 0, escalate: 0 }, budgeted ? undefined : {});
  const st: Record<string, StageStat> = { extraction: stat(), parse: stat(), evaluate: stat(), verify: stat() };
  const wall0 = performance.now();
  const timed = async <T>(name: keyof typeof st, fn: () => Promise<T>) => { const c0 = cap.used, t0 = performance.now(); const r = await fn(); st[name]!.calls = cap.used - c0; st[name]!.ms = Math.round(performance.now() - t0); return r; };

  // 1. extraction (FAST). Output is re-validated with FactSchema: invalid known facts become unknown.
  let profile!: PatientProfile;
  await timed("extraction", async () => {
    if (budgeted) { if (!budget.take("extraction")) throw new Error("no extraction slot"); st.extraction!.slots++; }
    const { data, stats } = await callJson({ client, cap, model: env.NEMOTRON_MODEL_FAST!, mode: "json_schema", system: EXTRACT_SYSTEM, user: FICTIONAL_PROFILE, schema: ExtractSchema, schemaName: "facts", maxTokens: 4096, extraBody: LOW });
    addCall(st.extraction!, stats, !!data);
    const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, Fact] => [k, { key: k, state: "unknown" }])) as Record<FactKey, Fact>;
    for (const f of data?.facts ?? []) {
      const cand = FactSchema.safeParse({ key: f.key, state: f.state, ...(f.value !== null ? { value: f.value } : {}), ...(f.note ? { note: f.note } : {}) });
      if (cand.success && cand.data.state !== "unknown") facts[f.key] = cand.data;
    }
    profile = { facts };
  });
  budget.release("extraction");
  const known = Object.values(profile.facts).filter((f) => f.state === "known").length;

  // 2. deterministic prefilter (age/sex from CT.gov fields)
  const age = profile.facts.age.state === "known" ? Number(profile.facts.age.value) : NaN;
  const sex = profile.facts.sex.state === "known" ? String(profile.facts.sex.value).toUpperCase() : "";
  const all = loadFixture();
  const candidates = all.filter((t) => {
    const lo = ageOf(t.min_age), hi = ageOf(t.max_age);
    if (Number.isFinite(age) && ((Number.isFinite(lo) && age < lo) || (Number.isFinite(hi) && age > hi))) return false;
    if (sex && t.sex && t.sex !== "ALL" && t.sex !== sex) return false;
    return true;
  });

  const states: TrialState[] = candidates.map((t) => ({ trial: t, sources: splitCriteria(t).map((c) => ({ id: c.id, nct_id: c.nct_id, type: c.type, text: c.text })), outcomes: [], assess: [], tier: "UNCERTAIN", flags: [] }));
  states.sort((a, b) => a.sources.length - b.sources.length); // cheapest-to-complete first

  // 3. parse (cache → budgeted chunk calls; overflow ⇒ not_attempted ⇒ unresolved ⇒ UNKNOWN, trial UNCERTAIN)
  let cacheHits = 0, cacheMiss = 0, pending = 0;
  await timed("parse", async () => {
    // Trial-level tasks are NOT limited (limiting both levels deadlocks p-limit); only LLM calls are.
    await Promise.all(states.map(async (s) => {
      const hit = cache.get(key(s.trial));
      if (hit) { s.outcomes = hit; cacheHits++; return; }
      cacheMiss++;
      const parts: SourceCriterion[][] = [];
      for (let i = 0; i < s.sources.length; i += CHUNK) parts.push(s.sources.slice(i, i + CHUNK));
      const results = await Promise.all(parts.map((chunk) => limit(async () => {
        if (budgeted) { if (!budget.take("parse")) return reconcileBatch(chunk, null, "not_attempted"); st.parse!.slots++; }
        const { data, stats } = await callJson({ client, cap, model: env.NEMOTRON_MODEL_MID!, mode: "json_schema", system: buildClauseParseSystemPrompt(), user: buildClauseBatchUserPrompt(chunk.map((c, i) => ({ index: i, type: c.type, text: c.text }))), schema: makeClauseBatchSchema(chunk.map((c) => c.text)), schemaName: "clause_batch", maxTokens: 8192, extraBody: LOW });
        addCall(st.parse!, stats, !!data);
        return reconcileBatch(chunk, data, "batch_rejected");
      })));
      s.outcomes = results.flat();
      if (s.outcomes.every((o) => o.state === "parsed")) cache.set(key(s.trial), s.outcomes);
    }));
  });
  budget.release("parse");

  // 4. typed evaluation in code (+ abstention guard) and first tier
  let guardDowngrades = 0;
  const retier = (s: TrialState) => {
    s.tier = tierTrial(s.assess.map((a) => ({ scoring: a.scoring, category: a.category, status: a.finding.status, completeness: a.completeness })), { unknownThreshold: N, expectedCriteria: s.sources.length });
  };
  for (const s of states) {
    s.assess = s.sources.map((src, i) => {
      const a = assessCriterion(src, s.outcomes[i]!, profile);
      const g = applyAbstentionGuard(a.finding, profile);
      if (g.downgraded) guardDowngrades++;
      return { ...a, finding: g.finding };
    });
    if (s.outcomes.some((o) => o.state === "unresolved")) pending++;
    retier(s);
  }
  const tierCounts = (xs: TrialState[]) => Object.fromEntries((["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"] as Tier[]).map((t) => [t, xs.filter((s) => s.tier === t).length]));
  const afterTyped = tierCounts(states);

  // 5. free-text evaluation: ONE call per trial; only criteria still UNKNOWN that were parsed (text/partial)
  const knownFacts = Object.fromEntries(Object.values(profile.facts).filter((f) => f.state === "known").map((f) => [f.key, f.value]));
  let evalTrials = 0, evalOverflow = 0;
  await timed("evaluate", async () => {
    const todo = states.filter((s) => s.tier !== "LIKELY_MISMATCH" && s.assess.some((a) => a.completeness === "partial" && a.finding.status === "UNKNOWN"));
    await Promise.all(todo.map((s) => limit(async () => {
      if (budgeted) { if (!budget.take("evaluate")) { evalOverflow++; return; } st.evaluate!.slots++; }
      const items = s.assess.map((a, i) => ({ a, i })).filter(({ a }) => a.completeness === "partial" && a.finding.status === "UNKNOWN").slice(0, 40);
      const user = `Patient confirmed facts: ${JSON.stringify(knownFacts)}\nCriteria (one JSON object per line):\n${items.map(({ i }, k) => JSON.stringify({ index: k, type: s.sources[i]!.type, text: s.sources[i]!.text })).join("\n")}`;
      const { data, stats } = await callJson({ client, cap, model: env.NEMOTRON_MODEL_MID!, mode: "json_schema", system: EVAL_SYSTEM, user, schema: makeEvalSchema(items.length), schemaName: "findings", maxTokens: 8192, extraBody: LOW });
      addCall(st.evaluate!, stats, !!data); evalTrials++;
      data?.findings.forEach((f) => {
        const target = items[f.index]!;
        const g = applyAbstentionGuard({ criterion_id: target.a.criterion_id, status: f.status, evidence: f.evidence, rationale: f.rationale, source: "llm_mid" }, profile);
        if (g.downgraded) guardDowngrades++;
        target.a.finding = g.finding;
      });
      retier(s);
    })));
  });
  budget.release("evaluate");
  budget.release("escalate"); // escalation (DEEP) is not built in this spike: its reserve flows to verification
  const afterEval = tierCounts(states);

  // 6. verification: independent pass on STRONG/POSSIBLE only; overflow ⇒ never shown as STRONG/POSSIBLE
  let verified = 0, disagreements = 0, unverified = 0;
  await timed("verify", async () => {
    const todo = states.filter((s) => s.tier === "STRONG" || s.tier === "POSSIBLE").sort((a, b) => a.assess.filter((x) => x.finding.status !== "PASS").length - b.assess.filter((x) => x.finding.status !== "PASS").length);
    await Promise.all(todo.map((s) => limit(async () => {
      if (budgeted) { if (!budget.take("verify")) { s.tier = "UNCERTAIN"; s.flags.push("unverified_budget"); unverified++; return; } st.verify!.slots++; }
      const items = s.sources.slice(0, 60);
      const user = `Patient confirmed facts: ${JSON.stringify(knownFacts)}\nCriteria:\n${items.map((c, i) => JSON.stringify({ index: i, type: c.type, text: c.text })).join("\n")}`;
      const { data, stats } = await callJson({ client, cap, model: env.NEMOTRON_MODEL_MID!, mode: "json_schema", system: VERIFY_SYSTEM, user, schema: VerifySchema, schemaName: "verify", maxTokens: 4096, extraBody: LOW });
      addCall(st.verify!, stats, !!data);
      if (!data) { s.tier = "UNCERTAIN"; s.flags.push("verification_failed"); unverified++; return; }
      verified++;
      // the verifier can only DOWNGRADE, and only with evidence that exists as known facts (guard rule)
      const real = data.blocking.filter((b) => b.evidence.length > 0 && b.evidence.every((k) => (FACT_KEYS as readonly string[]).includes(k) && profile.facts[k as FactKey].state === "known"));
      if (real.length > 0) { s.tier = "UNCERTAIN"; s.flags.push("verifier_disagreement"); disagreements++; }
    })));
  });
  const final = tierCounts(states);
  const wall = Math.round(performance.now() - wall0);
  const b = budget.stats();
  const completeness = { full: 0, partial: 0, unresolved: 0 };
  states.forEach((s) => s.assess.forEach((a) => completeness[a.completeness]++));
  const decided = states.reduce((n, s) => n + s.assess.filter((a) => a.finding.status === "PASS" || a.finding.status === "FAIL").length, 0);
  const totalCriteria = states.reduce((n, s) => n + s.assess.length, 0);
  const snapshot = { profile: Object.values(profile.facts).filter((f) => f.state !== "unknown"), trials: states.map((s) => ({ nct_id: s.trial.nct_id, tier: s.tier, flags: s.flags, criteria: s.sources.map((src, i) => ({ id: src.id, type: src.type, text: src.text, completeness: s.assess[i]!.completeness, category: s.assess[i]!.category, finding: s.assess[i]!.finding, clause: s.outcomes[i]!.state === "parsed" ? (s.outcomes[i] as Extract<ParseOutcome, { state: "parsed" }>).clause : null })) })) };
  return { snapshot, label, wall, cap: cap.used, st, budgetStats: b, known, candidates: candidates.length, cacheHits, cacheMiss, pending, afterTyped, afterEval, final, guardDowngrades, evalTrials, evalOverflow, verified, disagreements, unverified, completeness, decided, totalCriteria };
}

async function main(): Promise<void> {
  const cache: Cache = new Map();
  // COLD: empty cache, full plan + hard cap.
  const cold = await run("cold (empty parse cache)", cache, true, new CallCap(MAX_CALLS));
  console.log("cold done", cold.cap, "calls", cold.wall, "ms");
  saveJson(FIXTURE_PATH.replace("ctgov-breast.json", "e2e-cold.json"), cold.snapshot); // gitignored: fictional profile + public CT.gov text
  // OFFLINE pre-parse of the whole cohort (what `precompute` would do): measured separately, own cap, no run budget.
  const pre = await run("offline pre-parse (unbudgeted; fills cache; its own extraction/eval/verify not part of the per-run plan)", cache, false, new CallCap(400));
  const preParseCalls = pre.st.parse!.calls, preParseMs = pre.st.parse!.ms;
  console.log("offline pre-parse", preParseCalls, "parse calls", preParseMs, "ms; cache entries", cache.size);
  // WARM: cache filled, full plan + hard cap.
  const warm = await run("warm (parse cache filled)", cache, true, new CallCap(MAX_CALLS));
  console.log("warm done", warm.cap, "calls", warm.wall, "ms");
  saveJson(FIXTURE_PATH.replace("ctgov-breast.json", "e2e-warm.json"), warm.snapshot);

  const row = (r: typeof cold) => `| ${r.label} | ${r.candidates} | ${r.cacheHits}/${r.cacheMiss} | ${r.cap} (≤${MAX_CALLS}) | ${r.budgetStats.slotsGranted} slots → worst case ${r.budgetStats.worstCaseCalls} | ${r.st.extraction!.calls}/${r.st.parse!.calls}/${r.st.evaluate!.calls}/${r.st.verify!.calls} | ${r.wall} |`;
  const stageRow = (r: typeof cold) => `| ${r.label.split(" ")[0]} | ${(["extraction", "parse", "evaluate", "verify"] as const).map((k) => `${r.st[k]!.ms} ms (${r.st[k]!.slots} slots, ${r.st[k]!.retries} retries, ${r.st[k]!.rateLimited}×429, ${r.st[k]!.failed} failed)`).join(" | ")} |`;
  const tierRow = (r: typeof cold) => `| ${r.label.split(" ")[0]} | ${JSON.stringify(r.afterTyped)} | ${JSON.stringify(r.afterEval)} | ${JSON.stringify(r.final)} | ${r.pending} | ${r.guardDowngrades} | ${r.verified} verified, ${r.disagreements} disagreements, ${r.unverified} unverified→UNCERTAIN | ${r.evalOverflow} |`;
  const md = [
    `\n## ${new Date().toISOString()} — 07-e2e (fictional profile; fixed cohort; prompt \`${CLAUSE_PARSE_PROMPT_VERSION}\`; reasoning_effort=low; command \`pnpm spike:e2e\`)\n`,
    `- Plan: \`RunBudget(${MAX_CALLS})\`: each LLM slot reserves 2 calls (call + its one retry) ⇒ 40 slots; reserved: extraction 1, verify 8, escalate 3 (escalation NOT built here; its reserve is released to verification); parse capped at 14 slots; evaluate takes the rest. Hard \`CallCap(${MAX_CALLS})\` additionally throws if exceeded (it did not).`,
    `- Profile: fictional; extractor produced ${cold.known} known facts (cold) / ${warm.known} (warm). Prefilter by age/sex over the ${loadFixture().length}-trial fixture ⇒ ${cold.candidates} candidates.`,
    "\n| Run | candidates | parse cache hit/miss | HTTP calls used | slots | calls extraction/parse/evaluate/verify | wall ms |\n|---|---|---|---|---|---|---|",
    row(cold), row(warm),
    "\n| Run | extraction | parse | free-text evaluate | verify |\n|---|---|---|---|---|",
    stageRow(cold), stageRow(warm),
    "\n| Run | tiers after typed-only (code) | after free-text eval | final (after verify) | trials with unresolved criteria | guard downgrades | verification | eval slot overflow (trials left UNKNOWN) |\n|---|---|---|---|---|---|---|---|",
    tierRow(cold), tierRow(warm),
    `\n- Criteria in the ${warm.candidates} candidates (warm): ${warm.totalCriteria}; parse completeness full ${warm.completeness.full} / partial ${warm.completeness.partial} / unresolved ${warm.completeness.unresolved}; findings decided PASS/FAIL after eval+guard: ${warm.decided}.`,
    `- Offline pre-parse of the cohort (what \`pnpm precompute\` must do before judging): ${preParseCalls} HTTP calls (chunks of ${CHUNK} + retries), ${preParseMs} ms at concurrency ${getPipelineEnv().LLM_CONCURRENCY}; cache entries written ${cache.size}/${cold.candidates}. Cache is in-memory in this spike (VERIFY: Supabase \`trial_criteria_cache\` persistence in Phase 2).`,
  ];
  appendResults(md.join("\n") + "\n");
  console.log(md.slice(1).join("\n"));
}
main().catch((e: unknown) => { console.error(`07-e2e failed: ${(e as Error)?.message?.slice(0, 160)}`); process.exit(1); });
