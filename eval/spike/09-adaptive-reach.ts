// Phase 1 repair: how much could an adaptive question engine reach on this cohort? (no LLM calls)
// Reads fixtures/coverage-v2-low.json (copy of the final reasoning=low coverage run).
// A trial is "reached" by a fact when ≥1 of its criteria has an ATOM leaf on that fact (any parse
// completeness, since Kleene short-circuiting can still decide through partial trees), and "reached
// (reviewed)" when that atom is in a criterion that is code-evaluable AND judged full-logic.
import { readFileSync } from "node:fs";
import { leaves } from "../../src/lib/engine/clause";
import type { ParseOutcome } from "../../src/lib/engine/reconcile";
import { VOCABULARY } from "../../src/schema/vocabulary";
import { appendResults, FIXTURE_PATH } from "./lib";

interface Row { id: string; type: string; outcome: ParseOutcome; verdict: string }
const rows: Row[] = JSON.parse(readFileSync(FIXTURE_PATH.replace("ctgov-breast.json", "coverage-v2-low.json"), "utf8"));
const trials = new Set(rows.map((r) => r.id.split(":")[0]!));
const any = new Map<string, Set<string>>(), rev = new Map<string, Set<string>>();
for (const r of rows) {
  if (r.outcome.state !== "parsed" || !r.outcome.scoring) continue;
  const nct = r.id.split(":")[0]!;
  for (const l of leaves(r.outcome.clause)) {
    if (l.kind !== "atom") continue;
    (any.get(l.fact_key) ?? any.set(l.fact_key, new Set()).get(l.fact_key)!).add(nct);
    if (r.outcome.completeness === "full" && r.verdict === "full") (rev.get(l.fact_key) ?? rev.set(l.fact_key, new Set()).get(l.fact_key)!).add(nct);
  }
}
const askable = new Set(VOCABULARY.filter((v) => v.askable).map((v) => v.key as string));
const list = [...any].map(([k, s]) => ({ k, a: s.size, r: rev.get(k)?.size ?? 0, askable: askable.has(k) })).sort((x, y) => y.a - x.a);
const trialsWithAskable = new Set<string>(); const trialsWithAskableRev = new Set<string>();
for (const [k, s] of any) if (askable.has(k)) s.forEach((t) => trialsWithAskable.add(t));
for (const [k, s] of rev) if (askable.has(k)) s.forEach((t) => trialsWithAskableRev.add(t));
const md = [
  `\n## ${new Date().toISOString()} — 09-adaptive-reach (no LLM calls; final reasoning=low coverage run; ${trials.size} trials)\n`,
  `- Trials with ≥1 typed ATOM on an askable fact: ${trialsWithAskable.size}/${trials.size}; with a reviewed-full typed criterion on an askable fact: ${trialsWithAskableRev.size}/${trials.size}.`,
  "\n| fact_key | askable | trials with atom (any parse) | trials with reviewed-full typed criterion |\n|---|---|---|---|",
  ...list.slice(0, 14).map((x) => `| ${x.k} | ${x.askable ? "yes" : "no"} | ${x.a} | ${x.r} |`),
  `\n- Reading: a single typed answer reaches at most the trials listed per key. Keys not in this table were never typed in this cohort. Counts are over the SAME fixed cohort the parser was iterated on (in-sample).`,
].join("\n");
appendResults(md + "\n");
console.log(md);
