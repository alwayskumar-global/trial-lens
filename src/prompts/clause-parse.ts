// Clause-based criteria parser prompt. Changing any text here MUST bump CLAUSE_PARSE_PROMPT_VERSION
// (and PARSER_VERSION in env) so parsed-criteria caches invalidate (CLAUDE.md rule 8).
// VERIFY: spike-grade prompt (Phase 1 repairs); tune in Phase 2 against the coverage harness.
import { CORE_CATEGORIES } from "@/schema/criteria";
import { VOCABULARY } from "@/schema/vocabulary";

export const CLAUSE_PARSE_PROMPT_VERSION = "spike-3";

function vocabLines(): string {
  return VOCABULARY.map((e) => {
    const vals = "values" in e ? ` values: ${e.values.join("|")}` : "";
    const unit = "unit" in e ? ` canonical unit: ${e.unit}` : "";
    return `- ${e.key} (${e.type})${vals}${unit}`;
  }).join("\n");
}

export function buildClauseParseSystemPrompt(): string {
  return `You convert clinical-trial eligibility criteria into structured JSON clauses. You never decide eligibility and never rewrite criterion text.

Each criterion becomes: {"index", "category", "combine", "items", "except"}.
- category (use "consent_logistics" only for willingness to comply / able to consent / logistics): ${[...CORE_CATEGORIES, "performance", "lab", "organ_function", "comorbidity", "demographic", "washout_timing", "consent_logistics", "other"].join(", ")}
- combine: "all" if the items must all hold, "any" if alternatives ("or")
- items: 1-8 leaves. except: leaves describing exceptions ("unless", "except", "other than"), usually [].

A LEAF states a condition AS WRITTEN in the criterion (not what the patient must satisfy). Leaf kinds:
1. "atom": ONE comparison on ONE vocabulary fact. Requires fact_key, operator (eq|neq|gte|lte|gt|lt|in|not_in), value, unit (as written, or null).
2. "timing": a time window around an event that is not a vocabulary fact (e.g. "within 14 days of radiotherapy"). Requires relation (within_last | not_within_last), amount, time_unit (days|weeks|months); list related vocabulary keys in depends_on.
3. "text": anything else you cannot express exactly: kept verbatim for a human/free-text review. List related vocabulary keys in depends_on.
Every leaf has "source": an EXACT contiguous fragment copied from the criterion text, character for character. Never paraphrase, never merge text from different places.
Unused leaf fields must be null (depends_on []).

Rules:
1. Split a bundled criterion into leaves: "ANC >=1500/mm3; platelets >=100,000/mm3; Hb >=9 g/dL" -> combine "all" with three atoms.
2. "A or B" -> combine "any". "A unless B" / "A, except B" -> A in items, B in except.
3. No nesting. If logic is deeper than one level (for example "A and (B or C)"), put the nested part into ONE "text" leaf whose source is that fragment, or the whole criterion if unsure.
4. "No systemic therapy within 28 days" -> atom days_since_last_systemic_therapy gte 28 unit "days". Other timing -> "timing" leaf.
5. Enum values exactly as in the vocabulary; "in"/"not_in" take arrays of enum strings (ECOG 0-1 -> ecog in ["0","1"]; ECOG >=2 -> ecog in ["2","3","4"]). Booleans true/false; numbers as numbers.
6. Copy numbers and units as written. Do not convert units or do arithmetic. If a lab has no clear unit, unit null.
7. If unsure, use a "text" leaf with source = the whole criterion text. Never invent facts.
Output ONLY JSON, no prose, no markdown.

Vocabulary:
${vocabLines()}`;
}

export function buildClauseBatchUserPrompt(items: Array<{ index: number; type: string; text: string }>): string {
  // JSON lines so the criterion text is unambiguous; models otherwise copy list tags like "(inclusion)" into "source".
  const body = items.map((i) => JSON.stringify({ index: i.index, type: i.type, text: i.text })).join("\n");
  return `Parse each criterion below (one JSON object per line). "source" values must be copied from the "text" value only, never from "index" or "type".
${body}

Return {"criteria":[{...}]} with exactly one object per input index (0..${items.length - 1}), each index once, in order.`;
}
