// Free-text criterion evaluation (MID), one call per trial. Spike-grade prompt moved verbatim from eval/spike/07-e2e.ts.
// Changing any text here MUST bump EVALUATE_PROMPT_VERSION.
import { z } from "zod";
import { checkIndices } from "@/lib/engine/checks";

export const EVALUATE_PROMPT_VERSION = "spike-0";

const FINDING_STATUS = z.enum(["PASS", "FAIL", "UNKNOWN", "AMBIGUOUS"]);
export function makeEvalSchema(n: number) {
  return z
    .object({ findings: z.array(z.object({ index: z.number().int(), status: FINDING_STATUS, evidence: z.array(z.string()), rationale: z.string() })) })
    .superRefine((b, ctx) => {
      const c = checkIndices(n, b.findings.map((f) => f.index));
      if (!c.ok) ctx.addIssue({ code: "custom", message: `indices must be exactly 0..${n - 1} once each (missing [${c.missing}], duplicate [${c.duplicate}], unexpected [${c.unexpected}])` });
    });
}
export const EVAL_SYSTEM = `You compare ONE patient's confirmed facts with trial eligibility criteria. Use ONLY the facts provided. Status per criterion:
PASS = patient is not blocked (inclusion met, or exclusion does not apply); FAIL = patient appears blocked; UNKNOWN = needed information is not in the facts; AMBIGUOUS = needs clinical judgment.
PASS and FAIL require "evidence": the fact keys you relied on. If unsure, answer UNKNOWN. Never guess; never assume missing facts. rationale ≤ 15 words.
Output ONLY JSON {"findings":[{"index","status","evidence":[keys],"rationale"}]}, one per input index.`;
