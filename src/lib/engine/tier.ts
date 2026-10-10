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
 * Policy R2 (approved): every fact is the visitor's own statement and nothing in TrialLens verifies any of them, whether the model
 * extracted it from text, the visitor typed it, edited it or answered a question. So the engine's two high claims are never made:
 *   STRONG          → POSSIBLE   (flag `reported_only`)
 *   LIKELY_MISMATCH → UNCERTAIN  (flag `reported_conflict`)
 * POSSIBLE and UNCERTAIN pass through. The ceiling only lowers a claim and is idempotent. Rule D, the abstention guard, the call cap and
 * "overflow ⇒ UNCERTAIN" are untouched. A `fail_check: "verified"` finding means the criterion comparison was independently re-checked
 * against the reported facts; it never means the facts themselves were verified.
 */
export type CeilingFlag = "reported_only" | "reported_conflict";
export function ceilingTier(tier: Tier): { tier: Tier; flag?: CeilingFlag } {
  if (tier === "STRONG") return { tier: "POSSIBLE", flag: "reported_only" };
  if (tier === "LIKELY_MISMATCH") return { tier: "UNCERTAIN", flag: "reported_conflict" };
  return { tier };
}

/** `tierTrial` followed by the R2 ceiling: the only tier function the pipeline uses. */
export function tierTrialCeiled(criteria: readonly TierCriterion[], opts: TierOptions): { tier: Tier; flag?: CeilingFlag } {
  return ceilingTier(tierTrial(criteria, opts));
}
