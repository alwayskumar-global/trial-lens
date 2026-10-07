// OFFLINE measurement of Option 1's lifts on the three PREPARED FICTIONAL profiles. Read-only: it selects the stored replay results and the
// cached public-criteria parses from Supabase and runs the pure question engine. NO model calls, no writes.
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/adaptive-lift.ts
// What it measures: for each prepared profile, how many UNCERTAIN trials would rise to POSSIBLE for each answer of each question, using the
// TYPED-ONLY counterfactual (criteria not decided by the answered fact keep their stored findings, including free-text ones). That is an
// upper-bound style estimate used for ranking, NOT the answer path: the approved answer path is a full re-evaluation, and nothing here may be
// shown to a visitor. Pregnancy-related keys are excluded (EXCLUDED_QUESTION_KEYS). Output: counts, fact keys and NCT ids only.
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { SupabaseReplayStore } from "../src/lib/cache/replay";
import { applyCeilingToAssessment } from "../src/lib/engine/ceiling";
import { leaves } from "../src/lib/engine/clause";
import { CORE_CATEGORIES } from "../src/schema/criteria";
import { answerLifts, EXCLUDED_QUESTION_KEYS, type QuestionTrial } from "../src/lib/engine/questions";
import type { CriterionAssessment, ParseOutcome } from "../src/lib/engine/reconcile";
import { getSupabase } from "../src/lib/supabase";
import type { PatientProfile } from "../src/schema/profile";
import { FACT_KEYS, type FactKey } from "../src/schema/vocabulary";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

const say = (s: string) => console.warn(s);

