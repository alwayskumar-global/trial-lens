// Tests for the PROPOSED fail-closed acceptance (not wired). Fictional criteria only; parser output is hand-written and goes through the REAL vetting.
import { describe, expect, it } from "vitest";
import { toClauseTree } from "./clause";
import { acceptFreeTextFinding, authoritativeKeys, leafProvenance } from "./fail-closed";
import { vetCriterion } from "./coverage";
import { atom, block, crit, critBlocks, profile, text } from "./test-helpers";

const clauseOf = (original: string, type: "inclusion" | "exclusion", raw: ReturnType<typeof crit>) => toClauseTree(vetCriterion(original, type, raw).criterion);

describe("compound criteria: every requirement must be established, not merely mentioned", () => {
  const original = "Hemoglobin of at least 9 g/dL and no history of cardiac disease";
  // Two blocks (a criterion is the AND of its blocks). In ONE block the negated text leaf would make the vetting downgrade the hemoglobin atom too
  // ("negation_elsewhere_in_block"), which is a further fail-closed protection; the first draft of this fixture put both in one block and was wrong about that.
  const raw = critBlocks([block([], [atom("Hemoglobin of at least 9 g/dL", "hemoglobin", "gte", 9, "g/dL")]), block([], [text("no history of cardiac disease", ["cardiac_disease"])])], "lab");
  const p = profile({ hemoglobin: 11, cardiac_disease: "none" });

  it("a model PASS citing BOTH keys (both appear in the wording, both known) is rejected: the negated cardiac requirement is a text leaf, not established", () => {
    const r = acceptFreeTextFinding({ status: "PASS", evidence: ["hemoglobin", "cardiac_disease"] }, clauseOf(original, "inclusion", raw), "inclusion", p);
    expect(r).toMatchObject({ accepted: false, status: "UNKNOWN", reason: "no_independent_proof" });
  });

  it("a conjunct established FALSE by code is enough for FAIL (sound), and the model's FAIL is accepted only because the code derives the same status", () => {
    const r = acceptFreeTextFinding({ status: "FAIL", evidence: ["hemoglobin"] }, clauseOf(original, "inclusion", raw), "inclusion", profile({ hemoglobin: 8 }));
    expect(r).toMatchObject({ accepted: true, status: "FAIL", reason: "code_derived_same_status" });
  });

  it("exclusion with two disjuncts: PASS needs BOTH proven false; one cited relevant key (cns_mets) is not enough while the cardiac disjunct is unknown", () => {
    const o = "Active CNS metastases or active cardiac disease";
    const rawX = crit([atom("Active CNS metastases", "cns_mets", "eq", "active"), atom("active cardiac disease", "cardiac_disease", "eq", "active")], { combine: "any", category: "comorbidity" });
    const c = clauseOf(o, "exclusion", rawX);
    expect(acceptFreeTextFinding({ status: "PASS", evidence: ["cns_mets"] }, c, "exclusion", profile({ cns_mets: "none" }))).toMatchObject({ accepted: false, status: "UNKNOWN" });
    expect(acceptFreeTextFinding({ status: "PASS", evidence: ["cns_mets", "cardiac_disease"] }, c, "exclusion", profile({ cns_mets: "none", cardiac_disease: "none" }))).toMatchObject({ accepted: true, status: "PASS" });
  });

  it("a PASS/FAIL citing a key the code evaluation never compared is rejected even when the status coincides", () => {
    const r = acceptFreeTextFinding({ status: "FAIL", evidence: ["hemoglobin", "age"] }, clauseOf(original, "inclusion", raw), "inclusion", profile({ hemoglobin: 8, age: 47 }));
    expect(r).toMatchObject({ accepted: false, status: "UNKNOWN" });
  });

  it("the rel-01 shape: PASS citing known age for a hemoglobin text criterion is rejected", () => {
    const c = clauseOf("Hemoglobin of at least 9 g/dL", "inclusion", crit([text("Hemoglobin of at least 9 g/dL", ["age"])], { category: "lab" }));
    expect(acceptFreeTextFinding({ status: "PASS", evidence: ["age"] }, c, "inclusion", profile({ age: 47 }))).toMatchObject({ accepted: false, status: "UNKNOWN" });
  });

  it("UNKNOWN and AMBIGUOUS pass through untouched", () => {
    const c = clauseOf(original, "inclusion", raw);
    expect(acceptFreeTextFinding({ status: "AMBIGUOUS", evidence: [] }, c, "inclusion", p)).toMatchObject({ accepted: true, status: "AMBIGUOUS", reason: "not_pass_fail" });
  });
});

