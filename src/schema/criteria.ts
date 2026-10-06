import { z } from "zod";
import { FactKeySchema } from "./vocabulary";

export const OperatorSchema = z.enum(["eq", "neq", "gte", "lte", "gt", "lt", "in", "not_in"]);
export type Operator = z.infer<typeof OperatorSchema>;

export const CORE_CATEGORIES = [
  "diagnosis",
  "stage",
  "biomarker",
  "prior_therapy",
  "disease_setting",
] as const;

export const CategorySchema = z.enum([
  ...CORE_CATEGORIES,
  "performance",
  "lab",
  "organ_function",
  "comorbidity",
  "demographic",
  "washout_timing",
  "consent_logistics",
  "other",
]);
export type Category = z.infer<typeof CategorySchema>;

export const CriterionTypeSchema = z.enum(["inclusion", "exclusion"]);

export const ParsedCriterionSchema = z.object({
  id: z.string().min(1), // `${nct_id}:${inclusion|exclusion}:${index}`
  nct_id: z.string().min(1),
  type: CriterionTypeSchema,
  category: CategorySchema,
  original_text: z.string().min(1), // verbatim, never altered
  fact_key: FactKeySchema.nullable(), // null => free-text / LLM path
  operator: OperatorSchema.optional(),
  value: z
    .union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))])
    .optional(),
  // string | null; null = unit absent or ambiguous in the source, so the evaluator
  // returns UNKNOWN (SCHEMA.md §3). Absent from parser output defaults to null.
  unit: z.string().nullable().default(null),
  depends_on: z.array(FactKeySchema), // for free-text criteria
  scoring: z.boolean(), // false for consent_logistics
});
export type ParsedCriterion = z.infer<typeof ParsedCriterionSchema>;

export const StatusSchema = z.enum(["PASS", "FAIL", "UNKNOWN", "AMBIGUOUS"]);
export type Status = z.infer<typeof StatusSchema>;

/** Independent check of a FAIL (rule D). Only `verified` may make a trial LIKELY_MISMATCH.
 * rejected: verifier says the patient is not clearly blocked · unsubstantiated: verifier could not cite the criterion
 * fragment and the patient facts (or the citation failed code checks) · no_capacity: no verification slot · not_run. */
export const FailCheckSchema = z.enum(["verified", "rejected", "unsubstantiated", "no_capacity", "not_run"]);
export type FailCheck = z.infer<typeof FailCheckSchema>;

/** Per-block applicability of a conditional criterion, with the KNOWN facts that prove it (rule: no proof, no vacuous PASS). */
export const BlockApplicabilitySchema = z.object({
  block: z.number().int().nonnegative(),
  state: z.enum(["applies", "not_applicable", "unknown"]),
  evidence: z.array(z.string()), // fact keys (known in the profile) that decided `state`
});
export type BlockApplicability = z.infer<typeof BlockApplicabilitySchema>;

export const CriterionFindingSchema = z.object({
  criterion_id: z.string().min(1),
  status: StatusSchema,
  evidence: z.array(z.string()), // fact keys; required for PASS/FAIL (abstention guard enforces in code)
  rationale: z.string(), // 1–2 sentences, patient-safe wording
  source: z.enum(["code", "llm_mid", "llm_deep"]),
  guard_downgraded: z.boolean().optional(),
  fail_check: FailCheckSchema.optional(), // meaningful only when status === "FAIL"; absent ⇒ not_run
  applicability: z.array(BlockApplicabilitySchema).optional(), // one entry per block of a parsed criterion
});
export type CriterionFinding = z.infer<typeof CriterionFindingSchema>;

// What the parser LLM returns per criterion. id/nct_id/type/original_text are attached
// in code so the original text can never be altered by the model.
// All fields required (nullable) so the shape works with strict JSON-schema output.
export const LlmCriterionSchema = z
  .object({
    category: CategorySchema,
    fact_key: FactKeySchema.nullable(),
    operator: OperatorSchema.nullable(),
    value: z
      .union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))])
      .nullable(),
    unit: z.string().nullable(),
    depends_on: z.array(FactKeySchema),
    scoring: z.boolean(),
  })
  .superRefine((c, ctx) => {
    const typed = c.fact_key !== null;
    if (typed && (c.operator === null || c.value === null)) {
      ctx.addIssue({ code: "custom", message: "fact_key set requires operator and value" });
    }
    if (!typed && (c.operator !== null || c.value !== null)) {
      ctx.addIssue({ code: "custom", message: "operator/value must be null when fact_key is null" });
    }
  });
export type LlmCriterion = z.infer<typeof LlmCriterionSchema>;

export const LlmCriteriaBatchSchema = z.object({
  criteria: z.array(z.object({ index: z.number().int().nonnegative() }).and(LlmCriterionSchema)),
});
