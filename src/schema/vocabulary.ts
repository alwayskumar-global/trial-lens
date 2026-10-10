// Fact vocabulary v0 — source of truth: SCHEMA.md §1.
// ask_cost: 1 easy · 2 needs a record · 3 needs a recent lab/test. null when not askable.
import { z } from "zod";

export const FACT_TYPES = ["number", "enum", "bool"] as const;
export type FactType = (typeof FACT_TYPES)[number];

export const ASK_COSTS = [1, 2, 3] as const;
export type AskCost = (typeof ASK_COSTS)[number];

export interface VocabularyEntry {
  readonly key: string;
  readonly pack: "core" | "breast";
  readonly type: FactType;
  readonly unit?: string;
  readonly values?: readonly string[];
  readonly askable: boolean;
  readonly ask_cost: AskCost | null;
}

export const VOCABULARY = [
  // Core pack
  { key: "age", pack: "core", type: "number", unit: "years", askable: false, ask_cost: null },
  { key: "sex", pack: "core", type: "enum", values: ["female", "male", "other"], askable: false, ask_cost: null },
  // Substage (e.g. "IIIA") is carried in Fact.note, not the enum. VERIFY in Phase 1 coverage run.
  { key: "stage", pack: "core", type: "enum", values: ["0", "I", "II", "III", "IV"], askable: true, ask_cost: 1 },
  { key: "disease_setting", pack: "core", type: "enum", values: ["early", "locally_advanced", "metastatic"], askable: true, ask_cost: 1 },
  { key: "ecog", pack: "core", type: "enum", values: ["0", "1", "2", "3", "4"], askable: true, ask_cost: 2 },
  { key: "pregnant", pack: "core", type: "bool", askable: true, ask_cost: 1 },
  { key: "lactating", pack: "core", type: "bool", askable: true, ask_cost: 1 },
  { key: "lvef_percent", pack: "core", type: "number", unit: "%", askable: true, ask_cost: 3 },
  { key: "anc", pack: "core", type: "number", unit: "10^9/L", askable: true, ask_cost: 3 },
  { key: "platelets", pack: "core", type: "number", unit: "10^9/L", askable: true, ask_cost: 3 },
  { key: "hemoglobin", pack: "core", type: "number", unit: "g/dL", askable: true, ask_cost: 3 },
  { key: "creatinine_clearance", pack: "core", type: "number", unit: "mL/min", askable: true, ask_cost: 3 },
  { key: "bilirubin_x_uln", pack: "core", type: "number", unit: "xULN", askable: true, ask_cost: 3 },
  { key: "ast_alt_x_uln", pack: "core", type: "number", unit: "xULN", askable: true, ask_cost: 3 },
  { key: "cardiac_disease", pack: "core", type: "enum", values: ["none", "history", "active"], askable: true, ask_cost: 2 },
  { key: "prior_other_malignancy", pack: "core", type: "bool", askable: true, ask_cost: 1 },
  { key: "neuropathy_grade", pack: "core", type: "enum", values: ["0", "1", "2", "3", "4"], askable: true, ask_cost: 2 },
  { key: "cns_mets", pack: "core", type: "enum", values: ["none", "treated_stable", "active"], askable: true, ask_cost: 2 },
  { key: "measurable_disease", pack: "core", type: "bool", askable: true, ask_cost: 2 },
  // Breast-oncology pack
  { key: "her2_status", pack: "breast", type: "enum", values: ["positive", "negative", "low"], askable: true, ask_cost: 1 },
  { key: "er_status", pack: "breast", type: "enum", values: ["positive", "negative"], askable: true, ask_cost: 1 },
  { key: "pr_status", pack: "breast", type: "enum", values: ["positive", "negative"], askable: true, ask_cost: 1 },
  { key: "brca_germline", pack: "breast", type: "enum", values: ["positive", "negative"], askable: true, ask_cost: 2 },
  { key: "pik3ca_mutation", pack: "breast", type: "bool", askable: true, ask_cost: 2 },
  { key: "menopausal_status", pack: "breast", type: "enum", values: ["pre", "peri", "post"], askable: true, ask_cost: 1 },
  { key: "metastatic_line", pack: "breast", type: "number", unit: "line", askable: true, ask_cost: 2 },
  { key: "prior_anthracycline", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_taxane", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_trastuzumab", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_adc", pack: "breast", type: "bool", askable: true, ask_cost: 2 },
  { key: "prior_cdk46i", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_endocrine", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_chemo_any", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "prior_radiation", pack: "breast", type: "bool", askable: true, ask_cost: 1 },
  { key: "days_since_last_systemic_therapy", pack: "breast", type: "number", unit: "days", askable: true, ask_cost: 2 },
] as const satisfies readonly VocabularyEntry[];

export type FactKey = (typeof VOCABULARY)[number]["key"];

export const FACT_KEYS = VOCABULARY.map((e) => e.key) as [FactKey, ...FactKey[]];
export const FactKeySchema = z.enum(FACT_KEYS);

// Derived (computed in code, never asked): tnbc = er=negative ∧ pr=negative ∧ her2=negative.
