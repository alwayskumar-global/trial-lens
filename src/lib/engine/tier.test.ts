import { describe, expect, it } from "vitest";
import { tierTrial, type TierCriterion } from "./tier";

const c = (o: Partial<TierCriterion> = {}): TierCriterion => ({ scoring: true, category: "lab", status: "PASS", completeness: "full", ...o });
const N = { unknownThreshold: 3 };

describe("tierTrial: SPEC rules", () => {
  it("any FAIL → LIKELY_MISMATCH, even with unresolved criteria", () => {
    expect(tierTrial([c({ status: "FAIL" }), c({ category: null, status: "UNKNOWN", completeness: "unresolved" })], N)).toBe("LIKELY_MISMATCH");
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
