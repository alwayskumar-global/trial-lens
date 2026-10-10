// Per-block conditional semantics (approved): block truth = ¬when ∨ requirement; criterion = AND of blocks.
// Written BEFORE the implementation. Proven non-applicability = a KNOWN-FALSE atom in the block's own explicitly
// scoped, conjunctive `when`. childbearing_potential is never derived. pregnant=false is not a negative test.
import { describe, expect, it } from "vitest";
import { evaluateClause, statusFromTruth, toClauseTree, classifyCompleteness, type Tri } from "./clause";
import { assessCriterion, type ParseOutcome, type SourceCriterion } from "./reconcile";
import { applyAbstentionGuard } from "./guard";
import { atom, block, critBlocks, profile, text, timing } from "./test-helpers";
import { FACT_KEYS } from "@/schema/vocabulary";

const T1_TEXT =
  "Women of childbearing potential (aged 15-49 years) must have a negative pregnancy test within 7 days before starting treatment. Both male and female participants of reproductive potential must agree to use effective contraception during the study and for 3 months after discontinuation of treatment;";
const t1 = () =>
  critBlocks([
    block(
      [text("Women of childbearing potential"), atom("aged 15-49 years", "age", "gte", 15, "years"), atom("aged 15-49 years", "age", "lte", 49, "years")],
      [text("must have a negative pregnancy test"), timing("within 7 days before starting treatment", "within_last", 7, "days")],
    ),
    block([text("Both male and female participants of reproductive potential")], [text("must agree to use effective contraception during the study and for 3 months after discontinuation of treatment")]),
  ]);
const ev = (c: ReturnType<typeof critBlocks>, p: ReturnType<typeof profile>) => evaluateClause(toClauseTree(c), p);

describe("block truth table: ¬w ∨ r (Kleene), criterion = AND of blocks", () => {
  const tv: Tri[] = ["true", "false", "unknown"];
  // Realise w and r as single atoms so each Kleene value is producible: unknown = fact unknown.
  const wAtom = atom("pregnant", "pregnant", "eq", true);
  const rAtom = atom("ecog 0", "ecog", "eq", "0");
  const profFor = (w: Tri, r: Tri) =>
    profile({
      ...(w === "true" ? { pregnant: true } : w === "false" ? { pregnant: false } : {}),
      ...(r === "true" ? { ecog: "0" } : r === "false" ? { ecog: "1" } : {}),
    });
  const expected = (w: Tri, r: Tri): Tri => (w === "false" ? "true" : w === "true" ? r : r === "true" ? "true" : "unknown");
  for (const w of tv) {
    for (const r of tv) {
      it(`w=${w} r=${r} ⇒ ${expected(w, r)}`, () => {
        expect(ev(critBlocks([block([wAtom], [rAtom])]), profFor(w, r)).truth).toBe(expected(w, r));
      });
    }
  }
  it("criterion = AND of blocks: false dominates, then unknown, else true", () => {
    const b = (v: boolean) => block([], [atom("pregnant", "pregnant", "eq", v)]);
    expect(ev(critBlocks([b(true), b(false)]), profile({ pregnant: true })).truth).toBe("false");
    expect(ev(critBlocks([b(true), block([], [atom("ecog 0", "ecog", "eq", "0")])]), profile({ pregnant: true })).truth).toBe("unknown");
    expect(ev(critBlocks([b(true), b(true)]), profile({ pregnant: true })).truth).toBe("true");
  });
});

