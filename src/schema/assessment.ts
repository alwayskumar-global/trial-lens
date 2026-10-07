import { z } from "zod";
import { CriterionFindingSchema } from "./criteria";
import { FactKeySchema } from "./vocabulary";

// STRONG and LIKELY_MISMATCH stay valid values so stored legacy replays still parse. Policy R2 (tier.ts) means they are never emitted.
export const TierSchema = z.enum(["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"]);
export type Tier = z.infer<typeof TierSchema>;

export const TrialAssessmentSchema = z.object({
  nct_id: z.string().min(1),
  title: z.string(),
  tier: TierSchema,
  findings: z.array(CriterionFindingSchema),
  /**
   * A second automated pass found no conflict between the criteria and the reported facts. It never means the facts themselves were
   * verified, and it is always false for a result carrying the internal `reported_conflict` flag.
   */
  verified: z.boolean(),
  /** Fixed strings (analysis_pending, unverified_budget, verification_failed, verifier_disagreement, reported_only, reported_conflict). Internal; never shown to a visitor as text. */
  verifier_flags: z.array(z.string()),
  /** Every fact behind a result is the visitor's own statement (Policy R2). Optional only so stored legacy replays still validate; always set on emitted results. */
  fact_basis: z.literal("visitor_reported").optional(),
  sites: z.array(
    z.object({
      facility: z.string(),
      city: z.string().optional(),
      distance_miles: z.number().nonnegative().optional(),
    }),
  ),
  coordinator_questions: z.array(z.string()),
  analysis_failed: z.boolean().optional(),
});
export type TrialAssessment = z.infer<typeof TrialAssessmentSchema>;

/** Criterion as shown to the patient: original text is verbatim from ClinicalTrials.gov and never altered. */
export const CriterionViewSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["inclusion", "exclusion"]),
  text: z.string(), // original criterion text, verbatim
  category: z.string().nullable(), // null when the parse is unresolved
  completeness: z.enum(["full", "partial", "unresolved"]),
});
export type CriterionView = z.infer<typeof CriterionViewSchema>;

/** Trial result streamed to the client: assessment + official link + original criteria. */
export const TrialResultSchema = TrialAssessmentSchema.extend({
  url: z.string().nullable().optional(), // https://clinicaltrials.gov/study/<NCT>, null when the id is malformed
  criteria: z.array(CriterionViewSchema).optional(),
  top_unknown: z.string().nullable().optional(), // criterion id of the first open scoring criterion
});
export type TrialResult = z.infer<typeof TrialResultSchema>;

export const AdaptiveQuestionSchema = z.object({
  fact_key: FactKeySchema,
  prompt: z.string().min(1), // patient-friendly
  answers: z.array(z.object({ label: z.string().min(1), value: z.unknown() })), // incl. "I don't know"
  affects_trials: z.number().int().nonnegative(),
  score: z.number(),
});
export type AdaptiveQuestion = z.infer<typeof AdaptiveQuestionSchema>;
