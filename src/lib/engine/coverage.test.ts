// ADVERSARIAL regression cases for the coverage / scope checks, written BEFORE the implementation.
// Rule: if the parser cannot prove that every requirement and its logical scope survived, the WHOLE
// criterion becomes one text leaf (UNKNOWN). There is no tuned percentage: one omitted substantive
// word (negation, number, timing, population, exception, connective) fails the criterion.
import { describe, expect, it } from "vitest";
import { atomScopeProblems, checkCoverage, vetCriterion } from "./coverage";
import { atom, block, crit, critBlocks, text, timing } from "./test-helpers";
import { classifyCompleteness, toClauseTree } from "./clause";

const ok = (original: string, c: ReturnType<typeof critBlocks>) => checkCoverage(original, c.blocks);
const fails = (original: string, c: ReturnType<typeof critBlocks>) => {
  const r = checkCoverage(original, c.blocks);
  expect(r.ok, `expected coverage to FAIL for: ${original}`).toBe(false);
  expect(r.problems.length).toBeGreaterThan(0);
};

describe("coverage: legitimate parses pass", () => {
  it("normalises whitespace, list markers, markdown escapes and case", () => {
    expect(ok("1. ECOG   performance\n status 0-1;", crit([atom("ECOG performance status 0-1", "ecog", "in", ["0", "1"])])).ok).toBe(true);
    expect(ok("\\* Age \\>= 18 years", crit([atom("Age >= 18 years", "age", "gte", 18, "years")])).ok).toBe(true);
  });
  it("'A or B' with combine any; commas in a conjunctive list with combine all", () => {
    expect(ok("Pregnant or breastfeeding", crit([atom("Pregnant", "pregnant", "eq", true), atom("breastfeeding", "lactating", "eq", true)], { combine: "any" })).ok).toBe(true);
    expect(ok("ER-negative, PR-negative, HER2-negative", crit([atom("ER-negative", "er_status", "eq", "negative"), atom("PR-negative", "pr_status", "eq", "negative"), atom("HER2-negative", "her2_status", "eq", "negative")])).ok).toBe(true);
  });
  it("an 'except' connective is allowed only against an except leaf", () => {
    expect(ok("Prior malignancy unless adequately treated skin cancer", critBlocks([block([], [atom("Prior malignancy", "prior_other_malignancy", "eq", true)], { except: [text("adequately treated skin cancer")] })])).ok).toBe(true);
  });
  it("a whole-criterion text leaf always covers", () => {
    expect(ok("Anything at all, no matter how logical: not, within 7 days, unless x.", crit([text("Anything at all, no matter how logical: not, within 7 days, unless x.")])).ok).toBe(true);
  });
  it("T1/T9 shape: two blocks keep the test requirement, the 7-day timing and the contraception requirement", () => {
    const original =
      "Women of childbearing potential (aged 15-49 years) must have a negative pregnancy test within 7 days before starting treatment. Both male and female participants of reproductive potential must agree to use effective contraception during the study and for 3 months after discontinuation of treatment;";
    const c = critBlocks([
      block(
        [text("Women of childbearing potential"), atom("aged 15-49 years", "age", "gte", 15, "years"), atom("aged 15-49 years", "age", "lte", 49, "years")],
        [text("must have a negative pregnancy test"), timing("within 7 days before starting treatment", "within_last", 7, "days")],
      ),
      block(
        [text("Both male and female participants of reproductive potential")],
        [text("must agree to use effective contraception during the study and for 3 months after discontinuation of treatment")],
      ),
    ]);
    expect(ok(original, c)).toEqual({ ok: true, problems: [] });
  });
});

