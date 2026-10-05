import { describe, expect, it } from "vitest";
import { classifyCompleteness, evaluateClause, leaves, statusFromTruth, toClauseTree, atomProblems } from "./clause";
import { atom, crit, profile, text, timing } from "./test-helpers";
import { ClauseNodeSchema } from "@/schema/clause";

const tree = (c: ReturnType<typeof crit>) => toClauseTree(c);

describe("clause tree + exact source text", () => {
  it("round-trips through the recursive Zod schema and keeps every source fragment verbatim", () => {
    const t = tree(crit([atom("ANC ≥ 1500/mm3", "anc", "gte", 1500, "/mm3"), text("adequate liver function")], { except: [text("unless Gilbert's")] }));
    expect(ClauseNodeSchema.safeParse(t).success).toBe(true);
    expect(leaves(t).map((l) => l.source)).toEqual(["ANC ≥ 1500/mm3", "adequate liver function", "unless Gilbert's"]);
  });
  it("single leaf without exceptions is the leaf itself", () => {
    expect(tree(crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])])).kind).toBe("atom");
  });
});

describe("completeness", () => {
  it("full only when every leaf is an executable atom", () => {
    expect(classifyCompleteness(tree(crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])])))).toBe("full");
    expect(classifyCompleteness(tree(crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"]), text("other")])))).toBe("partial");
    expect(classifyCompleteness(tree(crit([timing("within 4 weeks", "within_last", 4, "weeks")])))).toBe("partial");
    expect(classifyCompleteness(null)).toBe("unresolved");
  });
  it("atom with missing/unconvertible unit is not executable", () => {
    expect(atomProblems(tree(crit([atom("ANC ≥1500", "anc", "gte", 1500, null)])) as never)).toContain("unit_missing_or_unconvertible");
    expect(classifyCompleteness(tree(crit([atom("CrCl", "creatinine_clearance", "gte", 60, "mL/min/1.73m2")])))).toBe("partial");
  });
  it("enum value outside vocabulary / wrong operator is not executable", () => {
    expect(classifyCompleteness(tree(crit([atom("x", "ecog", "in", ["0", "9"])])))).toBe("partial");
    expect(classifyCompleteness(tree(crit([atom("x", "ecog", "gte", "1")])))).toBe("partial");
  });
});

describe("three-valued evaluation", () => {
  it("converts units in code: 1500/mm3 vs ANC 1.2 x10^9/L → false", () => {
    const t = tree(crit([atom("ANC ≥ 1500/mm3", "anc", "gte", 1500, "/mm3")]));
    expect(evaluateClause(t, profile({ anc: 1.2 })).truth).toBe("false");
    expect(evaluateClause(t, profile({ anc: 1.6 })).truth).toBe("true");
  });
  it("hemoglobin g/L is divided by 10", () => {
    const t = tree(crit([atom("Hb ≥ 90 g/L", "hemoglobin", "gte", 90, "g/L")]));
    expect(evaluateClause(t, profile({ hemoglobin: 9.5 })).truth).toBe("true");
    expect(evaluateClause(t, profile({ hemoglobin: 8.5 })).truth).toBe("false");
  });
  it("unknown fact → unknown, no evidence", () => {
    const r = evaluateClause(tree(crit([atom("x", "ecog", "in", ["0", "1"])])), profile());
    expect(r).toEqual({ truth: "unknown", evidence: [] });
  });
  it("AND short-circuits on a known false even with a text leaf; stays unknown otherwise", () => {
    const t = tree(crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"]), text("something else")]));
    expect(evaluateClause(t, profile({ ecog: "3" })).truth).toBe("false");
    expect(evaluateClause(t, profile({ ecog: "1" })).truth).toBe("unknown");
  });
  it("OR short-circuits on a known true", () => {
    const t = tree(crit([atom("HER2+", "her2_status", "eq", "positive"), text("or HER2-low by ISH")], { combine: "any" }));
    expect(evaluateClause(t, profile({ her2_status: "positive" })).truth).toBe("true");
    expect(evaluateClause(t, profile({ her2_status: "negative" })).truth).toBe("unknown");
  });
  it("exceptions: base AND NOT(any exception)", () => {
    const t = tree(crit([atom("prior malignancy", "prior_other_malignancy", "eq", true)], { except: [atom("adequately treated skin cancer", "cardiac_disease", "eq", "none")] }));
    // base true, exception true → condition false
    expect(evaluateClause(t, profile({ prior_other_malignancy: true, cardiac_disease: "none" })).truth).toBe("false");
    // base true, exception false → true
    expect(evaluateClause(t, profile({ prior_other_malignancy: true, cardiac_disease: "active" })).truth).toBe("true");
    // base true, exception unknown → unknown
    expect(evaluateClause(t, profile({ prior_other_malignancy: true })).truth).toBe("unknown");
  });
  it("timing leaves are never decided in code", () => {
    expect(evaluateClause(tree(crit([timing("within 28 days", "within_last", 28, "days")])), profile()).truth).toBe("unknown");
  });
  it("days_since_last_systemic_therapy converts weeks", () => {
    const t = tree(crit([atom("no systemic therapy within 4 weeks", "days_since_last_systemic_therapy", "gte", 4, "weeks")]));
    expect(evaluateClause(t, profile({ days_since_last_systemic_therapy: 20 })).truth).toBe("false");
    expect(evaluateClause(t, profile({ days_since_last_systemic_therapy: 40 })).truth).toBe("true");
  });
});

describe("status mapping", () => {
  it("inclusion/exclusion × truth", () => {
    expect(statusFromTruth("inclusion", "true")).toBe("PASS");
    expect(statusFromTruth("inclusion", "false")).toBe("FAIL");
    expect(statusFromTruth("exclusion", "true")).toBe("FAIL");
    expect(statusFromTruth("exclusion", "false")).toBe("PASS");
    expect(statusFromTruth("exclusion", "unknown")).toBe("UNKNOWN");
  });
});
