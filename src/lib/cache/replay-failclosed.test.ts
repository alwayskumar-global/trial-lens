// Read-time fail-closed treatment of stored replays (synthetic stored events; fictional; no database).
import { describe, expect, it } from "vitest";
import type { TrialResult } from "@/schema/assessment";
import type { CriterionFinding } from "@/schema/criteria";
import { failClosedStoredEvents, failClosedTrial } from "./replay-failclosed";
import { replayEvents, type ReplayCase, type StoredEvent } from "./replay";

const crit = (id: string, category: string | null, completeness: "full" | "partial" | "unresolved" = "partial") => ({ id, type: "inclusion" as const, text: `synthetic ${id}`, category, completeness });
const f = (id: string, status: CriterionFinding["status"], source: CriterionFinding["source"], extra: Partial<CriterionFinding> = {}): CriterionFinding =>
  ({ criterion_id: id, status, evidence: status === "PASS" || status === "FAIL" ? ["age"] : [], rationale: "model words", source, ...extra });
const trial = (nct: string, tier: TrialResult["tier"], findings: CriterionFinding[], criteria: TrialResult["criteria"], extra: Partial<TrialResult> = {}): TrialResult =>
  ({ nct_id: nct, title: "t", tier, findings, verified: false, verifier_flags: [], sites: [], coordinator_questions: [], criteria, top_unknown: null, ...extra });

describe("failClosedTrial", () => {
  it("downgrades only model PASS/FAIL: evidence, rationale, Rule D state and flag; code findings and UNKNOWN/AMBIGUOUS are untouched", () => {
    const t = trial("NCT1", "UNCERTAIN", [f("a", "PASS", "llm_mid"), f("b", "FAIL", "llm_mid", { fail_check: "verified" }), f("c", "FAIL", "code", { fail_check: "no_capacity" }), f("d", "AMBIGUOUS", "llm_mid")], [crit("a", "other"), crit("b", "other"), crit("c", "other", "full"), crit("d", "other")]);
    const r = failClosedTrial(t);
    expect(r.findings[0]).toMatchObject({ status: "UNKNOWN", evidence: [], rationale: "Not enough confirmed information to decide.", guard_downgraded: true });
    expect(r.findings[1]!.status).toBe("UNKNOWN");
    expect(r.findings[1]!.fail_check).toBeUndefined();
    expect(r.findings[2]).toEqual(t.findings[2]); // code FAIL keeps its status and its Rule D state
    expect(r.findings[3]).toEqual(t.findings[3]);
  });

  it("a trial with nothing model-only is returned untouched (same object)", () => {
    const t = trial("NCT2", "POSSIBLE", [f("a", "PASS", "code")], [crit("a", "lab", "full")]);
    expect(failClosedTrial(t)).toBe(t);
  });

  it("a stored LIKELY_MISMATCH that rested on a model-only FAIL becomes UNCERTAIN, verified false, and the read-time ceiling adds no reported_conflict", () => {
    const t = trial("NCT3", "LIKELY_MISMATCH", [f("a", "FAIL", "llm_mid", { fail_check: "verified" })], [crit("a", "lab")]);
    const r = failClosedTrial(t);
    expect(r.tier).toBe("UNCERTAIN");
    expect(r.verified).toBe(false);
    const c: ReplayCase = { id: "x", label: "x", profile_text: "x", events: [{ type: "trial_result", assessment: t }] };
    const out = replayEvents(c, "requested").flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []))[0]!;
    expect(out.verifier_flags).not.toContain("reported_conflict");
    expect(out.tier).toBe("UNCERTAIN");
    expect(out.findings[0]!.status).toBe("UNKNOWN");
  });

  it("a POSSIBLE trial whose downgraded PASS was on a CORE criterion drops to UNCERTAIN and loses `verified`; a non-core one stays POSSIBLE and keeps it", () => {
    const core = failClosedTrial(trial("NCT4", "POSSIBLE", [f("a", "PASS", "llm_mid")], [crit("a", "biomarker")], { verified: true }));
    expect(core).toMatchObject({ tier: "UNCERTAIN", verified: false });
    const non = failClosedTrial(trial("NCT5", "POSSIBLE", [f("a", "PASS", "llm_mid")], [crit("a", "other")], { verified: true }));
    expect(non).toMatchObject({ tier: "POSSIBLE", verified: true });
  });

  it("the tier is never raised: an UNCERTAIN trial whose only blocker was a model FAIL stays UNCERTAIN (verification cannot be re-run)", () => {
    const r = failClosedTrial(trial("NCT6", "UNCERTAIN", [f("a", "FAIL", "llm_mid", { fail_check: "no_capacity" })], [crit("a", "other")]));
    expect(r.tier).toBe("UNCERTAIN");
  });

  it("a trial without criterion views falls to UNCERTAIN; top_unknown is recomputed as the first open scoring criterion", () => {
    expect(failClosedTrial(trial("NCT7", "POSSIBLE", [f("a", "PASS", "llm_mid")], undefined)).tier).toBe("UNCERTAIN");
    const r = failClosedTrial(trial("NCT8", "POSSIBLE", [f("a", "PASS", "llm_mid"), f("b", "UNKNOWN", "code")], [crit("a", "other"), crit("b", "other")]));
    expect(r.top_unknown).toBe("a"); // the downgraded row is now the first open scoring criterion
  });

  it("is idempotent", () => {
    const t = trial("NCT9", "LIKELY_MISMATCH", [f("a", "FAIL", "llm_mid", { fail_check: "verified" }), f("b", "PASS", "llm_mid")], [crit("a", "lab"), crit("b", "other")]);
    expect(failClosedTrial(failClosedTrial(t))).toEqual(failClosedTrial(t));
  });
});

