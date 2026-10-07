import { describe, expect, it } from "vitest";
import { applyCeilingToAssessment, assertEmittable, EMITTABLE_TIERS, enforceTrialCeiling } from "./ceiling";
import { trial } from "@/lib/live/fixtures.test-util";
import { TierSchema } from "@/schema/assessment";
import type { SseEvent } from "@/schema/sse";

const result = (over: Parameters<typeof trial>[0]): SseEvent => ({ type: "trial_result", assessment: trial(over) });

describe("applyCeilingToAssessment (Policy R2 at the result level)", () => {
  it("STRONG → POSSIBLE with reported_only; the verified flag is kept (a second pass found no conflict)", () => {
    const a = applyCeilingToAssessment(trial({ nct_id: "NCT00000001", tier: "STRONG", verified: true }));
    expect(a).toMatchObject({ tier: "POSSIBLE", verified: true, fact_basis: "visitor_reported" });
    expect(a.verifier_flags).toEqual(["reported_only"]);
  });

  it("LIKELY_MISMATCH → UNCERTAIN with reported_conflict, and verified becomes false (it must not read as verification)", () => {
    const a = applyCeilingToAssessment(trial({ nct_id: "NCT00000002", tier: "LIKELY_MISMATCH", verified: true }));
    expect(a).toMatchObject({ tier: "UNCERTAIN", verified: false, fact_basis: "visitor_reported" });
    expect(a.verifier_flags).toEqual(["reported_conflict"]);
  });

  it("POSSIBLE and UNCERTAIN keep their tier and flags; fact_basis is always set", () => {
    const p = applyCeilingToAssessment(trial({ nct_id: "NCT00000003", tier: "POSSIBLE", verified: true, verifier_flags: ["x"] }));
    const u = applyCeilingToAssessment(trial({ nct_id: "NCT00000004", tier: "UNCERTAIN", verifier_flags: ["analysis_pending"] }));
    expect(p).toMatchObject({ tier: "POSSIBLE", verified: true, verifier_flags: ["x"], fact_basis: "visitor_reported" });
    expect(u).toMatchObject({ tier: "UNCERTAIN", verified: false, verifier_flags: ["analysis_pending"], fact_basis: "visitor_reported" });
  });

  it("is idempotent for every tier (no duplicate flag, same result when applied twice)", () => {
    for (const tier of TierSchema.options) {
      const once = applyCeilingToAssessment(trial({ nct_id: "NCT00000005", tier, verified: true }));
      expect(applyCeilingToAssessment(once)).toEqual(once);
      expect(once.verifier_flags.filter((f) => f === "reported_only" || f === "reported_conflict").length).toBeLessThanOrEqual(1);
      expect(EMITTABLE_TIERS.has(once.tier)).toBe(true);
    }
  });

  it("an already-flagged conflict stays unverified even if a stored copy said verified:true", () => {
    const a = applyCeilingToAssessment(trial({ nct_id: "NCT00000006", tier: "UNCERTAIN", verified: true, verifier_flags: ["reported_conflict"] }));
    expect(a.verified).toBe(false);
  });
});

describe("enforceTrialCeiling and assertEmittable (the SSE backstop)", () => {
  it("caps every trial_result and leaves every other event untouched", () => {
    for (const tier of TierSchema.options) {
      const e = enforceTrialCeiling(result({ nct_id: "NCT00000007", tier }));
      expect(() => assertEmittable(e)).not.toThrow();
    }
    const others: SseEvent[] = [{ type: "stage", stage: "parse", status: "start" }, { type: "counts", selected: 3 }, { type: "done", replay: false }, { type: "question", questions: [] }];
    for (const o of others) expect(enforceTrialCeiling(o)).toBe(o);
  });

  it("assertEmittable throws on a forbidden tier that reaches it uncapped, and ignores non-result events", () => {
    expect(() => assertEmittable(result({ nct_id: "NCT00000008", tier: "STRONG" }))).toThrow("SSE_CONTRACT");
    expect(() => assertEmittable(result({ nct_id: "NCT00000009", tier: "LIKELY_MISMATCH" }))).toThrow("SSE_CONTRACT");
    expect(() => assertEmittable(result({ nct_id: "NCT00000010", tier: "POSSIBLE" }))).not.toThrow();
    expect(() => assertEmittable({ type: "done", replay: true })).not.toThrow();
  });
});
