// Non-secret EFFECTIVE configuration values added to every /api/run log line, so a free replay request proves what a deployment actually loaded
// (project env cannot always be read through the API). Integers, fixed enums and booleans only; never keys, URLs or secrets. A value that fails
// validation is reported as the fixed string "env_invalid", never silently defaulted.
import { getPipelineEnv, getSelectionEnv } from "@/lib/env";
import { visitorConfig } from "@/lib/visitor-config";

const safe = <T>(f: () => T): T | "env_invalid" => {
  try {
    return f();
  } catch {
    return "env_invalid";
  }
};

export function effectiveConfigLogFields(): { cache_writes: boolean | string; selection_mode: string; max_calls: number | string; visitor_input_mode: string } {
  return {
    cache_writes: safe(() => getPipelineEnv().CRITERIA_CACHE_WRITES),
    selection_mode: safe(() => getSelectionEnv().CTGOV_SELECTION_MODE),
    max_calls: safe(() => getPipelineEnv().MAX_LLM_CALLS_PER_RUN), // the cap createPipelineDeps passes to CallCap and RunBudget
    visitor_input_mode: safe(() => visitorConfig().mode),
  };
}
