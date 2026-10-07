// Test-only fictional trial results.
import type { TrialResult } from "@/schema/assessment";

export const crit = (id: string, text: string, type: "inclusion" | "exclusion" = "inclusion") => ({ id, type, text, category: "other", completeness: "full" as const });
export const finding = (criterion_id: string, status: "PASS" | "FAIL" | "UNKNOWN" | "AMBIGUOUS", evidence: string[] = [], source: "code" | "llm_mid" = "code", rationale = "") => ({ criterion_id, status, evidence, rationale, source });

export const LONG = "Individuals who have previously undergone genetic testing for one or more of the following genes: BRCA1, BRCA2, PALB2, RAD51C, RAD51D, BRIP1, MLH1, MSH2, MSH6 and others";

export function trial(over: Partial<TrialResult> & { nct_id: string }): TrialResult {
  return { title: "Fictional trial " + over.nct_id, tier: "UNCERTAIN", findings: [], verified: false, verifier_flags: [], sites: [], coordinator_questions: [], url: `https://clinicaltrials.gov/study/${over.nct_id}`, criteria: [], ...over };
}

export const assessedPossible = trial({
  nct_id: "NCT00000001", tier: "POSSIBLE", verified: true,
  criteria: [crit("a", "Women 18 years or older"), crit("b", LONG), crit("c", "ECOG performance status 0 or 1")],
  findings: [finding("a", "PASS", ["age"]), finding("b", "UNKNOWN", [], "llm_mid", "No data on prior genetic testing"), finding("c", "UNKNOWN")],
});
export const noMet = trial({ nct_id: "NCT00000002", tier: "UNCERTAIN", criteria: [crit("a", "ECOG 0 or 1")], findings: [finding("a", "UNKNOWN")] });
export const pending = trial({ nct_id: "NCT00000003", verifier_flags: ["analysis_pending"], criteria: [crit("a", "Recently diagnosed with stage II, III, or IV breast cancer"), crit("b", "Must be >= 18 years of age")] });
export const failed = trial({ nct_id: "NCT00000004", analysis_failed: true, criteria: [crit("a", "Histologically confirmed breast cancer")] });
// LEGACY: a stored pre-R2 value. The engine and replays no longer emit it; kept so the UI's handling of old stored results stays tested.
export const mismatch = trial({ nct_id: "NCT00000005", tier: "LIKELY_MISMATCH", verified: true, criteria: [crit("a", "Age 65 years or older")], findings: [finding("a", "FAIL", ["age"])] });

// Policy R2 results as they are emitted now. `reported_conflict` and `reported_only` are internal flags: nothing renders them.
export const reportedConflict = trial({
  nct_id: "NCT00000006", tier: "UNCERTAIN", verified: false, verifier_flags: ["reported_conflict"], fact_basis: "visitor_reported",
  criteria: [crit("a", "Age 65 years or older")], findings: [{ ...finding("a", "FAIL", ["age"]), fail_check: "verified" as const }],
});
export const reportedOnly = trial({
  nct_id: "NCT00000007", tier: "POSSIBLE", verified: true, verifier_flags: ["reported_only"], fact_basis: "visitor_reported",
  criteria: [crit("a", "Women 18 years or older")], findings: [finding("a", "PASS", ["age"])],
});
