// Abstention guard (CLAUDE.md rule 3): a PASS/FAIL finding must cite evidence fact keys that exist
// in the profile as `known` (with a value). Otherwise it is coerced to UNKNOWN and counted as an
// `unsupported_assumption`.
import type { CriterionFinding } from "@/schema/criteria";
import type { PatientProfile } from "@/schema/profile";
import { FACT_KEYS } from "@/schema/vocabulary";

const isFactKey = (k: string): boolean => (FACT_KEYS as readonly string[]).includes(k);

export function applyAbstentionGuard(
  finding: CriterionFinding,
  profile: PatientProfile,
): { finding: CriterionFinding; downgraded: boolean } {
  if (finding.status !== "PASS" && finding.status !== "FAIL") return { finding, downgraded: false };
  // Vacuous PASS rule: a block may be `not_applicable` only with cited evidence that is KNOWN in the profile.
  const knownKey = (k: string) => {
    if (!isFactKey(k)) return false;
    const f = profile.facts[k as keyof PatientProfile["facts"]];
    return !!f && f.state === "known" && f.value !== undefined;
  };
  const unprovenVacuous = (finding.applicability ?? []).some((b) => b.state === "not_applicable" && (b.evidence.length === 0 || !b.evidence.every(knownKey)));
  if (unprovenVacuous) {
    return {
      finding: { ...finding, status: "UNKNOWN", evidence: [], rationale: "Not enough confirmed information to decide.", guard_downgraded: true },
      downgraded: true,
    };
  }
  const supported =
    finding.evidence.length > 0 &&
    finding.evidence.every((k) => {
      if (!isFactKey(k)) return false;
      const f = profile.facts[k as keyof PatientProfile["facts"]];
      return !!f && f.state === "known" && f.value !== undefined;
    });
  if (supported) return { finding, downgraded: false };
  return {
    finding: {
      ...finding,
      status: "UNKNOWN",
      evidence: [],
      rationale: "Not enough confirmed information to decide.",
      guard_downgraded: true,
    },
    downgraded: true,
  };
}
