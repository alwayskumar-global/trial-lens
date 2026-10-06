import { describe, expect, it } from "vitest";
import { assessCriterion, type CriterionAssessment, type ParseOutcome, type SourceCriterion } from "./reconcile";
import { leafToNode } from "./clause";
import { tierTrial } from "./tier";
import { computeQuestions, type QuestionTrial } from "./questions";
import { atom, profile } from "./test-helpers";
import type { Category } from "@/schema/criteria";
import type { LlmLeaf } from "@/schema/clause";
import type { PatientProfile } from "@/schema/profile";

// Builds a fully parsed single-criterion trial, tiered by the real engine.
function trial(leaf: LlmLeaf, category: Category, p: PatientProfile, type: "inclusion" | "exclusion" = "inclusion", id = "NCT00000001"): QuestionTrial {
  const src: SourceCriterion = { id: `${id}:${type}:0`, nct_id: id, type, text: leaf.source };
  const outcome: ParseOutcome = { state: "parsed", category, scoring: true, clause: leafToNode(leaf), completeness: "full", vet: "ok" };
  const a: CriterionAssessment = assessCriterion(src, outcome, p);
  const tier = tierTrial([{ scoring: a.scoring, category: a.category, status: a.finding.status, completeness: a.completeness }], { unknownThreshold: 3, expectedCriteria: 1 });
  return { sources: [src], outcomes: [outcome], assess: [a], tier };
}

describe("computeQuestions", () => {
  it("returns nothing when nothing askable is blocking", () => {
    const p = profile({ stage: "III" });
    expect(computeQuestions([trial(atom("Stage III disease", "stage", "eq", "III"), "stage", p)], p, 3)).toEqual([]);
    expect(computeQuestions([], p, 3)).toEqual([]);
  });

  it("asks about an unknown askable fact that blocks a typed criterion, with 'I don't know'", () => {
    const p = profile({});
    const t = trial(atom("Stage III disease", "stage", "eq", "III"), "stage", p);
    expect(t.tier).toBe("UNCERTAIN");
    const [q] = computeQuestions([t], p, 3);
    expect(q!.fact_key).toBe("stage");
    expect(q!.affects_trials).toBe(1);
    expect(q!.answers.map((a) => a.label)).toEqual(["0", "I", "II", "III", "IV", "I don't know"]);
    expect(q!.score).toBeCloseTo(1 / 6); // gain = mean over all 6 answers (incl. "I don't know"); only "III" makes it STRONG; ask_cost 1
  });

  it("never asks about facts the profile already knows or non-askable facts (age, sex)", () => {
    const p = profile({ stage: "II" });
    const ts = [trial(atom("Stage III", "stage", "eq", "III"), "stage", p), trial(atom("Age 18 or older", "age", "gte", 18), "other", profile({}))];
    expect(computeQuestions(ts, p, 3)).toEqual([]);
  });

  it("builds numeric buckets cut at the thresholds in candidate criteria", () => {
    const p = profile({});
    const ts = [trial(atom("LVEF 50% or higher", "lvef_percent", "gte", 50, "%"), "other", p, "inclusion", "NCT00000001"), trial(atom("LVEF 40% or higher", "lvef_percent", "gte", 40, "%"), "other", p, "inclusion", "NCT00000002")];
    const [q] = computeQuestions(ts, p, 3);
    expect(q!.answers.map((a) => a.label)).toEqual(["below 40 %", "40 to below 50 %", "50 % or higher", "I don't know"]);
    expect(q!.affects_trials).toBe(2);
  });

  it("excludes LIKELY_MISMATCH trials and never counts a counterfactual FAIL as decisive", () => {
    const p = profile({});
    const mismatch = { ...trial(atom("Stage III", "stage", "eq", "III"), "stage", p), tier: "LIKELY_MISMATCH" as const };
    expect(computeQuestions([mismatch], p, 3)).toEqual([]);
    // exclusion criterion: "Prior trastuzumab" (exclusion applies when true): answering yes yields an UNVERIFIED FAIL ⇒ not STRONG
    const t = trial(atom("Prior trastuzumab treatment", "prior_trastuzumab", "eq", true), "prior_therapy", p, "exclusion");
    const [q] = computeQuestions([t], p, 3);
    expect(q!.answers.map((a) => a.label)).toEqual(["Yes", "No", "I don't know"]);
    expect(q!.score).toBeCloseTo(1 / 3); // only "No" ⇒ STRONG; "Yes" is an UNVERIFIED FAIL (UNCERTAIN); mean over 3 answers; ask_cost 1
  });

  it("is deterministic and returns at most 3 questions ordered by score", () => {
    const p = profile({});
    const ts = (["stage", "her2_status", "ecog", "pregnant"] as const).map((k, i) => trial(atom(`criterion about ${k}`, k, "eq", k === "pregnant" ? false : k === "ecog" ? "1" : k === "stage" ? "III" : "positive"), "other", p, "inclusion", `NCT0000000${i + 1}`));
    const a = computeQuestions(ts, p, 3), b = computeQuestions(ts, p, 3);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.score).toBeGreaterThanOrEqual(a[i]!.score);
  });
});
