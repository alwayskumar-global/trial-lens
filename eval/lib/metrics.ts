// Pure metrics (SPEC §7). No I/O, no model. A predicted AMBIGUOUS counts as an abstention (like UNKNOWN); NOT_APPLICABLE gold is not scored.
import type { UsageSnapshot } from "../../src/lib/llm/usage";
import { PRICE } from "../cost-per-run";
import type { EvalCriterionCase, EvalTier, Gold, SigirLabel, Status } from "./types";

export interface ScoredCase {
  case: Pick<EvalCriterionCase, "caseId" | "type" | "gold">;
  predicted: Status;
}
const abstains = (s: Status) => s === "UNKNOWN" || s === "AMBIGUOUS";
const commits = (s: Status) => s === "PASS" || s === "FAIL";
const norm = (s: Status): "PASS" | "FAIL" | "UNKNOWN" => (s === "AMBIGUOUS" ? "UNKNOWN" : s);
const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

export interface CriterionMetrics {
  scored: number;
  notApplicable: number;
  correct: number;
  accuracy: number | null;
  /** rows = gold, columns = predicted (AMBIGUOUS folded into UNKNOWN) */
  confusion: Record<"PASS" | "FAIL" | "UNKNOWN", Record<"PASS" | "FAIL" | "UNKNOWN", number>>;
  /** committed (PASS/FAIL) predictions where the gold says UNKNOWN, over all committed predictions: an assumption nothing supports. Target about 0. */
  unsupportedAssumptions: number;
  unsupportedAssumptionRate: number | null;
  /** exclusion criteria whose gold is FAIL (patient excluded) that were predicted PASS, over all such criteria: the dangerous error */
  falsePassExclusion: number;
  falsePassExclusionRate: number | null;
  /** UNKNOWN detection: abstentions that were right / all abstentions, and abstentions caught / all gold UNKNOWN */
  unknownPrecision: number | null;
  unknownRecall: number | null;
}

export function criterionMetrics(rows: readonly ScoredCase[]): CriterionMetrics {
  const zero = () => ({ PASS: 0, FAIL: 0, UNKNOWN: 0 });
  const confusion = { PASS: zero(), FAIL: zero(), UNKNOWN: zero() };
  let scored = 0, notApplicable = 0, correct = 0, committed = 0, unsupported = 0, exclFail = 0, exclFailPass = 0, abstained = 0, abstainedRight = 0, goldUnknown = 0;
  for (const r of rows) {
    if (r.case.gold === "NOT_APPLICABLE") { notApplicable++; continue; }
    scored++;
    const g = r.case.gold as Exclude<Gold, "NOT_APPLICABLE">;
    const p = norm(r.predicted);
    confusion[g][p]++;
    if (p === g) correct++;
    if (commits(r.predicted)) { committed++; if (g === "UNKNOWN") unsupported++; }
    if (r.case.type === "exclusion" && g === "FAIL") { exclFail++; if (r.predicted === "PASS") exclFailPass++; }
    if (abstains(r.predicted)) { abstained++; if (g === "UNKNOWN") abstainedRight++; }
    if (g === "UNKNOWN") goldUnknown++;
  }
  return {
    scored, notApplicable, correct, accuracy: ratio(correct, scored), confusion,
    unsupportedAssumptions: unsupported, unsupportedAssumptionRate: ratio(unsupported, committed),
    falsePassExclusion: exclFailPass, falsePassExclusionRate: ratio(exclFailPass, exclFail),
    unknownPrecision: ratio(abstainedRight, abstained), unknownRecall: ratio(abstainedRight, goldUnknown),
  };
}

export interface TierAgreement {
  /** counts[tier][sigirLabel] */
  table: Record<EvalTier, Record<SigirLabel, number>>;
  total: number;
  /** SIGIR "would refer" (2) trials the system left UNCERTAIN, over all label-2 trials (lost recall under the conservative tiering) */
  wouldReferLeftUncertain: number | null;
  /** SIGIR "would not refer" (0) trials the system called POSSIBLE, over all label-0 trials (over-confidence) */
  wouldNotReferCalledPossible: number | null;
}

/** Trial-level agreement against SIGIR 2016 labels. Under Policy R2 only POSSIBLE and UNCERTAIN exist, so this is a contingency table plus two rates, not an accuracy. */
export function tierAgreement(rows: ReadonlyArray<{ tier: EvalTier; label: SigirLabel }>): TierAgreement {
  const row = () => ({ 0: 0, 1: 0, 2: 0 }) as Record<SigirLabel, number>;
  const table = { POSSIBLE: row(), UNCERTAIN: row() };
  for (const r of rows) table[r.tier][r.label]++;
  const l2 = table.POSSIBLE[2] + table.UNCERTAIN[2], l0 = table.POSSIBLE[0] + table.UNCERTAIN[0];
  return { table, total: rows.length, wouldReferLeftUncertain: ratio(table.UNCERTAIN[2], l2), wouldNotReferCalledPossible: ratio(table.POSSIBLE[0], l0) };
}

export interface CostSummary {
  runs: number;
  calls: number;
  callsWithoutUsage: number;
  /** null when no call reported usage; otherwise the sum over calls that did (a lower bound whenever callsWithoutUsage > 0) */
  promptTokens: number | null;
  completionTokens: number | null;
  /** priced from the account per-token prices in eval/cost-per-run.ts; null when tokens are unavailable; lowerBound true when some calls had no usage */
  costUsd: number | null;
  lowerBound: boolean;
}

/** Aggregates run `usage` blocks (u-1). Missing provider usage is unavailable, never zero. */
export function summarizeUsage(runs: ReadonlyArray<UsageSnapshot | null | undefined>, wallMs: readonly number[] = []): CostSummary & { wallMsMean: number | null } {
  let calls = 0, without = 0, prompt: number | null = null, completion: number | null = null, cost: number | null = null;
  for (const u of runs) {
    if (!u) continue;
    calls += u.total.calls; without += u.total.calls_without_usage;
    for (const r of u.stages) {
      if (r.prompt_tokens === null || r.completion_tokens === null) continue;
      prompt = (prompt ?? 0) + r.prompt_tokens; completion = (completion ?? 0) + r.completion_tokens;
      cost = (cost ?? 0) + r.prompt_tokens * PRICE[r.tier].p + r.completion_tokens * PRICE[r.tier].c;
    }
  }
  return { runs: runs.filter(Boolean).length, calls, callsWithoutUsage: without, promptTokens: prompt, completionTokens: completion, costUsd: cost, lowerBound: without > 0 && cost !== null, wallMsMean: wallMs.length ? wallMs.reduce((a, b) => a + b, 0) / wallMs.length : null };
}
