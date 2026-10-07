// OFFLINE audit of the cached parser results for the trials in the three stored replay cases (public registry criteria; no patient data).
// Read-only (Supabase select), NO model calls, no writes except eval/reports/coverage-audit.json. Purpose: for every scoring criterion that is
// not strict-typed (every leaf an executable atom), record WHY (vet status, leaf kinds, vocabulary cue present/absent, logic/timing/threshold
// words) so vocabulary and logic changes can be proposed and frozen BEFORE any new cohort is chosen. Output: counts, NCT ids, criterion indices
// and short public-criterion snippets only.
//   NODE_USE_ENV_PROXY=1 pnpm exec tsx eval/coverage-audit.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { OutcomesSchema, PARSER_VERSION } from "../src/lib/cache/criteria-cache";
import { SupabaseReplayStore } from "../src/lib/cache/replay";
import { CUES } from "../src/lib/engine/atom-checks";
import { CORE_CATEGORIES } from "../src/schema/criteria";
import { leaves } from "../src/lib/engine/clause";
import type { ParseOutcome } from "../src/lib/engine/reconcile";
import { getSupabase } from "../src/lib/supabase";
import { REPLAY_PROFILES } from "../src/lib/sample/replay-profiles";
import { FACT_KEYS, type FactKey } from "../src/schema/vocabulary";

const say = (s: string) => console.warn(s);
const NEG = /\b(?:no|not|non|without|never|none|absence|free of|history of)\b/i;
const TIME = /\b(?:within|before|after|prior to|since|during|ago|past|last|recent|weeks?|months?|days?|years?)\b/i;
const NUM = /\d/;
// out-of-vocabulary topic buckets (keyword heuristics for the audit only; they are NOT parser rules)
const TOPICS: Array<[string, RegExp]> = [
  ["measurable/evaluable disease", /measurable|evaluable|RECIST/i], ["brain/CNS metastases", /brain|CNS|central nervous|leptomening/i],
  ["infection (HIV/hepatitis/active)", /\bHIV\b|hepatitis|HBV|HCV|infection|tubercul/i], ["cardiac (LVEF/QTc/MI/failure)", /LVEF|ejection|QTc?\b|myocardial|heart failure|cardiac|cardio/i],
  ["organ function labs", /creatinine|bilirubin|AST|ALT|transaminase|renal|hepatic|liver function|neutrophil|platelet|hemoglobin|haemoglobin|ANC\b|white blood/i],
  ["prior therapy (other)", /prior|previous|received|treated with|therapy|chemotherapy|radiotherapy|radiation|immunotherapy|surgery|resection/i],
  ["biomarker (other)", /PIK3CA|BRCA|PD-L1|ESR1|HER2|ER\b|PR\b|Ki-?67|mutation|biomarker|receptor|HRD|TROP2|ctDNA/i],
  ["diagnosis/histology", /histolog|cytolog|carcinoma|invasive|ductal|lobular|diagnos|adenocarcinoma|triple/i], ["other malignancy", /other (?:malignan|cancer)|second (?:malignan|primary)|malignanc/i],
  ["pregnancy/contraception", /pregnan|breast-?feeding|lactat|contracept|childbearing/i], ["consent/compliance/logistics", /consent|willing|able to comply|compliance|protocol|follow-?up|swallow|geograph/i],
  ["allergy/hypersensitivity", /allerg|hypersensitiv/i], ["ECOG/performance", /ECOG|Karnofsky|performance status/i], ["age/sex", /\bage\b|years of age|female|male|\bwomen\b|\bmen\b/i],
  ["concomitant medication", /concomitant|CYP|inhibitor|inducer|medication|anticoag|steroid/i], ["menopausal", /menopaus/i],
];
const topicOf = (t: string) => TOPICS.find(([, re]) => re.test(t))?.[0] ?? "uncategorised";
const cueKeys = (t: string): FactKey[] => FACT_KEYS.filter((k) => CUES[k]?.test(t));

