// Tiering (SPEC.md §4) with conservative parse-completeness rules. Pure; no LLM.
//
// Evaluation order:
//  1. any scoring FAIL that is VERIFIED (independent, evidence-backed check) → LIKELY_MISMATCH
//  2. any other scoring FAIL (unverified: not run / no capacity / rejected / unsubstantiated),
//     analysis failed, nothing scorable, scoring criteria missing,
//     or any scoring criterion UNRESOLVED (no parse)           → UNCERTAIN  (rule D)
//  3. any core-category criterion UNKNOWN/AMBIGUOUS or only PARTIALLY parsed → UNCERTAIN
//  4. any non-core criterion only PARTIALLY parsed, or UNKNOWN+AMBIGUOUS > N → POSSIBLE
//  5. otherwise                                                → STRONG
// A trial can therefore never be STRONG while a scoring criterion is missing, partially parsed or unresolved.
import { CORE_CATEGORIES, type Category, type Status } from "@/schema/criteria";
import type { ParseCompleteness } from "@/schema/clause";
import type { Tier } from "@/schema/assessment";
import type { FailCheck } from "@/schema/criteria";

export interface TierCriterion {
  scoring: boolean;
  category: Category | null; // null = unresolved
  status: Status;
  completeness: ParseCompleteness;
  /** Only meaningful for FAIL. Absent ⇒ not_run ⇒ the FAIL cannot make the trial LIKELY_MISMATCH. */
  failCheck?: FailCheck;
  /** True when a fact this finding cites was edited, added or answered by the visitor (server-derived basis, never a client label). */
  editedEvidence?: boolean;
}

export interface TierOptions {
  unknownThreshold: number; // N (TIER_UNKNOWN_THRESHOLD)
  /** Number of scoring-eligible criteria the trial's source text contained; fewer inputs ⇒ some went missing. */
  expectedCriteria?: number;
  analysisFailed?: boolean;
}

const CORE = new Set<Category>(CORE_CATEGORIES);

export function tierTrial(criteria: readonly TierCriterion[], opts: TierOptions): Tier {
  const scoring = criteria.filter((c) => c.scoring);
  if (scoring.some((c) => c.status === "FAIL" && c.failCheck === "verified")) return "LIKELY_MISMATCH";
  if (scoring.some((c) => c.status === "FAIL")) return "UNCERTAIN"; // unverified FAIL stays UNCERTAIN

  const missing = opts.expectedCriteria !== undefined && criteria.length < opts.expectedCriteria;
  if (opts.analysisFailed || missing || scoring.length === 0) return "UNCERTAIN";
  if (scoring.some((c) => c.completeness === "unresolved")) return "UNCERTAIN";

  const isCore = (c: TierCriterion) => c.category !== null && CORE.has(c.category);
  if (scoring.some((c) => isCore(c) && (c.status === "UNKNOWN" || c.status === "AMBIGUOUS" || c.completeness !== "full"))) {
    return "UNCERTAIN";
  }

  const open = scoring.filter((c) => c.status === "UNKNOWN" || c.status === "AMBIGUOUS").length;
  if (scoring.some((c) => c.completeness !== "full") || open > opts.unknownThreshold) return "POSSIBLE";
  return "STRONG";
}

/**
 * Policy R (self-report ceiling): a trial whose PASS rests on a visitor-edited fact is never STRONG, and a verified FAIL that
 * rests only on visitor-edited facts never makes LIKELY_MISMATCH. The cap only lowers a claim; Rule D, the abstention guard and
 * every UNCERTAIN rule above are untouched, so it can never raise a tier.
 */
export function tierTrialCapped(criteria: readonly TierCriterion[], opts: TierOptions): { tier: Tier; capped: boolean } {
  const tier = tierTrial(criteria, opts);
  const scoring = criteria.filter((c) => c.scoring);
  if (tier === "LIKELY_MISMATCH" && !scoring.some((c) => c.status === "FAIL" && c.failCheck === "verified" && !c.editedEvidence)) {
    return { tier: "UNCERTAIN", capped: true };
  }
  if (tier === "STRONG" && scoring.some((c) => c.status === "PASS" && c.editedEvidence)) return { tier: "POSSIBLE", capped: true };
  return { tier, capped: false };
}
