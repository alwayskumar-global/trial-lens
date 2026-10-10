// pnpm exec tsx eval/abstention/run-isolation.ts : guard-isolation and relevance cases vs their pre-written expectations (no model, no network). Exit 1 on any mismatch.
import { atomProblems, leaves } from "@/lib/engine/clause";
import { assessCriterion, reconcileBatch } from "@/lib/engine/reconcile";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { failClosedFinding } from "@/lib/engine/fail-closed";
import { tierTrialCeiled } from "@/lib/engine/tier";
import type { CriterionFinding } from "@/schema/criteria";
import { GUARD_CASES, RELEVANCE_CASES, type GuardIsolationCase, type RelevanceCase } from "./isolation";
import { TIER_UNKNOWN_THRESHOLD, profileFor } from "./run-case";
import type { AbstentionCase } from "./cases";

const asCase = (c: GuardIsolationCase | RelevanceCase): AbstentionCase => ({ id: c.id, group: "fact_known", layer: "typed", type: c.type, text: c.text, category: c.category, known: c.known, expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "" });

export function runGuardCase(c: GuardIsolationCase) {
  const profile = profileFor(asCase(c));
  const src = { id: `SYN-${c.id}:${c.type}:0`, nct_id: `SYN-${c.id}`, type: c.type, text: c.text };
  const o = reconcileBatch([src], { criteria: [{ index: 0, ...c.parse }] } as never)[0]!;
  if (o.state !== "parsed") return { vet: `unresolved:${o.reason}`, leafKind: "none", problems: [] as string[], completeness: "unresolved", status: "?", evidence: [] as string[] };
  const leaf = leaves(o.clause)[0]!;
  const a = assessCriterion(src, o, profile);
  const f = applyAbstentionGuard(a.finding, profile).finding;
  return { vet: o.vet, leafKind: leaf.kind, problems: leaf.kind === "atom" ? atomProblems(leaf) : [], completeness: o.completeness, status: f.status, evidence: f.evidence };
}

export function runRelevanceCase(c: RelevanceCase) {
  const profile = profileFor(asCase(c));
  const src = { id: `SYN-${c.id}:${c.type}:0`, nct_id: `SYN-${c.id}`, type: c.type, text: c.text };
  const o = reconcileBatch([src], { criteria: [{ index: 0, ...c.parse }] } as never)[0]!;
  if (o.state !== "parsed") throw new Error("fixture must parse");
  // the PRODUCTION path for a free-text finding: abstention guard, then the fail-closed rule
  const guarded = applyAbstentionGuard({ criterion_id: `SYN-${c.id}`, status: c.finding.status, evidence: c.finding.evidence, rationale: "fixture", source: "llm_mid" } as CriterionFinding, profile).finding;
  const f = failClosedFinding(guarded, o.clause, c.type, profile);
  const t = tierTrialCeiled([{ scoring: true, category: c.category, status: f.status, completeness: o.completeness, failCheck: undefined }], { unknownThreshold: TIER_UNKNOWN_THRESHOLD, expectedCriteria: 1 });
  return { status: f.status, tier: t.tier };
}

if (process.argv[1]?.endsWith("run-isolation.ts")) {
  let bad = 0;
  for (const c of GUARD_CASES) {
    const a = runGuardCase(c);
    const miss = (Object.keys(c.expected) as Array<keyof typeof c.expected>).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(c.expected[k])).map((k) => `${k} expected ${JSON.stringify(c.expected[k])} got ${JSON.stringify(a[k])}`);
    if (miss.length) bad++;
    console.log(`${c.id} guard=${c.guard} ${miss.length ? "MISMATCH: " + miss.join("; ") : "match"}`);
  }
  for (const c of RELEVANCE_CASES) {
    const a = runRelevanceCase(c);
    const miss = (["status", "tier"] as const).filter((k) => a[k] !== c.expected[k]).map((k) => `${k} expected ${c.expected[k]} got ${a[k]}`);
    if (miss.length) bad++;
    console.log(`${c.id} relevance ${miss.length ? "MISMATCH: " + miss.join("; ") : "match"}`);
  }
  console.log(`${GUARD_CASES.length + RELEVANCE_CASES.length - bad} of ${GUARD_CASES.length + RELEVANCE_CASES.length} additional cases match; ${bad} mismatch`);
  process.exit(bad ? 1 : 0);
}