describe("ADVERSARIAL: omitted substantive logic fails the criterion (no percentage can excuse it)", () => {
  const T1 =
    "Women of childbearing potential (aged 15-49 years) must have a negative pregnancy test within 7 days before starting treatment. Both male and female participants of reproductive potential must agree to use effective contraception during the study and for 3 months after discontinuation of treatment;";
  it("A1 drops the contraception sentence (block 2 omitted)", () => {
    fails(T1, critBlocks([block([text("Women of childbearing potential"), atom("aged 15-49 years", "age", "gte", 15, "years"), atom("aged 15-49 years", "age", "lte", 49, "years")], [text("must have a negative pregnancy test"), timing("within 7 days before starting treatment", "within_last", 7, "days")])]));
  });
  it("A1b drops only the 7-day timing", () => {
    fails(T1, critBlocks([
      block([text("Women of childbearing potential"), atom("aged 15-49 years", "age", "gte", 15, "years"), atom("aged 15-49 years", "age", "lte", 49, "years")], [text("must have a negative pregnancy test")]),
      block([text("Both male and female participants of reproductive potential")], [text("must agree to use effective contraception during the study and for 3 months after discontinuation of treatment")]),
    ]));
  });
  it("A2 drops a negation ('No prior chemotherapy' parsed as 'prior chemotherapy')", () => {
    fails("No prior chemotherapy for metastatic disease", crit([atom("prior chemotherapy for metastatic disease", "prior_chemo_any", "eq", true)]));
  });
  it("A3 drops one of two thresholds", () => {
    fails("ANC >= 1500/mm3 and platelets >= 100,000/mm3", crit([atom("ANC >= 1500/mm3", "anc", "gte", 1500, "/mm3")]));
  });
  it("A4 turns 'or' into all", () => {
    fails("HER2-positive or triple-negative breast cancer", crit([atom("HER2-positive", "her2_status", "eq", "positive"), text("triple-negative breast cancer")], { combine: "all" }));
  });
  it("A5 turns 'and' into any", () => {
    fails("ER-negative and PR-negative", crit([atom("ER-negative", "er_status", "eq", "negative"), atom("PR-negative", "pr_status", "eq", "negative")], { combine: "any" }));
  });
  it("A6 drops an exception ('unless …')", () => {
    fails("Prior malignancy unless adequately treated basal cell carcinoma", crit([atom("Prior malignancy", "prior_other_malignancy", "eq", true)]));
  });
  it("A6b puts the exception in items instead of except", () => {
    fails("Prior malignancy unless adequately treated basal cell carcinoma", crit([atom("Prior malignancy", "prior_other_malignancy", "eq", true), text("adequately treated basal cell carcinoma")]));
  });
  it("A7 drops a timing window", () => {
    fails("Chemotherapy within 4 weeks before enrollment", crit([atom("Chemotherapy", "prior_chemo_any", "eq", true)]));
  });
  it("A8 drops the population scope ('Women')", () => {
    fails("Women aged >= 18 years", crit([atom("aged >= 18 years", "age", "gte", 18, "years")]));
  });
  it("A9 flips a modal ('may have received' parsed as a requirement)", () => {
    fails("Patients may have received prior taxane", crit([atom("prior taxane", "prior_taxane", "eq", true)]));
  });
  it("A10 drops 'at screening'", () => {
    fails("Negative serum pregnancy test at screening", crit([text("Negative serum pregnancy test")]));
  });
  it("A11 conditional parsed as an unconditional AND (no `when`)", () => {
    fails("Patients with HER2-positive disease must have received at least 1 line of anti-HER2 therapy", crit([atom("HER2-positive disease", "her2_status", "eq", "positive"), text("received at least 1 line of anti-HER2 therapy")]));
  });
  it("A12 'or' between blocks (blocks are ANDed)", () => {
    fails("Pregnant women must test negative or men must use contraception", critBlocks([block([text("Pregnant women")], [text("must test negative")]), block([text("men")], [text("must use contraception")])]));
  });
  it("A13 'and/or' is ambiguous and never accepted between leaves", () => {
    fails("Prior radiotherapy and/or prior surgery", crit([atom("Prior radiotherapy", "prior_radiation", "eq", true), text("prior surgery")], { combine: "any" }));
  });
  it("A14 95% of the words covered is irrelevant: one missing 'not' fails", () => {
    const original = "Participants with confirmed invasive breast cancer histology and measurable disease per RECIST who have not received prior systemic therapy in the metastatic setting";
    fails(original, crit([text("Participants with confirmed invasive breast cancer histology and measurable disease per RECIST who have"), text("received prior systemic therapy in the metastatic setting")]));
  });
  it("A15 a leaf whose source is a tiny fragment cannot launder the rest of the sentence", () => {
    fails("HER2-negative disease with no brain metastases", crit([atom("HER2", "her2_status", "eq", "negative")]));
  });
  it("A16 the same word cannot be claimed twice to hide a gap", () => {
    fails("negative for HER2 and negative for ER", crit([atom("negative", "her2_status", "eq", "negative"), atom("negative", "er_status", "eq", "negative")]));
  });
});

