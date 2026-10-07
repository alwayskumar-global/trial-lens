// Offline runner. The Evaluator interface is the seam where a live pipeline evaluator will plug in for the first full eval run (separately approved,
// paid). Nothing here calls a model; only the test evaluators below are wired.
import type { UsageSnapshot } from "../../src/lib/llm/usage";
import { configHash } from "./ablations";
import { criterionMetrics, summarizeUsage, type CriterionMetrics, type ScoredCase } from "./metrics";
import type { AblationSwitches, EvalCriterionCase, Status } from "./types";

export interface EvalOutcome {
  status: Status;
  /** run usage block (u-1) when the evaluator is a live one; offline evaluators leave it undefined */
  usage?: UsageSnapshot | null;
  wallMs?: number;
}
export interface Evaluator {
  name: string;
  evaluate(c: EvalCriterionCase, config: AblationSwitches): Promise<EvalOutcome>;
}

export interface EvalRun {
  evaluator: string;
  config: AblationSwitches;
  configHash: string;
  cases: number;
  metrics: CriterionMetrics;
  sources: string[];
  cost: ReturnType<typeof summarizeUsage>;
  /** per-case predictions by id only (no criterion or patient text) */
  predictions: Array<{ caseId: string; gold: EvalCriterionCase["gold"]; predicted: Status }>;
}

export async function runEval(a: { cases: readonly EvalCriterionCase[]; evaluator: Evaluator; config: AblationSwitches }): Promise<EvalRun> {
  const scored: ScoredCase[] = [], usage: Array<UsageSnapshot | null | undefined> = [], wall: number[] = [];
  const predictions: EvalRun["predictions"] = [];
  for (const c of a.cases) {
    const o = await a.evaluator.evaluate(c, a.config);
    scored.push({ case: { caseId: c.caseId, type: c.type, gold: c.gold }, predicted: o.status });
    usage.push(o.usage);
    if (o.wallMs !== undefined) wall.push(o.wallMs);
    predictions.push({ caseId: c.caseId, gold: c.gold, predicted: o.status });
  }
  return { evaluator: a.evaluator.name, config: a.config, configHash: configHash(a.config), cases: a.cases.length, metrics: criterionMetrics(scored), sources: [...new Set(a.cases.map((c) => c.source))].sort(), cost: summarizeUsage(usage, wall), predictions };
}

// ---- offline test evaluators --------------------------------------------------------------------------------------------------------
export const oracleEvaluator: Evaluator = { name: "oracle", evaluate: async (c) => ({ status: c.gold === "NOT_APPLICABLE" ? "UNKNOWN" : c.gold }) };
export const alwaysUnknownEvaluator: Evaluator = { name: "always-unknown", evaluate: async () => ({ status: "UNKNOWN" }) };
export const alwaysPassEvaluator: Evaluator = { name: "always-pass", evaluate: async () => ({ status: "PASS" }) };
export const tableEvaluator = (name: string, table: Readonly<Record<string, Status>>): Evaluator => ({ name, evaluate: async (c) => ({ status: table[c.caseId] ?? "UNKNOWN" }) });
