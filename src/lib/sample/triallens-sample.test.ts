import { describe, expect, it } from "vitest";
import { TRIALS } from "./triallens-sample";

// The sample is a fixed fictional fixture, not engine output. It must not depict a result the engine's conservative
// tier rules would not produce (0 STRONG in every measured cohort; LIKELY_MISMATCH only with a verified FAIL).
describe("sample fixture honesty", () => {
  it("shows no STRONG tier", () => {
    expect(TRIALS.some((t) => t.tier === "strong")).toBe(false);
  });
  it("shows no LIKELY_MISMATCH tier (needs a verified FAIL)", () => {
    expect(TRIALS.some((t) => t.tier === "mismatch")).toBe(false);
  });
  it("a trial with a conflict or judgment row is never above UNCERTAIN", () => {
    for (const t of TRIALS) {
      if (t.why.some((w) => w.status === "conflict" || w.status === "judgment")) expect(["uncertain", "mismatch"]).toContain(t.tier);
    }
  });
  it("contains no LIKELY_MISMATCH entries (no Rule D check backs any fixture mismatch)", () => {
    expect(TRIALS.some((t) => t.tier === "mismatch")).toBe(false);
  });
});
