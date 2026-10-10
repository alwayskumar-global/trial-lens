// Criteria parser prompt. Changing any text here MUST bump CRITERIA_PARSE_PROMPT_VERSION
// (and PARSER_VERSION in env) so parsed-criteria caches invalidate (CLAUDE.md rule 8).
// VERIFY: spike-grade prompt (Phase 1); tuned in Phase 2 against coverage results.
import { CORE_CATEGORIES } from "@/schema/criteria";
import { VOCABULARY } from "@/schema/vocabulary";

export const CRITERIA_PARSE_PROMPT_VERSION = "spike-0";

function vocabLines(): string {
  return VOCABULARY.map((e) => {
    const vals = "values" in e ? ` values: ${e.values.join("|")}` : "";
    const unit = "unit" in e ? ` canonical unit: ${e.unit}` : "";
    return `- ${e.key} (${e.type})${vals}${unit}`;
  }).join("\n");
}

export function buildCriteriaParseSystemPrompt(): string {
  return `You convert clinical-trial eligibility criteria into structured JSON. You never decide eligibility and never change criterion text.

For each criterion return:
- category: one of ${[...CORE_CATEGORIES, "performance", "lab", "organ_function", "comorbidity", "demographic", "washout_timing", "consent_logistics", "other"].join(", ")}
- fact_key: a key from the vocabulary below, or null
- operator: eq|neq|gte|lte|gt|lt|in|not_in, or null
- value: number | string | boolean | array, or null
- unit: the unit exactly as written in the criterion (e.g. "/mm3", "g/dL", "x ULN"), or null if none or unclear
- depends_on: vocabulary keys the criterion touches (use [] if none)
- scoring: false only for consent/logistics criteria (willingness to comply, able to consent, etc.), otherwise true

Rules:
1. operator and value describe the CONDITION STATED IN THE CRITERION TEXT, not what the patient must satisfy. Example: exclusion "Pregnant or breastfeeding" is not one fact; exclusion "Pregnant women" -> pregnant eq true. Inclusion "ECOG 0-1" -> ecog in ["0","1"].
2. Set fact_key ONLY if the ENTIRE criterion is captured by one (fact_key, operator, value) with no remaining condition. If the criterion has several conditions, "or" alternatives, exceptions, timing windows, or needs interpretation, set fact_key, operator and value to null and list the relevant keys in depends_on.
3. Values must match the vocabulary: enum values exactly as listed, booleans as true/false, numbers as numbers.
4. Do not convert units or do arithmetic. Copy numbers and units as written.
5. If a numeric lab is stated as an absolute value without a clear unit, set unit null.
6. Never invent facts. When unsure, use null.

Vocabulary:
${vocabLines()}

Output ONLY JSON, no prose, no markdown.`;
}

export function buildSingleCriterionUserPrompt(type: "inclusion" | "exclusion", text: string): string {
  return `Criterion type: ${type}
Criterion text:
"""
${text}
"""
Return one JSON object with keys: category, fact_key, operator, value, unit, depends_on, scoring.`;
}

export function buildBatchUserPrompt(items: Array<{ index: number; type: string; text: string }>): string {
  const body = items.map((i) => `[${i.index}] (${i.type}) ${i.text}`).join("\n");
  return `Parse each numbered criterion.
${body}

Return one JSON object: {"criteria":[{"index":<n>,"category":...,"fact_key":...,"operator":...,"value":...,"unit":...,"depends_on":[...],"scoring":...}, ...]} with exactly one entry per input index.`;
}
