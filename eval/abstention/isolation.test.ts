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

describe("relevance: a PASS/FAIL citing known but irrelevant facts", () => {
  // KNOWN FAILURES, kept visible: the guard checks that cited keys are known, not that they are relevant. `it.fails` passes while the expectation is still unmet and
  // starts failing the moment a relevance check is added, which is the signal to remove it. The expectation is NOT weakened.
  it.fails("KNOWN FAILURE rel-01: PASS citing known age for a hemoglobin criterion must be UNKNOWN", () => {
    expect(runRelevanceCase(RELEVANCE_CASES[0]!)).toEqual(RELEVANCE_CASES[0]!.expected);
  });
  it.fails("KNOWN FAILURE rel-02: FAIL citing known sex/ecog for a cardiac exclusion must be UNKNOWN", () => {
    expect(runRelevanceCase(RELEVANCE_CASES[1]!)).toEqual(RELEVANCE_CASES[1]!.expected);
  });
  it("positive control rel-03: a PASS citing the criterion's own known fact survives", () => {
    expect(runRelevanceCase(RELEVANCE_CASES[2]!)).toEqual(RELEVANCE_CASES[2]!.expected);
  });
});
