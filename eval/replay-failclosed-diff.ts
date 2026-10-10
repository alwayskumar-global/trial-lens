// OFFLINE, READ-ONLY before/after of the stored replays under the read-time fail-closed treatment (src/lib/cache/replay-failclosed.ts), using the REAL functions.
// Select-only reads (a test enforces it); NO writes to the database, NO model calls, no replay regeneration. Counts and fact keys only; no criterion or note text.
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/replay-failclosed-diff.ts
// Not re-run: the verification stage and the fail-check stage (they need a model). "Before" = the stored events streamed under the read-time R2 ceiling only
// (what a visitor saw until this change); "after" = replayEvents as now implemented.
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { SupabaseReplayStore, replayEvents } from "../src/lib/cache/replay";
import { applyCeilingToAssessment } from "../src/lib/engine/ceiling";
import { studyTeamQuestions } from "../src/lib/engine/study-questions";
import { tierTrial } from "../src/lib/engine/tier";
import type { QuestionTrial } from "../src/lib/engine/questions";
import type { CriterionAssessment, ParseOutcome } from "../src/lib/engine/reconcile";
import type { PatientProfile } from "../src/schema/profile";
import type { SseEvent } from "../src/schema/sse";
import { FACT_KEYS, type FactKey } from "../src/schema/vocabulary";
import { getSupabase } from "../src/lib/supabase";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
const trials = (es: SseEvent[]) => es.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));

