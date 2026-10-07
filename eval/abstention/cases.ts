// Hand-built abstention test set (TASKS Phase 3). AUTHOR-CREATED, FICTIONAL, NOT clinician reviewed. A development check of the deterministic engine layers
// (parse vetting, clause evaluation, abstention guard, tiering with the R2 ceiling, study-team panel); NOT product validation and no model is called.
//
// EXPECTED OUTCOMES AND RATIONALES BELOW WERE WRITTEN FROM THE ENGINE'S DOCUMENTED RULES BEFORE ANY CASE WAS RUN (this file is committed first; the runner
// is written and run afterwards). A mismatch is reported as a failure and never fixed by editing the expected value.
//
// Layers (one expected outcome per field; fields refer to different layers, never alternatives):
//  - status: the criterion status after the layer named in `layer`:
//      "typed"          = parser output fixture -> reconcileBatch (vetting) -> assessCriterion (clause evaluation) -> applyAbstentionGuard
//      "model_finding"  = a (fixture) free-text model finding -> applyAbstentionGuard only
//  - tier: tier of a ONE-criterion trial after tiering plus the R2 ceiling (TIER_UNKNOWN_THRESHOLD = 3, expectedCriteria = 1). Rules (src/lib/engine/tier.ts):
//      no scoring criterion -> UNCERTAIN; unverified FAIL -> UNCERTAIN; core category (diagnosis, stage, biomarker, prior_therapy, disease_setting) that is
//      UNKNOWN/AMBIGUOUS or not fully parsed -> UNCERTAIN; otherwise not fully parsed or more than 3 open -> POSSIBLE; otherwise STRONG, which the ceiling lowers to POSSIBLE.
//  - panel (pregnancy cases only): fact keys the "Questions worth asking the study team" panel offers for a one-study trial of this criterion. Pregnancy keys, age
//    and sex are never offered, and a key is offered only when the wording has a cue for it.
import type { LlmClauseCriterion } from "@/schema/clause";
import type { Category, Status } from "@/schema/criteria";
import type { Tier } from "@/schema/assessment";
import type { FactKey } from "@/schema/vocabulary";
import { atom, block, crit, critBlocks, text, timing } from "@/lib/engine/test-helpers";

type FactVal = string | number | boolean;
export interface AbstentionCase {
  id: string;
  group: "fact_known" | "fact_absent" | "fact_uncertain" | "clinical_judgment" | "unsupported_evidence" | "conditional" | "pregnancy";
  layer: "typed" | "model_finding";
  type: "inclusion" | "exclusion";
  text: string; // criterion wording (fictional); for the typed layer every leaf source is an exact fragment of it
  category: Category;
  known: Partial<Record<FactKey, FactVal>>;
  uncertain?: Partial<Record<FactKey, FactVal>>; // state "uncertain" with a tentative value
  parse?: LlmClauseCriterion; // typed layer: the parser output, written by hand
  finding?: { status: "PASS" | "FAIL" | "UNKNOWN" | "AMBIGUOUS"; evidence: string[] }; // model_finding layer
  expected: { status: Status; tier: Tier; panel?: FactKey[] };
  rationale: string;
}

