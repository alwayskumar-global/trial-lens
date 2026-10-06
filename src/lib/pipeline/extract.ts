// Profile extraction (FAST), shared by /api/extract and the legacy text path of runPipeline.
// Output is re-validated with FactSchema: an invalid known fact becomes unknown. The visitor's text is held only in memory.
import { EXTRACT_SYSTEM, ExtractSchema } from "@/prompts/extract";
import { FactSchema, type Fact, type PatientProfile } from "@/schema/profile";
import { FACT_KEYS, type FactKey } from "@/schema/vocabulary";
import type { LlmPort } from "@/lib/pipeline/run";

/** One FAST call (plus its single validation retry inside the port). null ⇒ no usable profile. */
export async function extractProfile(profileText: string, llm: LlmPort): Promise<PatientProfile | null> {
  const { data } = await llm.call({ tier: "FAST", system: EXTRACT_SYSTEM, user: profileText, schema: ExtractSchema, schemaName: "facts", maxTokens: 4096 });
  if (!data) return null;
  const facts = Object.fromEntries(FACT_KEYS.map((k): [FactKey, Fact] => [k, { key: k, state: "unknown" }])) as Record<FactKey, Fact>;
  for (const f of data.facts) {
    const cand = FactSchema.safeParse({ key: f.key, state: f.state, ...(f.value !== null ? { value: f.value } : {}), ...(f.note ? { note: f.note } : {}) });
    if (cand.success && cand.data.state !== "unknown") facts[f.key] = cand.data;
  }
  return { facts };
}
