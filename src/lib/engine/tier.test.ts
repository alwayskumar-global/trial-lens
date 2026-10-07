import { describe, expect, it } from "vitest";
import { ceilingTier, tierTrial, tierTrialCeiled, type TierCriterion } from "./tier";

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

describe("Policy R2: no visitor fact is verified, so STRONG and LIKELY_MISMATCH are never emitted", () => {
  const ceiled = (cs: TierCriterion[], o: Parameters<typeof tierTrialCeiled>[1] = N) => tierTrialCeiled(cs, o);

  it("ceilingTier maps all four tiers", () => {
    expect(ceilingTier("STRONG")).toEqual({ tier: "POSSIBLE", flag: "reported_only" });
    expect(ceilingTier("LIKELY_MISMATCH")).toEqual({ tier: "UNCERTAIN", flag: "reported_conflict" });
    expect(ceilingTier("POSSIBLE")).toEqual({ tier: "POSSIBLE" });
    expect(ceilingTier("UNCERTAIN")).toEqual({ tier: "UNCERTAIN" });
  });

  // The approved truth table, row by row (engine outcome, Rule D / verification state → final tier, flag).
  it("row 1: a scoring FAIL whose Rule D check is verified → UNCERTAIN + reported_conflict", () => {
    expect(ceiled([c({ status: "FAIL", failCheck: "verified" })])).toEqual({ tier: "UNCERTAIN", flag: "reported_conflict" });
    expect(ceiled([c({ status: "FAIL", failCheck: "verified" }), c({ status: "FAIL", failCheck: "no_capacity" }), c()]).tier).toBe("UNCERTAIN");
  });
  it("rows 2-5: an unverified FAIL (not_run, no_capacity, rejected, unsubstantiated) → UNCERTAIN, no flag", () => {
    for (const failCheck of [undefined, "not_run", "no_capacity", "rejected", "unsubstantiated"] as const) {
      expect(ceiled([c({ status: "FAIL", ...(failCheck ? { failCheck } : {}) })])).toEqual({ tier: "UNCERTAIN" });
    }
  });
  it("row 6: analysis failed, pending/unresolved, missing or no scoring criteria → UNCERTAIN", () => {
    expect(ceiled([c()], { ...N, analysisFailed: true }).tier).toBe("UNCERTAIN");
    expect(ceiled([c({ category: null, status: "UNKNOWN", completeness: "unresolved" })]).tier).toBe("UNCERTAIN");
    expect(ceiled([c(), c()], { ...N, expectedCriteria: 3 }).tier).toBe("UNCERTAIN");
    expect(ceiled([]).tier).toBe("UNCERTAIN");
  });
  it("row 7: a core criterion UNKNOWN, AMBIGUOUS or partial → UNCERTAIN", () => {
    expect(ceiled([c({ category: "stage", status: "UNKNOWN" })]).tier).toBe("UNCERTAIN");
    expect(ceiled([c({ category: "biomarker", status: "AMBIGUOUS" })]).tier).toBe("UNCERTAIN");
    expect(ceiled([c({ category: "biomarker", completeness: "partial" })]).tier).toBe("UNCERTAIN");
  });
  it("row 8: a non-core partial criterion, or more open criteria than N, → POSSIBLE with no flag", () => {
    expect(ceiled([c({ category: "stage" }), c({ completeness: "partial" })])).toEqual({ tier: "POSSIBLE" });
    const u = () => c({ status: "UNKNOWN" });
    expect(ceiled([c({ category: "stage" }), u(), u(), u(), u()])).toEqual({ tier: "POSSIBLE" });
  });
  it("row 9: everything passes and is fully parsed (the engine's STRONG) → POSSIBLE + reported_only", () => {
    expect(ceiled([c({ category: "stage" }), c()])).toEqual({ tier: "POSSIBLE", flag: "reported_only" });
    const u = () => c({ status: "UNKNOWN" });
    expect(ceiled([c({ category: "stage" }), u(), u(), u()])).toEqual({ tier: "POSSIBLE", flag: "reported_only" }); // open ≤ N is still the engine's STRONG
  });

  const statuses = ["PASS", "UNKNOWN", "AMBIGUOUS", "FAIL"] as const;
  const checks = [undefined, "verified", "rejected", "unsubstantiated", "no_capacity", "not_run"] as const;
  const completes = ["full", "partial", "unresolved"] as const;
  const cats = ["stage", "lab", null] as const;
  const one: TierCriterion[] = [];
  for (const scoring of [true, false]) for (const status of statuses) for (const failCheck of checks) for (const completeness of completes) for (const category of cats) {
    one.push({ scoring, category, status, completeness, ...(failCheck ? { failCheck } : {}) });
  }

  it("exhaustive over every one- and two-criterion combination: only POSSIBLE or UNCERTAIN, never above the engine tier, idempotent", () => {
    const strength = { STRONG: 3, LIKELY_MISMATCH: 3, POSSIBLE: 2, UNCERTAIN: 1 } as const;
    // Millions of combinations: collect violations with plain comparisons and assert once (per-combination expect() calls made this
    // test take about 4 s and time out under load).
    const bad: string[] = [];
    const check = (cs: TierCriterion[], o: Parameters<typeof tierTrial>[1]) => {
      const engine = tierTrial(cs, o), r = tierTrialCeiled(cs, o);
      const again = ceilingTier(r.tier);
      const flag = engine === "STRONG" ? "reported_only" : engine === "LIKELY_MISMATCH" ? "reported_conflict" : undefined;
      const ok =
        (r.tier === "POSSIBLE" || r.tier === "UNCERTAIN") &&
        strength[r.tier] <= strength[engine] &&
        (engine === "POSSIBLE" || engine === "UNCERTAIN" ? r.tier === engine && r.flag === undefined : true) &&
        again.tier === r.tier && again.flag === undefined && // idempotent: applying it again changes nothing
        r.flag === flag; // the flags say exactly what happened
      if (!ok && bad.length < 5) bad.push(JSON.stringify({ cs, o, engine, r }));
    };
    for (const a of one) {
      check([a], N);
      check([a], { ...N, expectedCriteria: 2 });
      check([a], { ...N, analysisFailed: true });
    }
    for (const a of one) for (const b of one) check([a, b], N);
    expect(bad).toEqual([]);
  });

  it("a would-be mismatch needs a verified FAIL; without one the engine itself never reaches it (Rule D unchanged)", () => {
    let mismatches = 0;
    for (const a of one) for (const b of one) {
      if (tierTrial([a, b], N) === "LIKELY_MISMATCH") {
        mismatches++;
        expect([a, b].some((x) => x.scoring && x.status === "FAIL" && x.failCheck === "verified")).toBe(true);
      }
    }
    expect(mismatches).toBeGreaterThan(0);
  });
});
