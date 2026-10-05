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
  // SCHEMA.md §2 types this `unit?: string`, but §3 says the parser sets `unit: null`
  // for ambiguous/missing units. Accept both. VERIFY: settle in Phase 2 parser work.
  unit: z.string().nullable().optional(),
  depends_on: z.array(FactKeySchema), // for free-text criteria
  scoring: z.boolean(), // false for consent_logistics
});
export type ParsedCriterion = z.infer<typeof ParsedCriterionSchema>;

export const StatusSchema = z.enum(["PASS", "FAIL", "UNKNOWN", "AMBIGUOUS"]);
export type Status = z.infer<typeof StatusSchema>;

export const CriterionFindingSchema = z.object({
  criterion_id: z.string().min(1),
  status: StatusSchema,
  evidence: z.array(z.string()), // fact keys; required for PASS/FAIL (abstention guard enforces in code)
  rationale: z.string(), // 1–2 sentences, patient-safe wording
  source: z.enum(["code", "llm_mid", "llm_deep"]),
  guard_downgraded: z.boolean().optional(),
});
export type CriterionFinding = z.infer<typeof CriterionFindingSchema>;
