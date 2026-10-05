// Tiering (SPEC.md §4) with conservative parse-completeness rules. Pure; no LLM.
//
// Evaluation order:
//  1. any scoring FAIL                                         → LIKELY_MISMATCH
//  2. analysis failed, nothing scorable, scoring criteria missing,
//     or any scoring criterion UNRESOLVED (no parse)           → UNCERTAIN
//  3. any core-category criterion UNKNOWN/AMBIGUOUS or only PARTIALLY parsed → UNCERTAIN
//  4. any non-core criterion only PARTIALLY parsed, or UNKNOWN+AMBIGUOUS > N → POSSIBLE
//  5. otherwise                                                → STRONG
// A trial can therefore never be STRONG while a scoring criterion is missing, partially parsed or unresolved.
import { CORE_CATEGORIES, type Category, type Status } from "@/schema/criteria";
import type { ParseCompleteness } from "@/schema/clause";
import type { Tier } from "@/schema/assessment";

export interface TierCriterion {
  scoring: boolean;
  category: Category | null; // null = unresolved
  status: Status;
  completeness: ParseCompleteness;
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
  if (scoring.some((c) => c.status === "FAIL")) return "LIKELY_MISMATCH";

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
