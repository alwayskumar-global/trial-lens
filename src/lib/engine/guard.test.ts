import { describe, expect, it } from "vitest";
import { applyAbstentionGuard } from "./guard";
import { profile } from "./test-helpers";
import type { CriterionFinding } from "@/schema/criteria";

const f = (status: CriterionFinding["status"], evidence: string[]): CriterionFinding => ({ criterion_id: "c", status, evidence, rationale: "r", source: "llm_mid" });

describe("abstention guard", () => {
  it("keeps PASS/FAIL backed by known evidence", () => {
    expect(applyAbstentionGuard(f("PASS", ["ecog"]), profile({ ecog: "1" }))).toMatchObject({ downgraded: false });
  });
  it("coerces PASS with no evidence to UNKNOWN", () => {
    const r = applyAbstentionGuard(f("PASS", []), profile({ ecog: "1" }));
    expect(r.downgraded).toBe(true);
    expect(r.finding).toMatchObject({ status: "UNKNOWN", guard_downgraded: true, evidence: [] });
  });
  it("coerces FAIL citing an unknown fact", () => {
    expect(applyAbstentionGuard(f("FAIL", ["her2_status"]), profile()).downgraded).toBe(true);
  });
  it("coerces evidence that is not a vocabulary key", () => {
    expect(applyAbstentionGuard(f("PASS", ["made_up"]), profile({ ecog: "1" })).downgraded).toBe(true);
  });
  it("does not touch UNKNOWN / AMBIGUOUS", () => {
    expect(applyAbstentionGuard(f("UNKNOWN", []), profile()).downgraded).toBe(false);
    expect(applyAbstentionGuard(f("AMBIGUOUS", []), profile()).downgraded).toBe(false);
  });
  it("a single unsupported key among several downgrades the finding", () => {
    expect(applyAbstentionGuard(f("PASS", ["ecog", "her2_status"]), profile({ ecog: "1" })).downgraded).toBe(true);
  });
});
