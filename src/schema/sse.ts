import { z } from "zod";
import { AdaptiveQuestionSchema, TrialAssessmentSchema } from "./assessment";

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage"), stage: z.string(), status: z.enum(["start", "done"]) }),
  z.object({
    type: z.literal("counts"),
    discovered: z.number().int().nonnegative().optional(),
    filtered: z.number().int().nonnegative().optional(),
    analyzed: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("trial_result"), assessment: TrialAssessmentSchema }),
  z.object({ type: z.literal("question"), questions: z.array(AdaptiveQuestionSchema) }),
  z.object({ type: z.literal("done"), replay: z.boolean() }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    fallback_to_replay: z.boolean(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
