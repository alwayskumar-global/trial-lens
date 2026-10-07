import { z } from "zod";
import { AdaptiveQuestionSchema, STUDY_QUESTIONS_VERSION, StudyQuestionSchema, TrialResultSchema } from "./assessment";
import { FactKeySchema } from "./vocabulary";

const Count = z.number().int().nonnegative();
const UsageGroupSchema = z.strictObject({ calls: Count, calls_with_usage: Count, calls_without_usage: Count, prompt_tokens: Count.nullable(), completion_tokens: Count.nullable() });
const UsageStageRowSchema = UsageGroupSchema.extend({ stage: z.enum(["extraction", "parse", "evaluate", "verify", "mismatch"]), tier: z.enum(["FAST", "MID"]), model: z.string().min(1).max(200) });

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: z.string(), status: z.enum(["start", "done"]) }),
  z.object({
    type: z.literal("counts"),
    discovered: z.number().int().nonnegative().optional(),
    filtered: z.number().int().nonnegative().optional(),
    // discovered: fetched from ClinicalTrials.gov · filtered: pass the age/sex prefilter · selected: sent to analysis (capped)
    // assessed: criteria were parsed (they may still be UNCERTAIN) · pending: no parse slot this run (queued for cache warm-up)
    // failed: the parse failed or was rejected. selected = assessed + pending + failed.
    selected: z.number().int().nonnegative().optional(),
    assessed: z.number().int().nonnegative().optional(),
    pending: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    /** Deprecated and no longer emitted: ambiguous. Kept optional so older stored replays still validate. */
    analyzed: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("profile"),
    // Facts extracted from the visitor's own text, returned only to the same visitor. Never stored.
    facts: z.array(z.object({ key: FactKeySchema, state: z.enum(["known", "uncertain"]), value: z.union([z.string(), z.number(), z.boolean()]).optional() })),
  }),
  z.object({ type: z.literal("trial_result"), assessment: TrialResultSchema }),
  /** Legacy answer-oriented question event: no longer emitted (the answer step is removed for the demo); kept so older stored replays still validate. Clients ignore it. */
  z.object({ type: z.literal("question"), questions: z.array(AdaptiveQuestionSchema) }),
  /** Study-team question panel. `questions: []` means the computation ran and found no supported item; it is not emitted when the computation did not run. */
  z.object({ type: z.literal("study_questions"), version: z.literal(STUDY_QUESTIONS_VERSION), questions: z.array(StudyQuestionSchema).max(3) }),
  z.object({
    type: z.literal("done"),
    replay: z.boolean(),
    // Run accounting (counts only). worst_case_calls <= MAX_LLM_CALLS_PER_RUN by construction.
    stats: z
      .object({
        llm_calls: z.number().int().nonnegative(),
        worst_case_calls: z.number().int().nonnegative(),
        wall_ms: z.number().int().nonnegative(),
        /** Token usage per stage and model (counts only). `null` tokens = the provider reported no usage (unavailable, never 0); `calls_without_usage > 0` = lower bound. */
        usage: z.strictObject({ version: z.literal("u-1"), stages: z.array(UsageStageRowSchema), total: UsageGroupSchema }).optional(),
      })
      .optional(),
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
