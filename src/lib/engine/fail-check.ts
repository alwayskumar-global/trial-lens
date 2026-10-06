// Rule D (approved): an unverified FAIL stays UNCERTAIN; only an independently checked, evidence-backed
// FAIL can make a trial LIKELY_MISMATCH. A verifier that lacks capacity, or cannot substantiate BOTH the
// source criterion fragment and the patient fact(s), yields `unsubstantiated`/`no_capacity` ⇒ UNCERTAIN.
// Pure: the LLM call lives outside; this module decides what the verdict is worth.
import type { CriterionFinding, FailCheck } from "@/schema/criteria";
import type { FailCheckItem } from "@/schema/fail-check";
import type { PatientProfile } from "@/schema/profile";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";
import { isSourceFragment } from "./checks";

export type SubstantiationProblem = "quote_not_in_criterion" | "no_facts" | "fact_not_known" | "fact_value_mismatch";

/** Code-side check that a `confirmed` verdict is evidence-backed. Returns null when it is. */
export function substantiationProblem(criterionText: string, item: FailCheckItem, profile: PatientProfile): SubstantiationProblem | null {
  if (item.source_quote === null || !isSourceFragment(criterionText, item.source_quote)) return "quote_not_in_criterion";
  if (item.facts_used.length === 0) return "no_facts";
  for (const f of item.facts_used) {
    if (!(FACT_KEYS as readonly string[]).includes(f.key)) return "fact_not_known";
    const fact = profile.facts[f.key as FactKey];
    if (!fact || fact.state !== "known" || fact.value === undefined) return "fact_not_known";
    const same = typeof fact.value === "number" ? Number(f.value) === fact.value : String(f.value) === String(fact.value);
    if (!same) return "fact_value_mismatch";
  }
  return null;
}

/** Resolve one FAIL finding's check state from a verifier item (or its absence). */
export function resolveFailCheck(
  criterionText: string,
  item: FailCheckItem | "no_capacity" | "not_run" | undefined,
  profile: PatientProfile,
): FailCheck {
  if (item === undefined || item === "not_run") return "not_run";
  if (item === "no_capacity") return "no_capacity";
  if (item.verdict === "not_confirmed") return "rejected";
  if (item.verdict === "cannot_substantiate") return "unsubstantiated";
  return substantiationProblem(criterionText, item, profile) === null ? "verified" : "unsubstantiated";
}

export function withFailCheck(finding: CriterionFinding, check: FailCheck): CriterionFinding {
  return finding.status === "FAIL" ? { ...finding, fail_check: check } : finding;
}
