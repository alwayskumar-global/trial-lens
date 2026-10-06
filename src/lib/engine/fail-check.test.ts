import { describe, expect, it } from "vitest";
import { resolveFailCheck, substantiationProblem, withFailCheck } from "./fail-check";
import { profile } from "./test-helpers";
import { makeFailCheckBatchSchema, type FailCheckItem } from "@/schema/fail-check";
import type { CriterionFinding } from "@/schema/criteria";

const TEXT = "Participants must have HER2-negative disease and must not have stage IV (metastatic) breast cancer.";
const P = profile({ stage: "IV", her2_status: "negative", age: 52 });
const item = (o: Partial<FailCheckItem> = {}): FailCheckItem => ({ index: 0, verdict: "confirmed", source_quote: "must not have stage IV (metastatic) breast cancer", facts_used: [{ key: "stage", value: "IV" }], ...o });

describe("substantiation (evidence-backed)", () => {
  it("accepts a verbatim quote with known, matching facts", () => expect(substantiationProblem(TEXT, item(), P)).toBeNull());
  it("rejects a paraphrased / absent quote", () => {
    expect(substantiationProblem(TEXT, item({ source_quote: "excludes metastatic patients" }), P)).toBe("quote_not_in_criterion");
    expect(substantiationProblem(TEXT, item({ source_quote: null }), P)).toBe("quote_not_in_criterion");
  });
  it("rejects a confirmed verdict that cites no patient fact", () => expect(substantiationProblem(TEXT, item({ facts_used: [] }), P)).toBe("no_facts"));
  it("rejects facts that are unknown in the profile or not vocabulary keys", () => {
    expect(substantiationProblem(TEXT, item({ facts_used: [{ key: "ecog", value: "1" }] }), P)).toBe("fact_not_known");
    expect(substantiationProblem(TEXT, item({ facts_used: [{ key: "made_up", value: "x" }] }), P)).toBe("fact_not_known");
  });
  it("rejects a fact value that differs from the profile (verifier hallucinated the patient)", () => {
    expect(substantiationProblem(TEXT, item({ facts_used: [{ key: "stage", value: "II" }] }), P)).toBe("fact_value_mismatch");
  });
  it("numbers compare numerically", () => {
    expect(substantiationProblem("Age must be 18 to 45 years", item({ source_quote: "18 to 45 years", facts_used: [{ key: "age", value: 52 }] }), P)).toBeNull();
    expect(substantiationProblem("Age must be 18 to 45 years", item({ source_quote: "18 to 45 years", facts_used: [{ key: "age", value: 51 }] }), P)).toBe("fact_value_mismatch");
  });
});

describe("resolveFailCheck", () => {
  it("verified only when confirmed AND substantiated", () => expect(resolveFailCheck(TEXT, item(), P)).toBe("verified"));
  it("confirmed but unsubstantiated ⇒ unsubstantiated (⇒ UNCERTAIN)", () => expect(resolveFailCheck(TEXT, item({ facts_used: [] }), P)).toBe("unsubstantiated"));
  it("cannot_substantiate ⇒ unsubstantiated", () => expect(resolveFailCheck(TEXT, item({ verdict: "cannot_substantiate", source_quote: null, facts_used: [] }), P)).toBe("unsubstantiated"));
  it("not_confirmed ⇒ rejected", () => expect(resolveFailCheck(TEXT, item({ verdict: "not_confirmed", source_quote: null, facts_used: [] }), P)).toBe("rejected"));
  it("missing verdict ⇒ not_run; no slot ⇒ no_capacity", () => {
    expect(resolveFailCheck(TEXT, undefined, P)).toBe("not_run");
    expect(resolveFailCheck(TEXT, "no_capacity", P)).toBe("no_capacity");
  });
});

describe("withFailCheck / batch schema", () => {
  const f = (status: CriterionFinding["status"]): CriterionFinding => ({ criterion_id: "c", status, evidence: [], rationale: "", source: "code" });
  it("only annotates FAIL findings", () => {
    expect(withFailCheck(f("FAIL"), "verified").fail_check).toBe("verified");
    expect(withFailCheck(f("PASS"), "verified").fail_check).toBeUndefined();
  });
  it("verifier batch must return exactly the requested indices", () => {
    const s = makeFailCheckBatchSchema(2);
    const v = (index: number) => ({ index, verdict: "cannot_substantiate" as const, source_quote: null, facts_used: [] });
    expect(s.safeParse({ verdicts: [v(0), v(1)] }).success).toBe(true);
    expect(s.safeParse({ verdicts: [v(0)] }).success).toBe(false);
    expect(s.safeParse({ verdicts: [v(0), v(0), v(1)] }).success).toBe(false);
    expect(s.safeParse({ verdicts: [v(0), v(1), v(2)] }).success).toBe(false);
  });
});