async function main(): Promise<void> {
  const store = new SupabaseReplayStore();
  const cases = await Promise.all(REPLAY_PROFILES.map(async (p) => ({ id: p.id, c: await store.get(p.id) })));
  if (cases.some((x) => !x.c)) throw new Error("stored replay case not available");
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
    const raw = c!.events;
    const beforeEvents = raw.filter((e) => e.type !== "stage").map((e): SseEvent => (e.type === "trial_result" ? { ...e, assessment: applyCeilingToAssessment(e.assessment) } : e));
    const afterEvents = replayEvents(c!, "requested").filter((e) => e.type !== "mode" && e.type !== "done");
    const B = trials(beforeEvents), A = trials(afterEvents);
    const byNct = new Map(A.map((t) => [t.nct_id, t]));
    const noParse = B.filter((t) => !latest.has(t.nct_id)).map((t) => t.nct_id);
    const statusBefore: Record<string, number> = {}, statusAfter: Record<string, number> = {};
    const changed = { rows: 0, evidenceKeysRemoved: 0, rationaleReplaced: 0, failCheckRemoved: {} as Record<string, number> }, changedNoParse = { trials: 0, rows: 0 };
    const tierMove: Record<string, number> = {}, flagsBefore: Record<string, number> = {}, flagsAfter: Record<string, number> = {};
    let verifiedBefore = 0, verifiedAfter = 0, topUnknownChanged = 0, trialsTouched = 0, orderChanged = 0;
    for (const b of B) {
      const a = byNct.get(b.nct_id)!;
      b.verifier_flags.forEach((f) => inc(flagsBefore, f)); a.verifier_flags.forEach((f) => inc(flagsAfter, f));
      if (b.verified) verifiedBefore++; if (a.verified) verifiedAfter++;
      inc(tierMove, `${b.tier}->${a.tier}`);
      if ((b.top_unknown ?? null) !== (a.top_unknown ?? null)) topUnknownChanged++;
      let touched = false, rowsHere = 0;
      b.findings.forEach((fb, i) => {
        const fa = a.findings[i]!;
        inc(statusBefore, `${fb.source}:${fb.status}`); inc(statusAfter, `${fa.source}:${fa.status}`);
        if (fb.status !== fa.status) { changed.rows++; rowsHere++; touched = true; changed.evidenceKeysRemoved += fb.evidence.length; if (fb.rationale !== fa.rationale) changed.rationaleReplaced++; if (fb.fail_check) inc(changed.failCheckRemoved, fb.fail_check); }
      });
      if (touched) { trialsTouched++; if (noParse.includes(b.nct_id)) { changedNoParse.trials++; changedNoParse.rows += rowsHere; } }
    }
    B.forEach((b, i) => { if (A[i]!.nct_id !== b.nct_id) orderChanged++; });
    // method check: recompute the tier from the stored criterion views with the stored findings and compare with the stored tier (validates the tier recomputation)
    let recomputeAgrees = 0, recomputeLower = 0, recomputeHigher = 0;
    for (const e of raw) if (e.type === "trial_result" && e.assessment.criteria) {
      const a = e.assessment, byId = new Map(a.findings.map((f) => [f.criterion_id, f]));
      const t = tierTrial(a.criteria!.map((cv) => ({ scoring: cv.category !== "consent_logistics", category: cv.category as never, status: byId.get(cv.id)?.status ?? "UNKNOWN", completeness: cv.completeness, failCheck: byId.get(cv.id)?.fail_check })), { unknownThreshold: 3, expectedCriteria: a.criteria!.length });
      const rank = ["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"];
      if (t === a.tier) recomputeAgrees++; else if (rank.indexOf(t) < rank.indexOf(a.tier)) recomputeLower++; else recomputeHigher++;
    }
    // the live panel under the NEW rule, from the cached parses (usable trials only), with the stored vs the downgraded findings
    const pe = raw.find((e) => e.type === "profile");
    const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, PatientProfile["facts"][FactKey]] => [k, { key: k, state: "unknown" }])) as PatientProfile["facts"];
    if (pe && pe.type === "profile") for (const f of pe.facts) facts[f.key] = { key: f.key, state: f.state, value: f.value };
    const profile: PatientProfile = { facts };
    const mk = (ts: typeof B): QuestionTrial[] => ts.flatMap((t) => {
      const outcomes = latest.get(t.nct_id), crit = t.criteria ?? [];
      if (!outcomes || outcomes.length !== crit.length) return [];
      const assess: CriterionAssessment[] = crit.map((cv, i) => { const o = outcomes[i]!; return { criterion_id: cv.id, category: o.state === "parsed" ? o.category : null, scoring: o.state === "parsed" ? o.scoring : true, completeness: o.state === "parsed" ? o.completeness : "unresolved", finding: t.findings.find((f) => f.criterion_id === cv.id) ?? { criterion_id: cv.id, status: "UNKNOWN", evidence: [], rationale: "", source: "code" } }; });
      return [{ sources: crit.map((cv) => ({ id: cv.id, nct_id: t.nct_id, type: cv.type, text: cv.text })), outcomes, assess, tier: t.tier }];
    });
    const panel = (ts: typeof B) => studyTeamQuestions(mk(ts), profile, 99).map((q) => `${q.fact_key}:${q.study_count}`);
    report.push({
      profile: id, storedTrials: B.length, trialsWithoutCachedParse: noParse.length, trialsWithoutCachedParse_ids: noParse,
      rowsByFindingSource_beforeAfter: { before: statusBefore, after: statusAfter },
      changed: { ...changed, trialsTouched, ofThoseWithoutCachedParse: changedNoParse },
      tiersStreamed_beforeToAfter: tierMove, reportedConflictFlag: { before: flagsBefore.reported_conflict ?? 0, after: flagsAfter.reported_conflict ?? 0 }, verifiedTrue: { before: verifiedBefore, after: verifiedAfter },
      topUnknownChanged, trialResultOrderChanged: orderChanged,
      storedEventTypes: raw.reduce((m, e) => { inc(m, e.type); return m; }, {} as Record<string, number>),
      streamedEventTypes_after: afterEvents.reduce((m, e) => { inc(m, e.type); return m; }, {} as Record<string, number>),
      countsEvent_unchanged: JSON.stringify(raw.filter((e) => e.type === "counts")) === JSON.stringify(afterEvents.filter((e) => e.type === "counts")),
      tierRecomputationCheck_vsStoredRawTier: { agrees: recomputeAgrees, recomputedTierBetterThanStored_explainedByVerificationStage: recomputeLower, recomputedTierWorseThanStored: recomputeHigher },
      panelIfComputedNow_newRule: { withStoredFindings: panel(B), withDowngradedFindings: panel(A) },
    });
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/replay-failclosed-diff-offline.json", JSON.stringify({ note: "Offline read-only before/after of stored replays under the read-time fail-closed treatment; counts only; no writes, no model calls, no regeneration. Verification and fail-check stages not re-run.", parserVersion: PARSER_VERSION, profiles: report }, null, 1) + "\n");
  console.warn("wrote eval/reports/replay-failclosed-diff-offline.json");
}

main().then(() => process.exit(0), (e: unknown) => { console.error(`replay-failclosed-diff stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
