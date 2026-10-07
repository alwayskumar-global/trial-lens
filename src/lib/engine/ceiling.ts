// Policy R2 at the result level (see ceilingTier in tier.ts). Pure and idempotent. Applied to live results, to stored replays at read
// time, and at the SSE boundary, so no emitted result can be STRONG or LIKELY_MISMATCH whichever path produced it.
import type { TrialAssessment } from "@/schema/assessment";
import type { SseEvent } from "@/schema/sse";
import { ceilingTier } from "./tier";

/** Tiers a visitor-facing result may carry. */
export const EMITTABLE_TIERS: ReadonlySet<string> = new Set(["POSSIBLE", "UNCERTAIN"]);

export function applyCeilingToAssessment<T extends TrialAssessment>(a: T): T {
  const { tier, flag } = ceilingTier(a.tier);
  const flags = flag && !a.verifier_flags.includes(flag) ? [...a.verifier_flags, flag] : a.verifier_flags;
  return {
    ...a,
    tier,
    verifier_flags: flags,
    // A conflict is never "verified": that field must not read as verification of anything.
    verified: flag === "reported_conflict" || a.verifier_flags.includes("reported_conflict") ? false : a.verified,
    fact_basis: "visitor_reported",
  };
}

export function enforceTrialCeiling(e: SseEvent): SseEvent {
  return e.type === "trial_result" ? { ...e, assessment: applyCeilingToAssessment(e.assessment) } : e;
}

/** The hard backstop: throws when a result that would reach a visitor carries a tier the policy forbids. */
export function assertEmittable(e: SseEvent): void {
  if (e.type === "trial_result" && !EMITTABLE_TIERS.has(e.assessment.tier)) throw new Error("SSE_CONTRACT");
}
