// Test-only helpers (fictional data).
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";
import type { Fact, PatientProfile } from "@/schema/profile";
import type { LlmClauseCriterion, LlmLeaf } from "@/schema/clause";

export function profile(known: Partial<Record<FactKey, string | number | boolean>> = {}): PatientProfile {
  const facts = Object.fromEntries(
    FACT_KEYS.map((k): [FactKey, Fact] => [k, k in known ? { key: k, state: "known", value: known[k] as string | number | boolean } : { key: k, state: "unknown" }]),
  ) as Record<FactKey, Fact>;
  return { facts };
}

export const atom = (source: string, fact_key: FactKey, operator: LlmLeaf["operator"], value: LlmLeaf["value"], unit: string | null = null): LlmLeaf => ({
  kind: "atom", source, fact_key, operator, value, unit, depends_on: [], relation: null, amount: null, time_unit: null,
});
export const text = (source: string, depends_on: FactKey[] = []): LlmLeaf => ({
  kind: "text", source, fact_key: null, operator: null, value: null, unit: null, depends_on, relation: null, amount: null, time_unit: null,
});
export const timing = (source: string, relation: "within_last" | "not_within_last", amount: number, time_unit: "days" | "weeks" | "months"): LlmLeaf => ({
  kind: "timing", source, fact_key: null, operator: null, value: null, unit: null, depends_on: [], relation, amount, time_unit,
});
export const crit = (items: LlmLeaf[], opts: Partial<Pick<LlmClauseCriterion, "combine" | "except" | "category" | "scoring">> = {}): LlmClauseCriterion => ({
  category: opts.category ?? "other", scoring: opts.scoring ?? true, combine: opts.combine ?? "all", items, except: opts.except ?? [],
});
