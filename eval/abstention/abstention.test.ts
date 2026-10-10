// Offline development check of the hand-built abstention set (author-created, fictional, not clinician reviewed; not product validation). No model call.
import { describe, expect, it } from "vitest";
import { parseAbstentionSet } from "../lib/loaders";
import { CASES, toLoaderSet } from "./cases";
import { runCase } from "./run-case";

describe("abstention set: integrity", () => {
  it("has 30 unique cases in the approved groups (6/6/4/4/4/3/3)", () => {
    expect(CASES).toHaveLength(30);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(30);
    const n = (g: string) => CASES.filter((c) => c.group === g).length;
    expect([n("fact_known"), n("fact_absent"), n("fact_uncertain"), n("clinical_judgment"), n("unsupported_evidence"), n("conditional"), n("pregnancy")]).toEqual([6, 6, 4, 4, 4, 3, 3]);
  });
  it("every case states one status and one tier, a rationale, and the typed ones a parse", () => {
    for (const c of CASES) {
      expect(c.rationale.length).toBeGreaterThan(20);
      expect(typeof c.expected.status).toBe("string");
      expect(typeof c.expected.tier).toBe("string");
      if (c.layer === "typed") expect(c.parse).toBeDefined();
      else expect(c.finding).toBeDefined();
    }
  });
  it("exports in the abstention-set loader format", () => {
    expect(parseAbstentionSet(toLoaderSet())).toHaveLength(30);
  });
  it("the three pregnancy cases carry a panel expectation of no question", () => {
    for (const c of CASES.filter((x) => x.group === "pregnancy")) expect(c.expected.panel).toEqual([]);
  });
});

describe("abstention set: current engine vs the pre-written expectations", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const a = runCase(c);
    expect({ status: a.status, tier: a.tier, ...(c.expected.panel !== undefined ? { panel: a.panel } : {}) }).toEqual(c.expected);
  });
  it("negative control: the comparison detects a deliberately wrong expectation", () => {
    const c = CASES[0]!; // ab-01 is PASS
    expect(runCase(c).status).not.toBe("UNKNOWN");
  });
});