const P = "pregnant" as const;
export const CASES: AbstentionCase[] = [
  // ---- fact known: a decision is allowed -------------------------------------------------------------------------------------------------------------
  { id: "ab-01", group: "fact_known", layer: "typed", type: "inclusion", category: "organ_function", text: "Left ventricular ejection fraction of at least 50%",
    known: { lvef_percent: 62 }, parse: crit([atom("Left ventricular ejection fraction of at least 50%", "lvef_percent", "gte", 50, "%")], { category: "organ_function" }),
    expected: { status: "PASS", tier: "POSSIBLE" }, rationale: "62 >= 50, inclusion met; non-core, fully parsed, nothing open: STRONG is lowered to POSSIBLE by the R2 ceiling." },
  { id: "ab-02", group: "fact_known", layer: "typed", type: "exclusion", category: "lab", text: "Absolute neutrophil count below 1000 cells/mm3",
    known: { anc: 0.8 }, parse: crit([atom("Absolute neutrophil count below 1000 cells/mm3", "anc", "lt", 1000, "cells/mm3")], { category: "lab" }),
    expected: { status: "FAIL", tier: "UNCERTAIN" }, rationale: "1000 cells/mm3 = 1.0 x10^9/L; 0.8 < 1.0 so the exclusion applies. An unverified FAIL never exceeds UNCERTAIN (rule D)." },
  { id: "ab-03", group: "fact_known", layer: "typed", type: "exclusion", category: "comorbidity", text: "Active cardiac disease",
    known: { cardiac_disease: "none" }, parse: crit([atom("Active cardiac disease", "cardiac_disease", "eq", "active")], { category: "comorbidity" }),
    expected: { status: "PASS", tier: "POSSIBLE" }, rationale: "cardiac_disease is none, so the exclusion condition is false and the exclusion does not apply; non-core, full: POSSIBLE after the ceiling." },
  { id: "ab-04", group: "fact_known", layer: "typed", type: "inclusion", category: "biomarker", text: "ER positive",
    known: { er_status: "positive" }, parse: crit([atom("ER positive", "er_status", "eq", "positive")], { category: "biomarker" }),
    expected: { status: "PASS", tier: "POSSIBLE" }, rationale: "Known positive meets an inclusion that states positive; core category but fully parsed and PASS: STRONG lowered to POSSIBLE." },
  { id: "ab-05", group: "fact_known", layer: "typed", type: "inclusion", category: "disease_setting", text: "Metastatic disease",
    known: { disease_setting: "early" }, parse: crit([atom("Metastatic disease", "disease_setting", "eq", "metastatic")], { category: "disease_setting" }),
    expected: { status: "FAIL", tier: "UNCERTAIN" }, rationale: "Known early setting does not meet the inclusion; unverified FAIL stays UNCERTAIN." },
  { id: "ab-06", group: "fact_known", layer: "typed", type: "inclusion", category: "prior_therapy", text: "Prior taxane or prior anthracycline",
    known: { prior_taxane: false, prior_anthracycline: true },
    parse: crit([atom("Prior taxane", "prior_taxane", "eq", true), atom("prior anthracycline", "prior_anthracycline", "eq", true)], { combine: "any", category: "prior_therapy" }),
    expected: { status: "PASS", tier: "POSSIBLE" }, rationale: "An 'any' of two atoms is true when one is true; a known false in the other branch does not block it. Core, fully parsed, PASS: POSSIBLE." },

  // ---- fact absent: must abstain ----------------------------------------------------------------------------------------------------------------------
  { id: "ab-07", group: "fact_absent", layer: "typed", type: "inclusion", category: "performance", text: "ECOG performance status of 0 or 1",
    known: {}, parse: crit([atom("ECOG performance status of 0 or 1", "ecog", "in", ["0", "1"])], { category: "performance" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "ecog is not in the profile, so the atom is unknown. Non-core, fully parsed, 1 open (<= 3): STRONG lowered to POSSIBLE." },
  { id: "ab-08", group: "fact_absent", layer: "typed", type: "exclusion", category: "comorbidity", text: "Active CNS metastases",
    known: { sex: "female" }, parse: crit([atom("Active CNS metastases", "cns_mets", "eq", "active")], { category: "comorbidity" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "cns_mets is unknown (an unrelated fact is known): an exclusion with no evidence is UNKNOWN, never assumed PASS. Non-core full, 1 open: POSSIBLE." },
  { id: "ab-09", group: "fact_absent", layer: "typed", type: "inclusion", category: "demographic", text: "Age 18 years or older",
    known: {}, parse: crit([atom("Age 18 years or older", "age", "gte", 18, "years")], { category: "demographic" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "age is not in the profile: UNKNOWN. Non-core full, 1 open: POSSIBLE." },
  { id: "ab-10", group: "fact_absent", layer: "typed", type: "exclusion", category: "washout_timing", text: "Systemic anticancer therapy within 21 days before enrollment",
    known: { days_since_last_systemic_therapy: 40 },
    parse: crit([timing("Systemic anticancer therapy within 21 days before enrollment", "within_last", 21, "days")], { category: "washout_timing" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "A timing leaf is never decided in code even when a related number is known (free-text path). Non-core, partial: POSSIBLE." },
  { id: "ab-11", group: "fact_absent", layer: "typed", type: "exclusion", category: "prior_therapy", text: "Prior PI3K pathway inhibitor therapy",
    known: { pik3ca_mutation: true }, parse: crit([text("Prior PI3K pathway inhibitor therapy", [])], { category: "prior_therapy" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "No vocabulary key states drug exposure; a known PIK3CA mutation is a different fact and is not substituted. Core and not fully parsed: UNCERTAIN." },
  { id: "ab-12", group: "fact_absent", layer: "typed", type: "inclusion", category: "consent_logistics", text: "Willing to attend study visits every four weeks",
    known: {}, parse: crit([text("Willing to attend study visits every four weeks", [])], { category: "consent_logistics" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "A consent/logistics criterion is non-scoring and its text leaf cannot be decided: UNKNOWN. A trial with no scoring criterion is UNCERTAIN." },

  // ---- uncertain facts never count as known -----------------------------------------------------------------------------------------------------------
  { id: "ab-13", group: "fact_uncertain", layer: "typed", type: "inclusion", category: "biomarker", text: "HER2 positive",
    known: {}, uncertain: { her2_status: "positive" }, parse: crit([atom("HER2 positive", "her2_status", "eq", "positive")], { category: "biomarker" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "A hedged (uncertain) value is not evidence: the atom is unknown. Core biomarker UNKNOWN: UNCERTAIN." },
  { id: "ab-14", group: "fact_uncertain", layer: "typed", type: "exclusion", category: "prior_therapy", text: "Prior anthracycline",
    known: {}, uncertain: { prior_anthracycline: true }, parse: crit([atom("Prior anthracycline", "prior_anthracycline", "eq", true)], { category: "prior_therapy" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "An uncertain 'yes' must not become FAIL for an exclusion. Core prior_therapy UNKNOWN: UNCERTAIN." },
  { id: "ab-15", group: "fact_uncertain", layer: "typed", type: "inclusion", category: "lab", text: "Hemoglobin of at least 9 g/dL",
    known: {}, uncertain: { hemoglobin: 9.6 }, parse: crit([atom("Hemoglobin of at least 9 g/dL", "hemoglobin", "gte", 9, "g/dL")], { category: "lab" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "An approximate lab value (9.6 hedged) is not known: UNKNOWN. Non-core full, 1 open: POSSIBLE." },
  { id: "ab-16", group: "fact_uncertain", layer: "model_finding", type: "inclusion", category: "performance", text: "Performance status acceptable for outpatient treatment",
    known: {}, uncertain: { ecog: "3" }, finding: { status: "FAIL", evidence: ["ecog"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "Guard: a FAIL may cite only keys that are known; ecog is uncertain, so it is coerced to UNKNOWN. Non-core, free text (not fully parsed), 1 open: POSSIBLE." },

  // ---- clinical judgment / expressions the vocabulary cannot carry ---------------------------------------------------------------------------------------
  { id: "ab-17", group: "clinical_judgment", layer: "typed", type: "inclusion", category: "biomarker", text: "HER2-low expression (IHC 1+ or IHC 2+/ISH-negative)",
    known: { her2_status: "low" }, parse: crit([atom("HER2-low expression (IHC 1+ or IHC 2+/ISH-negative)", "her2_status", "eq", "low")], { category: "biomarker" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "IHC/ISH scoring language is not expressible by the vocabulary: the atom is downgraded to free text even with her2_status=low known. Core, not fully parsed: UNCERTAIN." },
  { id: "ab-18", group: "clinical_judgment", layer: "typed", type: "inclusion", category: "biomarker", text: "ER positive (at least 1% of tumor cells stained)",
    known: { er_status: "positive" }, parse: crit([atom("ER positive (at least 1% of tumor cells stained)", "er_status", "eq", "positive")], { category: "biomarker" }),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "A percentage threshold on receptor staining is not 'positive': the atom is not executable. Core, not fully parsed: UNCERTAIN." },
  { id: "ab-19", group: "clinical_judgment", layer: "typed", type: "inclusion", category: "other", text: "Evaluable disease",
    known: { measurable_disease: true }, parse: crit([atom("Evaluable disease", "measurable_disease", "eq", true)], { category: "other" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "Evaluable is not measurable: the atom is not executable even with measurable_disease=true. Non-core, not fully parsed: POSSIBLE." },
  { id: "ab-20", group: "clinical_judgment", layer: "model_finding", type: "inclusion", category: "organ_function", text: "Organ function adequate in the opinion of the investigator",
    known: { creatinine_clearance: 80 }, finding: { status: "AMBIGUOUS", evidence: [] },
    expected: { status: "AMBIGUOUS", tier: "POSSIBLE" }, rationale: "The guard only touches PASS/FAIL: AMBIGUOUS is kept as AMBIGUOUS (needs clinical judgment), not coerced. Non-core, free text, 1 open: POSSIBLE." },

  // ---- PASS/FAIL without supported evidence is downgraded by the abstention guard -------------------------------------------------------------------------
  { id: "ab-21", group: "unsupported_evidence", layer: "model_finding", type: "inclusion", category: "other", text: "Stable bisphosphonate dose for at least 3 months",
    known: {}, finding: { status: "PASS", evidence: [] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "PASS with no cited evidence is coerced to UNKNOWN. Non-core, free text: POSSIBLE." },
  { id: "ab-22", group: "unsupported_evidence", layer: "model_finding", type: "exclusion", category: "comorbidity", text: "Symptomatic central nervous system involvement",
    known: { sex: "female" }, finding: { status: "FAIL", evidence: ["cns_mets"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "A FAIL citing cns_mets while cns_mets is unknown is unsupported: UNKNOWN. Non-core, free text: POSSIBLE." },
  { id: "ab-23", group: "unsupported_evidence", layer: "model_finding", type: "inclusion", category: "prior_therapy", text: "Previously treated with endocrine therapy and tolerated it",
    known: { prior_endocrine: true }, finding: { status: "PASS", evidence: ["prior_endocrine", "clinic_record"] },
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "Every cited key must be a known vocabulary fact: clinic_record is not a key, so the whole PASS is coerced to UNKNOWN. Core, free text: UNCERTAIN." },
  { id: "ab-24", group: "unsupported_evidence", layer: "model_finding", type: "exclusion", category: "other", text: "Grade 2 or higher fatigue at screening",
    known: { age: 47 }, finding: { status: "PASS", evidence: ["age", "brca_germline"] },
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "age is known but brca_germline is not: one unsupported key makes the PASS UNKNOWN. Non-core, free text: POSSIBLE." },

  // ---- conditional criteria: vacuous PASS only when non-applicability is PROVEN ------------------------------------------------------------------------
  { id: "ab-25", group: "conditional", layer: "typed", type: "inclusion", category: "other", text: "If aged 50 years or older, a bone density scan must be on file",
    known: { age: 42 }, parse: critBlocks([block([atom("aged 50 years or older", "age", "gte", 50, "years")], [text("a bone density scan must be on file", [])])], "other"),
    expected: { status: "PASS", tier: "POSSIBLE" }, rationale: "age 42 is known and makes the condition false: non-applicability is proven by a known fact, so a vacuous PASS is allowed (cites age). Non-core, partial: POSSIBLE." },
  { id: "ab-26", group: "conditional", layer: "typed", type: "inclusion", category: "other", text: "If aged 50 years or older, a bone density scan must be on file",
    known: {}, parse: critBlocks([block([atom("aged 50 years or older", "age", "gte", 50, "years")], [text("a bone density scan must be on file", [])])], "other"),
    expected: { status: "UNKNOWN", tier: "POSSIBLE" }, rationale: "age is not in the profile: applicability is not proven, so no vacuous PASS and the requirement itself is unresolved. Non-core, partial: POSSIBLE." },
  { id: "ab-27", group: "conditional", layer: "typed", type: "inclusion", category: "prior_therapy", text: "If prior radiotherapy to the chest wall, it must have ended more than 6 months ago",
    known: { prior_radiation: false },
    parse: critBlocks([block([text("prior radiotherapy to the chest wall", ["prior_radiation"])], [timing("it must have ended more than 6 months ago", "not_within_last", 6, "months")])], "prior_therapy"),
    expected: { status: "UNKNOWN", tier: "UNCERTAIN" }, rationale: "The condition (chest wall) is not representable by the vocabulary; a known 'no prior radiation' is a different, broader fact, so applicability stays unproven: UNKNOWN. Core, partial: UNCERTAIN." },

  // ---- pregnancy: current engine and study-team panel behavior ------------------------------------------------------------------------------------------
  { id: "ab-28", group: "pregnancy", layer: "typed", type: "inclusion", category: "other", text: "A negative serum pregnancy test within 7 days before the first dose",
    known: { [P]: false, sex: "female", age: 29 },
    parse: crit([atom("A negative serum pregnancy test", P, "eq", false), timing("within 7 days before the first dose", "within_last", 7, "days")], { category: "other" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE", panel: [] }, rationale: "pregnant=false is a status, not a negative test result and not its timing: the atom is kept off the typed path and the timing leaf is never decided. The panel never offers pregnancy keys." },
  { id: "ab-29", group: "pregnancy", layer: "typed", type: "inclusion", category: "other", text: "Participants able to become pregnant must use two highly effective contraception methods from screening until 90 days after the last dose",
    known: { [P]: false, sex: "female", age: 29 },
    parse: crit([text("Participants able to become pregnant must use two highly effective contraception methods from screening until 90 days after the last dose", [P])], { category: "other" }),
    expected: { status: "UNKNOWN", tier: "POSSIBLE", panel: [] }, rationale: "Contraception and its timing have no vocabulary fact; pregnant=false does not satisfy them. Free text stays UNKNOWN and the panel offers no pregnancy key." },
  { id: "ab-30", group: "pregnancy", layer: "typed", type: "inclusion", category: "other", text: "If of childbearing potential, a highly effective contraception method must be used",
    known: { age: 58, sex: "female", menopausal_status: "post" },
    parse: critBlocks([block([atom("of childbearing potential", "menopausal_status", "in", ["pre", "peri"])], [text("a highly effective contraception method must be used", [])])], "other"),
    expected: { status: "UNKNOWN", tier: "POSSIBLE", panel: [] }, rationale: "Childbearing potential is never inferred from age, sex or menopausal status: a parse that proxies it with menopause cannot prove non-applicability, so no vacuous PASS. Panel offers nothing." },
];

/** The abstention-set loader's format (eval/lib/loaders.ts). The loader's gold has no AMBIGUOUS, so ab-20's AMBIGUOUS is exported as UNKNOWN (an abstention); the case file keeps AMBIGUOUS. */
export function toLoaderSet() {
  return {
    version: 1 as const, authored_by: "author" as const, clinician_reviewed: false as const,
    cases: CASES.map((c) => ({ id: c.id, patient_id: `synthetic-${c.id}`, trial_id: `SYN-${c.id}`, criterion_id: `SYN-${c.id}:${c.type}:0`, type: c.type, text: c.text, gold: c.expected.status === "AMBIGUOUS" ? ("UNKNOWN" as const) : (c.expected.status as "PASS" | "FAIL" | "UNKNOWN") })),
  };
}
