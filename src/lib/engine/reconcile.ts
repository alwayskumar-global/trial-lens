// Join parser output back to the ORIGINAL criteria. Every original criterion yields exactly one
// outcome, in order. A criterion the parser did not (validly) return is `unresolved` and becomes
// UNKNOWN downstream. Nothing is dropped, nothing is invented.
import type { Category, CriterionFinding } from "@/schema/criteria";
import type { ClauseNode, LlmClauseBatch, ParseCompleteness } from "@/schema/clause";
import type { PatientProfile } from "@/schema/profile";
import { checkIndices } from "./checks";
import { classifyCompleteness, evaluateClause, statusFromTruth, toClauseTree } from "./clause";

export interface SourceCriterion {
  id: string; // `${nct_id}:${inclusion|exclusion}:${index}`
  nct_id: string;
  type: "inclusion" | "exclusion";
  text: string; // verbatim; never altered
}

export type UnresolvedReason = "batch_rejected" | "missing" | "not_attempted";

export type ParseOutcome =
  | { state: "parsed"; category: Category; scoring: boolean; clause: ClauseNode; completeness: Exclude<ParseCompleteness, "unresolved"> }
  | { state: "unresolved"; reason: UnresolvedReason };

/**
 * @param batch validated batch, or null when the call failed/was rejected after its one retry or was never made
 * @param whyNull reason recorded for every criterion when batch is null
 */
export function reconcileBatch(
  sources: readonly SourceCriterion[],
  batch: LlmClauseBatch | null,
  whyNull: UnresolvedReason = "batch_rejected",
): ParseOutcome[] {
  if (batch === null) return sources.map(() => ({ state: "unresolved", reason: whyNull }));
  // Defensive: the batch schema already rejects these; never trust a caller to have used it.
  if (!checkIndices(sources.length, batch.criteria.map((c) => c.index)).ok) {
    return sources.map(() => ({ state: "unresolved", reason: "batch_rejected" }));
  }
  const byIndex = new Map(batch.criteria.map((c) => [c.index, c]));
  return sources.map((_, i): ParseOutcome => {
    const c = byIndex.get(i);
    if (!c) return { state: "unresolved", reason: "missing" };
    const clause = toClauseTree(c);
    const completeness = classifyCompleteness(clause);
    return { state: "parsed", category: c.category, scoring: c.scoring, clause, completeness: completeness === "full" ? "full" : "partial" };
  });
}

export interface CriterionAssessment {
  criterion_id: string;
  category: Category | null; // null when unresolved
  scoring: boolean; // unresolved criteria are treated as scoring (conservative)
  completeness: ParseCompleteness;
  finding: CriterionFinding;
}

/** Code-side evaluation of one criterion. Text/timing leaves stay UNKNOWN here (free-text path decides later). */
export function assessCriterion(src: SourceCriterion, outcome: ParseOutcome, profile: PatientProfile): CriterionAssessment {
  if (outcome.state === "unresolved") {
    return {
      criterion_id: src.id,
      category: null,
      scoring: true,
      completeness: "unresolved",
      finding: {
        criterion_id: src.id,
        status: "UNKNOWN",
        evidence: [],
        rationale: "This criterion could not be analysed automatically. Ask the study team.",
        source: "code",
      },
    };
  }
  const { truth, evidence } = evaluateClause(outcome.clause, profile);
  const status = statusFromTruth(src.type, truth);
  return {
    criterion_id: src.id,
    category: outcome.category,
    scoring: outcome.scoring,
    completeness: outcome.completeness,
    finding: {
      criterion_id: src.id,
      status,
      evidence: status === "UNKNOWN" ? [] : evidence,
      rationale:
        status === "UNKNOWN"
          ? "Required information is not in the profile, or part of this criterion needs a closer read."
          : "Compared against the information you provided.",
      source: "code",
    },
  };
}
