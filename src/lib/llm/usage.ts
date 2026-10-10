// Per-stage, per-model token usage for one run. COUNTS ONLY: stage/tier/model labels and integers; never prompts, profile text, responses or keys.
// A missing provider `usage` is UNAVAILABLE, never 0: token fields are `null` when no call in the group reported complete usage, and a group
// with `calls_without_usage > 0` reports a LOWER BOUND (the sum over the calls that did report), never an exact total.
import type { CallStats } from "@/lib/llm/client";

export type UsageStage = "extraction" | "parse" | "evaluate" | "verify" | "mismatch";
export type UsageTier = "FAST" | "MID";

export interface UsageGroup {
  calls: number;
  calls_with_usage: number;
  calls_without_usage: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}
export interface UsageStageRow extends UsageGroup {
  stage: UsageStage;
  tier: UsageTier;
  model: string;
}
export interface UsageSnapshot {
  version: "u-1";
  stages: UsageStageRow[];
  total: UsageGroup;
}

const empty = (): UsageGroup => ({ calls: 0, calls_with_usage: 0, calls_without_usage: 0, prompt_tokens: null, completion_tokens: null });
function add(g: UsageGroup, stats: Pick<CallStats, "usageComplete" | "promptTokens" | "completionTokens">): void {
  g.calls++;
  if (stats.usageComplete) {
    g.calls_with_usage++;
    g.prompt_tokens = (g.prompt_tokens ?? 0) + stats.promptTokens;
    g.completion_tokens = (g.completion_tokens ?? 0) + stats.completionTokens;
  } else g.calls_without_usage++; // no partial tokens from a call whose usage was not complete
}

export class UsageMeter {
  private rows = new Map<string, UsageStageRow>();
  private total = empty();

  /** `attempts === 0` means no request was sent (for example the call cap was reached): nothing to account for. */
  record(stage: UsageStage, tier: UsageTier, stats: Pick<CallStats, "attempts" | "model" | "usageComplete" | "promptTokens" | "completionTokens">): void {
    if (stats.attempts === 0) return;
    const key = `${stage}|${tier}|${stats.model}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { stage, tier, model: stats.model, ...empty() };
      this.rows.set(key, row);
    }
    add(row, stats);
    add(this.total, stats);
  }

  snapshot(): UsageSnapshot {
    return { version: "u-1", stages: [...this.rows.values()].map((r) => ({ ...r })), total: { ...this.total } };
  }
}
