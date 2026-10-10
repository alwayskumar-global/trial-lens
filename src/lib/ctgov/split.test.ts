import { describe, expect, it } from "vitest";
import { splitEligibility, splitTrialCriteria } from "./split";

const types = (s: string) => splitEligibility(s).map((i) => i.type);

describe("splitEligibility", () => {
  it("splits plain Inclusion / Exclusion sections into bullets", () => {
    const r = splitEligibility("Inclusion Criteria:\n* Age 18 years or older\n* ECOG performance status 0-1\n\nExclusion Criteria:\n* Pregnant or breastfeeding women");
    expect(r).toEqual([
      { type: "inclusion", text: "Age 18 years or older" },
      { type: "inclusion", text: "ECOG performance status 0-1" },
      { type: "exclusion", text: "Pregnant or breastfeeding women" },
    ]);
  });

  it("REGRESSION: an inline '(Exclusion Criteria)' cross-reference does not flip later items to exclusion", () => {
    const text = [
      "Inclusion Criteria:",
      "* Patients may receive concurrent systemic therapy; see Section 7.7.5 (Systemic Therapies Allowed) and Section 5.2, 1 and 2 (Exclusion Criteria).",
      "* Pregnancy test: negative serum or urine test at screening for women of childbearing potential.",
      "* Contraception: highly effective contraception for all subjects during the study.",
      "Exclusion Criteria:",
      "* Active uncontrolled infection at screening",
    ].join("\n");
    expect(types(text)).toEqual(["inclusion", "inclusion", "inclusion", "exclusion"]);
  });

  it("REGRESSION: a short line that merely ENDS with the phrase is not a header", () => {
    expect(types("Inclusion Criteria:\n* Meets the Exclusion Criteria\n* Histologically confirmed breast cancer")).toEqual(["inclusion", "inclusion"]);
  });

  it("accepts markdown, numbering and qualifier headers", () => {
    expect(types("## Inclusion Criteria\n* Histologically confirmed breast cancer\n**Exclusion Criteria:**\n* Prior treatment with the study drug")).toEqual(["inclusion", "exclusion"]);
    expect(types("1. Key Inclusion Criteria:\n* Histologically confirmed breast cancer\n2. Key Exclusion Criteria:\n* Prior treatment with the study drug")).toEqual(["inclusion", "exclusion"]);
  });

  it("handles repeated per-cohort headers in order", () => {
    const t = "Cohort A Inclusion Criteria:\n* Histologically confirmed HER2-positive disease\nCohort A Exclusion Criteria:\n* Symptomatic brain metastases at screening\nCohort B Inclusion Criteria:\n* Histologically confirmed triple-negative disease";
    expect(types(t)).toEqual(["inclusion", "exclusion", "inclusion"]);
  });

  it("header with same-line text keeps that text as the first item", () => {
    expect(splitEligibility("Exclusion Criteria: Known hypersensitivity to the study drug").map((i) => i.type)).toEqual(["exclusion"]);
  });

  it("no header ⇒ everything is inclusion; wrapped lines stay in one item", () => {
    const r = splitEligibility("* Histologically confirmed breast cancer,\n  stage II or III\n* Age 18 years or older");
    expect(r).toEqual([
      { type: "inclusion", text: "Histologically confirmed breast cancer, stage II or III" },
      { type: "inclusion", text: "Age 18 years or older" },
    ]);
  });

  it("drops fragments shorter than 15 characters and the bare header text", () => {
    expect(splitEligibility("Inclusion Criteria:\n* Adult\n* Histologically confirmed breast cancer")).toHaveLength(1);
  });

  it("splitTrialCriteria numbers per type across sections", () => {
    const r = splitTrialCriteria("NCT0", "Inclusion Criteria:\n* Age 18 years or older\nExclusion Criteria:\n* Pregnant or breastfeeding women\nInclusion Criteria:\n* ECOG performance status 0-1");
    expect(r.map((c) => c.id)).toEqual(["NCT0:inclusion:0", "NCT0:exclusion:0", "NCT0:inclusion:1"]);
  });
});
