import { describe, expect, it } from "vitest";
import { leafToNode } from "./clause";
import { assessCriterion, type ParseOutcome, type SourceCriterion } from "./reconcile";
import type { QuestionTrial } from "./questions";
import { studyTeamQuestions } from "./study-questions";
import { atom, profile, text } from "./test-helpers";
import type { Category } from "@/schema/criteria";
import type { LlmLeaf } from "@/schema/clause";
import type { FactKey } from "@/schema/vocabulary";
import type { PatientProfile } from "@/schema/profile";

// One study with several (leaf, wording) criteria, all parsed and assessed by the real engine.
function study(nct: string, items: Array<{ leaf: LlmLeaf; wording: string; category?: Category; type?: "inclusion" | "exclusion" }>, p: PatientProfile): QuestionTrial {
  const sources: SourceCriterion[] = items.map((it, i) => ({ id: `${nct}:${it.type ?? "inclusion"}:${i}`, nct_id: nct, type: it.type ?? "inclusion", text: it.wording }));
  const outcomes: ParseOutcome[] = items.map((it): ParseOutcome => ({ state: "parsed", category: it.category ?? "performance", scoring: true, clause: leafToNode(it.leaf), completeness: it.leaf.kind === "atom" ? "full" : "partial", vet: "ok" }));
  return { sources, outcomes, assess: sources.map((s, i) => assessCriterion(s, outcomes[i]!, p)), tier: "UNCERTAIN" };
}
const ecog = (w = "ECOG performance status 0-1") => ({ leaf: atom(w, "ecog", "in", ["0", "1"]), wording: w });
const p0 = profile({});

