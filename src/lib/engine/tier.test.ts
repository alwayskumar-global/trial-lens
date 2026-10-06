import { describe, expect, it } from "vitest";
import { tierTrial, tierTrialCapped, type TierCriterion } from "./tier";

const c = (o: Partial<TierCriterion> = {}): TierCriterion => ({ scoring: true, category: "lab", status: "PASS", completeness: "full", ...o });
const N = { unknownThreshold: 3 };

describe("tierTrial: SPEC rules", () => {
  it("a VERIFIED FAIL → LIKELY_MISMATCH, even with unresolved criteria", () => {
    expect(tierTrial([c({ status: "FAIL", failCheck: "verified" }), c({ category: null, status: "UNKNOWN", completeness: "unresolved" })], N)).toBe("LIKELY_MISMATCH");
  });
  it("non-scoring FAIL is ignored", () => {
    expect(tierTrial([c({ scoring: false, status: "FAIL" }), c()], N)).toBe("STRONG");
  });
  it("core UNKNOWN → UNCERTAIN", () => expect(tierTrial([c({ category: "stage", status: "UNKNOWN" })], N)).toBe("UNCERTAIN"));
  it("core AMBIGUOUS → UNCERTAIN", () => expect(tierTrial([c({ category: "biomarker", status: "AMBIGUOUS" })], N)).toBe("UNCERTAIN"));
  it("all PASS and full → STRONG", () => expect(tierTrial([c({ category: "stage" }), c()], N)).toBe("STRONG"));
  it("open ≤ N non-core → STRONG; > N → POSSIBLE", () => {
    const u = () => c({ status: "UNKNOWN" });
    expect(tierTrial([c({ category: "stage" }), u(), u(), u()], N)).toBe("STRONG");
    expect(tierTrial([c({ category: "stage" }), u(), u(), u(), u()], N)).toBe("POSSIBLE");
  });
});

describe("tierTrial: conservative parse-completeness rules", () => {
  it("never STRONG with an unresolved scoring criterion", () => {
    expect(tierTrial([c({ category: "stage" }), c({ category: null, status: "UNKNOWN", completeness: "unresolved" })], N)).toBe("UNCERTAIN");
  });
  it("never STRONG with a partially parsed non-core criterion → POSSIBLE", () => {
    expect(tierTrial([c({ category: "stage" }), c({ completeness: "partial" })], N)).toBe("POSSIBLE");
  });
  it("partially parsed CORE criterion → UNCERTAIN even if it evaluates PASS", () => {
    expect(tierTrial([c({ category: "biomarker", status: "PASS", completeness: "partial" })], N)).toBe("UNCERTAIN");
  });
  it("missing scoring criteria (fewer inputs than expected) → UNCERTAIN", () => {
    expect(tierTrial([c(), c()], { ...N, expectedCriteria: 3 })).toBe("UNCERTAIN");
  });
  it("analysis failed → UNCERTAIN; nothing scorable → UNCERTAIN", () => {
    expect(tierTrial([c()], { ...N, analysisFailed: true })).toBe("UNCERTAIN");
    expect(tierTrial([], N)).toBe("UNCERTAIN");
    expect(tierTrial([c({ scoring: false })], N)).toBe("UNCERTAIN");
  });
  it("a trial whose every criterion is unresolved is UNCERTAIN, not STRONG", () => {
    expect(tierTrial([c({ category: null, status: "UNKNOWN", completeness: "unresolved" })], N)).toBe("UNCERTAIN");
  });
});

describe("tierTrial: rule D (FAIL must be independently verified)", () => {
  it.each([undefined, "not_run", "no_capacity", "rejected", "unsubstantiated"] as const)("FAIL with failCheck=%s stays UNCERTAIN, never LIKELY_MISMATCH", (failCheck) => {
    expect(tierTrial([c({ category: "stage" }), c({ status: "FAIL", failCheck })], N)).toBe("UNCERTAIN");
  });
  it("one verified FAIL is enough even when another FAIL is unverified", () => {
    expect(tierTrial([c({ status: "FAIL", failCheck: "unsubstantiated" }), c({ status: "FAIL", failCheck: "verified" })], N)).toBe("LIKELY_MISMATCH");
  });
  it("an unverified FAIL blocks STRONG and POSSIBLE", () => {
    expect(tierTrial([c({ category: "stage" }), c(), c({ status: "FAIL", failCheck: "no_capacity" })], N)).toBe("UNCERTAIN");
  });
  it("a non-scoring unverified FAIL is ignored", () => {
    expect(tierTrial([c({ category: "stage" }), c({ scoring: false, status: "FAIL" })], N)).toBe("STRONG");
  });
});

