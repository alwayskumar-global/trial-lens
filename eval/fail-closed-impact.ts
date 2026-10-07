// OFFLINE, READ-ONLY projection of the PROPOSED fail-closed rule (free-text PASS/FAIL -> UNKNOWN unless the code evaluation of the whole clause independently
// reaches the same status; src/lib/engine/fail-closed.ts, NOT wired) over the three prepared FICTIONAL profiles' stored replay results and cached public-criteria
// parses. Select-only reads (a test enforces it); NO model calls, NO writes except eval/reports/fail-closed-impact-offline.json (counts and fact keys only).
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/fail-closed-impact.ts
// Not re-run: the verification stage and the fail-check stage (a projection cannot call a model). Effects are therefore stated on what is stored.
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { SupabaseReplayStore } from "../src/lib/cache/replay";
import { ceilingTier } from "../src/lib/engine/tier";
import { tierTrial, type TierCriterion } from "../src/lib/engine/tier";
import { acceptFreeTextFinding } from "../src/lib/engine/fail-closed";
import { studyTeamQuestions } from "../src/lib/engine/study-questions";
import type { QuestionTrial } from "../src/lib/engine/questions";
import type { CriterionAssessment, ParseOutcome } from "../src/lib/engine/reconcile";
import type { CriterionFinding } from "../src/schema/criteria";
import type { PatientProfile } from "../src/schema/profile";
import { FACT_KEYS, type FactKey } from "../src/schema/vocabulary";
import { getSupabase } from "../src/lib/supabase";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
const st = (o: ParseOutcome) => (o.state === "parsed" ? `parsed:${o.completeness}/${o.vet}` : `unresolved:${o.reason}`);

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
    if (p.success) latest.set(String(row.nct_id), p.data as ParseOutcome[]);
  }

  const report: Array<Record<string, unknown>> = [];
  for (const { id, c } of cases) {
    const pe = c!.events.find((e) => e.type === "profile");
    const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, PatientProfile["facts"][FactKey]] => [k, { key: k, state: "unknown" }])) as PatientProfile["facts"];
    if (pe && pe.type === "profile") for (const f of pe.facts) facts[f.key] = { key: f.key, state: f.state, value: f.value };
    const profile: PatientProfile = { facts };
    const results = c!.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));

    const rows: Record<string, Record<string, number>> = {}; // by parse status: llm decided PASS/FAIL, accepted, downgraded
    const ruleD: Record<string, number> = {};
    const evidenceKeysRemoved = { n: 0 };
    const tierPre: Record<string, number> = {}, tierFinal: Record<string, number> = {};
    const baseTrials: QuestionTrial[] = [], projTrials: QuestionTrial[] = [];
    let usable = 0, noParse = 0, mismatch = 0, trialsAffected = 0, affectedVerified = 0, storedConflictFlag = 0;
    const status = { rowsChanged: { PASS: 0, FAIL: 0 } };

    for (const r of results) {
      const outcomes = latest.get(r.nct_id);
      const crit = r.criteria ?? [];
      if (!outcomes) { noParse++; continue; }
      if (outcomes.length !== crit.length) { mismatch++; continue; }
      usable++;
      if (r.verifier_flags.includes("reported_conflict")) storedConflictFlag++;
      const baseFind: CriterionFinding[] = [], projFind: CriterionFinding[] = [];
      let affected = false;
      crit.forEach((cv, i) => {
        const o = outcomes[i]!;
        const f: CriterionFinding = r.findings.find((x) => x.criterion_id === cv.id) ?? { criterion_id: cv.id, status: "UNKNOWN", evidence: [], rationale: "", source: "code" };
        baseFind.push(f);
        let pf = f;
        if (f.source === "code" && f.status === "FAIL") inc(ruleD, `code FAIL, fail_check=${f.fail_check ?? "absent"}`);
        if (f.source === "llm_mid" && (f.status === "PASS" || f.status === "FAIL") && o.state === "parsed") {
          const a = acceptFreeTextFinding(f, o.clause, cv.type, profile);
          const row = (rows[st(o)] ??= {});
          inc(row, `llm_${f.status}`);
          if (f.status === "FAIL") inc(ruleD, `llm FAIL, fail_check=${f.fail_check ?? "absent"}`);
          if (a.accepted) inc(row, "accepted");
          else {
            inc(row, "downgraded");
            status.rowsChanged[f.status]++;
            evidenceKeysRemoved.n += f.evidence.length;
            pf = { criterion_id: f.criterion_id, status: "UNKNOWN", evidence: [], rationale: "Not enough confirmed information to decide.", source: "llm_mid", guard_downgraded: true } as CriterionFinding;
            affected = true;
          }
        }
        projFind.push(pf);
      });
      if (affected) { trialsAffected++; if (r.verified) affectedVerified++; }
      const mk = (fs: CriterionFinding[]): TierCriterion[] => crit.map((cv, i) => {
        const o = outcomes[i]!;
        return { scoring: o.state === "parsed" ? o.scoring : true, category: o.state === "parsed" ? o.category : null, status: fs[i]!.status, completeness: o.state === "parsed" ? o.completeness : "unresolved", failCheck: fs[i]!.fail_check };
      });
      const opts = { unknownThreshold: 3, expectedCriteria: crit.length };
      const pre0 = tierTrial(mk(baseFind), opts), pre1 = tierTrial(mk(projFind), opts);
      inc(tierPre, `${pre0}->${pre1}`);
      inc(tierFinal, `${ceilingTier(pre0).tier}->${ceilingTier(pre1).tier}`);
      const sources = crit.map((cv) => ({ id: cv.id, nct_id: r.nct_id, type: cv.type, text: cv.text }));
      const asm = (fs: CriterionFinding[]): CriterionAssessment[] => crit.map((cv, i) => { const o = outcomes[i]!; return { criterion_id: cv.id, category: o.state === "parsed" ? o.category : null, scoring: o.state === "parsed" ? o.scoring : true, completeness: o.state === "parsed" ? o.completeness : "unresolved", finding: fs[i]! }; });
      baseTrials.push({ sources, outcomes, assess: asm(baseFind), tier: ceilingTier(pre0).tier });
      projTrials.push({ sources, outcomes, assess: asm(projFind), tier: ceilingTier(pre1).tier });
    }
    const panel = (ts: QuestionTrial[]) => studyTeamQuestions(ts, profile, 99).map((q) => `${q.fact_key}:${q.study_count}`);
    const vetOf = (ts: QuestionTrial[]) => { let pairs = 0, fromDowngraded = 0; for (const t of ts) for (const q of studyTeamQuestions([t], profile, 99)) for (const s of q.studies) for (const cr of s.criteria) { pairs++; const i = t.sources.findIndex((x) => x.id === cr.criterion_id); const o = t.outcomes[i]!; if (o.state === "parsed" && o.vet === "atoms_downgraded") fromDowngraded++; } return { pairs, fromDowngraded }; };
    // Variant: dependencies of criteria whose vetting downgraded an atom to text get NO authority (conservative criterion-level proxy: the cached parse does not record which leaf was rejected).
    const noAuth = (ts: QuestionTrial[]): QuestionTrial[] => ts.map((t) => ({ ...t, assess: t.assess.map((a, i) => { const o = t.outcomes[i]!; return o.state === "parsed" && o.vet === "atoms_downgraded" ? { ...a, scoring: false } : a; }) }));
    const b = panel(baseTrials), p = panel(projTrials), pn = panel(noAuth(projTrials));
    report.push({
      profile: id, storedResults: results.length, usableTrials: usable, noCachedParse: noParse, criteriaCountMismatch: mismatch,
      criterionRows_llmDecidedPassFail_byParseStatus: rows, rowsChangedToUnknown: status.rowsChanged, evidenceKeysRemoved: evidenceKeysRemoved.n,
      ruleD_failFindingsByFailCheck: ruleD, storedTrialsWithReportedConflictFlag: storedConflictFlag,
      trialsWithAtLeastOneDowngrade: trialsAffected, ofWhichStoredVerifiedTrue: affectedVerified,
      tierBeforeCeiling_baselineToProjected: tierPre, finalTier_baselineToProjected: tierFinal,
      studyTeamPanel: { baselineTopics: b.length, projectedTopics: p.length, baseline: b, projected: p, baselineTop3: b.slice(0, 3), projectedTop3: p.slice(0, 3), baselineCriterionKeyPairs: vetOf(baseTrials), projectedCriterionKeyPairs: vetOf(projTrials), projectedWithoutRejectedAtomDependencies: { topics: pn.length, all: pn, top3: pn.slice(0, 3) } },
    });
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/fail-closed-impact-offline.json", JSON.stringify({ note: "Offline read-only projection of the PROPOSED fail-closed rule (not wired) on the three prepared FICTIONAL profiles; counts and fact keys only; no model calls, no writes to the database. The verification and fail-check stages are not re-run.", parserVersion: PARSER_VERSION, profiles: report }, null, 1) + "\n");
  console.warn("wrote eval/reports/fail-closed-impact-offline.json");
}

main().then(() => process.exit(0), (e: unknown) => { console.error(`fail-closed-impact stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
