import { describe, expect, it } from "vitest";
import { leafToNode } from "@/lib/engine/clause";
import { atom } from "@/lib/engine/test-helpers";
import type { ParseOutcome } from "@/lib/engine/reconcile";
import type { TrialResult } from "@/schema/assessment";
import type { ReplayCase } from "./replay";
import { insertStudyQuestions, planReplayStudyQuestions } from "./replay-study-questions";

const WORDING = "ECOG performance status 0 or 1";
const outcome = (): ParseOutcome => ({ state: "parsed", category: "performance", scoring: true, clause: leafToNode(atom(WORDING, "ecog", "in", ["0", "1"])), completeness: "full", vet: "ok" });
const result = (nct: string, over: Partial<TrialResult> = {}): TrialResult => ({
  nct_id: nct, title: "Fictional " + nct, tier: "UNCERTAIN", verified: false, verifier_flags: [], sites: [], coordinator_questions: [],
  findings: [{ criterion_id: `${nct}:inclusion:0`, status: "UNKNOWN", evidence: [], rationale: "", source: "code" }],
  criteria: [{ id: `${nct}:inclusion:0`, type: "inclusion", text: WORDING, category: "performance", completeness: "full" }], ...over,
});
const mkCase = (...rs: TrialResult[]): ReplayCase => ({ id: "x", label: "x", profile_text: "fictional", events: [{ type: "profile", facts: [{ key: "age", state: "known", value: 52 }] }, ...rs.map((assessment) => ({ type: "trial_result" as const, assessment }))] });
const parses = (...ncts: string[]) => new Map(ncts.map((n) => [n, [outcome()]]));

describe("planReplayStudyQuestions", () => {
  it("builds the panel from the same stored trials and verifies every NCT id and criterion against them", () => {
    const r = planReplayStudyQuestions(mkCase(result("NCT00000001"), result("NCT00000002")), parses("NCT00000001", "NCT00000002"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.questions[0]).toMatchObject({ fact_key: "ecog", study_count: 2 });
    expect(r.event.questions[0]!.studies.flatMap((s) => s.criteria.map((c) => c.text))).toEqual([WORDING, WORDING]);
    expect(r.excluded).toEqual([]);
  });
  it("stops (no event) when an assessed trial has no cached parse", () => {
    expect(planReplayStudyQuestions(mkCase(result("NCT00000001"), result("NCT00000002")), parses("NCT00000001"))).toEqual({ ok: false, problems: ["missing_parse:NCT00000002"] });
  });
  it("stops when a parse does not match the stored criteria count", () => {
    const m = new Map([["NCT00000001", [outcome(), outcome()]]]);
    const r = planReplayStudyQuestions(mkCase(result("NCT00000001")), m);
    expect(r).toEqual({ ok: false, problems: ["parse_count_mismatch:NCT00000001:2!=1"] });
  });
  it("stops when a stored finding is missing", () => {
    const r = planReplayStudyQuestions(mkCase(result("NCT00000001", { findings: [] })), parses("NCT00000001"));
    expect(r.ok).toBe(false);
  });
  it("a trial that was never assessed (pending or failed in its own stored result) is excluded and listed, not an error", () => {
    const r = planReplayStudyQuestions(mkCase(result("NCT00000001"), result("NCT00000002", { verifier_flags: ["analysis_pending"] }), result("NCT00000003", { analysis_failed: true })), parses("NCT00000001"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.excluded).toEqual([{ nct_id: "NCT00000002", reason: "analysis_pending" }, { nct_id: "NCT00000003", reason: "analysis_failed" }]);
    expect(r.assessedTrials).toBe(1);
  });
  it("a missing parse for a trial NOT flagged pending/failed is never excused", () => {
    expect(planReplayStudyQuestions(mkCase(result("NCT00000001", { verifier_flags: ["reported_only"] })), new Map()).ok).toBe(false);
  });
  it("stops on a case with no trial results or no profile event", () => {
    expect(planReplayStudyQuestions({ ...mkCase(), events: [] }, new Map())).toEqual({ ok: false, problems: ["no_trial_results"] });
    expect(planReplayStudyQuestions({ ...mkCase(result("NCT00000001")), events: [{ type: "trial_result", assessment: result("NCT00000001") }] }, parses("NCT00000001"))).toEqual({ ok: false, problems: ["no_profile_event"] });
  });
  it("a cached parse whose criterion no longer matches the stored wording cannot slip through: the panel text always equals the stored text", () => {
    const r = planReplayStudyQuestions(mkCase(result("NCT00000001")), parses("NCT00000001"));
    expect(r.ok && r.event.questions[0]!.studies[0]!.criteria[0]!.text).toBe(WORDING);
  });
});

describe("insertStudyQuestions", () => {
  const ev = { type: "study_questions" as const, version: "sq-1" as const, questions: [] };
  it("inserts after the legacy question event and before the first trial_result, changing nothing else", () => {
    const raw = [{ type: "stage" }, { type: "profile" }, { type: "question", questions: [] }, { type: "trial_result", n: 1 }, { type: "trial_result", n: 2 }];
    const out = insertStudyQuestions(raw, ev);
    expect(out.map((e) => (e as { type: string }).type)).toEqual(["stage", "profile", "question", "study_questions", "trial_result", "trial_result"]);
    expect(out.filter((e) => (e as { type: string }).type !== "study_questions")).toEqual(raw);
  });
  it("without a legacy question event it goes right before the first trial_result; an earlier study_questions is replaced (idempotent)", () => {
    const raw = [{ type: "profile" }, { type: "trial_result" }];
    const once = insertStudyQuestions(raw, ev);
    expect(once.map((e) => (e as { type: string }).type)).toEqual(["profile", "study_questions", "trial_result"]);
    expect(insertStudyQuestions(once, ev)).toEqual(once);
  });
});