describe("ADVERSARIAL round 2: tiling tricks that must not launder logic", () => {
  it("A17 negation isolated in its own text leaf ('No' + atom) is not a requirement leaf", () => {
    fails("No prior chemotherapy", crit([text("No"), atom("prior chemotherapy", "prior_chemo_any", "eq", true)]));
  });
  it("A18 negation split from the proposition it governs: every atom in that block is downgraded", () => {
    const r = vetCriterion("No prior chemotherapy", "inclusion", crit([text("No prior"), atom("chemotherapy", "prior_chemo_any", "eq", true)]));
    expect(r.criterion.blocks.flatMap((b) => [...b.when, ...b.items, ...b.except]).some((l) => l.kind === "atom")).toBe(false);
    expect(classifyCompleteness(toClauseTree(r.criterion))).toBe("partial");
  });
  it("A19 a leaf made only of logic words is rejected (connective / modal / timing marker as its own leaf)", () => {
    fails("Prior radiotherapy only", crit([atom("Prior radiotherapy", "prior_radiation", "eq", true), text("only")]));
    fails("Prior radiotherapy unless contraindicated", critBlocks([block([], [atom("Prior radiotherapy", "prior_radiation", "eq", true), text("unless")])]));
  });
  it("A20 inverted receptor polarity: atom says positive, the cited text says negative (and the reverse)", () => {
    expect(atomScopeProblems(atom("ER-negative", "er_status", "eq", "positive"))).not.toEqual([]);
    expect(atomScopeProblems(atom("HER2-positive", "her2_status", "eq", "negative"))).not.toEqual([]);
    expect(atomScopeProblems(atom("PR+", "pr_status", "eq", "negative"))).not.toEqual([]);
    expect(atomScopeProblems(atom("hormone receptor status", "er_status", "eq", "positive"))).not.toEqual([]); // value not in the source at all
  });
  it("A20b correct polarity passes (words and signs)", () => {
    expect(atomScopeProblems(atom("ER-negative", "er_status", "eq", "negative"))).toEqual([]);
    expect(atomScopeProblems(atom("HER2-positive", "her2_status", "eq", "positive"))).toEqual([]);
    expect(atomScopeProblems(atom("ER+", "er_status", "eq", "positive"))).toEqual([]);
    expect(atomScopeProblems(atom("PR-", "pr_status", "eq", "negative"))).toEqual([]);
  });
  it("A21 an asserted FALSE / neq / not_in can only come from negation language (excluded), so it is never executable", () => {
    expect(atomScopeProblems(atom("prior chemotherapy", "prior_chemo_any", "eq", false))).not.toEqual([]);
    expect(atomScopeProblems(atom("cardiac disease", "cardiac_disease", "neq", "none"))).not.toEqual([]);
    expect(atomScopeProblems(atom("ecog performance status", "ecog", "not_in", ["3", "4"]))).not.toEqual([]);
    expect(atomScopeProblems(atom("prior chemotherapy", "prior_chemo_any", "eq", true))).toEqual([]);
  });
  it("A22 'Males or females' style in-sets with a bare 'or' stay executable", () => {
    expect(atomScopeProblems(atom("Males or females", "sex", "in", ["male", "female"]))).toEqual([]);
  });
});

