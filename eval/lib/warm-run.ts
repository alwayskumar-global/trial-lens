// Gate in front of the warm-up executor entry point. PURE. `EXECUTE_ENABLED` is the on/off switch: it is false, and changing it is a reviewed code change
// made only after a separate approval of the fingerprint, writes and conditional budget (a test pins it to false).
import { planFingerprint, type PlannedTrial } from "./warm-guard";
import type { Approval } from "./warm-executor";

export const EXECUTE_ENABLED: boolean = false;
export const CONFIRM_VALUE = "parse-and-insert-approved-plan";
export const MAX_BUDGET_USD = 2; // sanity ceiling on the budget an environment variable may request

export interface PlanFile { policy: string; parser_version: string; fingerprint: string; trials: PlannedTrial[] }
export type GateResult = { ok: true; approval: Approval } | { ok: false; reason: "disabled" | "not_confirmed" | "bad_budget" | "plan_missing" | "plan_file_inconsistent" | "fingerprint_mismatch" };

/** Everything that must be true before any call: switch on, explicit confirmation, a sane budget, and a plan file whose fingerprint is the approved one AND recomputes. */
export function executeGate(env: Record<string, string | undefined>, plan: PlanFile | null, enabled: boolean = EXECUTE_ENABLED): GateResult {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (env["WARM_CONFIRM"] !== CONFIRM_VALUE) return { ok: false, reason: "not_confirmed" };
  const budget = Number(env["WARM_BUDGET_USD"]);
  if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET_USD) return { ok: false, reason: "bad_budget" };
  if (!plan || plan.trials.length === 0) return { ok: false, reason: "plan_missing" };
  if (planFingerprint(plan.parser_version, plan.policy, plan.trials) !== plan.fingerprint) return { ok: false, reason: "plan_file_inconsistent" };
  if (!env["WARM_PLAN"] || env["WARM_PLAN"] !== plan.fingerprint) return { ok: false, reason: "fingerprint_mismatch" };
  return { ok: true, approval: { fingerprint: plan.fingerprint, trials: plan.trials, budgetUsd: budget, attemptCeiling: 2 * plan.trials.reduce((a, t) => a + t.chunks, 0), maxWrites: plan.trials.length } };
}
