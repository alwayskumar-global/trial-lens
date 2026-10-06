import { describe, expect, it } from "vitest";
import { tierTrial, type TierCriterion } from "./tier";

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
