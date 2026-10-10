// OFFLINE, READ-ONLY impact measurement of the PROPOSED relevance check over the three prepared FICTIONAL profiles' stored replay results and the cached
// public-criteria parses. Only `select` calls (through SupabaseReplayStore.get and one .select on trial_criteria_cache); NO writes, NO model calls, nothing wired.
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/relevance-impact.ts
// Output: counts only (no criterion text, no evidence text). Variants of the check, each projected on the stored LLM-decided PASS/FAIL findings:
//   A = cited keys must be among the parser-DECLARED dependencies of the criterion (dependsOn(clause))
//   B = cited keys must be VERIFIED dependencies (declared AND the declaring leaf's own source matches the shared, LOOSE cue). B accepts at least what a strict
//       anchored table would accept, so B's downgrades are a LOWER BOUND of a strict table's downgrades.
// Projected tier = tierTrialCeiled recomputed from the stored criterion statuses with the downgraded findings set to UNKNOWN; the verification stage is NOT re-run.
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { SupabaseReplayStore } from "../src/lib/cache/replay";
import { applyCeilingToAssessment } from "../src/lib/engine/ceiling";
import { CUES } from "../src/lib/engine/atom-checks";
import { dependsOn } from "../src/lib/engine/clause";
import { FACT_KEYS } from "../src/schema/vocabulary";
import { verifyDependencies, citesOnlyVerified } from "../src/lib/engine/dependency-verify";
import { tierTrialCeiled, type TierCriterion } from "../src/lib/engine/tier";
import type { ParseOutcome } from "../src/lib/engine/reconcile";
import { getSupabase } from "../src/lib/supabase";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";

const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };

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
    const results = c!.events.flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []));
    const status = (o: ParseOutcome) => (o.state === "parsed" ? `parsed:${o.completeness}/${o.vet}` : `unresolved:${o.reason}`);
    const free: Record<string, Record<string, number>> = {}; // by parse status: criteria, freeText, depsEmpty, depsNonempty, verifiedNonempty
    const llm: Record<string, Record<string, number>> = {}; // by parse status: llmPassFail, kept/downgraded under A and B
    const tierShift: Record<string, Record<string, number>> = { A: {}, B: {} };
    let usable = 0, noParse = 0, mismatch = 0, baselineAgrees = 0;
    for (const r of results) {
      const outcomes = latest.get(r.nct_id);
      const crit = r.criteria ?? [];
      if (!outcomes) { noParse++; continue; }
      if (outcomes.length !== crit.length) { mismatch++; continue; }
      usable++;
      const tc = (statusOf: (i: number) => string): TierCriterion[] => crit.map((cv, i) => {
        const o = outcomes[i]!;
        const f = r.findings.find((x) => x.criterion_id === cv.id);
        return { scoring: o.state === "parsed" ? o.scoring : true, category: o.state === "parsed" ? o.category : null, status: statusOf(i) as never, completeness: o.state === "parsed" ? o.completeness : "unresolved", failCheck: f?.fail_check };
      });
      const stored = (i: number) => r.findings.find((x) => x.criterion_id === crit[i]!.id)?.status ?? "UNKNOWN";
      const opts = { unknownThreshold: 3, expectedCriteria: crit.length };
      const base = tierTrialCeiled(tc(stored), opts).tier;
      if (base === applyCeilingToAssessment(r).tier) baselineAgrees++;
      const projected: Record<"A" | "B", Set<number>> = { A: new Set(), B: new Set() };
      crit.forEach((cv, i) => {
        const o = outcomes[i]!;
        const st = status(o);
        const f = r.findings.find((x) => x.criterion_id === cv.id);
        const fr = (free[st] ??= {});
        inc(fr, "criteria");
        if (o.state !== "parsed" || o.completeness !== "partial") return;
        inc(fr, "freeText");
        const declared = dependsOn(o.clause);
        const rep = verifyDependencies(o.clause);
        inc(fr, declared.length ? "declaredNonempty" : "declaredEmpty");
        if (rep.verified.length) inc(fr, "verifiedNonempty");
        if (f && f.source === "llm_mid" && (f.status === "PASS" || f.status === "FAIL")) {
          const l = (llm[st] ??= {});
          inc(l, "llmPassFail");
          const okA = f.evidence.length > 0 && f.evidence.every((k) => (declared as string[]).includes(k));
          const okB = citesOnlyVerified(f.evidence, rep);
          // DIAGNOSTIC ONLY (not a proposed check; the shared cue table is loose): does the ORIGINAL criterion text contain a cue for the cited keys?
          const cited = f.evidence.filter((k): k is (typeof FACT_KEYS)[number] => (FACT_KEYS as readonly string[]).includes(k));
          const cueHits = cited.filter((k) => CUES[k].test(cv.text)).length;
          inc(l, cited.length === 0 ? "diag_noVocabKeyCited" : cueHits === cited.length ? "diag_allCitedKeysHaveCueInText" : cueHits === 0 ? "diag_noCitedKeyHasCueInText" : "diag_someCitedKeysHaveCueInText");
          inc(l, okA ? "keptA" : "downgradedA");
          inc(l, okB ? "keptB" : "downgradedB");
          if (!okA) projected.A.add(i);
          if (!okB) projected.B.add(i);
        }
      });
      for (const v of ["A", "B"] as const) {
        if (projected[v].size === 0) continue;
        const after = tierTrialCeiled(tc((i) => (projected[v].has(i) ? "UNKNOWN" : stored(i))), opts).tier;
        inc(tierShift[v]!, `${base}->${after}`);
      }
    }
    report.push({ profile: id, storedResults: results.length, usableTrials: usable, noCachedParse: noParse, criteriaCountMismatch: mismatch, recomputedBaselineTierAgreesWithStored: baselineAgrees, parseStatus_freeText: free, parseStatus_llmDecidedPassFail: llm, trialsWithAtLeastOneDowngrade_tierShift: tierShift });
  }
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/relevance-impact-offline.json", JSON.stringify({ note: "Offline read-only projection of the PROPOSED relevance check (not wired) on the three prepared FICTIONAL profiles; counts only; no model calls, no writes. A = declared dependencies, B = declared and anchored by the loose shared cue (lower bound of a strict table's downgrades). Tier projection does not re-run the verification stage.", parserVersion: PARSER_VERSION, profiles: report }, null, 1) + "\n");
  console.warn("wrote eval/reports/relevance-impact-offline.json");
}

main().then(() => process.exit(0), (e: unknown) => { console.error(`relevance-impact stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
