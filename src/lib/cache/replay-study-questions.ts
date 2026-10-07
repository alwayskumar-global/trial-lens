// Adds the versioned `study_questions` event to a STORED replay case, derived from the SAME stored trial_result events plus the cached parses
// of those trials (read-only inputs). Pure: no I/O. The script eval/replay-study-questions.ts does the reading, the dry-run printout and,
// only on --apply, the single write. Validation is all-or-nothing: any problem means no event is produced (never a partial panel and never a
// misleading empty one).
import type { ReplayCase } from "@/lib/cache/replay";
import { buildStudyQuestionsEvent } from "@/lib/engine/study-questions";
import type { CriterionAssessment, ParseOutcome } from "@/lib/engine/reconcile";
import type { QuestionTrial } from "@/lib/engine/questions";
import { applyCeilingToAssessment } from "@/lib/engine/ceiling";
import type { PatientProfile } from "@/schema/profile";
import { SseEventSchema } from "@/schema/sse";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";

export type StudyQuestionsEvent = ReturnType<typeof buildStudyQuestionsEvent>;
export interface ReplayPlan {
  ok: true;
  event: StudyQuestionsEvent;
  /** trials left out because their own stored result says they were never assessed (pending or failed): listed so nothing is silent */
  excluded: Array<{ nct_id: string; reason: "analysis_pending" | "analysis_failed" }>;
  assessedTrials: number;
}
export type ReplayPlanResult = ReplayPlan | { ok: false; problems: string[] };

/** Cached parse outcomes by NCT id; the caller passes only parses that passed `OutcomesSchema`. */
export type ParseMap = ReadonlyMap<string, readonly ParseOutcome[]>;

export function planReplayStudyQuestions(c: ReplayCase, parses: ParseMap): ReplayPlanResult {
  const problems: string[] = [];
  const results = c.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
  if (results.length === 0) return { ok: false, problems: ["no_trial_results"] };
  const pe = c.events.find((e) => e.type === "profile");
  if (!pe || pe.type !== "profile") return { ok: false, problems: ["no_profile_event"] };
  const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, PatientProfile["facts"][FactKey]] => [k, { key: k, state: "unknown" }])) as PatientProfile["facts"];
  for (const f of pe.facts) facts[f.key] = { key: f.key, state: f.state, value: f.value };
  const profile: PatientProfile = { facts };

  const excluded: ReplayPlan["excluded"] = [];
  const trials: QuestionTrial[] = [];
  for (const r of results) {
    const crit = r.criteria ?? [];
    const never = r.verifier_flags.includes("analysis_pending") ? "analysis_pending" : r.analysis_failed ? "analysis_failed" : null;
    if (never) { excluded.push({ nct_id: r.nct_id, reason: never }); continue; }
    const outcomes = parses.get(r.nct_id);
    if (!outcomes) { problems.push(`missing_parse:${r.nct_id}`); continue; }
    if (outcomes.length !== crit.length) { problems.push(`parse_count_mismatch:${r.nct_id}:${outcomes.length}!=${crit.length}`); continue; }
    const assess: CriterionAssessment[] = crit.map((cv, i) => {
      const o = outcomes[i]!;
      const finding = r.findings.find((f) => f.criterion_id === cv.id);
      if (!finding) problems.push(`missing_finding:${cv.id}`);
      return { criterion_id: cv.id, category: o.state === "parsed" ? o.category : null, scoring: o.state === "parsed" ? o.scoring : true, completeness: o.state === "parsed" ? o.completeness : "unresolved", finding: finding ?? { criterion_id: cv.id, status: "UNKNOWN" as const, evidence: [], rationale: "", source: "code" as const } };
    });
    trials.push({ sources: crit.map((cv) => ({ id: cv.id, nct_id: r.nct_id, type: cv.type, text: cv.text })), outcomes: [...outcomes], assess, tier: applyCeilingToAssessment(r).tier });
  }
  if (problems.length) return { ok: false, problems };

  const event = buildStudyQuestionsEvent(trials, profile);
  // Verify every NCT id and criterion in the panel against the stored trial_result events (exact id, type and wording).
  const byNct = new Map(results.map((r) => [r.nct_id, r]));
  for (const q of event.questions) {
    for (const s of q.studies) {
      const r = byNct.get(s.nct_id);
      if (!r) { problems.push(`unknown_nct:${s.nct_id}`); continue; }
      for (const cr of s.criteria) {
        const stored = (r.criteria ?? []).find((x) => x.id === cr.criterion_id);
        if (!stored || stored.type !== cr.type || stored.text !== cr.text) problems.push(`criterion_mismatch:${cr.criterion_id}`);
      }
    }
  }
  if (!SseEventSchema.safeParse(event).success) problems.push("event_schema_invalid");
  if (problems.length) return { ok: false, problems };
  return { ok: true, event, excluded, assessedTrials: trials.length };
}

/**
 * Inserts the event into the RAW stored events array (so nothing else in the stored JSON is re-serialised or changed): any earlier
 * `study_questions` entries are replaced; the new one goes after the last legacy `question` event that precedes the first trial_result,
 * otherwise right before the first trial_result.
 */
export function insertStudyQuestions(rawEvents: readonly unknown[], event: StudyQuestionsEvent): unknown[] {
  const type = (e: unknown) => (e && typeof e === "object" ? (e as { type?: unknown }).type : undefined);
  const base = rawEvents.filter((e) => type(e) !== "study_questions");
  const firstResult = base.findIndex((e) => type(e) === "trial_result");
  const end = firstResult < 0 ? base.length : firstResult;
  let at = end;
  for (let i = end - 1; i >= 0; i--) if (type(base[i]) === "question") { at = i + 1; break; }
  return [...base.slice(0, at), event, ...base.slice(at)];
}