describe("studyTeamQuestions", () => {
  it("counts DISTINCT STUDIES: several criteria of one study are one study", () => {
    const t1 = study("NCT00000001", [ecog("ECOG 0-1"), ecog("Performance status (ECOG) must remain 0-1 at baseline")], p0);
    const t2 = study("NCT00000002", [ecog()], p0);
    const [q] = studyTeamQuestions([t1, t2], p0);
    expect(q!.fact_key).toBe("ecog");
    expect(q!.study_count).toBe(2);
    expect(q!.studies.map((s) => [s.nct_id, s.criteria.length])).toEqual([["NCT00000001", 2], ["NCT00000002", 1]]);
  });

  it("each study entry carries its NCT id and the original criterion wording, verbatim", () => {
    const wording = "Patients must have an ECOG performance scale of ≤2.";
    const [q] = studyTeamQuestions([study("NCT00000003", [{ leaf: atom("ECOG ≤2", "ecog", "in", ["0", "1", "2"]), wording }], p0)], p0);
    expect(q!.studies[0]).toEqual({ nct_id: "NCT00000003", criteria: [{ criterion_id: "NCT00000003:inclusion:0", type: "inclusion", text: wording }] });
  });

  it("omits an unsupported dependency: the original wording has no cue for the fact", () => {
    const t = study("NCT00000004", [{ leaf: atom("ECOG 0-1", "ecog", "in", ["0", "1"]), wording: "Able to attend all study visits" }], p0);
    expect(studyTeamQuestions([t], p0)).toEqual([]);
  });

  it("uses strict cues for the noisy keys: the word 'cancer' alone does not support 'another cancer in the past'", () => {
    const t = study("NCT00000005", [{ leaf: atom("Confirmed breast cancer", "prior_other_malignancy", "eq", true), wording: "Histologically confirmed breast cancer", category: "diagnosis" }], p0);
    expect(studyTeamQuestions([t], p0)).toEqual([]);
    const ok = study("NCT00000006", [{ leaf: atom("Other malignancy", "prior_other_malignancy", "eq", true), wording: "No other malignancy within the last 5 years", category: "comorbidity" }], p0);
    expect(studyTeamQuestions([ok], p0)[0]!.fact_key).toBe("prior_other_malignancy");
  });

  it("treatment wording alone does not support 'time since the last systemic treatment'", () => {
    const t = study("NCT00000007", [{ leaf: atom("Treatment with ACEI/ARB", "days_since_last_systemic_therapy", "lte", 14, "days"), wording: "Treatment with ACEI/ARB." }], p0);
    expect(studyTeamQuestions([t], p0)).toEqual([]);
  });

  it("omits facts the visitor profile already holds as known, and criteria that are already resolved", () => {
    const known = profile({ ecog: "1" });
    expect(studyTeamQuestions([study("NCT00000008", [ecog()], known)], known)).toEqual([]);
  });

  it("never offers pregnancy-related or non-askable facts", () => {
    const t = study("NCT00000009", [
      { leaf: atom("Not pregnant", "pregnant", "eq", false), wording: "Not pregnant", category: "demographic" },
      { leaf: atom("Not breastfeeding", "lactating", "eq", false), wording: "Not breastfeeding", category: "demographic" },
      { leaf: atom("Age 18 or older", "age", "gte", 18, "years"), wording: "Age 18 years or older", category: "demographic" },
    ], p0);
    expect(studyTeamQuestions([t], p0)).toEqual([]);
  });

  it("is deterministic: study_count desc then key asc, at most 3, no dependence on input order", () => {
    const val = (k: FactKey) => (k === "pik3ca_mutation" ? true : "positive"); // executable atoms: enum keys take an enum value
    const mk = (n: string, keys: Array<[FactKey, string]>) => study(n, keys.map(([k, w]) => ({ leaf: atom(w, k, "eq", val(k)), wording: w, category: "biomarker" as Category })), p0);
    const ts = [
      mk("NCT00000011", [["her2_status", "HER2 positive"], ["er_status", "ER positive"]]),
      mk("NCT00000012", [["her2_status", "HER2 positive"], ["pr_status", "PR positive"]]),
      mk("NCT00000013", [["brca_germline", "BRCA mutation"], ["er_status", "ER positive"], ["pik3ca_mutation", "PIK3CA mutation"]]),
    ];
    const a = studyTeamQuestions(ts, p0), b = studyTeamQuestions([...ts].reverse(), p0);
    expect(a).toEqual(b);
    expect(a.map((q) => [q.fact_key, q.study_count])).toEqual([["er_status", 2], ["her2_status", 2], ["brca_germline", 1]]);
  });

  it("makes no promise: the result has no tier, score or lift field", () => {
    const [q] = studyTeamQuestions([study("NCT00000014", [ecog()], p0)], p0);
    expect(Object.keys(q!).sort()).toEqual(["fact_key", "studies", "study_count", "topic"]);
  });

  it("a REJECTED atom's retained key never becomes a question (atom that fails its guards; atom downgraded to text by vetting)", () => {
    // semantic rejection: the atom stays an atom but is not executable
    const sem = study("NCT00000021", [{ leaf: atom("Pregnancy-test", "pregnant", "eq", true), wording: "Pregnancy-test" }, { leaf: atom("Treated stable", "cns_mets", "eq", "treated_stable"), wording: "Treated stable brain metastases", category: "comorbidity" }], p0);
    expect(studyTeamQuestions([sem], p0)).toEqual([]);
    // vetting rejection: a text leaf that retained the key, whatever the criterion's vet status
    for (const vet of ["ok", "atoms_downgraded"] as const) {
      const t = study("NCT00000022", [{ leaf: text("ECOG performance status 0-1 or better", ["ecog"]), wording: "ECOG performance status 0-1 or better" }], p0);
      const v: QuestionTrial = { ...t, outcomes: t.outcomes.map((o) => (o.state === "parsed" ? { ...o, vet } : o)) };
      expect(studyTeamQuestions([v], p0)).toEqual([]);
    }
  });

  it("text-leaf topics are left out: a parser-declared key is not a question even when the wording has the cue, and another leaf supplying the cue does not help", () => {
    // wording has an ECOG cue, but the only leaf that declares `ecog` is a text leaf; the cue sits in ANOTHER leaf
    const two: QuestionTrial = (() => {
      const wording = "Performance requirement; ECOG performance status 0-1";
      const leafA = text("Performance requirement", ["ecog"]); // declares the key, carries no cue
      const leafB = text("ECOG performance status 0-1", []); // carries the cue, declares nothing
      const sources = [{ id: "NCT00000023:inclusion:0", nct_id: "NCT00000023", type: "inclusion" as const, text: wording }];
      const outcomes: ParseOutcome[] = [{ state: "parsed", category: "performance", scoring: true, clause: { kind: "all", children: [leafToNode(leafA), leafToNode(leafB)] }, completeness: "partial", vet: "ok" }];
      return { sources, outcomes, assess: sources.map((s, i) => assessCriterion(s, outcomes[i]!, p0)), tier: "UNCERTAIN" };
    })();
    expect(studyTeamQuestions([two], p0)).toEqual([]);
  });

  it("an executable atom still yields its question when a text leaf of the same criterion declares a different key", () => {
    const wording = "ECOG performance status 0-1 and willing to travel";
    const sources = [{ id: "NCT00000024:inclusion:0", nct_id: "NCT00000024", type: "inclusion" as const, text: wording }];
    const outcomes: ParseOutcome[] = [{ state: "parsed", category: "performance", scoring: true, clause: { kind: "all", children: [leafToNode(atom("ECOG performance status 0-1", "ecog", "in", ["0", "1"])), leafToNode(text("willing to travel", ["age"]))] }, completeness: "partial", vet: "ok" }];
    const t: QuestionTrial = { sources, outcomes, assess: sources.map((s, i) => assessCriterion(s, outcomes[i]!, p0)), tier: "UNCERTAIN" };
    expect(studyTeamQuestions([t], p0).map((q) => q.fact_key)).toEqual(["ecog"]);
  });
});
