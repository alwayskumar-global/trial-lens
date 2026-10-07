// Offline feasibility check (docs/eval-annotation-mapping.md section 14): can the EXISTING free-text criterion judgment step (stage "evaluate" in
// src/lib/pipeline/run.ts: EVAL_SYSTEM + makeEvalSchema + applyAbstentionGuard) take one note and one criterion as they are? SYNTHETIC fixtures only;
// no model call, no dataset content, nothing is run on the annotation set. These tests pin what the current step does; they do not adapt it.
import { describe, expect, it } from "vitest";
import { EVAL_SYSTEM, makeEvalSchema } from "@/prompts/evaluate";
import { applyAbstentionGuard } from "@/lib/engine/guard";
import { FACT_KEYS } from "@/schema/vocabulary";
import { profile } from "@/lib/engine/test-helpers";
import type { CriterionFinding } from "@/schema/criteria";

const finding = (status: CriterionFinding["status"], evidence: string[]): CriterionFinding =>
  ({ criterion_id: "c1", status, evidence, rationale: "synthetic", source: "llm_mid" }) as CriterionFinding;

describe("existing evaluate step vs one note + one criterion (synthetic)", () => {
  it("its user prompt carries structured 'confirmed facts' (JSON by vocabulary key), not a note: there is no slot for note text", () => {
    expect(EVAL_SYSTEM).toContain("patient's confirmed facts");
    expect(EVAL_SYSTEM).toContain('"evidence": the fact keys you relied on');
    expect(EVAL_SYSTEM).not.toMatch(/\bnote\b/i);
  });

  it("the vocabulary is a fixed breast-cancer-screening key list; a general-disease criterion has no key to cite", () => {
    expect(FACT_KEYS.length).toBeGreaterThan(0);
    for (const k of ["synthetic_condition", "note_text", "free_text"]) expect((FACT_KEYS as readonly string[]).includes(k)).toBe(false);
  });

  it("a PASS/FAIL citing a key outside the vocabulary (e.g. a note) is coerced to UNKNOWN by the abstention guard", () => {
    for (const s of ["PASS", "FAIL"] as const) {
      const r = applyAbstentionGuard(finding(s, ["note_text"]), profile());
      expect(r.finding.status).toBe("UNKNOWN");
      expect(r.downgraded).toBe(true);
    }
  });

  it("a PASS/FAIL with no evidence, or citing a vocabulary key that is not 'known', is coerced to UNKNOWN", () => {
    expect(applyAbstentionGuard(finding("PASS", []), profile()).finding.status).toBe("UNKNOWN");
    expect(applyAbstentionGuard(finding("FAIL", ["ecog"]), profile()).finding.status).toBe("UNKNOWN"); // ecog unknown in this profile
  });

  it("only a call citing known vocabulary facts survives (so any survivor reflects the extracted vocabulary facts, not the note)", () => {
    const r = applyAbstentionGuard(finding("FAIL", ["ecog"]), profile({ ecog: "3" }));
    expect(r.finding.status).toBe("FAIL");
    expect(r.downgraded).toBe(false);
  });

  it("the output schema is one-to-one by index and has a fourth status AMBIGUOUS that the reviewer scheme (PASS/FAIL/UNKNOWN) does not have", () => {
    const schema = makeEvalSchema(1);
    expect(schema.safeParse({ findings: [{ index: 0, status: "AMBIGUOUS", evidence: [], rationale: "x" }] }).success).toBe(true);
    expect(schema.safeParse({ findings: [{ index: 0, status: "PASS", evidence: ["ecog"], rationale: "x" }, { index: 0, status: "PASS", evidence: [], rationale: "x" }] }).success).toBe(false);
    expect(schema.safeParse({ findings: [] }).success).toBe(false);
  });
});
