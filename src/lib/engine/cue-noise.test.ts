// L3 (negative tests only; no behaviour change). Pins which vocabulary keys' cue lists match texts that are out of vocabulary, so that
// WIDENING a cue list fails here and has to be justified, and so the known cue noise is explicit rather than silently relied on.
// Source: public registry criteria seen in the coverage audit (docs/coverage-audit.md). VERIFY: pins current behaviour, not desired behaviour.
import { describe, expect, it } from "vitest";
import { atomSemanticProblems, CUES } from "./atom-checks";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";

const matched = (t: string): FactKey[] => FACT_KEYS.filter((k) => CUES[k].test(t));

describe("L3: out-of-vocabulary criteria match no cue (so no atom for them passes the semantic check)", () => {
  const NONE = [
    "Baseline systolic blood pressure < 100 mmHg.",
    "Has a known history of Human Immunodeficiency Virus (HIV)",
    "Hypersensitivity to the study drug or its excipients",
    "Patients with hearing or speech impairments",
    "No 18F-FDG PET/CT or 18F-FDG PET/MRI scan.",
    "Chronic inflammatory disease such as rheumatoid arthritis.",
    "Uncontrolled pleural effusion, pericardial effusion, or ascites requiring frequent drainage.",
    "Patients undergoing breast-conserving surgery",
    "Individuals with cognitive or mental impairments",
    "Patients must be able to swallow oral medication",
    "Active hepatitis B or C infection",
    "Planned elective surgery within 4 weeks",
    "Participants must provide written informed consent",
  ];
  for (const t of NONE) {
    it(`no key matches: ${t.slice(0, 50)}`, () => {
      expect(matched(t)).toEqual([]);
      for (const k of FACT_KEYS) expect(atomSemanticProblems({ fact_key: k, source: t })).toContain("source_does_not_mention_fact");
    });
  }
});

describe("L3: known cue noise is pinned, not relied on", () => {
  it("'treatment' alone satisfies the days_since_last_systemic_therapy cue (noise: such an atom is not stopped by the cue check)", () => {
    expect(matched("Treatment with ACEI/ARB.")).toEqual(["days_since_last_systemic_therapy"]);
  });
  it("the word 'cancer' satisfies the prior_other_malignancy cue: a breast-cancer diagnosis requirement is not evidence about another malignancy", () => {
    expect(matched("Histologically or cytologically confirmed breast cancer")).toEqual(["prior_other_malignancy"]);
    expect(matched("Women eligible for breast cancer screening")).toEqual(["sex", "prior_other_malignancy"]);
  });
  it("a diagnosis or pathology-confirmation requirement has no vocabulary key; no cue is added for it here", () => {
    for (const k of FACT_KEYS) expect(k).not.toMatch(/diagnos|histolog|pathology|breast_cancer/);
  });
});

describe("L3: cues are not cross-key shortcuts", () => {
  it("a lab cue does not satisfy another lab key", () => {
    expect(matched("Platelet count >= 100,000/mm3")).toEqual(["platelets"]);
    expect(matched("Absolute neutrophil count (ANC) >= 1,000/mm3")).toEqual(["anc"]);
    expect(matched("Hemoglobin >= 9 g/dL")).toEqual(["hemoglobin"]);
  });
  it("prior-therapy class cues stay separate (taxane is not anthracycline, endocrine is not chemo)", () => {
    expect(matched("Prior treatment with a taxane")).not.toContain("prior_anthracycline");
    expect(matched("Prior tamoxifen")).not.toContain("prior_chemo_any");
    expect(matched("prior anthracycline")).not.toContain("prior_taxane");
  });
});
