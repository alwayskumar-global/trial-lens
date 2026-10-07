// Tests for the PROPOSED dependency verification (not wired). Fictional criteria only.
import { describe, expect, it } from "vitest";
import { leafToNode, toClauseTree } from "./clause";
import { citesOnlyVerified, verifyDependencies } from "./dependency-verify";
import { atom, crit, text } from "./test-helpers";

const clause = (c: ReturnType<typeof crit>) => toClauseTree(c);

describe("verifyDependencies", () => {
  it("parser falsely declares `age` for a hemoglobin criterion: age is declared but NOT verified, so a PASS citing age is rejected", () => {
    const c = clause(crit([text("Hemoglobin of at least 9 g/dL", ["age"])], { category: "lab" }));
    const r = verifyDependencies(c);
    expect(r.declared).toEqual(["age"]);
    expect(r.verified).toEqual([]);
    expect(r.unverified).toEqual(["age"]);
    expect(citesOnlyVerified(["age"], r)).toBe(false); // the rel-01 shape: known but irrelevant
  });

  it("the same criterion with the correct declaration verifies hemoglobin and accepts a PASS citing it (the rel-03 shape)", () => {
    const r = verifyDependencies(clause(crit([text("Hemoglobin of at least 9 g/dL", ["hemoglobin"])], { category: "lab" })));
    expect(r.verified).toEqual(["hemoglobin"]);
    expect(citesOnlyVerified(["hemoglobin"], r)).toBe(true);
    expect(citesOnlyVerified(["hemoglobin", "age"], r)).toBe(false); // one irrelevant key is enough to reject
  });

  it("an undeclared but relevant key is not verified (the check never adds dependencies)", () => {
    const r = verifyDependencies(clause(crit([text("Hemoglobin of at least 9 g/dL", [])], { category: "lab" })));
    expect(r.declared).toEqual([]);
    expect(citesOnlyVerified(["hemoglobin"], r)).toBe(false); // conservative: no declared dependency, no free-text PASS/FAIL
    expect(citesOnlyVerified([], r)).toBe(false);
  });

  it("the verification is local to the declaring leaf's own source, not the whole criterion", () => {
    const c = clause(crit([text("Hemoglobin of at least 9 g/dL", ["age"]), text("in adults", [])], { combine: "all", category: "lab" }));
    expect(verifyDependencies(c).verified).toEqual([]); // 'adults' sits in another leaf; it cannot vouch for age declared on the hemoglobin leaf
  });

  it("a semantically unsound atom does not verify its key (the pregnancy-test guard)", () => {
    const l = leafToNode(atom("Pregnancy-test", "pregnant", "eq", true));
    const r = verifyDependencies(l);
    expect(r.declared).toEqual(["pregnant"]);
    expect(r.verified).toEqual([]);
  });

  it("LIMITATION (documents why the loose cue table cannot gate anything): wording that happens to contain a loose cue verifies a false declaration", () => {
    const r = verifyDependencies(clause(crit([text("Hemoglobin of at least 9 g/dL in adults", ["age"])], { category: "lab" })));
    expect(r.verified).toEqual(["age"]); // 'adults' matches the loose age cue; a strict anchored table (e.g. 'aged N', 'N years') would not
  });

  it("the cue table is injectable, which is how a strict table would replace the loose one", () => {
    const strict = (k: string) => (k === "age" ? /\baged?\s+\d+|\b\d+\s*years?\b/i : /$^/);
    const r = verifyDependencies(clause(crit([text("Hemoglobin of at least 9 g/dL in adults", ["age"])], { category: "lab" })), strict as never);
    expect(r.verified).toEqual([]);
  });
});
