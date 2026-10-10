// Join parser output back to the ORIGINAL criteria. Every original criterion yields exactly one
// outcome, in order. A criterion the parser did not (validly) return is `unresolved` and becomes
// UNKNOWN downstream. Nothing is dropped, nothing is invented.
import type { Category, CriterionFinding } from "@/schema/criteria";
import type { ClauseNode, LlmClauseBatch, ParseCompleteness } from "@/schema/clause";
import type { PatientProfile } from "@/schema/profile";
import { checkIndices } from "./checks";
import { blockNodes, classifyCompleteness, evaluateClause, statusFromTruth, toClauseTree } from "./clause";
import { vetCriterion, type VetStatus } from "./coverage";

export interface SourceCriterion {
  id: string; // `${nct_id}:${inclusion|exclusion}:${index}`
  nct_id: string;
  type: "inclusion" | "exclusion";
  text: string; // verbatim; never altered
}

export type UnresolvedReason = "batch_rejected" | "missing" | "not_attempted";

export type ParseOutcome =
  | {
      state: "parsed";
      category: Category;
      scoring: boolean;
      clause: ClauseNode;
      completeness: Exclude<ParseCompleteness, "unresolved">;
      /** what the coverage/scope vetting did to the parser output (ok | atoms_downgraded | coverage_failed | when_on_exclusion) */
      vet: VetStatus;
    }
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
    // Prove that every requirement and its logical scope survived; otherwise the whole criterion becomes one text leaf.
    const vetted = vetCriterion(sources[i]!.text, sources[i]!.type, c);
    const clause = toClauseTree(vetted.criterion);
    const completeness = classifyCompleteness(clause);
    return {
      state: "parsed",
      category: vetted.criterion.category,
      scoring: vetted.criterion.category !== "consent_logistics",
      clause,
      completeness: completeness === "full" ? "full" : "partial",
      vet: vetted.status,
    };
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
  const { truth, evidence, blocks } = evaluateClause(outcome.clause, profile);
  const status = statusFromTruth(src.type, truth);
  const conditional = blockNodes(outcome.clause).some((b) => b.kind === "if");
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
      ...(conditional ? { applicability: blocks.map((b, i) => ({ block: i, state: b.applicability, evidence: b.evidence })) } : {}),
    },
  };
}
