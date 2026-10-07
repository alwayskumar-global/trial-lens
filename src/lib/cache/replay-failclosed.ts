// READ-TIME, NO-WRITE treatment of stored replay events under the fail-closed rule (docs/eval-abstention-set.md). Pure; no model call, no database access.
// Stored replays were generated before the rule: their `llm_mid` PASS/FAIL findings were never derived by code. A free-text stage only ever ran on criteria the
// code could not decide, so every stored `llm_mid` PASS/FAIL lacks independent proof by construction; no parse is needed to say so (two stored trials have no
// cached parse and are treated identically).
//   - findings: `llm_mid` PASS/FAIL -> UNKNOWN, evidence [], fixed rationale, guard_downgraded, Rule D state (`fail_check`) removed. Code findings are untouched.
//   - tier: recomputed from the stored criterion views and the new statuses, and NEVER raised (verification and fail checks cannot be re-run; a trial whose tier
//     rested on a model-only FAIL is UNCERTAIN, not promoted). A trial without criterion views falls to UNCERTAIN.
//   - verified: kept unless the final tier is not POSSIBLE (live behavior: only POSSIBLE trials credit a verification pass). The verifier reads criteria and facts,
//     not findings, so its result is not invalidated by downgraded findings; it is not re-run.
//   - top_unknown: recomputed as the first open scoring criterion.
//   - `study_questions` events are DROPPED (panels computed before the rule may rest on rejected-atom dependencies; no panel is shown until the backfill is approved).
//   - `counts` (assessed / pending / failed, about parsing) are unchanged. The result is re-sorted by final tier like a live run.
// The read-time Policy R2 ceiling still runs after this (it adds `reported_conflict` only to a trial that is still LIKELY_MISMATCH, which no longer exists here).
import type { CriterionFinding } from "@/schema/criteria";
import type { Tier, TrialResult } from "@/schema/assessment";
import { NOT_ENOUGH_INFO } from "@/lib/engine/fail-closed";
import { ceilingTier, tierTrial, type TierCriterion } from "@/lib/engine/tier";
import type { StoredEvent } from "./replay";

export const REPLAY_TIER_UNKNOWN_THRESHOLD = 3; // the .env.example default the stored replays were generated with (validated against the stored tiers offline)
const RANK: Tier[] = ["STRONG", "POSSIBLE", "UNCERTAIN", "LIKELY_MISMATCH"];
const TIER_ORDER = RANK;

const unprovable = (f: CriterionFinding): boolean => f.source === "llm_mid" && (f.status === "PASS" || f.status === "FAIL");

export function downgradeStoredFinding(f: CriterionFinding): CriterionFinding {
  if (!unprovable(f)) return f;
  const { fail_check: _fc, applicability: _ap, ...rest } = f;
  void _fc; void _ap;
  return { ...rest, status: "UNKNOWN", evidence: [], rationale: NOT_ENOUGH_INFO, guard_downgraded: true };
}

export function failClosedTrial(a: TrialResult): TrialResult {
  const findings = a.findings.map(downgradeStoredFinding);
  if (findings.every((f, i) => f === a.findings[i])) return a; // nothing model-only: untouched
  const crit = a.criteria;
  let tier: Tier = "UNCERTAIN";
  if (crit && crit.length > 0) {
    const byId = new Map(findings.map((f) => [f.criterion_id, f]));
    const tc: TierCriterion[] = crit.map((c) => ({
      scoring: c.category !== "consent_logistics",
      category: c.category as TierCriterion["category"],
      status: byId.get(c.id)?.status ?? "UNKNOWN",
      completeness: c.completeness,
      failCheck: byId.get(c.id)?.fail_check,
    }));
    const recomputed = tierTrial(tc, { unknownThreshold: REPLAY_TIER_UNKNOWN_THRESHOLD, expectedCriteria: crit.length });
    // never raised; a stored LIKELY_MISMATCH rested on a (model-only) FAIL, so it becomes UNCERTAIN whatever the recomputation says
    tier = a.tier === "LIKELY_MISMATCH" ? "UNCERTAIN" : RANK.indexOf(recomputed) > RANK.indexOf(a.tier) ? recomputed : a.tier;
  }
  const finalTier = ceilingTier(tier).tier;
  const open = crit?.find((c) => c.category !== "consent_logistics" && ["UNKNOWN", "AMBIGUOUS"].includes(findings.find((f) => f.criterion_id === c.id)?.status ?? "UNKNOWN"));
  return {
    ...a,
    findings,
    tier,
    verified: a.verified && finalTier === "POSSIBLE",
    ...(crit ? { top_unknown: open?.id ?? null } : {}),
  };
}

export function failClosedStoredEvents<E extends StoredEvent>(events: readonly E[]): E[] {
  const mapped = events.filter((e) => e.type !== "study_questions").map((e): E => (e.type === "trial_result" ? { ...e, assessment: failClosedTrial(e.assessment) } : e));
  // re-sort the trial results by final tier, stably, keeping every other event where it was
  const slots = mapped.flatMap((e, i) => (e.type === "trial_result" ? [i] : []));
  const sorted = slots.map((i) => mapped[i]!).sort((x, y) => (TIER_ORDER.indexOf(ceilingTier(x.type === "trial_result" ? x.assessment.tier : "UNCERTAIN").tier)) - (TIER_ORDER.indexOf(ceilingTier(y.type === "trial_result" ? y.assessment.tier : "UNCERTAIN").tier)));
  const out = [...mapped];
  slots.forEach((slot, k) => { out[slot] = sorted[k]!; });
  return out;
}
