// Profile extraction (FAST). Spike-grade prompt moved verbatim from eval/spike/07-e2e.ts (measured config).
// Changing any text here MUST bump EXTRACT_PROMPT_VERSION.
// VERIFY: extraction accuracy is not measured against labelled data.
import { z } from "zod";
import { FACT_KEYS, FactKeySchema } from "@/schema/vocabulary";

export const EXTRACT_PROMPT_VERSION = "spike-0";

export const ExtractSchema = z.object({
  facts: z.array(z.object({ key: FactKeySchema, state: z.enum(["known", "unknown", "uncertain"]), value: z.union([z.string(), z.number(), z.boolean()]).nullable(), note: z.string().nullable() })),
});
export const EXTRACT_SYSTEM = `You extract structured facts from a patient description. Use ONLY facts stated in the text; never infer or invent. For each vocabulary key you can address, return {key, state, value, note}: state "known" with a value if stated; "uncertain" with a value if approximate or hedged; "unknown" with value null if not stated. Booleans true/false; enums exactly as listed; numbers as numbers.
Vocabulary:
${FACT_KEYS.join(", ")}
Enum values: stage 0|I|II|III|IV; disease_setting early|locally_advanced|metastatic; ecog 0-4 as strings; her2_status positive|negative|low; er_status/pr_status positive|negative; menopausal_status pre|peri|post; sex female|male|other; cns_mets none|treated_stable|active; cardiac_disease none|history|active.
Output ONLY JSON {"facts":[...]}.`;

