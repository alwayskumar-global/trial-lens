// Verifier output for FAIL checks (rule D). The verifier sees ONLY the criterion text(s) and the known facts,
// never the first evaluator's reasoning, clause or claimed evidence.
import { z } from "zod";
import { checkIndices } from "@/lib/engine/checks";

export const FailVerdictSchema = z.enum(["confirmed", "not_confirmed", "cannot_substantiate"]);
export type FailVerdict = z.infer<typeof FailVerdictSchema>;

export const FailCheckItemSchema = z.object({
  index: z.number().int(),
  verdict: FailVerdictSchema,
  /** exact fragment of the criterion text that creates the conflict (null unless confirmed) */
  source_quote: z.string().nullable(),
  /** patient facts relied on, with their values as given (empty unless confirmed) */
  facts_used: z.array(z.object({ key: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })),
});
export type FailCheckItem = z.infer<typeof FailCheckItemSchema>;

export function makeFailCheckBatchSchema(n: number) {
  return z.object({ verdicts: z.array(FailCheckItemSchema) }).superRefine((b, ctx) => {
    const c = checkIndices(n, b.verdicts.map((v) => v.index));
    if (!c.ok) {
      ctx.addIssue({ code: "custom", path: ["verdicts"], message: `indices must be exactly 0..${n - 1} once each (missing [${c.missing}], duplicate [${c.duplicate}], unexpected [${c.unexpected}])` });
    }
  });
}
export type FailCheckBatch = z.infer<ReturnType<typeof makeFailCheckBatchSchema>>;