async function main(): Promise<void> {
  const store = new SupabaseReplayStore();
  const cases = await Promise.all(REPLAY_PROFILES.map(async (p) => ({ id: p.id, c: await store.get(p.id) })));
  const missing = cases.filter((x) => !x.c).map((x) => x.id);
  if (missing.length) throw new Error(`stored replay case not available: ${missing.join(", ")}`);

  const ncts = [...new Set(cases.flatMap(({ c }) => c!.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment.nct_id] : []))))];
  const { data, error } = await getSupabase().from("trial_criteria_cache").select("nct_id,source_version,parsed").eq("parser_version", PARSER_VERSION).in("nct_id", ncts);
  if (error) throw new Error("cache read failed");
  const latest = new Map<string, ParseOutcome[]>();
  for (const row of [...(data ?? [])].sort((a, b) => String(a.source_version).localeCompare(String(b.source_version)))) {
    const p = OutcomesSchema.safeParse(row.parsed);
    if (p.success) latest.set(String(row.nct_id), p.data as ParseOutcome[]); // later source_version overwrites earlier
  }
  say(`parser version ${PARSER_VERSION}; distinct trials in the three stored results: ${ncts.length}; cached parses found: ${latest.size}`);

  const report: Array<Record<string, unknown>> = [];
  for (const { id, c } of cases) {
    const pe = c!.events.find((e) => e.type === "profile");
    const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, PatientProfile["facts"][FactKey]] => [k, { key: k, state: "unknown" }])) as PatientProfile["facts"];
    if (pe && pe.type === "profile") for (const f of pe.facts) facts[f.key] = { key: f.key, state: f.state, value: f.value };
    const profile: PatientProfile = { facts };

    const results = c!.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
    const trials: QuestionTrial[] = [];
    let noParse = 0, mismatch = 0;
    for (const r of results) {
      const outcomes = latest.get(r.nct_id);
      const crit = r.criteria ?? [];
      if (!outcomes) { noParse++; continue; }
      if (outcomes.length !== crit.length) { mismatch++; continue; }
      const assess: CriterionAssessment[] = crit.map((cv, i) => {
        const o = outcomes[i]!;
        const finding = r.findings.find((f) => f.criterion_id === cv.id) ?? { criterion_id: cv.id, status: "UNKNOWN" as const, evidence: [], rationale: "", source: "code" as const };
        return { criterion_id: cv.id, category: o.state === "parsed" ? o.category : null, scoring: o.state === "parsed" ? o.scoring : true, completeness: o.state === "parsed" ? o.completeness : "unresolved", finding };
      });
      trials.push({ sources: crit.map((cv) => ({ id: cv.id, nct_id: r.nct_id, type: cv.type, text: cv.text })), outcomes, assess, tier: applyCeilingToAssessment(r).tier });
    }
    const tiers: Record<string, number> = {};
    for (const r of results) { const t = applyCeilingToAssessment(r).tier; tiers[t] = (tiers[t] ?? 0) + 1; }

    const keys = answerLifts(trials, profile, 3);
    // Why a blocked trial cannot move: scoring criteria that stay open (UNKNOWN/AMBIGUOUS or only partly parsed) whatever the answer is.
    const residual = (t: QuestionTrial, key: string) => {
      const isBlocked = (i: number) => { const o = t.outcomes[i]!; return o.state === "parsed" && leaves(o.clause).some((l) => l.kind === "atom" && l.fact_key === key); };
      const open = t.assess.flatMap((a, i) => (a.scoring && !isBlocked(i) && (a.finding.status === "UNKNOWN" || a.finding.status === "AMBIGUOUS" || a.completeness !== "full") ? [a] : []));
      return { open: open.length, coreOpen: open.filter((a) => a.category !== null && (CORE_CATEGORIES as readonly string[]).includes(a.category)).length };
    };
    const perKey = keys.map(({ entry, affecting, answers }) => ({
      key: entry.key, affectingTrials: affecting.length, askCost: entry.ask_cost,
      residualOpenCriteria: affecting.map((t) => residual(t, entry.key)),
      answers: answers.map((a) => ({ answer: a.label, lifted: a.lifted.length, nct: a.lifted.map((t) => t.sources[0]!.nct_id) })),
      maxLift: Math.max(0, ...answers.map((a) => a.lifted.length)),
    }));
    const liftedAny = new Set(perKey.flatMap((k) => k.answers.flatMap((a) => a.nct)));
    const known = Object.values(facts).filter((f) => f.state === "known").map((f) => f.key);
    say(`\n== ${id}: ${results.length} stored results (tiers after Policy R2: ${JSON.stringify(tiers)}); usable (parse found, same criteria count): ${trials.length}; no cached parse: ${noParse}; criteria-count mismatch: ${mismatch}`);
    say(`   known profile facts: ${known.join(", ") || "none"}; excluded keys: ${EXCLUDED_QUESTION_KEYS.join(", ")}`);
    if (perKey.length === 0) say("   no question would be offered (no unknown askable fact blocks a typed criterion in the usable trials)");
    for (const k of perKey) say(`   ${k.key}: blocks ${k.affectingTrials} trial(s); best answer lifts ${k.maxLift}; per answer: ${k.answers.map((a) => `${a.answer}=${a.lifted}`).join(", ")}; other open scoring criteria per blocked trial (all / core): ${k.residualOpenCriteria.map((r) => `${r.open}/${r.coreOpen}`).join(", ")}`);
    say(`   distinct trials lifted UNCERTAIN→POSSIBLE by any single answer: ${liftedAny.size}${liftedAny.size ? ` (${[...liftedAny].join(", ")})` : ""}`);
    report.push({ profile: id, storedResults: results.length, tiers, usableTrials: trials.length, noCachedParse: noParse, criteriaCountMismatch: mismatch, questions: perKey, distinctLifted: liftedAny.size });
  }
  const total = report.reduce((s, r) => s + (r.distinctLifted as number), 0);
  say(`\nTOTAL distinct lifts across the three prepared profiles (typed-only counterfactual, best single answer per trial): ${total}`);
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/adaptive-lift-offline.json", JSON.stringify({ note: "Typed-only counterfactual on the three prepared FICTIONAL profiles; read-only, no model calls; not the answer path (a full re-evaluation is). Counts, keys and NCT ids only.", parserVersion: PARSER_VERSION, excludedKeys: EXCLUDED_QUESTION_KEYS, totalDistinctLifts: total, profiles: report }, null, 2) + "\n");
  say("wrote eval/reports/adaptive-lift-offline.json");
}

main().then(() => process.exit(0), (e: unknown) => { console.error(`adaptive-lift stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
