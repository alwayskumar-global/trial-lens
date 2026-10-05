import { describe, expect, it } from "vitest";
import { checkIndices, isSourceFragment } from "./checks";
import { assessCriterion, reconcileBatch, type SourceCriterion } from "./reconcile";
import { makeClauseBatchSchema, type LlmClauseBatch } from "@/schema/clause";
import { atom, crit, profile, text } from "./test-helpers";

const src = (i: number, type: "inclusion" | "exclusion", t: string): SourceCriterion => ({ id: `NCT1:${type}:${i}`, nct_id: "NCT1", type, text: t });
const sources = [src(0, "inclusion", "ECOG 0-1"), src(1, "exclusion", "Pregnant or breastfeeding women"), src(2, "inclusion", "Adequate organ function")];
const texts = sources.map((s) => s.text);
const item = (index: number, c: ReturnType<typeof crit>) => ({ index, ...c });

describe("checkIndices", () => {
  it("flags missing, duplicate and unexpected", () => {
    expect(checkIndices(3, [0, 1, 2]).ok).toBe(true);
    expect(checkIndices(3, [0, 2])).toMatchObject({ ok: false, missing: [1] });
    expect(checkIndices(3, [0, 1, 1, 2])).toMatchObject({ ok: false, duplicate: [1] });
    expect(checkIndices(3, [0, 1, 2, 3])).toMatchObject({ ok: false, unexpected: [3] });
    expect(checkIndices(3, [-1, 0, 1, 2])).toMatchObject({ ok: false, unexpected: [-1] });
  });
});

describe("source fragment check", () => {
  it("accepts exact fragments (case/whitespace/markdown-insensitive), rejects paraphrase", () => {
    expect(isSourceFragment("Pregnant  or breastfeeding\nwomen", "pregnant or breastfeeding")).toBe(true);
    expect(isSourceFragment("ANC ≥ 1.5 × 10\\^9/L", "anc ≥ 1.5 × 10^9/l")).toBe(true);
    expect(isSourceFragment("Pregnant or breastfeeding women", "is pregnant")).toBe(false);
    expect(isSourceFragment("anything", "")).toBe(false);
  });
});

describe("batch schema rejects bad batches (so the caller retries once)", () => {
  const schema = makeClauseBatchSchema(texts);
  const good = { criteria: [item(0, crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])])), item(1, crit([text("Pregnant")])), item(2, crit([text("Adequate organ function")]))] };
  it("accepts a complete, in-source batch", () => expect(schema.safeParse(good).success).toBe(true));
  it("rejects a missing index and names it without echoing text", () => {
    const r = schema.safeParse({ criteria: [good.criteria[0], good.criteria[2]] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("missing indices [1]");
      expect(msg).not.toContain("ECOG");
    }
  });
  it("rejects duplicate and unexpected indices", () => {
    expect(schema.safeParse({ criteria: [...good.criteria, item(1, crit([text("Pregnant")]))] }).success).toBe(false);
    expect(schema.safeParse({ criteria: [...good.criteria, item(7, crit([text("x")]))] }).success).toBe(false);
  });
  it("rejects a leaf whose source is not a fragment of the original", () => {
    const bad = { criteria: [item(0, crit([text("Performance status is good")])), good.criteria[1], good.criteria[2]] };
    expect(schema.safeParse(bad).success).toBe(false);
  });
  it("rejects an atom leaf missing operator/value", () => {
    const leaf = { ...atom("ECOG 0-1", "ecog", "in", ["0", "1"]), operator: null };
    expect(schema.safeParse({ criteria: [item(0, crit([leaf])), good.criteria[1], good.criteria[2]] }).success).toBe(false);
  });
});

describe("reconcileBatch preserves every original criterion", () => {
  const schema = makeClauseBatchSchema(texts);
  it("null batch → all unresolved, same length and order", () => {
    const out = reconcileBatch(sources, null);
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.state === "unresolved")).toBe(true);
  });
  it("unvalidated batch with a missing index is rejected defensively", () => {
    const bad = { criteria: [item(0, crit([text("ECOG 0-1")])), item(2, crit([text("Adequate organ function")]))] } as LlmClauseBatch;
    const out = reconcileBatch(sources, bad);
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.state === "unresolved")).toBe(true);
  });
  it("valid batch → parsed, completeness classified", () => {
    const batch = schema.parse({ criteria: [item(0, crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])])), item(1, crit([text("Pregnant or breastfeeding")])), item(2, crit([text("Adequate organ function")]))] });
    const out = reconcileBatch(sources, batch);
    expect(out.map((o) => (o.state === "parsed" ? o.completeness : o.state))).toEqual(["full", "partial", "partial"]);
  });
  it("unresolved criterion becomes an UNKNOWN scoring finding, never disappears", () => {
    const [o] = reconcileBatch([sources[0]!], null, "not_attempted");
    const a = assessCriterion(sources[0]!, o!, profile());
    expect(a).toMatchObject({ scoring: true, completeness: "unresolved", category: null });
    expect(a.finding).toMatchObject({ status: "UNKNOWN", evidence: [] });
  });
  it("parsed criterion is decided in code with citable evidence", () => {
    const batch = schema.parse({ criteria: [item(0, crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])])), item(1, crit([text("Pregnant or breastfeeding")])), item(2, crit([text("Adequate organ function")]))] });
    const out = reconcileBatch(sources, batch);
    const a = assessCriterion(sources[0]!, out[0]!, profile({ ecog: "3" }));
    expect(a.finding).toMatchObject({ status: "FAIL", evidence: ["ecog"] });
  });
});