describe("failClosedStoredEvents", () => {
  const tr = (n: string, tier: TrialResult["tier"], fs: CriterionFinding[], cs: TrialResult["criteria"]): StoredEvent => ({ type: "trial_result", assessment: trial(n, tier, fs, cs) });
  it("drops the stored study_questions panel, keeps counts and other events, and re-sorts the trials by final tier", () => {
    const events: StoredEvent[] = [
      { type: "counts", assessed: 3, pending: 0, failed: 0 },
      tr("NCT1", "POSSIBLE", [f("a", "PASS", "llm_mid")], [crit("a", "biomarker")]), // becomes UNCERTAIN
      tr("NCT2", "POSSIBLE", [f("a", "PASS", "code")], [crit("a", "lab", "full")]),
      { type: "study_questions", version: "sq-1", questions: [] },
      tr("NCT3", "UNCERTAIN", [f("a", "UNKNOWN", "code")], [crit("a", "other")]),
    ];
    const out = failClosedStoredEvents(events);
    expect(out.some((e) => e.type === "study_questions")).toBe(false);
    expect(out.find((e) => e.type === "counts")).toEqual(events[0]);
    expect(out.flatMap((e) => (e.type === "trial_result" ? [e.assessment.nct_id] : []))).toEqual(["NCT2", "NCT1", "NCT3"]);
  });
});

describe("stale flags and legacy events cannot survive", () => {
  const out = (events: StoredEvent[]) => replayEvents({ id: "x", label: "x", profile_text: "x", events }, "requested");
  const resultOf = (events: StoredEvent[]) => out(events).flatMap((e) => (e.type === "trial_result" ? [e.assessment] : []))[0]!;

  it("a stored (post-R2) reported_conflict that rested on a model-only verified FAIL is gone after the findings are recomputed, and the ceiling does not re-add it", () => {
    const t = trial("NCT1", "UNCERTAIN", [f("a", "FAIL", "llm_mid", { fail_check: "verified" })], [crit("a", "lab")], { verifier_flags: ["reported_conflict"], verified: false, fact_basis: "visitor_reported" });
    const r = resultOf([{ type: "trial_result", assessment: t }]);
    expect(r.verifier_flags).not.toContain("reported_conflict");
    expect(r.findings[0]!.status).toBe("UNKNOWN");
    expect(r.verified).toBe(false); // never re-credited
  });

  it("a reported_conflict still supported by a CODE FAIL with a verified check is kept", () => {
    const t = trial("NCT2", "UNCERTAIN", [f("a", "FAIL", "code", { fail_check: "verified" })], [crit("a", "lab", "full")], { verifier_flags: ["reported_conflict"] });
    expect(resultOf([{ type: "trial_result", assessment: t }]).verifier_flags).toContain("reported_conflict");
  });

  it("a stored LIKELY_MISMATCH that is still one (code FAIL, verified) gets its flag from the read-time ceiling, once", () => {
    const t = trial("NCT3", "LIKELY_MISMATCH", [f("a", "FAIL", "code", { fail_check: "verified" })], [crit("a", "lab", "full")]);
    const r = resultOf([{ type: "trial_result", assessment: t }]);
    expect(r.tier).toBe("UNCERTAIN");
    expect(r.verifier_flags.filter((x) => x === "reported_conflict")).toHaveLength(1);
  });

  it("reported_only is dropped when the recomputed tier is no longer POSSIBLE and kept while it is", () => {
    const core = trial("NCT4", "POSSIBLE", [f("a", "PASS", "llm_mid")], [crit("a", "biomarker")], { verifier_flags: ["reported_only"], verified: true });
    expect(resultOf([{ type: "trial_result", assessment: core }])).toMatchObject({ tier: "UNCERTAIN", verified: false, verifier_flags: [] });
    const non = trial("NCT5", "POSSIBLE", [f("a", "PASS", "llm_mid")], [crit("a", "other")], { verifier_flags: ["reported_only"], verified: true });
    expect(resultOf([{ type: "trial_result", assessment: non }]).verifier_flags).toEqual(["reported_only"]);
  });

  it("a stale flag on a trial with nothing model-only is also dropped when its tier does not support it", () => {
    const t = trial("NCT6", "POSSIBLE", [f("a", "PASS", "code")], [crit("a", "lab", "full")], { verifier_flags: ["reported_conflict"] });
    expect(resultOf([{ type: "trial_result", assessment: t }]).verifier_flags).toEqual([]);
  });

  it("legacy `question` and `study_questions` events are not in the read-time output; counts, profile and results are", () => {
    const events: StoredEvent[] = [
      { type: "profile", facts: [] },
      { type: "counts", assessed: 1, pending: 0, failed: 0 },
      { type: "question", questions: [] },
      { type: "study_questions", version: "sq-1", questions: [] },
      { type: "trial_result", assessment: trial("NCT7", "UNCERTAIN", [f("a", "UNKNOWN", "code")], [crit("a", "other")]) },
    ];
    const types = out(events).map((e) => e.type);
    expect(types).toEqual(["mode", "profile", "counts", "trial_result", "done"]);
  });
});