describe("ADVERSARIAL round 3: operator, unit and qualifier fidelity (from development-cohort judge-'wrong' parses)", () => {
  it("A23 a numeric operator needs a relational marker in the cited text (no marker ⇒ not executable)", () => {
    expect(atomScopeProblems(atom("Platelets - 100 x 109/L", "platelets", "eq", 100, "10^9/L"))).not.toEqual([]);
    expect(atomScopeProblems(atom("Platelets >= 100 x 109/L", "platelets", "gte", 100, "10^9/L"))).toEqual([]);
  });
  it("A24 a unit that is not in the cited text is a hallucination (g/dL for a 10^9/L source)", () => {
    expect(atomScopeProblems(atom("Hemoglobin >= 9 x 109/L", "hemoglobin", "gte", 9, "g/dL"))).not.toEqual([]);
    expect(atomScopeProblems(atom("Hemoglobin >= 9 g/dL", "hemoglobin", "gte", 9, "g/dL"))).toEqual([]);
  });
  it("A25 the operator must match the comparator words: 'over 18' is gt, not gte", () => {
    expect(atomScopeProblems(atom("over the age of 18 years", "age", "gte", 18, "years"))).not.toEqual([]);
    expect(atomScopeProblems(atom("over the age of 18 years", "age", "gt", 18, "years"))).toEqual([]);
    expect(atomScopeProblems(atom("aged 18 years or older", "age", "gte", 18, "years"))).toEqual([]);
    expect(atomScopeProblems(atom("at most 2 prior lines", "metastatic_line", "gte", 2))).not.toEqual([]);
  });
  it("A26 'within N days' means lte/lt, never gte (inverted timing)", () => {
    expect(atomScopeProblems(atom("Receiving any anti-tumor therapy within 28 days before enrollment", "days_since_last_systemic_therapy", "gte", 28, "days"))).not.toEqual([]);
    expect(atomScopeProblems(atom("therapy within 28 days", "days_since_last_systemic_therapy", "gte", 28, "days"))).not.toEqual([]);
    expect(atomScopeProblems(atom("therapy within 28 days", "days_since_last_systemic_therapy", "lt", 28, "days"))).toEqual([]);
  });
  it("A27 relative clauses and modals inside an atom source are unmodelled qualifiers", () => {
    expect(atomScopeProblems(atom("symptoms that are concerning for brain metastases that would otherwise be referred", "cns_mets", "eq", "active"))).not.toEqual([]);
    expect(atomScopeProblems(atom("Active brain metastases", "cns_mets", "eq", "active"))).toEqual([]);
  });
  it("A28 ranges and legitimate forms stay executable", () => {
    const lo = atom("aged 18-75 years", "age", "gte", 18, "years");
    const hi = atom("aged 18-75 years", "age", "lte", 75, "years");
    expect(atomScopeProblems(lo, [hi])).toEqual([]);
    expect(atomScopeProblems(hi, [lo])).toEqual([]);
    expect(atomScopeProblems(atom("ANC >= 1,500/mm3", "anc", "gte", 1500, "/mm3"))).toEqual([]);
    expect(atomScopeProblems(atom("bilirubin <= 1.5 x ULN", "bilirubin_x_uln", "lte", 1.5, "x ULN"))).toEqual([]);
    expect(atomScopeProblems(atom("LVEF >= 50%", "lvef_percent", "gte", 50, "%"))).toEqual([]);
  });
});

describe("ADVERSARIAL round 4: an atom must account for EVERY content word of its source (no silent qualifiers)", () => {
  it("A29 population qualifier dropped inside an atom: 'Women of childbearing potential' is NOT sex = female", () => {
    expect(atomScopeProblems(atom("Women of childbearing potential", "sex", "eq", "female"))).not.toEqual([]);
    expect(atomScopeProblems(atom("Women", "sex", "eq", "female"))).toEqual([]);
  });
  it("A30 diagnostic-confirmation / severity qualifiers are not representable by the fact", () => {
    expect(atomScopeProblems(atom("histologically confirmed HER2-negative", "her2_status", "eq", "negative"))).not.toEqual([]);
    expect(atomScopeProblems(atom("symptomatic brain metastases", "cns_mets", "eq", "active"))).not.toEqual([]);
    expect(atomScopeProblems(atom("Active brain metastases", "cns_mets", "eq", "active"))).toEqual([]);
  });
  it("A31 ordinary lab / performance wording stays executable", () => {
    expect(atomScopeProblems(atom("Absolute neutrophil count (ANC) >= 1,000/mm3", "anc", "gte", 1000, "/mm3"))).toEqual([]);
    expect(atomScopeProblems(atom("ECOG performance status 0-1", "ecog", "in", ["0", "1"]))).toEqual([]);
    expect(atomScopeProblems(atom("Platelet count >= 100 x 109/L", "platelets", "gte", 100, "10^9/L"))).toEqual([]);
    expect(atomScopeProblems(atom("Measurable disease per RECIST v1.1", "measurable_disease", "eq", true))).toEqual([]);
  });
  it("A32 vetCriterion: the audited T1 'when' atom (sex with a qualifier) is downgraded to text, so applicability stays unknown for a 30-year-old", () => {
    const r = vetCriterion("Women of childbearing potential must have a negative pregnancy test", "inclusion", critBlocks([block([atom("Women of childbearing potential", "sex", "eq", "female")], [text("must have a negative pregnancy test")])]));
    expect(r.criterion.blocks[0]!.when[0]!.kind).toBe("text");
  });
});

