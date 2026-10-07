// Adds the versioned `study_questions` event (sq-1) to the three stored FICTIONAL replay cases. NO model calls.
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/replay-study-questions.ts                       DRY-RUN (default): read-only, prints the proposed change
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/replay-study-questions.ts --apply --backup-dir=<dir>
// Dry-run reads `replay_cases` and `trial_criteria_cache` (select only). --apply re-runs the same validation for ALL cases first; if any case has
// a problem it writes NOTHING. Otherwise it backs up each case's current `result` JSON to <dir>, then updates ONLY the `result` column of those
// three rows (the new event inserted into the raw events array; every other key and event unchanged). No other table, no other write.
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { StoredEventsSchema, type ReplayCase } from "../src/lib/cache/replay";
import { insertStudyQuestions, planReplayStudyQuestions, type ParseMap } from "../src/lib/cache/replay-study-questions";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";
import { getSupabase } from "../src/lib/supabase";
import type { ParseOutcome } from "../src/lib/engine/reconcile";
import { z } from "zod";

const say = (s: string) => console.warn(s);
const apply = process.argv.includes("--apply");
const backupDir = process.argv.find((a) => a.startsWith("--backup-dir="))?.slice("--backup-dir=".length);

async function main(): Promise<void> {
  if (apply && !backupDir) throw new Error("--apply requires --backup-dir=<dir>. Nothing was written.");
  const ids = REPLAY_PROFILES.map((p) => p.id);
  const sb = getSupabase();
  const { data: rows, error } = await sb.from("replay_cases").select("id,label,profile,result").in("id", ids);
  if (error) throw new Error("replay read failed");
  const missing = ids.filter((id) => !(rows ?? []).some((r) => String(r.id) === id));
  if (missing.length) throw new Error(`stored replay case not found: ${missing.join(", ")}. Nothing was written.`);

  const cases = new Map<string, { c: ReplayCase; rawResult: Record<string, unknown>; rawEvents: unknown[] }>();
  for (const r of rows ?? []) {
    const profile = z.object({ text: z.string() }).safeParse(r.profile);
    const rawResult = z.object({ events: z.array(z.unknown()) }).passthrough().safeParse(r.result);
    const events = StoredEventsSchema.safeParse((rawResult.success ? rawResult.data.events : null) ?? []);
    if (!profile.success || !rawResult.success || !events.success) throw new Error(`stored case ${String(r.id)} does not parse. Nothing was written.`);
    cases.set(String(r.id), { c: { id: String(r.id), label: String(r.label), profile_text: profile.data.text, events: events.data }, rawResult: rawResult.data, rawEvents: rawResult.data.events });
  }
  const ncts = [...new Set([...cases.values()].flatMap(({ c }) => c.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment.nct_id] : []))))];
  const { data: cache, error: cerr } = await sb.from("trial_criteria_cache").select("nct_id,source_version,parsed").eq("parser_version", PARSER_VERSION).in("nct_id", ncts);
  if (cerr) throw new Error("criteria cache read failed. Nothing was written.");
  const latest = new Map<string, ParseOutcome[]>();
  for (const row of [...(cache ?? [])].sort((a, b) => String(a.source_version).localeCompare(String(b.source_version)))) {
    const p = OutcomesSchema.safeParse(row.parsed);
    if (p.success) latest.set(String(row.nct_id), p.data as ParseOutcome[]);
  }
  say(`parser version ${PARSER_VERSION}; distinct trials in the stored cases: ${ncts.length}; cached parses read: ${latest.size}`);

  const plans = ids.map((id) => ({ id, plan: planReplayStudyQuestions(cases.get(id)!.c, latest as ParseMap) }));
  let allOk = true;
  for (const { id, plan } of plans) {
    const have = cases.get(id)!.rawEvents.length;
    if (!plan.ok) { allOk = false; say(`\n== ${id}: VALIDATION FAILED, nothing would be stored: ${plan.problems.join(", ")}`); continue; }
    say(`\n== ${id}: ${plan.assessedTrials} assessed trials used; stored events ${have} → ${have + 1} (study_questions ${plan.event.version}); validated: every NCT id and criterion matches its stored trial_result`);
    say(`   excluded (never assessed, from their own stored result): ${plan.excluded.length ? plan.excluded.map((x) => `${x.nct_id} (${x.reason})`).join(", ") : "none"}`);
    if (plan.event.questions.length === 0) say("   questions: [] (computation ran; no supported item)");
    for (const q of plan.event.questions) {
      say(`   ${q.topic}: ${q.study_count} distinct studies`);
      for (const s of q.studies) say(`      ${s.nct_id}: ${s.criteria.map((c) => `[${c.type}] ${c.text.replace(/\s+/g, " ").slice(0, 110)}`).join(" || ")}`);
    }
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/replay-study-questions-dryrun.json", JSON.stringify({ note: "Proposed study_questions events for the three stored FICTIONAL replay cases (public registry wording; no patient data). Dry-run output; nothing written unless --apply.", parserVersion: PARSER_VERSION, cases: plans.map(({ id, plan }) => (plan.ok ? { id, ok: true, assessedTrials: plan.assessedTrials, excluded: plan.excluded, event: plan.event } : { id, ok: false, problems: plan.problems })) }, null, 1) + "\n");
  say("\nwrote eval/reports/replay-study-questions-dryrun.json");
  if (!allOk) { say(apply ? "NOT APPLIED: at least one case failed validation; nothing was written." : "dry-run: at least one case failed validation (a real run would stop here)."); return; }
  if (!apply) { say("dry-run only: nothing was written. Re-run with --apply --backup-dir=<dir> after review."); return; }

  mkdirSync(backupDir!, { recursive: true });
  for (const { id } of plans) writeFileSync(`${backupDir}/replay-${id}-result-backup.json`, JSON.stringify(cases.get(id)!.rawResult));
  say(`backed up the current result JSON of the 3 cases to ${backupDir}`);
  for (const { id, plan } of plans) {
    if (!plan.ok) continue;
    const { rawResult, rawEvents } = cases.get(id)!;
    const next = { ...rawResult, events: insertStudyQuestions(rawEvents, plan.event) };
    const { error: werr } = await sb.from("replay_cases").update({ result: next }).eq("id", id);
    if (werr) throw new Error(`update failed for ${id}; earlier cases may already be updated, restore from the backup if needed`);
    say(`updated ${id}`);
  }
}
main().then(() => process.exit(0), (e: unknown) => { console.error(`replay-study-questions stopped: ${(e as Error)?.message?.slice(0, 220) ?? "unknown"}`); process.exit(1); });