describe("T1 / T9: the pregnancy-test bullet", () => {
  it("T1: 52 F, pregnant=false ⇒ block 1 vacuous (age atom proves non-applicability), block 2 unknown ⇒ UNKNOWN", () => {
    const r = ev(t1(), profile({ age: 52, sex: "female", pregnant: false }));
    expect(r.truth).toBe("unknown");
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]).toMatchObject({ applicability: "not_applicable", evidence: ["age"] });
    expect(r.blocks[1]).toMatchObject({ applicability: "unknown", evidence: [] });
  });
  it("T1b: 30 F, pregnant=false ⇒ UNKNOWN. pregnant=false is NOT evidence of a negative test", () => {
    const r = ev(t1(), profile({ age: 30, sex: "female", pregnant: false }));
    expect(r.truth).toBe("unknown");
    expect(statusFromTruth("inclusion", r.truth)).toBe("UNKNOWN");
    expect(r.blocks[0]!.applicability).toBe("unknown"); // text leaf 'women of childbearing potential' ⇒ unknown, nothing derived
  });
  it("T1c: 30 F, pregnant=true ⇒ still UNKNOWN (no FAIL derived: test result and timing are unrepresented)", () => {
    expect(ev(t1(), profile({ age: 30, sex: "female", pregnant: true })).truth).toBe("unknown");
  });
  it("T1d: never PASS for ANY profile (every requirement leaf is text/timing)", () => {
    for (const age of [10, 30, 52, 70]) for (const preg of [true, false]) expect(ev(t1(), profile({ age, pregnant: preg, sex: "female" })).truth).not.toBe("true");
  });
  it("T9: childbearing_potential is not a vocabulary fact and is never derived", () => {
    expect(FACT_KEYS as readonly string[]).not.toContain("childbearing_potential");
    expect(ev(t1(), profile({ age: 30, sex: "female", menopausal_status: "pre", pregnant: false })).blocks[0]!.applicability).toBe("unknown");
    expect(ev(t1(), profile({ age: 62, sex: "female", menopausal_status: "post" })).blocks[0]!.applicability).toBe("not_applicable"); // via the stated age band only
  });
  it("T9b: the three requirements survive as leaves with verbatim sources and the 7-day timing", () => {
    const leaves = t1().blocks.flatMap((b) => [...b.when, ...b.items]);
    const timingLeaf = leaves.find((l) => l.kind === "timing")!;
    expect(timingLeaf).toMatchObject({ amount: 7, time_unit: "days", source: "within 7 days before starting treatment" });
    expect(leaves.some((l) => /negative pregnancy test/.test(l.source))).toBe(true);
    expect(leaves.some((l) => /contraception/.test(l.source))).toBe(true);
    for (const l of leaves) expect(T1_TEXT.toLowerCase()).toContain(l.source.toLowerCase());
  });
  it("completeness: text/timing in any block ⇒ partial", () => {
    expect(classifyCompleteness(toClauseTree(t1()))).toBe("partial");
  });
});