async function main(): Promise<void> {
  const store = new SupabaseReplayStore();
  const cases = await Promise.all(REPLAY_PROFILES.map((p) => store.get(p.id)));
  const src = new Map<string, Array<{ id: string; type: string; text: string }>>();
  for (const c of cases) for (const e of c?.events ?? []) if (e.type === "trial_result") src.set(e.assessment.nct_id, (e.assessment.criteria ?? []).map((x) => ({ id: x.id, type: x.type, text: x.text })));
  const { data, error } = await getSupabase().from("trial_criteria_cache").select("nct_id,source_version,parsed").eq("parser_version", PARSER_VERSION).in("nct_id", [...src.keys()]);
  if (error) throw new Error("cache read failed");
  const latest = new Map<string, ParseOutcome[]>();
  for (const row of [...(data ?? [])].sort((a, b) => String(a.source_version).localeCompare(String(b.source_version)))) {
    const p = OutcomesSchema.safeParse(row.parsed);
    if (p.success) latest.set(String(row.nct_id), p.data as ParseOutcome[]);
  }
  type Row = { nct: string; idx: number; type: string; text: string; scoring: boolean; state: string; vet: string | null; category: string | null; strictTyped: boolean; leafKinds: string[]; cue: FactKey[]; topic: string; neg: boolean; time: boolean; num: boolean; dependsOn: string[]; typedKeys: string[] };
  const rows: Row[] = [];
  let noParse = 0, mismatch = 0;
  for (const [nct, crit] of src) {
    const o = latest.get(nct);
    if (!o) { noParse++; continue; }
    if (o.length !== crit.length) { mismatch++; continue; }
    crit.forEach((c, i) => {
      const oc = o[i]!;
      if (oc.state !== "parsed") { rows.push({ nct, idx: i, type: c.type, text: c.text, scoring: true, state: `unresolved:${oc.reason}`, vet: null, category: null, strictTyped: false, leafKinds: [], cue: cueKeys(c.text), topic: topicOf(c.text), neg: NEG.test(c.text), time: TIME.test(c.text), num: NUM.test(c.text), dependsOn: [], typedKeys: [] }); return; }
      const ls = leaves(oc.clause);
      rows.push({ nct, idx: i, type: c.type, text: c.text, scoring: oc.scoring, state: `parsed:${oc.completeness}`, vet: oc.vet, category: oc.category, strictTyped: oc.completeness === "full", leafKinds: ls.map((l) => l.kind), cue: cueKeys(c.text), topic: topicOf(c.text), neg: NEG.test(c.text), time: TIME.test(c.text), num: NUM.test(c.text), dependsOn: [...new Set(ls.flatMap((l) => (l.kind === "text" ? l.depends_on : [])))], typedKeys: [...new Set(ls.flatMap((l) => (l.kind === "atom" ? [l.fact_key] : [])))] });
    });
  }
  const sc = rows.filter((r) => r.scoring);
  const by = <T extends string | number>(xs: Row[], f: (r: Row) => T) => xs.reduce<Record<string, number>>((m, r) => ((m[String(f(r))] = (m[String(f(r))] ?? 0) + 1), m), {});
  const notTyped = sc.filter((r) => !r.strictTyped);
  const summary = {
    trials: src.size, trialsWithParse: src.size - noParse - mismatch, noParse, mismatch, criteria: rows.length, scoring: sc.length,
    strictTyped: sc.filter((r) => r.strictTyped).length, strictTypedPct: +(100 * sc.filter((r) => r.strictTyped).length / Math.max(1, sc.length)).toFixed(1),
    atLeastOneAtom: sc.filter((r) => r.leafKinds.includes("atom")).length,
    byState: by(sc, (r) => `${r.state}/${r.vet}`), notTypedByTopic: by(notTyped, (r) => r.topic),
    notTypedWithVocabCue: notTyped.filter((r) => r.cue.length).length, notTypedNoVocabCue: notTyped.filter((r) => !r.cue.length).length,
    notTypedByLogicWord: { negation: notTyped.filter((r) => r.neg).length, timing: notTyped.filter((r) => r.time).length, number: notTyped.filter((r) => r.num).length },
    notTypedByCategory: by(notTyped, (r) => r.category ?? "unresolved"),
    typedKeys: by(sc.filter((r) => r.strictTyped).flatMap((r) => r.typedKeys.map((k) => ({ ...r, topic: k }))), (r) => r.topic),
    textDependsOn: by(notTyped.flatMap((r) => r.dependsOn.map((k) => ({ ...r, topic: k }))), (r) => r.topic),
  };
  // Lift-feasibility (SPEC §4 / tier.ts): a trial can only rise UNCERTAIN→POSSIBLE if EVERY scoring core-category criterion is fully parsed (then
  // resolved by the profile or an answer) and nothing is unresolved or an unverified FAIL. So per trial: how many scoring core criteria are NOT
  // fully parsed ("coreBlocked")? Zero = liftable in principle; the number says how many parse repairs stand between a trial and any lift.
  const CORE_SET = new Set<string>(CORE_CATEGORIES);
  const perTrial = [...new Set(rows.map((r) => r.nct))].map((nct) => {
    const rs = rows.filter((r) => r.nct === nct && r.scoring);
    const coreBlocked = rs.filter((r) => !r.strictTyped && (r.category === null || CORE_SET.has(r.category))).length;
    const unresolved = rs.filter((r) => r.state.startsWith("unresolved")).length;
    return { nct, scoring: rs.length, coreBlocked, unresolved };
  });
  const liftFeasibility = {
    trialsWithZeroCoreBlocked: perTrial.filter((t) => t.coreBlocked === 0).length,
    coreBlockedDistribution: perTrial.reduce<Record<string, number>>((m, t) => ((m[t.coreBlocked <= 3 ? String(t.coreBlocked) : t.coreBlocked <= 8 ? "4-8" : "9+"] = (m[t.coreBlocked <= 3 ? String(t.coreBlocked) : t.coreBlocked <= 8 ? "4-8" : "9+"] ?? 0) + 1), m), {}),
    trialsWithAnyUnresolved: perTrial.filter((t) => t.unresolved > 0).length,
    smallestCoreBlocked: perTrial.map((t) => t.coreBlocked).sort((a, b) => a - b).slice(0, 8),
  };
  (summary as Record<string, unknown>).liftFeasibility = liftFeasibility;
  say(JSON.stringify(summary, null, 1));
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync("eval/reports/coverage-audit.json", JSON.stringify({ note: "Offline audit of cached parses (public registry criteria, no patient data); no model calls.", parserVersion: PARSER_VERSION, summary, notTyped: notTyped.map(({ nct, idx, type, text, state, vet, category, leafKinds, cue, topic, dependsOn }) => ({ nct, idx, type, snippet: text.replace(/\s+/g, " ").slice(0, 140), state, vet, category, leafKinds, cue, topic, dependsOn })) }, null, 1) + "\n");
  say("wrote eval/reports/coverage-audit.json");
}
main().then(() => process.exit(0), (e: unknown) => { console.error(`coverage-audit stopped: ${(e as Error)?.message?.slice(0, 200) ?? "unknown"}`); process.exit(1); });
