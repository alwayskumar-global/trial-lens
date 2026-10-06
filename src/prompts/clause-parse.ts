// Clause-based criteria parser prompt. Changing any text here MUST bump CLAUSE_PARSE_PROMPT_VERSION
// (and PARSER_VERSION in env) so parsed-criteria caches invalidate (CLAUDE.md rule 8).
// VERIFY: spike-grade prompt (Phase 1 repairs); tune in Phase 2 against the coverage harness.
import { CORE_CATEGORIES } from "@/schema/criteria";
import { VOCABULARY } from "@/schema/vocabulary";

export const CLAUSE_PARSE_PROMPT_VERSION = "spike-4";

function vocabLines(): string {
  return VOCABULARY.map((e) => {
    const vals = "values" in e ? ` values: ${e.values.join("|")}` : "";
    const unit = "unit" in e ? ` canonical unit: ${e.unit}` : "";
    return `- ${e.key} (${e.type})${vals}${unit}`;
  }).join("\n");
}

export function buildClauseParseSystemPrompt(): string {
  return `You convert clinical-trial eligibility criteria into structured JSON. You never decide eligibility and never rewrite criterion text.

Each criterion becomes {"index","category","blocks"}.
- category (use "consent_logistics" only for willingness to comply / able to consent / logistics): ${[...CORE_CATEGORIES, "performance", "lab", "organ_function", "comorbidity", "demographic", "washout_timing", "consent_logistics", "other"].join(", ")}
- blocks: 1-4 blocks; ALL blocks must hold. A block is {"when","combine","items","except"}:
  - items: 1-6 leaves stating the requirement; combine: "all" if all must hold, "any" if alternatives ("or")
  - except: leaves for exceptions ("unless", "except", "other than"), usually []
  - when: [] for an unconditional requirement. Use "when" ONLY for an inclusion criterion that states WHO a requirement applies to ("Women of childbearing potential (aged 15-49) must ...", "Patients with HER2-positive disease must ..."): the leaves describing that population, all of which must hold. If one criterion has several requirements for different groups, make one block per group. NEVER use "when" for an exclusion criterion.

A LEAF states a condition AS WRITTEN in the criterion (not what the patient must satisfy). Leaf kinds:
1. "atom": ONE affirmative comparison on ONE vocabulary fact (fact_key, operator eq|gte|lte|gt|lt|in, value, unit as written or null). Its source must contain no negation, no "and"/"or" (except "or" listing several values of an "in"), no time window, and no number other than the atom's own value.
2. "timing": a time window around an event that is not a vocabulary fact (relation within_last | not_within_last, amount, time_unit days|weeks|months). Its source holds the whole window phrase ("within 7 days before starting treatment").
3. "text": anything else you cannot express exactly: kept verbatim for human/free-text review. List related vocabulary keys in depends_on. NEGATED statements ("No prior chemotherapy", "without brain metastases", "not pregnant") are ALWAYS one text leaf containing the negation and the words it governs.
Every leaf has "source": an EXACT contiguous fragment copied from the criterion text, character for character. Unused leaf fields are null (depends_on []).

CRITICAL: the leaf sources must TILE the criterion. Every word of the criterion must be inside some leaf source, EXCEPT plain filler (articles, "is/are/have", "must", "patients") and the connectives between leaves ("and" between items of an "all" block, "or" between items of an "any" block, "unless" before an except leaf, "who/with/if" before a "when" leaf). Negations ("no","not","without"), numbers, thresholds, time windows, populations ("women","men"), modals ("may","should") and exceptions must be INSIDE a leaf source, never dropped and never in a leaf of their own. If you cannot cover every requirement and its logical scope, return ONE block with ONE text leaf whose source is the whole criterion. A criterion that is dropped or only partly covered is treated as unreadable.

Rules:
1. Split a bundled criterion into leaves: "ANC >=1500/mm3; platelets >=100,000/mm3; Hb >=9 g/dL" -> one block, combine "all", three atoms, each with its own fragment as source.
2. "A or B" -> combine "any". "A unless B" -> A in items, B in except.
3. No nesting. Deeper logic than the blocks allow goes into ONE text leaf.
4. "No systemic therapy within 28 days" is NEGATED: one text leaf (or a timing leaf if it is only a window).
5. Enum values exactly as in the vocabulary; "in" takes an array (ECOG 0-1 -> ecog in ["0","1"]). Booleans: only true is allowed in atoms; numbers as numbers. Receptor atoms must match the cited text (ER-negative -> er_status eq "negative").
6. Copy numbers and units as written. Do not convert units or do arithmetic. If a lab has no clear unit, unit null.
7. If unsure, use one text leaf covering the whole criterion. Never invent facts.
Output ONLY JSON, no prose, no markdown.

Vocabulary:
${vocabLines()}`;
}

export function buildClauseBatchUserPrompt(items: Array<{ index: number; type: string; text: string }>): string {
  // JSON lines so the criterion text is unambiguous; models otherwise copy list tags like "(inclusion)" into "source".
  const body = items.map((i) => JSON.stringify({ index: i.index, type: i.type, text: i.text })).join("\n");
  return `Parse each criterion below (one JSON object per line). "source" values must be copied from the "text" value only, never from "index" or "type".
${body}

Return {"criteria":[{"index","category","blocks":[...]}]} with exactly one object per input index (0..${items.length - 1}), each index once, in order.`;
}
