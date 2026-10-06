import { z } from "zod";
import { AdaptiveQuestionSchema, TrialResultSchema } from "./assessment";
import { FactKeySchema } from "./vocabulary";

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: z.string(), status: z.enum(["start", "done"]) }),
  z.object({
    type: z.literal("counts"),
    discovered: z.number().int().nonnegative().optional(),
    filtered: z.number().int().nonnegative().optional(),
    analyzed: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("profile"),
    // Facts extracted from the visitor's own text, returned only to the same visitor. Never stored.
    facts: z.array(z.object({ key: FactKeySchema, state: z.enum(["known", "uncertain"]), value: z.union([z.string(), z.number(), z.boolean()]).optional() })),
  }),
  z.object({ type: z.literal("trial_result"), assessment: TrialResultSchema }),
  z.object({ type: z.literal("question"), questions: z.array(AdaptiveQuestionSchema) }),
  z.object({
    type: z.literal("done"),
    replay: z.boolean(),
    // Run accounting (counts only). worst_case_calls <= MAX_LLM_CALLS_PER_RUN by construction.
    stats: z.object({ llm_calls: z.number().int().nonnegative(), worst_case_calls: z.number().int().nonnegative(), wall_ms: z.number().int().nonnegative() }).optional(),
  }),
  z.object({
    type: z.literal("mode"),
    mode: z.enum(["live", "replay"]),
    // Why the run is a replay (fixed codes; never provider text). Absent for a live run or an explicit replay request.
    reason: z.enum(["requested", "rate_limited", "budget_exhausted", "guard_unavailable", "model_unavailable", "ctgov_unavailable", "disabled"]).optional(),
    replay_id: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    fallback_to_replay: z.boolean(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
