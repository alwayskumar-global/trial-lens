import { describe, expect, it } from "vitest";
import { atomSemanticProblems } from "./atom-checks";
import { classifyCompleteness, evaluateClause, toClauseTree } from "./clause";
import { atom, crit, profile } from "./test-helpers";

const completeness = (l: ReturnType<typeof atom>) => classifyCompleteness(toClauseTree(crit([l])));

describe("REGRESSION: wrong fact mapping (Phase 1 audit)", () => {
  it("PD-L1 criterion mapped to prior_endocrine is not executable", () => {
    const l = atom("Participants whose tumours are PD-L1-negative, or Participants whose tumours are PD-L1-positive and have relapsed after prior PD-1/PD-L1 inhibitor therapy", "prior_endocrine", "eq", false);
    expect(atomSemanticProblems({ fact_key: "prior_endocrine", source: l.source })).toContain("source_does_not_mention_fact");
    expect(completeness(l)).toBe("partial");
    // and therefore cannot produce a code FAIL from the patient's prior_endocrine=true
    expect(evaluateClause(toClauseTree(crit([l])), profile({ prior_endocrine: true })).truth).toBe("unknown");
  });
  it("HIV criterion mapped to prior_other_malignancy is not executable", () => {
    expect(atomSemanticProblems({ fact_key: "prior_other_malignancy", source: "Has a known history of Human Immunodeficiency Virus (HIV) (HIV 1, 2 antibodies)" })).toContain("source_does_not_mention_fact");
  });
  it("surgery mapped to days_since_last_systemic_therapy is still flagged when no therapy wording", () => {
    expect(atomSemanticProblems({ fact_key: "days_since_last_systemic_therapy", source: "Had major surgical procedure within 2 weeks" })).toContain("source_does_not_mention_fact");
  });
  it("correct mappings still pass the cue check", () => {
    const ok: Array<[Parameters<typeof atomSemanticProblems>[0]["fact_key"], string]> = [
      ["ecog", "ECOG performance status of 0-1"], ["age", "Age >= 18 years"], ["sex", "Males or females aged 18 years or older"], ["anc", "Absolute neutrophil count (ANC) >= 1,000/mm3"],
      ["platelets", "Platelet Count >= 100,000/mm3"], ["hemoglobin", "Hb >= 9 g/dL"], ["lvef_percent", "LVEF >= 50%"], ["pregnant", "Pregnant or breastfeeding"],
      ["measurable_disease", "At least 1 measurable lesion per RECIST v1.1"], ["cns_mets", "Active brain metastases"], ["brca_germline", "Carriers of BRCA1/2 germline mutations"],
      ["her2_status", "HER2-negative"], ["er_status", "ER-negative, PR-negative"], ["prior_cdk46i", "Prior treatment with a CDK4/6 inhibitor"],
    ];
    for (const [k, src] of ok) expect(atomSemanticProblems({ fact_key: k, source: src })).toEqual([]);
  });
});

describe("REGRESSION: receptor thresholds (Phase 1 audit)", () => {
  it("ER/PR ≤10% is not 'negative': atom is not executable", () => {
    for (const src of [
      "Estrogen receptor (ER) and progesterone receptor (PR) =< 10%",
      "Estrogen receptor (ER) and progesterone receptor (PR) =\\< 10%",
      "Negative ER/PgR (defined as <10% of tumor cells expressing ER and PgR hormonal receptors)",
      "ER-low (1-10%) breast cancer",
    ]) {
      expect(atomSemanticProblems({ fact_key: "er_status", source: src })).toContain("receptor_threshold_semantics");
      expect(atomSemanticProblems({ fact_key: "pr_status", source: src })).toContain("receptor_threshold_semantics");
    }
  });
  it("code can no longer FAIL a patient whose ER is 'positive' (percent unknown) on a ≤10% criterion", () => {
    const t = toClauseTree(crit([atom("Estrogen receptor (ER) and progesterone receptor (PR) =< 10%", "er_status", "eq", "negative")]));
    expect(classifyCompleteness(t)).toBe("partial");
    expect(evaluateClause(t, profile({ er_status: "positive" })).truth).toBe("unknown");
  });
  it("plain 'ER-negative' / 'ER-positive' remain executable", () => {
    expect(completeness(atom("ER-positive", "er_status", "eq", "positive"))).toBe("full");
    expect(completeness(atom("Hormone receptor negative", "er_status", "eq", "negative"))).toBe("full");
  });
  it("HER2 IHC/ISH scoring language is not executable; plain HER2 status is", () => {
    expect(atomSemanticProblems({ fact_key: "her2_status", source: "HER2 IHC score 3+, or 2+ and ISH positive" })).toContain("her2_scoring_semantics");
    expect(atomSemanticProblems({ fact_key: "her2_status", source: "HER2-negative by ASCO/CAP guidelines (IHC 0 or 1+)" })).toContain("her2_scoring_semantics");
    expect(atomSemanticProblems({ fact_key: "her2_status", source: "HER2-negative" })).toEqual([]);
  });
  it("'evaluable' disease is not 'measurable' disease", () => {
    expect(atomSemanticProblems({ fact_key: "measurable_disease", source: "Evaluable disease, as defined by RECIST 1.1" })).toContain("evaluable_is_not_measurable");
    expect(atomSemanticProblems({ fact_key: "measurable_disease", source: "Measurable or evaluable disease per RECIST 1.1" })).toEqual([]);
  });
});