describe("negation next to an atom in the same block", () => {
  it("vetting downgrades the atom too, so nothing in that block can be established", () => {
    const o = "Hemoglobin of at least 9 g/dL and no history of cardiac disease";
    const one = crit([atom("Hemoglobin of at least 9 g/dL", "hemoglobin", "gte", 9, "g/dL"), text("no history of cardiac disease", ["cardiac_disease"])], { category: "lab" });
    const { vet, leaves } = leafProvenance(o, "inclusion", one);
    expect(vet).toBe("atoms_downgraded");
    expect(leaves.map((l) => l.origin)).toEqual(["atom_rejected_vetting", "parser_text"]);
    expect(acceptFreeTextFinding({ status: "FAIL", evidence: ["hemoglobin"] }, clauseOf(o, "inclusion", one), "inclusion", profile({ hemoglobin: 8 }))).toMatchObject({ accepted: false, status: "UNKNOWN" });
  });
});

describe("atoms downgraded to text keep depends_on but never regain authority", () => {
  it("vetting downgrade: the text leaf retains the fact key, provenance marks it atom_rejected_vetting and it is not authoritative", () => {
    const original = "HER2-low expression (IHC 1+ or IHC 2+/ISH-negative)";
    const raw = crit([atom(original, "her2_status", "eq", "low")], { category: "biomarker" });
    const { vet, leaves } = leafProvenance(original, "inclusion", raw);
    expect(vet).toBe("atoms_downgraded");
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toMatchObject({ origin: "atom_rejected_vetting", keys: ["her2_status"], authoritative: false }); // key retained, authority not
    expect(authoritativeKeys(leaves)).toEqual([]);
    const c = clauseOf(original, "inclusion", raw);
    expect(acceptFreeTextFinding({ status: "PASS", evidence: ["her2_status"] }, c, "inclusion", profile({ her2_status: "low" }))).toMatchObject({ accepted: false, status: "UNKNOWN" });
  });

  it("semantic rejection (atom survives vetting, fails the semantic guard): provenance atom_rejected_semantic, not authoritative", () => {
    const raw = crit([atom("Pregnancy-test", "pregnant", "eq", true)], { category: "other" });
    const { vet, leaves } = leafProvenance("Pregnancy-test", "exclusion", raw);
    expect(vet).toBe("ok");
    expect(leaves[0]).toMatchObject({ origin: "atom_rejected_semantic", keys: ["pregnant"], authoritative: false });
    const c = clauseOf("Pregnancy-test", "exclusion", raw);
    expect(acceptFreeTextFinding({ status: "FAIL", evidence: ["pregnant"] }, c, "exclusion", profile({ pregnant: true }))).toMatchObject({ accepted: false, status: "UNKNOWN" });
  });

  it("an executable atom is authoritative; a whole-criterion rejection leaves no authoritative key", () => {
    const ok = leafProvenance("ER positive", "inclusion", crit([atom("ER positive", "er_status", "eq", "positive")], { category: "biomarker" }));
    expect(authoritativeKeys(ok.leaves)).toEqual(["er_status"]);
    const bad = leafProvenance("ER positive and something the parser dropped entirely", "inclusion", crit([atom("ER positive", "er_status", "eq", "positive")], { category: "biomarker" }));
    expect(bad.vet).toBe("coverage_failed");
    expect(bad.leaves[0]).toMatchObject({ origin: "criterion_rejected", authoritative: false });
  });
});
