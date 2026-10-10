// Isolation cases for two semantic guards and a relevance negative control (ADDITIONS to the 30-case set in cases.ts, which is unchanged).
// AUTHOR-CREATED, FICTIONAL, NOT clinician reviewed; development check only; no model call.
//
// EXPECTED VALUES BELOW WERE WRITTEN BEFORE THESE CASES WERE RUN (this file is committed first). A mismatch is reported, never "fixed" by editing the expectation.
//
// Guard isolation: the input must SURVIVE the earlier vetting (reconcileBatch -> vetCriterion: atom scope + coverage) so the atom reaches the semantic guard in
// clause.atomProblems. Each case therefore asserts, separately: (1) vet status "ok" (an earlier vetting rejection is NOT a guard pass); (2) the leaf is still an atom;
// (3) atomProblems(atom) is EXACTLY the guard's reason; then completeness "partial" and a final status UNKNOWN with no evidence. Each known fact would, without the
// guard, make the atom evaluate to a decision (see `without_guard`), so UNKNOWN is attributable to the guard.
//
// How the guards are reachable (found while building these, not assumed): natural wording cannot pass vetting for the pregnancy-test guard, because the
// vetting rejects any source word the fact's cue/value/unit does not account for ("test", "serum", "urine", "hCG"). A hyphenated source ("Pregnancy-test") is consumed
// whole by the cue match, so it survives vetting and reaches the guard. So the pregnancy-test guard is a second line of defense that is only reachable with a
// constructed source. The same holds for the source-must-mention-fact guard (all source words must be value words, e.g. "Treated stable" for cns_mets).
import type { LlmClauseCriterion } from "@/schema/clause";
import type { Category, Status } from "@/schema/criteria";
import type { Tier } from "@/schema/assessment";
import type { FactKey } from "@/schema/vocabulary";
import { atom, crit, text } from "@/lib/engine/test-helpers";

type FactVal = string | number | boolean;
export interface GuardIsolationCase {
  id: string;
  guard: "pregnancy_test_is_not_pregnancy_status" | "source_does_not_mention_fact";
  type: "inclusion" | "exclusion";
  text: string;
  category: Category;
  known: Partial<Record<FactKey, FactVal>>;
  parse: LlmClauseCriterion;
  without_guard: Status; // what the same atom would evaluate to if it were executable (documents that the known fact decides the atom)
  expected: { vet: "ok"; leafKind: "atom"; problems: string[]; completeness: "partial"; status: Status; evidence: string[] };
  rationale: string;
}

export const GUARD_CASES: GuardIsolationCase[] = [
  { id: "iso-01", guard: "pregnancy_test_is_not_pregnancy_status", type: "exclusion", category: "other", text: "Pregnancy-test",
    known: { pregnant: true }, parse: crit([atom("Pregnancy-test", "pregnant", "eq", true)], { category: "other" }), without_guard: "FAIL",
    expected: { vet: "ok", leafKind: "atom", problems: ["pregnancy_test_is_not_pregnancy_status"], completeness: "partial", status: "UNKNOWN", evidence: [] },
    rationale: "The source names a pregnancy TEST, not pregnancy status: pregnant=true must not stand in for a test result. The atom survives vetting, the guard's reason is the only problem, the criterion is not fully parsed and stays UNKNOWN." },
  { id: "iso-02", guard: "pregnancy_test_is_not_pregnancy_status", type: "inclusion", category: "other", text: "hCG-pregnancy",
    known: { pregnant: true }, parse: crit([atom("hCG-pregnancy", "pregnant", "eq", true)], { category: "other" }), without_guard: "PASS",
    expected: { vet: "ok", leafKind: "atom", problems: ["pregnancy_test_is_not_pregnancy_status"], completeness: "partial", status: "UNKNOWN", evidence: [] },
    rationale: "A source that names an hCG assay is a test, not a status; inclusion variant; without the guard the known pregnant=true would PASS." },
  { id: "iso-03", guard: "source_does_not_mention_fact", type: "inclusion", category: "comorbidity", text: "Treated stable",
    known: { cns_mets: "treated_stable" }, parse: crit([atom("Treated stable", "cns_mets", "eq", "treated_stable")], { category: "comorbidity" }), without_guard: "PASS",
    expected: { vet: "ok", leafKind: "atom", problems: ["source_does_not_mention_fact"], completeness: "partial", status: "UNKNOWN", evidence: [] },
    rationale: "Every word of the source is a value word, so vetting accepts it, but the source never mentions CNS/brain metastases: the fact key is unsupported by the cited text. Guard reason only; UNKNOWN." },
  { id: "iso-04", guard: "source_does_not_mention_fact", type: "inclusion", category: "stage", text: "III",
    known: { stage: "III" }, parse: crit([atom("III", "stage", "eq", "III")], { category: "stage" }), without_guard: "PASS",
    expected: { vet: "ok", leafKind: "atom", problems: ["source_does_not_mention_fact"], completeness: "partial", status: "UNKNOWN", evidence: [] },
    rationale: "A bare value ('III') with no stage cue does not show the criterion is about stage: guard reason only; UNKNOWN." },
];