describe("proven non-applicability (known-false atom in an explicitly scoped, conjunctive when)", () => {
  it("T3: single block, when = [age <= 49], patient 52 ⇒ vacuous PASS, evidence age", () => {
    const c = critBlocks([block([atom("aged 49 or younger", "age", "lte", 49, "years")], [text("must have a negative pregnancy test")])]);
    const r = ev(c, profile({ age: 52 }));
    expect(r.truth).toBe("true");
    expect(r.blocks[0]).toEqual({ applicability: "not_applicable", evidence: ["age"] });
  });
  it("T5: when = [text only] can never prove non-applicability", () => {
    const c = critBlocks([block([text("Women of childbearing potential")], [text("must have a negative pregnancy test")])]);
    const r = ev(c, profile({ age: 52, sex: "female", menopausal_status: "post" }));
    expect(r.truth).toBe("unknown");
    expect(r.blocks[0]!.applicability).toBe("unknown");
  });
  it("a known-TRUE atom in `when` plus an unknown text leaf leaves applicability unknown (conjunction)", () => {
    const c = critBlocks([block([text("of childbearing potential"), atom("aged <= 49", "age", "lte", 49, "years")], [text("must test negative")])]);
    expect(ev(c, profile({ age: 30 })).blocks[0]!.applicability).toBe("unknown");
  });
  it("T4: applicable and requirement atom false ⇒ FAIL candidate", () => {
    const c = critBlocks([block([atom("aged <= 49", "age", "lte", 49, "years")], [atom("ecog 0", "ecog", "eq", "0")])]);
    const r = ev(c, profile({ age: 30, ecog: "2" }));
    expect(r.truth).toBe("false");
    expect(statusFromTruth("inclusion", r.truth)).toBe("FAIL");
  });
  it("T6: when unknown, requirement proven true by a real fact ⇒ true, applicability unknown", () => {
    const c = critBlocks([block([text("who are of childbearing potential")], [atom("not pregnant", "pregnant", "eq", false)])]);
    const r = ev(c, profile({ pregnant: false }));
    expect(r.truth).toBe("true");
    expect(r.blocks[0]!.applicability).toBe("unknown");
  });
  it("T11: HER2-positive-only requirement ⇒ vacuous PASS for a HER2-negative patient (was a false FAIL); unknown/FAIL otherwise", () => {
    const c = critBlocks([block([atom("HER2-positive disease", "her2_status", "eq", "positive")], [atom("prior trastuzumab", "prior_trastuzumab", "eq", true)])]);
    expect(ev(c, profile({ her2_status: "negative" })).truth).toBe("true");
    expect(ev(c, profile({ her2_status: "negative" })).blocks[0]).toEqual({ applicability: "not_applicable", evidence: ["her2_status"] });
    expect(ev(c, profile({ her2_status: "positive" })).truth).toBe("unknown");
    expect(ev(c, profile({ her2_status: "positive", prior_trastuzumab: false })).truth).toBe("false");
  });
  it("T17: except inside then — ¬w ∨ (base ∧ ¬exceptions)", () => {
    const c = critBlocks([block([atom("aged <= 49", "age", "lte", 49, "years")], [atom("ecog 0", "ecog", "eq", "0")], { except: [atom("pregnant", "pregnant", "eq", true)] })]);
    expect(ev(c, profile({ age: 30, ecog: "0", pregnant: true })).truth).toBe("false");
    expect(ev(c, profile({ age: 30, ecog: "0", pregnant: false })).truth).toBe("true");
  });
});

describe("assessment + abstention guard with per-block applicability evidence", () => {
  const src: SourceCriterion = { id: "NCT0:inclusion:0", nct_id: "NCT0", type: "inclusion", text: "x" };
  const outcome = (c: ReturnType<typeof critBlocks>): ParseOutcome => ({ state: "parsed", category: "other", scoring: true, clause: toClauseTree(c), completeness: classifyCompleteness(toClauseTree(c)) === "full" ? "full" : "partial", vet: "ok" });
  it("a vacuous PASS carries per-block applicability with cited evidence", () => {
    const c = critBlocks([block([atom("aged <= 49", "age", "lte", 49, "years")], [atom("ecog 0", "ecog", "eq", "0")])]);
    const a = assessCriterion(src, outcome(c), profile({ age: 52 }));
    expect(a.finding.status).toBe("PASS");
    expect(a.finding.applicability).toEqual([{ block: 0, state: "not_applicable", evidence: ["age"] }]);
  });
  it("T7: guard downgrades a vacuous PASS whose cited evidence is missing or not known", () => {
    const base = { criterion_id: "c", status: "PASS" as const, evidence: ["age"], rationale: "r", source: "code" as const };
    expect(applyAbstentionGuard({ ...base, applicability: [{ block: 0, state: "not_applicable", evidence: [] }] }, profile({ age: 52 })).downgraded).toBe(true);
    expect(applyAbstentionGuard({ ...base, applicability: [{ block: 0, state: "not_applicable", evidence: ["age"] }] }, profile()).downgraded).toBe(true);
    expect(applyAbstentionGuard({ ...base, applicability: [{ block: 0, state: "not_applicable", evidence: ["age"] }] }, profile({ age: 52 })).downgraded).toBe(false);
  });
  it("T15: vacuous block + unknown block ⇒ criterion UNKNOWN (open), never PASS", () => {
    const a = assessCriterion(src, outcome(t1()), profile({ age: 52 }));
    expect(a.finding.status).toBe("UNKNOWN");
    expect(a.finding.applicability?.[0]).toMatchObject({ state: "not_applicable" });
  });
});
