// Offline eval harness types (Phase 3). No LLM client import anywhere in eval/lib (enforced by a test).
import { z } from "zod";
import { StatusSchema, type Status } from "../../src/schema/criteria";

/** Gold label in the ENGINE's finding terms: what a correct evaluator should answer for this criterion and patient (type already applied: for an
 *  exclusion criterion, PASS = the patient is not excluded, FAIL = the patient is excluded). NOT_APPLICABLE cases are reported but not scored. */
export const GoldSchema = z.enum(["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"]);
export type Gold = z.infer<typeof GoldSchema>;

export const EvalCriterionCaseSchema = z.object({
  caseId: z.string().min(1),
  patientId: z.string().min(1),
  trialId: z.string().min(1),
  criterionId: z.string().min(1),
  type: z.enum(["inclusion", "exclusion"]),
  /** original criterion text; never written to reports */
  text: z.string(),
  gold: GoldSchema,
  /** where the label comes from; decides how a report is labelled */
  source: z.enum(["criterion_annotations", "abstention_set", "fixture"]),
});
export type EvalCriterionCase = z.infer<typeof EvalCriterionCaseSchema>;

/** Ablation switches (SPEC §7). They are RECORDED in every result; the harness itself never calls a model. */
export const AblationSwitchesSchema = z.strictObject({
  evaluator: z.enum(["hybrid", "pure_llm"]),
  tier: z.enum(["FAST", "MID", "DEEP"]),
  routing: z.boolean(),
  verifier: z.boolean(),
});
export type AblationSwitches = z.infer<typeof AblationSwitchesSchema>;

export { StatusSchema };
export type { Status };

/** Engine-side tiers after Policy R2 (STRONG and LIKELY_MISMATCH are never emitted). */
export type EvalTier = "POSSIBLE" | "UNCERTAIN";
/** SIGIR 2016 trial-level relevance label (0 would not refer, 1 would consider, 2 would refer). */
export type SigirLabel = 0 | 1 | 2;