describe("tierTrialCapped: Policy R (self-report ceiling)", () => {
  const cap = (cs: TierCriterion[], o: Parameters<typeof tierTrialCapped>[1] = N) => tierTrialCapped(cs, o);
  it("row 1: all text-basis STRONG stays STRONG", () => {
    expect(cap([c({ category: "stage" }), c()])).toEqual({ tier: "STRONG", capped: false });
  });
  it("rows 2 and 7: a PASS resting on an edited fact caps STRONG at POSSIBLE", () => {
    expect(cap([c({ category: "stage", editedEvidence: true }), c()])).toEqual({ tier: "POSSIBLE", capped: true });
  });
  it("row 3: a verified FAIL on text-basis facts stays LIKELY_MISMATCH", () => {
    expect(cap([c({ status: "FAIL", failCheck: "verified" })])).toEqual({ tier: "LIKELY_MISMATCH", capped: false });
  });
  it("rows 4 and 8: a verified FAIL resting only on edited facts is UNCERTAIN", () => {
    expect(cap([c({ status: "FAIL", failCheck: "verified", editedEvidence: true })])).toEqual({ tier: "UNCERTAIN", capped: true });
  });
  it("a verified FAIL on text facts survives another FAIL that rests on an edited fact", () => {
    expect(cap([c({ status: "FAIL", failCheck: "verified" }), c({ status: "FAIL", failCheck: "verified", editedEvidence: true })]).tier).toBe("LIKELY_MISMATCH");
  });
  it("rows 5 and 6: unverified FAIL, overflow and failed analysis stay UNCERTAIN whatever the basis", () => {
    for (const editedEvidence of [false, true]) {
      expect(cap([c({ status: "FAIL", failCheck: "no_capacity", editedEvidence })]).tier).toBe("UNCERTAIN");
      expect(cap([c({ editedEvidence })], { ...N, analysisFailed: true }).tier).toBe("UNCERTAIN");
      expect(cap([c({ category: null, status: "UNKNOWN", completeness: "unresolved", editedEvidence })]).tier).toBe("UNCERTAIN");
    }
  });
  it("row 10: edited evidence on an UNKNOWN or non-deciding criterion changes nothing", () => {
    expect(cap([c({ category: "stage" }), c({ status: "UNKNOWN", editedEvidence: true })])).toEqual({ tier: "STRONG", capped: false });
  });
  it("the cap only lowers: it never raises any tier (exhaustive over small criterion sets)", () => {
    // claim strength: STRONG and LIKELY_MISMATCH are the two high claims; the cap may only move a result down this scale
    const rank = { STRONG: 3, LIKELY_MISMATCH: 3, POSSIBLE: 2, UNCERTAIN: 1 } as const;
    const statuses = ["PASS", "UNKNOWN", "AMBIGUOUS", "FAIL"] as const;
    for (const s1 of statuses) for (const s2 of statuses) for (const e1 of [false, true]) for (const e2 of [false, true]) for (const fc of ["verified", "no_capacity"] as const) {
      const cs = [c({ category: "stage", status: s1, failCheck: fc, editedEvidence: e1 }), c({ status: s2, failCheck: fc, editedEvidence: e2 })];
      const base = tierTrial(cs, N), r = tierTrialCapped(cs, N);
      if (r.capped) expect(rank[r.tier]).toBeLessThan(rank[base]);
      else expect(r.tier).toBe(base);
      // no edited fact ever carries a STRONG, and a mismatch always has an unedited verified FAIL behind it
      if (r.tier === "STRONG") expect(cs.some((x) => x.status === "PASS" && x.editedEvidence)).toBe(false);
      if (r.tier === "LIKELY_MISMATCH") expect(cs.some((x) => x.status === "FAIL" && x.failCheck === "verified" && !x.editedEvidence)).toBe(true);
    }
  });
});
