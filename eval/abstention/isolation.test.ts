// Additions to the abstention set (cases.ts is unchanged): guard-isolation cases and the relevance negative control. Offline; no model call.
import { describe, expect, it } from "vitest";
import { GUARD_CASES, RELEVANCE_CASES } from "./isolation";
import { runGuardCase, runRelevanceCase } from "./run-isolation";

describe("guard isolation: the atom survives vetting, then the named guard (and only it) makes the criterion UNKNOWN", () => {
  it.each(GUARD_CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const a = runGuardCase(c);
    expect(a.vet).toBe("ok"); // an earlier vetting rejection is not a guard pass
    expect(a.leafKind).toBe("atom");
    expect(a.problems).toEqual([c.guard]); // exactly this guard's reason
    expect({ completeness: a.completeness, status: a.status, evidence: a.evidence }).toEqual({ completeness: c.expected.completeness, status: c.expected.status, evidence: c.expected.evidence });
  });
});

describe("relevance (production path: abstention guard, then the fail-closed rule)", () => {
  // rel-01 and rel-02 were `it.fails` (KNOWN FAILURE) until the fail-closed rule was wired; they now pass normally with their ORIGINAL expectations.
  it.each(RELEVANCE_CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(runRelevanceCase(c)).toEqual(c.expected);
  });
  it("rel-01 and rel-02 keep their pre-written expectation of UNKNOWN", () => {
    expect(RELEVANCE_CASES.slice(0, 2).map((c) => c.expected.status)).toEqual(["UNKNOWN", "UNKNOWN"]);
  });
});