// ---- relevance negative control (abstention guard layer; fixture model findings) --------------------------------------------------------------------------
export interface RelevanceCase {
  id: string;
  type: "inclusion" | "exclusion";
  text: string;
  category: Category;
  known: Partial<Record<FactKey, FactVal>>;
  /** the parser output the finding belongs to (added 2026-10-07 for the fail-closed path, which needs the clause; the EXPECTED values below are unchanged) */
  parse: LlmClauseCriterion;
  finding: { status: "PASS" | "FAIL"; evidence: string[] };
  expected: { status: Status; tier: Tier };
  rationale: string;
}
export const RELEVANCE_CASES: RelevanceCase[] = [
  { id: "rel-01", type: "inclusion", category: "lab", text: "Hemoglobin of at least 9 g/dL", known: { age: 47 }, parse: crit([text("Hemoglobin of at least 9 g/dL", ["age"])], { category: "lab" }), finding: { status: "PASS", evidence: ["age"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" },
    rationale: "NEGATIVE CONTROL: the model cites a known but irrelevant fact (age) for a hemoglobin criterion while hemoglobin is not in the profile. A PASS must rest on facts the criterion is about, so it must be UNKNOWN. Non-core, free text, 1 open: POSSIBLE." },
  { id: "rel-02", type: "exclusion", category: "comorbidity", text: "Active cardiac disease", known: { sex: "female", ecog: "1" }, parse: crit([text("Active cardiac disease", [])], { category: "comorbidity" }), finding: { status: "FAIL", evidence: ["sex", "ecog"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" },
    rationale: "NEGATIVE CONTROL (FAIL variant): known but irrelevant facts cannot support a FAIL on a cardiac exclusion. Expected UNKNOWN; non-core, free text: POSSIBLE." },
  { id: "rel-03", type: "inclusion", category: "lab", text: "Hemoglobin of at least 9 g/dL", known: { hemoglobin: 11.2 }, parse: crit([atom("Hemoglobin of at least 9 g/dL", "hemoglobin", "gte", 9, "g/dL")], { category: "lab" }), finding: { status: "PASS", evidence: ["hemoglobin"] },
    expected: { status: "PASS", tier: "POSSIBLE" },
    rationale: "POSITIVE CONTROL: a PASS citing the criterion's own known fact must survive, so any future relevance check is shown not to over-block. Non-core, free text, nothing open but not fully parsed: POSSIBLE." },
  // ADDED after the fail-closed direction was approved: the FREE-TEXT shape of rel-03. A model PASS citing the criterion's own known fact has no independent proof when the
  // criterion is only a text leaf, so it is UNKNOWN by design (the model's claim is not proof). rel-03 above keeps its pre-written expectation because its criterion is typed,
  // so the code derives the same PASS.
  { id: "rel-04", type: "inclusion", category: "lab", text: "Hemoglobin of at least 9 g/dL", known: { hemoglobin: 11.2 }, parse: crit([text("Hemoglobin of at least 9 g/dL", ["hemoglobin"])], { category: "lab" }), finding: { status: "PASS", evidence: ["hemoglobin"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" },
    rationale: "DESIGN CONSEQUENCE (not a failure): the same finding as rel-03 on a criterion that is only a text leaf. Code cannot establish a text leaf, so even a PASS citing its own known fact has no independent proof: UNKNOWN. Non-core, not fully parsed, 1 open: POSSIBLE." },
];