describe("atom scope: an executable atom must be ONE proposition whose logic words are accounted for", () => {
  const leaf = atom;
  it("S1 a compound sentence as a single atom is not executable (and/or/unless/negation/timing/numbers)", () => {
    expect(atomScopeProblems(leaf("ER-negative and HER2-negative", "er_status", "eq", "negative"), [])).not.toEqual([]);
    expect(atomScopeProblems(leaf("No prior chemotherapy", "prior_chemo_any", "eq", false), [])).not.toEqual([]);
    expect(atomScopeProblems(leaf("prior chemotherapy within 3 years", "prior_chemo_any", "eq", true), [])).not.toEqual([]);
    expect(atomScopeProblems(leaf("prior malignancy unless treated", "prior_other_malignancy", "eq", true), [])).not.toEqual([]);
  });
  it("S2 an extra number in the source that the atom does not carry is not executable", () => {
    expect(atomScopeProblems(leaf("ANC >= 1500/mm3 and platelets >= 100,000/mm3", "anc", "gte", 1500, "/mm3"), [])).not.toEqual([]);
    expect(atomScopeProblems(leaf("ECOG 0-1", "ecog", "eq", "0"), [])).not.toEqual([]); // drops '1'
  });
  it("S3 accounted logic passes: 'or' with an in-set, comparator + its own number, a range with sibling atoms", () => {
    expect(atomScopeProblems(leaf("ECOG 0-1", "ecog", "in", ["0", "1"]), [])).toEqual([]);
    expect(atomScopeProblems(leaf("Males or females", "sex", "in", ["male", "female"]), [])).toEqual([]);
    expect(atomScopeProblems(leaf("ANC >= 1,500/mm3", "anc", "gte", 1500, "/mm3"), [])).toEqual([]);
    expect(atomScopeProblems(leaf("at least 1 line", "metastatic_line", "gte", 1), [])).toEqual([]);
    expect(atomScopeProblems(leaf("no more than 2 prior lines", "metastatic_line", "lte", 2), [])).toEqual([]);
    const lo = leaf("aged between 18 and 75 years", "age", "gte", 18, "years");
    const hi = leaf("aged between 18 and 75 years", "age", "lte", 75, "years");
    expect(atomScopeProblems(lo, [hi])).toEqual([]);
    expect(atomScopeProblems(lo, [])).not.toEqual([]); // the 75 is unaccounted without its sibling
  });
  it("S4 plain status vocabulary is not negation ('HER2-negative', 'triple-negative')", () => {
    expect(atomScopeProblems(leaf("HER2-negative", "her2_status", "eq", "negative"), [])).toEqual([]);
  });
});

describe("vetCriterion: what the parser output becomes", () => {
  it("V1 coverage failure ⇒ the WHOLE criterion becomes one text leaf with the verbatim original ⇒ partial/UNKNOWN", () => {
    const original = "No prior chemotherapy for metastatic disease";
    const r = vetCriterion(original, "inclusion", crit([atom("prior chemotherapy for metastatic disease", "prior_chemo_any", "eq", true)]));
    expect(r.status).toBe("coverage_failed");
    expect(r.criterion.blocks).toHaveLength(1);
    expect(r.criterion.blocks[0]!.items).toHaveLength(1);
    expect(r.criterion.blocks[0]!.items[0]).toMatchObject({ kind: "text", source: original });
    expect(classifyCompleteness(toClauseTree(r.criterion))).toBe("partial");
  });
  it("V2 an unsound atom is downgraded to a text leaf in place; coverage still holds ⇒ atoms_downgraded", () => {
    const r = vetCriterion("ER-negative and HER2-negative", "inclusion", crit([atom("ER-negative and HER2-negative", "er_status", "eq", "negative")]));
    expect(r.status).toBe("atoms_downgraded");
    expect(r.criterion.blocks[0]!.items[0]!.kind).toBe("text");
  });
  it("V3 a clean parse is untouched", () => {
    const c = crit([atom("ECOG 0-1", "ecog", "in", ["0", "1"])]);
    const r = vetCriterion("ECOG 0-1", "inclusion", c);
    expect(r.status).toBe("ok");
    expect(r.criterion).toEqual(c);
  });
  it("V4 `when` on an exclusion criterion ⇒ whole criterion to text", () => {
    const c = critBlocks([block([atom("age <= 49", "age", "lte", 49, "years")], [text("must test negative")])]);
    const r = vetCriterion("age <= 49 must test negative", "exclusion", c);
    expect(r.status).toBe("when_on_exclusion");
    expect(r.criterion.blocks[0]!.items[0]!.kind).toBe("text");
  });
});
