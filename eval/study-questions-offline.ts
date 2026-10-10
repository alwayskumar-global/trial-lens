// OFFLINE: the Option B "Questions worth asking the study team" panel content for the three PREPARED FICTIONAL profiles. Read-only: it selects the stored replay results and the
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
import type { QuestionTrial } from "../src/lib/engine/questions";
import { studyTeamQuestions } from "../src/lib/engine/study-questions";
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
    let noParse = 0, mismatch = 0; // counted for the log line below
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
    const panel = studyTeamQuestions(trials, profile, 3);
    say(`\n== ${id}: ${results.length} stored results; usable ${trials.length}; no cached parse ${noParse}; criteria-count mismatch ${mismatch}`);
    for (const q of panel) {
      say(`   ${q.topic}: ${q.study_count} distinct studies (${q.studies.map((x) => `${x.nct_id}×${x.criteria.length}`).join(", ")})`);
      for (const st of q.studies.slice(0, 2)) say(`      ${st.nct_id} [${st.criteria[0]!.type}] ${st.criteria[0]!.text.replace(/\s+/g, " ").slice(0, 150)}`);
    }
    if (panel.length === 0) say("   no item (no supported unresolved dependency)");
    report.push({ profile: id, usableTrials: trials.length, panel: panel.map((q) => ({ fact_key: q.fact_key, study_count: q.study_count, studies: q.studies.map((x) => ({ nct_id: x.nct_id, criteria: x.criteria.map((c) => ({ criterion_id: c.criterion_id, type: c.type, text: c.text.replace(/\s+/g, " ").slice(0, 300) })) })) })) });
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/study-questions-offline.json", JSON.stringify({ note: "Option B panel content for the three prepared FICTIONAL profiles from cached parses; read-only, no model calls; public registry wording, no patient data.", parserVersion: PARSER_VERSION, profiles: report }, null, 1) + "\n");
  say("wrote eval/reports/study-questions-offline.json");
}

main().then(() => process.exit(0), (e: unknown) => { console.error(`study-questions-offline stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
